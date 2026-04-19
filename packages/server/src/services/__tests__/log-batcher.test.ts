// Phase 11 D-09/D-10/D-11 unit tests for LogBatcher.
// Tests: 50-chunk flush, 200ms timer flush, overflow drop-head, flushAll, stop.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LogBatcher } from '../log-batcher.js';

// Capture insertBatch calls for assertions
const insertBatchCalls: Array<{ orgId: string; rows: unknown[] }> = [];

vi.mock('../../repos/index.js', () => ({
  makeRepos: (_db: unknown, _mek: unknown) => ({
    forOrg: (orgId: string) => ({
      logChunks: {
        insertBatch: async (rows: unknown[]) => {
          insertBatchCalls.push({ orgId, rows });
          return rows.length;
        },
      },
    }),
  }),
}));

const warnCalls: unknown[][] = [];
const mockFastify = {
  db: {} as never,
  mek: Buffer.alloc(32) as never,
  log: {
    warn: (...args: unknown[]) => {
      warnCalls.push(args);
    },
  },
} as unknown as FastifyInstance;

function makeChunk(runId: string, seq: number) {
  return {
    runId,
    seq,
    stream: 'stdout' as const,
    data: `line ${seq}`,
    ts: new Date(),
  };
}

beforeEach(() => {
  insertBatchCalls.length = 0;
  warnCalls.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LogBatcher', () => {
  it('flushes immediately when buffer reaches maxChunksPerRun (default 50)', async () => {
    const batcher = new LogBatcher(mockFastify);
    for (let i = 0; i < 50; i++) {
      batcher.enqueue('run-A', 'org-1', makeChunk('run-A', i));
    }
    // flush is async fire-and-forget — drain microtask queue
    await Promise.resolve();
    await Promise.resolve();
    expect(insertBatchCalls.length).toBe(1);
    expect(insertBatchCalls[0]!.rows.length).toBe(50);
    expect(insertBatchCalls[0]!.orgId).toBe('org-1');
    batcher.stop();
  });

  it('flushes on the 200ms timer when fewer than 50 chunks pushed', async () => {
    const batcher = new LogBatcher(mockFastify);
    batcher.enqueue('run-B', 'org-1', makeChunk('run-B', 1));
    batcher.enqueue('run-B', 'org-1', makeChunk('run-B', 2));
    batcher.enqueue('run-B', 'org-1', makeChunk('run-B', 3));

    // No flush yet
    expect(insertBatchCalls.length).toBe(0);

    // Advance timer past 200ms
    vi.advanceTimersByTime(201);
    await Promise.resolve();
    await Promise.resolve();

    expect(insertBatchCalls.length).toBe(1);
    expect(insertBatchCalls[0]!.rows.length).toBe(3);
    batcher.stop();
  });

  it('does not reset the 200ms timer when additional chunks arrive in the same batch', async () => {
    const batcher = new LogBatcher(mockFastify, { flushIntervalMs: 200 });
    // Push chunk at t=0 (timer starts)
    batcher.enqueue('run-C', 'org-1', makeChunk('run-C', 1));
    // Push another chunk at t=100 (should NOT reset the timer)
    vi.advanceTimersByTime(100);
    batcher.enqueue('run-C', 'org-1', makeChunk('run-C', 2));
    // At t=200 the original timer should fire
    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    // Flush should have happened at t=200, not t=300
    expect(insertBatchCalls.length).toBe(1);
    expect(insertBatchCalls[0]!.rows.length).toBe(2);
    batcher.stop();
  });

  it('drops oldest chunks and logs warn when totalPending exceeds maxPendingTotal', async () => {
    const batcher = new LogBatcher(mockFastify, {
      maxChunksPerRun: 2000, // high threshold so size-trigger doesn't fire
      flushIntervalMs: 60_000, // long timer so timer doesn't fire
      maxPendingTotal: 1000,
    });
    // Push 1001 chunks — should trigger overflow guard after 1001st enqueue
    for (let i = 0; i < 1001; i++) {
      batcher.enqueue('run-D', 'org-1', makeChunk('run-D', i));
    }
    // totalPending should be clamped to ≤ 1000
    // We can't access private fields directly, so verify via flushAll
    await batcher.flushAll();
    const totalFlushed = insertBatchCalls.reduce((sum, c) => sum + c.rows.length, 0);
    expect(totalFlushed).toBeLessThanOrEqual(1000);
    // Warn should have been logged
    expect(warnCalls.length).toBeGreaterThan(0);
    const warnMsg = JSON.stringify(warnCalls[0]);
    expect(warnMsg).toContain('dropping oldest');
    batcher.stop();
  });

  it('flushAll drains every active run', async () => {
    const batcher = new LogBatcher(mockFastify, {
      flushIntervalMs: 60_000, // prevent auto-flush
    });
    batcher.enqueue('run-E', 'org-1', makeChunk('run-E', 1));
    batcher.enqueue('run-F', 'org-2', makeChunk('run-F', 1));
    batcher.enqueue('run-F', 'org-2', makeChunk('run-F', 2));

    await batcher.flushAll();

    expect(insertBatchCalls.length).toBe(2);
    const orgIds = insertBatchCalls.map((c) => c.orgId).sort();
    expect(orgIds).toEqual(['org-1', 'org-2']);
    batcher.stop();
  });

  it('stop clears pending timers so no flush fires after stop', async () => {
    const batcher = new LogBatcher(mockFastify);
    batcher.enqueue('run-G', 'org-1', makeChunk('run-G', 1));
    batcher.stop();
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
    expect(insertBatchCalls.length).toBe(0);
  });
});
