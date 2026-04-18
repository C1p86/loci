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

/** Create a temp dir with a .xci/ subdirectory and write given files into it. */
async function setupFixture(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
  await mkdir(join(cwd, '.xci'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(cwd, '.xci', name), content, 'utf8');
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
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
    });

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('returns empty config when no files exist (only builtins)', async () => {
      const result = await configLoader.load(cwd);
      // Builtins are always injected
      expect(result.values['xci.project.path']).toBe(cwd);
      expect(result.values['XCI_PROJECT_PATH']).toBe(cwd);
      expect(result.secretKeys.size).toBe(0);
    });
  });

  describe('single layer loading', () => {
    let cwd: string;
    let savedMachineConfig: string | undefined;

    beforeEach(async () => {
      savedMachineConfig = process.env['XCI_MACHINE_CONFIGS'];
    });

    afterEach(async () => {
      await cleanup(cwd);
      if (savedMachineConfig === undefined) {
        delete process.env['XCI_MACHINE_CONFIGS'];
      } else {
        process.env['XCI_MACHINE_CONFIGS'] = savedMachineConfig;
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

    it('loads machine secrets from XCI_MACHINE_CONFIGS/secrets.yml', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci'));
      const machineDir = join(cwd, 'machine-conf.d');
      await mkdir(machineDir);
      await writeFile(join(machineDir, 'secrets.yml'), 'api:\n  key: "machine-secret"', 'utf8');
      process.env['XCI_MACHINE_CONFIGS'] = machineDir;

      const result = await configLoader.load(cwd);
      expect(result.values['api.key']).toBe('machine-secret');
      expect(result.secretKeys.has('api.key')).toBe(true);
    });

    it('loads machine secrets from XCI_MACHINE_CONFIGS/secrets/ directory', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci'));
      const machineDir = join(cwd, 'machine-conf.d');
      await mkdir(join(machineDir, 'secrets'), { recursive: true });
      await writeFile(join(machineDir, 'secrets', 'aws.yml'), 'aws:\n  token: "abc"', 'utf8');
      process.env['XCI_MACHINE_CONFIGS'] = machineDir;

      const result = await configLoader.load(cwd);
      expect(result.values['aws.token']).toBe('abc');
      expect(result.secretKeys.has('aws.token')).toBe(true);
    });

    it('project secrets override machine secrets', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci'));
      const machineDir = join(cwd, 'machine-conf.d');
      await mkdir(machineDir);
      await writeFile(join(machineDir, 'secrets.yml'), 'api:\n  key: "machine-val"', 'utf8');
      await writeFile(join(cwd, '.xci', 'secrets.yml'), 'api:\n  key: "project-val"', 'utf8');
      process.env['XCI_MACHINE_CONFIGS'] = machineDir;

      const result = await configLoader.load(cwd);
      expect(result.values['api.key']).toBe('project-val');
    });

    it('loads secrets from .xci/secrets/ directory', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci', 'secrets'), { recursive: true });
      await writeFile(join(cwd, '.xci', 'secrets', 'aws.yml'), 'aws:\n  token: "proj-secret"', 'utf8');

      const result = await configLoader.load(cwd);
      expect(result.values['aws.token']).toBe('proj-secret');
      expect(result.secretKeys.has('aws.token')).toBe(true);
    });

    it('loads secrets from nested .xci/secrets/ subdirectories', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci', 'secrets', 'cloud'), { recursive: true });
      await writeFile(join(cwd, '.xci', 'secrets', 'cloud', 'gcp.yml'), 'gcp:\n  key: "gcp-val"', 'utf8');
      await writeFile(join(cwd, '.xci', 'secrets', 'db.yml'), 'db:\n  pass: "db-val"', 'utf8');

      const result = await configLoader.load(cwd);
      expect(result.values['gcp.key']).toBe('gcp-val');
      expect(result.values['db.pass']).toBe('db-val');
      expect(result.secretKeys.has('gcp.key')).toBe(true);
      expect(result.secretKeys.has('db.pass')).toBe(true);
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
      savedMachineConfig = process.env['XCI_MACHINE_CONFIGS'];
    });

    afterEach(async () => {
      await cleanup(cwd);
      if (savedMachineConfig === undefined) {
        delete process.env['XCI_MACHINE_CONFIGS'];
      } else {
        process.env['XCI_MACHINE_CONFIGS'] = savedMachineConfig;
      }
    });

    it('local overrides secrets overrides project overrides machine', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci'));

      // Machine config in a directory
      const machineDir = join(cwd, 'machine-conf.d');
      await mkdir(machineDir);
      await writeFile(join(machineDir, 'secrets.yml'), 'app:\n  name: "M"', 'utf8');
      process.env['XCI_MACHINE_CONFIGS'] = machineDir;

      await writeFile(join(cwd, '.xci', 'config.yml'), 'app:\n  name: "P"', 'utf8');
      await writeFile(join(cwd, '.xci', 'secrets.yml'), 'app:\n  name: "S"', 'utf8');
      await writeFile(join(cwd, '.xci', 'local.yml'), 'app:\n  name: "L"', 'utf8');

      const result = await configLoader.load(cwd);
      expect(result.values['app.name']).toBe('L');
      expect(result.provenance['app.name']).toBe('local');
    });

    it('preserves non-overridden keys from earlier layers (leaf-level merge per D-02)', async () => {
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci'));

      // Machine secrets define 'a', project config defines 'b', local defines 'c'
      const machineDir = join(cwd, 'machine-conf.d');
      await mkdir(machineDir);
      await writeFile(join(machineDir, 'secrets.yml'), 'a: "1"', 'utf8');
      process.env['XCI_MACHINE_CONFIGS'] = machineDir;

      await writeFile(join(cwd, '.xci', 'config.yml'), 'b: "2"', 'utf8');
      await writeFile(join(cwd, '.xci', 'local.yml'), 'c: "3"', 'utf8');

      const result = await configLoader.load(cwd);
      expect(result.values['a']).toBe('1');
      expect(result.values['b']).toBe('2');
      expect(result.values['c']).toBe('3');
      expect(result.provenance['a']).toBe('secrets');
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

  describe('config value interpolation', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('resolves ${key} references between config values', async () => {
      cwd = await setupFixture({
        'config.yml': 'host: "myserver.com"\nport: "8080"\nurl: "${host}:${port}"',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['url']).toBe('myserver.com:8080');
    });

    it('resolves transitive references (a → b → c)', async () => {
      cwd = await setupFixture({
        'config.yml': 'base: "https://api.example.com"\npath: "${base}/v1"\nendpoint: "${path}/users"',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['endpoint']).toBe('https://api.example.com/v1/users');
    });

    it('leaves unknown keys as literal ${key}', async () => {
      cwd = await setupFixture({
        'config.yml': 'msg: "hello ${unknown}"',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['msg']).toBe('hello ${unknown}');
    });

    it('supports $${} escape to produce literal ${}', async () => {
      cwd = await setupFixture({
        'config.yml': 'escaped: "$${not_a_var}"',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['escaped']).toBe('${not_a_var}');
    });

    it('throws on circular references', async () => {
      cwd = await setupFixture({
        'config.yml': 'a: "${b}"\nb: "${a}"',
      });
      await expect(configLoader.load(cwd)).rejects.toBeInstanceOf(YamlParseError);
    });

    it('throws on self-referencing value', async () => {
      cwd = await setupFixture({
        'config.yml': 'x: "${x}"',
      });
      await expect(configLoader.load(cwd)).rejects.toBeInstanceOf(YamlParseError);
    });

    it('interpolates across layers (local references project key)', async () => {
      cwd = await setupFixture({
        'config.yml': 'host: "prod.example.com"\nport: "443"',
        'local.yml': 'host: "localhost"\nurl: "${host}:${port}"',
      });
      const result = await configLoader.load(cwd);
      // host is overridden by local, port comes from project
      expect(result.values['url']).toBe('localhost:443');
    });

    it('values without placeholders are unchanged', async () => {
      cwd = await setupFixture({
        'config.yml': 'plain: "no placeholders here"',
      });
      const result = await configLoader.load(cwd);
      expect(result.values['plain']).toBe('no placeholders here');
    });
  });

  describe('empty and comment-only files', () => {
    let cwd: string;

    afterEach(async () => {
      await cleanup(cwd);
    });

    it('empty file is treated as empty layer (only builtins)', async () => {
      cwd = await setupFixture({ 'config.yml': '' });
      const result = await configLoader.load(cwd);
      expect(result.provenance).toEqual({});
      // Only builtins present — no user-defined values
      expect(result.values['xci.project.path']).toBeDefined();
    });

    it('comments-only file is treated as empty layer (only builtins)', async () => {
      cwd = await setupFixture({
        'config.yml': '# just a comment\n# another comment',
      });
      const result = await configLoader.load(cwd);
      expect(result.provenance).toEqual({});
      expect(result.values['xci.project.path']).toBeDefined();
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
      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
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

    it('serializes array values as JSON strings', async () => {
      cwd = await setupFixture({ 'config.yml': 'ports:\n  - 8080\n  - 443' });
      const config = await configLoader.load(cwd);
      expect(config.values['ports']).toBe('[8080,443]');
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

      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci'));
      await writeFile(join(cwd, '.xci', 'secrets.yml'), 'api:\n  token: "s3cr3t"', 'utf8');

      // Initialize a git repo and commit secrets.yml
      const gitEnv = {
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
        PATH: process.env['PATH'] ?? '',
      };
      execSync('git init', { cwd, env: gitEnv, stdio: 'pipe' });
      execSync('git add .xci/secrets.yml', { cwd, env: gitEnv, stdio: 'pipe' });
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

      cwd = await mkdtemp(join(tmpdir(), 'xci-test-'));
      await mkdir(join(cwd, '.xci'));
      await writeFile(join(cwd, '.xci', 'secrets.yml'), 'api:\n  token: "s3cr3t"', 'utf8');

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
