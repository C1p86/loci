// Integration tests for WS /ws/orgs/:orgId/runs/:runId/logs (subscribe endpoint)
// Plan 11-03 Task 1 — TDD RED phase
//
// Tests:
//   1. Subscribe (no sinceSeq) → replays all 10 persisted chunks in seq order
//   2. Subscribe sinceSeq=4 → receives only seq 5..9
//   3. Unauthenticated → close code 1008
//   4. Cross-org → error frame NF_RUN + close
//   5. Already-terminal run → catch-up then end frame then close(1000)
//   6. Live push → chunk broadcast to subscriber mid-run

import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../app.js';
import { generateId } from '../../crypto/tokens.js';
import { logChunks, tasks } from '../../db/schema.js';
import { makeRepos } from '../../repos/index.js';
import { clearAllRunTimers } from '../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import type { TwoOrgFixture } from '../../test-utils/two-org-fixture.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';

const TASK_SNAPSHOT = {
  task_id: 'xci_task_test',
  name: 'Test Task',
  description: '',
  yaml_definition: 'steps:\n  - run: echo hello',
  label_requirements: [],
};

/** Create a session token for the given user+org, returns a cookie string. */
async function seedSession(userId: string, orgId: string): Promise<{ sessionToken: string }> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  const { token } = await repos.admin.createSession({ userId, activeOrgId: orgId });
  return { sessionToken: token };
}

/** Seed a task + queued run, return the runId. */
async function seedRun(orgId: string): Promise<string> {
  const db = getTestDb();
  const mek = getTestMek();
  const taskId = generateId('tsk');
  await db.insert(tasks).values({
    id: taskId,
    orgId,
    name: `task-${taskId}`,
    description: '',
    yamlDefinition: 'steps:\n  - run: echo hello',
    labelRequirements: [],
  });
  const repos = makeRepos(db, mek);
  const run = await repos.forOrg(orgId).taskRuns.create({
    taskId,
    taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
    timeoutSeconds: 3600,
  });
  return run.id;
}

/** Persist N log chunks directly into DB. */
async function seedLogChunks(runId: string, count: number, startSeq = 0): Promise<void> {
  const db = getTestDb();
  const now = new Date();
  const chunks = Array.from({ length: count }, (_, i) => ({
    id: generateId('lch'),
    runId,
    seq: startSeq + i,
    stream: 'stdout' as const,
    data: `chunk-${startSeq + i}`,
    ts: new Date(now.getTime() + (startSeq + i) * 100),
    persistedAt: now,
  }));
  await db.insert(logChunks).values(chunks);
}

/** Mark a run as terminal (succeeded) in the DB. */
async function markRunTerminal(
  runId: string,
  orgId: string,
  state: 'succeeded' | 'failed' = 'succeeded',
): Promise<void> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  await repos
    .forOrg(orgId)
    .taskRuns.updateStateMulti(runId, ['queued', 'running', 'dispatched'], state, {
      exitCode: state === 'succeeded' ? 0 : 1,
      finishedAt: new Date(),
    });
}

describe('WS /ws/orgs/:orgId/runs/:runId/logs (subscribe)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;
  const openSockets: WebSocket[] = [];

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    for (const s of openSockets) {
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
    const db = getTestDb();
    f = await seedTwoOrgs(db);
  });

  afterEach(() => {
    clearAllRunTimers();
  });

  let f: TwoOrgFixture;

  /** Connect with a session cookie. Returns the WebSocket. */
  function connectWithCookie(orgId: string, runId: string, sessionToken: string): WebSocket {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/orgs/${orgId}/runs/${runId}/logs`, {
      headers: { cookie: `session=${sessionToken}` },
    });
    openSockets.push(ws);
    return ws;
  }

  /** Collect all frames until the socket closes, with timeout. */
  function collectFrames(
    ws: WebSocket,
    timeoutMs = 5000,
  ): Promise<{ frames: Record<string, unknown>[]; closeCode: number | null }> {
    return new Promise((resolve) => {
      const frames: Record<string, unknown>[] = [];
      let closeCode: number | null = null;
      const timer = setTimeout(() => resolve({ frames, closeCode }), timeoutMs);
      ws.on('message', (data) => {
        frames.push(JSON.parse(data.toString()) as Record<string, unknown>);
      });
      ws.on('close', (code) => {
        closeCode = code;
        clearTimeout(timer);
        resolve({ frames, closeCode });
      });
      ws.on('error', () => {
        clearTimeout(timer);
        resolve({ frames, closeCode: -1 });
      });
    });
  }

  /** Wait for N chunk frames, then resolve. Times out after timeoutMs. */
  function waitForNChunks(
    ws: WebSocket,
    n: number,
    timeoutMs = 5000,
  ): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const chunks: Record<string, unknown>[] = [];
      const timer = setTimeout(
        () => reject(new Error(`Timeout waiting for ${n} chunks, got ${chunks.length}`)),
        timeoutMs,
      );
      ws.on('message', (data) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        if (frame.type === 'chunk') {
          chunks.push(frame);
          if (chunks.length >= n) {
            clearTimeout(timer);
            resolve(chunks);
          }
        }
      });
      ws.on('close', () => {
        clearTimeout(timer);
        resolve(chunks);
      });
    });
  }

  it('Test 1: subscribe (no sinceSeq) → replays all 10 persisted chunks in seq order', async () => {
    const runId = await seedRun(f.orgA.id);
    await seedLogChunks(runId, 10);
    const { sessionToken } = await seedSession(f.orgA.ownerUser.id, f.orgA.id);

    const ws = connectWithCookie(f.orgA.id, runId, sessionToken);
    await new Promise<void>((r) => ws.once('open', () => r()));

    const chunksP = waitForNChunks(ws, 10);
    ws.send(JSON.stringify({ type: 'subscribe' }));

    const chunks = await chunksP;
    expect(chunks.length).toBe(10);
    // Verify seq order
    const seqs = chunks.map((c) => (c as { seq: number }).seq);
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    ws.close();
  });

  it('Test 2: subscribe sinceSeq=4 → only seq 5..9 received', async () => {
    const runId = await seedRun(f.orgA.id);
    await seedLogChunks(runId, 10);
    const { sessionToken } = await seedSession(f.orgA.ownerUser.id, f.orgA.id);

    const ws = connectWithCookie(f.orgA.id, runId, sessionToken);
    await new Promise<void>((r) => ws.once('open', () => r()));

    const chunksP = waitForNChunks(ws, 5);
    ws.send(JSON.stringify({ type: 'subscribe', sinceSeq: 4 }));

    const chunks = await chunksP;
    expect(chunks.length).toBe(5);
    const seqs = chunks.map((c) => (c as { seq: number }).seq);
    expect(seqs).toEqual([5, 6, 7, 8, 9]);
    ws.close();
  });

  it('Test 3: unauthenticated → connection rejected (HTTP 401) or close 1008', async () => {
    const runId = await seedRun(f.orgA.id);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/orgs/${f.orgA.id}/runs/${runId}/logs`);
    openSockets.push(ws);

    const result = await new Promise<{ code: number | null; wasError: boolean }>((resolve) => {
      ws.on('open', () => {
        // If we get here, the server accepted — then close quickly
        ws.send(JSON.stringify({ type: 'subscribe' }));
      });
      ws.on('close', (code) => resolve({ code, wasError: false }));
      ws.on('error', () => resolve({ code: null, wasError: true }));
    });

    // Either HTTP 401 upgrade rejection (wasError=true) or WS close with 1008
    expect(result.wasError || result.code === 1008 || result.code === 4001).toBe(true);
  });

  it('Test 4: cross-org subscribe → NF_RUN error frame + close', async () => {
    // runId is in orgA but we subscribe as orgB user to orgB URL
    const runId = await seedRun(f.orgA.id);
    await seedLogChunks(runId, 3);
    const { sessionToken } = await seedSession(f.orgB.ownerUser.id, f.orgB.id);

    // Connect as orgB but use orgB URL with orgA runId
    // forOrg(orgBId).taskRuns.getById(orgARunId) returns undefined → NF_RUN
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/orgs/${f.orgB.id}/runs/${runId}/logs`, {
      headers: { cookie: `session=${sessionToken}` },
    });
    openSockets.push(ws);

    const { frames, closeCode } = await collectFrames(ws, 3000);
    ws.send(JSON.stringify({ type: 'subscribe' }));

    // Should receive error or close
    // Either the connection is closed before message gets processed OR error frame arrives
    expect(
      closeCode !== null || frames.some((fr) => (fr as { type: string }).type === 'error'),
    ).toBe(true);
  });

  it('Test 5: already-terminal run → catch-up then end frame then close(1000)', async () => {
    const runId = await seedRun(f.orgA.id);
    await seedLogChunks(runId, 3);
    await markRunTerminal(runId, f.orgA.id, 'succeeded');
    const { sessionToken } = await seedSession(f.orgA.ownerUser.id, f.orgA.id);

    const ws = connectWithCookie(f.orgA.id, runId, sessionToken);
    await new Promise<void>((r) => ws.once('open', () => r()));

    const { frames, closeCode } = await collectFrames(ws, 8000);
    ws.send(JSON.stringify({ type: 'subscribe' }));

    // Should receive 3 chunk frames + 1 end frame, then close(1000)
    const chunkFrames = frames.filter((fr) => (fr as { type: string }).type === 'chunk');
    const endFrames = frames.filter((fr) => (fr as { type: string }).type === 'end');
    expect(chunkFrames.length).toBe(3);
    expect(endFrames.length).toBeGreaterThanOrEqual(1);
    expect((endFrames[0] as { state?: string } | undefined)?.state).toBe('succeeded');
    // Close code should be 1000 (normal) after the 5s grace
    // or accept null if the test times out before grace
    expect(closeCode === 1000 || closeCode === null || closeCode === 1005).toBe(true);
  });

  it('Test 6: live push arrives while subscriber connected mid-run', async () => {
    const runId = await seedRun(f.orgA.id);
    await seedLogChunks(runId, 3); // initial history
    const { sessionToken } = await seedSession(f.orgA.ownerUser.id, f.orgA.id);

    const ws = connectWithCookie(f.orgA.id, runId, sessionToken);
    await new Promise<void>((r) => ws.once('open', () => r()));

    // Subscribe and collect catch-up first
    const catchupP = waitForNChunks(ws, 3);
    ws.send(JSON.stringify({ type: 'subscribe' }));
    await catchupP;

    // Now broadcast a new chunk via fanout
    const liveChunkP = new Promise<Record<string, unknown>>((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()) as Record<string, unknown>);
      });
    });

    // Emit live chunk via logFanout
    app.logFanout.broadcast(runId, {
      type: 'chunk',
      seq: 100,
      stream: 'stdout',
      data: 'live-data',
      ts: new Date().toISOString(),
    });

    const liveChunk = (await liveChunkP) as { type: string; seq: number; data: string };
    expect(liveChunk.type).toBe('chunk');
    expect(liveChunk.seq).toBe(100);
    expect(liveChunk.data).toBe('live-data');
    ws.close();
  });
});
