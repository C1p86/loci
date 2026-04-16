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
});
