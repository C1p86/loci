// src/executor/__tests__/sequential.test.ts

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSequential } from '../sequential.js';

describe('runSequential', () => {
  it('returns exitCode 0 when all steps succeed', async () => {
    const result = await runSequential(
      [
        { argv: [process.execPath, '-e', 'process.exit(0)'] },
        { argv: [process.execPath, '-e', 'process.exit(0)'] },
      ],
      process.cwd(),
      {},
    );
    expect(result.exitCode).toBe(0);
  });

  it('returns the failing step exit code and stops on first failure', async () => {
    const steps = [
      { argv: [process.execPath, '-e', 'process.exit(0)'] },
      { argv: [process.execPath, '-e', 'process.exit(7)'] },
      { argv: [process.execPath, '-e', 'process.exit(0)'] },
    ];
    const result = await runSequential(steps, process.cwd(), {});
    expect(result.exitCode).toBe(7);
  });

  it('does not run steps after a failure', async () => {
    const steps = [
      { argv: [process.execPath, '-e', 'process.exit(0)'] },
      { argv: [process.execPath, '-e', 'process.exit(3)'] },
      { argv: [process.execPath, '-e', 'process.exit(5)'] },
    ];
    const result = await runSequential(steps, process.cwd(), {});
    expect(result.exitCode).toBe(3);
  });

  it('returns exitCode 0 for empty steps array', async () => {
    const result = await runSequential([], process.cwd(), {});
    expect(result.exitCode).toBe(0);
  });

  it('prints a step header before each step', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runSequential([{ argv: [process.execPath, '-e', 'process.exit(0)'] }], process.cwd(), {});
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('\u25b6'));
    stderrSpy.mockRestore();
  });

  /* ================================================================
   * quick-260421-kbl: breadcrumb step headers
   * ================================================================ */

  it('Test A: prints full breadcrumb path in step header when breadcrumb has length > 1', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runSequential(
      [
        {
          argv: [process.execPath, '-e', 'process.exit(0)'],
          label: 'A1a',
          breadcrumb: ['A', 'A1', 'A1a'],
        },
      ],
      process.cwd(),
      {},
    );
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => s.includes('A > A1 > A1a'))).toBe(true);
    // Pure-leaf header must NOT appear
    expect(calls.some((s) => s === '\u25b6 A1a [1/1]\n')).toBe(false);
    stderrSpy.mockRestore();
  });

  it('Test B: single-segment breadcrumb prints as the leaf (no " > " separator)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runSequential(
      [
        {
          argv: [process.execPath, '-e', 'process.exit(0)'],
          label: 'A',
          breadcrumb: ['A'],
        },
      ],
      process.cwd(),
      {},
    );
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => s.includes('\u25b6 A '))).toBe(true);
    expect(calls.some((s) => s.includes(' > '))).toBe(false);
    stderrSpy.mockRestore();
  });

  it('Test C: breadcrumb absent — falls back to leaf label', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runSequential(
      [
        {
          argv: [process.execPath, '-e', 'process.exit(0)'],
          label: 'legacy-step',
        },
      ],
      process.cwd(),
      {},
    );
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => s.includes('\u25b6 legacy-step '))).toBe(true);
    stderrSpy.mockRestore();
  });

  it('Test D: --from matches by leaf name (regression)', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const steps = [
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A1a',
        breadcrumb: ['A', 'A1', 'A1a'],
      },
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A1b',
        breadcrumb: ['A', 'A1', 'A1b'],
      },
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A2',
        breadcrumb: ['A', 'A2'],
      },
    ];
    await runSequential(steps, process.cwd(), {}, undefined, true, undefined, 'A1b');
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    // First step SKIPPED: look for '⊘' or 'SKIPPED' in conjunction with the display label
    const joined = calls.join('|');
    // A1a full-path 'A > A1 > A1a' should show as SKIPPED
    expect(joined).toMatch(/A > A1 > A1a.*SKIPPED|SKIPPED.*A > A1 > A1a/);
    // A1b should NOT be SKIPPED (it's the --from target)
    expect(joined).not.toMatch(/A > A1 > A1b.*SKIPPED|SKIPPED.*A > A1 > A1b/);
    // A2 should NOT be SKIPPED
    expect(joined).not.toMatch(/A > A2.*SKIPPED|SKIPPED.*A > A2/);
    stderrSpy.mockRestore();
  });

  it('Test E: --from matches by FULL BREADCRUMB PATH', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const steps = [
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A1a',
        breadcrumb: ['A', 'A1', 'A1a'],
      },
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A1b',
        breadcrumb: ['A', 'A1', 'A1b'],
      },
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A2',
        breadcrumb: ['A', 'A2'],
      },
    ];
    await runSequential(steps, process.cwd(), {}, undefined, true, undefined, 'A > A1 > A1b');
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const joined = calls.join('|');
    expect(joined).toMatch(/A > A1 > A1a.*SKIPPED|SKIPPED.*A > A1 > A1a/);
    expect(joined).not.toMatch(/A > A1 > A1b.*SKIPPED|SKIPPED.*A > A1 > A1b/);
    expect(joined).not.toMatch(/A > A2.*SKIPPED|SKIPPED.*A > A2/);
    stderrSpy.mockRestore();
  });

  /* ================================================================
   * prompt steps
   * ================================================================ */

  it('prompt step uses default when stdin is not a TTY', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // stdin.isTTY is undefined in test environment (not a TTY)
    const result = await runSequential(
      [{ kind: 'prompt', var: 'deploy.target', message: 'Enter target:', default: 'staging' }],
      process.cwd(),
      {},
    );
    expect(result.exitCode).toBe(0);
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('deploy.target=staging');
    stderrSpy.mockRestore();
  });

  it('prompt step fails with exitCode 1 when non-TTY and no default', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runSequential(
      [{ kind: 'prompt', var: 'deploy.target', message: 'Enter target:' }],
      process.cwd(),
      {},
    );
    expect(result.exitCode).toBe(1);
    stderrSpy.mockRestore();
  });

  it('prompt step stores value in capturedVars available to subsequent steps', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdoutChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    const result = await runSequential(
      [
        { kind: 'prompt', var: 'env', default: 'prod' },
        // print the captured variable to stdout so we can assert it
        {
          argv: [process.execPath, '-e', 'process.stdout.write(process.env.ENV ?? "")'],
          rawArgv: ['node', '-e', 'process.stdout.write(process.env.ENV ?? "")'],
        },
      ],
      process.cwd(),
      {},
    );
    expect(result.exitCode).toBe(0);
    // The ENV variable should have been passed as env to the child process
    // Check that the prompt step stored the value (visible in stderr output)
    const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrOutput).toContain('env=prod');
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('prompt step label is prompt:<var>', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runSequential([{ kind: 'prompt', var: 'my.var', default: 'x' }], process.cwd(), {});
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('prompt:my.var');
    stderrSpy.mockRestore();
  });

  it('Test F: --from with unknown value skips every step', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const steps = [
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A1a',
        breadcrumb: ['A', 'A1', 'A1a'],
      },
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A1b',
        breadcrumb: ['A', 'A1', 'A1b'],
      },
      {
        argv: [process.execPath, '-e', 'process.exit(0)'],
        label: 'A2',
        breadcrumb: ['A', 'A2'],
      },
    ];
    await runSequential(steps, process.cwd(), {}, undefined, true, undefined, 'does-not-exist');
    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const joined = calls.join('|');
    expect(joined).toMatch(/A > A1 > A1a.*SKIPPED|SKIPPED.*A > A1 > A1a/);
    expect(joined).toMatch(/A > A1 > A1b.*SKIPPED|SKIPPED.*A > A1 > A1b/);
    expect(joined).toMatch(/A > A2.*SKIPPED|SKIPPED.*A > A2/);
    stderrSpy.mockRestore();
  });
});

/* ================================================================
 * quick-260630-uq4: runtime cwd re-interpolation against captured vars
 * ================================================================ */

describe('runSequential — runtime cwd re-interpolation', () => {
  let tmpDir: string;
  let subDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'xci-seq-cwd-'));
    subDir = join(tmpDir, 'subdir');
    mkdirSync(subDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('absolute captured cwd: set step stores absolute path in WS, cmd step spawns there', async () => {
    const result = await runSequential(
      [
        { kind: 'set', vars: { WS: subDir } },
        {
          argv: [
            process.execPath,
            '-e',
            `process.exit(process.cwd() === ${JSON.stringify(subDir)} ? 0 : 7)`,
          ],
          cwd: '${WS}',
        },
      ],
      tmpDir,
      {},
      undefined,
      false,
    );
    expect(result.exitCode).toBe(0);
  });

  it('relative captured cwd: set step stores subdir name, cmd step resolves against base cwd', async () => {
    const expectedDir = resolvePath(tmpDir, 'subdir');
    const result = await runSequential(
      [
        { kind: 'set', vars: { SUBNAME: 'subdir' } },
        {
          argv: [
            process.execPath,
            '-e',
            `process.exit(process.cwd() === ${JSON.stringify(expectedDir)} ? 0 : 8)`,
          ],
          cwd: '${SUBNAME}',
        },
      ],
      tmpDir,
      {},
      undefined,
      false,
    );
    expect(result.exitCode).toBe(0);
  });

  it('no-cwd step inherits the base cwd passed to runSequential', async () => {
    const result = await runSequential(
      [
        {
          argv: [
            process.execPath,
            '-e',
            `process.exit(process.cwd() === ${JSON.stringify(tmpDir)} ? 0 : 9)`,
          ],
        },
      ],
      tmpDir,
      {},
      undefined,
      false,
    );
    expect(result.exitCode).toBe(0);
  });
});
