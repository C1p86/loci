// Integration tests for authenticated frame routing: state/result/log_chunk handlers.
// Covers frame-spoofing guard (verifyBelongsToOrg) and CAS state machine transitions.
// Requires Docker (testcontainers) — skipped in environments without container runtime.

import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../app.js';
import { makeAdminRepo } from '../../repos/admin.js';
import { makeRepos } from '../../repos/index.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import type { TaskSnapshot } from '../../ws/types.js';

const TASK_SNAPSHOT: TaskSnapshot = {
  task_id: 'xci_task_test',
  name: 'Test Task',
  description: 'Integration test task',
  yaml_definition: 'steps:\n  - run: echo hello',
  label_requirements: [],
};

describe('WS authenticated frame routing (state/result/log_chunk)', () => {
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
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as Record<string, unknown>));
      ws.once('close', (code, reason) =>
        resolve({ _closed: true, code, reason: reason.toString() }),
      );
    });
  }

  /** Authenticate an agent via reconnect frame, return the authenticated WS. */
  async function authenticateAgent(credentialPlaintext: string): Promise<WebSocket> {
    const ws = connect();
    await new Promise<void>((r) => ws.once('open', () => r()));
    ws.send(
      JSON.stringify({ type: 'reconnect', credential: credentialPlaintext, running_runs: [] }),
    );
    await recvOneFrame(ws); // consume reconnect_ack
    return ws;
  }

  /** Create a task_run in the given state and return the run ID. */
  async function seedRun(orgId: string, agentId: string, state: string): Promise<string> {
    const db = getTestDb();
    const mek = getTestMek();
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(orgId).taskRuns.create({
      taskId: 'xci_task_test',
      taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
      timeoutSeconds: 3600,
    });
    // Update to requested state + agentId using raw Drizzle
    const { taskRuns } = await import('../../db/schema.js');
    const { eq } = await import('drizzle-orm');
    await db
      .update(taskRuns)
      .set({ state: state as never, agentId })
      .where(eq(taskRuns.id, run.id));
    return run.id;
  }

  // Test 1: state frame promotes dispatched → running
  it('Test 1: state frame (state:running) transitions dispatched→running with started_at', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const runId = await seedRun(f.orgA.id, agentId, 'dispatched');
    const ws = await authenticateAgent(credentialPlaintext);

    ws.send(JSON.stringify({ type: 'state', state: 'running', run_id: runId }));
    // Give server time to process
    await new Promise((r) => setTimeout(r, 100));

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('running');
    expect(run?.startedAt).not.toBeNull();
  });

  // Test 2: result frame exit_code=0 → succeeded
  it('Test 2: result frame with exit_code=0 transitions running→succeeded', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const runId = await seedRun(f.orgA.id, agentId, 'running');
    const ws = await authenticateAgent(credentialPlaintext);

    ws.send(JSON.stringify({ type: 'result', run_id: runId, exit_code: 0, duration_ms: 500 }));
    await new Promise((r) => setTimeout(r, 100));

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('succeeded');
    expect(run?.exitCode).toBe(0);
    expect(run?.finishedAt).not.toBeNull();
  });

  // Test 3: result frame exit_code=1 → failed
  it('Test 3: result frame with exit_code=1 transitions running→failed', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const runId = await seedRun(f.orgA.id, agentId, 'running');
    const ws = await authenticateAgent(credentialPlaintext);

    ws.send(JSON.stringify({ type: 'result', run_id: runId, exit_code: 1, duration_ms: 200 }));
    await new Promise((r) => setTimeout(r, 100));

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('failed');
    expect(run?.exitCode).toBe(1);
  });

  // Test 4: result frame with cancelled:true → cancelled
  it('Test 4: result frame with cancelled:true transitions running→cancelled', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const runId = await seedRun(f.orgA.id, agentId, 'running');
    const ws = await authenticateAgent(credentialPlaintext);

    ws.send(
      JSON.stringify({
        type: 'result',
        run_id: runId,
        exit_code: 130,
        duration_ms: 100,
        cancelled: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 100));

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('cancelled');
    expect(run?.exitCode).toBe(130);
  });

  // Test 5: result frame for terminal run is silent no-op
  it('Test 5: result frame for already-terminal (timed_out) run is silent no-op', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const runId = await seedRun(f.orgA.id, agentId, 'timed_out');
    const ws = await authenticateAgent(credentialPlaintext);

    ws.send(JSON.stringify({ type: 'result', run_id: runId, exit_code: 0, duration_ms: 10 }));
    await new Promise((r) => setTimeout(r, 100));

    // DB state unchanged — still timed_out
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('timed_out');
  });

  // Test 6: frame-spoofing guard — agent in orgB sends result for orgA's run
  it('Test 6: frame-spoofing — agent B sends result for org A run → error frame + DB unchanged', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);

    // Create run in orgA with agentA
    const { agentId: agentAId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'hA',
      labels: {},
    });
    const runAId = await seedRun(f.orgA.id, agentAId, 'running');

    // Open WS as agentB (orgB)
    const { credentialPlaintext: credB } = await admin.registerNewAgent({
      orgId: f.orgB.id,
      hostname: 'hB',
      labels: {},
    });
    const wsB = await authenticateAgent(credB);

    // agentB sends result for orgA's run — frame spoofing attempt
    const errorP = recvOneFrame(wsB);
    wsB.send(JSON.stringify({ type: 'result', run_id: runAId, exit_code: 0, duration_ms: 1 }));
    const errFrame = await errorP;

    // Server sends AUTHZ_RUN_CROSS_ORG error frame (close:false — connection kept)
    expect(errFrame.type).toBe('error');
    expect(errFrame.code).toBe('AUTHZ_RUN_CROSS_ORG');
    expect(errFrame.close).toBe(false);

    // DB unchanged — orgA's run still running
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runAId);
    expect(run?.state).toBe('running');
  });

  // Test 7: log_chunk frames discarded without DB write
  it('Test 7: log_chunk frames discarded — DB state unchanged, no crash', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const runId = await seedRun(f.orgA.id, agentId, 'running');
    const ws = await authenticateAgent(credentialPlaintext);

    // Send 10 log_chunk frames rapidly
    for (let i = 0; i < 10; i++) {
      ws.send(
        JSON.stringify({
          type: 'log_chunk',
          run_id: runId,
          seq: i,
          stream: 'stdout',
          data: `line ${i}`,
          ts: new Date().toISOString(),
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 200));

    // DB state unchanged — still running
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('running');
  });

  // Test 8: recordHeartbeat NOT called on log_chunk (Pitfall 7)
  // This is tested implicitly — if log_chunk triggered recordHeartbeat, we'd see DB writes.
  // We verify last_seen_at does NOT change on log_chunk frames (compared to a non-log_chunk frame).
  it('Test 8: last_seen_at not updated by log_chunk frames (Pitfall 7)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });

    const runId = await seedRun(f.orgA.id, agentId, 'running');
    const ws = await authenticateAgent(credentialPlaintext);

    // Read initial last_seen_at
    const { agents: agentsTable } = await import('../../db/schema.js');
    const { eq: eqDrizzle } = await import('drizzle-orm');
    const before = await db
      .select({ lastSeenAt: agentsTable.lastSeenAt })
      .from(agentsTable)
      .where(eqDrizzle(agentsTable.id, agentId))
      .limit(1);
    const beforeTs = before[0]?.lastSeenAt;

    // Send 5 log_chunk frames
    for (let i = 0; i < 5; i++) {
      ws.send(
        JSON.stringify({
          type: 'log_chunk',
          run_id: runId,
          seq: i,
          stream: 'stdout',
          data: 'x',
          ts: new Date().toISOString(),
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 200));

    const after = await db
      .select({ lastSeenAt: agentsTable.lastSeenAt })
      .from(agentsTable)
      .where(eqDrizzle(agentsTable.id, agentId))
      .limit(1);
    const afterTs = after[0]?.lastSeenAt;

    // last_seen_at should NOT have changed (log_chunk skips recordHeartbeat)
    expect(afterTs?.getTime()).toBe(beforeTs?.getTime());
  });

  // Test 9: Phase 8 reconnect test regression — reconciliation stub still empty
  it('Test 9: reconnect_ack still returns empty reconciliation (Phase 8 stub unchanged)', async () => {
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
});
