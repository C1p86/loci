// ATOK-03 security regression test: token in URL query param must be IGNORED.
// The server must NOT authenticate via URL token — auth is first-frame-only.

import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../../app.js';

describe('ATOK-03: token in URL must be ignored', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('URL ?token=X is ignored — invalid reconnect credential closes 4001', async () => {
    // Connect with a fake token in the URL — this should be completely ignored by the server
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent?token=fake-url-token`);
    await new Promise<void>((r) => ws.once('open', () => r()));

    // Send reconnect with bogus credential — URL token was not used for auth
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: 'not-a-real-credential', running_runs: [] }),
    );

    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.once('close', (code) => resolve({ code }));
    });

    // 4001 = revoked/not-found (credential not in DB), proves URL token was not accepted
    expect([4001, 4002]).toContain(closeEvent.code);
    ws.terminate();
  });

  it('URL token does not bypass handshake timeout — silence → 4005', async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/ws/agent?token=fake-url-token&credential=also-fake`,
    );
    await new Promise<void>((r) => ws.once('open', () => r()));

    // Send nothing — server must still timeout at 5s
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.once('close', (code) => resolve({ code }));
    });
    expect(closeEvent.code).toBe(4005);
    ws.terminate();
  }, 10_000);
});
