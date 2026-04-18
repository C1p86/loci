// src/executor/parallel.ts
//
// Parallel group execution with AbortController cancellation (T-04-04, T-04-05, EXE-05).

import { createWriteStream } from 'node:fs';
import { execa } from 'execa';
import { SpawnError } from '../errors.js';
import type { ExecutionResult } from '../types.js';
import { makeLineTransform, printParallelSummary } from './output.js';

type SettledResult = { exitCode: number; canceled: boolean };

/**
 * Run a group of commands concurrently with prefixed output (D-01 to D-05).
 *
 * failMode 'fast': on first failure, abort remaining children via AbortController (D-12).
 * failMode 'complete': let all commands finish, return first non-zero exit code.
 *
 * Uses forceKillAfterDelay: 3000 to SIGKILL after 3s if children don't exit on SIGTERM (D-13).
 * Registers a SIGINT handler to abort all children on Ctrl+C (T-04-05, D-14).
 * Prints a summary of results to stderr after completion (D-09).
 */
export async function runParallel(
  group: readonly { readonly alias: string; readonly argv: readonly string[] }[],
  failMode: 'fast' | 'complete',
  cwd: string,
  env: Record<string, string>,
  logFile?: string,
  showOutput = true,
): Promise<ExecutionResult> {
  const controller = new AbortController();
  const { signal } = controller;

  let wasInterrupted = false;
  const sigintHandler = () => {
    wasInterrupted = true;
    controller.abort(new Error('SIGINT'));
  };
  process.on('SIGINT', sigintHandler);

  const mergedEnv = { ...process.env, ...env };
  const logStream = logFile ? createWriteStream(logFile, { flags: 'a' }) : undefined;

  // For failMode 'fast', wrap each promise so that on failure it immediately aborts the rest.
  const rawPromises = group.map(({ alias, argv }) => {
    const [cmd, ...args] = argv;
    if (!cmd) {
      return Promise.reject(new SpawnError('(empty command)', new Error('argv is empty')));
    }

    // Build stdout/stderr destination based on showOutput
    const stdoutDest: unknown[] = [];
    const stderrDest: unknown[] = [];
    if (showOutput) {
      stdoutDest.push(makeLineTransform(alias), 'inherit');
      stderrDest.push(makeLineTransform(alias), 'inherit');
    }

    return execa(cmd, args, {
      cwd,
      env: mergedEnv,
      stdout: stdoutDest.length > 0 ? stdoutDest : 'pipe',
      stderr: stderrDest.length > 0 ? stderrDest : 'pipe',
      cancelSignal: signal,
      forceKillAfterDelay: 3000,
      reject: false,
    }).then((value) => {
      // Write to log file if present
      if (logStream) {
        const out = value.stdout ?? '';
        const err = value.stderr ?? '';
        if (out) logStream.write(`[${alias}] ${out}\n`);
        if (err) logStream.write(`[${alias}] ${err}\n`);
      }
      const isCanceled = value.isCanceled === true;
      const code = isCanceled ? 0 : (value.exitCode ?? 0);

      if (!isCanceled && code !== 0 && failMode === 'fast') {
        // Abort all remaining processes immediately
        controller.abort(new Error('fail-fast'));
      }

      return { exitCode: code, canceled: isCanceled };
    });
  });

  // Track first failure code across all promises for 'fast' mode
  let firstFailCode = 0;

  let settled: PromiseSettledResult<{ exitCode: number; canceled: boolean }>[];
  try {
    settled = await Promise.allSettled(rawPromises);
  } finally {
    process.off('SIGINT', sigintHandler);
  }

  if (wasInterrupted) {
    printParallelSummary(
      group,
      group.map(() => ({ exitCode: 130, canceled: true })),
    );
    return { exitCode: 130 };
  }

  const finalResults: SettledResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (!result) continue;

    if (result.status === 'fulfilled') {
      finalResults.push(result.value);
      if (result.value.exitCode !== 0 && firstFailCode === 0) {
        firstFailCode = result.value.exitCode;
      }
    } else {
      // Rejected (e.g. SpawnError from empty command)
      const reason = result.reason as { isCanceled?: boolean; exitCode?: number } | undefined;
      if (reason?.isCanceled) {
        finalResults.push({ exitCode: 0, canceled: true });
      } else {
        const code = reason?.exitCode ?? 1;
        finalResults.push({ exitCode: code, canceled: false });
        if (firstFailCode === 0) firstFailCode = code;
      }
    }
  }

  logStream?.end();
  printParallelSummary(group, finalResults);
  return { exitCode: firstFailCode };
}
