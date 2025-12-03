import * as crypto from 'crypto';
import { logger } from './logger.js';

// DNSSEC record types
const _RRSIG = 46;
const _DNSKEY = 48;

interface DNSKEYRecord {
  flags: number;
  protocol: number;
  algorithm: number;
  publicKey: Buffer;
}

interface ZoneKey {
  id: number;
  zoneId: number;
  flags: number;
  algorithm: number;
  privateKey: string;
  publicKey: Buffer;
  keyTag: number;
  active: number;
}

interface ResourceRecord {
  name: string;
  type: number;
  ttl: number;
  data: Buffer;
}

/**
 * Generate a DNSKEY record from a zone key
 */
export function generateDNSKEYRecord(key: ZoneKey): Buffer {
  const buffer = Buffer.alloc(4 + key.publicKey.length);
  buffer.writeUInt16BE(key.flags, 0);
  buffer.writeUInt8(key.algorithm, 2);
  buffer.writeUInt8(3, 3); // Protocol is always 3
  key.publicKey.copy(buffer, 4);
  return buffer;
}

/**
 * Calculate DNSKEY key tag (RFC 4034)
 */
export function calculateKeyTag(dnskey: DNSKEYRecord): number {
  // Key tag calculation per RFC 4034
  const keyData = Buffer.concat([
    Buffer.from([(dnskey.flags >> 8) & 0xff, dnskey.flags & 0xff]),
    Buffer.from([dnskey.protocol]),
    Buffer.from([dnskey.algorithm]),
    dnskey.publicKey,
  ]);

  let ac = 0;
  for (let i = 0; i < keyData.length; i += 2) {
    if (i + 1 < keyData.length) {
      ac += (keyData[i] << 8) + keyData[i + 1];
    } else {
      ac += keyData[i] << 8;
    }
  }
  ac += (ac >> 16) & 0xffff;
  return ac & 0xffff;
}

/**
 * Build canonical RRset for signing (RFC 4034)
 */
function buildCanonicalRRset(records: ResourceRecord[], _response: Buffer): Buffer {
  // Sort records by type and data
  const sorted = [...records].sort((a, b) => {
    if (a.type !== b.type) return a.type - b.type;
    return Buffer.compare(a.data, b.data);
  });

  const parts: Buffer[] = [];
  for (const record of sorted) {
    // Canonical name (lowercase, no trailing dot)
    const name = record.name.toLowerCase().replace(/\.$/, '');
    const nameParts = name.split('.');
    const nameBuffer = Buffer.alloc(name.length + 2);
    let offset = 0;
    for (const part of nameParts) {
      nameBuffer[offset++] = part.length;
      Buffer.from(part).copy(nameBuffer, offset);
      offset += part.length;
    }
    nameBuffer[offset++] = 0;

    // Type (2 bytes)
    const typeBuffer = Buffer.alloc(2);
    typeBuffer.writeUInt16BE(record.type, 0);

    // Class (2 bytes, always IN = 1)
    const classBuffer = Buffer.alloc(2);
    classBuffer.writeUInt16BE(1, 0);

    // TTL (4 bytes)
    const ttlBuffer = Buffer.alloc(4);
    ttlBuffer.writeUInt32BE(record.ttl, 0);

    // RDLENGTH (2 bytes)
    const rdlengthBuffer = Buffer.alloc(2);
    rdlengthBuffer.writeUInt16BE(record.data.length, 0);

    // RDATA
    parts.push(nameBuffer.slice(0, offset), typeBuffer, classBuffer, ttlBuffer, rdlengthBuffer, record.data);
  }

  return Buffer.concat(parts);
}

/**
 * Build RRSIG data for signing (RFC 4034)
 */
function buildRRSIGData(rrsig: {
  typeCovered: number;
  algorithm: number;
  labels: number;
  originalTTL: number;
  expiration: number;
  inception: number;
  keyTag: number;
  signerName: string;
}): Buffer {
  const signerName = rrsig.signerName.toLowerCase().replace(/\.$/, '');
  const signerParts = signerName.split('.');
  const signerBuffer = Buffer.alloc(signerName.length + 2);
  let offset = 0;
  for (const part of signerParts) {
    signerBuffer[offset++] = part.length;
    Buffer.from(part).copy(signerBuffer, offset);
    offset += part.length;
  }
  signerBuffer[offset++] = 0;

  const buffer = Buffer.alloc(18 + signerBuffer.slice(0, offset).length);
  let pos = 0;
  buffer.writeUInt16BE(rrsig.typeCovered, pos);
  pos += 2;
  buffer.writeUInt8(rrsig.algorithm, pos);
  pos += 1;
  buffer.writeUInt8(rrsig.labels, pos);
  pos += 1;
  buffer.writeUInt32BE(rrsig.originalTTL, pos);
  pos += 4;
  buffer.writeUInt32BE(rrsig.expiration, pos);
  pos += 4;
  buffer.writeUInt32BE(rrsig.inception, pos);
  pos += 4;
  buffer.writeUInt16BE(rrsig.keyTag, pos);
  pos += 2;
  signerBuffer.slice(0, offset).copy(buffer, pos);

  return buffer;
}

/**
 * Sign a DNS record set with RRSIG
 */
export function signRRset(records: ResourceRecord[], zoneName: string, key: ZoneKey, originalTTL: number): Buffer | null {
  try {
    if (records.length === 0) {
      return null;
    }

    // Build canonical RRset
    const canonicalRRset = buildCanonicalRRset(records, Buffer.alloc(0));

    // Build RRSIG data
    const now = Math.floor(Date.now() / 1000);
    const inception = now - 3600; // 1 hour ago
    const expiration = now + 30 * 24 * 60 * 60; // 30 days from now

    const labels = zoneName.split('.').filter((p) => p.length > 0).length;
    const rrsigData = buildRRSIGData({
      typeCovered: records[0].type,
      algorithm: key.algorithm,
      labels,
      originalTTL,
      expiration,
      inception,
      keyTag: key.keyTag,
      signerName: zoneName,
    });

    // Sign the data
    const dataToSign = Buffer.concat([canonicalRRset, rrsigData]);
    let signature: Buffer;

    try {
      const privateKey = crypto.createPrivateKey({
        key: key.privateKey,
        format: 'pem',
      });

      // Sign based on algorithm
      if (key.algorithm === 13) {
        // Ed25519
        signature = crypto.sign(null, dataToSign, privateKey);
      } else if (key.algorithm === 15) {
        // Ed448
        signature = crypto.sign(null, dataToSign, privateKey);
      } else if (key.algorithm === 8) {
        // RSASHA256
        signature = crypto.sign('RSA-SHA256', dataToSign, privateKey);
      } else if (key.algorithm === 10) {
        // RSASHA512
        signature = crypto.sign('RSA-SHA512', dataToSign, privateKey);
      } else {
        logger.warn('Unsupported DNSSEC algorithm for signing', { algorithm: key.algorithm });
        return null;
      }
    } catch (error) {
      logger.error('Error creating private key for signing', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return null;
    }

    // Build RRSIG record
    const signerNameLower = zoneName.toLowerCase().replace(/\.$/, '');
    const signerNameLength = signerNameLower.length + 2; // +2 for null terminator and labels
    const rrsigBuffer = Buffer.alloc(18 + signerNameLength + signature.length);
    let pos = 0;
    rrsigBuffer.writeUInt16BE(records[0].type, pos);
    pos += 2;
    rrsigBuffer.writeUInt8(key.algorithm, pos);
    pos += 1;
    rrsigBuffer.writeUInt8(labels, pos);
    pos += 1;
    rrsigBuffer.writeUInt32BE(originalTTL, pos);
    pos += 4;
    rrsigBuffer.writeUInt32BE(expiration, pos);
    pos += 4;
    rrsigBuffer.writeUInt32BE(inception, pos);
    pos += 4;
    rrsigBuffer.writeUInt16BE(key.keyTag, pos);
    pos += 2;

    // Signer name
    const signerParts = signerNameLower.split('.');
    for (const part of signerParts) {
      rrsigBuffer[pos++] = part.length;
      Buffer.from(part).copy(rrsigBuffer, pos);
      pos += part.length;
    }
    rrsigBuffer[pos++] = 0;

    // Signature
    signature.copy(rrsigBuffer, pos);

    return rrsigBuffer;
  } catch (error) {
    logger.error('Error signing RRset', {
      error: error instanceof Error ? error : new Error(String(error)),
      zoneName,
    });
    return null;
  }
}

/**
 * Generate a new DNSSEC key pair
 */
export function generateZoneKey(algorithm: number = 13): { privateKey: string; publicKey: Buffer; keyTag: number } | null {
  try {
    let keyPair: crypto.KeyPairKeyObjectResult;
    let publicKeyBuffer: Buffer;

    if (algorithm === 13) {
      // Ed25519
      keyPair = crypto.generateKeyPairSync('ed25519');
      // Ed25519 public key is 32 bytes - export as DER/SPKI and extract the key bytes
      const derPublicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' });
      // For Ed25519, the public key in DNSKEY is just the 32-byte raw key
      // The SPKI format has a header, so we need to extract just the key bytes
      // Ed25519 SPKI: 30 2a 30 05 06 03 2b 65 70 03 21 00 [32 bytes of key]
      const publicKeyBytes = Buffer.from(derPublicKey.slice(-32));
      const dnskey: DNSKEYRecord = {
        flags: 256, // ZSK
        protocol: 3,
        algorithm: 13,
        publicKey: publicKeyBytes,
      };
      const keyTag = calculateKeyTag(dnskey);
      const privateKeyPem = keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' });
      return {
        privateKey: typeof privateKeyPem === 'string' ? privateKeyPem : privateKeyPem.toString('utf8'),
        publicKey: publicKeyBytes,
        keyTag,
      };
    } else if (algorithm === 8) {
      // RSASHA256 (2048-bit key)
      keyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });
      publicKeyBuffer = keyPair.publicKey.export({ format: 'der', type: 'spki' });
      // Extract public key from DER format (simplified)
      const dnskey: DNSKEYRecord = {
        flags: 256,
        protocol: 3,
        algorithm: 8,
        publicKey: publicKeyBuffer,
      };
      const keyTag = calculateKeyTag(dnskey);
      return {
        privateKey: keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
        publicKey: publicKeyBuffer,
        keyTag,
      };
    } else {
      logger.warn('Unsupported DNSSEC algorithm for key generation', { algorithm });
      return null;
    }
  } catch (error) {
    logger.error('Error generating zone key', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return null;
  }
}
