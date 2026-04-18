import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { hashPassword } from '../crypto/password.js';
import { generateId, generateToken } from '../crypto/tokens.js';
import {
  emailVerifications,
  type NewUser,
  orgInvites,
  orgMembers,
  orgPlans,
  orgs,
  passwordResets,
  sessions,
  users,
} from '../db/schema.js';
import { DatabaseError, EmailAlreadyRegisteredError, UserNotFoundError } from '../errors.js';

function slugify(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  const safe =
    local
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'user';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${safe}-${suffix}`;
}

/**
 * D-03: Cross-org operations. adminRepo has NO orgId parameter — it crosses tenants.
 * Every use of adminRepo in a route handler is an immediate code-review flag.
 * Use forOrg() for all org-scoped queries.
 */
export function makeAdminRepo(db: PostgresJsDatabase) {
  return {
    /**
     * Create org + user + owner membership + Free org_plan in one transaction.
     * Column defaults in schema enforce QUOTA-02 (max_agents=5, max_concurrent_tasks=5,
     * log_retention_days=30 — passed via schema defaults, not inserted explicitly here).
     * Throws EmailAlreadyRegisteredError on PG unique violation 23505 (users_email_lower_unique).
     */
    async signupTx(params: { email: string; password: string }): Promise<{
      user: { id: string; email: string };
      org: { id: string; name: string; slug: string };
    }> {
      const email = params.email.toLowerCase();
      const passwordHash = await hashPassword(params.password);
      const userId = generateId('usr');
      const orgId = generateId('org');
      const slug = slugify(email);
      const orgName = `${email.split('@')[0] ?? 'user'}'s personal org`;

      try {
        await db.transaction(async (tx) => {
          await tx.insert(users).values({ id: userId, email, passwordHash } satisfies NewUser);
          await tx.insert(orgs).values({ id: orgId, name: orgName, slug, isPersonal: true });
          await tx.insert(orgMembers).values({
            id: generateId('mem'),
            orgId,
            userId,
            role: 'owner',
          });
          // Rely on schema column defaults for QUOTA-02 (no explicit values → defaults apply)
          await tx.insert(orgPlans).values({ id: generateId('plan'), orgId });
        });
      } catch (err) {
        // Postgres unique violation code 23505. Drizzle rethrows with cause chain.
        const pgCode =
          (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (pgCode === '23505') {
          throw new EmailAlreadyRegisteredError();
        }
        throw new DatabaseError('signupTx failed', err);
      }

      return { user: { id: userId, email }, org: { id: orgId, name: orgName, slug } };
    },

    /** Cross-org user lookup (login/password-reset — no org context yet). */
    async findUserByEmail(email: string) {
      return db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    },

    async findUserById(userId: string) {
      return db.select().from(users).where(eq(users.id, userId)).limit(1);
    },

    /** Cross-org invite lookup by token (invitee not yet a member of that org). */
    async findInviteByToken(token: string) {
      return db.select().from(orgInvites).where(eq(orgInvites.token, token)).limit(1);
    },

    /** First org membership for the user — login default active org (D-18). */
    async findUserFirstOrgMembership(userId: string) {
      return db
        .select({ orgId: orgMembers.orgId, role: orgMembers.role })
        .from(orgMembers)
        .where(eq(orgMembers.userId, userId))
        .limit(1);
    },

    /** Look up a session without org scope — used by auth plugin before org context exists. */
    async findActiveSessionByToken(token: string) {
      return db.select().from(sessions).where(eq(sessions.id, token)).limit(1);
    },

    async createSession(params: {
      userId: string;
      activeOrgId: string;
    }): Promise<{ token: string; expiresAt: Date }> {
      const token = generateToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000); // D-13: 14d sliding
      await db.insert(sessions).values({
        id: token,
        userId: params.userId,
        activeOrgId: params.activeOrgId,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      });
      return { token, expiresAt };
    },

    async revokeSession(token: string): Promise<void> {
      // AUTH-12: logout irreversibly invalidates session
      await db.update(sessions).set({ revokedAt: sql`now()` }).where(eq(sessions.id, token));
    },

    async createEmailVerification(params: { userId: string }): Promise<{
      token: string;
      expiresAt: Date;
    }> {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // AUTH-02: 24h
      await db.insert(emailVerifications).values({
        id: generateId('ver'),
        userId: params.userId,
        token,
        expiresAt,
      });
      return { token, expiresAt };
    },

    async markUserEmailVerified(userId: string): Promise<void> {
      await db.update(users).set({ emailVerifiedAt: sql`now()` }).where(eq(users.id, userId));
    },

    async createPasswordReset(params: { userId: string }): Promise<{
      token: string;
      expiresAt: Date;
    }> {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // AUTH-04: 1h
      await db.insert(passwordResets).values({
        id: generateId('pwr'),
        userId: params.userId,
        token,
        expiresAt,
      });
      return { token, expiresAt };
    },

    async updateUserPassword(params: { userId: string; newPassword: string }): Promise<void> {
      const hash = await hashPassword(params.newPassword);
      await db
        .update(users)
        .set({ passwordHash: hash, updatedAt: sql`now()` })
        .where(eq(users.id, params.userId));
      // Verify user existed (findUserById would be a second round-trip; update always succeeds)
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, params.userId))
        .limit(1);
      if (rows.length === 0) throw new UserNotFoundError();
    },

    /**
     * Add a user to an org with a given role.
     * Used by invite acceptance. On org_members_one_owner_per_org unique violation, throws
     * (caller handles). On org_members_org_user_unique duplicate (already member), treats as
     * success for idempotency only when role is NOT owner.
     */
    async addMemberToOrg(params: {
      orgId: string;
      userId: string;
      role: 'owner' | 'member' | 'viewer';
    }): Promise<void> {
      try {
        await db.insert(orgMembers).values({
          id: generateId('mem'),
          orgId: params.orgId,
          userId: params.userId,
          role: params.role,
        });
      } catch (err) {
        const pgCode =
          (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (pgCode === '23505') {
          if (params.role !== 'owner') {
            // Already a member with a non-owner role — idempotent for invite acceptance
            return;
          }
          // Owner violation — the org_members_one_owner_per_org partial unique index fired
          throw new DatabaseError('addMemberToOrg: owner uniqueness violation', err);
        }
        throw new DatabaseError('addMemberToOrg failed', err);
      }
    },
  };
}

export type AdminRepo = ReturnType<typeof makeAdminRepo>;
