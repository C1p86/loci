// D-04 auto-discovery: referenced by isolation-coverage.isolation.test.ts
// Two-org isolation tests for makeTaskRunsRepo.
// Each it() seeds both orgs so "empty org" false-positives are prevented (D-04 rationale).

import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeAgentsRepo } from '../agents.js';
import { makeTaskRunsRepo } from '../task-runs.js';
import { makeTasksRepo } from '../tasks.js';

const YAML = 'build:\n  cmd: echo isolation\n';

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
    taskSnapshot: { cmd: 'echo isolation' },
    triggeredByUserId: ownerUserId,
  });
  return { taskId, run, runsRepo };
}

describe('task-runs repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('getById scoped to orgA never returns orgB run', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    const { run: runB } = await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoA = makeTaskRunsRepo(db, f.orgA.id);

    // orgA can see its own run
    const own = await repoA.getById(runA.id);
    expect(own).toBeDefined();
    expect(own?.id).toBe(runA.id);

    // orgA cannot see orgB's run
    const cross = await repoA.getById(runB.id);
    expect(cross).toBeUndefined();
  });

  it('list scoped to orgA never returns orgB runs', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    const { run: runB } = await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoA = makeTaskRunsRepo(db, f.orgA.id);
    const rows = await repoA.list({});
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.id !== runB.id)).toBe(true);
  });

  it('listActiveByAgent cross-tenant: orgB repo cannot see orgA agent runs', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    // Create an orgA agent and attach a "running" run to it
    const agentA = await makeAgentsRepo(db, f.orgA.id).create({
      hostname: 'agent-a',
      labels: {},
    });
    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    // Transition to running (queued→dispatched→running) via CAS to get an active run
    await makeTaskRunsRepo(db, f.orgA.id).updateState(runA.id, 'queued', 'dispatched', {
      agentId: agentA.id,
    });
    await makeTaskRunsRepo(db, f.orgA.id).updateState(runA.id, 'dispatched', 'running');

    // orgB repo must not see orgA's active run for agentA
    const repoB = makeTaskRunsRepo(db, f.orgB.id);
    const rows = await repoB.listActiveByAgent(agentA.id);
    expect(rows).toHaveLength(0);
  });

  it('updateState cross-tenant: orgB cannot mutate orgA run', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    // Also seed orgB so a zero-row result is meaningful
    await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoB = makeTaskRunsRepo(db, f.orgB.id);
    const result = await repoB.updateState(runA.id, 'queued', 'dispatched');
    expect(result).toBeUndefined();

    // Confirm orgA run state is unchanged
    const repoA = makeTaskRunsRepo(db, f.orgA.id);
    const row = await repoA.getById(runA.id);
    expect(row?.state).toBe('queued');
  });

  it('verifyBelongsToOrg: true for owner org, false for wrong org', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoA = makeTaskRunsRepo(db, f.orgA.id);
    const repoB = makeTaskRunsRepo(db, f.orgB.id);

    expect(await repoA.verifyBelongsToOrg(runA.id)).toBe(true);
    expect(await repoB.verifyBelongsToOrg(runA.id)).toBe(false);
  });

  it('markTerminal cross-tenant: orgB cannot terminal-transition orgA run', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    // Put orgA run into 'running' state so markTerminal would normally succeed
    const { run: runA } = await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    const agentA = await makeAgentsRepo(db, f.orgA.id).create({
      hostname: 'agent-a-mt',
      labels: {},
    });
    await makeTaskRunsRepo(db, f.orgA.id).updateState(runA.id, 'queued', 'dispatched', {
      agentId: agentA.id,
    });
    await makeTaskRunsRepo(db, f.orgA.id).updateState(runA.id, 'dispatched', 'running');
    await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoB = makeTaskRunsRepo(db, f.orgB.id);
    const result = await repoB.markTerminal(runA.id, 'succeeded', 0);
    expect(result).toBeUndefined();

    // Confirm orgA run state is still 'running'
    const repoA = makeTaskRunsRepo(db, f.orgA.id);
    const row = await repoA.getById(runA.id);
    expect(row?.state).toBe('running');
    expect(row?.finishedAt).toBeNull();
  });

  it('listByState cross-tenant: orgB repo never returns orgA runs by state', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    // orgA run in 'queued' state
    await seedRunInOrg(db, f.orgA.id, f.orgA.ownerUser.id);
    // orgB run also in 'queued' (so a missing WHERE would return orgA run)
    await seedRunInOrg(db, f.orgB.id, f.orgB.ownerUser.id);

    const repoB = makeTaskRunsRepo(db, f.orgB.id);
    const rows = await repoB.listByState(['queued']);
    // Should only return orgB's own queued run
    expect(rows.length).toBe(1);
    expect(rows[0]?.orgId).toBe(f.orgB.id);
  });
});
