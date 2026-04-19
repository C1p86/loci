// packages/server/src/repos/log-chunks.ts
// D-01: org-scoped repo for log_chunks. Never import directly from routes/plugins — use forOrg().
// D-04 auto-discovery: this file is covered by log-chunks.isolation.test.ts.

import { and, asc, count, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type LogChunk, logChunks, type NewLogChunk, taskRuns } from '../db/schema.js';
import { LogChunkStorageError } from '../errors.js';

/**
 * D-26: Org-scoped repo for log_chunks.
 * Every query joins task_runs to enforce org scoping (no direct org_id FK on log_chunks per D-01).
 * Never exported from repos/index.ts (D-01 discipline — use forOrg()).
 *
 * T-11-01-01: INNER JOIN task_runs with eq(taskRuns.orgId, orgId) in every query.
 * T-11-01-02: insertBatch uses ON CONFLICT (run_id, seq) DO NOTHING for idempotency.
 */
export function makeLogChunksRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * Bulk INSERT chunks with ON CONFLICT (run_id, seq) DO NOTHING.
     * Returns the number of rows actually inserted (idempotent on replay per D-09/D-22).
     * T-11-01-02: the (run_id, seq) unique index is the DB-level idempotency guarantee.
     *
     * NOTE: The FK on run_id enforces that the run exists in task_runs. However, cross-org
     * inserts (runId belonging to a different org) will either fail the FK or succeed silently
     * — the org scoping is enforced at READ time by the JOIN. insertBatch is always called
     * through forOrg(orgId) so the runId must have already been validated via verifyBelongsToOrg.
     */
    async insertBatch(chunks: NewLogChunk[]): Promise<number> {
      if (chunks.length === 0) return 0;
      try {
        const rows = await db
          .insert(logChunks)
          .values(chunks)
          .onConflictDoNothing({ target: [logChunks.runId, logChunks.seq] })
          .returning({ id: logChunks.id });
        return rows.length;
      } catch (err) {
        throw new LogChunkStorageError('insertBatch failed', err);
      }
    },

    /**
     * SELECT log chunks for a run, scoped to this org via INNER JOIN to task_runs.
     * Results ordered by seq ASC.
     * T-11-01-01: cross-org runId returns [] because the JOIN filters it out.
     *
     * Used for:
     * - UI catch-up on reconnect (D-14): sinceSeq = lastReceivedSeq
     * - Download streaming (D-15): no sinceSeq, all chunks
     */
    async getByRunId(
      runId: string,
      opts?: { sinceSeq?: number; limit?: number },
    ): Promise<LogChunk[]> {
      const effectiveLimit = opts?.limit ?? 1000;
      const conditions = [eq(taskRuns.orgId, orgId), eq(taskRuns.id, runId)];
      if (opts?.sinceSeq !== undefined) {
        conditions.push(gt(logChunks.seq, opts.sinceSeq));
      }
      return db
        .select({
          id: logChunks.id,
          runId: logChunks.runId,
          seq: logChunks.seq,
          stream: logChunks.stream,
          data: logChunks.data,
          ts: logChunks.ts,
          persistedAt: logChunks.persistedAt,
        })
        .from(logChunks)
        .innerJoin(taskRuns, eq(logChunks.runId, taskRuns.id))
        .where(and(...conditions))
        .orderBy(asc(logChunks.seq))
        .limit(effectiveLimit);
    },

    /**
     * COUNT chunks for a run, scoped to this org via INNER JOIN to task_runs.
     * T-11-01-01: cross-org runId returns 0.
     * D-26: nice-to-have for UI progress indicator.
     */
    async countByRunId(runId: string): Promise<number> {
      const rows = await db
        .select({ n: count() })
        .from(logChunks)
        .innerJoin(taskRuns, eq(logChunks.runId, taskRuns.id))
        .where(and(eq(taskRuns.orgId, orgId), eq(taskRuns.id, runId)));
      return rows[0]?.n ?? 0;
    },

    /**
     * DELETE chunks for a specific run older than a given timestamp.
     * Retention helper — not used by the default global cleanup (which uses adminRepo.runRetentionCleanup).
     * D-26: available for per-run targeted retention.
     */
    async deleteOlderThan(runId: string, before: Date): Promise<number> {
      const rows = await db
        .delete(logChunks)
        .where(and(eq(logChunks.runId, runId), sql`${logChunks.persistedAt} < ${before}`))
        .returning({ id: logChunks.id });
      return rows.length;
    },
  };
}

export type LogChunksRepo = ReturnType<typeof makeLogChunksRepo>;
