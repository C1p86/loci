import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { orgMembers, passwordResets } from '../db/schema.js';

export function makePasswordResetsRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * Find an unconsumed, unexpired password reset whose user is a member of this org.
     * 1h expiry is enforced at insert time (in adminRepo.createPasswordReset); repo just reads.
     */
    async findValidByTokenForOrg(token: string) {
      return db
        .select({ reset: passwordResets })
        .from(passwordResets)
        .innerJoin(orgMembers, eq(orgMembers.userId, passwordResets.userId))
        .where(
          and(
            eq(passwordResets.token, token),
            eq(orgMembers.orgId, orgId),
            isNull(passwordResets.consumedAt),
            gt(passwordResets.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
    },

    /**
     * Atomically mark a password reset token as consumed.
     * Guard: consumed_at IS NULL + not expired + user must belong to this org.
     */
    async markConsumed(token: string) {
      return db
        .update(passwordResets)
        .set({ consumedAt: sql`now()` })
        .where(
          and(
            eq(passwordResets.token, token),
            isNull(passwordResets.consumedAt),
            gt(passwordResets.expiresAt, sql`now()`),
            sql`EXISTS (SELECT 1 FROM org_members WHERE user_id = password_resets.user_id AND org_id = ${orgId})`,
          ),
        );
    },
  };
}

export type PasswordResetsRepo = ReturnType<typeof makePasswordResetsRepo>;
