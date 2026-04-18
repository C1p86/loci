// src/executor/single.ts
//
// Single command execution via execa with shell:false (T-04-01, EXE-01, EXE-02).
// Handles SIGINT to kill child processes and waits until they exit.

import { execSync } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';
import { execa, type ResultPromise } from 'execa';
import { SpawnError } from '../errors.js';
import type { ExecutionResult } from '../types.js';

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
      try { execSync(`taskkill /f /t /pid ${pid}`, { stdio: 'pipe' }); } catch { /* */ }
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

  let logStream: WriteStream | undefined;
  if (logFile) logStream = createWriteStream(logFile, { flags: 'a' });

  const proc = execa(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
  });

  let interrupted = false;
  const sigintHandler = async () => {
    interrupted = true;
    await killAndWait(proc);
  };
  process.on('SIGINT', sigintHandler);

  try {
    const result = await proc;

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
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

  let logStream: WriteStream | undefined;
  if (logFile) logStream = createWriteStream(logFile, { flags: 'a' });

  // Use inherit only when showing full output with no log file and no tail
  const useInherit = !logFile && showOutput && !tailLines;
  const isTail = tailLines !== undefined && tailLines > 0;

  const proc = execa(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: useInherit ? 'inherit' : 'pipe',
    stderr: useInherit ? 'inherit' : 'pipe',
    reject: false,
  });

  // Real-time tail: keep last N lines and redraw them on each update
  const tailBuffer: string[] = [];
  let tailLinesDrawn = 0;

  function redrawTail(): void {
    if (!isTail) return;
    const cols = (process.stderr as { columns?: number }).columns ?? 120;

    // Erase previous tail lines
    if (tailLinesDrawn > 0) {
      for (let i = 0; i < tailLinesDrawn; i++) {
        process.stderr.write('\x1b[A\x1b[2K'); // move up + clear line
      }
    }

    // Draw last N lines — preserve original colors from the process output
    const visible = tailBuffer.slice(-tailLines);
    tailLinesDrawn = visible.length;
    for (const line of visible) {
      // Truncate by visible length but keep ANSI codes intact
      const stripped = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      const truncated = stripped.length > cols - 4 ? line.slice(0, cols - 5) + '\x1b[0m…' : line;
      process.stderr.write(`  | ${truncated}\x1b[0m\n`);
    }
  }

  function appendTailLine(text: string): void {
    for (const line of text.split('\n')) {
      // Strip control chars but keep ANSI color codes intact
      const cleaned = line.replace(/\r/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1a]/g, '');
      if (cleaned.length > 0) tailBuffer.push(cleaned);
    }
    redrawTail();
  }

  if (!useInherit) {
    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (logStream) logStream.write(text);
      if (showOutput) process.stdout.write(text);
      if (isTail) appendTailLine(text);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (logStream) logStream.write(text);
      if (showOutput) process.stderr.write(text);
      if (isTail) appendTailLine(text);
    });
  }

  let interrupted = false;
  const sigintHandler = async () => {
    interrupted = true;
    await killAndWait(proc);
  };
  process.on('SIGINT', sigintHandler);

  try {
    const result = await proc;
    logStream?.end();

    if (interrupted) return { exitCode: 130 };
    if (result.failed && result.exitCode === undefined && result.cause) {
      throw new SpawnError(cmd, result.cause);
    }
    return { exitCode: result.exitCode ?? 1 };
  } catch (err: unknown) {
    logStream?.end();
    if (interrupted) return { exitCode: 130 };
    if (err instanceof SpawnError) throw err;
    throw new SpawnError(cmd, err);
  } finally {
    process.off('SIGINT', sigintHandler);
  }
}
