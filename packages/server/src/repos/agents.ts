import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import { agents, type NewAgent } from '../db/schema.js';

export function makeAgentsRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async list() {
      return db.select().from(agents).where(eq(agents.orgId, orgId));
    },

    async getById(id: string) {
      const rows = await db
        .select()
        .from(agents)
        .where(and(eq(agents.orgId, orgId), eq(agents.id, id)))
        .limit(1);
      return rows[0];
    },

    async create(params: {
      hostname: string;
      labels: Record<string, string>;
    }): Promise<{ id: string }> {
      const id = generateId('agt');
      const payload = {
        id,
        orgId,
        hostname: params.hostname,
        labels: params.labels,
        // state defaults to 'offline'; lastSeenAt null; registeredAt defaults to now()
      } satisfies NewAgent;
      await db.insert(agents).values(payload);
      return { id };
    },

    async updateState(id: string, state: 'online' | 'offline' | 'draining') {
      await db
        .update(agents)
        .set({ state, updatedAt: sql`now()` })
        .where(and(eq(agents.orgId, orgId), eq(agents.id, id)));
    },

    async updateHostname(id: string, hostname: string) {
      await db
        .update(agents)
        .set({ hostname, updatedAt: sql`now()` })
        .where(and(eq(agents.orgId, orgId), eq(agents.id, id)));
    },

    /** D-16: called on every pong. Hot path — no state change, just last_seen_at. */
    async recordHeartbeat(id: string) {
      await db
        .update(agents)
        .set({ lastSeenAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(agents.orgId, orgId), eq(agents.id, id)));
    },

    async delete(id: string) {
      await db.delete(agents).where(and(eq(agents.orgId, orgId), eq(agents.id, id)));
      // CASCADE removes agent_credentials (per D-10 schema FK).
    },
  };
}

export type AgentsRepo = ReturnType<typeof makeAgentsRepo>;
