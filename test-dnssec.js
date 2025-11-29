#!/usr/bin/env node

/**
 * Test DNSSEC Validation
 * Usage: node test-dnssec.js [domain]
 * Example: node test-dnssec.js cloudflare.com
 * 
 * This script:
 * 1. Tests DNS queries with DNSSEC enabled (EDNS(0) DO bit)
 * 2. Verifies DNSSEC records (RRSIG, DNSKEY) are present
 * 3. Tests DNSSEC validation (if enabled in settings)
 * 
 * Note: Make sure DNSSEC validation is enabled in settings for full testing
 */

import dgram from 'dgram';
import { promisify } from 'util';

const TEST_DOMAIN = process.argv[2] || 'cloudflare.com';
const DNS_SERVER = process.env.DNS_SERVER || '127.0.0.1';
const DNS_PORT = parseInt(process.env.DNS_PORT || '53', 10);
const API_URL = process.env.API_URL || 'http://localhost:3001';

// Helper to create DNS query with EDNS(0) and DO bit
function createDNSQueryWithDNSSEC(domain, type) {
  const typeMap = {
    A: 1,
    AAAA: 28,
    MX: 15,
    TXT: 16,
    NS: 2,
    CNAME: 5,
    SOA: 6,
    DNSKEY: 48,
    RRSIG: 46,
    DS: 43,
  };

  const queryType = typeMap[type.toUpperCase()] || 1;

  // DNS header
  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 65535), 0); // Random ID
  header.writeUInt16BE(0x0100, 2); // Flags: standard query, recursion desired
  header.writeUInt16BE(0x0001, 4); // Questions: 1
  header.writeUInt16BE(0x0000, 6); // Answers: 0
  header.writeUInt16BE(0x0000, 8); // Authority: 0
  header.writeUInt16BE(0x0001, 10); // Additional: 1 (for OPT record)

  // Domain name
  const parts = domain.split('.');
  const domainBuffer = Buffer.alloc(domain.length + 2);
  let offset = 0;
  for (const part of parts) {
    domainBuffer[offset++] = part.length;
    Buffer.from(part).copy(domainBuffer, offset);
    offset += part.length;
  }
  domainBuffer[offset++] = 0; // Null terminator

  // QTYPE and QCLASS
  const question = Buffer.alloc(4);
  question.writeUInt16BE(queryType, 0); // QTYPE
  question.writeUInt16BE(1, 2); // QCLASS (IN = 1)

  // EDNS(0) OPT record
  // OPT record format:
  // - Name: root (0x00)
  // - Type: OPT (41)
  // - UDP payload size (2 bytes)
  // - Extended RCODE and flags (2 bytes) - DO bit is bit 15 (0x8000)
  // - EDNS version (1 byte)
  // - Z (reserved, 1 byte)
  // - Data length (2 bytes)
  const optRecord = Buffer.alloc(11);
  optRecord[0] = 0; // Root name
  optRecord.writeUInt16BE(41, 1); // OPT type
  optRecord.writeUInt16BE(4096, 3); // UDP payload size
  optRecord.writeUInt16BE(0x8000, 5); // DO bit set (bit 15)
  optRecord[7] = 0; // EDNS version
  optRecord[8] = 0; // Z (reserved)
  optRecord.writeUInt16BE(0, 9); // Data length

  return Buffer.concat([header, domainBuffer.slice(0, offset), question, optRecord]);
}

// Helper to parse domain name from DNS response
function parseDomainName(response, offset) {
  const labels = [];
  let currentOffset = offset;
  const visitedOffsets = new Set();

  while (currentOffset < response.length) {
    if (visitedOffsets.has(currentOffset)) {
      break; // Circular reference
    }
    visitedOffsets.add(currentOffset);

    const length = response[currentOffset];
    currentOffset++;

    if (length === 0) {
      break; // End of name
    }

    if ((length & 0xc0) === 0xc0) {
      // Compression pointer
      const pointer = ((length & 0x3f) << 8) | response[currentOffset];
      currentOffset++;
      if (pointer >= response.length || pointer < 12) {
        break;
      }
      const decompressed = parseDomainName(response, pointer);
      labels.push(...decompressed.name.split('.'));
      break;
    }

    if (length > 63 || currentOffset + length > response.length) {
      break;
    }

    const label = response.toString('utf8', currentOffset, currentOffset + length);
    labels.push(label);
    currentOffset += length;
  }

  return { name: labels.join('.'), newOffset: currentOffset };
}

// Helper to parse resource record
function parseResourceRecord(response, offset) {
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
    klass,
    ttl,
    dataLength,
    data,
    newOffset: currentOffset + dataLength,
  };
}

// Query DNS server
function queryDNS(domain, type) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const query = createDNSQueryWithDNSSEC(domain, type);

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

    client.send(query, DNS_PORT, DNS_SERVER, (err) => {
      if (err) {
        clearTimeout(timeout);
        client.close();
        reject(err);
      }
    });
  });
}

// Parse DNS response and extract DNSSEC records
function parseDNSResponse(response) {
  if (response.length < 12) {
    return null;
  }

  const id = response.readUInt16BE(0);
  const flags = response.readUInt16BE(2);
  const qdCount = response.readUInt16BE(4);
  const anCount = response.readUInt16BE(6);
  const nsCount = response.readUInt16BE(8);
  const arCount = response.readUInt16BE(10);

  const rcode = flags & 0x0f;
  const ad = (flags & 0x0020) !== 0; // Authentic Data bit

  let offset = 12;

  // Parse question section
  const questionNameResult = parseDomainName(response, offset);
  offset = questionNameResult.newOffset;
  const qtype = response.readUInt16BE(offset);
  const qclass = response.readUInt16BE(offset + 2);
  offset += 4;

  // Parse answer section
  const answers = [];
  for (let i = 0; i < anCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    answers.push(rr);
    offset = rr.newOffset;
  }

  // Parse authority section
  const authority = [];
  for (let i = 0; i < nsCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    authority.push(rr);
    offset = rr.newOffset;
  }

  // Parse additional section
  const additional = [];
  for (let i = 0; i < arCount && offset < response.length; i++) {
    const rr = parseResourceRecord(response, offset);
    if (!rr) break;
    additional.push(rr);
    offset = rr.newOffset;
  }

  return {
    id,
    flags,
    rcode,
    ad,
    qdCount,
    anCount,
    nsCount,
    arCount,
    question: {
      name: questionNameResult.name,
      type: qtype,
      class: qclass,
    },
    answers,
    authority,
    additional,
  };
}

// Check if DNSSEC records are present
function checkDNSSECRecords(parsed) {
  const rrsigs = [...parsed.answers, ...parsed.authority, ...parsed.additional].filter((rr) => rr.type === 46); // RRSIG
  const dnskeyRecords = [...parsed.answers, ...parsed.authority, ...parsed.additional].filter((rr) => rr.type === 48); // DNSKEY
  const dsRecords = [...parsed.answers, ...parsed.authority, ...parsed.additional].filter((rr) => rr.type === 43); // DS
  const nsecRecords = [...parsed.answers, ...parsed.authority, ...parsed.additional].filter((rr) => rr.type === 47); // NSEC
  const nsec3Records = [...parsed.answers, ...parsed.authority, ...parsed.additional].filter((rr) => rr.type === 50); // NSEC3

  return {
    hasRRSIG: rrsigs.length > 0,
    hasDNSKEY: dnskeyRecords.length > 0,
    hasDS: dsRecords.length > 0,
    hasNSEC: nsecRecords.length > 0,
    hasNSEC3: nsec3Records.length > 0,
    rrsigCount: rrsigs.length,
    dnskeyCount: dnskeyRecords.length,
    dsCount: dsRecords.length,
    nsecCount: nsecRecords.length,
    nsec3Count: nsec3Records.length,
  };
}

// Main test function
async function testDNSSEC() {
  console.log('=== Testing DNSSEC Support ===\n');
  console.log(`Domain: ${TEST_DOMAIN}`);
  console.log(`DNS Server: ${DNS_SERVER}:${DNS_PORT}`);
  console.log(`API URL: ${API_URL}\n`);

  try {
    // Test 1: Query A record with DNSSEC
    console.log('1. Querying A record with DNSSEC (DO bit set)...');
    const aResponse = await queryDNS(TEST_DOMAIN, 'A');
    const aParsed = parseDNSResponse(aResponse);

    if (!aParsed) {
      console.log('   ✗ Failed to parse response\n');
    } else {
      console.log(`   ✓ Response received (RCODE: ${aParsed.rcode}, AD: ${aParsed.ad ? 'Yes' : 'No'})`);
      console.log(`   ✓ Answers: ${aParsed.anCount}, Authority: ${aParsed.nsCount}, Additional: ${aParsed.arCount}`);

      const dnssec = checkDNSSECRecords(aParsed);
      console.log(`   ✓ DNSSEC Records:`);
      console.log(`     - RRSIG: ${dnssec.rrsigCount} (${dnssec.hasRRSIG ? 'present' : 'missing'})`);
      console.log(`     - DNSKEY: ${dnssec.dnskeyCount} (${dnssec.hasDNSKEY ? 'present' : 'missing'})`);
      console.log(`     - DS: ${dnssec.dsCount} (${dnssec.hasDS ? 'present' : 'missing'})`);
      console.log(`     - NSEC: ${dnssec.nsecCount} (${dnssec.hasNSEC ? 'present' : 'missing'})`);
      console.log(`     - NSEC3: ${dnssec.nsec3Count} (${dnssec.hasNSEC3 ? 'present' : 'missing'})`);

      if (aParsed.ad) {
        console.log('   ✓ AD (Authentic Data) bit is set - response is DNSSEC validated');
      } else {
        console.log('   ⚠ AD bit is not set - response may not be validated');
      }

      if (dnssec.hasRRSIG) {
        console.log('   ✓ DNSSEC signatures found in response');
      } else {
        console.log('   ⚠ No DNSSEC signatures found - domain may not support DNSSEC');
        console.log(`   ⚠ Response length: ${aResponse.length} bytes`);
        // Check if OPT record is present (indicates EDNS support)
        const optRecords = [...aParsed.additional].filter((rr) => rr.type === 41);
        if (optRecords.length > 0) {
          console.log('   ✓ OPT record present (EDNS(0) supported)');
          // Check DO bit in OPT record
          const optData = optRecords[0].data;
          if (optData.length >= 2) {
            const optFlags = optData.readUInt16BE(0);
            const doBit = (optFlags & 0x8000) !== 0;
            console.log(`   ${doBit ? '✓' : '⚠'} DO bit in response: ${doBit ? 'Set' : 'Not set'}`);
          }
        } else {
          console.log('   ⚠ No OPT record in response');
        }
      }
    }

    console.log('');

    // Test 2: Query DNSKEY record
    console.log('2. Querying DNSKEY record...');
    try {
      const dnskeyResponse = await queryDNS(TEST_DOMAIN, 'DNSKEY');
      const dnskeyParsed = parseDNSResponse(dnskeyResponse);

      if (dnskeyParsed) {
        const dnskeyRecords = [...dnskeyParsed.answers, ...dnskeyParsed.authority, ...dnskeyParsed.additional].filter(
          (rr) => rr.type === 48,
        );
        console.log(`   ✓ DNSKEY records found: ${dnskeyRecords.length}`);
        if (dnskeyRecords.length > 0) {
          console.log(`   ✓ DNSKEY record size: ${dnskeyRecords[0].dataLength} bytes`);
        }
      }
    } catch (error) {
      console.log(`   ⚠ DNSKEY query failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log('');

    // Test 2b: Query RRSIG record directly
    console.log('2b. Querying RRSIG record for A type...');
    try {
      const rrsigResponse = await queryDNS(TEST_DOMAIN, 'RRSIG');
      const rrsigParsed = parseDNSResponse(rrsigResponse);

      if (rrsigParsed) {
        const rrsigRecords = [...rrsigParsed.answers, ...rrsigParsed.authority, ...rrsigParsed.additional].filter(
          (rr) => rr.type === 46,
        );
        console.log(`   ✓ RRSIG records found: ${rrsigRecords.length}`);
        if (rrsigRecords.length > 0) {
          console.log(`   ✓ RRSIG record size: ${rrsigRecords[0].dataLength} bytes`);
          // Parse RRSIG to show type covered
          if (rrsigRecords[0].data.length >= 2) {
            const typeCovered = rrsigRecords[0].data.readUInt16BE(0);
            const typeNames = { 1: 'A', 28: 'AAAA', 2: 'NS', 15: 'MX', 48: 'DNSKEY' };
            console.log(`   ✓ RRSIG covers type: ${typeNames[typeCovered] || typeCovered}`);
          }
        } else {
          console.log('   ⚠ No RRSIG records in response');
        }
      }
    } catch (error) {
      console.log(`   ⚠ RRSIG query failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log('');

    // Test 3: Check if DNSSEC validation is enabled via API
    console.log('3. Checking DNSSEC validation setting...');
    try {
      const settingsResponse = await fetch(`${API_URL}/api/settings`);
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json();
        const dnssecValidation = settings.dnssecValidation || false;
        console.log(`   ${dnssecValidation ? '✓' : '⚠'} DNSSEC validation: ${dnssecValidation ? 'Enabled' : 'Disabled'}`);
        if (!dnssecValidation) {
          console.log('   Note: Enable DNSSEC validation in settings to test full validation');
        }
      } else {
        console.log('   ⚠ Could not fetch settings (authentication may be required)');
      }
    } catch (error) {
      console.log(`   ⚠ Failed to check settings: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log('');

    // Test 4: Test with a well-known DNSSEC-enabled domain
    console.log('4. Testing with well-known DNSSEC domains...');
    const testDomains = ['cloudflare.com', 'google.com', 'mozilla.org'];
    for (const domain of testDomains) {
      try {
        const testResponse = await queryDNS(domain, 'A');
        const testParsed = parseDNSResponse(testResponse);
        if (testParsed) {
          const testDNSSEC = checkDNSSECRecords(testParsed);
          const status = testDNSSEC.hasRRSIG ? '✓' : '⚠';
          console.log(`   ${status} ${domain}: RRSIG=${testDNSSEC.hasRRSIG}, AD=${testParsed.ad ? 'Yes' : 'No'}`);
        }
      } catch (error) {
        console.log(`   ✗ ${domain}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log('\n=== Test Complete ===');
    console.log('\nNote:');
    console.log('  - AD bit indicates the upstream DNS server validated DNSSEC');
    console.log('  - RRSIG records indicate DNSSEC signatures are present');
    console.log('  - Enable DNSSEC validation in settings to test local validation');
  } catch (error) {
    console.error('Test failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run tests
testDNSSEC().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

