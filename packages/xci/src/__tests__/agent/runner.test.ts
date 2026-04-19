// packages/xci/src/__tests__/agent/runner.test.ts
// TDD tests for packages/xci/src/agent/runner.ts (Task 1 — Plan 10-05)

import { describe, expect, it } from 'vitest';
import { spawnTask } from '../../agent/runner.js';
import type { RunnerOptions } from '../../agent/runner.js';

// ---------------------------------------------------------------------------
// Helper: build RunnerOptions with sensible defaults
// ---------------------------------------------------------------------------
function makeOpts(
  overrides: Partial<RunnerOptions> & {
    chunks?: Array<{ stream: 'stdout' | 'stderr'; data: string; seq: number }>;
    exitResult?: { code: number; durationMs: number; cancelled: boolean };
  } = {},
): RunnerOptions & {
  chunks: Array<{ stream: 'stdout' | 'stderr'; data: string; seq: number }>;
  exitResult: { code: number; durationMs: number; cancelled: boolean } | null;
} {
  const chunks: Array<{ stream: 'stdout' | 'stderr'; data: string; seq: number }> = [];
  let exitResult: { code: number; durationMs: number; cancelled: boolean } | null = null;

  return {
    argv: overrides.argv ?? ['node', '-e', 'console.log("default")'],
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? {},
    onChunk: overrides.onChunk ?? ((stream, data, seq) => {
      chunks.push({ stream, data, seq });
    }),
    onExit: overrides.onExit ?? ((code, durationMs, cancelled) => {
      exitResult = { code, durationMs, cancelled };
    }),
    chunks,
    get exitResult() { return exitResult; },
  };
}

// ---------------------------------------------------------------------------
// Test 1: happy path — stdout chunk + exit code 0
// ---------------------------------------------------------------------------
it('spawnTask: happy path — stdout chunk with "hi" + exitCode 0', async () => {
  const opts = makeOpts({ argv: ['node', '-e', 'console.log("hi")'] });
  const exitP = new Promise<{ code: number; durationMs: number; cancelled: boolean }>((resolve) => {
    opts.onExit = (code, durationMs, cancelled) => resolve({ code, durationMs, cancelled });
  });

  const handle = spawnTask('r1', opts);
  expect(handle.runId).toBe('r1');

  const result = await exitP;
  expect(result.code).toBe(0);
  expect(result.cancelled).toBe(false);
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  // at least one stdout chunk with "hi"
  const stdoutChunks = opts.chunks.filter((c) => c.stream === 'stdout');
  expect(stdoutChunks.some((c) => c.data.includes('hi'))).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 2: stderr stream received
// ---------------------------------------------------------------------------
it('spawnTask: stderr stream chunk received', async () => {
  const opts = makeOpts({ argv: ['node', '-e', 'process.stderr.write("err-output")'] });
  const exitP = new Promise<void>((resolve) => {
    opts.onExit = () => resolve();
  });

  spawnTask('r2', opts);
  await exitP;

  const stderrChunks = opts.chunks.filter((c) => c.stream === 'stderr');
  expect(stderrChunks.some((c) => c.data.includes('err-output'))).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 3: exit code propagation
// ---------------------------------------------------------------------------
it('spawnTask: exit code propagation — process.exit(7) → exitCode=7', async () => {
  const exitP = new Promise<number>((resolve) => {
    const opts = makeOpts({
      argv: ['node', '-e', 'process.exit(7)'],
      onExit: (code) => resolve(code),
    });
    spawnTask('r3', opts);
  });

  expect(await exitP).toBe(7);
});

// ---------------------------------------------------------------------------
// Test 4: seq numbers are monotonically increasing per run
// ---------------------------------------------------------------------------
it('spawnTask: seq numbers monotonically increase per run', async () => {
  const seqs: number[] = [];
  const exitP = new Promise<void>((resolve) => {
    const opts = makeOpts({
      // emit 3 lines to stdout and one stderr so we get multiple chunks
      argv: ['node', '-e', 'console.log("a"); process.stderr.write("b"); console.log("c")'],
      onChunk: (_stream, _data, seq) => seqs.push(seq),
      onExit: () => resolve(),
    });
    spawnTask('r4', opts);
  });

  await exitP;
  // seq is a counter; if we got any chunks they should be in order
  for (let i = 1; i < seqs.length; i++) {
    expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number);
  }
  expect(seqs[0]).toBe(0);
});

// ---------------------------------------------------------------------------
// Test 5: cancel sends SIGTERM then SIGKILL; onExit fires with cancelled=true
// ---------------------------------------------------------------------------
it('spawnTask: cancel SIGTERM/SIGKILL — onExit fires with non-zero exit + cancelled=true', async () => {
  const exitP = new Promise<{ code: number; cancelled: boolean }>((resolve) => {
    const opts = makeOpts({
      argv: ['node', '-e', 'setTimeout(()=>{},60000)'],
      onExit: (code, _dur, cancelled) => resolve({ code, cancelled }),
    });
    const handle = spawnTask('r5', opts);
    void handle.cancel();
  });

  const result = await exitP;
  expect(result.cancelled).toBe(true);
  expect(result.code).not.toBe(0); // killed process
}, 10_000);

// ---------------------------------------------------------------------------
// Test 6: Windows path — skipped on non-Windows
// ---------------------------------------------------------------------------
describe.runIf(process.platform === 'win32')('spawnTask: Windows taskkill path', () => {
  it('cancel on Windows: process exits non-zero within 10s', async () => {
    const exitP = new Promise<{ code: number; cancelled: boolean }>((resolve) => {
      const opts = makeOpts({
        argv: ['node', '-e', 'setTimeout(()=>{},60000)'],
        onExit: (code, _dur, cancelled) => resolve({ code, cancelled }),
      });
      const handle = spawnTask('w1', opts);
      void handle.cancel();
    });

    const result = await exitP;
    expect(result.cancelled).toBe(true);
    expect(result.code).not.toBe(0);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// Test 7: state.ts — runningRuns is a Map; size=0 initially
// ---------------------------------------------------------------------------
import { createAgentState } from '../../agent/state.js';

it('createAgentState: runningRuns is a Map with size=0 initially', () => {
  const state = createAgentState();
  expect(state.runningRuns).toBeInstanceOf(Map);
  expect(state.runningRuns.size).toBe(0);
  expect(state.draining).toBe(false);
});

// ---------------------------------------------------------------------------
// Test 8: state.ts — maxConcurrent defaults to 1; opt-in override
// ---------------------------------------------------------------------------
it('createAgentState: maxConcurrent defaults to 1', () => {
  const s1 = createAgentState();
  expect(s1.maxConcurrent).toBe(1);
  const s5 = createAgentState(5);
  expect(s5.maxConcurrent).toBe(5);
});

// ---------------------------------------------------------------------------
// Test 9: types.ts — AgentFrame union includes dispatch/cancel/state(running)/log_chunk/result
// ---------------------------------------------------------------------------
import type { AgentFrame } from '../../agent/types.js';

it('AgentFrame type: dispatch/cancel/state-running/log_chunk/result variants compile', () => {
  // These are compile-time checks via the type annotation; if they compile the test passes.
  const _dispatch: AgentFrame = {
    type: 'dispatch',
    run_id: 'r1',
    task_snapshot: {
      task_id: 't1',
      name: 'n',
      description: 'd',
      yaml_definition: 'echo hi',
      label_requirements: [],
    },
    params: {},
    timeout_seconds: 3600,
  };
  const _cancel: AgentFrame = { type: 'cancel', run_id: 'r1', reason: 'manual' };
  const _stateRunning: AgentFrame = { type: 'state', state: 'running', run_id: 'r1' };
  const _logChunk: AgentFrame = {
    type: 'log_chunk',
    run_id: 'r1',
    seq: 0,
    stream: 'stdout',
    data: 'hello',
    ts: new Date().toISOString(),
  };
  const _result: AgentFrame = { type: 'result', run_id: 'r1', exit_code: 0, duration_ms: 100 };
  const _resultCancelled: AgentFrame = {
    type: 'result',
    run_id: 'r1',
    exit_code: 130,
    duration_ms: 100,
    cancelled: true,
  };
  // Avoid unused-variable lint warnings
  void [_dispatch, _cancel, _stateRunning, _logChunk, _result, _resultCancelled];
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// Test 10: client.ts send() accepts new outgoing AgentFrame variants
// ---------------------------------------------------------------------------
import { AgentClient } from '../../agent/client.js';

it('AgentClient.send: accepts new outgoing AgentFrame variants without throwing', () => {
  // Construct client pointed at a non-existent URL (will fail to connect but send() is no-op if closed)
  const client = new AgentClient({
    url: 'ws://127.0.0.1:1', // nothing listening — connection will fail silently
    onOpen: () => {},
    onMessage: () => {},
    onClose: () => {},
  });

  // These should not throw (isOpen=false → no-op)
  expect(() => client.send({ type: 'state', state: 'running', run_id: 'r1' })).not.toThrow();
  expect(() =>
    client.send({
      type: 'log_chunk',
      run_id: 'r1',
      seq: 0,
      stream: 'stdout',
      data: 'hi',
      ts: new Date().toISOString(),
    }),
  ).not.toThrow();
  expect(() =>
    client.send({ type: 'result', run_id: 'r1', exit_code: 0, duration_ms: 10 }),
  ).not.toThrow();
  expect(() =>
    client.send({ type: 'result', run_id: 'r1', exit_code: 130, duration_ms: 10, cancelled: true }),
  ).not.toThrow();

  client.close();
});
