// src/executor/__tests__/single.test.ts

import { describe, expect, it } from 'vitest';
import { SpawnError } from '../../errors.js';
import { runSingle } from '../single.js';

describe('runSingle', () => {
  it('spawns a command successfully and returns exitCode 0', async () => {
    const result = await runSingle(
      [process.execPath, '-e', 'process.exit(0)'],
      process.cwd(),
      {},
    );
    expect(result.exitCode).toBe(0);
  });

  it('returns the child process exit code on non-zero exit', async () => {
    const result = await runSingle(
      [process.execPath, '-e', 'process.exit(42)'],
      process.cwd(),
      {},
    );
    expect(result.exitCode).toBe(42);
  });

  it('throws SpawnError when command does not exist', async () => {
    await expect(
      runSingle(['__loci_nonexistent_command_xyz__'], process.cwd(), {}),
    ).rejects.toThrow(SpawnError);
  });

  it('passes env vars to the child process', async () => {
    const result = await runSingle(
      [process.execPath, '-e', "process.exit(process.env.TEST_VAR === 'hello' ? 0 : 1)"],
      process.cwd(),
      { TEST_VAR: 'hello' },
    );
    expect(result.exitCode).toBe(0);
  });

  it('passes cwd to the child process', async () => {
    const tmpDir = '/tmp';
    const result = await runSingle(
      [process.execPath, '-e', `process.exit(process.cwd() === '${tmpDir}' ? 0 : 1)`],
      tmpDir,
      {},
    );
    expect(result.exitCode).toBe(0);
  });

  it('throws SpawnError for empty argv', async () => {
    await expect(runSingle([], process.cwd(), {})).rejects.toThrow(SpawnError);
  });
});
