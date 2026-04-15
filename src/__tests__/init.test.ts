// src/__tests__/init.test.ts
//
// Unit and E2E tests for the `loci init` subcommand.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from '../init/index.js';

const CLI = resolve(process.cwd(), 'dist/cli.mjs');

/* ------------------------------------------------------------------ */
/* Temp dir management                                                   */
/* ------------------------------------------------------------------ */

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'loci-init-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/* Unit tests — runInit()                                               */
/* ------------------------------------------------------------------ */

describe('runInit() — unit tests', () => {
  it('creates .loci directory and 4 expected files', () => {
    runInit(tmpDir);

    expect(existsSync(join(tmpDir, '.loci', 'config.yml'))).toBe(true);
    expect(existsSync(join(tmpDir, '.loci', 'commands.yml'))).toBe(true);
    expect(existsSync(join(tmpDir, '.loci', 'secrets.yml.example'))).toBe(true);
    expect(existsSync(join(tmpDir, '.loci', 'local.yml.example'))).toBe(true);
  });

  it('creates .gitignore with loci entries when no .gitignore exists', () => {
    runInit(tmpDir);

    const gitignorePath = join(tmpDir, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);

    const content = readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('# loci');
    expect(content).toContain('.loci/secrets.yml');
    expect(content).toContain('.loci/local.yml');
  });

  it('is idempotent — does not overwrite existing files', () => {
    // Pre-create .loci/config.yml with custom content
    mkdirSync(join(tmpDir, '.loci'), { recursive: true });
    writeFileSync(join(tmpDir, '.loci', 'config.yml'), 'custom content', 'utf8');

    runInit(tmpDir);

    const content = readFileSync(join(tmpDir, '.loci', 'config.yml'), 'utf8');
    expect(content).toBe('custom content');
  });

  it('skips .gitignore entries that are already present', () => {
    writeFileSync(
      join(tmpDir, '.gitignore'),
      '.loci/secrets.yml\n.loci/local.yml\n',
      'utf8',
    );

    runInit(tmpDir);

    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    const secretsLines = content.split('\n').filter((l) => l.trim() === '.loci/secrets.yml');
    expect(secretsLines.length).toBe(1);
  });

  it('appends loci entries to existing .gitignore that lacks them', () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules\n', 'utf8');

    runInit(tmpDir);

    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules');
    expect(content).toContain('.loci/secrets.yml');
    expect(content).toContain('.loci/local.yml');
  });

  it('works even when .loci/ directory does not yet exist', () => {
    // tmpDir has NO .loci subdirectory — verify it works
    expect(existsSync(join(tmpDir, '.loci'))).toBe(false);
    runInit(tmpDir);
    expect(existsSync(join(tmpDir, '.loci'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* E2E tests — `xci init` via CLI                                       */
/* ------------------------------------------------------------------ */

describe('xci init — E2E via dist/cli.mjs', () => {
  beforeAll(() => {
    if (!existsSync(CLI)) {
      throw new Error(
        `dist/cli.mjs is missing. Run \`npm run build\` before \`npm test\`. Expected at: ${CLI}`,
      );
    }
  });

  it('xci init creates .loci/ and exits 0', () => {
    const result = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(existsSync(join(tmpDir, '.loci', 'commands.yml'))).toBe(true);
  });

  it('xci init is idempotent — second run exits 0 and shows skipped', () => {
    // First run
    const first = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    expect(first.status).toBe(0);

    // Second run — everything should be skipped
    const second = spawnSync(process.execPath, [CLI, 'init'], {
      cwd: tmpDir,
      encoding: 'utf8',
    });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('skipped');
  });
});
