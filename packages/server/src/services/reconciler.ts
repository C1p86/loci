// packages/server/src/services/reconciler.ts
//
// Plan 10-03 Task 3: Boot reconciliation + reconnect reconciliation.
// This stub is imported by dispatcherPlugin (Task 2) — full implementation in Task 3.

import type { FastifyInstance } from 'fastify';
import type { ReconcileEntry, RunState } from '../ws/types.js';

/**
 * Boot reconciliation (DISP-08 / D-23).
 * Called from dispatcherPlugin onReady AFTER @fastify/websocket is registered.
 * Stub in Task 2 — Task 3 implements all 4 D-23 branches.
 */
export async function runBootReconciliation(_fastify: FastifyInstance): Promise<void> {
  // Task 3 implements: queued→re-enqueue, dispatched/running+no-agent→re-queue/orphan,
  // timeout-expired→timed_out, active+agent→fresh timer.
}

/**
 * Reconnect reconciliation (D-24).
 * Called from handler.ts reconnect branch — replaces the [] stub from Plan 10-02.
 * Stub in Task 2 — Task 3 implements continue/abandon logic.
 */
export async function buildReconnectReconciliation(
  _fastify: FastifyInstance,
  _orgId: string,
  _runningRuns: RunState[],
): Promise<ReconcileEntry[]> {
  return [];
}
