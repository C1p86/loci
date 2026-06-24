// src/executor/unreadonly.ts
//
// Removes the readonly file-system attribute from a file or directory for the
// `unreadonly` command kind.
//
// Cross-platform chmod semantics:
//   - File target:     chmodSync(path, 0o666) — sets owner+group+other read+write
//   - Directory target: chmodSync(path, 0o777) — sets full rwx so the directory is
//     itself modifiable. On Windows, Node.js emulates POSIX mode bits; clearing the
//     readonly flag (bit 0o200) is the effective operation on all platforms.
//
// No new runtime dependencies — only node:fs and node:path (cold-start budget).

import { chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Walk a directory and apply chmod recursively to all entries.
 * Does NOT follow symbolic links into other trees — entries whose
 * `isSymbolicLink()` returns true have chmod applied to their own path
 * (as yielded by readdirSync) but are NOT recursed into.
 */
function walkAndChmod(dir: string): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      // Apply chmod to the symlink target path but do NOT recurse through it.
      chmodSync(entryPath, 0o666);
    } else if (entry.isDirectory()) {
      chmodSync(entryPath, 0o777);
      walkAndChmod(entryPath);
    } else {
      chmodSync(entryPath, 0o666);
    }
  }
}

/**
 * Remove the readonly file-system attribute from `targetPath`.
 *
 * - File: chmod 0o666 (clears readonly on Windows + POSIX)
 * - Directory: chmod 0o777 on the directory itself. When `recursive` is true,
 *   walks all descendants and clears readonly on each (files: 0o666, dirs: 0o777).
 *   Symbolic link entries are chmod'd but not recursed through.
 *
 * Throws if `targetPath` does not exist or is not readable — callers catch and
 * print `error: <message>`, mirroring the uproject executor's try/catch pattern.
 */
export function removeReadonly(targetPath: string, recursive: boolean): void {
  const stat = statSync(targetPath); // throws ENOENT if path does not exist

  if (stat.isDirectory()) {
    chmodSync(targetPath, 0o777);
    if (recursive) {
      walkAndChmod(targetPath);
    }
  } else {
    chmodSync(targetPath, 0o666);
  }
}
