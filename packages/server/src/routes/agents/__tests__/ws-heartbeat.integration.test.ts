// Heartbeat & registry lifecycle integration tests.
// Verifies: after handshake agentRegistry has the entry; on WS close it is removed and state=offline.

import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../../app.js';
import { makeAdminRepo } from '../../../repos/admin.js';
import { makeAgentsRepo } from '../../../repos/agents.js';
import { getTestDb, resetDb } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

describe('heartbeat & registry lifecycle', () => {
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

  beforeEach(async () => resetDb());

  it('after handshake, agentRegistry contains the agentId', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );
    // Wait for reconnect_ack
    await new Promise<void>((r) => ws.once('message', () => r()));

    expect(app.agentRegistry.has(agentId)).toBe(true);

    // Close the WS and verify cleanup
    ws.close(1000, 'test done');
    await new Promise<void>((r) => ws.once('close', () => r()));
    // Allow the server async close handler to run
    await new Promise((r) => setTimeout(r, 150));

    expect(app.agentRegistry.has(agentId)).toBe(false);

    const agent = await makeAgentsRepo(db, f.orgA.id).getById(agentId);
    expect(agent?.state).toBe('offline');
  });

  it('second connection with same agentId supersedes first (close 4004)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    // First connection
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    await new Promise<void>((r) => ws1.once('open', () => r()));
    ws1.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );
    await new Promise<void>((r) => ws1.once('message', () => r())); // reconnect_ack

    expect(app.agentRegistry.has(agentId)).toBe(true);

    // Capture the close event on the first connection
    const firstClose = new Promise<{ code: number }>((resolve) => {
      ws1.once('close', (code) => resolve({ code }));
    });

    // Second connection with same credential — supersedes first
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    await new Promise<void>((r) => ws2.once('open', () => r()));
    ws2.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );
    await new Promise<void>((r) => ws2.once('message', () => r())); // reconnect_ack

    const { code } = await firstClose;
    expect(code).toBe(4004); // superseded

    // Registry now points to ws2
    expect(app.agentRegistry.has(agentId)).toBe(true);

    ws2.terminate();
  });
});
