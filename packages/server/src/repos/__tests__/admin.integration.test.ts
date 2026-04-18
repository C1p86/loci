import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '../../crypto/password.js';
import { orgMembers, orgPlans, orgs, sessions, users } from '../../db/schema.js';
import { EmailAlreadyRegisteredError } from '../../errors.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { makeAdminRepo } from '../admin.js';

describe('adminRepo.signupTx (D-03 + AUTH-07 + QUOTA-02)', () => {
  beforeEach(async () => resetDb());

  it('creates org + user + owner membership + Free plan in one transaction', async () => {
    const db = getTestDb();
    const admin = makeAdminRepo(db);
    const result = await admin.signupTx({
      email: 'alice@example.com',
      password: 'long-enough-password-12',
    });

    expect(result.user.email).toBe('alice@example.com');
    expect(result.user.id).toMatch(/^xci_usr_/);
    expect(result.org.id).toMatch(/^xci_org_/);

    const orgsRows = await db.select().from(orgs);
    const usersRows = await db.select().from(users);
    const memberRows = await db.select().from(orgMembers);
    const planRows = await db.select().from(orgPlans);

    expect(orgsRows).toHaveLength(1);
    expect(orgsRows[0]?.isPersonal).toBe(true);
    expect(usersRows).toHaveLength(1);
    expect(usersRows[0]?.email).toBe('alice@example.com');
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.role).toBe('owner');
    expect(planRows).toHaveLength(1);
    expect(planRows[0]?.planName).toBe('free');
    expect(planRows[0]?.maxAgents).toBe(5);
    expect(planRows[0]?.maxConcurrentTasks).toBe(5);
    expect(planRows[0]?.logRetentionDays).toBe(30);
  });

  it('hashes password with argon2id (never stores plaintext)', async () => {
    const db = getTestDb();
    const admin = makeAdminRepo(db);
    await admin.signupTx({ email: 'bob@example.com', password: 'another-long-password' });
    const rows = await db.select().from(users).where(eq(users.email, 'bob@example.com'));
    const hash = rows[0]?.passwordHash ?? '';
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toBe('another-long-password');
    expect(await verifyPassword(hash, 'another-long-password')).toBe(true);
  });

  it('throws EmailAlreadyRegisteredError on duplicate (case-insensitive)', async () => {
    const db = getTestDb();
    const admin = makeAdminRepo(db);
    await admin.signupTx({ email: 'carol@example.com', password: 'long-enough-password' });
    await expect(
      admin.signupTx({ email: 'CAROL@example.com', password: 'another-long-one' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
    // Atomicity: should still be exactly 1 user/org/member/plan
    expect((await db.select().from(users)).length).toBe(1);
    expect((await db.select().from(orgs)).length).toBe(1);
  });

  it('createSession + revokeSession — AUTH-12 irreversible', async () => {
    const db = getTestDb();
    const admin = makeAdminRepo(db);
    const { user, org } = await admin.signupTx({
      email: 'd@example.com',
      password: 'long-password-123',
    });
    const s = await admin.createSession({ userId: user.id, activeOrgId: org.id });
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Revoke
    await admin.revokeSession(s.token);
    const sessionRows = await db.select().from(sessions).where(eq(sessions.id, s.token));
    expect(sessionRows[0]?.revokedAt).toBeDefined();
    expect(sessionRows[0]?.revokedAt).not.toBeNull();
  });

  it('owner partial unique index rejects a second owner for same org (AUTH-08)', async () => {
    const db = getTestDb();
    const admin = makeAdminRepo(db);
    const { user: a, org } = await admin.signupTx({
      email: 'e@example.com',
      password: 'long-password-abc',
    });
    const { user: f } = await admin.signupTx({
      email: 'f@example.com',
      password: 'long-password-def',
    });
    // Directly insert a second owner membership for the first org — should fail unique constraint
    await expect(
      admin.addMemberToOrg({ orgId: org.id, userId: f.id, role: 'owner' }),
    ).rejects.toThrow();
    // Original owner unchanged
    const owners = await db.select().from(orgMembers).where(eq(orgMembers.orgId, org.id));
    expect(owners.filter((m) => m.role === 'owner').length).toBe(1);
    expect(owners.find((m) => m.role === 'owner')?.userId).toBe(a.id);
  });
});
