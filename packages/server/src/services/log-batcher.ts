// Phase 11 D-09/D-10/D-11: batching layer between WS log_chunk handler and DB.
// D-10: flush on 50 chunks OR 200ms timer, whichever first.
// D-11: if totalPending > 1000, drop oldest chunks (across runs) + log pino warn.
// NEVER block the WS handler — enqueue() is synchronous fire-and-forget.

import type { FastifyInstance } from 'fastify';
import { generateId } from '../crypto/tokens.js';
import type { NewLogChunk } from '../db/schema.js';
import { makeRepos } from '../repos/index.js';

export interface LogBatcherOpts {
  /** Max chunks per run before a size-triggered flush. Default 50 (D-10). */
  maxChunksPerRun?: number;
  /** Max ms before timer-triggered flush. Default 200 (D-10). */
  flushIntervalMs?: number;
  /** Max total pending chunks across all runs before overflow drop. Default 1000 (D-11). */
  maxPendingTotal?: number;
}

interface RunBuffer {
  orgId: string;
  chunks: NewLogChunk[];
  timer: ReturnType<typeof setTimeout> | null;
}

export class LogBatcher {
  private readonly fastify: FastifyInstance;
  private readonly maxChunksPerRun: number;
  private readonly flushIntervalMs: number;
  private readonly maxPendingTotal: number;
  private readonly runs = new Map<string, RunBuffer>();
  private totalPending = 0;
  private stopped = false;

  constructor(fastify: FastifyInstance, opts: LogBatcherOpts = {}) {
    this.fastify = fastify;
    this.maxChunksPerRun = opts.maxChunksPerRun ?? 50;
    this.flushIntervalMs = opts.flushIntervalMs ?? 200;
    this.maxPendingTotal = opts.maxPendingTotal ?? 1000;
  }

  /**
   * Enqueue a log chunk for batched insertion.
   * Synchronous — never awaited. The WS handler calls this in a hot path.
   * partial: all NewLogChunk fields except id and persistedAt (generated here).
   */
  enqueue(
    runId: string,
    orgId: string,
    partial: Omit<NewLogChunk, 'id' | 'persistedAt'>,
  ): void {
    if (this.stopped) return;

    const chunk: NewLogChunk = { id: generateId('lch'), ...partial };

    let buf = this.runs.get(runId);
    if (!buf) {
      buf = { orgId, chunks: [], timer: null };
      this.runs.set(runId, buf);
    }
    buf.chunks.push(chunk);
    this.totalPending++;

    // Size-triggered flush (D-10)
    if (buf.chunks.length >= this.maxChunksPerRun) {
      void this.flushRun(runId);
    } else if (buf.timer === null) {
      // First chunk in this batch — schedule the 200ms timer.
      // Pitfall: do NOT reset the timer on subsequent enqueues; the original
      // 200ms budget is the guarantee (prevents timer-reset starvation).
      buf.timer = setTimeout(() => {
        void this.flushRun(runId);
      }, this.flushIntervalMs);
      // .unref() prevents the timer from holding the event loop open on shutdown
      buf.timer.unref();
    }

    // D-11 overflow guard — drop oldest if total exceeds limit
    if (this.totalPending > this.maxPendingTotal) {
      this.dropOldest();
    }
  }

  /**
   * Drop the oldest chunks (from the first run in insertion order) until
   * totalPending is back within maxPendingTotal. Logs a pino warn once per call.
   */
  private dropOldest(): void {
    this.fastify.log.warn(
      { totalPending: this.totalPending, maxPendingTotal: this.maxPendingTotal },
      'log batcher overflow — dropping oldest',
    );
    for (const [, buf] of this.runs) {
      while (this.totalPending > this.maxPendingTotal && buf.chunks.length > 0) {
        buf.chunks.shift();
        this.totalPending--;
      }
      if (this.totalPending <= this.maxPendingTotal) return;
    }
  }

  /**
   * Flush a single run's buffer to DB.
   * Clears the timer and buffer atomically before the async insert so that
   * new chunks arriving during the await start a fresh batch.
   * Errors are swallowed at warn level — never propagated (LOG-07).
   */
  async flushRun(runId: string): Promise<void> {
    const buf = this.runs.get(runId);
    if (!buf || buf.chunks.length === 0) {
      // Nothing to flush; clear any dangling timer
      if (buf?.timer) {
        clearTimeout(buf.timer);
        buf.timer = null;
      }
      return;
    }

    // Snapshot and clear atomically
    const toFlush = buf.chunks.splice(0, buf.chunks.length);
    const orgId = buf.orgId;
    if (buf.timer) {
      clearTimeout(buf.timer);
      buf.timer = null;
    }
    this.totalPending -= toFlush.length;
    // Drop the map entry if the buffer is now empty (will be re-created on next enqueue)
    if (buf.chunks.length === 0) {
      this.runs.delete(runId);
    }

    try {
      const repos = makeRepos(this.fastify.db, this.fastify.mek);
      await repos.forOrg(orgId).logChunks.insertBatch(toFlush);
    } catch (err) {
      // LOG-07: persistence errors MUST NOT propagate to the WS handler
      this.fastify.log.warn(
        { err, runId, count: toFlush.length },
        'log batcher flush failed — chunks dropped',
      );
    }
  }

  /**
   * Flush all active run buffers. Used by app.addHook('onClose', …) and tests.
   */
  async flushAll(): Promise<void> {
    const runIds = [...this.runs.keys()];
    await Promise.all(runIds.map((id) => this.flushRun(id)));
  }

  /**
   * Stop the batcher: clear all pending timers, discard buffers.
   * Does NOT flush — call flushAll() first if you need to drain.
   * Idempotent.
   */
  stop(): void {
    this.stopped = true;
    for (const [, buf] of this.runs) {
      if (buf.timer) {
        clearTimeout(buf.timer);
        buf.timer = null;
      }
    }
    this.runs.clear();
    this.totalPending = 0;
  }
}
