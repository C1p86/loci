/**
 * D-04 + D-31: Two-org isolation tests for makeTasksRepo.
 * Each it() seeds its own data via the repo directly (inline pattern — do NOT extend seedTwoOrgs).
 * Auto-discovery meta-test (isolation-coverage.isolation.test.ts) picks this file up automatically.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeAdminRepo } from '../admin.js';
import { makeTasksRepo } from '../tasks.js';

const YAML = 'build:\n  cmd: echo hello\n';

describe('tasks repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('list scoped to orgA never returns orgB task', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeTasksRepo(db, f.orgA.id);
    const repoB = makeTasksRepo(db, f.orgB.id);

    await repoA.create({
      name: 'task-a',
      yamlDefinition: YAML,
      createdByUserId: f.orgA.ownerUser.id,
    });
    await repoB.create({
      name: 'task-b',
      yamlDefinition: YAML,
      createdByUserId: f.orgB.ownerUser.id,
    });

    const rowsA = await repoA.list();
    expect(rowsA.length).toBe(1);
    expect(rowsA[0]?.name).toBe('task-a');
    expect(rowsA.every((r) => r.name !== 'task-b')).toBe(true);
  });

  it('getById with orgB task id in orgA repo returns undefined', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeTasksRepo(db, f.orgA.id);
    const repoB = makeTasksRepo(db, f.orgB.id);

    const { id: bTaskId } = await repoB.create({
      name: 'task-b',
      yamlDefinition: YAML,
      createdByUserId: f.orgB.ownerUser.id,
    });

    const result = await repoA.getById(bTaskId);
    expect(result).toBeUndefined();
  });

  it('create in orgA with same name as existing orgB task SUCCEEDS (per-org uniqueness)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeTasksRepo(db, f.orgA.id);
    const repoB = makeTasksRepo(db, f.orgB.id);

    await repoB.create({
      name: 'shared-name',
      yamlDefinition: YAML,
      createdByUserId: f.orgB.ownerUser.id,
    });

    // Same name in orgA must not conflict — partial unique index is per-org
    await expect(
      repoA.create({
        name: 'shared-name',
        yamlDefinition: YAML,
        createdByUserId: f.orgA.ownerUser.id,
      }),
    ).resolves.toMatchObject({ id: expect.stringMatching(/^xci_tsk_/) });
  });

  it('update with orgB task id in orgA repo does NOT modify that row', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeTasksRepo(db, f.orgA.id);
    const repoB = makeTasksRepo(db, f.orgB.id);

    const { id: bTaskId } = await repoB.create({
      name: 'task-b',
      yamlDefinition: YAML,
      createdByUserId: f.orgB.ownerUser.id,
    });

    const result = await repoA.update(bTaskId, { description: 'hacked' });
    expect(result.rowCount).toBe(0);

    // Confirm orgB row unchanged
    const bRow = await repoB.getById(bTaskId);
    expect(bRow?.description).toBe('');
  });

  it('delete with orgB task id in orgA repo does NOT delete that row', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeTasksRepo(db, f.orgA.id);
    const repoB = makeTasksRepo(db, f.orgB.id);

    const { id: bTaskId } = await repoB.create({
      name: 'task-b',
      yamlDefinition: YAML,
      createdByUserId: f.orgB.ownerUser.id,
    });

    const result = await repoA.delete(bTaskId);
    expect(result.rowCount).toBe(0);

    // Confirm orgB row still exists
    const bRow = await repoB.getById(bTaskId);
    expect(bRow).toBeDefined();
  });

  // Phase 13 Task 2: cross-org slug isolation
  it('adminRepo.findTaskByOrgAndSlug with orgA id and orgB task slug returns undefined', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const adminRepo = makeAdminRepo(db);
    const repoB = makeTasksRepo(db, f.orgB.id);

    const { id: bTaskId } = await repoB.create({
      name: 'deploy',
      yamlDefinition: YAML,
      createdByUserId: f.orgB.ownerUser.id,
    });
    const bTask = await repoB.getById(bTaskId);
    const bSlug = bTask?.slug ?? 'deploy';

    // Looking up org B's slug in the context of org A must return undefined
    const result = await adminRepo.findTaskByOrgAndSlug(f.orgA.id, bSlug);
    expect(result).toBeUndefined();
  });

  it('forOrg(orgA).tasks.update with orgB task id and exposeBadge=true returns rowCount=0', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeTasksRepo(db, f.orgA.id);
    const repoB = makeTasksRepo(db, f.orgB.id);

    const { id: bTaskId } = await repoB.create({
      name: 'task-b-badge',
      yamlDefinition: YAML,
      createdByUserId: f.orgB.ownerUser.id,
    });

    const result = await repoA.update(bTaskId, { exposeBadge: true });
    expect(result.rowCount).toBe(0);

    // Confirm orgB row exposeBadge is still false
    const bRow = await repoB.getById(bTaskId);
    expect(bRow?.exposeBadge).toBe(false);
  });
});
