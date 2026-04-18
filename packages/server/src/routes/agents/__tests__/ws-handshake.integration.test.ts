// WS handshake integration tests — D-14..D-18.
// Uses ephemeral-port pattern (D-31): app.listen({port:0}) + WebSocket client.
// Tests: register, reconnect, revoke, timeout, bad JSON, goodbye.

import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../../app.js';
import { makeAdminRepo } from '../../../repos/admin.js';
import { makeAgentCredentialsRepo } from '../../../repos/agent-credentials.js';
import { makeRegistrationTokensRepo } from '../../../repos/registration-tokens.js';
import { getTestDb, resetDb } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

describe('agent WS handshake (D-14..D-18)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const s of sockets) {
      try {
        s.terminate();
      } catch {}
    }
    await app.close();
  });

  beforeEach(async () => resetDb());

  function connect(): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    sockets.push(ws);
    return ws;
  }

  function recvOneFrame(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
      ws.once('error', reject);
      ws.once('close', (code, reason) =>
        resolve({ _closed: true, code, reason: reason.toString() }),
      );
    });
  }

  it('register with valid token → register_ack with agent_id + credential', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { tokenPlaintext } = await makeRegistrationTokensRepo(db, f.orgA.id).create(
      f.orgA.ownerUser.id,
    );

    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'register', token: tokenPlaintext, labels: { os: 'linux', hostname: 'h' } }),
    );

    const frame = await recvOneFrame(ws);
    expect(frame.type).toBe('register_ack');
    expect(String(frame.agent_id)).toMatch(/^xci_agt_/);
    expect(typeof frame.credential).toBe('string');
    expect((frame.credential as string).length).toBeGreaterThanOrEqual(40);
  });

  it('reconnect with valid credential → reconnect_ack with empty reconciliation (D-18)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );

    const frame = await recvOneFrame(ws);
    expect(frame.type).toBe('reconnect_ack');
    expect(Array.isArray(frame.reconciliation)).toBe(true);
    expect(frame.reconciliation).toEqual([]);
  });

  it('reconnect with revoked credential → close 4001 (ATOK-05)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    // Revoke the credential
    await makeAgentCredentialsRepo(db, f.orgA.id).revokeForAgent(agentId);

    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );

    const closeEvent = await new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });
    expect(closeEvent.code).toBe(4001);
  });

  it('handshake timeout → close 4005 after 5s of silence', async () => {
    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    // Do NOT send any frame — wait for the server's 5s timeout
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.once('close', (code) => resolve({ code }));
    });
    expect(closeEvent.code).toBe(4005);
  }, 10_000);

  it('invalid JSON first frame → close 4002 (frame_invalid)', async () => {
    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send('{not-json');
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.once('close', (code) => resolve({ code }));
    });
    expect(closeEvent.code).toBe(4002);
  });

  it('register with invalid/expired token → close 4002', async () => {
    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'register', token: 'not-a-real-token', labels: { hostname: 'h' } }),
    );
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.once('close', (code) => resolve({ code }));
    });
    expect(closeEvent.code).toBe(4002);
  });

  it('goodbye from authenticated agent → close 1000 normal', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );
    await recvOneFrame(ws); // reconnect_ack

    ws.send(JSON.stringify({ type: 'goodbye', running_runs: [] }));
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.once('close', (code) => resolve({ code }));
    });
    expect(closeEvent.code).toBe(1000);
  });
});
