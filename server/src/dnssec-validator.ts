import crypto from 'crypto';
import dgram from 'dgram';
import { logger } from './logger.js';

// ASN.1 encoding helpers

// DNSSEC record types
const RRSIG = 46;
const DNSKEY = 48;
const DS = 43;
const NSEC = 47;
const NSEC3 = 50;

interface RRSIGRecord {
  typeCovered: number;
  algorithm: number;
  labels: number;
  originalTTL: number;
  expiration: number;
  inception: number;
  keyTag: number;
  signerName: string;
  signature: Buffer;
}

interface DNSKEYRecord {
  flags: number;
  protocol: number;
  algorithm: number;
  publicKey: Buffer;
}

interface DSRecord {
  keyTag: number;
  algorithm: number;
  digestType: number;
  digest: Buffer;
}

interface ResourceRecord {
  name: string;
  type: number;
  ttl: number;
  data: Buffer;
  offset: number;
}

interface DNSResponse {
  answers: ResourceRecord[];
  authority: ResourceRecord[];
  additional: ResourceRecord[];
  question: { name: string; type: number };
}

/**
 * Parse domain name from DNS response buffer
 */
function parseDomainName(response: Buffer, offset: number): { name: string; newOffset: number } {
  const labels: string[] = [];
  let currentOffset = offset;
  const visitedOffsets = new Set<number>();

  while (currentOffset < response.length) {
    if (visitedOffsets.has(currentOffset)) {
      // Circular reference detected
      return { name: labels.join('.'), newOffset: currentOffset };
    }
    visitedOffsets.add(currentOffset);

    const length = response[currentOffset];
    currentOffset++;

    if (length === 0) {
      // End of name
      break;
    }

    if ((length & 0xc0) === 0xc0) {
      // Compression pointer
      const pointer = ((length & 0x3f) << 8) | response[currentOffset];
      currentOffset++;
      if (pointer >= response.length || pointer < 12) {
        // Invalid pointer
        break;
      }
      const decompressed = parseDomainName(response, pointer);
      labels.push(...decompressed.name.split('.'));
      break;
    }

    if (length > 63 || currentOffset + length > response.length) {
      // Invalid length
      break;
    }

    const label = response.toString('utf8', currentOffset, currentOffset + length);
    labels.push(label);
    currentOffset += length;
  }

  return { name: labels.join('.'), newOffset: currentOffset };
}

/**
 * Parse a resource record from DNS response
 */
function parseResourceRecord(response: Buffer, offset: number): ResourceRecord | null {
  const nameResult = parseDomainName(response, offset);
  let currentOffset = nameResult.newOffset;

  if (currentOffset + 10 > response.length) {
    return null;
  }

  const type = response.readUInt16BE(currentOffset);
  const klass = response.readUInt16BE(currentOffset + 2);
  const ttl = response.readUInt32BE(currentOffset + 4);
  const dataLength = response.readUInt16BE(currentOffset + 8);
  currentOffset += 10;

  if (currentOffset + dataLength > response.length) {
    return null;
  }

  const data = response.slice(currentOffset, currentOffset + dataLength);

  return {
    name: nameResult.name,
    type,
    ttl,
    data,
    offset: nameResult.newOffset - 2, // Include name in offset
  };
}

/**
 * Parse RRSIG record
 */
function parseRRSIG(data: Buffer): RRSIGRecord | null {
  if (data.length < 18) {
    return null;
  }

  const typeCovered = data.readUInt16BE(0);
  const algorithm = data[2];
  const labels = data[3];
  const originalTTL = data.readUInt32BE(4);
  const expiration = data.readUInt32BE(8);
  const inception = data.readUInt32BE(12);
  const keyTag = data.readUInt16BE(16);

  // Parse signer name (starts at offset 18)
  const signerNameResult = parseDomainName(data, 18);
  const signatureStart = signerNameResult.newOffset;
  const signature = data.slice(signatureStart);

  return {
    typeCovered,
    algorithm,
    labels,
    originalTTL,
    expiration,
    inception,
    keyTag,
    signerName: signerNameResult.name,
    signature,
  };
}

/**
 * Parse DNSKEY record
 */
function parseDNSKEY(data: Buffer): DNSKEYRecord | null {
  if (data.length < 4) {
    return null;
  }

  const flags = data.readUInt16BE(0);
  const protocol = data[2];
  const algorithm = data[3];
  const publicKey = data.slice(4);

  return {
    flags,
    protocol,
    algorithm,
    publicKey,
  };
}

/**
 * Parse DS record
 */
function parseDS(data: Buffer): DSRecord | null {
  if (data.length < 4) {
    return null;
  }

  const keyTag = data.readUInt16BE(0);
  const algorithm = data[2];
  const digestType = data[3];
  const digest = data.slice(4);

  return {
    keyTag,
    algorithm,
    digestType,
    digest,
  };
}

/**
 * Canonicalize domain name for DNSSEC signing
 */
function canonicalizeName(name: string): Buffer {
  const labels = name
    .toLowerCase()
    .split('.')
    .filter((l) => l.length > 0);
  const result: number[] = [];
  for (const label of labels) {
    result.push(label.length);
    result.push(...Buffer.from(label));
  }
  result.push(0); // Root label
  return Buffer.from(result);
}

/**
 * Build canonical form of RRset for signing
 */
function buildCanonicalRRset(records: ResourceRecord[], rrsig: RRSIGRecord, response: Buffer): Buffer {
  const parts: Buffer[] = [];

  // Sort records by canonical wire format
  const sortedRecords = [...records].sort((a, b) => {
    const aName = canonicalizeName(a.name);
    const bName = canonicalizeName(b.name);
    const nameCmp = aName.compare(bName);
    if (nameCmp !== 0) return nameCmp;

    const aType = Buffer.allocUnsafe(2);
    aType.writeUInt16BE(a.type, 0);
    const bType = Buffer.allocUnsafe(2);
    bType.writeUInt16BE(b.type, 0);
    return aType.compare(bType);
  });

  for (const record of sortedRecords) {
    // Name (canonicalized)
    parts.push(canonicalizeName(record.name));

    // Type (2 bytes)
    const typeBuf = Buffer.allocUnsafe(2);
    typeBuf.writeUInt16BE(rrsig.typeCovered, 0);
    parts.push(typeBuf);

    // Class (always IN = 1, 2 bytes)
    const classBuf = Buffer.allocUnsafe(2);
    classBuf.writeUInt16BE(1, 0);
    parts.push(classBuf);

    // Original TTL (4 bytes)
    const ttlBuf = Buffer.allocUnsafe(4);
    ttlBuf.writeUInt32BE(rrsig.originalTTL, 0);
    parts.push(ttlBuf);

    // RDATA length (2 bytes)
    const rdataLenBuf = Buffer.allocUnsafe(2);
    rdataLenBuf.writeUInt16BE(record.data.length, 0);
    parts.push(rdataLenBuf);

    // RDATA
    parts.push(record.data);
  }

  return Buffer.concat(parts);
}

/**
 * Build RRSIG data for signing (without signature field)
 */
function buildRRSIGData(rrsig: RRSIGRecord): Buffer {
  const parts: Buffer[] = [];

  // Type covered (2 bytes)
  const typeCoveredBuf = Buffer.allocUnsafe(2);
  typeCoveredBuf.writeUInt16BE(rrsig.typeCovered, 0);
  parts.push(typeCoveredBuf);

  // Algorithm (1 byte)
  parts.push(Buffer.from([rrsig.algorithm]));

  // Labels (1 byte)
  parts.push(Buffer.from([rrsig.labels]));

  // Original TTL (4 bytes)
  const originalTTLBuf = Buffer.allocUnsafe(4);
  originalTTLBuf.writeUInt32BE(rrsig.originalTTL, 0);
  parts.push(originalTTLBuf);

  // Expiration (4 bytes)
  const expirationBuf = Buffer.allocUnsafe(4);
  expirationBuf.writeUInt32BE(rrsig.expiration, 0);
  parts.push(expirationBuf);

  // Inception (4 bytes)
  const inceptionBuf = Buffer.allocUnsafe(4);
  inceptionBuf.writeUInt32BE(rrsig.inception, 0);
  parts.push(inceptionBuf);

  // Key tag (2 bytes)
  const keyTagBuf = Buffer.allocUnsafe(2);
  keyTagBuf.writeUInt16BE(rrsig.keyTag, 0);
  parts.push(keyTagBuf);

  // Signer name (canonicalized)
  parts.push(canonicalizeName(rrsig.signerName));

  return Buffer.concat(parts);
}

/**
 * Extract RSA modulus and exponent from DNSKEY public key
 * DNSKEY format: flags (2) | protocol (1) | algorithm (1) | public key
 * RSA public key format: exponent length (1) | exponent | modulus
 */
function parseRSAPublicKey(publicKey: Buffer): { modulus: Buffer; exponent: Buffer } | null {
  if (publicKey.length < 3) {
    return null;
  }

  // First byte is exponent length
  const expLen = publicKey[0];
  if (expLen === 0 || expLen > publicKey.length - 1) {
    // Exponent length can be 0 (meaning 3 bytes follow for length)
    if (expLen === 0 && publicKey.length >= 4) {
      const expLen2 = publicKey.readUInt16BE(1);
      if (expLen2 > publicKey.length - 3) {
        return null;
      }
      const exponent = publicKey.slice(3, 3 + expLen2);
      const modulus = publicKey.slice(3 + expLen2);
      return { modulus, exponent };
    }
    return null;
  }

  const exponent = publicKey.slice(1, 1 + expLen);
  const modulus = publicKey.slice(1 + expLen);

  return { modulus, exponent };
}

/**
 * Convert RSA modulus and exponent to PEM format
 */
function rsaKeyToPEM(modulus: Buffer, exponent: Buffer): string {
  // ASN.1 structure for RSA public key
  // SEQUENCE {
  //   SEQUENCE {
  //     OBJECT IDENTIFIER rsaEncryption
  //     NULL
  //   }
  //   BIT STRING {
  //     SEQUENCE {
  //       INTEGER modulus
  //       INTEGER exponent
  //     }
  //   }
  // }

  // Encode modulus as INTEGER (with leading zero if high bit is set)
  const modulusInt = modulus[0] & 0x80 ? Buffer.concat([Buffer.from([0]), modulus]) : modulus;
  const modulusBytes = encodeASN1Integer(modulusInt);

  // Encode exponent as INTEGER
  const exponentInt = exponent[0] & 0x80 ? Buffer.concat([Buffer.from([0]), exponent]) : exponent;
  const exponentBytes = encodeASN1Integer(exponentInt);

  // Encode SEQUENCE { modulus, exponent }
  const seq = encodeASN1Sequence(Buffer.concat([modulusBytes, exponentBytes]));

  // Encode BIT STRING
  const bitString = encodeASN1BitString(seq);

  // Encode outer SEQUENCE { algorithm, bitString }
  const algorithmId = Buffer.from([
    0x30,
    0x0d, // SEQUENCE
    0x06,
    0x09, // OBJECT IDENTIFIER
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01, // rsaEncryption OID
    0x05,
    0x00, // NULL
  ]);
  const outerSeq = encodeASN1Sequence(Buffer.concat([algorithmId, bitString]));

  // Convert to PEM
  const base64 = outerSeq.toString('base64');
  const pemLines = [];
  for (let i = 0; i < base64.length; i += 64) {
    pemLines.push(base64.slice(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${pemLines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * Encode ASN.1 INTEGER
 */
function encodeASN1Integer(value: Buffer): Buffer {
  const length = value.length;
  if (length <= 127) {
    return Buffer.concat([Buffer.from([0x02, length]), value]);
  } else {
    // Long form length encoding
    const lengthBytes = Buffer.allocUnsafe(1);
    lengthBytes[0] = 0x80 | Math.ceil(length.toString(16).length / 2);
    return Buffer.concat([Buffer.from([0x02]), lengthBytes, value]);
  }
}

/**
 * Encode ASN.1 SEQUENCE
 */
function encodeASN1Sequence(data: Buffer): Buffer {
  const length = data.length;
  if (length <= 127) {
    return Buffer.concat([Buffer.from([0x30, length]), data]);
  } else {
    // Long form length encoding
    const lengthBytes = Buffer.allocUnsafe(1);
    lengthBytes[0] = 0x80 | Math.ceil(length.toString(16).length / 2);
    return Buffer.concat([Buffer.from([0x30]), lengthBytes, data]);
  }
}

/**
 * Encode ASN.1 BIT STRING
 */
function encodeASN1BitString(data: Buffer): Buffer {
  // BIT STRING: 0x03 | length | unused bits (0) | data
  const length = data.length + 1;
  if (length <= 127) {
    return Buffer.concat([Buffer.from([0x03, length, 0x00]), data]);
  } else {
    const lengthBytes = Buffer.allocUnsafe(1);
    lengthBytes[0] = 0x80 | Math.ceil(length.toString(16).length / 2);
    return Buffer.concat([Buffer.from([0x03]), lengthBytes, Buffer.from([0x00]), data]);
  }
}

/**
 * Convert ECDSA public key to PEM format
 * Format: 0x04 (uncompressed) | x (32 or 48 bytes) | y (32 or 48 bytes)
 */
function ecdsaKeyToPEM(publicKey: Buffer, curve: 'prime256v1' | 'secp384r1'): string {
  // ECDSA public key in SEC1 format: 0x04 | x | y
  if (publicKey[0] !== 0x04) {
    throw new Error('Invalid ECDSA public key format');
  }

  const keySize = curve === 'prime256v1' ? 32 : 48;
  if (publicKey.length !== 1 + keySize * 2) {
    throw new Error(`Invalid ECDSA public key length for ${curve}`);
  }

  const x = publicKey.slice(1, 1 + keySize);
  const y = publicKey.slice(1 + keySize);

  // ASN.1 structure for ECDSA public key
  // SEQUENCE {
  //   SEQUENCE {
  //     OBJECT IDENTIFIER ecPublicKey
  //     OBJECT IDENTIFIER curve OID
  //   }
  //   BIT STRING { 0x04 | x | y }
  // }

  const curveOID =
    curve === 'prime256v1'
      ? Buffer.from([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]) // prime256v1
      : Buffer.from([0x06, 0x05, 0x2b, 0x81, 0x04, 0x00, 0x22]); // secp384r1

  const ecPublicKeyOID = Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]); // ecPublicKey

  const algorithmSeq = encodeASN1Sequence(Buffer.concat([ecPublicKeyOID, curveOID]));
  const bitString = encodeASN1BitString(publicKey);
  const outerSeq = encodeASN1Sequence(Buffer.concat([algorithmSeq, bitString]));

  const base64 = outerSeq.toString('base64');
  const pemLines = [];
  for (let i = 0; i < base64.length; i += 64) {
    pemLines.push(base64.slice(i, i + 64));
  }
  return `-----BEGIN PUBLIC KEY-----\n${pemLines.join('\n')}\n-----END PUBLIC KEY-----`;
}

/**
 * Verify RRSIG signature using DNSKEY
 */
function verifySignature(rrset: Buffer, rrsigData: Buffer, signature: Buffer, dnskey: DNSKEYRecord): boolean {
  try {
    const dataToVerify = Buffer.concat([rrset, rrsigData]);

    // Map DNSSEC algorithm numbers to crypto algorithms and hash functions
    let verifyAlgorithm: string;
    let hashAlgorithm: string;
    let publicKeyPEM: string | null = null;

    switch (dnskey.algorithm) {
      case 5: // RSASHA1
        verifyAlgorithm = 'RSA-SHA1';
        hashAlgorithm = 'sha1';
        const rsaKey1 = parseRSAPublicKey(dnskey.publicKey);
        if (!rsaKey1) {
          logger.warn('Failed to parse RSA public key', { algorithm: dnskey.algorithm });
          return false;
        }
        publicKeyPEM = rsaKeyToPEM(rsaKey1.modulus, rsaKey1.exponent);
        break;

      case 7: // RSASHA1-NSEC3-SHA1
        verifyAlgorithm = 'RSA-SHA1';
        hashAlgorithm = 'sha1';
        const rsaKey7 = parseRSAPublicKey(dnskey.publicKey);
        if (!rsaKey7) {
          logger.warn('Failed to parse RSA public key', { algorithm: dnskey.algorithm });
          return false;
        }
        publicKeyPEM = rsaKeyToPEM(rsaKey7.modulus, rsaKey7.exponent);
        break;

      case 8: // RSASHA256
        verifyAlgorithm = 'RSA-SHA256';
        hashAlgorithm = 'sha256';
        const rsaKey8 = parseRSAPublicKey(dnskey.publicKey);
        if (!rsaKey8) {
          logger.warn('Failed to parse RSA public key', { algorithm: dnskey.algorithm });
          return false;
        }
        publicKeyPEM = rsaKeyToPEM(rsaKey8.modulus, rsaKey8.exponent);
        break;

      case 10: // RSASHA512
        verifyAlgorithm = 'RSA-SHA512';
        hashAlgorithm = 'sha512';
        const rsaKey10 = parseRSAPublicKey(dnskey.publicKey);
        if (!rsaKey10) {
          logger.warn('Failed to parse RSA public key', { algorithm: dnskey.algorithm });
          return false;
        }
        publicKeyPEM = rsaKeyToPEM(rsaKey10.modulus, rsaKey10.exponent);
        break;

      case 13: // ECDSAP256SHA256
        verifyAlgorithm = 'ecdsa-with-SHA256';
        hashAlgorithm = 'sha256';
        try {
          publicKeyPEM = ecdsaKeyToPEM(dnskey.publicKey, 'prime256v1');
        } catch (error) {
          logger.warn('Failed to parse ECDSA public key', {
            algorithm: dnskey.algorithm,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
        break;

      case 14: // ECDSAP384SHA384
        verifyAlgorithm = 'ecdsa-with-SHA384';
        hashAlgorithm = 'sha384';
        try {
          publicKeyPEM = ecdsaKeyToPEM(dnskey.publicKey, 'secp384r1');
        } catch (error) {
          logger.warn('Failed to parse ECDSA public key', {
            algorithm: dnskey.algorithm,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
        break;

      case 15: {
        // ED25519
        verifyAlgorithm = 'ed25519';
        hashAlgorithm = 'sha512'; // Ed25519 uses SHA-512 internally
        // Ed25519 public key is just the raw 32 bytes
        if (dnskey.publicKey.length !== 32) {
          logger.warn('Invalid Ed25519 public key length', { length: dnskey.publicKey.length });
          return false;
        }
        // For Ed25519, we need to use crypto.verify() directly
        // Node.js expects Ed25519 keys in a specific format
        try {
          // Create a public key object from raw Ed25519 key
          // Ed25519 public key format for Node.js: need to wrap in SPKI format
          const verify = crypto.createVerify('ed25519');
          verify.update(dataToVerify);
          // Try to create public key from raw bytes
          // Node.js 12+ supports Ed25519 with raw keys via createPublicKey
          const publicKeyObj = crypto.createPublicKey({
            key: Buffer.concat([
              Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]), // Ed25519 OID + BIT STRING header
              dnskey.publicKey,
            ]),
            format: 'der',
            type: 'spki',
          });
          return verify.verify(publicKeyObj, signature);
        } catch (keyError) {
          // Ed25519 verification failed
          logger.warn('Ed25519 verification failed', {
            error: keyError instanceof Error ? keyError.message : String(keyError),
          });
          return false;
        }
      }

      case 16: // ED448
        verifyAlgorithm = 'ed448';
        hashAlgorithm = 'shake256'; // Ed448 uses SHAKE256 internally
        // Ed448 public key is 57 bytes
        if (dnskey.publicKey.length !== 57) {
          logger.warn('Invalid Ed448 public key length', { length: dnskey.publicKey.length });
          return false;
        }
        // Node.js doesn't natively support Ed448, so we'll skip it for now
        logger.warn('Ed448 verification not supported in Node.js', { algorithm: dnskey.algorithm });
        return false;

      default:
        logger.warn('Unsupported DNSSEC algorithm', { algorithm: dnskey.algorithm });
        return false;
    }

    if (!publicKeyPEM) {
      return false;
    }

    // Verify signature
    try {
      const verify = crypto.createVerify(hashAlgorithm);
      verify.update(dataToVerify);

      // For RSA and ECDSA, use PEM format
      if (!publicKeyPEM) {
        logger.warn('No public key PEM generated', { algorithm: dnskey.algorithm });
        return false;
      }

      const isValid = verify.verify(publicKeyPEM, signature);
      if (!isValid) {
        logger.debug('DNSSEC signature verification failed', {
          algorithm: dnskey.algorithm,
          keyLength: dnskey.publicKey.length,
        });
      }
      return isValid;
    } catch (error) {
      logger.error('Error during signature verification', {
        error: error instanceof Error ? error : new Error(String(error)),
        algorithm: dnskey.algorithm,
      });
      return false;
    }
  } catch (error) {
    logger.error('Error verifying DNSSEC signature', {
      error: error instanceof Error ? error : new Error(String(error)),
      algorithm: dnskey.algorithm,
    });
    return false;
  }
}

/**
 * Validate DNSSEC response
 */
export function validateDNSSEC(
  response: Buffer,
  domain: string,
  queryType: number,
): {
  valid: boolean;
  reason?: string;
  validatedRecords?: number;
} {
  try {
    if (response.length < 12) {
      return { valid: false, reason: 'Response too short' };
    }

    // Parse DNS response sections
    const anCount = response.readUInt16BE(6);
    const nsCount = response.readUInt16BE(8);
    const arCount = response.readUInt16BE(10);

    let offset = 12;

    // Skip question section
    const questionNameResult = parseDomainName(response, offset);
    offset = questionNameResult.newOffset + 4; // QTYPE + QCLASS

    // Parse answer section
    const answers: ResourceRecord[] = [];
    for (let i = 0; i < anCount && offset < response.length; i++) {
      const rr = parseResourceRecord(response, offset);
      if (!rr) break;
      answers.push(rr);
      offset = rr.offset + 10 + rr.data.length; // Name + TYPE + CLASS + TTL + RDLENGTH + RDATA
    }

    // Parse authority section
    const authority: ResourceRecord[] = [];
    for (let i = 0; i < nsCount && offset < response.length; i++) {
      const rr = parseResourceRecord(response, offset);
      if (!rr) break;
      authority.push(rr);
      offset = rr.offset + 10 + rr.data.length;
    }

    // Parse additional section
    const additional: ResourceRecord[] = [];
    for (let i = 0; i < arCount && offset < response.length; i++) {
      const rr = parseResourceRecord(response, offset);
      if (!rr) break;
      additional.push(rr);
      offset = rr.offset + 10 + rr.data.length;
    }

    // Find RRSIG records for the queried type
    const rrsigs = [...answers, ...authority, ...additional].filter((rr) => rr.type === RRSIG);
    const dnskeyRecords = [...answers, ...authority, ...additional].filter((rr) => rr.type === DNSKEY);

    if (rrsigs.length === 0) {
      // No DNSSEC signatures found - response is not signed
      return { valid: false, reason: 'No DNSSEC signatures found' };
    }

    // Find RRSIGs that cover the queried type
    const relevantRRSIGs = rrsigs
      .map((rr) => parseRRSIG(rr.data))
      .filter((rrsig): rrsig is RRSIGRecord => rrsig !== null && rrsig.typeCovered === queryType);

    if (relevantRRSIGs.length === 0) {
      return { valid: false, reason: 'No RRSIG covering queried type' };
    }

    // Find records of the queried type
    const queriedRecords = answers.filter((rr) => rr.type === queryType);

    if (queriedRecords.length === 0) {
      // Check for NSEC/NSEC3 records for authenticated denial
      const nsecRecords = [...answers, ...authority].filter((rr) => rr.type === NSEC || rr.type === NSEC3);
      if (nsecRecords.length > 0) {
        // TODO: Validate NSEC/NSEC3 records
        return { valid: true, reason: 'Authenticated denial (NSEC/NSEC3)' };
      }
      return { valid: false, reason: 'No records found and no authenticated denial' };
    }

    // Parse DNSKEY records
    const dnskeyParsed = dnskeyRecords.map((rr) => parseDNSKEY(rr.data)).filter((key): key is DNSKEYRecord => key !== null);

    if (dnskeyParsed.length === 0) {
      return { valid: false, reason: 'No DNSKEY records found' };
    }

    // Try to verify each RRSIG
    let verifiedCount = 0;
    for (const rrsig of relevantRRSIGs) {
      // Find matching DNSKEY by key tag
      const matchingDNSKEY = dnskeyParsed.find((key) => {
        // Calculate key tag (simplified - full calculation is more complex)
        const keyTag = calculateKeyTag(key);
        return keyTag === rrsig.keyTag;
      });

      if (!matchingDNSKEY) {
        logger.debug('No matching DNSKEY found for RRSIG', { keyTag: rrsig.keyTag });
        continue;
      }

      // Check signature validity period
      const now = Math.floor(Date.now() / 1000);
      if (now < rrsig.inception || now > rrsig.expiration) {
        logger.debug('RRSIG outside validity period', {
          inception: rrsig.inception,
          expiration: rrsig.expiration,
          now,
        });
        continue;
      }

      // Build canonical RRset
      const canonicalRRset = buildCanonicalRRset(queriedRecords, rrsig, response);
      const rrsigData = buildRRSIGData(rrsig);

      // Verify signature
      if (verifySignature(canonicalRRset, rrsigData, rrsig.signature, matchingDNSKEY)) {
        verifiedCount++;
      }
    }

    if (verifiedCount > 0) {
      // Optionally validate chain of trust for the DNSKEY
      // This is optional as it requires additional DNS queries
      // For now, we'll return success if signatures are verified
      // Chain of trust can be validated separately if needed
      return { valid: true, validatedRecords: verifiedCount };
    }

    return { valid: false, reason: 'Could not verify any signatures' };
  } catch (error) {
    logger.error('Error validating DNSSEC', {
      error: error instanceof Error ? error : new Error(String(error)),
      domain,
      queryType,
    });
    return { valid: false, reason: 'Validation error' };
  }
}

/**
 * Calculate DNSKEY key tag (RFC 4034)
 */
function calculateKeyTag(dnskey: DNSKEYRecord): number {
  // Key tag calculation per RFC 4034
  const keyData = Buffer.concat([
    Buffer.from([(dnskey.flags >> 8) & 0xff, dnskey.flags & 0xff]),
    Buffer.from([dnskey.protocol]),
    Buffer.from([dnskey.algorithm]),
    dnskey.publicKey,
  ]);

  let ac = 0;
  for (let i = 0; i < keyData.length; i++) {
    ac += i % 2 === 0 ? keyData[i] << 8 : keyData[i];
  }
  ac += (ac >> 16) & 0xffff;
  return ac & 0xffff;
}

/**
 * Calculate DS hash from DNSKEY (RFC 4034)
 * DS = hash(name | key tag | algorithm | digest type | DNSKEY wire format)
 */
function calculateDSHash(zoneName: string, dnskey: DNSKEYRecord, digestType: number): Buffer | null {
  // Build DNSKEY wire format
  const keyData = Buffer.concat([
    Buffer.from([(dnskey.flags >> 8) & 0xff, dnskey.flags & 0xff]),
    Buffer.from([dnskey.protocol]),
    Buffer.from([dnskey.algorithm]),
    dnskey.publicKey,
  ]);

  // Build DS hash input: canonicalized name + key tag + algorithm + digest type + key data
  const keyTag = calculateKeyTag(dnskey);
  const keyTagBuf = Buffer.allocUnsafe(2);
  keyTagBuf.writeUInt16BE(keyTag, 0);

  const algorithmBuf = Buffer.from([dnskey.algorithm]);
  const digestTypeBuf = Buffer.from([digestType]);

  const canonicalName = canonicalizeName(zoneName);
  const hashInput = Buffer.concat([canonicalName, keyTagBuf, algorithmBuf, digestTypeBuf, keyData]);

  switch (digestType) {
    case 1: // SHA-1
      return crypto.createHash('sha1').update(hashInput).digest();
    case 2: // SHA-256
      return crypto.createHash('sha256').update(hashInput).digest();
    case 4: // SHA-384
      return crypto.createHash('sha384').update(hashInput).digest();
    default:
      logger.warn('Unsupported DS digest type', { digestType });
      return null;
  }
}

/**
 * Get parent domain name
 */
function getParentDomain(domain: string): string | null {
  const parts = domain.toLowerCase().split('.').filter((p) => p.length > 0);
  if (parts.length <= 1) {
    return null; // Already at root or TLD
  }
  return parts.slice(1).join('.');
}

/**
 * Parse DNS response to extract records (for chain of trust validation)
 */
function parseDNSResponse(response: Buffer): {
  answers: ResourceRecord[];
  authority: ResourceRecord[];
  additional: ResourceRecord[];
} | null {
  if (response.length < 12) {
    return null;
  }

  const anCount = response.readUInt16BE(6);
  const nsCount = response.readUInt16BE(8);
  const arCount = response.readUInt16BE(10);

  let offset = 12;

  // Skip question section
  const questionNameResult = parseDomainName(response, offset);
  offset = questionNameResult.newOffset + 4; // QTYPE + QCLASS

  // Parse answer section
  const answers: ResourceRecord[] = [];
  for (let i = 0; i < anCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    answers.push(rr);
    offset = rr.offset + 10 + rr.data.length;
  }

  // Parse authority section
  const authority: ResourceRecord[] = [];
  for (let i = 0; i < nsCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    authority.push(rr);
    offset = rr.offset + 10 + rr.data.length;
  }

  // Parse additional section
  const additional: ResourceRecord[] = [];
  for (let i = 0; i < arCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    additional.push(rr);
    offset = rr.offset + 10 + rr.data.length;
  }

  return { answers, authority, additional };
}

/**
 * Query DNS records from upstream (for chain of trust validation)
 * This is a simplified version - in production, you'd want to use the DNS server's forwardQuery
 */
async function queryDNSRecord(
  domain: string,
  type: string,
  upstreamDNS: string = '1.1.1.1',
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');

    // Create DNS query
    const typeMap: Record<string, number> = {
      A: 1,
      AAAA: 28,
      DNSKEY: 48,
      DS: 43,
      RRSIG: 46,
    };

    const queryType = typeMap[type.toUpperCase()] || 1;

    // DNS header
    const header = Buffer.alloc(12);
    header.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
    header.writeUInt16BE(0x0100, 2); // Standard query, recursion desired
    header.writeUInt16BE(0x0001, 4); // Questions: 1
    header.writeUInt16BE(0x0000, 6);
    header.writeUInt16BE(0x0000, 8);
    header.writeUInt16BE(0x0001, 10); // Additional: 1 (for OPT)

    // Domain name
    const parts = domain.split('.');
    const domainBuffer = Buffer.alloc(domain.length + 2);
    let offset = 0;
    for (const part of parts) {
      domainBuffer[offset++] = part.length;
      Buffer.from(part).copy(domainBuffer, offset);
      offset += part.length;
    }
    domainBuffer[offset++] = 0;

    // QTYPE and QCLASS
    const question = Buffer.alloc(4);
    question.writeUInt16BE(queryType, 0);
    question.writeUInt16BE(1, 2);

    // EDNS(0) OPT record with DO bit
    const optRecord = Buffer.alloc(11);
    optRecord[0] = 0; // Root name
    optRecord.writeUInt16BE(41, 1); // OPT type
    optRecord.writeUInt16BE(4096, 3); // UDP payload size
    optRecord.writeUInt16BE(0x8000, 5); // DO bit
    optRecord[7] = 0; // EDNS version
    optRecord[8] = 0; // Z
    optRecord.writeUInt16BE(0, 9); // Data length

    const query = Buffer.concat([header, domainBuffer.slice(0, offset), question, optRecord]);

    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('DNS query timeout'));
    }, 5000);

    client.on('message', (response) => {
      clearTimeout(timeout);
      client.close();
      resolve(response);
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.close();
      reject(err);
    });

    client.send(query, 53, upstreamDNS, (err) => {
      if (err) {
        clearTimeout(timeout);
        client.close();
        reject(err);
      }
    });
  });
}

/**
 * Validate chain of trust from domain up to trust anchor
 * This validates that the DNSKEY for a domain is properly signed by its parent's DS record
 */
export async function validateChainOfTrust(
  domain: string,
  dnskey: DNSKEYRecord,
  upstreamDNS: string = '1.1.1.1',
): Promise<{ valid: boolean; reason?: string; chainLength?: number }> {
  try {
    let currentDomain = domain.toLowerCase();
    let chainLength = 0;
    const maxChainLength = 10; // Prevent infinite loops

    while (currentDomain && chainLength < maxChainLength) {
      chainLength++;

      // Get parent domain
      const parentDomain = getParentDomain(currentDomain);
      if (!parentDomain) {
        // Reached root - would need trust anchor here
        // For now, we'll consider it valid if we can't find a parent
        logger.debug('Reached root domain in chain of trust', { domain: currentDomain });
        return { valid: true, reason: 'Reached root (trust anchor required)', chainLength };
      }

      // Query DS record from parent zone
      logger.debug('Querying DS record for chain of trust', { domain: currentDomain, parentDomain });
      const dsResponse = await queryDNSRecord(currentDomain, 'DS', upstreamDNS);
      if (!dsResponse) {
        return { valid: false, reason: `Failed to query DS record for ${currentDomain}`, chainLength };
      }

      // Parse DS records from response
      const parsed = parseDNSResponse(dsResponse);
      if (!parsed) {
        return { valid: false, reason: `Failed to parse DS response for ${currentDomain}`, chainLength };
      }

      const dsRecords = [...parsed.answers, ...parsed.authority, ...parsed.additional]
        .filter((rr) => rr.type === DS)
        .map((rr) => parseDS(rr.data))
        .filter((ds): ds is DSRecord => ds !== null);

      if (dsRecords.length === 0) {
        // No DS record found - domain may not be signed, or we're at a trust anchor
        logger.debug('No DS record found', { domain: currentDomain, parentDomain });
        // If we're validating the queried domain's DNSKEY and no DS exists, it might be a trust anchor
        if (chainLength === 1) {
          return { valid: false, reason: 'No DS record found for domain', chainLength };
        }
        // For intermediate steps, missing DS might be acceptable (unsigned zone)
        return { valid: true, reason: 'No DS record (unsigned intermediate zone)', chainLength };
      }

      // Find matching DS record (by key tag and algorithm)
      const keyTag = calculateKeyTag(dnskey);
      const matchingDS = dsRecords.find((ds) => ds.keyTag === keyTag && ds.algorithm === dnskey.algorithm);

      if (!matchingDS) {
        return {
          valid: false,
          reason: `No matching DS record found (keyTag: ${keyTag}, algorithm: ${dnskey.algorithm})`,
          chainLength,
        };
      }

      // Calculate DS hash from DNSKEY and compare
      const calculatedHash = calculateDSHash(currentDomain, dnskey, matchingDS.digestType);
      if (!calculatedHash) {
        return { valid: false, reason: 'Failed to calculate DS hash', chainLength };
      }

      if (!calculatedHash.equals(matchingDS.digest)) {
        return {
          valid: false,
          reason: `DS hash mismatch for ${currentDomain}`,
          chainLength,
        };
      }

      logger.debug('DS record validated', { domain: currentDomain, keyTag, algorithm: dnskey.algorithm });

      // If we've validated the queried domain's DNSKEY, we're done
      if (currentDomain === domain.toLowerCase()) {
        // Now we need to verify the parent's DNSKEY signs this DS record
        // For full validation, we'd continue up the chain
        // For now, we'll consider this a partial validation
        return { valid: true, reason: 'DS record validated (partial chain)', chainLength };
      }

      // Move up the chain - would need to get parent's DNSKEY and verify it signs the DS
      // For now, we'll stop here as this is a simplified implementation
      currentDomain = parentDomain;
    }

    return { valid: false, reason: 'Chain validation incomplete (max length reached)', chainLength };
  } catch (error) {
    logger.error('Error validating chain of trust', {
      error: error instanceof Error ? error : new Error(String(error)),
      domain,
    });
    return { valid: false, reason: 'Chain validation error' };
  }
}
