// src/config/__tests__/loader.test.ts
//
// Unit tests for the 4-layer YAML config loader (Phase 2).
// Tasks 2 and 3: happy paths, merge logic, error paths, and YAML 1.2 semantics.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigReadError, YamlParseError } from '../../errors.js';
import { configLoader } from '../index.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a temp dir with a .loci/ subdirectory and write given files into it. */
async function setupFixture(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
  await mkdir(join(cwd, '.loci'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(cwd, '.loci', name), content, 'utf8');
  }
  return cwd;
}

async function cleanup(cwd: string): Promise<void> {
  await rm(cwd, { recursive: true });
}

// ---------------------------------------------------------------------------
// Task 2: Happy paths and merge logic
// ---------------------------------------------------------------------------

describe('configLoader.load', () => {
  describe('missing files', () => {
    let cwd: string;

    beforeEach(async () => {
      cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
    });

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('returns empty config when no files exist', async () => {
      const result = await configLoader.load(cwd);
      expect(result.values).toEqual({});
      expect(result.provenance).toEqual({});
      expect(result.secretKeys.size).toBe(0);
    });
  });

  describe('single layer loading', () => {
    let cwd: string;
    let savedMachineConfig: string | undefined;

    beforeEach(async () => {
      savedMachineConfig = process.env['LOCI_MACHINE_CONFIG'];
    });

    afterEach(async () => {
      await cleanup(cwd);
      if (savedMachineConfig === undefined) {
        delete process.env['LOCI_MACHINE_CONFIG'];
      } else {
        process.env['LOCI_MACHINE_CONFIG'] = savedMachineConfig;
      }
    });

    it('loads project config.yml', async () => {
      cwd = await setupFixture({
        'config.yml': 'deploy:\n  host: "prod.example.com"\n  user: admin',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['deploy.host']).toBe('prod.example.com');
      expect(result.values['deploy.user']).toBe('admin');
      expect(result.provenance['deploy.host']).toBe('project');
      expect(result.provenance['deploy.user']).toBe('project');
    });

    it('loads machine config via LOCI_MACHINE_CONFIG', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
      await mkdir(join(cwd, '.loci'));
      // Write machine config to a separate file (not in .loci)
      const machineFile = join(cwd, 'machine-config.yml');
      await writeFile(machineFile, 'machine:\n  env: "production"', 'utf8');
      process.env['LOCI_MACHINE_CONFIG'] = machineFile;

      const result = await configLoader.load(cwd);
      expect(result.values['machine.env']).toBe('production');
      expect(result.provenance['machine.env']).toBe('machine');
    });

    it('loads secrets.yml and tags secretKeys', async () => {
      cwd = await setupFixture({
        'secrets.yml': 'api:\n  token: "s3cr3t"',
      });
      const result = await configLoader.load(cwd);
      expect(result.secretKeys.has('api.token')).toBe(true);
      expect(result.provenance['api.token']).toBe('secrets');
      expect(result.values['api.token']).toBe('s3cr3t');
    });

    it('loads local.yml', async () => {
      cwd = await setupFixture({
        'local.yml': 'deploy:\n  host: "localhost"',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['deploy.host']).toBe('localhost');
      expect(result.provenance['deploy.host']).toBe('local');
    });
  });

  describe('4-layer merge precedence', () => {
    let cwd: string;
    let savedMachineConfig: string | undefined;

    beforeEach(async () => {
      savedMachineConfig = process.env['LOCI_MACHINE_CONFIG'];
    });

    afterEach(async () => {
      await cleanup(cwd);
      if (savedMachineConfig === undefined) {
        delete process.env['LOCI_MACHINE_CONFIG'];
      } else {
        process.env['LOCI_MACHINE_CONFIG'] = savedMachineConfig;
      }
    });

    it('local overrides secrets overrides project overrides machine', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
      await mkdir(join(cwd, '.loci'));

      // Machine config in a separate file
      const machineFile = join(cwd, 'machine-config.yml');
      await writeFile(machineFile, 'app:\n  name: "M"', 'utf8');
      process.env['LOCI_MACHINE_CONFIG'] = machineFile;

      await writeFile(join(cwd, '.loci', 'config.yml'), 'app:\n  name: "P"', 'utf8');
      await writeFile(join(cwd, '.loci', 'secrets.yml'), 'app:\n  name: "S"', 'utf8');
      await writeFile(join(cwd, '.loci', 'local.yml'), 'app:\n  name: "L"', 'utf8');

      const result = await configLoader.load(cwd);
      expect(result.values['app.name']).toBe('L');
      expect(result.provenance['app.name']).toBe('local');
    });

    it('preserves non-overridden keys from earlier layers (leaf-level merge per D-02)', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
      await mkdir(join(cwd, '.loci'));

      // Machine defines 'a', project defines 'b', local defines 'c'
      const machineFile = join(cwd, 'machine-config.yml');
      await writeFile(machineFile, 'a: "1"', 'utf8');
      process.env['LOCI_MACHINE_CONFIG'] = machineFile;

      await writeFile(join(cwd, '.loci', 'config.yml'), 'b: "2"', 'utf8');
      await writeFile(join(cwd, '.loci', 'local.yml'), 'c: "3"', 'utf8');

      const result = await configLoader.load(cwd);
      expect(result.values['a']).toBe('1');
      expect(result.values['b']).toBe('2');
      expect(result.values['c']).toBe('3');
      expect(result.provenance['a']).toBe('machine');
      expect(result.provenance['b']).toBe('project');
      expect(result.provenance['c']).toBe('local');
    });
  });

  describe('secretKeys semantics', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('excludes secret keys overridden by local', async () => {
      cwd = await setupFixture({
        'secrets.yml': 'api:\n  token: "real-secret"',
        'local.yml': 'api:\n  token: "test-override"',
      });
      const result = await configLoader.load(cwd);
      expect(result.secretKeys.has('api.token')).toBe(false);
      expect(result.provenance['api.token']).toBe('local');
      expect(result.values['api.token']).toBe('test-override');
    });

    it('includes secret keys not overridden', async () => {
      cwd = await setupFixture({
        'secrets.yml': 'api:\n  token: "real-secret"',
        'local.yml': 'other:\n  key: "value"',
      });
      const result = await configLoader.load(cwd);
      expect(result.secretKeys.has('api.token')).toBe(true);
      expect(result.provenance['api.token']).toBe('secrets');
    });
  });

  describe('empty and comment-only files', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('empty file is treated as empty layer', async () => {
      cwd = await setupFixture({ 'config.yml': '' });
      const result = await configLoader.load(cwd);
      expect(result.values).toEqual({});
      expect(result.provenance).toEqual({});
    });

    it('comments-only file is treated as empty layer', async () => {
      cwd = await setupFixture({
        'config.yml': '# just a comment\n# another comment',
      });
      const result = await configLoader.load(cwd);
      expect(result.values).toEqual({});
      expect(result.provenance).toEqual({});
    });
  });

  describe('nested flattening', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('deep nesting produces correct dot-notation keys', async () => {
      cwd = await setupFixture({
        'config.yml': 'a:\n  b:\n    c: "deep"',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['a.b.c']).toBe('deep');
    });

    it('mixed nesting levels flatten correctly', async () => {
      cwd = await setupFixture({
        'config.yml': 'top: "1"\nnested:\n  key: "2"',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['top']).toBe('1');
      expect(result.values['nested.key']).toBe('2');
    });
  });

  describe('frozen output', () => {
    let cwd: string;

    beforeEach(async () => {
      cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
    });

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('values object is frozen', async () => {
      const result = await configLoader.load(cwd);
      expect(Object.isFrozen(result.values)).toBe(true);
    });

    it('provenance object is frozen', async () => {
      const result = await configLoader.load(cwd);
      expect(Object.isFrozen(result.provenance)).toBe(true);
    });

    it('secretKeys set is frozen', async () => {
      const result = await configLoader.load(cwd);
      expect(Object.isFrozen(result.secretKeys)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 3: Error paths, git check, and YAML 1.2 semantics
  // ---------------------------------------------------------------------------

  describe('YAML parse errors (CFG-07)', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('throws YamlParseError for malformed YAML', async () => {
      cwd = await setupFixture({ 'config.yml': 'key: [\ninvalid' });
      await expect(configLoader.load(cwd)).rejects.toBeInstanceOf(YamlParseError);
    });

    it('YamlParseError includes filename in message', async () => {
      cwd = await setupFixture({ 'config.yml': 'key: [\ninvalid' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) => err instanceof YamlParseError && err.message.includes('config.yml'),
      );
    });

    it('YamlParseError includes line number', async () => {
      cwd = await setupFixture({ 'config.yml': 'key: [\ninvalid' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) => err instanceof YamlParseError && /at line \d+/.test(err.message),
      );
    });

    it('YamlParseError has code CFG_YAML_PARSE', async () => {
      cwd = await setupFixture({ 'config.yml': 'key: [\ninvalid' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) => err instanceof YamlParseError && err.code === 'CFG_YAML_PARSE',
      );
    });
  });

  describe('non-string leaf values (D-04)', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('throws for number value', async () => {
      cwd = await setupFixture({ 'config.yml': 'port: 8080' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof YamlParseError &&
          ((err.cause as Error)?.message ?? '').includes('port: expected string, got number'),
      );
    });

    it('throws for array value', async () => {
      cwd = await setupFixture({ 'config.yml': 'ports:\n  - 8080\n  - 443' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof YamlParseError &&
          ((err.cause as Error)?.message ?? '').includes('got array'),
      );
    });

    it('throws for null value', async () => {
      cwd = await setupFixture({ 'config.yml': 'key: ~' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof YamlParseError &&
          ((err.cause as Error)?.message ?? '').includes('got null'),
      );
    });

    it('throws for boolean value from explicit true/false', async () => {
      cwd = await setupFixture({ 'config.yml': 'flag: true' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof YamlParseError &&
          ((err.cause as Error)?.message ?? '').includes('got boolean'),
      );
    });
  });

  describe('YAML 1.2 semantics (CFG-10)', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('yes/no/on/off parse as strings', async () => {
      cwd = await setupFixture({
        'config.yml': 'a: yes\nb: no\nc: on\nd: off',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['a']).toBe('yes');
      expect(result.values['b']).toBe('no');
      expect(result.values['c']).toBe('on');
      expect(result.values['d']).toBe('off');
    });

    it('0123 is parsed as number by YAML 1.2 and rejected by type check', async () => {
      cwd = await setupFixture({ 'config.yml': 'octal: 0123' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof YamlParseError &&
          ((err.cause as Error)?.message ?? '').includes('got number'),
      );
    });
  });

  describe('root document validation', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('throws for root-level array', async () => {
      cwd = await setupFixture({ 'config.yml': '- item1\n- item2' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof YamlParseError &&
          ((err.cause as Error)?.message ?? '').includes('Root document must be a YAML mapping'),
      );
    });

    it('throws for root-level scalar', async () => {
      cwd = await setupFixture({ 'config.yml': 'just a string' });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof YamlParseError &&
          ((err.cause as Error)?.message ?? '').includes('Root document must be a YAML mapping'),
      );
    });
  });

  describe('dot-key collision', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('throws when quoted dot-key collides with nested path', async () => {
      cwd = await setupFixture({
        'config.yml': '"a.b": collision\na:\n  b: nested',
      });
      await expect(configLoader.load(cwd)).rejects.toSatisfy(
        (err: unknown) =>
          err instanceof YamlParseError &&
          (((err.cause as Error)?.message ?? '').includes('Key collision') ||
            ((err.cause as Error)?.message ?? '').includes('a.b')),
      );
    });
  });

  describe('secrets git-tracking check (CFG-09)', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('emits stderr warning when secrets.yml is git-tracked', async () => {
      const { execSync } = await import('node:child_process');

      cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
      await mkdir(join(cwd, '.loci'));
      await writeFile(join(cwd, '.loci', 'secrets.yml'), 'api:\n  token: "s3cr3t"', 'utf8');

      // Initialize a git repo and commit secrets.yml
      const gitEnv = {
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        PATH: process.env['PATH'] ?? '',
      };
      execSync('git init', { cwd, env: gitEnv, stdio: 'pipe' });
      execSync('git add .loci/secrets.yml', { cwd, env: gitEnv, stdio: 'pipe' });
      execSync('git commit -m "test"', { cwd, env: gitEnv, stdio: 'pipe' });

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await configLoader.load(cwd);
        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('WARNING'));
        const callArgs = stderrSpy.mock.calls.flat().join('');
        expect(callArgs).toContain('secrets.yml');
        expect(callArgs).toContain('git rm --cached');
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('does not warn when secrets.yml is NOT git-tracked', async () => {
      const { execSync } = await import('node:child_process');

      cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
      await mkdir(join(cwd, '.loci'));
      await writeFile(join(cwd, '.loci', 'secrets.yml'), 'api:\n  token: "s3cr3t"', 'utf8');

      const gitEnv = {
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        PATH: process.env['PATH'] ?? '',
      };
      // Initialize git repo but do NOT add secrets.yml
      execSync('git init', { cwd, env: gitEnv, stdio: 'pipe' });

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await configLoader.load(cwd);
        const callArgs = stderrSpy.mock.calls.flat().join('');
        expect(callArgs).not.toContain('WARNING');
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('does not warn in a non-git directory', async () => {
      cwd = await setupFixture({ 'secrets.yml': 'api:\n  token: "s3cr3t"' });
      // No git init — not a git repo

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await configLoader.load(cwd);
        const callArgs = stderrSpy.mock.calls.flat().join('');
        expect(callArgs).not.toContain('WARNING');
      } finally {
        stderrSpy.mockRestore();
      }
    });
  });

  describe('ConfigReadError code', () => {
    it('ConfigReadError has code CFG_READ', () => {
      const err = new ConfigReadError('/path/to/file', new Error('EACCES'));
      expect(err.code).toBe('CFG_READ');
    });
  });
});
