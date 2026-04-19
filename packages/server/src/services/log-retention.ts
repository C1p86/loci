// packages/server/src/services/log-retention.ts
//
// Phase 11 D-17/D-18/D-19/D-20: log chunk retention cleanup service.
//
// runRetentionCleanup(fastify):
//   Calls adminRepo.runRetentionCleanup(opts) and logs per-org deletion counts at info level.
//   Best-effort: errors are caught and logged; never propagated (so setInterval keeps firing).
//   T-11-03-06: log shape never includes chunk data or secrets.
//
// startLogRetentionJob(fastify):
//   D-20: runs one immediate cleanup on boot (catches long downtime backlogs).
//   D-17: starts setInterval(runRetentionCleanup, LOG_RETENTION_INTERVAL_MS).unref().
//   Stores interval handle on fastify.logRetentionTimer for onClose cleanup.

import type { FastifyInstance } from 'fastify';
import { LogRetentionJobError } from '../errors.js';
import { makeRepos } from '../repos/index.js';

/**
 * Execute one retention cleanup pass.
 * Best-effort: all errors are swallowed (logged at error level).
 * D-19: batched 10k rows / 100 iterations prevents long locks.
 * T-11-03-06: log shape: {rowsDeleted, iterations, orgs, perOrg} — no chunk data.
 */
export async function runRetentionCleanup(fastify: FastifyInstance): Promise<void> {
  try {
    const repos = makeRepos(fastify.db, fastify.mek);
    const result = await repos.admin.runRetentionCleanup({
      batchSize: 10_000,
      maxIterations: 100,
    });
    fastify.log.info(
      {
        rowsDeleted: result.rowsDeleted,
        iterations: result.iterations,
        orgs: Object.keys(result.perOrg).length,
        perOrg: result.perOrg,
      },
      'log retention cleanup complete',
    );
  } catch (err) {
    if (err instanceof LogRetentionJobError) {
      fastify.log.error({ err }, 'log retention cleanup failed — will retry on next interval');
    } else {
      fastify.log.error({ err }, 'log retention cleanup unexpected error');
    }
    // D-17: best-effort — do NOT propagate so the setInterval keeps firing on next tick.
  }
}

/**
 * Start the retention cleanup job.
 * D-20: fires one immediate pass on call (typically from onReady hook).
 * D-17: starts setInterval that fires every LOG_RETENTION_INTERVAL_MS (default 24h).
 * .unref() so the interval does not prevent graceful shutdown.
 */
export function startLogRetentionJob(fastify: FastifyInstance): void {
  // D-20: immediate boot pass
  void runRetentionCleanup(fastify);

  const intervalMs = fastify.config.LOG_RETENTION_INTERVAL_MS;
  const handle = setInterval(() => {
    void runRetentionCleanup(fastify);
  }, intervalMs);
  handle.unref(); // D-17: do not hold the event loop open on shutdown

  fastify.logRetentionTimer = handle;
}
