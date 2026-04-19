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
  /**
   * Agent-local secret values to redact from each chunk before emitting.
   * Values shorter than 4 chars are ignored (caller should pre-filter).
   * Sorted longest-first internally — caller passes unsorted.
   * Per D-08/D-24: applies ONLY to .xci/secrets.yml values; org-level
   * secrets are redacted server-side. No base64/URL/hex variants here.
   */
  redactionValues?: readonly string[];
  /** Called for each stdout/stderr chunk during process execution. */
  onChunk: (stream: 'stdout' | 'stderr', data: string, seq: number) => void;
  /**
   * Called exactly once when the process exits (naturally or via cancel).
   * `cancelled` is true when RunHandle.cancel() was called before exit.
   */
  onExit: (exitCode: number, durationMs: number, cancelled: boolean) => void;
}

/**
 * Redact secret values from a log line.
 * Values are applied longest-first (caller passes unsorted; caller must have
 * pre-sorted, or pass raw — this function sorts for correctness).
 * Returns the line unchanged if values is undefined or empty.
 *
 * Per D-08: agent scope only (agent-local .xci/secrets.yml values).
 * No base64/URL/hex variants — those are server-side (D-05).
 */
export function redactLine(line: string, values: readonly string[] | undefined): string {
  if (!values || values.length === 0) return line;
  // Sort longest-first to prevent partial replacements
  const sorted = [...values].sort((a, b) => b.length - a.length);
  let out = line;
  for (const v of sorted) {
    out = out.replaceAll(v, '***');
  }
  return out;
}

/** Maximum UTF-8 byte length for a single emitted chunk (D-03). */
const MAX_CHUNK_BYTES = 8192;

/**
 * Split a string into pieces each with UTF-8 byte length ≤ maxBytes.
 * Iterates over codepoints (for..of) so multi-byte UTF-8 codepoints are
 * never split mid-character.
 * Empty input returns [].
 */
export function splitChunk(data: string, maxBytes: number): string[] {
  if (data.length === 0) return [];
  if (Buffer.byteLength(data, 'utf8') <= maxBytes) return [data];
  const pieces: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of data) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (currentBytes + chBytes > maxBytes && current.length > 0) {
      pieces.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
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

  // Sort redaction values longest-first ONCE at setup — not per chunk (T-11-04-01)
  const sortedValues =
    opts.redactionValues && opts.redactionValues.length > 0
      ? [...opts.redactionValues].sort((a, b) => b.length - a.length)
      : undefined;

  function emitChunk(stream: 'stdout' | 'stderr', data: string): void {
    const redacted = redactLine(data, sortedValues);
    const pieces = splitChunk(redacted, MAX_CHUNK_BYTES);
    for (const piece of pieces) opts.onChunk(stream, piece, seq++);
  }

  proc.stdout?.on('data', (chunk: Buffer) => {
    emitChunk('stdout', chunk.toString('utf8'));
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    emitChunk('stderr', chunk.toString('utf8'));
  });

  void proc.then((result) => {
    opts.onExit(result.exitCode ?? 1, Date.now() - startTime, handle.cancelled);
  });

  return handle;
}
