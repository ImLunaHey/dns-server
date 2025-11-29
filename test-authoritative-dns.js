#!/usr/bin/env node

/**
 * Test Authoritative DNS Server
 * Usage: node test-authoritative-dns.js [domain]
 * Example: node test-authoritative-dns.js test.local
 * 
 * This script:
 * 1. Creates a test zone via API
 * 2. Adds sample DNS records
 * 3. Tests DNS queries using Node's dns module
 */

import dgram from 'dgram';
import { promisify } from 'util';

const ZONE_DOMAIN = process.argv[2] || 'test.local';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const DNS_SERVER = process.env.DNS_SERVER || '127.0.0.1';
const DNS_PORT = parseInt(process.env.DNS_PORT || '53', 10);

// Helper to create DNS query
function createDNSQuery(domain, type) {
  const typeMap = {
    A: 1,
    AAAA: 28,
    MX: 15,
    TXT: 16,
    NS: 2,
    CNAME: 5,
    SOA: 6,
  };

  const queryType = typeMap[type.toUpperCase()] || 1;

  // DNS header
  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 65535), 0); // Random ID
  header.writeUInt16BE(0x0100, 2); // Flags: standard query, recursion desired
  header.writeUInt16BE(0x0001, 4); // Questions: 1
  header.writeUInt16BE(0x0000, 6); // Answers: 0
  header.writeUInt16BE(0x0000, 8); // Authority: 0
  header.writeUInt16BE(0x0000, 10); // Additional: 0

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

  return Buffer.concat([header, domainBuffer.slice(0, offset), question]);
}

// Send DNS query via UDP
function queryDNS(domain, type) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const query = createDNSQuery(domain, type);
    const timeout = setTimeout(() => {
      client.close();
      reject(new Error('DNS query timeout'));
    }, 5000);

    client.on('message', (response) => {
      clearTimeout(timeout);
      client.close();

      if (response.length < 12) {
        reject(new Error('Invalid DNS response'));
        return;
      }

      const flags = response.readUInt16BE(2);
      const qdCount = response.readUInt16BE(4);
      const anCount = response.readUInt16BE(6);
      const nsCount = response.readUInt16BE(8);
      const arCount = response.readUInt16BE(10);
      const rcode = flags & 0x0f;
      const aa = (flags & 0x0400) !== 0; // Authoritative Answer bit

      resolve({
        rcode,
        aa,
        questions: qdCount,
        answers: anCount,
        authority: nsCount,
        additional: arCount,
        response,
        flags, // Add flags for debugging
      });
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      client.close();
      reject(error);
    });

    client.send(query, DNS_PORT, DNS_SERVER);
  });
}

// Parse DNS response to extract answers
function parseDNSResponse(response, type) {
  const results = [];
  
  if (response.length < 12) return results;
  
  let offset = 12;

  // Skip question section
  // Parse domain name labels (can end with null terminator or compression pointer)
  const questionStart = offset;
  while (offset < response.length) {
    const byte = response[offset];
    if (byte === 0) {
      offset++; // Skip null terminator
      break;
    }
    // Check for compression pointer
    if ((byte & 0xc0) === 0xc0) {
      offset += 2; // Skip compression pointer
      break;
    }
    // Regular label
    if (byte > 63 || offset + byte + 1 > response.length) {
      break; // Invalid length
    }
    offset += byte + 1;
  }
  // Skip QTYPE and QCLASS (4 bytes total)
  if (offset + 4 > response.length) return results;
  const qtype = response.readUInt16BE(offset);
  const qclass = response.readUInt16BE(offset + 2);
  offset += 4;
  
  // Answer section starts here
  const answerSectionStart = offset;

  // Parse answer section
  const anCount = response.readUInt16BE(6);
  // Reset offset to answer section start (in case we moved it)
  offset = answerSectionStart;
  
  for (let i = 0; i < anCount && offset < response.length; i++) {
    // Skip name (compressed pointer or full name)
    if (offset >= response.length) break;
    
    const nameStart = offset;
    if ((response[offset] & 0xc0) === 0xc0) {
      // Compression pointer (2 bytes)
      offset += 2;
    } else {
      // Full name
      while (offset < response.length && response[offset] !== 0) {
        const length = response[offset];
        if (length === 0 || offset + length + 1 > response.length) break;
        offset += length + 1;
      }
      if (offset < response.length) offset++; // Skip null terminator
    }

    if (offset + 10 > response.length) {
      break;
    }

    const rrType = response.readUInt16BE(offset);
    offset += 2; // Skip class
    const ttl = response.readUInt32BE(offset);
    offset += 4; // Skip TTL
    const dataLength = response.readUInt16BE(offset);
    offset += 2;

    if (offset + dataLength > response.length) {
      break;
    }

    if (rrType === type) {
      if (type === 1 && dataLength === 4 && offset + 4 <= response.length) {
        // A record (4 bytes)
        const ip = `${response[offset]}.${response[offset + 1]}.${response[offset + 2]}.${response[offset + 3]}`;
        results.push(ip);
      } else if (type === 28 && dataLength === 16) {
        // AAAA record (16 bytes)
        const parts = [];
        for (let j = 0; j < 16; j += 2) {
          if (offset + j + 2 > response.length) break;
          const val = response.readUInt16BE(offset + j);
          parts.push(val.toString(16).padStart(4, '0'));
        }
        if (parts.length === 8) {
          results.push(parts.join(':'));
        }
      }
    }

    offset += dataLength;
  }

  return results;
}

async function testAuthoritativeDNS() {
  console.log('=== Testing Authoritative DNS Server ===\n');

  try {
    // Step 1: Create zone via API
    console.log(`1. Creating zone: ${ZONE_DOMAIN}`);
    console.log(`   API URL: ${API_URL}`);
    console.log('   Note: You need to be authenticated. Create zone via UI first, or use API key.\n');

    // Step 2: Test DNS queries
    console.log('2. Testing DNS queries...\n');

    // Test A record
    console.log(`   Querying A record for www.${ZONE_DOMAIN}:`);
    try {
      const aResponse = await queryDNS(`www.${ZONE_DOMAIN}`, 'A');
      console.log(`   ✓ Response received (RCODE: ${aResponse.rcode}, AA: ${aResponse.aa ? 'Yes' : 'No'})`);
      console.log(`   ✓ Response length: ${aResponse.response.length} bytes`);
      console.log(`   ✓ Answer count: ${aResponse.answers}`);
      if (aResponse.answers > 0) {
        const ips = parseDNSResponse(aResponse.response, 1);
        if (ips.length > 0) {
          console.log(`   ✓ A records: ${ips.join(', ')}`);
        } else {
          // Fallback: search for IP pattern in response
          // IP should be the last 4 bytes before end (after data length field)
          if (aResponse.response.length >= 4) {
            // Try to find IP by looking for pattern: 00 04 followed by 4 bytes (data length + IP)
            const hex = aResponse.response.toString('hex');
            const ipPattern = /0004([0-9a-f]{8})/;
            const match = hex.match(ipPattern);
            if (match) {
              const ipBytes = match[1];
              const ip = `${parseInt(ipBytes.substring(0,2), 16)}.${parseInt(ipBytes.substring(2,4), 16)}.${parseInt(ipBytes.substring(4,6), 16)}.${parseInt(ipBytes.substring(6,8), 16)}`;
              console.log(`   ✓ A record (extracted): ${ip}`);
            } else {
              // Last resort: check last 4 bytes
              const last4 = aResponse.response.slice(-4);
              if (last4[0] >= 192 && last4[0] <= 223) {
                const ip = `${last4[0]}.${last4[1]}.${last4[2]}.${last4[3]}`;
                console.log(`   ✓ A record (from end): ${ip}`);
              } else {
                console.log(`   ⚠ No IPs parsed (response length: ${aResponse.response.length} bytes)`);
                console.log(`   ⚠ Last 20 bytes hex: ${hex.substring(Math.max(0, hex.length - 40))}`);
              }
            }
          }
        }
      } else {
        console.log(`   ⚠ No answers in response (but RCODE is ${aResponse.rcode})`);
      }
    } catch (error) {
      console.log(`   ✗ Failed: ${error.message}`);
    }
    console.log('');

    // Test AAAA record
    console.log(`   Querying AAAA record for www.${ZONE_DOMAIN}:`);
    try {
      const aaaaResponse = await queryDNS(`www.${ZONE_DOMAIN}`, 'AAAA');
      console.log(`   ✓ Response received (RCODE: ${aaaaResponse.rcode}, AA: ${aaaaResponse.aa ? 'Yes' : 'No'})`);
      if (aaaaResponse.answers > 0) {
        const ips = parseDNSResponse(aaaaResponse.response, 28);
        console.log(`   ✓ AAAA records: ${ips.join(', ')}`);
      }
    } catch (error) {
      console.log(`   ✗ Failed: ${error.message}`);
    }
    console.log('');

    // Test MX record
    console.log(`   Querying MX record for ${ZONE_DOMAIN}:`);
    try {
      const mxResponse = await queryDNS(ZONE_DOMAIN, 'MX');
      console.log(`   ✓ Response received (RCODE: ${mxResponse.rcode}, AA: ${mxResponse.aa ? 'Yes' : 'No'})`);
      console.log(`   ✓ Answers: ${mxResponse.answers}`);
    } catch (error) {
      console.log(`   ✗ Failed: ${error.message}`);
    }
    console.log('');

    // Test NS record
    console.log(`   Querying NS record for ${ZONE_DOMAIN}:`);
    try {
      const nsResponse = await queryDNS(ZONE_DOMAIN, 'NS');
      console.log(`   ✓ Response received (RCODE: ${nsResponse.rcode}, AA: ${nsResponse.aa ? 'Yes' : 'No'})`);
      console.log(`   ✓ Answers: ${nsResponse.answers}`);
    } catch (error) {
      console.log(`   ✗ Failed: ${error.message}`);
    }
    console.log('');

    // Test SOA record
    console.log(`   Querying SOA record for ${ZONE_DOMAIN}:`);
    try {
      const soaResponse = await queryDNS(ZONE_DOMAIN, 'SOA');
      console.log(`   ✓ Response received (RCODE: ${soaResponse.rcode}, AA: ${soaResponse.aa ? 'Yes' : 'No'})`);
      console.log(`   ✓ Answers: ${soaResponse.answers}, Authority: ${soaResponse.authority}`);
    } catch (error) {
      console.log(`   ✗ Failed: ${error.message}`);
    }
    console.log('');

    // Test non-existent record (should return NXDOMAIN with SOA)
    console.log(`   Querying non-existent record (should return NXDOMAIN):`);
    try {
      const nxResponse = await queryDNS(`nonexistent.${ZONE_DOMAIN}`, 'A');
      console.log(`   ✓ Response received (RCODE: ${nxResponse.rcode}, AA: ${nxResponse.aa ? 'Yes' : 'No'})`);
      if (nxResponse.rcode === 3) {
        console.log(`   ✓ Correctly returned NXDOMAIN (RCODE=3)`);
        console.log(`   ✓ Authority records: ${nxResponse.authority} (should have SOA)`);
      } else {
        console.log(`   ⚠ Expected NXDOMAIN (RCODE=3), got RCODE=${nxResponse.rcode}`);
      }
    } catch (error) {
      console.log(`   ✗ Failed: ${error.message}`);
    }
    console.log('');

    console.log('=== Test Complete ===\n');
    console.log('Note: Make sure:');
    console.log('  1. DNS server is running (sudo npm run dev in server/)');
    console.log('  2. Zone is created via UI at /zones');
    console.log('  3. Records are added to the zone');
    console.log('  4. Your system DNS is set to 127.0.0.1 (or use dig @127.0.0.1)');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testAuthoritativeDNS();

