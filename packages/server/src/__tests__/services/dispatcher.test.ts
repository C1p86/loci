// Unit tests for DispatchQueue class (Plan 10-03 Task 2).
// Tests 1-2, 6 cover DispatchQueue in-memory logic with no Fastify/DB.
// Integration tests (3-5, 7-10) are in dispatcher.integration.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '../../services/dispatcher.js';
import { DispatchQueue, tickDispatcher } from '../../services/dispatcher.js';

// Mock agent-selector so we can control when selectEligibleAgent resolves.
vi.mock('../../services/agent-selector.js', () => ({
  selectEligibleAgent: vi.fn(),
}));

function makeEntry(runId: string, orgId = 'org-a'): QueueEntry {
  return {
    runId,
    orgId,
    taskSnapshot: {
      task_id: 'task-1',
      name: 'Test',
      description: '',
      yaml_definition: 'steps:\n  - run: echo hi',
      label_requirements: [],
    },
    params: {},
    labelRequirements: [],
    timeoutSeconds: 3600,
  };
}

describe('DispatchQueue — in-memory FIFO', () => {
  let queue: DispatchQueue;

  beforeEach(() => {
    queue = new DispatchQueue();
  });

  afterEach(() => {
    queue.stop();
  });

  it('Test 1: enqueue/dequeue FIFO — dequeue middle, remaining order preserved', () => {
    queue.enqueue(makeEntry('run-1'));
    queue.enqueue(makeEntry('run-2'));
    queue.enqueue(makeEntry('run-3'));

    queue.dequeue('run-2');

    const entries = queue.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0]!.runId).toBe('run-1');
    expect(entries[1]!.runId).toBe('run-3');
  });

  it('Test 2: countByOrg filters correctly across multiple orgs', () => {
    queue.enqueue(makeEntry('run-a1', 'org-a'));
    queue.enqueue(makeEntry('run-a2', 'org-a'));
    queue.enqueue(makeEntry('run-b1', 'org-b'));

    expect(queue.countByOrg('org-a')).toBe(2);
    expect(queue.countByOrg('org-b')).toBe(1);
    expect(queue.countByOrg('org-c')).toBe(0);
  });

  it('Test 6: reentrancy guard — second tickDispatcher call while first is in-flight returns immediately', async () => {
    // Use the vi.mock at the top of this file to control selectEligibleAgent.
    // Import the mocked module to set up the hanging implementation.
    const { selectEligibleAgent } = await import('../../services/agent-selector.js');
    const mockSelector = vi.mocked(selectEligibleAgent);

    const resolvers: Array<() => void> = [];
    let selectorCallCount = 0;

    // Make selectEligibleAgent hang until manually released
    mockSelector.mockImplementation((): Promise<string | null> => {
      selectorCallCount++;
      return new Promise<string | null>((res) => {
        resolvers.push(() => res(null));
      });
    });

    const localQueue = new DispatchQueue();
    localQueue.enqueue(makeEntry('run-guard', 'org-guard'));

    const mockFastify = {
      dispatchQueue: localQueue,
      db: {} as never,
      mek: Buffer.alloc(32),
      agentRegistry: new Map(),
      log: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    } as never;

    // Fire first tick — it will block inside selectEligibleAgent
    const tick1 = tickDispatcher(mockFastify);

    // Give tick1 a moment to enter the async chain
    await new Promise((r) => setTimeout(r, 20));

    // Fire second tick while first is still in-flight — should return immediately (reentrancy guard)
    const tick2Start = Date.now();
    await tickDispatcher(mockFastify);
    const tick2Duration = Date.now() - tick2Start;

    // tick2 should have completed near-instantly (< 50ms) because it was dropped by the guard
    expect(tick2Duration).toBeLessThan(50);

    // selectorCallCount should be 1 (only first tick ran the selector; second was dropped)
    expect(selectorCallCount).toBe(1);

    // Release first tick to allow clean teardown
    resolvers[0]?.();
    await tick1;

    mockSelector.mockReset();
  });

  it('getEntries returns immutable snapshot (modification does not affect queue)', () => {
    queue.enqueue(makeEntry('run-snap'));
    const snapshot = queue.getEntries();

    // Modifying the snapshot array does NOT affect the internal queue
    (snapshot as QueueEntry[]).pop();
    expect(queue.getEntries()).toHaveLength(1);
  });

  it('cursor: getLastCursor / setLastCursor per org', () => {
    expect(queue.getLastCursor('org-x')).toBeNull();
    queue.setLastCursor('org-x', 'agent-1');
    expect(queue.getLastCursor('org-x')).toBe('agent-1');
    queue.setLastCursor('org-x', 'agent-2');
    expect(queue.getLastCursor('org-x')).toBe('agent-2');
    // Different org has independent cursor
    expect(queue.getLastCursor('org-y')).toBeNull();
  });

  it('stop is idempotent (no throw on double stop)', () => {
    queue.start(async () => {}, 1000);
    queue.stop();
    expect(() => queue.stop()).not.toThrow();
  });

  it('start is idempotent (second start is ignored)', () => {
    let count = 0;
    const tick = async (): Promise<void> => {
      count++;
    };
    queue.start(tick, 50);
    queue.start(tick, 50); // should not start a second interval
    // Wait just enough for one tick
    return new Promise((r) =>
      setTimeout(() => {
        queue.stop();
        // count should be small (not doubled from two intervals)
        expect(count).toBeLessThanOrEqual(3);
        r(undefined);
      }, 120),
    );
  });
});
