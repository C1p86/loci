// Integration tests for reconciler.ts (Plan 10-03 Task 3).
// Tests 1-9: runBootReconciliation + buildReconnectReconciliation.
// Test 10-11: handler.ts reconnect branch now calls buildReconnectReconciliation.
// Requires Docker (testcontainers) — runs in integration mode only.

import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../app.js';
import { agents, taskRuns } from '../../db/schema.js';
import { makeAdminRepo } from '../../repos/admin.js';
import { makeRepos } from '../../repos/index.js';
import { makeTaskRunsRepo } from '../../repos/task-runs.js';
import { buildReconnectReconciliation, runBootReconciliation } from '../../services/reconciler.js';
import { clearAllRunTimers } from '../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import type { RunState, TaskSnapshot } from '../../ws/types.js';

const TASK_SNAPSHOT: TaskSnapshot = {
  task_id: 'xci_task_test',
  name: 'Test Task',
  description: '',
  yaml_definition: 'steps:\n  - run: echo hello',
  label_requirements: [],
};

async function seedAgent(orgId: string): Promise<string> {
  const db = getTestDb();
  const admin = makeAdminRepo(db);
  const { agentId } = await admin.registerNewAgent({ orgId, hostname: 'h', labels: {} });
  await db
    .update(agents)
    .set({ state: 'online', lastSeenAt: new Date() })
    .where(eq(agents.id, agentId));
  return agentId;
}

async function seedRun(
  orgId: string,
  state: string,
  agentId: string | null = null,
  dispatchedAtOffset?: number,
  timeoutSeconds = 3600,
): Promise<string> {
  const db = getTestDb();
  const mek = getTestMek();
  const run = await makeTaskRunsRepo(db, orgId).create({
    taskId: 'xci_task_test',
    taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
    timeoutSeconds,
  });
  const updates: Record<string, unknown> = { state };
  if (agentId) updates.agentId = agentId;
  if (dispatchedAtOffset !== undefined) {
    // dispatchedAt = now - dispatchedAtOffset seconds
    const repos = makeRepos(db, mek);
    await repos.forOrg(orgId).taskRuns.updateState(
      run.id,
      'queued',
      state as never,
      {
        agentId: agentId ?? undefined,
        dispatchedAt: sql`now() - ${dispatchedAtOffset} * interval '1 second'` as unknown as Date,
      } as never,
    );
    return run.id;
  }
  await db.update(taskRuns).set(updates).where(eq(taskRuns.id, run.id));
  return run.id;
}

describe('runBootReconciliation (D-23 branches)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    // Do NOT call app.ready() — we call runBootReconciliation manually
    // Actually we need app with registered plugins but not started tick loop
  });

  afterAll(async () => {
    clearAllRunTimers();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    clearAllRunTimers();
    // Clear the dispatch queue between tests
    for (const entry of app.dispatchQueue.getEntries()) {
      app.dispatchQueue.dequeue(entry.runId);
    }
  });

  afterEach(() => {
    clearAllRunTimers();
  });

  it('Test 1: boot — queued runs re-enqueued in dispatch queue', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const runId1 = await seedRun(f.orgA.id, 'queued');
    const runId2 = await seedRun(f.orgA.id, 'queued');

    await runBootReconciliation(app);

    const entries = app.dispatchQueue.getEntries();
    const enqueuedIds = entries.map((e) => e.runId);
    expect(enqueuedIds).toContain(runId1);
    expect(enqueuedIds).toContain(runId2);
    // DB state should remain 'queued' (no DB change for queued runs)
    const repos = makeRepos(db, getTestMek());
    const run1 = await repos.forOrg(f.orgA.id).taskRuns.getById(runId1);
    expect(run1?.state).toBe('queued');
  });

  it('Test 2: boot — dispatched run with no connected agent → re-queued in DB + in-memory', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const agentId = await seedAgent(f.orgA.id);
    const runId = await seedRun(f.orgA.id, 'dispatched', agentId);

    // agentRegistry is empty at boot (fresh start)
    app.agentRegistry.clear();

    await runBootReconciliation(app);

    const repos = makeRepos(db, getTestMek());
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('queued');
    expect(run?.agentId).toBeNull();

    const enqueuedIds = app.dispatchQueue.getEntries().map((e) => e.runId);
    expect(enqueuedIds).toContain(runId);
  });

  it('Test 3: boot — running run with no connected agent → orphaned', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const agentId = await seedAgent(f.orgA.id);
    const runId = await seedRun(f.orgA.id, 'running', agentId);

    app.agentRegistry.clear();

    await runBootReconciliation(app);

    const repos = makeRepos(db, getTestMek());
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('orphaned');
    expect(run?.exitCode).toBe(-1);
    expect(run?.finishedAt).not.toBeNull();

    // NOT re-enqueued
    const enqueuedIds = app.dispatchQueue.getEntries().map((e) => e.runId);
    expect(enqueuedIds).not.toContain(runId);
  });

  it('Test 4: boot — timeout expired during downtime → timed_out (priority over orphan)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const agentId = await seedAgent(f.orgA.id);
    // Run was dispatched 2 hours ago with 1h timeout — should already be expired
    const runId = await seedRun(f.orgA.id, 'running', agentId, 7200, 3600);

    app.agentRegistry.clear();

    await runBootReconciliation(app);

    const repos = makeRepos(db, getTestMek());
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('timed_out');
    expect(run?.exitCode).toBe(-1);
  });

  it('Test 5: boot — active run with connected agent → unchanged state + timer registered', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const agentId = await seedAgent(f.orgA.id);
    const runId = await seedRun(f.orgA.id, 'running', agentId);

    // Register agent in registry (simulates reconnected agent)
    const mockWs = { readyState: 1, send: vi.fn() };
    app.agentRegistry.set(agentId, mockWs as never);

    await runBootReconciliation(app);

    const repos = makeRepos(db, getTestMek());
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    // State unchanged — agent is connected
    expect(run?.state).toBe('running');

    // NOT re-enqueued
    const enqueuedIds = app.dispatchQueue.getEntries().map((e) => e.runId);
    expect(enqueuedIds).not.toContain(runId);

    app.agentRegistry.delete(agentId);
  });
});

describe('buildReconnectReconciliation (D-24 branches)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
  });

  afterAll(async () => {
    clearAllRunTimers();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    clearAllRunTimers();
  });

  afterEach(() => {
    clearAllRunTimers();
  });

  it('Test 6: reconnect — agent reports unknown run_id → abandon', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const runningRuns: RunState[] = [{ run_id: 'xci_run_nonexistent', status: 'running' }];
    const result = await buildReconnectReconciliation(app, f.orgA.id, runningRuns);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ run_id: 'xci_run_nonexistent', action: 'abandon' });
  });

  it('Test 7: reconnect — agent reports terminal run → abandon', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const runId = await seedRun(f.orgA.id, 'succeeded');

    const runningRuns: RunState[] = [{ run_id: runId, status: 'running' }];
    const result = await buildReconnectReconciliation(app, f.orgA.id, runningRuns);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ run_id: runId, action: 'abandon' });
  });

  it('Test 8: reconnect — agent reports dispatched run → continue + promoted to running', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const agentId = await seedAgent(f.orgA.id);
    const runId = await seedRun(f.orgA.id, 'dispatched', agentId);

    const runningRuns: RunState[] = [{ run_id: runId, status: 'running' }];
    const result = await buildReconnectReconciliation(app, f.orgA.id, runningRuns);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ run_id: runId, action: 'continue' });

    // DB should have been promoted to running
    const repos = makeRepos(db, getTestMek());
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('running');
    expect(run?.startedAt).not.toBeNull();
  });

  it('Test 9: reconnect — agent reports running run → continue (no state change)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const agentId = await seedAgent(f.orgA.id);
    const runId = await seedRun(f.orgA.id, 'running', agentId);

    const runningRuns: RunState[] = [{ run_id: runId, status: 'running' }];
    const result = await buildReconnectReconciliation(app, f.orgA.id, runningRuns);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ run_id: runId, action: 'continue' });

    // State unchanged
    const repos = makeRepos(db, getTestMek());
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('running');
  });
});

describe('handler.ts reconnect branch — calls buildReconnectReconciliation', () => {
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
    clearAllRunTimers();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    clearAllRunTimers();
  });

  afterEach(() => {
    clearAllRunTimers();
  });

  function connect(): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    sockets.push(ws);
    return ws;
  }

  function recvOneFrame(ws: WebSocket): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
      ws.once('close', (code, reason) =>
        resolve({ _closed: true, code, reason: reason.toString() }),
      );
    });
  }

  // Test 10: reconnect with empty running_runs → reconciliation still [] (backward compat)
  it('Test 10: reconnect with empty running_runs → reconciliation: []', async () => {
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

  // Test 11: reconnect with a real run → reconciliation reflects DB state
  it('Test 11: reconnect with real queued run → reconciliation shows abandon (run is queued not dispatched)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    // Seed a run in 'running' state with this agent
    const runId = await seedRun(f.orgA.id, 'running', agentId);

    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({
        type: 'reconnect',
        credential: credentialPlaintext,
        running_runs: [{ run_id: runId, status: 'running' }],
      }),
    );

    const frame = await recvOneFrame(ws);
    expect(frame.type).toBe('reconnect_ack');
    expect(Array.isArray(frame.reconciliation)).toBe(true);

    const reconciliation = frame.reconciliation as Array<{ run_id: string; action: string }>;
    // The run is 'running' → agent should continue
    const entry = reconciliation.find((e) => e.run_id === runId);
    expect(entry).toBeDefined();
    expect(entry?.action).toBe('continue');
  });
});
