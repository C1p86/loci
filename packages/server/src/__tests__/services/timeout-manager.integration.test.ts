// Integration tests for timeout-manager handleRunTimeout (Plan 10-03 Task 1).
// Tests 5-7: require real Postgres via testcontainers.
// Run with: pnpm test:integration

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAdminRepo } from '../../repos/admin.js';
import { makeTaskRunsRepo } from '../../repos/task-runs.js';
import { makeRepos } from '../../repos/index.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { taskRuns } from '../../db/schema.js';
import type { TaskSnapshot } from '../../ws/types.js';
import {
  cancelRunTimer,
  clearAllRunTimers,
  registerRunTimer,
} from '../../services/timeout-manager.js';

const TASK_SNAPSHOT: TaskSnapshot = {
  task_id: 'xci_task_test',
  name: 'Test Task',
  description: 'Integration test task',
  yaml_definition: 'steps:\n  - run: echo hello',
  label_requirements: [],
};

describe('timeout-manager — handleRunTimeout (real DB)', () => {
  beforeEach(async () => {
    clearAllRunTimers();
    await resetDb();
  });

  afterEach(() => {
    clearAllRunTimers();
    vi.useRealTimers();
  });

  it('Test 5: handleRunTimeout CAS transitions dispatched→timed_out', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h1',
      labels: {},
    });

    // Seed a run in dispatched state
    const runRow = await makeTaskRunsRepo(db, f.orgA.id).create({
      taskId: 'xci_task_test',
      taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
      timeoutSeconds: 3600,
    });
    await db
      .update(taskRuns)
      .set({ state: 'dispatched', agentId })
      .where(eq(taskRuns.id, runRow.id));

    const mockFastify = {
      db,
      mek,
      agentRegistry: new Map<string, { readyState: number; send: (data: string) => void }>(),
      log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never;

    // Register with very short timeout (10ms)
    registerRunTimer(mockFastify, runRow.id, f.orgA.id, 0.01);

    // Wait for timer to fire
    await new Promise((r) => setTimeout(r, 150));

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runRow.id);
    expect(run?.state).toBe('timed_out');
    expect(run?.exitCode).toBe(-1);
    expect(run?.finishedAt).not.toBeNull();
  });

  it('Test 6: handleRunTimeout is no-op on already-terminal run', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const runRow = await makeTaskRunsRepo(db, f.orgA.id).create({
      taskId: 'xci_task_test',
      taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
      timeoutSeconds: 3600,
    });
    // Seed as already succeeded
    await db
      .update(taskRuns)
      .set({ state: 'succeeded', exitCode: 0 })
      .where(eq(taskRuns.id, runRow.id));

    const mockFastify = {
      db,
      mek,
      agentRegistry: new Map(),
      log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never;

    registerRunTimer(mockFastify, runRow.id, f.orgA.id, 0.01);

    await new Promise((r) => setTimeout(r, 150));

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runRow.id);
    expect(run?.state).toBe('succeeded'); // unchanged
  });

  it('Test 7: handleRunTimeout sends cancel frame if agent connected', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h2',
      labels: {},
    });

    const runRow = await makeTaskRunsRepo(db, f.orgA.id).create({
      taskId: 'xci_task_test',
      taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
      timeoutSeconds: 3600,
    });
    await db
      .update(taskRuns)
      .set({ state: 'dispatched', agentId })
      .where(eq(taskRuns.id, runRow.id));

    const mockSend = vi.fn();
    const mockWs = { readyState: 1, send: mockSend };
    const registry = new Map<string, typeof mockWs>();
    registry.set(agentId, mockWs);

    const mockFastify = {
      db,
      mek,
      agentRegistry: registry,
      log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never;

    registerRunTimer(mockFastify, runRow.id, f.orgA.id, 0.01);

    await new Promise((r) => setTimeout(r, 150));

    expect(mockSend).toHaveBeenCalledOnce();
    const firstCall = mockSend.mock.calls[0];
    const sentFrame = JSON.parse(firstCall![0] as string) as Record<string, unknown>;
    expect(sentFrame.type).toBe('cancel');
    expect(sentFrame.run_id).toBe(runRow.id);
    expect(sentFrame.reason).toBe('timeout');
  });
});
