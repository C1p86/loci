import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { generateId, generateToken } from '../../crypto/tokens.js';
import { orgInvites } from '../../db/schema.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeOrgInvitesRepo } from '../org-invites.js';

async function insertInviteFor(
  db: ReturnType<typeof getTestDb>,
  orgId: string,
  inviterUserId: string,
): Promise<{ id: string; token: string }> {
  const id = generateId('inv');
  const token = generateToken();
  await db.insert(orgInvites).values({
    id,
    orgId,
    inviterUserId,
    email: `invitee-${token.slice(0, 6)}@example.com`,
    role: 'member',
    token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return { id, token };
}

describe('orgInvites repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('findValidByToken scoped to orgA never returns orgB invite', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { token: tokenB } = await insertInviteFor(db, f.orgB.id, f.orgB.ownerUser.id);
    const repoA = makeOrgInvitesRepo(db, f.orgA.id);
    const result = await repoA.findValidByToken(tokenB);
    expect(result).toEqual([]);
  });

  it('listPending scoped to orgA never returns orgB invites', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    await insertInviteFor(db, f.orgB.id, f.orgB.ownerUser.id);
    const repoA = makeOrgInvitesRepo(db, f.orgA.id);
    const result = await repoA.listPending();
    expect(result.every((inv) => inv.orgId === f.orgA.id)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('revoke scoped to orgA never revokes orgB invite', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: idB } = await insertInviteFor(db, f.orgB.id, f.orgB.ownerUser.id);
    const repoA = makeOrgInvitesRepo(db, f.orgA.id);
    await repoA.revoke(idB);
    const rows = await db.select().from(orgInvites).where(eq(orgInvites.id, idB));
    expect(rows[0]?.revokedAt).toBeNull();
  });

  it('markAccepted scoped to orgA never marks orgB invite as accepted', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: idB } = await insertInviteFor(db, f.orgB.id, f.orgB.ownerUser.id);
    const repoA = makeOrgInvitesRepo(db, f.orgA.id);
    await repoA.markAccepted(idB, f.orgA.ownerUser.id);
    const rows = await db.select().from(orgInvites).where(eq(orgInvites.id, idB));
    expect(rows[0]?.acceptedAt).toBeNull();
  });

  it('create adds invite for orgA only (not orgB)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeOrgInvitesRepo(db, f.orgA.id);
    const { id, token } = await repoA.create({
      inviterUserId: f.orgA.ownerUser.id,
      email: 'new@example.com',
      role: 'member',
    });
    const rows = await db.select().from(orgInvites).where(eq(orgInvites.id, id));
    expect(rows[0]?.orgId).toBe(f.orgA.id);
    expect(rows[0]?.token).toBe(token);
    // orgB repo doesn't find it
    const repoB = makeOrgInvitesRepo(db, f.orgB.id);
    const resultB = await repoB.findValidByToken(token);
    expect(resultB).toEqual([]);
  });
});
