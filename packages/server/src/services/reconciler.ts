// packages/server/src/services/reconciler.ts
//
// Plan 10-03 Task 3: Boot reconciliation (D-23) + reconnect reconciliation (D-24).
//
// Boot reconciliation (runBootReconciliation):
//   Scans all active task_runs on startup and applies the 4 D-23 branches:
//     A. queued → re-enqueue in dispatchQueue (no DB change)
//     B. dispatched/running WHERE timeout expired → timed_out
//     C. dispatched/running WHERE agent NOT connected → re-queue (dispatched) / orphan (running)
//     D. dispatched/running WHERE agent IS connected → register fresh timer for remaining window
//
// Reconnect reconciliation (buildReconnectReconciliation):
//   Cross-references agent's reported running_runs against DB state (D-24).
//   Returns continue/abandon actions for each reported run.
//
// Threat register:
//   T-10-03-02: only 'dispatched' runs (no confirmed side effects) are re-queued on boot;
//               'running' runs (agent acked, may have had side effects) are orphaned.
//   T-10-03-05: log statements use {runId, orgId} ONLY — never log task_snapshot or params.
//   T-10-03-06: buildReconnectReconciliation uses forOrg(orgId) — cross-org run_ids return abandon.

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { makeRepos } from '../repos/index.js';
import type { ReconcileEntry, RunState, TaskSnapshot } from '../ws/types.js';
import type { QueueEntry } from './dispatcher.js';
import { registerRunTimer } from './timeout-manager.js';

/** Terminal states that cannot transition further. */
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned']);

/**
 * Build a QueueEntry from a TaskRun DB row.
 *
 * WHY task_snapshot (not DB task lookup): task_snapshot stores the task definition
 * AT DISPATCH TIME. Using the snapshot ensures reproducibility even if the task
 * was edited or deleted after the run was triggered. (Plan 10-03 design note.)
 *
 * WHY params = {} for re-enqueued runs: the fully-resolved params were only in memory
 * at trigger time. On re-queue after crash, the dispatch frame will send the params
 * from paramOverrides. Plan 10-04 / Plan 10-05 will handle agent-side merging.
 * TODO Plan 10-04: when trigger route is wired, store resolved params in QueueEntry and
 * re-resolve here using dispatch-resolver (see Plan 10-03 design note about orgSecrets).
 */
function toQueueEntry(run: {
  id: string;
  orgId: string;
  taskSnapshot: unknown;
  paramOverrides: Record<string, string> | null;
  timeoutSeconds: number;
}): QueueEntry {
  const snapshot = run.taskSnapshot as TaskSnapshot;
  return {
    runId: run.id,
    orgId: run.orgId,
    taskSnapshot: snapshot,
    // paramOverrides are the UI-supplied overrides; org secrets will be merged by Plan 10-05
    params: (run.paramOverrides as Record<string, string>) ?? {},
    labelRequirements: snapshot.label_requirements ?? [],
    timeoutSeconds: run.timeoutSeconds,
  };
}

/**
 * Boot reconciliation (DISP-08 / D-23).
 * Called from dispatcherPlugin onReady AFTER @fastify/websocket is registered so that
 * fastify.agentRegistry is populated with any agents that reconnected during server startup.
 *
 * D-23 branch priority:
 *   1. timeout expired (check BEFORE agent-connected check — D-22 takes priority over D-23-C)
 *   2. agent connected → fresh timer
 *   3. agent NOT connected → re-queue (dispatched) or orphan (running)
 *
 * T-10-03-05: logs only {runId, orgId} — never the run object itself.
 */
export async function runBootReconciliation(fastify: FastifyInstance): Promise<void> {
  const repos = makeRepos(fastify.db, fastify.mek);
  const runs = await repos.admin.findRunsForReconciliation();

  for (const run of runs) {
    // Step A: queued runs — re-add to in-memory dispatch queue, no DB change
    if (run.state === 'queued') {
      fastify.dispatchQueue.enqueue(
        toQueueEntry({
          ...run,
          paramOverrides: run.paramOverrides as Record<string, string> | null,
        }),
      );
      fastify.log.info(
        { runId: run.id, orgId: run.orgId },
        'reconciliation: re-enqueued queued run',
      );
      continue;
    }

    // Steps B-D apply to dispatched/running runs.
    // Determine when timeout expires for this run.
    const dispatchedMs = run.dispatchedAt ? new Date(run.dispatchedAt).getTime() : Date.now();
    const expiresAtMs = dispatchedMs + run.timeoutSeconds * 1000;

    // Step B: timeout expired during downtime (D-22 / D-23 branch 3)
    if (Date.now() > expiresAtMs) {
      await repos
        .forOrg(run.orgId)
        .taskRuns.updateStateMulti(run.id, ['dispatched', 'running'], 'timed_out', {
          finishedAt: sql`now()` as unknown as Date,
          exitCode: -1,
        });
      fastify.log.warn(
        { runId: run.id, orgId: run.orgId },
        'reconciliation: timeout expired during downtime → timed_out',
      );
      continue;
    }

    // Step C/D: check whether agent is still connected
    const agentConnected = run.agentId != null && fastify.agentRegistry.has(run.agentId);

    if (agentConnected) {
      // Step D: agent connected — register fresh timer for remaining window (D-22)
      const elapsedSeconds = Math.floor((Date.now() - dispatchedMs) / 1000);
      const remaining = Math.max(1, run.timeoutSeconds - elapsedSeconds);
      registerRunTimer(fastify, run.id, run.orgId, remaining);
      fastify.log.info(
        { runId: run.id, orgId: run.orgId, remaining },
        'reconciliation: agent connected — fresh timer registered',
      );
      continue;
    }

    // Step C: agent not connected — handle by state
    if (run.state === 'dispatched') {
      // T-10-03-02: dispatched = not yet acked by agent, no confirmed side effects → safe to re-queue
      await repos.forOrg(run.orgId).taskRuns.updateState(run.id, 'dispatched', 'queued', {
        agentId: null as unknown as string,
        dispatchedAt: null as unknown as Date,
      });
      fastify.dispatchQueue.enqueue(
        toQueueEntry({
          ...run,
          paramOverrides: run.paramOverrides as Record<string, string> | null,
        }),
      );
      fastify.log.info(
        { runId: run.id, orgId: run.orgId },
        'reconciliation: dispatched run re-queued (agent gone)',
      );
    } else {
      // state === 'running': agent acked, may have had side effects → orphan
      await repos.forOrg(run.orgId).taskRuns.updateState(run.id, 'running', 'orphaned', {
        finishedAt: sql`now()` as unknown as Date,
        exitCode: -1,
      });
      fastify.log.warn(
        { runId: run.id, orgId: run.orgId },
        'reconciliation: running run orphaned (agent gone, possible side effects)',
      );
    }
  }
}

/**
 * Reconnect reconciliation (D-24).
 * Called from handler.ts reconnect branch; replaces the [] stub from Plan 10-02 (D-18).
 *
 * For each run_id the agent reports as running:
 *   - DB row missing → abandon (run never existed or was deleted)
 *   - DB state terminal → abandon (server already closed the run)
 *   - DB state dispatched → promote to running (agent started executing) + continue + timer
 *   - DB state running → continue + fresh timer
 *
 * T-10-03-06: uses forOrg(orgId) — a run_id belonging to another org will return undefined → abandon.
 */
export async function buildReconnectReconciliation(
  fastify: FastifyInstance,
  orgId: string,
  runningRuns: RunState[],
): Promise<ReconcileEntry[]> {
  const result: ReconcileEntry[] = [];
  const repo = makeRepos(fastify.db, fastify.mek).forOrg(orgId).taskRuns;

  for (const agentRun of runningRuns) {
    const dbRun = await repo.getById(agentRun.run_id);

    if (!dbRun) {
      // No DB record — unknown run; agent should stop executing it
      result.push({ run_id: agentRun.run_id, action: 'abandon' });
      continue;
    }

    if (TERMINAL_STATES.has(dbRun.state)) {
      // Run already closed server-side; agent needs to stop
      result.push({ run_id: agentRun.run_id, action: 'abandon' });
      continue;
    }

    // Active run (dispatched or running) — agent continues
    if (dbRun.state === 'dispatched') {
      // Agent already started executing → promote to running
      await repo.updateState(agentRun.run_id, 'dispatched', 'running', {
        startedAt: sql`now()` as unknown as Date,
      });
    }

    // Register fresh timer for remaining window
    const dispatchedAt = dbRun.dispatchedAt ? new Date(dbRun.dispatchedAt).getTime() : Date.now();
    const elapsed = Math.floor((Date.now() - dispatchedAt) / 1000);
    const remaining = Math.max(1, dbRun.timeoutSeconds - elapsed);
    registerRunTimer(fastify, agentRun.run_id, orgId, remaining);

    result.push({ run_id: agentRun.run_id, action: 'continue' });
  }

  return result;
}
