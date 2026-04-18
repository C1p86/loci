import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeUsersRepo } from '../users.js';

describe('users repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('findByEmail scoped to orgA never returns orgB user', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeUsersRepo(db, f.orgA.id);
    const result = await repoA.findByEmail(f.orgB.ownerUser.email);
    expect(result).toEqual([]);
  });

  it('findById scoped to orgA never returns orgB user', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeUsersRepo(db, f.orgA.id);
    const result = await repoA.findById(f.orgB.ownerUser.id);
    expect(result).toEqual([]);
  });

  it('listMembers scoped to orgA only returns orgA members', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeUsersRepo(db, f.orgA.id);
    const result = await repoA.listMembers();
    expect(result.length).toBe(1);
    expect(result[0]?.user.id).toBe(f.orgA.ownerUser.id);
    expect(result.every((m) => m.user.id !== f.orgB.ownerUser.id)).toBe(true);
  });
});
