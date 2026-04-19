// Integration tests for tickDispatcher + dispatcherPlugin (Plan 10-03 Task 2).
// Tests 3-5, 7-10 require real DB via testcontainers.

import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../app.js';
import { makeAdminRepo } from '../../repos/admin.js';
import { makeRepos } from '../../repos/index.js';
import { makeTaskRunsRepo } from '../../repos/task-runs.js';
import { clearAllRunTimers } from '../../services/timeout-manager.js';
import { agents, taskRuns } from '../../db/schema.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import type { TaskSnapshot } from '../../ws/types.js';
import { tickDispatcher } from '../../services/dispatcher.js';

const TASK_SNAPSHOT: TaskSnapshot = {
  task_id: 'xci_task_test',
  name: 'Test Task',
  description: '',
  yaml_definition: 'steps:\n  - run: echo hello',
  label_requirements: [],
};

async function seedOnlineAgent(
  orgId: string,
  labels: Record<string, string> = {},
  maxConcurrent = 5,
): Promise<string> {
  const db = getTestDb();
  const admin = makeAdminRepo(db);
  const { agentId } = await admin.registerNewAgent({ orgId, hostname: 'h', labels });
  await db
    .update(agents)
    .set({ state: 'online', lastSeenAt: new Date(), maxConcurrent })
    .where(eq(agents.id, agentId));
  return agentId;
}

async function seedQueuedRun(orgId: string): Promise<string> {
  const db = getTestDb();
  const run = await makeTaskRunsRepo(db, orgId).create({
    taskId: 'xci_task_test',
    taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
    timeoutSeconds: 3600,
  });
  return run.id;
}

describe('tickDispatcher integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.ready();
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

  // Test 3: tick with matching online agent → dispatches
  it('Test 3: tick with matching online agent → DB dispatched + WS send called', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const agentId = await seedOnlineAgent(f.orgA.id);
    const runId = await seedQueuedRun(f.orgA.id);

    // Enqueue the run
    app.dispatchQueue.enqueue({
      runId,
      orgId: f.orgA.id,
      taskSnapshot: TASK_SNAPSHOT,
      params: {},
      labelRequirements: [],
      timeoutSeconds: 3600,
    });

    // Mock WS in registry
    const mockSend = vi.fn();
    app.agentRegistry.set(agentId, { readyState: 1, send: mockSend } as never);

    // Manually invoke tick
    await tickDispatcher(app);

    // Verify DB state
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('dispatched');
    expect(run?.agentId).toBe(agentId);
    expect(run?.dispatchedAt).not.toBeNull();

    // Verify dispatch frame sent
    expect(mockSend).toHaveBeenCalledOnce();
    const frame = JSON.parse(mockSend.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(frame.type).toBe('dispatch');
    expect(frame.run_id).toBe(runId);

    // Queue should be empty
    expect(app.dispatchQueue.getEntries()).toHaveLength(0);

    // Cleanup
    app.agentRegistry.delete(agentId);
  });

  // Test 4: tick with NO matching agent → run stays queued
  it('Test 4: tick with no matching agent → DB state still queued, queue unchanged', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    // Only os=linux agent available, run requires os=windows
    await seedOnlineAgent(f.orgA.id, { os: 'linux' });
    const runId = await seedQueuedRun(f.orgA.id);

    app.dispatchQueue.enqueue({
      runId,
      orgId: f.orgA.id,
      taskSnapshot: TASK_SNAPSHOT,
      params: {},
      labelRequirements: ['os=windows'],
      timeoutSeconds: 3600,
    });

    await tickDispatcher(app);

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('queued');
    expect(app.dispatchQueue.getEntries()).toHaveLength(1);
  });

  // Test 5: CAS race — run already dispatched before tick → silently dequeued
  it('Test 5: CAS loser (run already dispatched) → silently dequeued, no WS send', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const agentId = await seedOnlineAgent(f.orgA.id);
    const runId = await seedQueuedRun(f.orgA.id);

    // Manually transition run to dispatched before tick runs (simulating CAS race)
    await db
      .update(taskRuns)
      .set({ state: 'dispatched', agentId })
      .where(eq(taskRuns.id, runId));

    app.dispatchQueue.enqueue({
      runId,
      orgId: f.orgA.id,
      taskSnapshot: TASK_SNAPSHOT,
      params: {},
      labelRequirements: [],
      timeoutSeconds: 3600,
    });

    const mockSend = vi.fn();
    app.agentRegistry.set(agentId, { readyState: 1, send: mockSend } as never);

    await tickDispatcher(app);

    // CAS should have failed → no send, entry dequeued
    expect(mockSend).not.toHaveBeenCalled();
    expect(app.dispatchQueue.getEntries()).toHaveLength(0);

    app.agentRegistry.delete(agentId);
  });
});

describe('dispatcherPlugin + app.ts integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
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

  // Test 7: agentRegistry is available in onReady (no undefined errors)
  it('Test 7: dispatcherPlugin registered after fastifyWebsocket → agentRegistry available', () => {
    expect(app.agentRegistry).toBeDefined();
    expect(app.dispatchQueue).toBeDefined();
  });

  // Test 8: app.close triggers queue stop + clearAllRunTimers
  it('Test 8: app.close tears down queue and timers cleanly', async () => {
    const localApp = await buildApp({ logLevel: 'warn' });
    await localApp.ready();

    // Add a timer to confirm clearAllRunTimers is called on close
    const mockFastify = {
      db: localApp.db,
      mek: localApp.mek,
      agentRegistry: localApp.agentRegistry,
      log: localApp.log,
    } as never;

    const { registerRunTimer: rrt } = await import('../../services/timeout-manager.js');
    rrt(mockFastify, 'close-test-run', 'org-close', 3600);

    // close should not hang (timers cleared via clearAllRunTimers in onClose)
    await expect(localApp.close()).resolves.toBeUndefined();
  });

  // Test 9: integration happy path — wait 300ms for one tick
  it('Test 9: happy path — queued run dispatched within 300ms tick', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const agentId = await seedOnlineAgent(f.orgA.id);
    const runId = await seedQueuedRun(f.orgA.id);

    const mockSend = vi.fn();
    app.agentRegistry.set(agentId, { readyState: 1, send: mockSend } as never);

    app.dispatchQueue.enqueue({
      runId,
      orgId: f.orgA.id,
      taskSnapshot: TASK_SNAPSHOT,
      params: {},
      labelRequirements: [],
      timeoutSeconds: 3600,
    });

    // Wait for 300ms (enough for at least one 250ms tick)
    await new Promise((r) => setTimeout(r, 400));

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('dispatched');
    expect(mockSend).toHaveBeenCalledOnce();

    app.agentRegistry.delete(agentId);
  });

  // Test 10: round-robin — 3 runs distributed across 2 tied agents
  it('Test 10: round-robin — 3 runs alternate between 2 tied agents', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const agent1 = await seedOnlineAgent(f.orgA.id);
    const agent2 = await seedOnlineAgent(f.orgA.id);
    const run1 = await seedQueuedRun(f.orgA.id);
    const run2 = await seedQueuedRun(f.orgA.id);
    const run3 = await seedQueuedRun(f.orgA.id);

    const sent1: string[] = [];
    const sent2: string[] = [];
    app.agentRegistry.set(agent1, {
      readyState: 1,
      send: (d: string) => sent1.push(d),
    } as never);
    app.agentRegistry.set(agent2, {
      readyState: 1,
      send: (d: string) => sent2.push(d),
    } as never);

    // Enqueue all 3 and manually tick 3 times to observe rotation
    const entry = (runId: string) => ({
      runId,
      orgId: f.orgA.id,
      taskSnapshot: TASK_SNAPSHOT,
      params: {},
      labelRequirements: [],
      timeoutSeconds: 3600,
    });
    app.dispatchQueue.enqueue(entry(run1));
    await tickDispatcher(app);
    // After first dispatch, re-mark run as queued so selector can still find agents
    // (actual test: just verify the cursor rotated — agents alternate)
    app.dispatchQueue.enqueue(entry(run2));
    await tickDispatcher(app);
    app.dispatchQueue.enqueue(entry(run3));
    await tickDispatcher(app);

    // Total dispatches = 3; should be split 2/1 or 1/2 (not all to one agent)
    const totalSent = sent1.length + sent2.length;
    expect(totalSent).toBe(3);
    // At least one dispatch to each agent (round-robin)
    expect(sent1.length).toBeGreaterThanOrEqual(1);
    expect(sent2.length).toBeGreaterThanOrEqual(1);

    app.agentRegistry.delete(agent1);
    app.agentRegistry.delete(agent2);
  });
});
