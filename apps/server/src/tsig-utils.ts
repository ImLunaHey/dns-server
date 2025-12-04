import * as crypto from 'crypto';
import { logger } from './logger.js';
import { dbTSIGKeys, dbZoneTransferACLs } from './db.js';

// TSIG record type
const TSIG_TYPE = 250;

export interface TSIGRecord {
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
export function parseTSIG(message: Buffer, offset: number): TSIGRecord | null {
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
    const mac = message.slice(algOffset, algOffset + macSize);
    algOffset += macSize;

    if (algOffset + 6 > message.length) return null;
    const originalID = message.readUInt16BE(algOffset);
    const error = message.readUInt16BE(algOffset + 2);
    const otherLen = message.readUInt16BE(algOffset + 4);
    algOffset += 6;

    const otherData =
      otherLen > 0 && algOffset + otherLen <= message.length
        ? message.slice(algOffset, algOffset + otherLen)
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
 * Find TSIG record in DNS message
 * TSIG is typically in the additional section
 */
export function findTSIG(message: Buffer): TSIGRecord | null {
  if (message.length < 12) return null;

  // Get additional section count
  const arCount = message.readUInt16BE(10);
  if (arCount === 0) return null;

  // Parse question section to find where additional section starts
  let offset = 12;
  const qdCount = message.readUInt16BE(4);

  // Skip question section
  for (let i = 0; i < qdCount && offset < message.length; i++) {
    while (offset < message.length && message[offset] !== 0) {
      const length = message[offset];
      if ((length & 0xc0) === 0xc0) {
        offset += 2;
        break;
      }
      offset += length + 1;
    }
    if (offset + 4 > message.length) return null;
    offset += 5; // Skip null terminator and QTYPE/QCLASS
  }

  // Skip answer section
  const anCount = message.readUInt16BE(6);
  for (let i = 0; i < anCount && offset < message.length; i++) {
    // Skip name
    while (offset < message.length && message[offset] !== 0) {
      const length = message[offset];
      if ((length & 0xc0) === 0xc0) {
        offset += 2;
        break;
      }
      offset += length + 1;
    }
    if (offset + 10 > message.length) return null;
    const dataLength = message.readUInt16BE(offset + 8);
    offset += 10 + dataLength;
  }

  // Skip authority section
  const nsCount = message.readUInt16BE(8);
  for (let i = 0; i < nsCount && offset < message.length; i++) {
    // Skip name
    while (offset < message.length && message[offset] !== 0) {
      const length = message[offset];
      if ((length & 0xc0) === 0xc0) {
        offset += 2;
        break;
      }
      offset += length + 1;
    }
    if (offset + 10 > message.length) return null;
    const dataLength = message.readUInt16BE(offset + 8);
    offset += 10 + dataLength;
  }

  // Now we're in the additional section - look for TSIG
  for (let i = 0; i < arCount && offset < message.length; i++) {
    const nameStart = offset;
    // Check if this is TSIG (root domain = 0)
    if (message[offset] === 0) {
      offset++;
      if (offset + 2 > message.length) break;
      const type = message.readUInt16BE(offset);
      if (type === TSIG_TYPE) {
        return parseTSIG(message, nameStart);
      }
    }

    // Skip this record
    while (offset < message.length && message[offset] !== 0) {
      const length = message[offset];
      if ((length & 0xc0) === 0xc0) {
        offset += 2;
        break;
      }
      offset += length + 1;
    }
    if (offset + 10 > message.length) break;
    const dataLength = message.readUInt16BE(offset + 8);
    offset += 10 + dataLength;
  }

  return null;
}

/**
 * Verify TSIG signature
 */
export function verifyTSIG(message: Buffer, tsig: TSIGRecord, secret: string): boolean {
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
    const messageBeforeTSIG = message.slice(0, tsigOffset);

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
    const messageToSign = Buffer.concat([messageBeforeTSIG, tsigData.slice(0, pos)]);

    // Verify HMAC based on algorithm
    let expectedMAC: Buffer;
    if (tsig.algorithm === 'hmac-sha256' || tsig.algorithm === 'hmac-sha256.') {
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(messageToSign);
      expectedMAC = hmac.digest();
    } else if (tsig.algorithm === 'hmac-sha1' || tsig.algorithm === 'hmac-sha1.') {
      const hmac = crypto.createHmac('sha1', secret);
      hmac.update(messageToSign);
      expectedMAC = hmac.digest();
    } else if (tsig.algorithm === 'hmac-md5' || tsig.algorithm === 'hmac-md5.') {
      const hmac = crypto.createHmac('md5', secret);
      hmac.update(messageToSign);
      expectedMAC = hmac.digest();
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
 * Authenticate zone transfer request
 * Returns true if authenticated, false otherwise
 */
export function authenticateZoneTransfer(
  message: Buffer,
  clientIp: string,
  zoneId: number,
): { authenticated: boolean; method?: 'tsig' | 'ip'; reason?: string } {
  // First check TSIG authentication
  const tsig = findTSIG(message);
  if (tsig) {
    const tsigKey = dbTSIGKeys.getByName(tsig.name);
    if (!tsigKey) {
      logger.warn('Zone transfer TSIG authentication failed: unknown key', {
        zoneId,
        clientIp,
        tsigName: tsig.name,
      });
      return { authenticated: false, reason: 'Unknown TSIG key' };
    }

    if (!verifyTSIG(message, tsig, tsigKey.secret)) {
      logger.warn('Zone transfer TSIG authentication failed: invalid signature', {
        zoneId,
        clientIp,
        tsigName: tsig.name,
      });
      return { authenticated: false, reason: 'Invalid TSIG signature' };
    }

    logger.info('Zone transfer authenticated via TSIG', {
      zoneId,
      clientIp,
      tsigName: tsig.name,
    });
    return { authenticated: true, method: 'tsig' };
  }

  // Fall back to IP-based ACL
  if (dbZoneTransferACLs.isAllowed(zoneId, clientIp)) {
    logger.info('Zone transfer authenticated via IP ACL', {
      zoneId,
      clientIp,
    });
    return { authenticated: true, method: 'ip' };
  }

  // Check if ACLs are configured for this zone
  if (dbZoneTransferACLs.hasAnyACL(zoneId)) {
    logger.warn('Zone transfer denied: IP not in ACL', {
      zoneId,
      clientIp,
    });
    return { authenticated: false, reason: 'IP not in zone transfer ACL' };
  }

  // No ACLs configured - deny by default in production
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    logger.warn('Zone transfer denied: no authentication and no ACL configured', {
      zoneId,
      clientIp,
    });
    return { authenticated: false, reason: 'Zone transfer authentication required' };
  }

  // Allow in development if no ACLs are configured (for testing)
  logger.warn('Zone transfer allowed in development mode without authentication', {
    zoneId,
    clientIp,
  });
  return { authenticated: true, method: 'ip' };
}
