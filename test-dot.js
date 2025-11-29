#!/usr/bin/env node

/**
 * Test DNS-over-TLS (DoT) client
 * Usage: node test-dot.js <domain> [type]
 * Example: node test-dot.js example.com A
 */

import tls from 'tls';

const domain = process.argv[2] || 'example.com';
const type = process.argv[3] || 'A';
const dotHost = process.argv[4] || 'localhost';
const dotPort = parseInt(process.argv[5] || '853', 10);

// Create a DNS query
function createDNSQuery(domain, type) {
  const typeMap = {
    A: 1,
    AAAA: 28,
    MX: 15,
    TXT: 16,
    NS: 2,
    CNAME: 5,
  };

  const queryType = typeMap[type.toUpperCase()] || 1;

  // DNS header
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1234, 0); // ID
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

async function testDoT() {
  const dnsQuery = createDNSQuery(domain, type);

  console.log(`Testing DoT: ${domain} (${type})`);
  console.log(`Connecting to ${dotHost}:${dotPort}...`);
  console.log('');

  return new Promise((resolve, reject) => {
    const options = {
      host: dotHost,
      port: dotPort,
      rejectUnauthorized: false, // Allow self-signed certs for testing
    };

    const socket = tls.connect(options, () => {
      console.log('✓ TLS connection established');
      console.log(`  Protocol: ${socket.getProtocol()}`);
      console.log(`  Cipher: ${socket.getCipher().name}`);
      console.log('');

      // Send DNS query with length prefix
      const lengthPrefix = Buffer.allocUnsafe(2);
      lengthPrefix.writeUInt16BE(dnsQuery.length, 0);
      const tlsMsg = Buffer.concat([lengthPrefix, dnsQuery]);

      socket.write(tlsMsg);
      console.log(`✓ DNS query sent (${dnsQuery.length} bytes)`);
    });

    let responseBuffer = Buffer.alloc(0);
    let responseLength = null;

    socket.on('data', (data) => {
      responseBuffer = Buffer.concat([responseBuffer, data]);

      if (responseLength === null && responseBuffer.length >= 2) {
        responseLength = responseBuffer.readUInt16BE(0);
      }

      if (responseLength !== null && responseBuffer.length >= responseLength + 2) {
        const dnsResponse = responseBuffer.slice(2, responseLength + 2);

        console.log(`✓ DNS response received (${dnsResponse.length} bytes)`);
        console.log('');

        // Parse basic response
        if (dnsResponse.length >= 12) {
          const flags = dnsResponse.readUInt16BE(2);
          const qdCount = dnsResponse.readUInt16BE(4);
          const anCount = dnsResponse.readUInt16BE(6);

          console.log('DNS Response:');
          console.log(`  Questions: ${qdCount}`);
          console.log(`  Answers: ${anCount}`);
          console.log(`  Response: ${flags & 0x8000 ? 'Yes' : 'No'}`);
          console.log(`  RCODE: ${flags & 0x0f}`);
          console.log('');
          console.log('✓ DoT test successful!');
        }

        socket.end();
        resolve();
      }
    });

    socket.on('error', (error) => {
      console.error('✗ DoT test failed:', error.message);
      if (error.message.includes('ECONNREFUSED')) {
        console.error('');
        console.error('Make sure:');
        console.error('  1. DoT server is enabled (dotEnabled=true)');
        console.error('  2. TLS certificates are configured');
        console.error('  3. Server is running');
      }
      reject(error);
    });

    socket.on('end', () => {
      console.log('Connection closed');
    });
  });
}

testDoT().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

