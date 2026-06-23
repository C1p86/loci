// src/executor/single.ts
//
// Single command execution via execa with shell:false (T-04-01, EXE-01, EXE-02).
// Handles SIGINT to kill child processes and waits until they exit.

import { execSync } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { execa, type ResultPromise } from 'execa';
import { SpawnError } from '../errors.js';
import type { ExecutionResult } from '../types.js';
import { assertCwdExists } from './cwd.js';
import { attachTee } from './tee.js';

const IS_WINDOWS = process.platform === 'win32';
const FORCE_KILL_DELAY = 5000;

/**
 * Kill a child process tree and wait for it to exit.
 * On Windows: uses `taskkill /f /t /pid` to kill entire process tree.
 * On Unix: sends SIGTERM, then SIGKILL after timeout.
 */
async function killAndWait(proc: ResultPromise): Promise<void> {
  process.stderr.write('\n[xci] Stopping child process...\n');

  const pid = proc.pid;

  if (IS_WINDOWS && pid) {
    // Windows: taskkill with /t kills the entire process tree
    try {
      execSync(`taskkill /f /t /pid ${pid}`, { stdio: 'pipe' });
    } catch {
      // Process may have already exited
    }
  } else {
    proc.kill('SIGTERM');
  }

  const forceKillTimer = setTimeout(() => {
    process.stderr.write('[xci] Force killing child process...\n');
    if (IS_WINDOWS && pid) {
      try {
        execSync(`taskkill /f /t /pid ${pid}`, { stdio: 'pipe' });
      } catch {
        /* */
      }
    } else {
      proc.kill('SIGKILL');
    }
  }, FORCE_KILL_DELAY);

  try {
    await proc;
  } catch {
    // Expected — killed process throws
  } finally {
    clearTimeout(forceKillTimer);
  }
  process.stderr.write('[xci] Child process terminated.\n');
}

/**
 * Spawn a single command, capture stdout, stream stderr to terminal.
 * Used when a command has `capture` and is run directly.
 */
export async function runSingleCapture(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
  logFile?: string,
): Promise<{ exitCode: number; stdout: string }> {
  const [cmd, ...args] = argv;
  if (!cmd) throw new SpawnError('(empty command)', new Error('argv is empty'));
  assertCwdExists(cwd);

  let logStream: WriteStream | undefined;
  if (logFile) logStream = createWriteStream(logFile, { flags: 'a' });

  const proc = execa(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
  }) as unknown as ResultPromise;

  let interrupted = false;
  const sigintHandler = async () => {
    interrupted = true;
    await killAndWait(proc);
  };
  process.on('SIGINT', sigintHandler);

  try {
    const result = await proc;

    const stdout = (result.stdout as string | undefined) ?? '';
    const stderr = (result.stderr as string | undefined) ?? '';
    if (logStream) {
      if (stdout) logStream.write(stdout + '\n');
      if (stderr) logStream.write(stderr + '\n');
      logStream.end();
    }

    if (interrupted) return { exitCode: 130, stdout: '' };
    if (result.failed && result.exitCode === undefined && result.cause) {
      throw new SpawnError(cmd, result.cause);
    }
    return { exitCode: result.exitCode ?? 1, stdout: stdout.trim() };
  } catch (err: unknown) {
    logStream?.end();
    if (interrupted) return { exitCode: 130, stdout: '' };
    if (err instanceof SpawnError) throw err;
    throw new SpawnError(cmd, err);
  } finally {
    process.off('SIGINT', sigintHandler);
  }
}

/**
 * Spawn a single command with the given argv, cwd, and env vars.
 * Pipes output to log file (if provided) and optionally to terminal.
 * On SIGINT: kills child process and waits for it to exit before returning.
 */
export async function runSingle(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
  logFile?: string,
  showOutput = true,
  tailLines?: number,
): Promise<ExecutionResult> {
  const [cmd, ...args] = argv;
  if (!cmd) throw new SpawnError('(empty command)', new Error('argv is empty'));
  assertCwdExists(cwd);

  let logStream: WriteStream | undefined;
  if (logFile) logStream = createWriteStream(logFile, { flags: 'a' });

  // Use inherit only when showing full output with no log file and no tail
  const useInherit = !logFile && showOutput && !tailLines;
  // Disable real-time tail cursor-move redraws when nested (attenuation rule).
  // Plain line streaming and the log file still work; only the cursor-up/erase redraw is suppressed.
  // isNested() is called inside attachTee — the nesting check lives there.

  const proc = execa(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: useInherit ? 'inherit' : 'pipe',
    stderr: useInherit ? 'inherit' : 'pipe',
    reject: false,
  }) as unknown as ResultPromise;

  let removeTeeListeners: (() => void) | undefined;
  if (!useInherit) {
    removeTeeListeners = attachTee(
      proc.stdout as NodeJS.EventEmitter | null | undefined,
      proc.stderr as NodeJS.EventEmitter | null | undefined,
      logStream,
      showOutput,
      tailLines,
    );
  }

  let interrupted = false;
  const sigintHandler = async () => {
    interrupted = true;
    await killAndWait(proc);
  };
  process.on('SIGINT', sigintHandler);

  try {
    const result = await proc;
    removeTeeListeners?.();
    logStream?.end();

    if (interrupted) return { exitCode: 130 };
    if (result.failed && result.exitCode === undefined && result.cause) {
      throw new SpawnError(cmd, result.cause);
    }
    return { exitCode: result.exitCode ?? 1 };
  } catch (err: unknown) {
    removeTeeListeners?.();
    logStream?.end();
    if (interrupted) return { exitCode: 130 };
    if (err instanceof SpawnError) throw err;
    throw new SpawnError(cmd, err);
  } finally {
    process.off('SIGINT', sigintHandler);
  }
}
