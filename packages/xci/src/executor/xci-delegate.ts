// src/executor/xci-delegate.ts
//
// Delegate execution to another xci instance in a target project directory.
// Uses stdio:'inherit' so the parent waits only on process exit (no pipe/stream-EOF hang).
// Sets XCI_NESTING_DEPTH so the inner xci attenuates its output.

import { execSync } from 'node:child_process';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ResultPromise } from 'execa';
import type { ExecutionResult } from '../types.js';
import { assertCwdExists } from './cwd.js';
import { getNestingDepth, XCI_NESTING_DEPTH_ENV } from './nesting.js';

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
 */
export function buildDelegateInvocation(
  fields: XciDelegateFields,
  effectiveCwd: string,
  env: Record<string, string>,
  entryScript: string,
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

  // Build argv: [entryScript, alias, ...args]
  const argv: string[] = [entryScript, fields.alias, ...(fields.args ?? [])];

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
 * Kill a child process tree and wait for it to exit.
 * On Windows: uses `taskkill /f /t /pid` to kill entire process tree.
 * On Unix: sends SIGTERM, then SIGKILL after timeout.
 */
async function killAndWait(proc: ResultPromise): Promise<void> {
  process.stderr.write('\n[xci] Stopping child process...\n');
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
 * Spawn the xci binary in the target project directory with stdio:'inherit'.
 * The parent process waits only on process exit — no pipe/stream-EOF hang.
 *
 * @param fields       - Delegate fields (alias, project, args, cwd)
 * @param effectiveCwd - Fallback cwd when fields.project is absent
 * @param env          - Environment variables to pass to the child
 * @param entryScript  - Path to xci entry script (default: process.argv[1])
 * @param spawnFn      - Injectable spawn function for testing (default: execa)
 */
export async function runXciDelegate(
  fields: XciDelegateFields,
  effectiveCwd: string,
  env: Record<string, string>,
  entryScript = process.argv[1] ?? '',
  spawnFn?: (
    execPath: string,
    argv: string[],
    opts: object,
  ) => Promise<{ exitCode: number | null | undefined }>,
): Promise<ExecutionResult> {
  // Soft cap: depth >= 32 prevents runaway nesting from misconfigured aliases
  const currentDepth = getNestingDepth();
  if (currentDepth >= MAX_NESTING_DEPTH) {
    process.stderr.write(
      `[xci] error: XCI_NESTING_DEPTH (${currentDepth}) >= ${MAX_NESTING_DEPTH} — aborting to prevent runaway nesting.\n`,
    );
    return { exitCode: 1 };
  }

  const invocation = buildDelegateInvocation(fields, effectiveCwd, env, entryScript);
  assertCwdExists(invocation.cwd);

  // Use the injected spawnFn in tests; default to execa in production
  if (spawnFn !== undefined) {
    const result = await spawnFn(invocation.execPath, invocation.argv, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      stdio: 'inherit' as const,
      reject: false,
    });
    return { exitCode: result.exitCode ?? 1 };
  }

  // Production path: use execa with inherit stdio.
  // invocation.argv = [entryScript, alias, ...args] — pass all of it to Node.
  const { execa } = await import('execa');
  const proc = execa(invocation.execPath, invocation.argv, {
    cwd: invocation.cwd,
    env: { ...process.env, ...invocation.env },
    stdio: 'inherit',
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
    if (interrupted) return { exitCode: 130 };
    return { exitCode: (result as { exitCode?: number | null }).exitCode ?? 1 };
  } catch {
    if (interrupted) return { exitCode: 130 };
    return { exitCode: 1 };
  } finally {
    process.off('SIGINT', sigintHandler);
  }
}
