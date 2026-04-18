import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateToken } from '../../crypto/tokens.js';
import { sessions } from '../../db/schema.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeSessionsRepo } from '../sessions.js';

async function insertSessionFor(db: ReturnType<typeof getTestDb>, userId: string): Promise<string> {
  const token = generateToken();
  await db.insert(sessions).values({
    id: token,
    userId,
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  });
  return token;
}

describe('sessions repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('findActiveByTokenForOrg scoped to orgA never finds orgB session', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sidB = await insertSessionFor(db, f.orgB.ownerUser.id);
    const repoA = makeSessionsRepo(db, f.orgA.id);
    const result = await repoA.findActiveByTokenForOrg(sidB);
    expect(result).toEqual([]);
  });

  it('refreshSlidingExpiry scoped to orgA never updates orgB session', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sidB = await insertSessionFor(db, f.orgB.ownerUser.id);
    // Force last_seen_at to > 1h ago so the throttle allows an update attempt
    await db.execute(
      sql`UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE id = ${sidB}`,
    );
    const repoA = makeSessionsRepo(db, f.orgA.id);
    await repoA.refreshSlidingExpiry(sidB);
    // Verify B's last_seen_at was NOT updated by orgA repo
    const rows = await db.select().from(sessions).where(eq(sessions.id, sidB));
    const ageMs = Date.now() - (rows[0]?.lastSeenAt?.getTime() ?? 0);
    expect(ageMs).toBeGreaterThan(60 * 60 * 1000);
  });

  it('setActiveOrgId scoped to orgA never mutates orgB session', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sidB = await insertSessionFor(db, f.orgB.ownerUser.id);
    const repoA = makeSessionsRepo(db, f.orgA.id);
    await repoA.setActiveOrgId(sidB, f.orgA.id);
    const rows = await db.select().from(sessions).where(eq(sessions.id, sidB));
    expect(rows[0]?.activeOrgId).toBeNull();
  });
});
