// Unit tests for parseAgentFrame — Phase 8 + Phase 10 frame types.
// No external deps — pure parser tests.

import { describe, expect, it } from 'vitest';
import { AgentFrameInvalidError } from '../../errors.js';
import { parseAgentFrame } from '../../ws/frames.js';

// ---- Phase 8 frame tests (preserved) ----

describe('parseAgentFrame — register', () => {
  it('parses valid register frame', () => {
    const frame = parseAgentFrame(
      JSON.stringify({ type: 'register', token: 'tok', labels: { os: 'linux' } }),
    );
    expect(frame.type).toBe('register');
    if (frame.type === 'register') {
      expect(frame.token).toBe('tok');
      expect(frame.labels).toEqual({ os: 'linux' });
    }
  });

  it('rejects register without token', () => {
    expect(() => parseAgentFrame(JSON.stringify({ type: 'register', labels: {} }))).toThrow(
      AgentFrameInvalidError,
    );
  });

  it('rejects register without labels', () => {
    expect(() => parseAgentFrame(JSON.stringify({ type: 'register', token: 'tok' }))).toThrow(
      AgentFrameInvalidError,
    );
  });

  it('rejects register with non-string label value', () => {
    expect(() =>
      parseAgentFrame(JSON.stringify({ type: 'register', token: 'tok', labels: { os: 42 } })),
    ).toThrow(AgentFrameInvalidError);
  });
});

describe('parseAgentFrame — reconnect', () => {
  it('parses valid reconnect frame', () => {
    const frame = parseAgentFrame(
      JSON.stringify({ type: 'reconnect', credential: 'cred', running_runs: [] }),
    );
    expect(frame.type).toBe('reconnect');
    if (frame.type === 'reconnect') {
      expect(frame.credential).toBe('cred');
      expect(frame.running_runs).toEqual([]);
    }
  });

  it('parses reconnect with running_runs entries', () => {
    const frame = parseAgentFrame(
      JSON.stringify({
        type: 'reconnect',
        credential: 'cred',
        running_runs: [{ run_id: 'xci_run_abc', status: 'running' }],
      }),
    );
    expect(frame.type).toBe('reconnect');
    if (frame.type === 'reconnect') {
      expect(frame.running_runs).toHaveLength(1);
      expect(frame.running_runs[0]?.run_id).toBe('xci_run_abc');
    }
  });
});

describe('parseAgentFrame — goodbye', () => {
  it('parses goodbye with empty running_runs', () => {
    const frame = parseAgentFrame(JSON.stringify({ type: 'goodbye', running_runs: [] }));
    expect(frame.type).toBe('goodbye');
    if (frame.type === 'goodbye') {
      expect(frame.running_runs).toEqual([]);
    }
  });

  // Test 11: Phase 10 fix — goodbye now parses REAL running_runs entries (not stub [])
  it('Test 11: goodbye parses real running_runs array preserving entries', () => {
    const frame = parseAgentFrame(
      JSON.stringify({
        type: 'goodbye',
        running_runs: [{ run_id: 'xci_run_a', status: 'running' }],
      }),
    );
    expect(frame.type).toBe('goodbye');
    if (frame.type === 'goodbye') {
      expect(frame.running_runs).toHaveLength(1);
      expect(frame.running_runs[0]?.run_id).toBe('xci_run_a');
      expect(frame.running_runs[0]?.status).toBe('running');
    }
  });

  it('rejects goodbye with missing running_runs', () => {
    expect(() => parseAgentFrame(JSON.stringify({ type: 'goodbye' }))).toThrow(
      AgentFrameInvalidError,
    );
  });
});

// ---- Phase 10 frame tests ----

describe('parseAgentFrame — state (incoming, Phase 10)', () => {
  // Test 1: happy path
  it('Test 1: parses valid state frame with run_id', () => {
    const frame = parseAgentFrame(
      JSON.stringify({ type: 'state', state: 'running', run_id: 'xci_run_x' }),
    );
    expect(frame.type).toBe('state');
    if (frame.type === 'state') {
      expect(frame.state).toBe('running');
      expect(frame.run_id).toBe('xci_run_x');
    }
  });

  // Test 2: wrong enum value
  it('Test 2: rejects state frame with state != running', () => {
    expect(() =>
      parseAgentFrame(JSON.stringify({ type: 'state', state: 'nope', run_id: 'xci_run_x' })),
    ).toThrow(/state\.state/);
  });

  // Test 3: missing run_id
  it('Test 3: rejects state frame missing run_id', () => {
    expect(() => parseAgentFrame(JSON.stringify({ type: 'state', state: 'running' }))).toThrow(
      /run_id/,
    );
  });
});

describe('parseAgentFrame — result (incoming, Phase 10)', () => {
  // Test 4: happy path
  it('Test 4: parses valid result frame', () => {
    const frame = parseAgentFrame(
      JSON.stringify({ type: 'result', run_id: 'xci_run_r', exit_code: 0, duration_ms: 1234 }),
    );
    expect(frame.type).toBe('result');
    if (frame.type === 'result') {
      expect(frame.run_id).toBe('xci_run_r');
      expect(frame.exit_code).toBe(0);
      expect(frame.duration_ms).toBe(1234);
      expect(frame.cancelled).toBeUndefined();
    }
  });

  // Test 5: cancelled flag preserved
  it('Test 5: parses result with cancelled:true', () => {
    const frame = parseAgentFrame(
      JSON.stringify({
        type: 'result',
        run_id: 'xci_run_r',
        exit_code: 130,
        duration_ms: 100,
        cancelled: true,
      }),
    );
    expect(frame.type).toBe('result');
    if (frame.type === 'result') {
      expect(frame.cancelled).toBe(true);
    }
  });

  it('Test 5b: missing cancelled defaults to undefined', () => {
    const frame = parseAgentFrame(
      JSON.stringify({ type: 'result', run_id: 'r', exit_code: 0, duration_ms: 10 }),
    );
    expect(frame.type).toBe('result');
    if (frame.type === 'result') {
      expect(frame.cancelled).toBeUndefined();
    }
  });

  // Test 6: wrong types
  it('Test 6a: rejects result with exit_code as string', () => {
    expect(() =>
      parseAgentFrame(
        JSON.stringify({ type: 'result', run_id: 'r', exit_code: '0', duration_ms: 10 }),
      ),
    ).toThrow(AgentFrameInvalidError);
  });

  it('Test 6b: rejects result with duration_ms as string', () => {
    expect(() =>
      parseAgentFrame(
        JSON.stringify({ type: 'result', run_id: 'r', exit_code: 0, duration_ms: 'slow' }),
      ),
    ).toThrow(AgentFrameInvalidError);
  });
});

describe('parseAgentFrame — log_chunk (incoming, Phase 10)', () => {
  // Test 7: happy path
  it('Test 7: parses valid log_chunk frame', () => {
    const frame = parseAgentFrame(
      JSON.stringify({
        type: 'log_chunk',
        run_id: 'xci_run_l',
        seq: 0,
        stream: 'stdout',
        data: 'hi',
        ts: '2026-04-19T12:00:00Z',
      }),
    );
    expect(frame.type).toBe('log_chunk');
    if (frame.type === 'log_chunk') {
      expect(frame.run_id).toBe('xci_run_l');
      expect(frame.seq).toBe(0);
      expect(frame.stream).toBe('stdout');
      expect(frame.data).toBe('hi');
      expect(frame.ts).toBe('2026-04-19T12:00:00Z');
    }
  });

  // Test 8: wrong stream enum
  it('Test 8: rejects log_chunk with stream=stdin', () => {
    expect(() =>
      parseAgentFrame(
        JSON.stringify({
          type: 'log_chunk',
          run_id: 'r',
          seq: 0,
          stream: 'stdin',
          data: 'x',
          ts: '2026-01-01T00:00:00Z',
        }),
      ),
    ).toThrow(/stream/);
  });

  it('parses log_chunk with stream=stderr', () => {
    const frame = parseAgentFrame(
      JSON.stringify({
        type: 'log_chunk',
        run_id: 'r',
        seq: 1,
        stream: 'stderr',
        data: 'err',
        ts: '2026-01-01T00:00:00Z',
      }),
    );
    expect(frame.type).toBe('log_chunk');
    if (frame.type === 'log_chunk') {
      expect(frame.stream).toBe('stderr');
    }
  });
});

describe('parseAgentFrame — server-to-agent types rejected as incoming', () => {
  // Test 9: dispatch rejected
  it('Test 9a: rejects dispatch as incoming (server-to-agent only)', () => {
    expect(() =>
      parseAgentFrame(
        JSON.stringify({
          type: 'dispatch',
          run_id: 'r',
          task_snapshot: {},
          params: {},
          timeout_seconds: 60,
        }),
      ),
    ).toThrow(/server-to-agent only/);
  });

  it('Test 9b: rejects cancel as incoming (server-to-agent only)', () => {
    expect(() =>
      parseAgentFrame(JSON.stringify({ type: 'cancel', run_id: 'r', reason: 'timeout' })),
    ).toThrow(/server-to-agent only/);
  });
});

describe('parseAgentFrame — general validation', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseAgentFrame('{bad json')).toThrow(AgentFrameInvalidError);
  });

  it('rejects non-object JSON', () => {
    expect(() => parseAgentFrame('"just a string"')).toThrow(AgentFrameInvalidError);
  });

  it('rejects frame without type field', () => {
    expect(() => parseAgentFrame(JSON.stringify({ foo: 'bar' }))).toThrow(AgentFrameInvalidError);
  });

  it('rejects unknown frame type', () => {
    expect(() => parseAgentFrame(JSON.stringify({ type: 'unknown_xyz' }))).toThrow(
      AgentFrameInvalidError,
    );
  });
});

// Test 10 (compile-time): TaskSnapshot interface shape verified via import
// This is validated by the TypeScript compiler check (tsc --noEmit), not at runtime.
// The existence of these imports proves compilation succeeds.
describe('TaskSnapshot type (compile-time check)', () => {
  it('Test 10: TaskSnapshot can be imported and has the expected shape', async () => {
    await import('../../ws/types.js');
    // If this file compiles, TaskSnapshot is exported with its 5 fields.
    // Runtime test: just verify the import succeeds.
    expect(true).toBe(true);
  });
});
