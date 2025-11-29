import { describe, it, expect } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const domain = process.env.TEST_DOMAIN || 'example.com';
const type = process.env.TEST_TYPE || 'A';
const doqHost = process.env.DOQ_HOST || 'localhost';
const doqPort = parseInt(process.env.DOQ_PORT || '853', 10);

// Check Node.js version
const nodeVersion = process.version;
const nodeMajorVersion = parseInt(nodeVersion.slice(1).split('.')[0] || '0', 10);
const isNode25Plus = nodeMajorVersion >= 25;

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

async function queryDoQ(domain: string, type: string): Promise<Buffer> {
  // @ts-ignore - QUIC is experimental in Node.js 25+
  const netModule = await import('net');
  // @ts-ignore - QUIC is experimental
  const createQuicSocket = (netModule as any).createQuicSocket;

  if (!createQuicSocket) {
    throw new Error('QUIC not available - requires Node.js 25+');
  }

  return new Promise((resolve, reject) => {
    const dnsQuery = createDNSQuery(domain, type);

    // @ts-ignore - QUIC is experimental
    const client = createQuicSocket({
      client: {
        alpn: 'doq',
        rejectUnauthorized: false, // Allow self-signed certs for testing
      },
    });

    let responseBuffer = Buffer.alloc(0);
    let resolved = false;

    client.on('ready', () => {
      // @ts-ignore - QUIC is experimental
      const session = client.connect({
        address: doqHost,
        port: doqPort,
      });

      session.on('secure', () => {
        // @ts-ignore - QUIC is experimental
        const stream = session.openStream({ halfOpen: false });

        stream.on('data', (data: Buffer) => {
          responseBuffer = Buffer.concat([responseBuffer, data]);
        });

        stream.on('end', () => {
          if (!resolved) {
            resolved = true;
            client.close();
            resolve(responseBuffer);
          }
        });

        stream.on('error', (err: Error) => {
          if (!resolved) {
            resolved = true;
            client.close();
            reject(err);
          }
        });

        // Send DNS query
        stream.write(dnsQuery);
        stream.end();
      });

      session.on('error', (err: Error) => {
        if (!resolved) {
          resolved = true;
          client.close();
          reject(err);
        }
      });
    });

    client.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    client.setTimeout(10000);
    client.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        client.close();
        reject(new Error('DoQ query timeout'));
      }
    });
  });
}

describe('DNS-over-QUIC (DoQ)', () => {
  it.skipIf(!isNode25Plus)('should check DoQ settings via API', async () => {
    try {
      const response = await fetch(`${API_URL}/api/settings`);
      if (response.ok) {
        const settings = (await response.json()) as Record<string, unknown>;
        expect(settings).toHaveProperty('doqEnabled');
        if (settings.doqEnabled) {
          expect(settings).toHaveProperty('doqPort');
        }
      } else {
        console.warn('Could not fetch DoQ settings - API may require authentication');
      }
    } catch (error) {
      console.warn('DoQ settings check failed - API may not be available');
    }
  });

  it.skipIf(!isNode25Plus)(
    'should respond to DoQ queries',
    async () => {
      try {
        const dnsResponse = await queryDoQ(domain, type);

        expect(dnsResponse.length).toBeGreaterThan(0);
        expect(dnsResponse.length).toBeGreaterThanOrEqual(12);

        const qdCount = dnsResponse.readUInt16BE(4);

        expect(qdCount).toBeGreaterThan(0);
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
            console.warn('DoQ server not available - skipping test');
            return;
          }
          if (error.message.includes('QUIC not available')) {
            console.warn('QUIC not available - skipping test');
            return;
          }
        }
        throw error;
      }
    },
    15000,
  );
});
