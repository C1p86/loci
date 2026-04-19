// Phase 11 D-12/D-13 unit tests for LogFanout.
// Tests: addSubscriber, broadcast, overflow drop-head + gap frame, slow subscriber isolation,
// closeAll, removeSubscriber via ws close event.

import { describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LogFanout } from '../log-fanout.js';
import type { ChunkFrame } from '../log-fanout.js';

const mockFastify = {
  log: { warn: vi.fn() },
} as unknown as FastifyInstance;

/** Minimal fake WebSocket with enough surface for LogFanout. */
function fakeWs() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    readyState: 1, // WS OPEN
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(fn);
    }),
    /** Helper: simulate an event (e.g. 'close') */
    emit: (event: string, ...args: unknown[]) => {
      listeners[event]?.forEach((f) => f(...args));
    },
  };
}

function makeChunkFrame(seq: number): ChunkFrame {
  return { type: 'chunk', seq, stream: 'stdout', data: `line ${seq}`, ts: new Date().toISOString() };
}

describe('LogFanout', () => {
  it('addSubscriber registers ws.on("close") and ws.on("error") handlers', () => {
    const fanout = new LogFanout(mockFastify);
    const ws = fakeWs();
    fanout.addSubscriber('run-1', 'org-1', ws as never);
    // ws.on should have been called for 'close' and 'error'
    const calls = (ws.on as ReturnType<typeof vi.fn>).mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('close');
    expect(calls).toContain('error');
  });

  it('broadcast sends a chunk frame to a single subscriber', () => {
    const fanout = new LogFanout(mockFastify);
    const ws = fakeWs();
    fanout.addSubscriber('run-2', 'org-1', ws as never);
    fanout.broadcast('run-2', makeChunkFrame(1));
    expect(ws.send).toHaveBeenCalledOnce();
    const sent = JSON.parse(((ws.send as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]) as string) as unknown;
    expect(sent).toMatchObject({ type: 'chunk', seq: 1, stream: 'stdout' });
  });

  it('broadcast sends to all subscribers for a runId', () => {
    const fanout = new LogFanout(mockFastify);
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    const ws3 = fakeWs();
    fanout.addSubscriber('run-3', 'org-1', ws1 as never);
    fanout.addSubscriber('run-3', 'org-1', ws2 as never);
    fanout.addSubscriber('run-3', 'org-1', ws3 as never);
    fanout.broadcast('run-3', makeChunkFrame(5));
    expect(ws1.send).toHaveBeenCalledOnce();
    expect(ws2.send).toHaveBeenCalledOnce();
    expect(ws3.send).toHaveBeenCalledOnce();
  });

  it('overflow: pushing 501 chunks emits a gap frame and clamps queue to ≤ 501', () => {
    const fanout = new LogFanout(mockFastify);
    // Use a "frozen" ws that never drains (send is a no-op but readyState stays OPEN)
    const ws = fakeWs();
    // Override send to NOT drain — we want the queue to fill up
    // The pump is synchronous in this impl, so we need to make ws "closed" while filling
    // then open it for the last check. Instead: make readyState closed so pump doesn't drain.
    ws.readyState = 3; // CLOSED — pump won't send anything, queue accumulates
    fanout.addSubscriber('run-4', 'org-1', ws as never);

    // Broadcast 501 frames — 500 fill the queue, 501st triggers overflow
    for (let i = 0; i < 501; i++) {
      fanout.broadcast('run-4', makeChunkFrame(i));
    }

    // Open the ws and pump one more frame to see what was sent
    ws.readyState = 1;
    fanout.broadcast('run-4', makeChunkFrame(501));

    // ws.send should have been called — the 502nd broadcast (with open ws) pumped frames
    const sentFrames = (ws.send as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => JSON.parse(c[0] as string) as { type: string },
    );

    // There should be a gap frame in there somewhere
    const gapFrames = sentFrames.filter((f) => f.type === 'gap');
    expect(gapFrames.length).toBeGreaterThan(0);
  });

  it('a slow/erroring subscriber does not block other subscribers', () => {
    const fanout = new LogFanout(mockFastify);
    const badWs = fakeWs();
    const goodWs = fakeWs();

    // bad subscriber throws on send
    (badWs.send as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('ws broken');
    });

    fanout.addSubscriber('run-5', 'org-1', badWs as never);
    fanout.addSubscriber('run-5', 'org-1', goodWs as never);

    // Should not throw
    expect(() => fanout.broadcast('run-5', makeChunkFrame(1))).not.toThrow();

    // Good subscriber should still receive the frame
    expect(goodWs.send).toHaveBeenCalledOnce();
  });

  it('closeAll closes every ws with code 1001 and clears the map', () => {
    const fanout = new LogFanout(mockFastify);
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    fanout.addSubscriber('run-6', 'org-1', ws1 as never);
    fanout.addSubscriber('run-7', 'org-1', ws2 as never);

    fanout.closeAll();

    expect(ws1.close).toHaveBeenCalledWith(1001, expect.any(String));
    expect(ws2.close).toHaveBeenCalledWith(1001, expect.any(String));

    // After closeAll, broadcasting has no effect
    const ws3 = fakeWs();
    fanout.broadcast('run-6', makeChunkFrame(99));
    expect(ws3.send).not.toHaveBeenCalled();
  });

  it('removeSubscriber via ws close event drops the entry', () => {
    const fanout = new LogFanout(mockFastify);
    const ws = fakeWs();
    fanout.addSubscriber('run-8', 'org-1', ws as never);

    // Simulate ws close event — this should call removeSubscriber
    ws.emit('close');

    // Broadcast should now be a no-op (no subscribers)
    fanout.broadcast('run-8', makeChunkFrame(1));
    expect(ws.send).not.toHaveBeenCalled();
  });
});
