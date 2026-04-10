// src/__tests__/cli.e2e.test.ts
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const CLI = resolve(process.cwd(), 'dist/cli.mjs');

function runCli(args: readonly string[]): { stdout: string; stderr: string; code: number } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    // Inherit stdin only; stdout/stderr captured
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    code: result.status ?? -1,
  };
}

describe('loci CLI (E2E via spawnSync on dist/cli.mjs)', () => {
  beforeAll(() => {
    // Guard: the bundle must exist before E2E tests run.
    // CI orders `build → test`, but locally `npm test` alone will fail here if dist/ is stale.
    if (!existsSync(CLI)) {
      throw new Error(
        `dist/cli.mjs is missing. Run \`npm run build\` before \`npm test\`. Expected at: ${CLI}`,
      );
    }
  });

  it('--version prints semver and exits 0', () => {
    const { stdout, code } = runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    // For Phase 1 specifically:
    expect(stdout.trim()).toBe('0.0.0');
  });

  it('-V short flag also prints version', () => {
    const { stdout, code } = runCli(['-V']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe('0.0.0');
  });

  it('--help prints usage and exits 0', () => {
    const { stdout, code } = runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: loci');
  });

  it('-h short flag also prints help', () => {
    const { stdout, code } = runCli(['-h']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: loci');
  });

  it('no args prints help + phase-1 hint and exits 0', () => {
    const { stdout, code } = runCli([]);
    expect(code).toBe(0);
    expect(stdout).toContain('no aliases defined yet');
    expect(stdout).toContain('.loci/commands.yml');
  });

  it('unknown flag exits with code 50 (CliError range, D-02)', () => {
    const { code, stderr } = runCli(['--bogus']);
    expect(code).toBe(50);
    expect(stderr).toContain('CLI_UNKNOWN_FLAG');
  });

  it('the bundle has the shebang as the literal first line', async () => {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(CLI, 'utf8');
    expect(content.slice(0, 19)).toBe('#!/usr/bin/env node');
  });

  it('the bundle does not contain the __LOCI_VERSION__ literal (tsup define replaced it)', async () => {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(CLI, 'utf8');
    expect(content).not.toContain('__LOCI_VERSION__');
  });
});
