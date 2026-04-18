import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId, generateToken } from '../crypto/tokens.js';
import { type NewOrgInvite, orgInvites } from '../db/schema.js';

export function makeOrgInvitesRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /** Create a new invite for this org. D-19: 7d expiry, single-use token. */
    async create(params: {
      inviterUserId: string;
      email: string;
      role: 'member' | 'viewer';
    }): Promise<{ id: string; token: string; expiresAt: Date }> {
      const id = generateId('inv');
      const token = generateToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const payload = {
        id,
        orgId,
        inviterUserId: params.inviterUserId,
        email: params.email.toLowerCase(),
        role: params.role,
        token,
        expiresAt,
      } satisfies NewOrgInvite;
      await db.insert(orgInvites).values(payload);
      return { id, token, expiresAt };
    },

    /**
     * Find a valid (non-expired, non-accepted, non-revoked) invite by token for this org.
     * D-19: org-scoped lookup (acceptedAt + revokedAt + expiresAt guards).
     */
    async findValidByToken(token: string) {
      return db
        .select()
        .from(orgInvites)
        .where(
          and(
            eq(orgInvites.token, token),
            eq(orgInvites.orgId, orgId),
            isNull(orgInvites.acceptedAt),
            isNull(orgInvites.revokedAt),
            gt(orgInvites.expiresAt, sql`now()`),
          ),
        )
        .limit(1);
    },

    /** List all pending (non-expired, non-accepted, non-revoked) invites for this org. */
    async listPending() {
      return db
        .select()
        .from(orgInvites)
        .where(
          and(
            eq(orgInvites.orgId, orgId),
            isNull(orgInvites.acceptedAt),
            isNull(orgInvites.revokedAt),
            gt(orgInvites.expiresAt, sql`now()`),
          ),
        );
    },

    /** Revoke an invite (owner cancellation). Sets revokedAt. */
    async revoke(inviteId: string) {
      return db
        .update(orgInvites)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(orgInvites.id, inviteId),
            eq(orgInvites.orgId, orgId),
            isNull(orgInvites.acceptedAt),
            isNull(orgInvites.revokedAt),
          ),
        );
    },

    /** Mark an invite as accepted. Sets acceptedAt + acceptedByUserId. */
    async markAccepted(inviteId: string, acceptedByUserId: string) {
      return db
        .update(orgInvites)
        .set({ acceptedAt: sql`now()`, acceptedByUserId })
        .where(
          and(
            eq(orgInvites.id, inviteId),
            eq(orgInvites.orgId, orgId),
            isNull(orgInvites.acceptedAt),
            isNull(orgInvites.revokedAt),
            gt(orgInvites.expiresAt, sql`now()`),
          ),
        );
    },
  };
}

export type OrgInvitesRepo = ReturnType<typeof makeOrgInvitesRepo>;
