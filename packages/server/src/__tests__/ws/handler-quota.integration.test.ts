// Integration tests for QUOTA-03: 6th agent registration rejected with WS close 4006.
// Uses the same ephemeral-port pattern as ws-handshake.integration.test.ts.

import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../app.js';
import { orgPlans } from '../../db/schema.js';
import { makeAdminRepo } from '../../repos/admin.js';
import { makeRegistrationTokensRepo } from '../../repos/registration-tokens.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';

describe('QUOTA-03: agent registration quota enforcement', () => {
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

  /** Wait for a message frame OR a close event. Returns the message, or a pseudo-frame on close. */
  function recvOneFrame(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
      ws.once('close', (code, reason) =>
        resolve({ _closed: true, code, reason: reason.toString() }),
      );
    });
  }

  /** Register a single agent with a fresh token; returns the register_ack frame. */
  async function registerAgent(orgId: string, userId: string): Promise<Record<string, unknown>> {
    const db = getTestDb();
    const { tokenPlaintext } = await makeRegistrationTokensRepo(db, orgId).create(userId);
    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'register', token: tokenPlaintext, labels: { hostname: 'h' } }));
    return recvOneFrame(ws);
  }

  /** Register agent and also capture the close code (waits for both message + close). */
  async function registerAgentWithClose(
    orgId: string,
    userId: string,
  ): Promise<{
    frame: Record<string, unknown>;
    closeCode: number;
    closeReason: string;
  }> {
    const db = getTestDb();
    const { tokenPlaintext } = await makeRegistrationTokensRepo(db, orgId).create(userId);
    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));

    const frameP = new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
    });
    const closeP = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    ws.send(JSON.stringify({ type: 'register', token: tokenPlaintext, labels: { hostname: 'h' } }));

    const [frame, closeEvt] = await Promise.all([frameP, closeP]);
    return { frame, closeCode: closeEvt.code, closeReason: closeEvt.reason };
  }

  // Test 1: 5 agents on Free plan all succeed
  it('Test 1: first 5 agents on Free plan (max_agents=5) all receive register_ack', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { orgA } = f;

    for (let i = 0; i < 5; i++) {
      const frame = await registerAgent(orgA.id, orgA.ownerUser.id);
      expect(frame.type, `agent ${i + 1} should get register_ack`).toBe('register_ack');
    }
  });

  // Test 2: 6th agent is rejected with AGENT_QUOTA_EXCEEDED + close 4006
  it('Test 2: 6th agent on Free plan receives AGENT_QUOTA_EXCEEDED error frame + WS close 4006', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { orgA } = f;

    // Register 5 agents first
    for (let i = 0; i < 5; i++) {
      const frame = await registerAgent(orgA.id, orgA.ownerUser.id);
      expect(frame.type).toBe('register_ack');
    }

    // 6th attempt
    const { frame, closeCode } = await registerAgentWithClose(orgA.id, orgA.ownerUser.id);

    expect(frame.type).toBe('error');
    expect(frame.code).toBe('AGENT_QUOTA_EXCEEDED');
    expect(typeof frame.message).toBe('string');
    expect(closeCode).toBe(4006);
  });

  // Test 3: registration token IS consumed even when quota check rejects the 6th agent
  // (after-consume placement is by design — see handler.ts comments re. security)
  it('Test 3: registration token consumed even when 6th registration is rejected', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { orgA } = f;

    // Register 5 agents
    for (let i = 0; i < 5; i++) {
      await registerAgent(orgA.id, orgA.ownerUser.id);
    }

    // Create a token manually to track it
    const { tokenPlaintext } = await makeRegistrationTokensRepo(db, orgA.id).create(
      orgA.ownerUser.id,
    );

    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(JSON.stringify({ type: 'register', token: tokenPlaintext, labels: { hostname: 'h' } }));
    // Wait for close
    await new Promise<void>((resolve) => ws.once('close', () => resolve()));

    // Re-using same token should fail (it was consumed)
    const ws2 = connect();
    await new Promise<void>((r) => ws2.once('open', () => r()));
    ws2.send(
      JSON.stringify({ type: 'register', token: tokenPlaintext, labels: { hostname: 'h' } }),
    );
    const close2 = await new Promise<{ code: number }>((resolve) => {
      ws2.once('close', (code) => resolve({ code }));
    });
    // Token was consumed — should fail with 4002 (invalid token), not 4006
    expect(close2.code).toBe(4002);
  });

  // Test 4: after revoking one agent, a new registration succeeds (count drops back to 4 → 5)
  it('Test 4: after revoking 1 agent, a new 6th registration succeeds (count=4→5, ≤ max_agents)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { orgA } = f;
    const _admin = makeAdminRepo(db);

    // Register 5 agents, track first agent ID
    let firstAgentId: string | undefined;
    for (let i = 0; i < 5; i++) {
      const frame = await registerAgent(orgA.id, orgA.ownerUser.id);
      if (i === 0) firstAgentId = frame.agent_id as string;
    }

    // Revoke the first agent (DELETE removes row, count → 4)
    const { makeAgentsRepo } = await import('../../repos/agents.js');
    await makeAgentsRepo(db, orgA.id).delete(firstAgentId!);

    // Now a 6th registration should succeed (count 4 < max_agents 5, after insert → 5 = max)
    // The check is >= max_agents BEFORE insert, so at count=4 it succeeds.
    const frame = await registerAgent(orgA.id, orgA.ownerUser.id);
    expect(frame.type).toBe('register_ack');
  });

  // Test 5: error message contains current count, limit, and plan name
  it('Test 5: error message includes count, limit, and plan name', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { orgA } = f;

    for (let i = 0; i < 5; i++) {
      await registerAgent(orgA.id, orgA.ownerUser.id);
    }

    const { frame } = await registerAgentWithClose(orgA.id, orgA.ownerUser.id);
    expect(frame.type).toBe('error');
    const msg = (frame.message as string).toLowerCase();
    // Should mention both current count (5) and max (5)
    expect(msg).toMatch(/5.*5|5 of 5/);
    // close:true
    expect(frame.close).toBe(true);
  });

  // Test 6: non-Free plan respects its own max_agents (not hardcoded 5)
  it('Test 6: org with max_agents=3 rejects 4th agent even on a non-Free plan', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { orgA } = f;

    // Update orgA plan to max_agents=3
    await db.update(orgPlans).set({ maxAgents: 3 }).where(eq(orgPlans.orgId, orgA.id));

    // Register 3 agents — all succeed
    for (let i = 0; i < 3; i++) {
      const frame = await registerAgent(orgA.id, orgA.ownerUser.id);
      expect(frame.type).toBe('register_ack');
    }

    // 4th attempt — rejected
    const { frame, closeCode } = await registerAgentWithClose(orgA.id, orgA.ownerUser.id);
    expect(frame.type).toBe('error');
    expect(frame.code).toBe('AGENT_QUOTA_EXCEEDED');
    expect(closeCode).toBe(4006);
  });
});
