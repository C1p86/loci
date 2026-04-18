// Minimal WS test server using raw `ws` — no Fastify overhead needed for mock.
// Used by client.integration.test.ts to simulate the server side.

import type { AddressInfo } from 'node:net';
import { type WebSocket, WebSocketServer } from 'ws';

export interface TestServer {
  port: number;
  close: () => void;
  onFrame: (cb: (socket: WebSocket, raw: string) => void) => void;
}

export async function createTestServer(): Promise<TestServer> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  let frameCb: (socket: WebSocket, raw: string) => void = () => {};

  wss.on('connection', (socket) => {
    socket.on('message', (data) => frameCb(socket, data.toString('utf8')));
  });

  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));

  return {
    port: (wss.address() as AddressInfo).port,
    close() {
      wss.close();
    },
    onFrame(cb) {
      frameCb = cb;
    },
  };
}
