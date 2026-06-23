// src/executor/__tests__/xci-delegate.test.ts
//
// Unit tests for buildDelegateInvocation and runXciDelegate (executor/xci-delegate.ts).

import { mkdtempSync, readFileSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XCI_BREADCRUMB_ENV, XCI_NESTING_DEPTH_ENV } from '../nesting.js';
import { buildDelegateInvocation, runXciDelegate } from '../xci-delegate.js';

const ORIG_DEPTH = process.env[XCI_NESTING_DEPTH_ENV];

// A real temp dir to satisfy assertCwdExists checks in spawn tests
let TARGET_PROJECT: string;

beforeEach(() => {
  TARGET_PROJECT = mkdtempSync(`${tmpdir()}/xci-delegate-test-`);
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
  it('builds argv as [entryScript, alias, ...args, outputFlag]', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'deploy', args: ['env=prod', '--flag'] },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(result.argv).toEqual([FAKE_ENTRY, 'deploy', 'env=prod', '--flag', '--log']);
  });

  it('appends --verbose when outputFlag is --verbose', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'deploy', args: ['env=prod'] },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--verbose',
    );
    expect(result.argv).toEqual([FAKE_ENTRY, 'deploy', 'env=prod', '--verbose']);
  });

  it('appends outputFlag even with no args', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'test' },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(result.argv).toEqual([FAKE_ENTRY, 'test', '--log']);
  });

  it('uses absolute project path as spawn cwd', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(result.cwd).toBe(TARGET_PROJECT);
  });

  it('falls back to effectiveCwd when project is undefined', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'build' },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
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
      '--log',
    );
    expect(result.cwd).toBe(fieldsCwd);
  });

  it('sets XCI_NESTING_DEPTH = 1 when parent depth is 0 (unset)', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'build' },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(result.env[XCI_NESTING_DEPTH_ENV]).toBe('1');
  });

  it('sets XCI_NESTING_DEPTH = 4 when parent depth is 3', () => {
    process.env[XCI_NESTING_DEPTH_ENV] = '3';
    const result = buildDelegateInvocation(
      { alias: 'build' },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(result.env[XCI_NESTING_DEPTH_ENV]).toBe('4');
  });

  it('includes argv with no args when args is undefined (with outputFlag)', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'test' },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(result.argv).toEqual([FAKE_ENTRY, 'test', '--log']);
  });

  // quick-260623-ipz: XCI_BREADCRUMB env injection tests
  it("sets XCI_BREADCRUMB = 'A > A1' when fields.breadcrumb is ['A','A1']", () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'build', breadcrumb: ['A', 'A1'] },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(result.env[XCI_BREADCRUMB_ENV]).toBe('A > A1');
    // XCI_NESTING_DEPTH still increments correctly
    expect(result.env[XCI_NESTING_DEPTH_ENV]).toBe('1');
  });

  it('omits XCI_BREADCRUMB from env when fields.breadcrumb is undefined (no-delegation path is byte-identical)', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'build' },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(Object.prototype.hasOwnProperty.call(result.env, XCI_BREADCRUMB_ENV)).toBe(false);
  });

  it('omits XCI_BREADCRUMB from env when fields.breadcrumb is empty array', () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const result = buildDelegateInvocation(
      { alias: 'build', breadcrumb: [] },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(Object.prototype.hasOwnProperty.call(result.env, XCI_BREADCRUMB_ENV)).toBe(false);
  });

  it("2-level accumulation: fields.breadcrumb=['root','A','A1'] sets XCI_BREADCRUMB='root > A > A1' verbatim (no re-concatenation)", () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    // Simulate outer process: its resolver already seeded chain from incoming 'root',
    // so plan.breadcrumb = ['root','A','A1']. We pass that directly — must NOT re-read
    // process.env.XCI_BREADCRUMB and concatenate again (would produce 'root > root > ...').
    const result = buildDelegateInvocation(
      { alias: 'inner', breadcrumb: ['root', 'A', 'A1'] },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      '--log',
    );
    expect(result.env[XCI_BREADCRUMB_ENV]).toBe('root > A > A1');
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
      undefined, // logFile
      true, // showOutput
      undefined, // tailLines
      false, // verbose
      spawnFn,
    );
    expect(result.exitCode).toBe(1);
    expect(spawnFn).not.toHaveBeenCalled();
    // Should have written a warning to stderr
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('invokes spawn when depth < 32 and returns exit code', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const spawnFn = vi.fn().mockImplementation(
      () =>
        new Promise<{ exitCode: number; stdout: PassThrough; stderr: PassThrough }>((resolve) => {
          const stdout = new PassThrough();
          const stderr = new PassThrough();
          setTimeout(() => resolve({ exitCode: 0, stdout, stderr }), 0);
        }),
    );
    const result = await runXciDelegate(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      undefined, // logFile
      true, // showOutput
      undefined, // tailLines
      false, // verbose
      spawnFn,
    );
    expect(result.exitCode).toBe(0);
    expect(spawnFn).toHaveBeenCalled();
  });

  it('forwards --log flag in argv when verbose=false', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    let capturedArgv: string[] | undefined;
    const spawnFn = vi.fn().mockImplementation(
      (_execPath: string, argv: string[]) =>
        new Promise<{ exitCode: number; stdout: PassThrough; stderr: PassThrough }>((resolve) => {
          capturedArgv = argv;
          const stdout = new PassThrough();
          const stderr = new PassThrough();
          setTimeout(() => resolve({ exitCode: 0, stdout, stderr }), 0);
        }),
    );
    await runXciDelegate(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      undefined,
      true,
      undefined,
      false, // verbose=false → outputFlag='--log'
      spawnFn,
    );
    expect(capturedArgv).toBeDefined();
    expect(capturedArgv?.at(-1)).toBe('--log');
  });

  it('forwards --verbose flag in argv when verbose=true', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    let capturedArgv: string[] | undefined;
    const spawnFn = vi.fn().mockImplementation(
      (_execPath: string, argv: string[]) =>
        new Promise<{ exitCode: number; stdout: PassThrough; stderr: PassThrough }>((resolve) => {
          capturedArgv = argv;
          const stdout = new PassThrough();
          const stderr = new PassThrough();
          setTimeout(() => resolve({ exitCode: 0, stdout, stderr }), 0);
        }),
    );
    await runXciDelegate(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      undefined,
      true,
      undefined,
      true, // verbose=true → outputFlag='--verbose'
      spawnFn,
    );
    expect(capturedArgv).toBeDefined();
    expect(capturedArgv?.at(-1)).toBe('--verbose');
  });

  it('tees child stdout to logFile via PassThrough fake', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];

    // Create a temp dir for the logFile
    const logDir = mkdtempSync(join(tmpdir(), 'xci-tee-log-'));
    const logFile = join(logDir, 'out.log');

    const childStdout = new PassThrough();
    const childStderr = new PassThrough();

    let resolveSpawn!: (val: {
      exitCode: number;
      stdout: PassThrough;
      stderr: PassThrough;
    }) => void;
    const spawnFn = vi.fn().mockImplementation(
      () =>
        new Promise<{ exitCode: number; stdout: PassThrough; stderr: PassThrough }>((resolve) => {
          resolveSpawn = resolve;
        }),
    );

    const runPromise = runXciDelegate(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      logFile, // logFile provided
      true, // showOutput
      undefined,
      false,
      spawnFn,
    );

    // Give the implementation a tick to set up the tee
    await new Promise((r) => setTimeout(r, 10));

    // Emit a data chunk through the fake stdout
    childStdout.push(Buffer.from('TEE-LINE\n'));

    // Give time for data handler to process
    await new Promise((r) => setTimeout(r, 10));

    // Resolve the spawn with exit code 0
    resolveSpawn({ exitCode: 0, stdout: childStdout, stderr: childStderr });
    childStdout.end();
    childStderr.end();

    await runPromise;

    // Read logFile and verify TEE-LINE is present
    const logContent = readFileSync(logFile, 'utf8');
    expect(logContent).toContain('TEE-LINE');

    // Cleanup
    try {
      rmdirSync(logDir, { recursive: true } as Parameters<typeof rmdirSync>[1]);
    } catch {
      /* ignore */
    }
  });

  it('showOutput=true writes child stdout to process.stdout', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];

    const childStdout = new PassThrough();
    const childStderr = new PassThrough();

    let resolveSpawn!: (val: {
      exitCode: number;
      stdout: PassThrough;
      stderr: PassThrough;
    }) => void;
    const spawnFn = vi.fn().mockImplementation(
      () =>
        new Promise<{ exitCode: number; stdout: PassThrough; stderr: PassThrough }>((resolve) => {
          resolveSpawn = resolve;
        }),
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const runPromise = runXciDelegate(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      undefined, // no logFile
      true, // showOutput=true
      undefined,
      false,
      spawnFn,
    );

    await new Promise((r) => setTimeout(r, 10));

    childStdout.push(Buffer.from('SHOW-LINE\n'));
    await new Promise((r) => setTimeout(r, 10));

    resolveSpawn({ exitCode: 0, stdout: childStdout, stderr: childStderr });
    childStdout.end();
    childStderr.end();

    await runPromise;

    const writtenText = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(writtenText).toContain('SHOW-LINE');
  });

  it('showOutput=false does NOT write child stdout to process.stdout', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];

    const childStdout = new PassThrough();
    const childStderr = new PassThrough();

    let resolveSpawn!: (val: {
      exitCode: number;
      stdout: PassThrough;
      stderr: PassThrough;
    }) => void;
    const spawnFn = vi.fn().mockImplementation(
      () =>
        new Promise<{ exitCode: number; stdout: PassThrough; stderr: PassThrough }>((resolve) => {
          resolveSpawn = resolve;
        }),
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const runPromise = runXciDelegate(
      { alias: 'build', project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      undefined, // no logFile
      false, // showOutput=false → must NOT write to terminal
      undefined,
      false,
      spawnFn,
    );

    await new Promise((r) => setTimeout(r, 10));

    childStdout.push(Buffer.from('HIDDEN-LINE\n'));
    await new Promise((r) => setTimeout(r, 10));

    resolveSpawn({ exitCode: 0, stdout: childStdout, stderr: childStderr });
    childStdout.end();
    childStderr.end();

    await runPromise;

    const writtenText = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(writtenText).not.toContain('HIDDEN-LINE');
  });

  it('does not log args values in any output (secret safety)', async () => {
    delete process.env[XCI_NESTING_DEPTH_ENV];
    const secretArg = 'SECRET_TOKEN=super-secret-value-12345';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const spawnFn = vi.fn().mockImplementation(
      () =>
        new Promise<{ exitCode: number; stdout: PassThrough; stderr: PassThrough }>((resolve) => {
          const stdout = new PassThrough();
          const stderr = new PassThrough();
          setTimeout(() => resolve({ exitCode: 0, stdout, stderr }), 0);
        }),
    );

    await runXciDelegate(
      { alias: 'deploy', args: [secretArg], project: TARGET_PROJECT },
      EFFECTIVE_CWD,
      {},
      FAKE_ENTRY,
      undefined,
      true,
      undefined,
      false,
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
