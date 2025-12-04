import { logger } from './logger.js';
import { dbZones, dbZoneRecords, dbZoneChanges } from './db.js';
import { authenticateZoneTransfer } from './tsig-utils.js';

// Zone transfer types
const _AXFR = 252; // Full zone transfer
const _IXFR = 251; // Incremental zone transfer

interface _ZoneRecord {
  name: string;
  type: string;
  ttl: number;
  data: string;
  priority: number | null;
}

/**
 * Handle AXFR (Full Zone Transfer) request
 * Returns all records in the zone, must be sent over TCP
 * Requires authentication via TSIG or IP ACL
 */
export function handleAXFR(
  zoneId: number,
  queryId: number,
  message: Buffer,
  clientIp: string,
): Buffer[] {
  try {
    // Authenticate zone transfer request
    const authResult = authenticateZoneTransfer(message, clientIp, zoneId);
    if (!authResult.authenticated) {
      logger.warn('AXFR zone transfer denied', {
        zoneId,
        clientIp,
        reason: authResult.reason,
      });
      return [];
    }

    logger.info('AXFR zone transfer authenticated', {
      zoneId,
      clientIp,
      method: authResult.method,
    });

    const zone = dbZones.getById(zoneId);
    if (!zone || zone.enabled !== 1) {
      return [];
    }

    const records = dbZoneRecords.getByZone(zoneId);
    const responses: Buffer[] = [];

    // Type map for DNS record types
    const _typeMap: Record<string, number> = {
      A: 1,
      AAAA: 28,
      MX: 15,
      TXT: 16,
      NS: 2,
      CNAME: 5,
      SOA: 6,
      PTR: 12,
      SRV: 33,
      CAA: 257,
    };

    // First response: SOA record
    const soaResponse = createZoneTransferRecord(
      queryId,
      zone.domain,
      'SOA',
      zone.soa_minimum,
      `${zone.soa_mname} ${zone.soa_rname} ${zone.soa_serial} ${zone.soa_refresh} ${zone.soa_retry} ${zone.soa_expire} ${zone.soa_minimum}`,
      zone.domain,
    );
    responses.push(soaResponse);

    // Add all zone records
    for (const record of records) {
      if (!record.enabled) continue;

      const fullName = record.name === '@' ? zone.domain : `${record.name}.${zone.domain}`;
      const recordResponse = createZoneTransferRecord(
        queryId,
        fullName,
        record.type,
        record.ttl,
        record.data,
        zone.domain,
        record.priority,
      );
      responses.push(recordResponse);
    }

    // Last response: SOA record again (indicates end of transfer)
    const finalSoaResponse = createZoneTransferRecord(
      queryId,
      zone.domain,
      'SOA',
      zone.soa_minimum,
      `${zone.soa_mname} ${zone.soa_rname} ${zone.soa_serial} ${zone.soa_refresh} ${zone.soa_retry} ${zone.soa_expire} ${zone.soa_minimum}`,
      zone.domain,
    );
    responses.push(finalSoaResponse);

    logger.info('AXFR zone transfer completed', {
      zone: zone.domain,
      zoneId,
      clientIp,
      recordCount: records.length,
      method: authResult.method,
    });
    return responses;
  } catch (error) {
    logger.error('Error handling AXFR', {
      error: error instanceof Error ? error : new Error(String(error)),
      zoneId,
    });
    return [];
  }
}

/**
 * Handle IXFR (Incremental Zone Transfer) request
 * Returns only records that changed since the specified serial
 * Requires authentication via TSIG or IP ACL
 */
export function handleIXFR(
  zoneId: number,
  queryId: number,
  requestedSerial: number,
  message: Buffer,
  clientIp: string,
): Buffer[] {
  try {
    // Authenticate zone transfer request
    const authResult = authenticateZoneTransfer(message, clientIp, zoneId);
    if (!authResult.authenticated) {
      logger.warn('IXFR zone transfer denied', {
        zoneId,
        clientIp,
        requestedSerial,
        reason: authResult.reason,
      });
      return [];
    }

    logger.info('IXFR zone transfer authenticated', {
      zoneId,
      clientIp,
      requestedSerial,
      method: authResult.method,
    });

    const zone = dbZones.getById(zoneId);
    if (!zone || zone.enabled !== 1) {
      return [];
    }

    // If requested serial is current or newer, return current SOA only
    if (requestedSerial >= zone.soa_serial) {
      const soaResponse = createZoneTransferRecord(
        queryId,
        zone.domain,
        'SOA',
        zone.soa_minimum,
        `${zone.soa_mname} ${zone.soa_rname} ${zone.soa_serial} ${zone.soa_refresh} ${zone.soa_retry} ${zone.soa_expire} ${zone.soa_minimum}`,
        zone.domain,
      );
      return [soaResponse, soaResponse]; // Start and end SOA
    }

    // Get changes since requested serial
    const changes = dbZoneChanges.getChangesSince(zoneId, requestedSerial);

    // If no changes found or too many changes, fall back to AXFR
    // RFC 1995 suggests falling back to AXFR if IXFR would be larger
    if (changes.length === 0 || changes.length > 1000) {
      logger.info('IXFR requested, falling back to AXFR', {
        zone: zone.domain,
        requestedSerial,
        currentSerial: zone.soa_serial,
        changeCount: changes.length,
        reason: changes.length === 0 ? 'no changes' : 'too many changes',
      });
      return handleAXFR(zoneId, queryId, message, clientIp);
    }

    const responses: Buffer[] = [];

    // First response: Old SOA (requested serial)
    const oldSoaResponse = createZoneTransferRecord(
      queryId,
      zone.domain,
      'SOA',
      zone.soa_minimum,
      `${zone.soa_mname} ${zone.soa_rname} ${requestedSerial} ${zone.soa_refresh} ${zone.soa_retry} ${zone.soa_expire} ${zone.soa_minimum}`,
      zone.domain,
    );
    responses.push(oldSoaResponse);

    // Group changes by serial to process in order
    const changesBySerial = new Map<number, typeof changes>();
    for (const change of changes) {
      if (!changesBySerial.has(change.serial)) {
        changesBySerial.set(change.serial, []);
      }
      changesBySerial.get(change.serial)!.push(change);
    }

    // Process changes in serial order
    const sortedSerials = Array.from(changesBySerial.keys()).sort((a, b) => a - b);
    for (const serial of sortedSerials) {
      const serialChanges = changesBySerial.get(serial)!;

      // For each serial, output: old SOA, changes, new SOA
      // Old SOA for this serial
      const serialOldSoa = createZoneTransferRecord(
        queryId,
        zone.domain,
        'SOA',
        zone.soa_minimum,
        `${zone.soa_mname} ${zone.soa_rname} ${serial - 1} ${zone.soa_refresh} ${zone.soa_retry} ${zone.soa_expire} ${
          zone.soa_minimum
        }`,
        zone.domain,
      );
      responses.push(serialOldSoa);

      // Process changes: deletes first, then adds/modifies
      const deletes = serialChanges.filter((c) => c.change_type === 'delete');
      const addsModifies = serialChanges.filter((c) => c.change_type !== 'delete');

      // Output deletes (old record values)
      for (const change of deletes) {
        const fullName = change.record_name === '@' ? zone.domain : `${change.record_name}.${zone.domain}`;
        const deleteResponse = createZoneTransferRecord(
          queryId,
          fullName,
          change.record_type,
          change.record_ttl,
          change.record_data,
          zone.domain,
          change.record_priority,
        );
        responses.push(deleteResponse);
      }

      // Output adds/modifies (new record values)
      for (const change of addsModifies) {
        const fullName = change.record_name === '@' ? zone.domain : `${change.record_name}.${zone.domain}`;
        const addModifyResponse = createZoneTransferRecord(
          queryId,
          fullName,
          change.record_type,
          change.record_ttl,
          change.record_data,
          zone.domain,
          change.record_priority,
        );
        responses.push(addModifyResponse);
      }

      // New SOA for this serial
      const serialNewSoa = createZoneTransferRecord(
        queryId,
        zone.domain,
        'SOA',
        zone.soa_minimum,
        `${zone.soa_mname} ${zone.soa_rname} ${serial} ${zone.soa_refresh} ${zone.soa_retry} ${zone.soa_expire} ${zone.soa_minimum}`,
        zone.domain,
      );
      responses.push(serialNewSoa);
    }

    // Final response: Current SOA
    const finalSoaResponse = createZoneTransferRecord(
      queryId,
      zone.domain,
      'SOA',
      zone.soa_minimum,
      `${zone.soa_mname} ${zone.soa_rname} ${zone.soa_serial} ${zone.soa_refresh} ${zone.soa_retry} ${zone.soa_expire} ${zone.soa_minimum}`,
      zone.domain,
    );
    responses.push(finalSoaResponse);

    logger.info('IXFR zone transfer completed', {
      zone: zone.domain,
      zoneId,
      clientIp,
      requestedSerial,
      currentSerial: zone.soa_serial,
      changeCount: changes.length,
      responseCount: responses.length,
      method: authResult.method,
    });

    return responses;
  } catch (error) {
    logger.error('Error handling IXFR', {
      error: error instanceof Error ? error : new Error(String(error)),
      zoneId,
      requestedSerial,
    });
    return [];
  }
}

/**
 * Create a DNS record for zone transfer
 */
function createZoneTransferRecord(
  queryId: number,
  name: string,
  type: string,
  ttl: number,
  data: string,
  _zoneDomain: string,
  priority?: number | null,
): Buffer {
  const response = Buffer.alloc(4096);
  let offset = 0;

  // Header
  response.writeUInt16BE(queryId, offset);
  offset += 2;
  response.writeUInt16BE(0x8400, offset); // QR=1, AA=1, no error
  offset += 2;
  response.writeUInt16BE(0, offset); // Questions
  offset += 2;
  response.writeUInt16BE(1, offset); // Answers
  offset += 2;
  response.writeUInt16BE(0, offset); // Authority
  offset += 2;
  response.writeUInt16BE(0, offset); // Additional
  offset += 2;

  const _nameStart = offset;

  // Domain name (use compression pointer to zone domain if possible)
  const nameParts = name.toLowerCase().split('.');
  for (const part of nameParts) {
    response[offset++] = part.length;
    Buffer.from(part).copy(response, offset);
    offset += part.length;
  }
  response[offset++] = 0; // Null terminator

  // Type
  const typeMap: Record<string, number> = {
    A: 1,
    AAAA: 28,
    MX: 15,
    TXT: 16,
    NS: 2,
    CNAME: 5,
    SOA: 6,
    PTR: 12,
    SRV: 33,
    CAA: 257,
    NAPTR: 35,
    SSHFP: 44,
    TLSA: 52,
    SVCB: 64,
    HTTPS: 65,
  };
  response.writeUInt16BE(typeMap[type.toUpperCase()] || 1, offset);
  offset += 2;

  // Class (IN = 1)
  response.writeUInt16BE(1, offset);
  offset += 2;

  // TTL
  response.writeUInt32BE(ttl, offset);
  offset += 4;

  // Data length and data
  const dataStart = offset;
  offset += 2; // Reserve space for data length

  let dataBytes: Buffer;
  if (type === 'A') {
    const parts = data.split('.');
    dataBytes = Buffer.from([
      parseInt(parts[0], 10),
      parseInt(parts[1], 10),
      parseInt(parts[2], 10),
      parseInt(parts[3], 10),
    ]);
  } else if (type === 'AAAA') {
    const parts = data.split(':');
    dataBytes = Buffer.alloc(16);
    let byteOffset = 0;
    for (const part of parts) {
      const num = parseInt(part, 16);
      dataBytes[byteOffset++] = (num >> 8) & 0xff;
      dataBytes[byteOffset++] = num & 0xff;
    }
  } else if (type === 'MX') {
    const mxPriority = priority ?? parseInt(data.split(' ')[0], 10);
    const mxDomain = data.split(' ').slice(1).join(' ') || data;
    const domainBytes = domainToBytes(mxDomain);
    dataBytes = Buffer.concat([Buffer.from([(mxPriority >> 8) & 0xff, mxPriority & 0xff]), domainBytes]);
  } else if (type === 'TXT') {
    const txtData = Buffer.from(data, 'utf8');
    dataBytes = Buffer.concat([Buffer.from([txtData.length]), txtData]);
  } else if (type === 'NS' || type === 'CNAME') {
    dataBytes = domainToBytes(data);
  } else if (type === 'SOA') {
    const parts = data.split(' ');
    if (parts.length >= 7) {
      const mname = domainToBytes(parts[0]);
      const rname = domainToBytes(parts[1]);
      const serial = parseInt(parts[2], 10);
      const refresh = parseInt(parts[3], 10);
      const retry = parseInt(parts[4], 10);
      const expire = parseInt(parts[5], 10);
      const minimum = parseInt(parts[6], 10);
      dataBytes = Buffer.concat([
        mname,
        rname,
        Buffer.from([
          (serial >> 24) & 0xff,
          (serial >> 16) & 0xff,
          (serial >> 8) & 0xff,
          serial & 0xff,
          (refresh >> 24) & 0xff,
          (refresh >> 16) & 0xff,
          (refresh >> 8) & 0xff,
          refresh & 0xff,
          (retry >> 24) & 0xff,
          (retry >> 16) & 0xff,
          (retry >> 8) & 0xff,
          retry & 0xff,
          (expire >> 24) & 0xff,
          (expire >> 16) & 0xff,
          (expire >> 8) & 0xff,
          expire & 0xff,
          (minimum >> 24) & 0xff,
          (minimum >> 16) & 0xff,
          (minimum >> 8) & 0xff,
          minimum & 0xff,
        ]),
      ]);
    } else {
      dataBytes = Buffer.from(data, 'utf8');
    }
  } else if (type === 'CAA') {
    // CAA record format: flags (1 byte) + tag length (1 byte) + tag + value
    // Data format: "flags tag value" or "0 issue letsencrypt.org"
    const parts = data.split(' ');
    if (parts.length >= 3) {
      const flags = parseInt(parts[0], 10) || 0;
      const tag = parts[1];
      const value = parts.slice(2).join(' ');
      const tagBytes = Buffer.from(tag, 'utf8');
      const valueBytes = Buffer.from(value, 'utf8');
      dataBytes = Buffer.concat([Buffer.from([flags & 0xff]), Buffer.from([tagBytes.length]), tagBytes, valueBytes]);
    } else {
      // Fallback: treat as raw data
      dataBytes = Buffer.from(data, 'utf8');
    }
  } else if (type === 'NAPTR') {
    // NAPTR: order (2) + preference (2) + flags (length-prefixed) + service (length-prefixed) + regexp (length-prefixed) + replacement (domain)
    // Data format: "order preference \"flags\" \"service\" \"regexp\" replacement"
    const parts = data.match(/(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"\s+(.+)/);
    if (parts && parts.length >= 7) {
      const order = parseInt(parts[1], 10);
      const preference = parseInt(parts[2], 10);
      const flags = Buffer.from(parts[3], 'utf8');
      const service = Buffer.from(parts[4], 'utf8');
      const regexp = Buffer.from(parts[5], 'utf8');
      const replacement = domainToBytes(parts[6].trim());
      dataBytes = Buffer.concat([
        Buffer.from([(order >> 8) & 0xff, order & 0xff]),
        Buffer.from([(preference >> 8) & 0xff, preference & 0xff]),
        Buffer.from([flags.length]),
        flags,
        Buffer.from([service.length]),
        service,
        Buffer.from([regexp.length]),
        regexp,
        replacement,
      ]);
    } else {
      dataBytes = Buffer.from(data, 'utf8');
    }
  } else if (type === 'SSHFP') {
    // SSHFP: algorithm (1) + fp_type (1) + fingerprint (hex)
    // Data format: "algorithm fp_type fingerprint"
    const parts = data.split(' ');
    if (parts.length >= 3) {
      const algorithm = parseInt(parts[0], 10);
      const fpType = parseInt(parts[1], 10);
      const fingerprint = Buffer.from(parts[2].replace(/:/g, ''), 'hex');
      dataBytes = Buffer.concat([Buffer.from([algorithm & 0xff, fpType & 0xff]), fingerprint]);
    } else {
      dataBytes = Buffer.from(data, 'utf8');
    }
  } else if (type === 'TLSA') {
    // TLSA: usage (1) + selector (1) + matching_type (1) + certificate_association_data (hex)
    // Data format: "usage selector matching_type hexdata"
    const parts = data.split(' ');
    if (parts.length >= 4) {
      const usage = parseInt(parts[0], 10);
      const selector = parseInt(parts[1], 10);
      const matchingType = parseInt(parts[2], 10);
      const certData = Buffer.from(parts[3].replace(/:/g, ''), 'hex');
      dataBytes = Buffer.concat([Buffer.from([usage & 0xff, selector & 0xff, matchingType & 0xff]), certData]);
    } else {
      dataBytes = Buffer.from(data, 'utf8');
    }
  } else if (type === 'SVCB' || type === 'HTTPS') {
    // SVCB/HTTPS: SvcPriority (2) + TargetName (domain, can be ".") + SvcParams (key-value pairs)
    // Data format: "priority targetname key=value key=value"
    const parts = data.split(' ');
    if (parts.length >= 2) {
      const priority = parseInt(parts[0], 10);
      const targetName = parts[1] === '.' ? Buffer.from([0]) : domainToBytes(parts[1]);
      const svcParams: Buffer[] = [];
      // Parse SvcParams (key=value pairs)
      for (let i = 2; i < parts.length; i++) {
        const param = parts[i];
        const eqIndex = param.indexOf('=');
        if (eqIndex > 0) {
          const key = param.substring(0, eqIndex);
          const value = param.substring(eqIndex + 1);
          const keyBytes = Buffer.from(key, 'utf8');
          const valueBytes = Buffer.from(value, 'utf8');
          svcParams.push(
            Buffer.concat([Buffer.from([keyBytes.length]), keyBytes, Buffer.from([valueBytes.length]), valueBytes]),
          );
        }
      }
      dataBytes = Buffer.concat([Buffer.from([(priority >> 8) & 0xff, priority & 0xff]), targetName, ...svcParams]);
    } else {
      dataBytes = Buffer.from(data, 'utf8');
    }
  } else {
    dataBytes = Buffer.from(data, 'utf8');
  }

  // Write data length
  response.writeUInt16BE(dataBytes.length, dataStart);
  dataBytes.copy(response, dataStart + 2);

  return response.slice(0, dataStart + 2 + dataBytes.length);
}

function domainToBytes(domain: string): Buffer {
  if (!domain.endsWith('.')) {
    domain += '.';
  }
  const parts = domain.split('.');
  const buffer = Buffer.alloc(domain.length + 1);
  let offset = 0;
  for (const part of parts) {
    if (part.length === 0) continue;
    buffer[offset++] = part.length;
    Buffer.from(part).copy(buffer, offset);
    offset += part.length;
  }
  buffer[offset++] = 0;
  return buffer.slice(0, offset);
}
