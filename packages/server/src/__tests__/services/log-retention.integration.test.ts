// Integration tests for log-retention service (runRetentionCleanup).
// Plan 11-03 Task 2 — TDD RED phase
//
// Tests:
//   1. OrgA chunks (31d old, retention=30d) deleted; orgB chunks (1d old) preserved
//   2. Return value: perOrg[orgAId]=5, rowsDeleted=5
//   3. batchSize=2, maxIterations=10 → iterations===3 for 5 rows

import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { generateId } from '../../crypto/tokens.js';
import { logChunks, orgPlans, tasks } from '../../db/schema.js';
import { makeRepos } from '../../repos/index.js';
import { runRetentionCleanup } from '../../services/log-retention.js';
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

async function seedRunWithChunks(
  orgId: string,
  chunkCount: number,
  persistedAtDaysAgo: number,
): Promise<{ runId: string }> {
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

  const runId = run.id;

  // Insert chunks and then backdate persisted_at
  const now = new Date();
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    id: generateId('lch'),
    runId,
    seq: i,
    stream: 'stdout' as const,
    data: `line ${i}`,
    ts: now,
    persistedAt: now,
  }));
  await db.insert(logChunks).values(chunks);

  // Backdate persisted_at using SQL interval
  await db.execute(sql`
    UPDATE log_chunks
    SET persisted_at = now() - interval '${sql.raw(String(persistedAtDaysAgo))} days'
    WHERE run_id = ${runId}
  `);

  return { runId };
}

describe('log-retention service (runRetentionCleanup)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let f: TwoOrgFixture;

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
    const db = getTestDb();
    f = await seedTwoOrgs(db);
    // Set retention_days = 30 for both orgs (matching schema defaults)
    await db.update(orgPlans).set({ logRetentionDays: 30 }).where(eq(orgPlans.orgId, f.orgA.id));
    await db.update(orgPlans).set({ logRetentionDays: 30 }).where(eq(orgPlans.orgId, f.orgB.id));
  });

  afterEach(() => {
    clearAllRunTimers();
  });

  it('Test 1: orgA chunks (31d old) deleted; orgB chunks (1d old) preserved', async () => {
    const db = getTestDb();
    await seedRunWithChunks(f.orgA.id, 5, 31); // 31 days ago → should be deleted (retention=30d)
    await seedRunWithChunks(f.orgB.id, 5, 1); // 1 day ago → should be preserved

    await runRetentionCleanup(app);

    // OrgA chunks should be gone
    const orgAChunks = await db
      .select({ id: logChunks.id })
      .from(logChunks)
      .innerJoin(
        (await import('../../db/schema.js')).taskRuns,
        eq(logChunks.runId, (await import('../../db/schema.js')).taskRuns.id),
      )
      .where(eq((await import('../../db/schema.js')).taskRuns.orgId, f.orgA.id));
    expect(orgAChunks.length).toBe(0);

    // OrgB chunks should survive
    const orgBChunks = await db
      .select({ id: logChunks.id })
      .from(logChunks)
      .innerJoin(
        (await import('../../db/schema.js')).taskRuns,
        eq(logChunks.runId, (await import('../../db/schema.js')).taskRuns.id),
      )
      .where(eq((await import('../../db/schema.js')).taskRuns.orgId, f.orgB.id));
    expect(orgBChunks.length).toBe(5);
  });

  it('Test 2: return value has perOrg[orgAId]=5, rowsDeleted=5', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    await seedRunWithChunks(f.orgA.id, 5, 31);

    // Call adminRepo directly to check return value
    const repos = makeRepos(db, mek);
    const result = await repos.admin.runRetentionCleanup({ batchSize: 10_000, maxIterations: 100 });

    expect(result.rowsDeleted).toBe(5);
    expect(result.perOrg[f.orgA.id]).toBe(5);
    expect(result.iterations).toBeGreaterThanOrEqual(1);
  });

  it('Test 3: batchSize=2, maxIterations=10 → deletes all 5 rows in ceil(5/2)=3 iterations', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    await seedRunWithChunks(f.orgA.id, 5, 31);

    const repos = makeRepos(db, mek);
    const result = await repos.admin.runRetentionCleanup({ batchSize: 2, maxIterations: 10 });

    expect(result.rowsDeleted).toBe(5);
    expect(result.iterations).toBe(3); // rounds: 2+2+1=5
    expect(result.perOrg[f.orgA.id]).toBe(5);
  });
});
