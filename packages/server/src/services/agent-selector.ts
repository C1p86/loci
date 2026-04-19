// packages/server/src/services/agent-selector.ts
//
// DISP-02 / Plan 10-03 Task 1: Eligible agent selection with JSONB label containment,
// per-agent concurrency cap, online/last_seen_at filter, and round-robin tiebreak.
//
// WHY sql`@>`: Drizzle has no built-in Postgres JSONB containment operator.
// The @> operator uses the GIN index on agents.labels (added Phase 10 migration)
// and runs in O(log n) — far faster than a JS-side filter over all agents.
//
// T-10-03-06: selectEligibleAgent receives orgId from caller (the DispatchQueue entry).
// It NEVER cross-org queries — all results are filtered by eq(agents.orgId, orgId).

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agents, taskRuns } from '../db/schema.js';

/**
 * Find the best eligible agent for a queued run entry.
 *
 * Eligibility criteria (D-08):
 *   1. Same org: agents.org_id = orgId
 *   2. Online + recently seen: state='online' AND last_seen_at > now() - 60s
 *   3. Not draining: state != 'draining' (subsumed by state='online' but explicit for clarity)
 *   4. Label match: agents.labels @> requirementsObject (JSONB containment)
 *   5. Under concurrency cap: active_runs < agents.max_concurrent
 *
 * Selection ordering:
 *   - Primary: fewest active runs (least-busy)
 *   - Tiebreak: round-robin via lastCursorAgentId — among agents tied at min count,
 *     pick the first one AFTER the cursor in id order; wrap around if cursor is last.
 *
 * @param db - Drizzle DB connection
 * @param orgId - org to scope the search to
 * @param labelRequirements - ["os=linux", "arch=x64"] style requirement strings
 * @param lastCursorAgentId - last agent dispatched to for this org (round-robin state)
 * @returns agentId string if eligible agent found, null otherwise
 */
export async function selectEligibleAgent(
  db: PostgresJsDatabase,
  orgId: string,
  labelRequirements: string[],
  lastCursorAgentId: string | null,
): Promise<string | null> {
  // Build JSONB requirement object from ["key=value"] strings
  const reqObject: Record<string, string> = {};
  for (const req of labelRequirements) {
    const idx = req.indexOf('=');
    if (idx === -1) continue;
    reqObject[req.slice(0, idx)] = req.slice(idx + 1);
  }
  const labelJson = JSON.stringify(reqObject);

  // Subquery: count active runs (dispatched|running) per agent
  const activeRunsSq = db
    .select({
      agentId: taskRuns.agentId,
      cnt: sql<number>`count(*)::int`.as('cnt'),
    })
    .from(taskRuns)
    .where(inArray(taskRuns.state, ['dispatched', 'running']))
    .groupBy(taskRuns.agentId)
    .as('active_runs');

  const candidates = await db
    .select({
      agentId: agents.id,
      maxConcurrent: agents.maxConcurrent,
      activeCount: sql<number>`coalesce(${activeRunsSq.cnt}, 0)`.as('active_count'),
    })
    .from(agents)
    .leftJoin(activeRunsSq, eq(agents.id, activeRunsSq.agentId))
    .where(
      and(
        eq(agents.orgId, orgId),
        eq(agents.state, 'online'),
        sql`${agents.lastSeenAt} > now() - interval '60 seconds'`,
        sql`${agents.labels} @> ${labelJson}::jsonb`,
        sql`coalesce(${activeRunsSq.cnt}, 0) < ${agents.maxConcurrent}`,
      ),
    )
    .orderBy(
      sql`coalesce(${activeRunsSq.cnt}, 0)`,
      agents.id, // deterministic secondary sort for round-robin
    );

  if (candidates.length === 0) return null;

  // Round-robin tiebreak: among agents tied at the minimum active count, rotate past cursor
  const minCount = candidates[0]!.activeCount;
  const tied = candidates.filter((c) => c.activeCount === minCount);

  if (tied.length === 1) return tied[0]!.agentId;

  // Multiple tied candidates — use cursor to rotate
  if (lastCursorAgentId) {
    const idx = tied.findIndex((c) => c.agentId === lastCursorAgentId);
    if (idx !== -1 && idx + 1 < tied.length) {
      return tied[idx + 1]!.agentId;
    }
  }
  // Cursor not found or at end → wrap to first
  return tied[0]!.agentId;
}
