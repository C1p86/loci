// src/executor/__tests__/unreadonly.test.ts
//
// Unit tests for removeReadonly (executor/unreadonly.ts).
//
// On Windows, Node.js emulates POSIX mode bits for file permission operations.
// The owner-write-bit assertion `(statSync(p).mode & 0o200) !== 0` is the
// cross-platform-portable check for writability after a chmod call.

import { chmodSync, mkdtempSync, mkdirSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeReadonly } from '../unreadonly.js';

// ---------------------------------------------------------------------------
// Temp dir cleanup
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  // Restore write permissions before cleanup so rmSync can remove readonly files.
  for (const dir of tempDirs) {
    try {
      // Best-effort: make everything writable so rmSync can delete on Windows too.
      chmodSync(dir, 0o777);
    } catch {
      /* ignore */
    }
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp dir, register it for cleanup, and return its path. */
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xci-unreadonly-test-'));
  tempDirs.push(dir);
  return dir;
}

/** Assert that the owner-write bit is set (file is writable). */
function isOwnerWritable(p: string): boolean {
  return (statSync(p).mode & 0o200) !== 0;
}

// ---------------------------------------------------------------------------
// removeReadonly — file target
// ---------------------------------------------------------------------------

describe('removeReadonly — file target', () => {
  it('makes a readonly file writable (chmod 0o666)', () => {
    const dir = makeTempDir();
    const file = join(dir, 'test.txt');
    writeFileSync(file, 'hello');
    chmodSync(file, 0o444); // make readonly

    removeReadonly(file, false);

    expect(isOwnerWritable(file)).toBe(true);
  });

  it('is idempotent: calling on an already-writable file does not throw', () => {
    const dir = makeTempDir();
    const file = join(dir, 'test.txt');
    writeFileSync(file, 'hello');
    // file starts writable by default

    expect(() => removeReadonly(file, false)).not.toThrow();
    expect(isOwnerWritable(file)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeReadonly — directory target, non-recursive
// ---------------------------------------------------------------------------

describe('removeReadonly — directory target, non-recursive', () => {
  it('makes the directory itself writable but does NOT touch nested files', () => {
    const dir = makeTempDir();
    const nestedFile = join(dir, 'nested.txt');
    writeFileSync(nestedFile, 'content');
    chmodSync(nestedFile, 0o444); // make nested file readonly
    chmodSync(dir, 0o555); // make the directory itself readonly

    removeReadonly(dir, /* recursive= */ false);

    // Directory should be writable now
    expect(isOwnerWritable(dir)).toBe(true);
    // Nested file must remain readonly (non-recursive mode)
    expect(isOwnerWritable(nestedFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// removeReadonly — directory target, recursive
// ---------------------------------------------------------------------------

describe('removeReadonly — directory target, recursive', () => {
  it('clears readonly on the directory AND all nested files', () => {
    const dir = makeTempDir();
    const subDir = join(dir, 'sub');
    mkdirSync(subDir);
    const fileA = join(dir, 'a.txt');
    const fileB = join(subDir, 'b.txt');
    writeFileSync(fileA, 'a');
    writeFileSync(fileB, 'b');
    chmodSync(fileA, 0o444);
    chmodSync(fileB, 0o444);
    chmodSync(subDir, 0o555);
    chmodSync(dir, 0o555);

    removeReadonly(dir, /* recursive= */ true);

    expect(isOwnerWritable(dir)).toBe(true);
    expect(isOwnerWritable(subDir)).toBe(true);
    expect(isOwnerWritable(fileA)).toBe(true);
    expect(isOwnerWritable(fileB)).toBe(true);
  });

  it('handles an empty directory without throwing', () => {
    const dir = makeTempDir();
    chmodSync(dir, 0o555);
    expect(() => removeReadonly(dir, true)).not.toThrow();
    expect(isOwnerWritable(dir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeReadonly — non-existent path
// ---------------------------------------------------------------------------

describe('removeReadonly — non-existent path', () => {
  it('throws an error when the path does not exist (ENOENT)', () => {
    const dir = makeTempDir();
    const missing = join(dir, 'does-not-exist.txt');
    expect(() => removeReadonly(missing, false)).toThrow();
  });

  it('thrown error message contains useful information about the missing path', () => {
    const dir = makeTempDir();
    const missing = join(dir, 'ghost.txt');
    try {
      removeReadonly(missing, false);
      expect.fail('should have thrown');
    } catch (err) {
      // The error message from statSync (ENOENT) should mention the path or ENOENT.
      const msg = (err as Error).message;
      expect(msg).toMatch(/ENOENT|no such file/i);
    }
  });
});
