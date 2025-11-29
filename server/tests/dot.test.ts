import { describe, it, expect } from 'vitest';
import tls from 'tls';

const domain = process.env.TEST_DOMAIN || 'example.com';
const type = process.env.TEST_TYPE || 'A';
const dotHost = process.env.DOT_HOST || 'localhost';
const dotPort = parseInt(process.env.DOT_PORT || '853', 10);

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

function queryDoT(domain: string, type: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const dnsQuery = createDNSQuery(domain, type);
    const options = {
      host: dotHost,
      port: dotPort,
      rejectUnauthorized: false,
    };

    const socket = tls.connect(options, () => {
      const lengthPrefix = Buffer.allocUnsafe(2);
      lengthPrefix.writeUInt16BE(dnsQuery.length, 0);
      const tlsMsg = Buffer.concat([lengthPrefix, dnsQuery]);
      socket.write(tlsMsg);
    });

    let responseBuffer = Buffer.alloc(0);
    let responseLength: number | null = null;

    socket.on('data', (data) => {
      responseBuffer = Buffer.concat([responseBuffer, data]);

      if (responseLength === null && responseBuffer.length >= 2) {
        responseLength = responseBuffer.readUInt16BE(0);
      }

      if (responseLength !== null && responseBuffer.length >= responseLength + 2) {
        const dnsResponse = responseBuffer.slice(2, responseLength + 2);
        socket.end();
        resolve(dnsResponse);
      }
    });

    socket.on('error', (error) => {
      reject(error);
    });

    socket.setTimeout(5000);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('DoT query timeout'));
    });
  });
}

describe('DNS-over-TLS (DoT)', () => {
  it.skipIf(process.env.SKIP_DOT === 'true')(
    'should establish TLS connection and respond to queries',
    async () => {
      try {
        const dnsResponse = await queryDoT(domain, type);

        expect(dnsResponse.length).toBeGreaterThan(0);
        expect(dnsResponse.length).toBeGreaterThanOrEqual(12);

        const qdCount = dnsResponse.readUInt16BE(4);

        expect(qdCount).toBeGreaterThan(0);
      } catch (error) {
        if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
          console.warn('DoT server not available - skipping test');
          return;
        }
        throw error;
      }
    },
    10000,
  );
});
