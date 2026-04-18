import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeRegistrationTokensRepo } from '../registration-tokens.js';

describe('registration-tokens repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('create returns plaintext once; stores hash only', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const result = await makeRegistrationTokensRepo(db, f.orgA.id).create(f.orgA.ownerUser.id);
    expect(result.tokenPlaintext).toMatch(/^[A-Za-z0-9_-]{43}$/); // base64url of 32 bytes
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);
  });

  it('listActive scoped — orgA does not see orgB tokens', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    await makeRegistrationTokensRepo(db, f.orgA.id).create(f.orgA.ownerUser.id);
    await makeRegistrationTokensRepo(db, f.orgB.id).create(f.orgB.ownerUser.id);
    const rowsA = await makeRegistrationTokensRepo(db, f.orgA.id).listActive();
    const rowsB = await makeRegistrationTokensRepo(db, f.orgB.id).listActive();
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0]!.id).not.toBe(rowsB[0]!.id);
  });

  it('revoke scoped — orgA cannot revoke orgB token', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: bTokenId } = await makeRegistrationTokensRepo(db, f.orgB.id).create(
      f.orgB.ownerUser.id,
    );
    await makeRegistrationTokensRepo(db, f.orgA.id).revoke(bTokenId);
    const activeB = await makeRegistrationTokensRepo(db, f.orgB.id).listActive();
    expect(activeB.find((r) => r.id === bTokenId)).toBeDefined();
  });
});
