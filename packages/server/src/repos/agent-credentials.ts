import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import { agentCredentials, type NewAgentCredential } from '../db/schema.js';

export function makeAgentCredentialsRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * D-10 partial unique index: at most ONE active credential per agent.
     * Must revoke existing active credential BEFORE inserting new — or PG raises 23505.
     * Wrap both operations in a transaction to avoid race.
     */
    async createForAgent(agentId: string, credentialHash: string): Promise<{ id: string }> {
      const id = generateId('crd');
      await db.transaction(async (tx) => {
        await tx
          .update(agentCredentials)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(agentCredentials.orgId, orgId),
              eq(agentCredentials.agentId, agentId),
              isNull(agentCredentials.revokedAt),
            ),
          );
        const payload = { id, agentId, orgId, credentialHash } satisfies NewAgentCredential;
        await tx.insert(agentCredentials).values(payload);
      });
      return { id };
    },

    async revokeForAgent(agentId: string) {
      await db
        .update(agentCredentials)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            eq(agentCredentials.orgId, orgId),
            eq(agentCredentials.agentId, agentId),
            isNull(agentCredentials.revokedAt),
          ),
        );
    },

    async findActiveByAgentId(agentId: string) {
      const rows = await db
        .select()
        .from(agentCredentials)
        .where(
          and(
            eq(agentCredentials.orgId, orgId),
            eq(agentCredentials.agentId, agentId),
            isNull(agentCredentials.revokedAt),
          ),
        )
        .limit(1);
      return rows[0];
    },
  };
}

export type AgentCredentialsRepo = ReturnType<typeof makeAgentCredentialsRepo>;
