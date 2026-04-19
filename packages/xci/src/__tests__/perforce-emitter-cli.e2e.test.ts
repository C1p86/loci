// packages/xci/src/__tests__/perforce-emitter-cli.e2e.test.ts
// Plan 12-05 Task 2 — E2E tests for `xci agent-emit-perforce-trigger` CLI subcommand.
//
// Spawns the built dist/cli.mjs binary and asserts:
//   - exit code 0
//   - 3 files written to output dir
//   - stdout mentions "Generated 3" and lists filenames
//   - stdout includes security warning
//   - trigger.sh starts with #!/bin/sh
//   - token with invalid chars exits with error
//
// Requires: npm run build (done by CI before test:unit; also done locally if dist/ exists).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const xciDistCli = resolve(process.cwd(), 'dist/cli.mjs');

// Skip all tests if dist/cli.mjs doesn't exist (build hasn't been run yet)
describe.runIf(existsSync(xciDistCli))('xci agent-emit-perforce-trigger CLI E2E', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'xci-p4-cli-e2e-'));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
    const result = spawnSync(process.execPath, [xciDistCli, ...args], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      cwd: tmpdir(), // run from a dir without .xci/ so it uses the no-root path
    });
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      code: result.status ?? -1,
    };
  }

  it('exits 0 and generates 3 files', () => {
    const outDir = join(tmpDir, 'scripts');
    const r = runCli([
      'agent-emit-perforce-trigger',
      'https://xci.example.com/hooks/perforce/xci_whk_abc',
      'tok_xyz123',
      '--output',
      outDir,
    ]);

    expect(r.code).toBe(0);
    expect(existsSync(join(outDir, 'trigger.sh'))).toBe(true);
    expect(existsSync(join(outDir, 'trigger.bat'))).toBe(true);
    expect(existsSync(join(outDir, 'trigger.ps1'))).toBe(true);
  });

  it('stdout mentions "Generated 3"', () => {
    const outDir = join(tmpDir, 'scripts2');
    const r = runCli([
      'agent-emit-perforce-trigger',
      'https://xci.example.com/hooks/perforce/xci_whk_abc',
      'tok_xyz123',
      '--output',
      outDir,
    ]);
    expect(r.stdout).toContain('Generated 3');
  });

  it('stdout lists all 3 filenames', () => {
    const outDir = join(tmpDir, 'scripts3');
    const r = runCli([
      'agent-emit-perforce-trigger',
      'https://xci.example.com/hooks/perforce/xci_whk_abc',
      'tok_xyz123',
      '--output',
      outDir,
    ]);
    expect(r.stdout).toContain('trigger.sh');
    expect(r.stdout).toContain('trigger.bat');
    expect(r.stdout).toContain('trigger.ps1');
  });

  it('stdout includes security warning', () => {
    const outDir = join(tmpDir, 'scripts4');
    const r = runCli([
      'agent-emit-perforce-trigger',
      'https://xci.example.com/hooks/perforce/xci_whk_abc',
      'tok_xyz123',
      '--output',
      outDir,
    ]);
    expect(r.stdout).toContain('SECURITY');
  });

  it('trigger.sh starts with #!/bin/sh', () => {
    const outDir = join(tmpDir, 'scripts5');
    runCli([
      'agent-emit-perforce-trigger',
      'https://xci.example.com/hooks/perforce/xci_whk_abc',
      'tok_xyz123',
      '--output',
      outDir,
    ]);
    const sh = readFileSync(join(outDir, 'trigger.sh'), 'utf8');
    expect(sh.split('\n')[0]).toBe('#!/bin/sh');
  });

  it('trigger.sh contains the token and URL', () => {
    const outDir = join(tmpDir, 'scripts6');
    runCli([
      'agent-emit-perforce-trigger',
      'https://xci.example.com/hooks/perforce/xci_whk_abc',
      'tok_xyz123',
      '--output',
      outDir,
    ]);
    const sh = readFileSync(join(outDir, 'trigger.sh'), 'utf8');
    expect(sh).toContain('xci.example.com');
    expect(sh).toContain('tok_xyz123');
    expect(sh).toContain('X-Xci-Token');
  });

  it('uses default output dir "." when --output not specified', () => {
    // Run from tmpDir as CWD so default output lands there
    const result = spawnSync(
      process.execPath,
      [
        xciDistCli,
        'agent-emit-perforce-trigger',
        'https://xci.example.com/hooks/perforce/xci_whk_abc',
        'tok_xyz123',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        cwd: tmpDir,
      }
    );
    expect(result.status).toBe(0);
    expect(existsSync(join(tmpDir, 'trigger.sh'))).toBe(true);
  });

  it('exits non-zero for token with shell-unsafe character', () => {
    const outDir = join(tmpDir, 'scripts7');
    const r = runCli([
      'agent-emit-perforce-trigger',
      'https://xci.example.com/hooks/perforce/xci_whk_abc',
      'bad"token',
      '--output',
      outDir,
    ]);
    // Should exit non-zero (process.exitCode = 1 via catch block)
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('InvalidTokenFormatError');
  });

  it('stderr is empty on success (security warning goes to stdout)', () => {
    const outDir = join(tmpDir, 'scripts8');
    const r = runCli([
      'agent-emit-perforce-trigger',
      'https://xci.example.com/hooks/perforce/xci_whk_abc',
      'tok_xyz123',
      '--output',
      outDir,
    ]);
    expect(r.code).toBe(0);
    // Security warning and file list go to stdout, not stderr
    expect(r.stderr).toBe('');
  });
});
