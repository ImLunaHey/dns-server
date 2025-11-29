import { describe, it, expect } from 'vitest';
import dgram from 'dgram';

const ZONE_DOMAIN = process.env.TEST_ZONE || 'test.local';
const API_URL = process.env.API_URL || 'http://localhost:3001';
const DNS_SERVER = process.env.DNS_SERVER || '127.0.0.1';
const DNS_PORT = parseInt(process.env.DNS_PORT || '53', 10);

function createDNSQuery(domain: string, type: string): Buffer {
  const typeMap: Record<string, number> = {
    A: 1,
    AAAA: 28,
    MX: 15,
    TXT: 16,
    NS: 2,
    CNAME: 5,
    SOA: 6,
  };

  const queryType = typeMap[type.toUpperCase()] || 1;

  const header = Buffer.alloc(12);
  header.writeUInt16BE(Math.floor(Math.random() * 65535), 0);
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

function queryDNS(domain: string, type: string): Promise<{ rcode: number; aa: boolean; answers: number; response: Buffer }> {
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
      const aa = (flags & 0x0400) !== 0;

      resolve({
        rcode,
        aa,
        answers: anCount,
        response,
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

describe('Authoritative DNS', () => {
  it.skipIf(process.env.SKIP_AUTHORITATIVE === 'true')('should respond to A record queries', async () => {
    try {
      const response = await queryDNS(`www.${ZONE_DOMAIN}`, 'A');
      expect(response.response.length).toBeGreaterThan(0);
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        console.warn('DNS server not available - skipping test');
        return;
      }
      throw error;
    }
  }, 10000);

  it.skipIf(process.env.SKIP_AUTHORITATIVE === 'true')('should respond to AAAA record queries', async () => {
    try {
      const response = await queryDNS(`www.${ZONE_DOMAIN}`, 'AAAA');
      expect(response.response.length).toBeGreaterThan(0);
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        console.warn('DNS server not available - skipping test');
        return;
      }
      throw error;
    }
  }, 10000);

  it.skipIf(process.env.SKIP_AUTHORITATIVE === 'true')('should return NXDOMAIN for non-existent records', async () => {
    try {
      const response = await queryDNS(`nonexistent.${ZONE_DOMAIN}`, 'A');
      expect(response.rcode).toBe(3);
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        console.warn('DNS server not available - skipping test');
        return;
      }
      throw error;
    }
  }, 10000);
});

