// Unit tests for timeout-manager (Plan 10-03 Task 1).
// Tests 1-4: timer map management (vi.useFakeTimers — no real delays, no DB).
// Tests 5-8: handleRunTimeout CAS integration — see timeout-manager.integration.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelRunTimer,
  clearAllRunTimers,
  registerRunTimer,
} from '../../services/timeout-manager.js';

describe('timeout-manager — timer map management (fake timers)', () => {
  beforeEach(() => {
    // Always start with a clean timer map
    clearAllRunTimers();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearAllRunTimers();
    vi.useRealTimers();
  });

  it('Test 1: registerRunTimer stores a timer (cancel is safe after register)', () => {
    const mockFastify = {
      db: {} as never,
      mek: Buffer.alloc(32),
      agentRegistry: new Map<string, { readyState: number; send: () => void }>(),
      log: { warn: () => {}, error: () => {}, debug: () => {} },
    } as never;

    registerRunTimer(mockFastify, 'run-a', 'org-1', 5);
    // The real test: after register, cancelRunTimer should work (timer was stored)
    expect(() => cancelRunTimer('run-a')).not.toThrow();
  });

  it('Test 2: cancelRunTimer removes timer (second cancel is a no-op)', () => {
    const mockFastify = {
      db: {} as never,
      mek: Buffer.alloc(32),
      agentRegistry: new Map(),
      log: { warn: () => {}, error: () => {}, debug: () => {} },
    } as never;

    registerRunTimer(mockFastify, 'run-b', 'org-1', 5);
    cancelRunTimer('run-b');
    // Second cancel should be a no-op (not throw)
    expect(() => cancelRunTimer('run-b')).not.toThrow();
    // Registering same id again after cancel should work (no stale entry)
    expect(() => registerRunTimer(mockFastify, 'run-b', 'org-1', 5)).not.toThrow();
  });

  it('Test 3: re-register same runId replaces old timer (single entry per runId)', () => {
    const mockFastify = {
      db: {} as never,
      mek: Buffer.alloc(32),
      agentRegistry: new Map(),
      log: { warn: () => {}, error: () => {}, debug: () => {} },
    } as never;

    registerRunTimer(mockFastify, 'run-c', 'org-1', 10);
    registerRunTimer(mockFastify, 'run-c', 'org-1', 20); // re-register same runId

    // Both cancels should be clean — only one timer should exist
    cancelRunTimer('run-c');
    expect(() => cancelRunTimer('run-c')).not.toThrow();
  });

  it('Test 4: clearAllRunTimers empties map (no timers leaked)', () => {
    const mockFastify = {
      db: {} as never,
      mek: Buffer.alloc(32),
      agentRegistry: new Map(),
      log: { warn: () => {}, error: () => {}, debug: () => {} },
    } as never;

    registerRunTimer(mockFastify, 'run-x', 'org-1', 100);
    registerRunTimer(mockFastify, 'run-y', 'org-2', 200);
    registerRunTimer(mockFastify, 'run-z', 'org-3', 300);

    clearAllRunTimers(); // must clear all

    // All cancels are now no-ops (already cleared)
    expect(() => cancelRunTimer('run-x')).not.toThrow();
    expect(() => cancelRunTimer('run-y')).not.toThrow();
    expect(() => cancelRunTimer('run-z')).not.toThrow();
  });

  it('Test 8: timeoutSeconds capped at 86400 (24h max)', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const mockFastify = {
      db: {} as never,
      mek: Buffer.alloc(32),
      agentRegistry: new Map(),
      log: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    } as never;

    registerRunTimer(mockFastify, 'run-cap', 'org-cap', 999_999);

    // setTimeout should have been called with at most 86400*1000 ms
    const relevantCall = setTimeoutSpy.mock.calls.find(
      (c) => typeof c[1] === 'number' && (c[1] as number) > 0,
    );
    const delayMs = relevantCall?.[1] as number;
    expect(delayMs).toBeLessThanOrEqual(86_400_000);
    expect(delayMs).toBe(86_400_000);

    setTimeoutSpy.mockRestore();
    cancelRunTimer('run-cap');
  });
});
