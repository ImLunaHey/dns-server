import { logger } from './logger.js';
import { dbZones, dbZoneRecords } from './db.js';

// Zone transfer types
const AXFR = 252; // Full zone transfer
const IXFR = 251; // Incremental zone transfer

interface ZoneRecord {
  name: string;
  type: string;
  ttl: number;
  data: string;
  priority: number | null;
}

/**
 * Handle AXFR (Full Zone Transfer) request
 * Returns all records in the zone, must be sent over TCP
 */
export function handleAXFR(zoneId: number, queryId: number): Buffer[] {
  try {
    const zone = dbZones.getById(zoneId);
    if (!zone || zone.enabled !== 1) {
      return [];
    }

    const records = dbZoneRecords.getByZone(zoneId);
    const responses: Buffer[] = [];

    // Type map for DNS record types
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

    logger.info('AXFR zone transfer completed', { zone: zone.domain, recordCount: records.length });
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
 */
export function handleIXFR(zoneId: number, queryId: number, requestedSerial: number): Buffer[] {
  try {
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

    // For now, we'll do a full transfer if serial doesn't match
    // In a production system, you'd track changes per serial number
    logger.info('IXFR requested, falling back to AXFR', {
      zone: zone.domain,
      requestedSerial,
      currentSerial: zone.soa_serial,
    });
    return handleAXFR(zoneId, queryId);
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
  zoneDomain: string,
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

  const nameStart = offset;

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
