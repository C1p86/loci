// packages/server/src/repos/dlq-entries.ts
// D-04 auto-discovery: covered by dlq-entries.isolation.test.ts.
// Phase 12 D-19/D-21: org-scoped repo for dlq_entries (dead-letter queue).
// Cursor-based pagination by (receivedAt, id) per D-21; limit clamped to 200 (D-21 / task-runs pattern).

import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import {
  type DlqEntry,
  type DlqFailureReason,
  type DlqRetryResult,
  type NewDlqEntry,
  dlqEntries,
} from '../db/schema.js';

/**
 * D-19/D-21: Org-scoped repo for dlq_entries.
 * All queries include eq(dlqEntries.orgId, orgId) in their WHERE clause (T-12-01-02).
 * Body and headers stored as-is — caller is responsible for pre-scrubbing per PLUG-08.
 */
export function makeDlqEntriesRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * Insert a new DLQ entry for a failed webhook delivery.
     * scrubbedBody and scrubbedHeaders: caller must strip sensitive headers before passing (PLUG-08).
     * Returns the full inserted row.
     */
    async create(params: {
      pluginName: 'github' | 'perforce';
      deliveryId?: string;
      failureReason: DlqFailureReason;
      scrubbedBody: Record<string, unknown>;
      scrubbedHeaders: Record<string, unknown>;
      httpStatus?: number;
    }): Promise<DlqEntry> {
      const id = generateId('dlq');
      const payload = {
        id,
        orgId,
        pluginName: params.pluginName,
        deliveryId: params.deliveryId ?? null,
        failureReason: params.failureReason,
        scrubbedBody: params.scrubbedBody,
        scrubbedHeaders: params.scrubbedHeaders,
        httpStatus: params.httpStatus ?? null,
      } satisfies NewDlqEntry;

      const rows = await db.insert(dlqEntries).values(payload).returning();
      const row = rows[0];
      if (!row) throw new Error('create: insert returned no rows');
      return row;
    },

    /**
     * Get a single DLQ entry by ID, scoped to this org.
     * Returns undefined if not found or belongs to a different org (T-12-01-02).
     */
    async getById(dlqId: string): Promise<DlqEntry | undefined> {
      const rows = await db
        .select()
        .from(dlqEntries)
        .where(and(eq(dlqEntries.orgId, orgId), eq(dlqEntries.id, dlqId)))
        .limit(1);
      return rows[0];
    },

    /**
     * D-21: Cursor-based paginated list of DLQ entries for this org.
     * Ordered by receivedAt DESC, id DESC for stable tie-break.
     * Default limit 50, max 200 (matches task-runs repo pattern).
     *
     * Cursor: { receivedAt: Date; id: string } — entries BEFORE this cursor (older).
     * Filters: pluginName, failureReason, since (entries received AFTER this date).
     */
    async list(opts: {
      limit?: number;
      cursor?: { receivedAt: Date; id: string };
      pluginName?: 'github' | 'perforce';
      failureReason?: DlqFailureReason;
      since?: Date;
    }): Promise<DlqEntry[]> {
      const effectiveLimit = Math.min(opts.limit ?? 50, 200);
      const conditions = [eq(dlqEntries.orgId, orgId)];

      if (opts.pluginName !== undefined) {
        conditions.push(eq(dlqEntries.pluginName, opts.pluginName));
      }
      if (opts.failureReason !== undefined) {
        conditions.push(eq(dlqEntries.failureReason, opts.failureReason));
      }
      if (opts.since !== undefined) {
        conditions.push(gt(dlqEntries.receivedAt, opts.since));
      }
      if (opts.cursor !== undefined) {
        // Cursor pagination: items received strictly before cursor.receivedAt,
        // OR same receivedAt with id < cursor.id (stable tie-break for DESC order).
        const cursor = opts.cursor;
        conditions.push(
          sql`(${dlqEntries.receivedAt} < ${cursor.receivedAt} OR (${dlqEntries.receivedAt} = ${cursor.receivedAt} AND ${dlqEntries.id} < ${cursor.id}))`,
        );
      }

      return db
        .select()
        .from(dlqEntries)
        .where(and(...conditions))
        .orderBy(desc(dlqEntries.receivedAt), desc(dlqEntries.id))
        .limit(effectiveLimit);
    },

    /**
     * Mark a DLQ entry as retried with the given result.
     * Scoped to this org to prevent cross-tenant mutation (T-12-01-02).
     * Returns the updated row, or undefined if not found in this org.
     */
    async markRetried(
      dlqId: string,
      result: DlqRetryResult,
    ): Promise<DlqEntry | undefined> {
      const rows = await db
        .update(dlqEntries)
        .set({
          retriedAt: sql`now()`,
          retryResult: result,
          updatedAt: sql`now()`,
        })
        .where(and(eq(dlqEntries.orgId, orgId), eq(dlqEntries.id, dlqId)))
        .returning();
      return rows[0];
    },
  };
}

export type DlqEntriesRepo = ReturnType<typeof makeDlqEntriesRepo>;
