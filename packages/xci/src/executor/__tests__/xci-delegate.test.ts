// src/executor/__tests__/xci-delegate.test.ts
//
// Unit tests for buildDelegateInvocation and runXciDelegate (executor/xci-delegate.ts).

import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XCI_NESTING_DEPTH_ENV } from '../nesting.js';
import { buildDelegateInvocation, runXciDelegate } from '../xci-delegate.js';

const ORIG_DEPTH = process.env[XCI_NESTING_DEPTH_ENV];

// A real temp dir to satisfy assertCwdExists checks in spawn tests
let TARGET_PROJECT: string;

beforeEach(() => {
  TARGET_PROJECT = mkdtempSync(tmpdir() + '/xci-delegate-test-');
});

afterEach(() => {
  if (ORIG_DEPTH === undefined) {
    delete process.env[XCI_NESTING_DEPTH_ENV];
  } else {
    process.env[XCI_NESTING_DEPTH_ENV] = ORIG_DEPTH;
  }
  try {
    rmdirSync(TARGET_PROJECT);
  } catch {
    /* ignore cleanup errors */
  }
  vi.restoreAllMocks();
});

const FAKE_ENTRY = '/fake/path/to/cli.mjs';
const EFFECTIVE_CWD = process.cwd(); // real dir for buildDelegateInvocation tests

describe('buildDelegateInvocation', () => {
  it('builds argv as [entryScript, alias, ...args]', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'deploy', args: ['env=prod', '--flag'] },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
    );
    expect(result.argv).toEqual([FAKE_ENTRY, 'deploy', 'env=prod', '--flag']);
  });

  it('uses absolute project path as spawn cwd', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
    );
    expect(result.cwd).toBe(TARGET_PROJECT);
  });

  it('falls back to effectiveCwd when project is undefined', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation({ alias: 'build' }, EFFECTIVE_CWD, {}, FAKE_ENTRY);
    expect(result.cwd).toBe(EFFECTIVE_CWD);
  });

  it('falls back to fields.cwd when project is undefined and fields.cwd is set', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    // Use a real directory so the test isn't blocked by assertCwdExists (only assertCwdExists
    // is called during spawn, not during buildDelegateInvocation — but test the pure shape)
    const fieldsCwd = EFFECTIVE_CWD; // use real dir to be safe
    const result = buildDelegateInvocation(
      { alias: 'build', cwd: fieldsCwd },
      '/some/other/dir',
      {},
      FAKE_ENTRY,
    );
    expect(result.cwd).toBe(fieldsCwd);
  });

  it('sets XCI_NESTING_DEPTH = 1 when parent depth is 0 (unset)', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation({ alias: 'build' }, EFFECTIVE_CWD, {}, FAKE_ENTRY);
    expect(result.env[XCI_NESTING_DEPTH_ENV]).toBe('1');
  });

  it('sets XCI_NESTING_DEPTH = 4 when parent depth is 3', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '3';
    const result = buildDelegateInvocation({ alias: 'build' }, EFFECTIVE_CWD, {}, FAKE_ENTRY);
    expect(result.env[XCI_NESTING_DEPTH_ENV]).toBe('4');
  });

  it('includes argv with no args when args is undefined', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation({ alias: 'test' }, EFFECTIVE_CWD, {}, FAKE_ENTRY);
    expect(result.argv).toEqual([FAKE_ENTRY, 'test']);
  });
});

describe('runXciDelegate', () => {
  it('depth >= 32 returns exitCode 1 without invoking spawn', async () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '32';
    const spawnFn = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runXciDelegate(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      spawnFn,
    );
    expect(result.exitCode).toBe(1);
    expect(spawnFn).not.toHaveBeenCalled();
    // Should have written a warning to stderr
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('invokes spawn when depth < 32 and returns exit code', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const spawnFn = vi.fn().mockResolvedValue({ exitCode: 0 });
    const result = await runXciDelegate(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      spawnFn,
    );
    expect(result.exitCode).toBe(0);
    expect(spawnFn).toHaveBeenCalled();
  });

  it('does not log args values in any output (secret safety)', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const secretArg = 'SECRET_TOKEN=super-secret-value-12345';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const spawnFn = vi.fn().mockResolvedValue({ exitCode: 0 });
    await runXciDelegate(
      { alias: 'deploy', args: [secretArg], project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      spawnFn,
    );
    // Verify the secret value itself was never written to stderr or stdout
    for (const call of stderrSpy.mock.calls) {
      expect(String(call[0])).not.toContain('super-secret-value-12345');
    }
    for (const call of stdoutSpy.mock.calls) {
      expect(String(call[0])).not.toContain('super-secret-value-12345');
    }
  });
});
