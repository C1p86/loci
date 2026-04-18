import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { orgMembers, sessions } from '../db/schema.js';

export function makeSessionsRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /** Find an active session by token, scoped to a user who is a member of this org. */
    async findActiveByTokenForOrg(token: string) {
      return db
        .select({ session: sessions })
        .from(sessions)
        .innerJoin(orgMembers, eq(orgMembers.userId, sessions.userId))
        .where(
          and(
            eq(sessions.id, token),
            eq(orgMembers.orgId, orgId),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
    },

    /**
     * Refresh sliding expiry with 1h write-throttle (D-13 + Pitfall 6).
     * ONE SQL statement — atomic throttle + expiry update + revoked-guard + expiry-guard.
     * Also enforces org membership: the session's user must belong to this org.
     */
    async refreshSlidingExpiry(token: string) {
      return db.execute(sql`
        UPDATE sessions
        SET last_seen_at = now(),
            expires_at = LEAST(
              now() + interval '14 days',
              created_at + interval '30 days'
            )
        WHERE id = ${token}
          AND revoked_at IS NULL
          AND expires_at > now()
          AND last_seen_at < now() - interval '1 hour'
          AND EXISTS (
            SELECT 1 FROM org_members
            WHERE org_members.user_id = sessions.user_id
              AND org_members.org_id = ${orgId}
          )
      `);
    },

    /**
     * Set active org id on a session (D-18).
     * Guard: user must be a member of BOTH the scoping org and the new active org.
     */
    async setActiveOrgId(token: string, newActiveOrgId: string) {
      return db
        .update(sessions)
        .set({ activeOrgId: newActiveOrgId })
        .where(
          and(
            eq(sessions.id, token),
            sql`EXISTS (SELECT 1 FROM org_members WHERE user_id = sessions.user_id AND org_id = ${orgId})`,
            sql`EXISTS (SELECT 1 FROM org_members WHERE user_id = sessions.user_id AND org_id = ${newActiveOrgId})`,
          ),
        );
    },
  };
}

export type SessionsRepo = ReturnType<typeof makeSessionsRepo>;
