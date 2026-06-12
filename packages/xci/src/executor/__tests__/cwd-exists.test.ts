// src/executor/__tests__/cwd-exists.test.ts
//
// Tests for assertCwdExists guard and CwdMissingError integration.
// quick-260612-lbn

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CwdMissingError, SpawnError } from '../../errors.js';
import { assertCwdExists } from '../cwd.js';
import { runSingle } from '../single.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'xci-cwd-exists-'));
});
afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* */
  }
});

/* ============================================================
 * Unit — assertCwdExists
 * ============================================================ */

describe('assertCwdExists — unit', () => {
  it('does not throw when cwd is undefined', () => {
    expect(() => assertCwdExists(undefined)).not.toThrow();
  });

  it('does not throw when cwd is empty string', () => {
    expect(() => assertCwdExists('')).not.toThrow();
  });

  it('does not throw when cwd is a valid existing directory', () => {
    expect(() => assertCwdExists(tmpDir)).not.toThrow();
  });

  it('throws CwdMissingError when cwd does not exist', () => {
    const missing = join(
      tmpdir(),
      `xci-does-not-exist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    expect(() => assertCwdExists(missing)).toThrow(CwdMissingError);
  });

  it('thrown CwdMissingError has code EXE_CWD_MISSING and contains the missing path', () => {
    const missing = join(
      tmpdir(),
      `xci-does-not-exist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    let err: unknown;
    try {
      assertCwdExists(missing);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CwdMissingError);
    const cwdErr = err as CwdMissingError;
    expect(cwdErr.code).toBe('EXE_CWD_MISSING');
    expect(cwdErr.category).toBe('executor');
    expect(cwdErr.message).toContain(missing);
    expect(cwdErr.path).toBe(missing);
  });

  it('throws CwdMissingError when cwd points to a file (not a directory)', () => {
    const filePath = join(tmpDir, 'notadir.txt');
    writeFileSync(filePath, 'hello');
    expect(() => assertCwdExists(filePath)).toThrow(CwdMissingError);
  });
});

/* ============================================================
 * runSingle integration — missing cwd → CwdMissingError, not SpawnError
 * ============================================================ */

describe('runSingle — missing cwd throws CwdMissingError', () => {
  it('throws CwdMissingError (not SpawnError) when cwd does not exist', async () => {
    const missing = join(
      tmpdir(),
      `xci-does-not-exist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await expect(
      runSingle([process.execPath, '-e', 'process.exit(0)'], missing, {}, undefined, false),
    ).rejects.toThrow(CwdMissingError);
  });

  it('the error for missing cwd is NOT a SpawnError', async () => {
    const missing = join(
      tmpdir(),
      `xci-does-not-exist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    let err: unknown;
    try {
      await runSingle([process.execPath, '-e', 'process.exit(0)'], missing, {}, undefined, false);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CwdMissingError);
    expect(err).not.toBeInstanceOf(SpawnError);
  });

  it('runs successfully with a valid existing cwd', async () => {
    const result = await runSingle(
      [process.execPath, '-e', 'process.exit(0)'],
      tmpDir,
      {},
      undefined,
      false,
    );
    expect(result.exitCode).toBe(0);
  });
});

/* ============================================================
 * Regression guard — valid cwd does NOT throw CwdMissingError
 * ============================================================ */

describe('runSingle — valid cwd never produces CwdMissingError', () => {
  it('does not throw CwdMissingError when exe exits non-zero with valid cwd', async () => {
    // Use process.execPath (always exists) with a non-zero exit — confirms cwd is not the issue.
    const result = await runSingle(
      [process.execPath, '-e', 'process.exit(5)'],
      tmpDir,
      {},
      undefined,
      false,
    );
    // Must NOT throw CwdMissingError — the cwd is valid, only the exit code is non-zero.
    expect(result.exitCode).toBe(5);
  });

  it('assertCwdExists passes for a valid cwd (unit regression guard)', () => {
    // Confirms cwd.ts guard is a no-op for existing dirs — SpawnError path is unaffected.
    expect(() => assertCwdExists(tmpDir)).not.toThrow();
  });
});
