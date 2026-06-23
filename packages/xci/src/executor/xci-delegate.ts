// src/executor/xci-delegate.ts
//
// Delegate execution to another xci instance in a target project directory.
// Spawns with piped stdout/stderr (stdin inherited) and resolves on child
// process exit — not on stream close — to prevent hangs from background
// grandchildren holding the pipe write-end open.

import { execSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ExecutionResult } from '../types.js';
import { assertCwdExists } from './cwd.js';
import { getNestingDepth, XCI_NESTING_DEPTH_ENV } from './nesting.js';
import { attachTee } from './tee.js';

const IS_WINDOWS = process.platform === 'win32';
const MAX_NESTING_DEPTH = 32;
const FORCE_KILL_DELAY = 5000;

/**
 * Fields from an xci plan/step needed to build the delegate invocation.
 */
export interface XciDelegateFields {
  readonly alias: string;
  readonly project?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
}

/**
 * The resolved invocation parameters for the delegate spawn.
 * Pure — no side effects, testable without spawning.
 */
export interface DelegateInvocation {
  readonly execPath: string;
  readonly argv: string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
}

/**
 * PURE helper: build the spawn parameters for a delegate invocation.
 * Does NOT spawn — used for testing.
 *
 * @param fields       - Delegate fields from the ExecutionPlan or SequentialStep
 * @param effectiveCwd - Fallback cwd (project root) when fields.project is absent
 * @param env          - Current environment variables
 * @param entryScript  - Path to the xci entry script (process.argv[1] in production)
 * @param outputFlag   - '--log' or '--verbose'; forwarded to inner so it streams output
 */
export function buildDelegateInvocation(
  fields: XciDelegateFields,
  effectiveCwd: string,
  env: Record<string, string>,
  entryScript: string,
  outputFlag: '--log' | '--verbose',
): DelegateInvocation {
  // Resolve spawn cwd: absolute project wins, then fields.cwd, then effectiveCwd.
  const rawProject = fields.project;
  let spawnCwd: string;
  if (rawProject !== undefined) {
    spawnCwd = isAbsolute(rawProject) ? rawProject : resolvePath(effectiveCwd, rawProject);
  } else if (fields.cwd !== undefined) {
    spawnCwd = fields.cwd;
  } else {
    spawnCwd = effectiveCwd;
  }

  // Build argv: [entryScript, alias, ...args, outputFlag]
  // outputFlag is a literal '--log' or '--verbose' — never an arg value (secret-safe)
  const argv: string[] = [entryScript, fields.alias, ...(fields.args ?? []), outputFlag];

  // Set XCI_NESTING_DEPTH = parent depth + 1
  const childDepth = getNestingDepth() + 1;
  const childEnv: Record<string, string> = {
    ...env,
    [XCI_NESTING_DEPTH_ENV]: String(childDepth),
  };

  return {
    execPath: process.execPath,
    argv,
    cwd: spawnCwd,
    env: childEnv,
  };
}

/**
 * Kill a delegate child process and wait for it to exit using the 'exit' event
 * (not stream EOF). Tears down piped stdout/stderr FIRST so a leaked background
 * grandchild holding the pipe write-end cannot cause a hang.
 *
 * On Windows: uses `taskkill /f /t /pid` to kill entire process tree.
 * On Unix: sends SIGTERM, then SIGKILL after timeout.
 */
async function killDelegateAndWait(
  proc: {
    pid?: number;
    kill: (signal?: string) => void;
    stdout?: { destroy: () => void; unref: () => void } | null;
    stderr?: { destroy: () => void; unref: () => void } | null;
  },
  removeTeeListeners: () => void,
): Promise<void> {
  process.stderr.write('\n[xci] Stopping child process...\n');

  // Tear down piped streams BEFORE killing so a leaked grandchild holding the
  // pipe write-end cannot keep the parent blocked on stream drain.
  removeTeeListeners();
  try {
    proc.stdout?.destroy();
    proc.stdout?.unref();
  } catch {
    /* ignore */
  }
  try {
    proc.stderr?.destroy();
    proc.stderr?.unref();
  } catch {
    /* ignore */
  }

  const pid = proc.pid;

  if (IS_WINDOWS && pid) {
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

  // Wait on the 'exit' event — NOT on stream close — so a leaked grandchild
  // holding the pipe write-end cannot keep us waiting.
  await new Promise<void>((resolve) => {
    (proc as unknown as NodeJS.EventEmitter).once('exit', () => {
      clearTimeout(forceKillTimer);
      resolve();
    });
  });

  process.stderr.write('[xci] Child process terminated.\n');
}

/**
 * Spawn the xci binary in the target project directory.
 * Pipes stdout/stderr (stdin inherited) and resolves on child process EXIT
 * (not stream close) — so a leaked background grandchild holding the pipe
 * cannot cause a hang on either normal completion or the SIGINT interrupt path.
 *
 * @param fields       - Delegate fields (alias, project, args, cwd)
 * @param effectiveCwd - Fallback cwd when fields.project is absent
 * @param env          - Environment variables to pass to the child
 * @param entryScript  - Path to xci entry script (default: process.argv[1])
 * @param logFile      - Path to append output to (outer project's log file)
 * @param showOutput   - Whether to stream child output to the outer terminal
 * @param tailLines    - Number of tail lines to redraw (undefined = no tail)
 * @param verbose      - When true, forwards --verbose to inner; else --log
 * @param spawnFn      - Injectable spawn function for testing (default: execa)
 */
export async function runXciDelegate(
  fields: XciDelegateFields,
  effectiveCwd: string,
  env: Record<string, string>,
  entryScript = process.argv[1] ?? '',
  logFile?: string,
  showOutput = true,
  tailLines?: number,
  verbose = false,
  spawnFn?: (
    execPath: string,
    argv: string[],
    opts: object,
  ) => Promise<{
    exitCode: number | null | undefined;
    stdout?: NodeJS.EventEmitter;
    stderr?: NodeJS.EventEmitter;
  }>,
): Promise<ExecutionResult> {
  // Soft cap: depth >= 32 prevents runaway nesting from misconfigured aliases
  const currentDepth = getNestingDepth();
  if (currentDepth >= MAX_NESTING_DEPTH) {
    process.stderr.write(
      `[xci] error: XCI_NESTING_DEPTH (${currentDepth}) >= ${MAX_NESTING_DEPTH} — aborting to prevent runaway nesting.\n`,
    );
    return { exitCode: 1 };
  }

  // Pick output flag: '--verbose' when outer is verbose, else '--log' so inner streams.
  const outputFlag: '--log' | '--verbose' = verbose ? '--verbose' : '--log';

  const invocation = buildDelegateInvocation(fields, effectiveCwd, env, entryScript, outputFlag);
  assertCwdExists(invocation.cwd);

  // Open logStream for the outer project's log file (append, like runSingle)
  const logStream = logFile ? createWriteStream(logFile, { flags: 'a' }) : undefined;

  // Use the injected spawnFn in tests; default to execa in production
  if (spawnFn !== undefined) {
    const result = await spawnFn(invocation.execPath, invocation.argv, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
      stdin: 'inherit' as const,
      reject: false,
    });

    // Attach tee on the injected fake's stdout/stderr so unit tests can
    // assert tee-to-logFile and showOutput gating via real data-handler path.
    const removeFakeTee = attachTee(
      result.stdout ?? null,
      result.stderr ?? null,
      logStream,
      showOutput,
      tailLines,
    );

    // For the fake path the resolve comes from exitCode in the returned object.
    // We still need to wait a tick so any synchronously-emitted 'data' events
    // are processed before we remove listeners and end logStream.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    removeFakeTee();
    logStream?.end();

    return { exitCode: result.exitCode ?? 1 };
  }

  // Production path: use execa with piped stdout/stderr, stdin inherited.
  const { execa } = await import('execa');
  const proc = execa(invocation.execPath, invocation.argv, {
    cwd: invocation.cwd,
    env: { ...process.env, ...invocation.env },
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'inherit',
    reject: false,
  });

  // Attach tee: writes child output to logStream + terminal (showOutput-gated)
  const removeTeeListeners = attachTee(
    proc.stdout as NodeJS.EventEmitter | null | undefined,
    proc.stderr as NodeJS.EventEmitter | null | undefined,
    logStream,
    showOutput,
    tailLines,
  );

  let interrupted = false;

  const sigintHandler = () => {
    interrupted = true;
    // Tear down streams + kill on the SIGINT path — must NOT await proc here
    // because a leaked grandchild holding the pipe write-end would make stream
    // EOF (and thus await proc) never resolve. killDelegateAndWait resolves on
    // the child 'exit' event instead.
    void killDelegateAndWait(
      proc as unknown as {
        pid?: number;
        kill: (signal?: string) => void;
        stdout?: { destroy: () => void; unref: () => void } | null;
        stderr?: { destroy: () => void; unref: () => void } | null;
      },
      removeTeeListeners,
    );
  };
  process.on('SIGINT', sigintHandler);

  try {
    // ANTI-HANG: Resolve on the child process 'exit' event, NOT on execa's
    // stream-close promise. A background grandchild holding the pipe write-end
    // open makes stream-close never fire; the 'exit' event fires when the child
    // itself exits regardless of whether its grandchildren have closed the pipe.
    const exitCode = await new Promise<number>((resolve) => {
      (proc as unknown as NodeJS.EventEmitter).once('exit', (code: number | null) => {
        resolve(code ?? 1);
      });
    });

    // After child exits: remove data listeners and destroy/unref piped streams
    // so any background grandchild holding the pipe write-end cannot keep the
    // parent process alive.
    removeTeeListeners();
    try {
      (proc.stdout as unknown as { destroy?: () => void; unref?: () => void } | null)?.destroy?.();
      (proc.stdout as unknown as { destroy?: () => void; unref?: () => void } | null)?.unref?.();
    } catch {
      /* ignore */
    }
    try {
      (proc.stderr as unknown as { destroy?: () => void; unref?: () => void } | null)?.destroy?.();
      (proc.stderr as unknown as { destroy?: () => void; unref?: () => void } | null)?.unref?.();
    } catch {
      /* ignore */
    }
    logStream?.end();

    if (interrupted) return { exitCode: 130 };
    return { exitCode };
  } catch {
    removeTeeListeners();
    logStream?.end();
    if (interrupted) return { exitCode: 130 };
    return { exitCode: 1 };
  } finally {
    process.off('SIGINT', sigintHandler);
  }
}
