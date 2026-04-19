// packages/server/src/services/timeout-manager.ts
//
// Per-run timeout management (DISP-06 / Plan 10-03 Task 1).
//
// Design: module-scoped Map<runId, {timer, orgId}> stores handles and the orgId needed
// to call forOrg() on timeout fire. This keeps forOrg() discipline intact — we never
// do a cross-org taskRuns lookup inside handleRunTimeout.
//
// D-20 server-side max: 24h (86400s). Callers requesting longer are capped silently.
//
// Threat register:
// T-10-03-03: Map grows unbounded if cancelRunTimer is never called. Three clear points:
//   1. handleResultFrame (Plan 10-02) calls cancelRunTimer BEFORE its DB write.
//   2. POST /cancel (Plan 10-04) will call cancelRunTimer.
//   3. clearAllRunTimers() is called from app.ts onClose hook.

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { makeRepos } from '../repos/index.js';

interface TimerEntry {
  timer: NodeJS.Timeout;
  orgId: string;
}

const runTimers = new Map<string, TimerEntry>();

/** D-20: server-side max timeout to prevent unbounded setTimeout delays. */
const MAX_TIMEOUT_SECONDS = 86_400; // 24h

/**
 * Register a server-side timeout for a dispatched run.
 *
 * Signature change from Plan 10-02 stub: now takes 4 args (fastify, runId, orgId, timeoutSeconds).
 * WHY orgId is stored: handleRunTimeout needs forOrg() to do the CAS transition; without orgId
 * in the timer entry the only alternative would be a cross-org DB lookup (violates D-01 forOrg
 * discipline). Storing orgId in the Map is the accepted pattern per Plan 10-03 design note.
 *
 * @param fastify - Fastify instance (used by handleRunTimeout for db + agentRegistry)
 * @param runId - run ID to time out
 * @param orgId - org owning the run (stored in Map for handleRunTimeout)
 * @param timeoutSeconds - seconds until timeout fires (capped at 86400)
 */
export function registerRunTimer(
  fastify: FastifyInstance,
  runId: string,
  orgId: string,
  timeoutSeconds: number,
): void {
  // Clear any existing timer for this runId before registering a new one (re-register case)
  const existing = runTimers.get(runId);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const cappedSeconds = Math.min(timeoutSeconds, MAX_TIMEOUT_SECONDS);
  const timer = setTimeout(async () => {
    runTimers.delete(runId);
    await handleRunTimeout(fastify, runId, orgId);
  }, cappedSeconds * 1000);
  timer.unref(); // Never prevent process exit
  runTimers.set(runId, { timer, orgId });
}

/**
 * Cancel the server-side timeout for a run.
 * Called BEFORE any DB write in handleResultFrame (RESEARCH Pitfall 1 discipline).
 * Also called by POST /cancel (Plan 10-04) and clearAllRunTimers.
 * Safe to call when no timer is registered (no-op).
 *
 * @param runId - run ID whose timer should be cleared
 */
export function cancelRunTimer(runId: string): void {
  const entry = runTimers.get(runId);
  if (entry) {
    clearTimeout(entry.timer);
    runTimers.delete(runId);
  }
}

/**
 * Clear all run timers — called from app.ts onClose hook to prevent timer leaks.
 * Also useful in test teardown (Pitfall 8).
 */
export function clearAllRunTimers(): void {
  for (const entry of runTimers.values()) {
    clearTimeout(entry.timer);
  }
  runTimers.clear();
}

/**
 * Handle timeout for a run: CAS transition (dispatched|running) → timed_out,
 * send cancel frame to agent if still connected.
 *
 * WHY private: only called by the timer callback. Tests verify it indirectly
 * through registerRunTimer with short timeoutSeconds.
 *
 * T-10-03-05: only logs {runId, orgId} — never logs task_snapshot or params.
 */
async function handleRunTimeout(
  fastify: FastifyInstance,
  runId: string,
  orgId: string,
): Promise<void> {
  const repos = makeRepos(fastify.db, fastify.mek);

  const updated = await repos
    .forOrg(orgId)
    .taskRuns.updateStateMulti(runId, ['dispatched', 'running'], 'timed_out', {
      finishedAt: sql`now()` as unknown as Date,
      exitCode: -1,
    });

  if (!updated) {
    // CAS miss — run already in terminal state; nothing to do
    return;
  }

  // Send cancel frame to agent if still connected
  if (updated.agentId) {
    const ws = fastify.agentRegistry.get(updated.agentId);
    // ws.OPEN = 1 per the WebSocket spec
    if (ws && (ws as unknown as { readyState: number }).readyState === 1) {
      (ws as unknown as { send: (data: string) => void }).send(
        JSON.stringify({ type: 'cancel', run_id: runId, reason: 'timeout' }),
      );
    }
  }

  fastify.log.warn({ runId, orgId }, 'run timed out');
}
