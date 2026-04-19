// packages/server/src/services/dispatcher.ts
//
// DISP-01 / Plan 10-03 Task 2: In-memory dispatch queue + 250ms tick + Fastify plugin.
//
// Architecture:
//   - DispatchQueue: in-memory FIFO with round-robin cursor per org.
//   - tickDispatcher: iterates queue snapshot, finds eligible agents via selectEligibleAgent,
//     CAS-transitions queued→dispatched, sends dispatch frame, registers run timer.
//   - dispatcherPlugin: Fastify plugin that wires onReady (reconciliation + start) and
//     onClose (stop + clearAllRunTimers).
//
// Threat register:
//   T-10-03-01: reentrancy guard (ticking flag) prevents concurrent tick double-dispatch.
//   T-10-03-07: dispatcherPlugin uses fastify-plugin with dependencies so registration
//               order errors surface at boot, not at first request.

import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { makeRepos } from '../repos/index.js';
import type { TaskSnapshot } from '../ws/types.js';
import { selectEligibleAgent } from './agent-selector.js';
import { clearAllRunTimers, registerRunTimer } from './timeout-manager.js';

// ---- Types ----------------------------------------------------------------

export interface QueueEntry {
  runId: string;
  orgId: string;
  taskSnapshot: TaskSnapshot;
  /** Fully-resolved params (runOverrides merged with orgSecrets at trigger time) */
  params: Record<string, string>;
  /** ["os=linux", "arch=x64"] label requirement strings */
  labelRequirements: string[];
  timeoutSeconds: number;
}

// ---- DispatchQueue class ---------------------------------------------------

/**
 * In-memory FIFO dispatch queue (DISP-01 / D-04).
 *
 * WHY a class: encapsulates all mutable state (queue array, cursor map, timer handle)
 * so the Fastify plugin can own one instance decorated as fastify.dispatchQueue.
 *
 * WHY getEntries() returns an immutable snapshot: tickDispatcher iterates while
 * calling dequeue() inside the loop — iterating a live array mid-mutation is a
 * FIFO-corruption bug. Snapshot prevents this.
 */
export class DispatchQueue {
  private queue: QueueEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Per-org round-robin cursor: orgId → last dispatched agentId */
  private lastDispatchedAgentCursor = new Map<string, string>();

  enqueue(entry: QueueEntry): void {
    this.queue.push(entry);
  }

  dequeue(runId: string): void {
    this.queue = this.queue.filter((e) => e.runId !== runId);
  }

  /** Returns an immutable snapshot of the current queue. */
  getEntries(): readonly QueueEntry[] {
    return [...this.queue];
  }

  countByOrg(orgId: string): number {
    return this.queue.filter((e) => e.orgId === orgId).length;
  }

  getLastCursor(orgId: string): string | null {
    return this.lastDispatchedAgentCursor.get(orgId) ?? null;
  }

  setLastCursor(orgId: string, agentId: string): void {
    this.lastDispatchedAgentCursor.set(orgId, agentId);
  }

  /**
   * Start the dispatch tick interval.
   * No-op if already started (idempotent).
   *
   * @param tickFn - async function invoked on each tick
   * @param intervalMs - tick interval (default 250ms)
   */
  start(tickFn: () => Promise<void>, intervalMs = 250): void {
    if (this.timer) return; // already running
    this.timer = setInterval(() => {
      void tickFn();
    }, intervalMs);
    this.timer.unref(); // Never prevent process exit
  }

  /**
   * Stop the dispatch tick interval.
   * Idempotent — safe to call when already stopped.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// ---- Reentrancy guard (module-scoped, single instance) --------------------

let ticking = false;

/**
 * Single tick of the dispatch loop.
 *
 * For each queued entry:
 *   1. Find eligible agent via selectEligibleAgent.
 *   2. If none → skip (entry stays for next tick).
 *   3. CAS transition: queued→dispatched (UPDATE WHERE state='queued').
 *   4. If CAS missed (race loser) → dequeue and continue.
 *   5. Send dispatch frame to agent WS.
 *   6. Register per-run timeout timer.
 *
 * T-10-03-01: reentrancy guard ensures a slow tick does not overlap with the next.
 */
export async function tickDispatcher(fastify: FastifyInstance): Promise<void> {
  if (ticking) return; // Pitfall 2 — concurrent tick guard
  ticking = true;
  try {
    const queue = fastify.dispatchQueue;
    const snapshot = queue.getEntries(); // immutable snapshot for safe iteration

    for (const entry of snapshot) {
      const agentId = await selectEligibleAgent(
        fastify.db,
        entry.orgId,
        entry.labelRequirements,
        queue.getLastCursor(entry.orgId),
      );

      if (!agentId) continue; // no eligible agent → leave in queue for next tick

      // CAS queued → dispatched (atomic guard against parallel dispatch)
      const repos = makeRepos(fastify.db, fastify.mek);
      const updated = await repos
        .forOrg(entry.orgId)
        .taskRuns.updateState(entry.runId, 'queued', 'dispatched', {
          agentId,
          dispatchedAt: sql`now()` as unknown as Date,
        });

      if (!updated) {
        // CAS miss — someone else already transitioned this run (or run no longer exists).
        // Drop from in-memory queue. The DB is the authority; if the run is truly queued
        // somewhere else, boot reconciliation (DISP-08) will re-enqueue it on next restart.
        queue.dequeue(entry.runId);
        continue;
      }

      queue.dequeue(entry.runId);
      queue.setLastCursor(entry.orgId, agentId);

      // Send dispatch frame to the agent if WS is still open
      const ws = fastify.agentRegistry.get(agentId);
      if (ws && (ws as unknown as { readyState: number }).readyState === 1) {
        (ws as unknown as { send: (data: string) => void }).send(
          JSON.stringify({
            type: 'dispatch',
            run_id: entry.runId,
            task_snapshot: entry.taskSnapshot,
            params: entry.params,
            timeout_seconds: entry.timeoutSeconds,
          }),
        );
      }

      // Register timeout timer — fires handleRunTimeout on expiry
      registerRunTimer(fastify, entry.runId, entry.orgId, entry.timeoutSeconds);
    }
  } catch (err) {
    fastify.log.error({ err }, 'tickDispatcher error');
  } finally {
    ticking = false;
  }
}

// ---- Fastify plugin --------------------------------------------------------

/**
 * dispatcherPlugin: decorates fastify.dispatchQueue, hooks onReady and onClose.
 *
 * Must be registered AFTER @fastify/websocket (for agentRegistry) and db plugin.
 * T-10-03-07: fastify-plugin dependencies declaration surfaces ordering errors at boot.
 *
 * onReady:
 *   1. runBootReconciliation — re-enqueues queued runs, orphans stale running ones.
 *   2. queue.start — begins 250ms tick loop.
 *
 * onClose:
 *   1. queue.stop — clears setInterval.
 *   2. clearAllRunTimers — clears all per-run setTimeout handles (Pitfall 8 / T-10-03-03).
 */
const dispatcherPluginImpl: FastifyPluginAsync = async (fastify) => {
  const queue = new DispatchQueue();
  fastify.decorate('dispatchQueue', queue);

  fastify.addHook('onReady', async () => {
    // Import reconciler lazily to avoid circular-dependency issues at module load time
    const { runBootReconciliation } = await import('./reconciler.js');
    await runBootReconciliation(fastify);
    queue.start(() => tickDispatcher(fastify), 250);
  });

  fastify.addHook('onClose', async () => {
    queue.stop();
    clearAllRunTimers();
  });
};

export const dispatcherPlugin = fp(dispatcherPluginImpl, {
  fastify: '5',
  name: 'dispatcher',
  dependencies: ['db', 'websocket'],
});

// ---- Fastify type augmentation -------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    dispatchQueue: DispatchQueue;
  }
}
