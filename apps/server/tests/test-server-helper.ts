import { serve } from '@hono/node-server';
import { app } from '../src/index';
import type { Server } from 'http';

export interface TestServers {
  httpServer: Server;
  httpPort: number;
  stop: () => void;
}

let testServers: TestServers | null = null;

export async function startTestServers(): Promise<TestServers> {
  if (testServers) {
    return testServers;
  }

  // Start HTTP server on a random port
  const httpServer = serve({
    fetch: app.fetch,
    port: 0, // 0 = random available port
  });

  const httpPort = await new Promise<number>((resolve, reject) => {
    httpServer.on('listening', () => {
      const address = httpServer.address();
      const actualPort = typeof address === 'object' && address ? address.port : 3001;
      resolve(actualPort);
    });
    httpServer.on('error', reject);
  });

  testServers = {
    httpServer,
    httpPort,
    stop: () => {
      httpServer.close();
      testServers = null;
    },
  };

  return testServers;
}

export function getTestServers(): TestServers | null {
  return testServers;
}
