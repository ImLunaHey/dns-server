#!/usr/bin/env node

/**
 * Generate a DNS query packet and save it to a file for use with curl
 * Usage: node generate-dns-query.js <domain> [type] [output-file]
 * Example: node generate-dns-query.js example.com A dns-query.bin
 */

const domain = process.argv[2] || "example.com";
const type = process.argv[3] || "A";
const outputFile = process.argv[4] || "dns-query.bin";

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

  // DNS header: ID (2 bytes) + Flags (2 bytes) + Questions (2) + Answers (2) + Authority (2) + Additional (2)
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1234, 0); // ID
  header.writeUInt16BE(0x0100, 2); // Flags: standard query, recursion desired
  header.writeUInt16BE(0x0001, 4); // Questions: 1
  header.writeUInt16BE(0x0000, 6); // Answers: 0
  header.writeUInt16BE(0x0000, 8); // Authority: 0
  header.writeUInt16BE(0x0000, 10); // Additional: 0

  // Domain name
  const parts = domain.split(".");
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

import { writeFileSync } from "fs";

const dnsQuery = createDNSQuery(domain, type);
writeFileSync(outputFile, dnsQuery);

console.log(`✓ DNS query generated for ${domain} (${type})`);
console.log(`  Saved to: ${outputFile}`);
console.log(`  Size: ${dnsQuery.length} bytes`);
console.log("");
console.log("Now you can test with curl:");
console.log(`  curl -X POST http://localhost:3001/dns-query \\`);
console.log(`    -H "Content-Type: application/dns-message" \\`);
console.log(`    --data-binary @${outputFile} \\`);
console.log(`    -o response.bin`);
console.log("");
console.log("Or use the test script directly:");
console.log(`  node test-doh.js ${domain} ${type}`);
