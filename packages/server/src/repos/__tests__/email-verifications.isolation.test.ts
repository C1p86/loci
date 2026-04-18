import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateId, generateToken } from '../../crypto/tokens.js';
import { emailVerifications } from '../../db/schema.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeEmailVerificationsRepo } from '../email-verifications.js';

async function insertVerificationFor(
  db: ReturnType<typeof getTestDb>,
  userId: string,
): Promise<string> {
  const token = generateToken();
  await db.insert(emailVerifications).values({
    id: generateId('ver'),
    userId,
    token,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return token;
}

describe('emailVerifications repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('findValidByTokenForOrg scoped to orgA never returns orgB verification', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const tokenB = await insertVerificationFor(db, f.orgB.ownerUser.id);
    const repoA = makeEmailVerificationsRepo(db, f.orgA.id);
    const result = await repoA.findValidByTokenForOrg(tokenB);
    expect(result).toEqual([]);
  });

  it('markConsumed scoped to orgA never consumes orgB verification', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const tokenB = await insertVerificationFor(db, f.orgB.ownerUser.id);
    const repoA = makeEmailVerificationsRepo(db, f.orgA.id);
    await repoA.markConsumed(tokenB);
    // B's record should still be unconsumed
    const rows = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.token, tokenB));
    expect(rows[0]?.consumedAt).toBeNull();
  });
});
