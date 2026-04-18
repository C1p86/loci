import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { hashPassword } from '../crypto/password.js';
import { generateId, generateToken, hashToken } from '../crypto/tokens.js';
import {
  agentCredentials,
  agents,
  emailVerifications,
  type NewAgent,
  type NewAgentCredential,
  type NewUser,
  orgInvites,
  orgMembers,
  orgPlans,
  orgs,
  passwordResets,
  registrationTokens,
  sessions,
  users,
} from '../db/schema.js';
import {
  DatabaseError,
  EmailAlreadyRegisteredError,
  OwnerRoleImmutableError,
  RegistrationTokenExpiredError,
  UserNotFoundError,
} from '../errors.js';

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

    /** Cross-org email verification lookup by token (user may not be logged in when verifying). */
    async findEmailVerificationByToken(token: string) {
      return db
        .select()
        .from(emailVerifications)
        .where(
          and(
            eq(emailVerifications.token, token),
            isNull(emailVerifications.consumedAt),
            gt(emailVerifications.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
    },

    async markEmailVerificationConsumed(token: string) {
      return db
        .update(emailVerifications)
        .set({ consumedAt: sql`now()` })
        .where(and(eq(emailVerifications.token, token), isNull(emailVerifications.consumedAt)));
    },

    async findPasswordResetByToken(token: string) {
      return db
        .select()
        .from(passwordResets)
        .where(
          and(
            eq(passwordResets.token, token),
            isNull(passwordResets.consumedAt),
            gt(passwordResets.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
    },

    async markPasswordResetConsumed(token: string) {
      return db
        .update(passwordResets)
        .set({ consumedAt: sql`now()` })
        .where(
          and(
            eq(passwordResets.token, token),
            isNull(passwordResets.consumedAt),
            gt(passwordResets.expiresAt, sql`now()`),
          ),
        );
    },

    /** Revoke all active sessions for a user (called after password reset). */
    async revokeAllSessionsForUser(userId: string) {
      await db
        .update(sessions)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
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

    /** Look up an org by ID. Used for org name resolution in email templates. */
    async findOrgById(orgId: string) {
      return db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
    },

    /**
     * Change a member's role. Throws OwnerRoleImmutableError if the target is currently an owner
     * or if newRole === 'owner' (owner is non-transferable in Phase 7 per D-16).
     * PG unique violation 23505 (attempting second owner) also propagates as OwnerRoleImmutableError.
     */
    async changeRole(params: {
      orgId: string;
      userId: string;
      newRole: 'member' | 'viewer';
    }): Promise<void> {
      const rows = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, params.orgId), eq(orgMembers.userId, params.userId)))
        .limit(1);
      const current = rows[0];
      if (!current) throw new UserNotFoundError();
      if (current.role === 'owner') throw new OwnerRoleImmutableError();
      try {
        await db
          .update(orgMembers)
          .set({ role: params.newRole })
          .where(and(eq(orgMembers.orgId, params.orgId), eq(orgMembers.userId, params.userId)));
      } catch (err) {
        const pgCode =
          (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
        if (pgCode === '23505') throw new OwnerRoleImmutableError();
        throw new DatabaseError('changeRole failed', err);
      }
    },

    /**
     * Mark an invite as accepted cross-org (invitee is not yet a member when accepting).
     * Uses conditional WHERE so only an unaccepted, unrevoked, unexpired invite is touched.
     */
    async markInviteAccepted(params: {
      inviteId: string;
      acceptedByUserId: string;
    }): Promise<void> {
      await db
        .update(orgInvites)
        .set({ acceptedAt: sql`now()`, acceptedByUserId: params.acceptedByUserId })
        .where(
          and(
            eq(orgInvites.id, params.inviteId),
            isNull(orgInvites.acceptedAt),
            isNull(orgInvites.revokedAt),
            gt(orgInvites.expiresAt, sql`now()`),
          ),
        );
    },

    // ---- D-37 cross-org agent helpers (Phase 8) ----

    /**
     * Cross-org lookup for WS handshake registration frame.
     * Hashes the plaintext, looks up by hash WHERE consumed_at IS NULL AND expires_at > now().
     * Returns undefined if not found / expired / consumed.
     * ATOK-06: comparison is via eq on hash column — no === on plaintext.
     */
    async findValidRegistrationToken(tokenPlaintext: string) {
      const tokenHash = hashToken(tokenPlaintext);
      const rows = await db
        .select()
        .from(registrationTokens)
        .where(
          and(
            eq(registrationTokens.tokenHash, tokenHash),
            isNull(registrationTokens.consumedAt),
            gt(registrationTokens.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
      return rows[0];
    },

    /**
     * Atomic consume: UPDATE SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL.
     * Returns orgId on success; throws RegistrationTokenExpiredError if already consumed.
     * Single-use enforcement — ATOK-01.
     */
    async consumeRegistrationToken(tokenId: string): Promise<string> {
      const rows = await db
        .update(registrationTokens)
        .set({ consumedAt: sql`now()` })
        .where(and(eq(registrationTokens.id, tokenId), isNull(registrationTokens.consumedAt)))
        .returning({ orgId: registrationTokens.orgId });
      const row = rows[0];
      if (!row) throw new RegistrationTokenExpiredError();
      return row.orgId;
    },

    /**
     * Cross-org lookup for `reconnect` WS frame.
     * Hashes the plaintext credential, looks up WHERE revoked_at IS NULL.
     * Returns { agentId, orgId } or undefined.
     * ATOK-06: comparison is via eq on hash column — no === on plaintext.
     */
    async findActiveAgentCredential(credentialPlaintext: string) {
      const credHash = hashToken(credentialPlaintext);
      const rows = await db
        .select({
          agentId: agentCredentials.agentId,
          orgId: agentCredentials.orgId,
        })
        .from(agentCredentials)
        .where(and(eq(agentCredentials.credentialHash, credHash), isNull(agentCredentials.revokedAt)))
        .limit(1);
      return rows[0];
    },

    /**
     * Atomic: insert agent row + insert first agent_credentials row in one transaction.
     * Returns { agentId, credentialPlaintext } — plaintext returned ONCE, never stored.
     * D-37 / ATOK-05.
     */
    async registerNewAgent(params: {
      orgId: string;
      hostname: string;
      labels: Record<string, string>;
    }): Promise<{ agentId: string; credentialPlaintext: string }> {
      const agentId = generateId('agt');
      const credentialPlaintext = generateToken();
      const credentialHash = hashToken(credentialPlaintext);
      try {
        await db.transaction(async (tx) => {
          const agentPayload = {
            id: agentId,
            orgId: params.orgId,
            hostname: params.hostname,
            labels: params.labels,
            state: 'online' as const,
            lastSeenAt: new Date(),
          } satisfies NewAgent;
          await tx.insert(agents).values(agentPayload);
          const credPayload = {
            id: generateId('crd'),
            agentId,
            orgId: params.orgId,
            credentialHash,
          } satisfies NewAgentCredential;
          await tx.insert(agentCredentials).values(credPayload);
        });
      } catch (err) {
        throw new DatabaseError('registerNewAgent failed', err);
      }
      return { agentId, credentialPlaintext };
    },

    /**
     * Issue a new credential for an existing agent (credential rotation).
     * Revokes old active credential + inserts new in one transaction.
     * Returns plaintext ONCE — caller must hand it to the agent and never log it.
     */
    async issueAgentCredential(agentId: string, orgId: string): Promise<string> {
      const credentialPlaintext = generateToken();
      const credentialHash = hashToken(credentialPlaintext);
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(agentCredentials)
            .set({ revokedAt: sql`now()` })
            .where(
              and(
                eq(agentCredentials.agentId, agentId),
                eq(agentCredentials.orgId, orgId),
                isNull(agentCredentials.revokedAt),
              ),
            );
          const credPayload = {
            id: generateId('crd'),
            agentId,
            orgId,
            credentialHash,
          } satisfies NewAgentCredential;
          await tx.insert(agentCredentials).values(credPayload);
        });
      } catch (err) {
        throw new DatabaseError('issueAgentCredential failed', err);
      }
      return credentialPlaintext;
    },
  };
}

export type AdminRepo = ReturnType<typeof makeAdminRepo>;
