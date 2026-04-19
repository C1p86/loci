// packages/server/src/repos/task-runs.ts
// D-01: org-scoped repo for task_runs. Never import directly from routes/plugins — use forOrg().
// D-04 auto-discovery: this file is covered by task-runs.isolation.test.ts.

import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import { type NewTaskRun, type TaskRun, type TaskRunState, taskRuns } from '../db/schema.js';

/**
 * D-29: Org-scoped repo for task_runs.
 * All queries include eq(taskRuns.orgId, orgId) in their WHERE clause.
 * Never exported from repos/index.ts (D-01 discipline — use forOrg()).
 *
 * WHY no mek param: task_runs stores plain-object JSONB snapshots. Secrets decryption
 * happens in the dispatch-resolver (Phase 9 D-33) before the run is enqueued.
 * The repo never touches the MEK.
 */
export function makeTaskRunsRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * Create a new task_run in state='queued'. Returns the full inserted row.
     * Caller must have already resolved params (dispatch-resolver) and built the taskSnapshot.
     */
    async create(params: {
      taskId: string;
      taskSnapshot: Record<string, unknown>;
      paramOverrides?: Record<string, string>;
      triggeredByUserId?: string;
      timeoutSeconds?: number;
    }): Promise<TaskRun> {
      const id = generateId('run');
      const payload = {
        id,
        orgId,
        taskId: params.taskId,
        taskSnapshot: params.taskSnapshot,
        paramOverrides: params.paramOverrides ?? {},
        state: 'queued' as const,
        triggeredByUserId: params.triggeredByUserId ?? null,
        timeoutSeconds: params.timeoutSeconds ?? 3600,
        queuedAt: new Date(),
      } satisfies NewTaskRun;
      const rows = await db.insert(taskRuns).values(payload).returning();
      const row = rows[0];
      if (!row) throw new Error('create: insert returned no rows');
      return row;
    },

    /**
     * Get full task_run row by ID, scoped to this org.
     * Returns undefined if not found or belongs to a different org (T-10-01-03).
     */
    async getById(runId: string): Promise<TaskRun | undefined> {
      const rows = await db
        .select()
        .from(taskRuns)
        .where(and(eq(taskRuns.orgId, orgId), eq(taskRuns.id, runId)))
        .limit(1);
      return rows[0];
    },

    /**
     * List runs for this org with optional filters.
     * T-10-01-06: limit defaults to 50, clamped to max 200. Cursor-based via queued_at < since.
     */
    async list(opts: {
      state?: TaskRunState | TaskRunState[];
      taskId?: string;
      since?: Date;
      limit?: number;
    }): Promise<TaskRun[]> {
      const effectiveLimit = Math.min(opts.limit ?? 50, 200);
      const conditions = [eq(taskRuns.orgId, orgId)];

      if (opts.state !== undefined) {
        if (Array.isArray(opts.state)) {
          conditions.push(inArray(taskRuns.state, opts.state));
        } else {
          conditions.push(eq(taskRuns.state, opts.state));
        }
      }
      if (opts.taskId !== undefined) {
        conditions.push(eq(taskRuns.taskId, opts.taskId));
      }
      if (opts.since !== undefined) {
        conditions.push(lt(taskRuns.queuedAt, opts.since));
      }

      return db
        .select()
        .from(taskRuns)
        .where(and(...conditions))
        .orderBy(desc(taskRuns.queuedAt))
        .limit(effectiveLimit);
    },

    /**
     * List runs with state IN ('dispatched', 'running') for a given agent, scoped to this org.
     * Used by agent-selector for per-agent concurrency counting (D-08).
     */
    async listActiveByAgent(agentId: string): Promise<TaskRun[]> {
      return db
        .select()
        .from(taskRuns)
        .where(
          and(
            eq(taskRuns.orgId, orgId),
            eq(taskRuns.agentId, agentId),
            inArray(taskRuns.state, ['dispatched', 'running']),
          ),
        );
    },

    /**
     * List runs by state array, scoped to this org.
     * Used by reconciler (10-03) and quota checks.
     */
    async listByState(states: TaskRunState[]): Promise<TaskRun[]> {
      return db
        .select()
        .from(taskRuns)
        .where(and(eq(taskRuns.orgId, orgId), inArray(taskRuns.state, states)));
    },

    /**
     * Atomic CAS state transition (RESEARCH FA-1 / Pitfall 2).
     * UPDATE ... WHERE id=runId AND org_id=orgId AND state=expectedState RETURNING *.
     * Returns undefined if no row matched (CAS failed — run already in different state or wrong org).
     * Caller treats undefined as RunStateTransitionError if needed.
     *
     * WHY orgId in WHERE: per T-10-01-03 (Pitfall 5 frame spoofing) — agent B must not
     * be able to mutate a run owned by org A even with a valid run_id.
     */
    async updateState(
      runId: string,
      expectedState: TaskRunState,
      newState: TaskRunState,
      extra?: Partial<NewTaskRun>,
    ): Promise<TaskRun | undefined> {
      const rows = await db
        .update(taskRuns)
        .set({ state: newState, updatedAt: sql`now()`, ...extra })
        .where(
          and(eq(taskRuns.id, runId), eq(taskRuns.orgId, orgId), eq(taskRuns.state, expectedState)),
        )
        .returning();
      return rows[0];
    },

    /**
     * Multi-source CAS: transition when the run is in ANY of the expectedStates.
     * Used for timeout (dispatched|running → timed_out) and orphan detection.
     * Returns undefined if CAS missed (run already terminal or wrong org).
     */
    async updateStateMulti(
      runId: string,
      expectedStates: TaskRunState[],
      newState: TaskRunState,
      extra?: Partial<NewTaskRun>,
    ): Promise<TaskRun | undefined> {
      const rows = await db
        .update(taskRuns)
        .set({ state: newState, updatedAt: sql`now()`, ...extra })
        .where(
          and(
            eq(taskRuns.id, runId),
            eq(taskRuns.orgId, orgId),
            inArray(taskRuns.state, expectedStates),
          ),
        )
        .returning();
      return rows[0];
    },

    /**
     * Mark a run terminal: sets state, finishedAt=now(), exitCode.
     * Thin wrapper over updateStateMulti expecting ['dispatched','running'].
     * Returns undefined if the run was not in an active state (idempotent for duplicate result frames).
     */
    async markTerminal(
      runId: string,
      newState: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'orphaned',
      exitCode: number,
    ): Promise<TaskRun | undefined> {
      return this.updateStateMulti(runId, ['dispatched', 'running'], newState, {
        finishedAt: sql`now()` as unknown as Date,
        exitCode,
      });
    },

    /**
     * Returns true iff the run exists AND belongs to this org.
     * Used by WS frame router (Plan 10-02) to guard against frame spoofing (T-10-01-03 / Pitfall 5).
     * Fast: SELECT id only, LIMIT 1.
     */
    async verifyBelongsToOrg(runId: string): Promise<boolean> {
      const rows = await db
        .select({ id: taskRuns.id })
        .from(taskRuns)
        .where(and(eq(taskRuns.id, runId), eq(taskRuns.orgId, orgId)))
        .limit(1);
      return rows.length > 0;
    },
  };
}

export type TaskRunsRepo = ReturnType<typeof makeTaskRunsRepo>;
