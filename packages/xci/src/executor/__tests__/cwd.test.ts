// src/executor/__tests__/cwd.test.ts
//
// Tests for resolveAbsoluteCwds helper + executor integration (spawn sites honour per-plan cwd).
// quick-260421-g99

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAbsoluteCwds } from '../cwd.js';
import { executor } from '../index.js';
import { runSingle } from '../single.js';
import type { ExecutionPlan, SequentialStep } from '../../types.js';

/* ============================================================
 * resolveAbsoluteCwds — pure transform tests
 * ============================================================ */

describe('resolveAbsoluteCwds — single plan', () => {
  it('leaves plan.cwd undefined when absent', () => {
    const plan: ExecutionPlan = { kind: 'single', argv: ['echo', 'hi'] };
    const out = resolveAbsoluteCwds(plan, '/proj');
    expect(out.kind).toBe('single');
    if (out.kind !== 'single') throw new Error('unreachable');
    expect(out.cwd).toBeUndefined();
  });

  it('resolves relative cwd against projectRoot', () => {
    const plan: ExecutionPlan = { kind: 'single', argv: ['echo', 'hi'], cwd: 'sub' };
    const out = resolveAbsoluteCwds(plan, '/proj');
    if (out.kind !== 'single') throw new Error('unreachable');
    // Use platform-native resolve so the assertion is portable.
    expect(out.cwd).toBe(resolvePath('/proj', 'sub'));
    expect(isAbsolute(out.cwd ?? '')).toBe(true);
  });

  it('preserves absolute cwd verbatim', () => {
    const abs = resolvePath('/abs/path');
    const plan: ExecutionPlan = { kind: 'single', argv: ['echo', 'hi'], cwd: abs };
    const out = resolveAbsoluteCwds(plan, '/proj');
    if (out.kind !== 'single') throw new Error('unreachable');
    expect(out.cwd).toBe(abs);
  });
});

describe('resolveAbsoluteCwds — sequential plan', () => {
  it('rewrites relative cwd on each cmd step; undefined stays undefined; set step untouched', () => {
    const steps: readonly SequentialStep[] = [
      { argv: ['a'], cwd: 'x' },
      { argv: ['b'] },
      { kind: 'set', vars: { K: 'v' } },
    ];
    const plan: ExecutionPlan = { kind: 'sequential', steps };
    const out = resolveAbsoluteCwds(plan, '/p');
    if (out.kind !== 'sequential') throw new Error('unreachable');

    const s0 = out.steps[0];
    if (!s0 || s0.kind === 'set' || s0.kind === 'ini') throw new Error('expected cmd step');
    expect(s0.cwd).toBe(resolvePath('/p', 'x'));

    const s1 = out.steps[1];
    if (!s1 || s1.kind === 'set' || s1.kind === 'ini') throw new Error('expected cmd step');
    expect(s1.cwd).toBeUndefined();

    const s2 = out.steps[2];
    expect(s2).toBeDefined();
    if (!s2) throw new Error('unreachable');
    expect(s2.kind).toBe('set');
    // set step must never grow a cwd field
    expect(s2).not.toHaveProperty('cwd');
  });

  it('resolves cwd on ini steps inside sequential', () => {
    const steps: readonly SequentialStep[] = [
      { kind: 'ini', file: 'my.ini', mode: 'overwrite', set: { Sec: { k: 'v' } }, cwd: 'confdir' },
    ];
    const plan: ExecutionPlan = { kind: 'sequential', steps };
    const out = resolveAbsoluteCwds(plan, '/p');
    if (out.kind !== 'sequential') throw new Error('unreachable');
    const s0 = out.steps[0];
    if (!s0 || s0.kind !== 'ini') throw new Error('unreachable');
    expect(s0.cwd).toBe(resolvePath('/p', 'confdir'));
  });
});

describe('resolveAbsoluteCwds — parallel plan', () => {
  it('rewrites per-entry cwd; entries without cwd stay undefined', () => {
    const plan: ExecutionPlan = {
      kind: 'parallel',
      group: [
        { alias: 'a', argv: ['echo', 'a'], cwd: 'x' },
        { alias: 'b', argv: ['echo', 'b'] },
      ],
      failMode: 'fast',
    };
    const out = resolveAbsoluteCwds(plan, '/p');
    if (out.kind !== 'parallel') throw new Error('unreachable');
    expect(out.group[0]?.cwd).toBe(resolvePath('/p', 'x'));
    expect(out.group[1]?.cwd).toBeUndefined();
  });
});

describe('resolveAbsoluteCwds — ini plan', () => {
  it('resolves top-level cwd on an ini plan', () => {
    const plan: ExecutionPlan = {
      kind: 'ini',
      file: 'x.ini',
      mode: 'overwrite',
      set: { Sec: { k: 'v' } },
      cwd: 'work',
    };
    const out = resolveAbsoluteCwds(plan, '/p');
    if (out.kind !== 'ini') throw new Error('unreachable');
    expect(out.cwd).toBe(resolvePath('/p', 'work'));
  });
});

/* ============================================================
 * Executor integration — spawn really happens in the declared cwd
 * ============================================================ */

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'xci-cwd-'));
});
afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
});

describe('executor.run single — honours plan.cwd', () => {
  it('spawns in plan.cwd instead of the options default cwd', async () => {
    const plan: ExecutionPlan = {
      kind: 'single',
      argv: [
        process.execPath,
        '-e',
        `process.exit(process.cwd() === ${JSON.stringify(tmpDir)} ? 0 : 7)`,
      ],
      cwd: tmpDir,
    };
    // Default cwd deliberately set to a different directory to prove plan.cwd wins.
    const result = await executor.run(plan, {
      cwd: process.cwd(),
      env: {},
      showOutput: false,
    });
    expect(result.exitCode).toBe(0);
  });
});

describe('runSingle — absolute cwd works end-to-end', () => {
  it('spawns a child in the exact absolute cwd passed', async () => {
    const result = await runSingle(
      [process.execPath, '-e', `process.exit(process.cwd() === ${JSON.stringify(tmpDir)} ? 0 : 9)`],
      tmpDir,
      {},
      undefined,
      false,
    );
    expect(result.exitCode).toBe(0);
  });
});

describe('executor.run sequential — per-step cwd overrides default', () => {
  it('each step with its own cwd spawns in that cwd', async () => {
    const subA = mkdtempSync(join(tmpDir, 'A-'));
    const subB = mkdtempSync(join(tmpDir, 'B-'));
    const plan: ExecutionPlan = {
      kind: 'sequential',
      steps: [
        {
          argv: [
            process.execPath,
            '-e',
            `process.exit(process.cwd() === ${JSON.stringify(subA)} ? 0 : 11)`,
          ],
          cwd: subA,
        },
        {
          argv: [
            process.execPath,
            '-e',
            `process.exit(process.cwd() === ${JSON.stringify(subB)} ? 0 : 12)`,
          ],
          cwd: subB,
        },
      ],
    };
    const result = await executor.run(plan, {
      cwd: process.cwd(),
      env: {},
      showOutput: false,
    });
    expect(result.exitCode).toBe(0);
  });
});

describe('executor.run parallel — per-entry cwd overrides default', () => {
  it('each entry spawns in its own cwd', async () => {
    const subA = mkdtempSync(join(tmpDir, 'A-'));
    const subB = mkdtempSync(join(tmpDir, 'B-'));
    const plan: ExecutionPlan = {
      kind: 'parallel',
      group: [
        {
          alias: 'a',
          argv: [
            process.execPath,
            '-e',
            `process.exit(process.cwd() === ${JSON.stringify(subA)} ? 0 : 21)`,
          ],
          cwd: subA,
        },
        {
          alias: 'b',
          argv: [
            process.execPath,
            '-e',
            `process.exit(process.cwd() === ${JSON.stringify(subB)} ? 0 : 22)`,
          ],
          cwd: subB,
        },
      ],
      failMode: 'complete',
    };
    const result = await executor.run(plan, {
      cwd: process.cwd(),
      env: {},
      showOutput: false,
    });
    expect(result.exitCode).toBe(0);
  });
});
