// packages/server/src/services/timeout-manager.ts
//
// Plan 10-02 STUB — Plan 10-03 replaces this with the full timer manager implementation.
// Purpose: allow handler.ts to import cancelRunTimer cleanly in Plan 10-02 without
// pulling Plan 10-03's full logic into this plan's scope.
//
// Plan 10-03 will implement:
//   - Map<runId, NodeJS.Timeout> backed by fastify.runTimers decoration
//   - Real registerRunTimer: creates .unref() setTimeout, stores in map
//   - Real cancelRunTimer: clearTimeout + map.delete
//   - Real clearAllRunTimers: clear all on app.close hook (prevents leak / Pitfall 8)
//   - handleRunTimeout: CAS running/dispatched → timed_out + send cancel frame to agent

import type { FastifyInstance } from 'fastify';

/**
 * Register a server-side timeout for a dispatched run.
 * Plan 10-02 STUB — Plan 10-03 implements with real setTimeout + .unref().
 * @param _fastify - Fastify instance (used by real impl for agentRegistry + db)
 * @param _runId - run ID to time out
 * @param _timeoutSeconds - seconds until timeout fires
 */
export function registerRunTimer(
  _fastify: FastifyInstance,
  _runId: string,
  _timeoutSeconds: number,
): void {
  // no-op in Plan 10-02; Plan 10-03 implements
}

/**
 * Cancel the server-side timeout for a run.
 * Called BEFORE any DB write in handleResultFrame (RESEARCH Pitfall 1 discipline).
 * Plan 10-02 STUB — Plan 10-03 implements with clearTimeout + map cleanup.
 * @param _runId - run ID whose timer should be cleared
 */
export function cancelRunTimer(_runId: string): void {
  // no-op in Plan 10-02; Plan 10-03 implements
}

/**
 * Clear all run timers — called from app.close hook to prevent timer leaks.
 * Also useful in test teardown (Pitfall 8).
 * Plan 10-02 STUB — Plan 10-03 implements with Map iteration + clearTimeout.
 */
export function clearAllRunTimers(): void {
  // no-op in Plan 10-02; Plan 10-03 implements
}
