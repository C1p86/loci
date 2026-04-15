// src/executor/single.ts
//
// Single command execution via execa with shell:false (T-04-01, EXE-01, EXE-02).

import { execa } from 'execa';
import { SpawnError } from '../errors.js';
import type { ExecutionResult } from '../types.js';

/**
 * Spawn a single command with the given argv, cwd, and env vars.
 * Streams stdout/stderr to the terminal in real time (EXE-02).
 * Returns the child process exit code (EXE-03, EXE-04).
 * Throws SpawnError on ENOENT or other spawn failures.
 */
export async function runSingle(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<ExecutionResult> {
  const [cmd, ...args] = argv;
  if (!cmd) throw new SpawnError('(empty command)', new Error('argv is empty'));

  try {
    const result = await execa(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdout: 'inherit',
      stderr: 'inherit',
      reject: false,
    });
    // With reject:false, spawn errors (ENOENT) surface as result.failed=true + exitCode undefined
    // and result.cause contains the underlying error.
    if (result.failed && result.exitCode === undefined && result.cause) {
      throw new SpawnError(cmd, result.cause);
    }
    return { exitCode: result.exitCode ?? 1 };
  } catch (err: unknown) {
    if (err instanceof SpawnError) throw err;
    throw new SpawnError(cmd, err);
  }
}
