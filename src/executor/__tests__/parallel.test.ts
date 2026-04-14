// src/executor/__tests__/parallel.test.ts

import { describe, expect, it, vi } from 'vitest';
import { runParallel } from '../parallel.js';

const succeed = { alias: 'ok', argv: [process.execPath, '-e', 'process.exit(0)'] };
const fail1 = { alias: 'fail1', argv: [process.execPath, '-e', 'process.exit(1)'] };
const fail5 = { alias: 'fail5', argv: [process.execPath, '-e', 'process.exit(5)'] };
const longRunning = {
  alias: 'slow',
  argv: [process.execPath, '-e', 'setTimeout(() => {}, 10000)'],
};

describe('runParallel (failMode: fast)', () => {
  it('returns exitCode 0 when all commands succeed', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runParallel([succeed, succeed], 'fast', process.cwd(), {});
    expect(result.exitCode).toBe(0);
    stderrSpy.mockRestore();
  }, 10000);

  it('returns the failing command exit code', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runParallel([succeed, fail5], 'fast', process.cwd(), {});
    expect(result.exitCode).toBe(5);
    stderrSpy.mockRestore();
  }, 10000);

  it('aborts remaining commands when one fails', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // longRunning would take 10s if not aborted; with failMode fast, fail1 should abort it
    const start = Date.now();
    const result = await runParallel([fail1, longRunning], 'fast', process.cwd(), {});
    const elapsed = Date.now() - start;
    expect(result.exitCode).toBe(1);
    // Should complete well under 10 seconds since longRunning is aborted
    expect(elapsed).toBeLessThan(8000);
    stderrSpy.mockRestore();
  }, 12000);
});

describe('runParallel (failMode: complete)', () => {
  it('returns exitCode 0 when all commands succeed', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runParallel([succeed, succeed], 'complete', process.cwd(), {});
    expect(result.exitCode).toBe(0);
    stderrSpy.mockRestore();
  }, 10000);

  it('returns first non-zero exit code after all commands finish', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await runParallel([fail5, fail1], 'complete', process.cwd(), {});
    // Both fail; first non-zero encountered (fail5 or fail1 — depends on order)
    expect(result.exitCode).toBeGreaterThan(0);
    stderrSpy.mockRestore();
  }, 10000);

  it('lets all commands finish before returning', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // With failMode complete, both commands run to completion
    const result = await runParallel([succeed, fail1], 'complete', process.cwd(), {});
    expect(result.exitCode).toBe(1);
    stderrSpy.mockRestore();
  }, 10000);
});

describe('runParallel — output', () => {
  it('prints parallel summary after completion', async () => {
    const stderrOutput: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput.push(String(chunk));
      return true;
    });
    await runParallel([succeed], 'fast', process.cwd(), {});
    stderrSpy.mockRestore();

    const output = stderrOutput.join('');
    expect(output).toContain('ok');
  }, 10000);
});
