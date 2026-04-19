// packages/xci/src/agent/runner.ts
// Agent-side task runner using execa. Spawns a single command, streams
// stdout/stderr as log_chunk callbacks, sends SIGTERM/SIGKILL on cancel.
//
// Supports single-command dispatch only (Phase 10). Sequential/parallel
// dispatch is deferred to a future phase once log_chunk storage (Phase 11)
// is mature enough to handle multi-step streaming correctly.

import { execSync } from 'node:child_process';
import { execa } from 'execa';

export interface RunnerOptions {
  argv: readonly string[];
  cwd: string;
  env: Record<string, string>;
  /** Called for each stdout/stderr chunk during process execution. */
  onChunk: (stream: 'stdout' | 'stderr', data: string, seq: number) => void;
  /**
   * Called exactly once when the process exits (naturally or via cancel).
   * `cancelled` is true when RunHandle.cancel() was called before exit.
   */
  onExit: (exitCode: number, durationMs: number, cancelled: boolean) => void;
}

export interface RunHandle {
  runId: string;
  /** Whether cancel() has been called. Set before kill; checked by onExit. */
  cancelled: boolean;
  /**
   * Send SIGTERM to the child, then SIGKILL after 5s if still running.
   * Resolves when the process has actually exited.
   * Pattern from executor/single.ts killAndWait.
   */
  cancel: () => Promise<void>;
}

// Windows detection — captured once at module load (same pattern as executor/single.ts)
const IS_WINDOWS = process.platform === 'win32';
const FORCE_KILL_DELAY_MS = 5_000;

export function spawnTask(runId: string, opts: RunnerOptions): RunHandle {
  const [cmd, ...args] = opts.argv;
  if (!cmd) throw new Error('spawnTask: empty argv');

  const startTime = Date.now();
  let seq = 0;

  const proc = execa(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
  });

  // Build the handle first so onExit can read handle.cancelled
  const handle: RunHandle = {
    runId,
    cancelled: false,
    async cancel(): Promise<void> {
      handle.cancelled = true;
      const pid = proc.pid;

      // Pattern from executor/single.ts killAndWait
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
        if (IS_WINDOWS && pid) {
          try {
            execSync(`taskkill /f /t /pid ${pid}`, { stdio: 'pipe' });
          } catch {
            /* already gone */
          }
        } else {
          proc.kill('SIGKILL');
        }
      }, FORCE_KILL_DELAY_MS);

      try {
        await proc;
      } catch {
        // Expected — killed process rejects
      } finally {
        clearTimeout(forceKillTimer);
      }
    },
  };

  proc.stdout?.on('data', (chunk: Buffer) => {
    opts.onChunk('stdout', chunk.toString('utf8'), seq++);
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    opts.onChunk('stderr', chunk.toString('utf8'), seq++);
  });

  void proc.then((result) => {
    opts.onExit(result.exitCode ?? 1, Date.now() - startTime, handle.cancelled);
  });

  return handle;
}
