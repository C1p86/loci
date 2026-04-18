import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId, generateToken, hashToken } from '../crypto/tokens.js';
import { type NewRegistrationToken, registrationTokens } from '../db/schema.js';

export function makeRegistrationTokensRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * ATOK-01: creates a single-use 24h token. Returns plaintext ONCE; stores only hash.
     * Caller is responsible for returning plaintext to the user and never logging it.
     */
    async create(createdByUserId: string): Promise<{
      id: string;
      tokenPlaintext: string;
      expiresAt: Date;
    }> {
      const id = generateId('rtk');
      const tokenPlaintext = generateToken();
      const tokenHash = hashToken(tokenPlaintext);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const payload = {
        id,
        orgId,
        tokenHash,
        createdByUserId,
        expiresAt,
      } satisfies NewRegistrationToken;
      await db.insert(registrationTokens).values(payload);
      return { id, tokenPlaintext, expiresAt };
    },

    async listActive() {
      return db
        .select({
          id: registrationTokens.id,
          createdByUserId: registrationTokens.createdByUserId,
          createdAt: registrationTokens.createdAt,
          expiresAt: registrationTokens.expiresAt,
        })
        .from(registrationTokens)
        .where(
          and(
            eq(registrationTokens.orgId, orgId),
            isNull(registrationTokens.consumedAt),
            gt(registrationTokens.expiresAt, sql`now()`),
          ),
        );
    },

    /** Revoke by marking consumed — single-use semantics cover this. */
    async revoke(id: string) {
      await db
        .update(registrationTokens)
        .set({ consumedAt: sql`now()` })
        .where(
          and(
            eq(registrationTokens.orgId, orgId),
            eq(registrationTokens.id, id),
            isNull(registrationTokens.consumedAt),
          ),
        );
    },
  };
}

export type RegistrationTokensRepo = ReturnType<typeof makeRegistrationTokensRepo>;
