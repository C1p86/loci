// D-04 auto-discovery: referenced by isolation-coverage.isolation.test.ts
// Two-org isolation tests for makeLogChunksRepo.
// Each it() seeds BOTH orgs so "empty org" false-positives are prevented (D-04 rationale).

import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeLogChunksRepo } from '../log-chunks.js';
import { makeTaskRunsRepo } from '../task-runs.js';
import { makeTasksRepo } from '../tasks.js';

const YAML = 'build:\n  cmd: echo log-isolation\n';

async function seedRunInOrg(db: ReturnType<typeof getTestDb>, orgId: string, ownerUserId: string) {
  const tasksRepo = makeTasksRepo(db, orgId);
  const { id: taskId } = await tasksRepo.create({
    name: `task-${orgId.slice(-6)}`,
    yamlDefinition: YAML,
    createdByUserId: ownerUserId,
  });
  const runsRepo = makeTaskRunsRepo(db, orgId);
  const run = await runsRepo.create({
    taskId,
    taskSnapshot: { cmd: 'echo log-isolation' },
    triggeredByUserId: ownerUserId,
  });
  return { taskId, run };
}

function makeChunk(runId: string, seq: number, stream: 'stdout' | 'stderr' = 'stdout') {
  return {
    id: `xci_lch_${runId.slice(-4)}_${seq}`,
    runId,
    seq,
    stream,
    data: `out-${seq}`,
    ts: new Date(),
  };
}

describe('log-chunks repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('getByRunId scoped to orgA never returns orgB chunks', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    const { run: runB } = await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoA = makeLogChunksRepo(db, f.orgA.id);
    const repoB = makeLogChunksRepo(db, f.orgB.id);

    // Insert 3 chunks into orgA's run
    await repoA.insertBatch([
      makeChunk(runA.id, 0, 'stdout'),
      makeChunk(runA.id, 1, 'stderr'),
      makeChunk(runA.id, 2, 'stdout'),
    ]);
    // Insert 1 chunk into orgB's run (so orgB is not empty)
    await repoB.insertBatch([makeChunk(runB.id, 0, 'stdout')]);

    // orgA can see its own 3 chunks in seq order
    const ownChunks = await repoA.getByRunId(runA.id);
    expect(ownChunks).toHaveLength(3);
    expect(ownChunks.map((c) => c.seq)).toEqual([0, 1, 2]);

    // orgA cannot see orgB's run chunks (cross-org isolation)
    const crossChunks = await repoA.getByRunId(runB.id);
    expect(crossChunks).toEqual([]);
  });

  it('countByRunId returns 0 for cross-org run', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    const { run: runB } = await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoA = makeLogChunksRepo(db, f.orgA.id);
    const repoB = makeLogChunksRepo(db, f.orgB.id);

    // Insert chunks into both orgs
    await repoA.insertBatch([makeChunk(runA.id, 0), makeChunk(runA.id, 1)]);
    await repoB.insertBatch([makeChunk(runB.id, 0)]);

    // orgA counting its own run
    expect(await repoA.countByRunId(runA.id)).toBe(2);

    // orgA counting orgB's run → 0
    expect(await repoA.countByRunId(runB.id)).toBe(0);
  });

  it('insertBatch for cross-org runId is invisible to the other org', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    const { run: runB } = await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoA = makeLogChunksRepo(db, f.orgA.id);
    const repoB = makeLogChunksRepo(db, f.orgB.id);

    // Insert chunks for orgA's run via repoA
    await repoA.insertBatch([makeChunk(runA.id, 0), makeChunk(runA.id, 1), makeChunk(runA.id, 2)]);

    // Insert 1 chunk into orgB's run via repoB (seed so orgB is not empty)
    await repoB.insertBatch([makeChunk(runB.id, 0)]);

    // orgA cannot see orgB's run
    const crossFromA = await repoA.getByRunId(runB.id);
    expect(crossFromA).toEqual([]);

    // orgB can see its own chunk
    const ownFromB = await repoB.getByRunId(runB.id);
    expect(ownFromB).toHaveLength(1);
    expect(ownFromB[0]?.seq).toBe(0);
  });

  it('insertBatch ON CONFLICT DO NOTHING is idempotent for duplicate (run_id, seq)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    const { run: runB } = await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoA = makeLogChunksRepo(db, f.orgA.id);
    const repoB = makeLogChunksRepo(db, f.orgB.id);

    // Seed orgB so it's not empty
    await repoB.insertBatch([makeChunk(runB.id, 0)]);

    // First insert: 2 new rows
    const first = await repoA.insertBatch([makeChunk(runA.id, 0), makeChunk(runA.id, 1)]);
    expect(first).toBe(2);

    // Re-insert same chunks: 0 rows inserted (ON CONFLICT DO NOTHING)
    const second = await repoA.insertBatch([makeChunk(runA.id, 0), makeChunk(runA.id, 1)]);
    expect(second).toBe(0);

    // DB still has exactly 2 chunks
    expect(await repoA.countByRunId(runA.id)).toBe(2);
  });

  it('getByRunId sinceSeq filters correctly', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    const { run: runB } = await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoA = makeLogChunksRepo(db, f.orgA.id);
    const repoB = makeLogChunksRepo(db, f.orgB.id);

    // Seed orgB so it's not empty
    await repoB.insertBatch([makeChunk(runB.id, 0)]);

    await repoA.insertBatch([
      makeChunk(runA.id, 0),
      makeChunk(runA.id, 1),
      makeChunk(runA.id, 2),
      makeChunk(runA.id, 3),
    ]);

    // sinceSeq=1 returns seq > 1, i.e. seq 2 and 3
    const after1 = await repoA.getByRunId(runA.id, { sinceSeq: 1 });
    expect(after1.map((c) => c.seq)).toEqual([2, 3]);
  });
});
