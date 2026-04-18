import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeOrgPlansRepo } from '../org-plans.js';

describe('orgPlans repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('get scoped to orgA never returns orgB plan', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeOrgPlansRepo(db, f.orgA.id);
    const result = await repoA.get();
    expect(result.length).toBe(1);
    expect(result[0]?.orgId).toBe(f.orgA.id);
    expect(result[0]?.orgId).not.toBe(f.orgB.id);
  });
});
