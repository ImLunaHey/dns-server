import { describe, it, expect } from 'vitest';

const domain = process.env.TEST_DOMAIN || 'example.com';
const type = process.env.TEST_TYPE || 'A';
const API_URL = process.env.API_URL || 'http://localhost:3001';

function createDNSQuery(domain: string, type: string): Buffer {
  const typeMap: Record<string, number> = {
    A: 1,
    AAAA: 28,
    MX: 15,
    TXT: 16,
    NS: 2,
    CNAME: 5,
  };

  const queryType = typeMap[type.toUpperCase()] || 1;

  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1234, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(0x0001, 4);
  header.writeUInt16BE(0x0000, 6);
  header.writeUInt16BE(0x0000, 8);
  header.writeUInt16BE(0x0000, 10);

  const parts = domain.split('.');
  const domainBuffer = Buffer.alloc(domain.length + 2);
  let offset = 0;
  for (const part of parts) {
    domainBuffer[offset++] = part.length;
    Buffer.from(part).copy(domainBuffer, offset);
    offset += part.length;
  }
  domainBuffer[offset++] = 0;

  const question = Buffer.alloc(4);
  question.writeUInt16BE(queryType, 0);
  question.writeUInt16BE(1, 2);

  return Buffer.concat([header, domainBuffer.slice(0, offset), question]);
}

describe('DNS-over-HTTPS (DoH)', () => {
  it('should respond to DoH queries', async () => {
    const dnsQuery = createDNSQuery(domain, type);

    const response = await fetch(`${API_URL}/dns-query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/dns-message',
      },
      body: dnsQuery,
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('application/dns-message');

    const responseBuffer = await response.arrayBuffer();
    const dnsResponse = Buffer.from(responseBuffer);

    expect(dnsResponse.length).toBeGreaterThan(0);
    expect(dnsResponse.length).toBeGreaterThanOrEqual(12);

    const qdCount = dnsResponse.readUInt16BE(4);

    expect(qdCount).toBeGreaterThan(0);
  }, 10000);

  it('should handle different query types', async () => {
    const types = ['A', 'AAAA', 'MX', 'TXT'];

    for (const queryType of types) {
      const dnsQuery = createDNSQuery(domain, queryType);

      const response = await fetch(`${API_URL}/dns-query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/dns-message',
        },
        body: dnsQuery,
      });

      expect(response.ok).toBe(true);

      const responseBuffer = await response.arrayBuffer();
      const dnsResponse = Buffer.from(responseBuffer);
      expect(dnsResponse.length).toBeGreaterThan(0);
    }
  }, 30000);
});
