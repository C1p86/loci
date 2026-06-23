// src/executor/tee.ts
//
// Shared tee helper — attaches piped stdout/stderr data handlers that write
// to a log file, the terminal (when showOutput), and the real-time tail
// buffer (when tailLines is set and not nested).
//
// Used by both runSingle and runXciDelegate so the logic lives in one place.

import type { WriteStream } from 'node:fs';
import { isNested } from './nesting.js';

/**
 * Attach 'data' handlers on stdout/stderr EventEmitter streams.
 * Each chunk is:
 *   a) written to logStream (if provided)
 *   b) written to process.stdout/stderr (if showOutput is true)
 *   c) fed to the tail buffer + cursor-up/erase redraw (if tail is active)
 *
 * Tail redraw is disabled when isNested() to honour attenuation rules.
 * Returns a cleanup function that removes the listeners.
 */
export function attachTee(
  stdout: NodeJS.EventEmitter | null | undefined,
  stderr: NodeJS.EventEmitter | null | undefined,
  logStream: WriteStream | undefined,
  showOutput: boolean,
  tailLines?: number,
): () => void {
  // Disable real-time tail cursor-move redraws when nested (attenuation rule).
  const isTail = tailLines !== undefined && tailLines > 0 && !isNested();

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
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape stripping
      const stripped = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      const truncated = stripped.length > cols - 4 ? `${line.slice(0, cols - 5)}\x1b[0m…` : line;
      process.stderr.write(`  | ${truncated}\x1b[0m\n`);
    }
  }

  function appendTailLine(text: string): void {
    for (const line of text.split('\n')) {
      // Strip control chars but keep ANSI color codes intact
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control-char stripping
      const cleaned = line.replace(/\r/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1a]/g, '');
      if (cleaned.length > 0) tailBuffer.push(cleaned);
    }
    redrawTail();
  }

  const onStdoutData = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    if (logStream) logStream.write(text);
    if (showOutput) process.stdout.write(text);
    if (isTail) appendTailLine(text);
  };

  const onStderrData = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    if (logStream) logStream.write(text);
    if (showOutput) process.stderr.write(text);
    if (isTail) appendTailLine(text);
  };

  if (stdout) stdout.on('data', onStdoutData);
  if (stderr) stderr.on('data', onStderrData);

  return () => {
    if (stdout) stdout.off('data', onStdoutData);
    if (stderr) stderr.off('data', onStderrData);
  };
}
