// src/executor/__tests__/sequential.test.ts

import { describe, expect, it, vi } from 'vitest';
import { runSequential } from '../sequential.js';

describe('runSequential', () => {
  it('returns exitCode 0 when all steps succeed', async () => {
    const result = await runSequential(
      [
        [process.execPath, '-e', 'process.exit(0)'],
        [process.execPath, '-e', 'process.exit(0)'],
      ],
      process.cwd(),
      {},
    );
    expect(result.exitCode).toBe(0);
  });

  it('returns the failing step exit code and stops on first failure', async () => {
    const steps = [
      [process.execPath, '-e', 'process.exit(0)'],
      [process.execPath, '-e', 'process.exit(7)'],
      [process.execPath, '-e', 'process.exit(0)'],
    ];

    // Track which steps actually ran by using a side-effect-free approach:
    // the third step would fail if the second fails correctly
    const result = await runSequential(steps, process.cwd(), {});
    expect(result.exitCode).toBe(7);
  });

  it('does not run steps after a failure', async () => {
    // Use a file-write side effect to detect if third step ran
    // Instead, use a simpler test: second step sets exit code, third step
    // would set a different exit code if it ran
    const steps = [
      [process.execPath, '-e', 'process.exit(0)'],
      [process.execPath, '-e', 'process.exit(3)'],
      // If this ran, exit code would be 5, not 3
      [process.execPath, '-e', 'process.exit(5)'],
    ];
    const result = await runSequential(steps, process.cwd(), {});
    // If third step ran, exitCode would be 5, not 3
    expect(result.exitCode).toBe(3);
  });

  it('returns exitCode 0 for empty steps array', async () => {
    const result = await runSequential([], process.cwd(), {});
    expect(result.exitCode).toBe(0);
  });

  it('prints a step header before each step', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await runSequential(
      [[process.execPath, '-e', 'process.exit(0)']],
      process.cwd(),
      {},
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('\u25b6'));
    stderrSpy.mockRestore();
  });
});
