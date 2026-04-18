import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateId, generateToken } from '../../crypto/tokens.js';
import { passwordResets } from '../../db/schema.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makePasswordResetsRepo } from '../password-resets.js';

async function insertPasswordResetFor(
  db: ReturnType<typeof getTestDb>,
  userId: string,
): Promise<string> {
  const token = generateToken();
  await db.insert(passwordResets).values({
    id: generateId('pwr'),
    userId,
    token,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h expiry
  });
  return token;
}

describe('passwordResets repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('findValidByTokenForOrg scoped to orgA never returns orgB reset', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const tokenB = await insertPasswordResetFor(db, f.orgB.ownerUser.id);
    const repoA = makePasswordResetsRepo(db, f.orgA.id);
    const result = await repoA.findValidByTokenForOrg(tokenB);
    expect(result).toEqual([]);
  });

  it('markConsumed scoped to orgA never consumes orgB reset', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const tokenB = await insertPasswordResetFor(db, f.orgB.ownerUser.id);
    const repoA = makePasswordResetsRepo(db, f.orgA.id);
    await repoA.markConsumed(tokenB);
    // B's record should still be unconsumed
    const rows = await db.select().from(passwordResets).where(eq(passwordResets.token, tokenB));
    expect(rows[0]?.consumedAt).toBeNull();
  });
});
