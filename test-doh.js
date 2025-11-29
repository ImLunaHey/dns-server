#!/usr/bin/env node

/**
 * Simple DoH (DNS-over-HTTPS) test client
 * Usage: node test-doh.js <domain> [type]
 * Example: node test-doh.js example.com A
 */

import { createSocket } from "dgram";
import { promisify } from "util";

const domain = process.argv[2] || "example.com";
const type = process.argv[3] || "A";

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

async function testDoH() {
  const dnsQuery = createDNSQuery(domain, type);

  console.log(`Testing DoH: ${domain} (${type})`);
  console.log(`Query size: ${dnsQuery.length} bytes`);
  console.log("");

  try {
    const response = await fetch("http://localhost:3001/dns-query", {
      method: "POST",
      headers: {
        "Content-Type": "application/dns-message",
      },
      body: dnsQuery,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Error: ${response.status} ${response.statusText}`);
      console.error(text);
      process.exit(1);
    }

    const responseBuffer = await response.arrayBuffer();
    const dnsResponse = Buffer.from(responseBuffer);

    console.log(`✓ Response received: ${dnsResponse.length} bytes`);
    console.log(`  Status: ${response.status} ${response.statusText}`);
    console.log(`  Content-Type: ${response.headers.get("content-type")}`);
    console.log("");

    // Parse basic DNS response
    if (dnsResponse.length >= 12) {
      const flags = dnsResponse.readUInt16BE(2);
      const qdCount = dnsResponse.readUInt16BE(4);
      const anCount = dnsResponse.readUInt16BE(6);

      console.log(`DNS Response:`);
      console.log(`  Questions: ${qdCount}`);
      console.log(`  Answers: ${anCount}`);
      console.log(`  Response: ${flags & 0x8000 ? "Yes" : "No"}`);
      console.log(`  RCODE: ${flags & 0x0f}`);
    }

    console.log("");
    console.log("✓ DoH test successful!");
    console.log("");
    console.log("To see the actual DNS response, use:");
    console.log(`  dig @127.0.0.1 ${domain} ${type}`);
  } catch (error) {
    console.error("✗ DoH test failed:", error.message);
    process.exit(1);
  }
}

testDoH();
