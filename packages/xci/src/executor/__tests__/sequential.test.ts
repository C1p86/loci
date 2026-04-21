// src/executor/__tests__/sequential.test.ts

import { describe, expect, it, vi } from 'vitest';
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
    await runSequential(
      [{ argv: [process.execPath, '-e', 'process.exit(0)'] }],
      process.cwd(),
      {},
    );
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
