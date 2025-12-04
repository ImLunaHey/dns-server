import * as crypto from 'crypto';
import { logger } from './logger.js';
import { dbZones, dbZoneRecords, dbTSIGKeys } from './db.js';

// DNS UPDATE OPCODE is 5
const UPDATE_OPCODE = 5;
const TSIG_TYPE = 250;

interface TSIGRecord {
  name: string;
  algorithm: string;
  timeSigned: number;
  fudge: number;
  macSize: number;
  mac: Buffer;
  originalID: number;
  error: number;
  otherLen: number;
  otherData: Buffer;
}

/**
 * Parse TSIG record from DNS message
 */
function parseTSIG(message: Buffer, offset: number): TSIGRecord | null {
  try {
    // TSIG name (should be the key name)
    let nameOffset = offset;
    const nameParts: string[] = [];
    while (nameOffset < message.length && message[nameOffset] !== 0) {
      const length = message[nameOffset];
      if ((length & 0xc0) === 0xc0) {
        // Compression pointer - not supported in TSIG
        return null;
      }
      nameOffset++;
      if (nameOffset + length > message.length) return null;
      nameParts.push(message.toString('utf8', nameOffset, nameOffset + length));
      nameOffset += length;
    }
    nameOffset++; // Skip null terminator
    const name = nameParts.join('.');

    if (nameOffset + 10 > message.length) return null;

    const type = message.readUInt16BE(nameOffset);
    if (type !== TSIG_TYPE) return null;
    nameOffset += 8; // Skip TYPE, CLASS, TTL

    const dataLength = message.readUInt16BE(nameOffset);
    nameOffset += 2;

    if (nameOffset + dataLength > message.length) return null;

    // Parse TSIG data
    const algorithmOffset = nameOffset;
    const algorithmParts: string[] = [];
    let algOffset = algorithmOffset;
    while (algOffset < message.length && message[algOffset] !== 0) {
      const length = message[algOffset];
      algOffset++;
      if (algOffset + length > message.length) return null;
      algorithmParts.push(message.toString('utf8', algOffset, algOffset + length));
      algOffset += length;
    }
    algOffset++; // Skip null terminator
    const algorithm = algorithmParts.join('.');

    if (algOffset + 20 > message.length) return null;

    const timeSigned = (message.readUInt32BE(algOffset) << 16) | message.readUInt16BE(algOffset + 4);
    const fudge = message.readUInt16BE(algOffset + 6);
    const macSize = message.readUInt16BE(algOffset + 8);
    algOffset += 10;

    if (algOffset + macSize > message.length) return null;
    const mac = message.subarray(algOffset, algOffset + macSize);
    algOffset += macSize;

    if (algOffset + 6 > message.length) return null;
    const originalID = message.readUInt16BE(algOffset);
    const error = message.readUInt16BE(algOffset + 2);
    const otherLen = message.readUInt16BE(algOffset + 4);
    algOffset += 6;

    const otherData =
      otherLen > 0 && algOffset + otherLen <= message.length
        ? message.subarray(algOffset, algOffset + otherLen)
        : Buffer.alloc(0);

    return {
      name,
      algorithm,
      timeSigned,
      fudge,
      macSize,
      mac,
      originalID,
      error,
      otherLen,
      otherData,
    };
  } catch (error) {
    logger.error('Error parsing TSIG', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
}

/**
 * Verify TSIG signature
 */
function verifyTSIG(message: Buffer, tsig: TSIGRecord, secret: string): boolean {
  try {
    // Build message for verification (original message without TSIG)
    const tsigStart = message.indexOf(
      Buffer.from(
        tsig.name
          .split('.')
          .map((p) => p.length)
          .concat([0]),
      ),
    );
    if (tsigStart === -1) return false;

    // Find TSIG record in message
    let tsigOffset = tsigStart;
    while (tsigOffset < message.length && message[tsigOffset] !== 0) {
      const length = message[tsigOffset];
      if ((length & 0xc0) === 0xc0) break;
      tsigOffset += length + 1;
    }
    tsigOffset++; // Skip null terminator

    // Message to verify is everything before TSIG, plus TSIG data (without MAC)
    const messageBeforeTSIG = message.subarray(0, tsigOffset);

    // Build TSIG data for signing (without MAC)
    const tsigData = Buffer.alloc(tsig.name.length + 2 + tsig.algorithm.length + 2 + 18);
    let pos = 0;
    for (const part of tsig.name.split('.')) {
      tsigData[pos++] = part.length;
      Buffer.from(part).copy(tsigData, pos);
      pos += part.length;
    }
    tsigData[pos++] = 0;
    tsigData.writeUInt16BE(TSIG_TYPE, pos);
    pos += 2;
    tsigData.writeUInt16BE(1, pos); // Class
    pos += 2;
    tsigData.writeUInt32BE(0, pos); // TTL
    pos += 4;
    // Data length will be set after building data
    const dataStart = pos + 2;
    pos += 2;

    // Algorithm name
    for (const part of tsig.algorithm.split('.')) {
      tsigData[pos++] = part.length;
      Buffer.from(part).copy(tsigData, pos);
      pos += part.length;
    }
    tsigData[pos++] = 0;

    // Time signed (48-bit)
    const timeHigh = (tsig.timeSigned >> 16) & 0xffff;
    const timeLow = tsig.timeSigned & 0xffff;
    tsigData.writeUInt16BE(timeHigh, pos);
    pos += 2;
    tsigData.writeUInt16BE(timeLow, pos);
    pos += 2;
    tsigData.writeUInt16BE(tsig.fudge, pos);
    pos += 2;
    tsigData.writeUInt16BE(tsig.macSize, pos);
    pos += 2;
    // MAC will be zero-filled for verification
    pos += tsig.macSize;
    tsigData.writeUInt16BE(tsig.originalID, pos);
    pos += 2;
    tsigData.writeUInt16BE(tsig.error, pos);
    pos += 2;
    tsigData.writeUInt16BE(tsig.otherLen, pos);
    pos += 2;
    if (tsig.otherLen > 0) {
      tsig.otherData.copy(tsigData, pos);
      pos += tsig.otherLen;
    }

    // Set data length
    const dataLength = pos - dataStart;
    tsigData.writeUInt16BE(dataLength, dataStart - 2);

    // Build message for HMAC
    const messageToSign = Buffer.concat([messageBeforeTSIG, tsigData.subarray(0, pos)]);

    // Verify HMAC based on algorithm
    // Security: Only support strong algorithms (hmac-sha256+)
    // hmac-md5 is removed (deprecated and vulnerable)
    // hmac-sha1 is deprecated but still allowed with warnings
    let expectedMAC: Buffer;
    if (tsig.algorithm === 'hmac-sha256' || tsig.algorithm === 'hmac-sha256.') {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(messageToSign);
      expectedMAC = hmac.digest();
    } else if (tsig.algorithm === 'hmac-sha384' || tsig.algorithm === 'hmac-sha384.') {
      const hmac = crypto.createHmac('sha384', secret);
      hmac.update(messageToSign);
      expectedMAC = hmac.digest();
    } else if (tsig.algorithm === 'hmac-sha512' || tsig.algorithm === 'hmac-sha512.') {
      const hmac = crypto.createHmac('sha512', secret);
      hmac.update(messageToSign);
      expectedMAC = hmac.digest();
    } else if (tsig.algorithm === 'hmac-sha1' || tsig.algorithm === 'hmac-sha1.') {
      // Deprecated: hmac-sha1 is weak and should be avoided
      logger.warn('TSIG using deprecated weak algorithm hmac-sha1. Please migrate to hmac-sha256 or stronger', {
        algorithm: tsig.algorithm,
      });
      const hmac = crypto.createHmac('sha1', secret);
      hmac.update(messageToSign);
      expectedMAC = hmac.digest();
    } else if (tsig.algorithm === 'hmac-md5' || tsig.algorithm === 'hmac-md5.') {
      // Security: hmac-md5 is removed - it's deprecated and vulnerable
      logger.error('TSIG algorithm hmac-md5 is not supported (deprecated and vulnerable). Use hmac-sha256 or stronger', {
        algorithm: tsig.algorithm,
      });
      return false;
    } else {
      logger.warn('Unsupported TSIG algorithm', { algorithm: tsig.algorithm });
      return false;
    }

    // Compare MACs (constant-time comparison)
    if (expectedMAC.length !== tsig.mac.length) return false;
    return crypto.timingSafeEqual(expectedMAC, tsig.mac);
  } catch (error) {
    logger.error('Error verifying TSIG', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return false;
  }
}

/**
 * Handle DNS UPDATE request (RFC 2136)
 */
export function handleDNSUpdate(message: Buffer, clientIp: string): Buffer | null {
  try {
    if (message.length < 12) {
      logger.warn('DNS UPDATE request too short', { clientIp, messageLength: message.length });
      return null;
    }

    const id = message.readUInt16BE(0);
    const flags = message.readUInt16BE(2);
    const opcode = (flags >> 11) & 0xf;

    // Check if it's an UPDATE request
    if (opcode !== UPDATE_OPCODE) {
      return null;
    }

    // Log DNS UPDATE attempt
    logger.info('DNS UPDATE request received', {
      clientIp,
      queryId: id,
      messageLength: message.length,
    });

    // Parse zones (prerequisite section)
    let offset = 12;
    const zoneCount = message.readUInt16BE(4);
    const zones: Array<{ name: string; type: number; class: number }> = [];

    for (let i = 0; i < zoneCount && offset < message.length; i++) {
      const nameResult = parseDomainName(message, offset);
      if (!nameResult) break;
      offset = nameResult.newOffset;
      if (offset + 4 > message.length) break;
      const type = message.readUInt16BE(offset);
      const class_ = message.readUInt16BE(offset + 2);
      offset += 4;
      zones.push({ name: nameResult.name, type, class: class_ });
    }

    if (zones.length === 0) {
      logger.warn('DNS UPDATE request rejected: no zones specified', {
        clientIp,
        queryId: id,
      });
      return createUpdateResponse(id, 1); // FORMERR
    }

    const zone = zones[0];
    const zoneRecord = dbZones.findZoneForDomain(zone.name);
    if (!zoneRecord) {
      logger.warn('DNS UPDATE request rejected: zone not found', {
        clientIp,
        queryId: id,
        zone: zone.name,
      });
      return createUpdateResponse(id, 3); // NXDOMAIN
    }

    // Parse TSIG from additional section
    const _arCount = message.readUInt16BE(10);
    let tsig: TSIGRecord | null = null;
    let _tsigOffset = offset;

    // Skip prerequisite, update, and additional sections to find TSIG
    // For simplicity, we'll search from the end
    for (let i = message.length - 50; i >= 0 && i < message.length; i--) {
      if (message[i] === 0) {
        const potentialTSIG = parseTSIG(message, i - 1);
        if (potentialTSIG) {
          tsig = potentialTSIG;
          break;
        }
      }
    }

    if (!tsig) {
      logger.warn('DNS UPDATE request rejected: TSIG required', {
        clientIp,
        queryId: id,
        zone: zone.name,
        zoneId: zoneRecord.id,
      });
      return createUpdateResponse(id, 9); // NOTAUTH - TSIG required
    }

    // Verify TSIG
    const tsigKey = dbTSIGKeys.getByName(tsig.name);
    if (!tsigKey) {
      logger.warn('DNS UPDATE request rejected: unknown TSIG key', {
        clientIp,
        queryId: id,
        zone: zone.name,
        zoneId: zoneRecord.id,
        tsigName: tsig.name,
      });
      return createUpdateResponse(id, 9); // NOTAUTH - Unknown key
    }

    if (!verifyTSIG(message, tsig, tsigKey.secret)) {
      logger.warn('DNS UPDATE request rejected: invalid TSIG signature', {
        clientIp,
        queryId: id,
        zone: zone.name,
        zoneId: zoneRecord.id,
        tsigName: tsig.name,
      });
      return createUpdateResponse(id, 9); // NOTAUTH - Invalid signature
    }

    // Parse update section
    const updateCount = message.readUInt16BE(6);
    const updates: Array<{ name: string; type: number; ttl: number; data: string }> = [];

    // Skip prerequisite section (already parsed)
    for (let i = 0; i < updateCount && offset < message.length; i++) {
      const nameResult = parseDomainName(message, offset);
      if (!nameResult) break;
      offset = nameResult.newOffset;
      if (offset + 10 > message.length) break;
      const type = message.readUInt16BE(offset);
      offset += 2;
      const _class_ = message.readUInt16BE(offset);
      offset += 2;
      const ttl = message.readUInt32BE(offset);
      offset += 4;
      const dataLength = message.readUInt16BE(offset);
      offset += 2;
      if (offset + dataLength > message.length) break;

      // Parse data based on type
      let data = '';
      if (type === 1) {
        // A record
        data = `${message[offset]}.${message[offset + 1]}.${message[offset + 2]}.${message[offset + 3]}`;
      } else if (type === 28) {
        // AAAA record
        const parts: string[] = [];
        for (let j = 0; j < 16; j += 2) {
          parts.push(
            message
              .readUInt16BE(offset + j)
              .toString(16)
              .padStart(4, '0'),
          );
        }
        data = parts.join(':');
      } else {
        data = message.subarray(offset, offset + dataLength).toString('utf8');
      }
      offset += dataLength;
      updates.push({ name: nameResult.name, type, ttl, data });
    }

    // Apply updates
    for (const update of updates) {
      const recordName = update.name.replace(`.${zone.name}`, '').replace(zone.name, '') || '@';
      const typeMap: Record<number, string> = {
        1: 'A',
        28: 'AAAA',
        15: 'MX',
        16: 'TXT',
        2: 'NS',
        5: 'CNAME',
      };
      const typeName = typeMap[update.type] || 'A';

      // Check if record exists
      const existing = dbZoneRecords.getByZone(zoneRecord.id).find((r) => r.name === recordName && r.type === typeName);

      if (existing) {
        dbZoneRecords.update(existing.id, { data: update.data, ttl: update.ttl });
      } else {
        dbZoneRecords.create(zoneRecord.id, recordName, typeName, update.ttl, update.data);
      }
    }

    // Update SOA serial
    const newSerial = zoneRecord.soa_serial + 1;
    dbZones.update(zoneRecord.id, { soa_serial: newSerial });

    // Log successful DNS UPDATE
    logger.info('DNS UPDATE request successful', {
      clientIp,
      queryId: id,
      zone: zone.name,
      zoneId: zoneRecord.id,
      tsigName: tsig.name,
      updateCount: updates.length,
      newSerial,
      updates: updates.map((u) => ({ name: u.name, type: u.type, data: u.data })),
    });

    return createUpdateResponse(id, 0); // NOERROR
  } catch (error) {
    logger.error('Error handling DNS UPDATE', {
      clientIp,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
}

function parseDomainName(
  message: Buffer,
  offset: number,
  visited: Set<number> = new Set(),
  depth: number = 0,
): { name: string; newOffset: number } | null {
  const maxDepth = 10; // Maximum compression pointer depth
  const maxLabels = 128; // Maximum number of labels
  const maxDomainLength = 255; // RFC 1035: domain names max 255 bytes

  if (depth > maxDepth) {
    logger.warn('Compression pointer depth exceeded in DDNS parseDomainName', { depth, offset });
    return null;
  }

  const parts: string[] = [];
  let currentOffset = offset;
  let labelCount = 0;

  while (currentOffset < message.length && labelCount < maxLabels) {
    // Prevent compression pointer loops
    if (visited.has(currentOffset)) {
      logger.warn('Compression pointer loop detected in DDNS parseDomainName', {
        currentOffset,
        visited: Array.from(visited),
      });
      return null;
    }
    visited.add(currentOffset);

    // Validate we have at least 1 byte
    if (currentOffset >= message.length) {
      return null;
    }

    const length = message[currentOffset];
    if (length === 0) {
      currentOffset++;
      break;
    }

    // Compression pointer
    if ((length & 0xc0) === 0xc0) {
      // Validate we have 2 bytes for compression pointer
      if (currentOffset + 1 >= message.length) {
        return null;
      }
      const pointer = ((length & 0x3f) << 8) | message[currentOffset + 1];
      // Validate pointer is within message and points to valid location (after header)
      if (pointer >= message.length || pointer < 12) {
        logger.warn('Invalid compression pointer in DDNS parseDomainName', {
          currentOffset,
          pointer,
          messageLength: message.length,
        });
        return null;
      }
      // Prevent following compression pointer if we've already visited it
      if (visited.has(pointer)) {
        logger.warn('Compression pointer loop detected', { currentOffset, pointer });
        return null;
      }
      currentOffset += 2;
      // Recursively follow compression pointer
      const decompressed = parseDomainName(message, pointer, visited, depth + 1);
      if (!decompressed) return null;
      parts.push(...decompressed.name.split('.'));
      break;
    }

    // Validate label length (RFC 1035: labels max 63 bytes)
    if (length > 63) {
      logger.warn('Invalid label length in DDNS parseDomainName', { currentOffset, length });
      return null;
    }

    currentOffset++;
    // Validate we have enough bytes for this label
    if (currentOffset + length > message.length) {
      return null;
    }
    parts.push(message.toString('utf8', currentOffset, currentOffset + length));
    currentOffset += length;
    labelCount++;
  }

  const name = parts.join('.');
  // Validate total domain name length
  if (name.length > maxDomainLength) {
    logger.warn('Domain name exceeds maximum length in DDNS parseDomainName', { nameLength: name.length });
    return null;
  }

  return { name, newOffset: currentOffset };
}

function createUpdateResponse(id: number, rcode: number): Buffer {
  const response = Buffer.alloc(12);
  response.writeUInt16BE(id, 0);
  response.writeUInt16BE(0x8400 | (rcode & 0xf), 2); // QR=1, AA=1, RCODE
  response.writeUInt16BE(0, 4); // ZOCOUNT
  response.writeUInt16BE(0, 6); // PRCOUNT
  response.writeUInt16BE(0, 8); // UPCOUNT
  response.writeUInt16BE(0, 10); // ADCOUNT
  return response;
}
