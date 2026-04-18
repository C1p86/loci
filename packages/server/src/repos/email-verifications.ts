import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { emailVerifications, orgMembers } from '../db/schema.js';

export function makeEmailVerificationsRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /** Find an unconsumed, unexpired verification whose user is a member of this org. */
    async findValidByTokenForOrg(token: string) {
      return db
        .select({ verification: emailVerifications })
        .from(emailVerifications)
        .innerJoin(orgMembers, eq(orgMembers.userId, emailVerifications.userId))
        .where(
          and(
            eq(emailVerifications.token, token),
            eq(orgMembers.orgId, orgId),
            isNull(emailVerifications.consumedAt),
            gt(emailVerifications.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
    },

    /**
     * Atomically mark a verification token as consumed.
     * Guard: consumed_at IS NULL + not expired + user must belong to this org.
     */
    async markConsumed(token: string) {
      return db
        .update(emailVerifications)
        .set({ consumedAt: sql`now()` })
        .where(
          and(
            eq(emailVerifications.token, token),
            isNull(emailVerifications.consumedAt),
            gt(emailVerifications.expiresAt, sql`now()`),
            sql`EXISTS (SELECT 1 FROM org_members WHERE user_id = email_verifications.user_id AND org_id = ${orgId})`,
          ),
        );
    },
  };
}

export type EmailVerificationsRepo = ReturnType<typeof makeEmailVerificationsRepo>;
