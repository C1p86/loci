// src/commands/__tests__/commands.test.ts
//
// Integration tests for commandsLoader.load() — covers normalization,
// graph validation (cycle detection, unknown refs), and YAML loading edge cases.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CircularAliasError, CommandSchemaError, YamlParseError } from '../../errors.js';
import { commandsLoader } from '../index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'xci-test-'));
  mkdirSync(join(tmpDir, '.xci'), { recursive: true });
});

function writeCommands(yaml: string): void {
  writeFileSync(join(tmpDir, '.xci', 'commands.yml'), yaml, 'utf8');
}

// ---------------------------------------------------------------------------
// Happy path — loading and normalization
// ---------------------------------------------------------------------------

describe('commandsLoader.load — happy path', () => {
  it('returns an empty Map when commands.yml does not exist', async () => {
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(0);
  });

  it('returns an empty Map for an empty commands.yml', async () => {
    writeCommands('');
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(0);
  });

  it('normalizes a bare string shorthand to kind:single', async () => {
    writeCommands('build: "npm run build"\n');
    const result = await commandsLoader.load(tmpDir);
    const def = result.get('build');
    expect(def).toMatchObject({ kind: 'single', cmd: ['npm', 'run', 'build'] });
  });

  it('normalizes an array shorthand to kind:single', async () => {
    writeCommands('test:\n  - npm\n  - test\n');
    const result = await commandsLoader.load(tmpDir);
    const def = result.get('test');
    expect(def).toMatchObject({ kind: 'single', cmd: ['npm', 'test'] });
  });

  it('normalizes object with cmd string to kind:single', async () => {
    writeCommands('build:\n  cmd: "npm run build"\n');
    const result = await commandsLoader.load(tmpDir);
    expect(result.get('build')).toMatchObject({ kind: 'single', cmd: ['npm', 'run', 'build'] });
  });

  it('normalizes object with cmd array to kind:single', async () => {
    writeCommands('run:\n  cmd:\n    - docker\n    - run\n    - myapp\n');
    const result = await commandsLoader.load(tmpDir);
    expect(result.get('run')).toMatchObject({ kind: 'single', cmd: ['docker', 'run', 'myapp'] });
  });

  it('preserves description field on single command', async () => {
    writeCommands('build:\n  cmd: "npm run build"\n  description: "Build the project"\n');
    const result = await commandsLoader.load(tmpDir);
    expect(result.get('build')).toMatchObject({
      kind: 'single',
      description: 'Build the project',
    });
  });

  it('normalizes object with steps to kind:sequential', async () => {
    writeCommands('ci:\n  steps:\n    - lint\n    - test\n    - build\n');
    const result = await commandsLoader.load(tmpDir);
    expect(result.get('ci')).toMatchObject({
      kind: 'sequential',
      steps: ['lint', 'test', 'build'],
    });
  });

  it('preserves description field on sequential command', async () => {
    writeCommands('ci:\n  steps:\n    - lint\n  description: "CI pipeline"\n');
    const result = await commandsLoader.load(tmpDir);
    expect(result.get('ci')).toMatchObject({ kind: 'sequential', description: 'CI pipeline' });
  });

  it('normalizes object with parallel to kind:parallel', async () => {
    writeCommands('check:\n  parallel:\n    - lint\n    - typecheck\n');
    const result = await commandsLoader.load(tmpDir);
    expect(result.get('check')).toMatchObject({
      kind: 'parallel',
      group: ['lint', 'typecheck'],
    });
  });

  it('preserves description on parallel command', async () => {
    writeCommands('check:\n  parallel:\n    - lint\n  description: "Concurrent checks"\n');
    const result = await commandsLoader.load(tmpDir);
    expect(result.get('check')).toMatchObject({
      kind: 'parallel',
      description: 'Concurrent checks',
    });
  });

  it('normalizes platform overrides correctly', async () => {
    writeCommands(
      'clean:\n  cmd: "rm -rf dist"\n  windows:\n    cmd:\n      - del\n      - /f\n      - dist\n',
    );
    const result = await commandsLoader.load(tmpDir);
    const def = result.get('clean');
    expect(def).toMatchObject({ kind: 'single' });
    if (def?.kind === 'single') {
      expect(def.platforms?.windows).toEqual(['del', '/f', 'dist']);
    }
  });

  it('accepts platform-only command with no default cmd (D-14)', async () => {
    writeCommands('cleanup:\n  windows:\n    cmd:\n      - del\n      - dist\n');
    const result = await commandsLoader.load(tmpDir);
    const def = result.get('cleanup');
    expect(def).toMatchObject({ kind: 'single', cmd: [] });
    if (def?.kind === 'single') {
      expect(def.platforms?.windows).toEqual(['del', 'dist']);
    }
  });

  it('loads a valid mixed commands.yml and returns correct CommandMap', async () => {
    writeCommands(
      [
        'lint: "npx biome check src/"',
        'test: "npx vitest run"',
        'build: "npx tsup"',
        'ci:',
        '  steps:',
        '    - lint',
        '    - test',
        '    - build',
        '  description: "Full CI pipeline"',
      ].join('\n'),
    );
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(4);
    expect(result.get('lint')).toMatchObject({ kind: 'single' });
    expect(result.get('ci')).toMatchObject({
      kind: 'sequential',
      steps: ['lint', 'test', 'build'],
    });
  });
});

// ---------------------------------------------------------------------------
// YAML loading error cases
// ---------------------------------------------------------------------------

describe('commandsLoader.load — YAML error cases', () => {
  it('throws YamlParseError with file path for malformed YAML', async () => {
    writeCommands('build: {unclosed brace\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(YamlParseError);
  });

  it('throws YamlParseError when YAML root is an array', async () => {
    writeCommands('- item1\n- item2\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(YamlParseError);
  });

  it('YamlParseError contains the file path', async () => {
    writeCommands('build: {unclosed\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toSatisfy(
      (e: unknown) => e instanceof YamlParseError && e.message.includes('commands.yml'),
    );
  });
});

// ---------------------------------------------------------------------------
// Schema validation error cases
// ---------------------------------------------------------------------------

describe('commandsLoader.load — schema validation errors', () => {
  it('throws CommandSchemaError for a number value', async () => {
    writeCommands('build: 42\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });

  it('throws CommandSchemaError for a null value', async () => {
    writeCommands('build: ~\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });

  it('throws CommandSchemaError for steps with non-array value', async () => {
    writeCommands('ci:\n  steps: "not-an-array"\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });

  it('throws CommandSchemaError for parallel with non-array value', async () => {
    writeCommands('check:\n  parallel: "not-an-array"\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });

  it('throws CommandSchemaError for steps containing non-string items', async () => {
    writeCommands('ci:\n  steps:\n    - 42\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });

  it('throws CommandSchemaError for parallel containing null items', async () => {
    writeCommands('check:\n  parallel:\n    - ~\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });

  it('throws CommandSchemaError for object with no cmd/steps/parallel', async () => {
    writeCommands('broken:\n  unknown_key: foo\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });
});

// ---------------------------------------------------------------------------
// Graph validation — cycle detection
// ---------------------------------------------------------------------------

describe('commandsLoader.load — cycle detection', () => {
  it('throws CircularAliasError for A → B → A', async () => {
    writeCommands(['a:\n  steps:\n    - b\n', 'b:\n  steps:\n    - a\n'].join(''));
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CircularAliasError);
  });

  it('throws CircularAliasError for A → B → C → A', async () => {
    writeCommands(
      ['a:\n  steps:\n    - b\n', 'b:\n  steps:\n    - c\n', 'c:\n  steps:\n    - a\n'].join(''),
    );
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CircularAliasError);
  });

  it('throws CircularAliasError for A → A (self-reference)', async () => {
    writeCommands('a:\n  steps:\n    - a\n');
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CircularAliasError);
  });

  it('CircularAliasError message includes the cycle path', async () => {
    writeCommands(['a:\n  steps:\n    - b\n', 'b:\n  steps:\n    - a\n'].join(''));
    await expect(commandsLoader.load(tmpDir)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof CircularAliasError && e.message.includes('a') && e.message.includes('b'),
    );
  });

  it('does NOT throw for a valid composition without cycles', async () => {
    writeCommands(
      [
        'lint: "npx biome check"\n',
        'test: "npx vitest run"\n',
        'ci:\n  steps:\n    - lint\n    - test\n',
      ].join(''),
    );
    await expect(commandsLoader.load(tmpDir)).resolves.toBeInstanceOf(Map);
  });
});

// ---------------------------------------------------------------------------
// Graph validation — D-09 lookup-based alias detection
// ---------------------------------------------------------------------------

describe('commandsLoader.load — D-09 lookup-based alias detection', () => {
  it('treats a step string matching an alias name as an alias reference', async () => {
    // lint is a known alias — should be treated as alias ref (no error)
    writeCommands(['lint: "npx biome check"\n', 'ci:\n  steps:\n    - lint\n'].join(''));
    await expect(commandsLoader.load(tmpDir)).resolves.toBeInstanceOf(Map);
  });

  it('treats a step string NOT matching any alias as an inline command (no error)', async () => {
    // "npm run build" doesn't match any alias key — treat as inline command
    writeCommands('ci:\n  steps:\n    - "npm run build"\n');
    await expect(commandsLoader.load(tmpDir)).resolves.toBeInstanceOf(Map);
  });

  it('treats a single-word step not matching any alias as inline command (no error)', async () => {
    // "npm" alone doesn't match any alias — treat as inline command
    writeCommands('ci:\n  steps:\n    - npm\n');
    await expect(commandsLoader.load(tmpDir)).resolves.toBeInstanceOf(Map);
  });

  it('parallel entries follow the same lookup semantics', async () => {
    writeCommands(
      ['lint: "npx biome check"\n', 'check:\n  parallel:\n    - lint\n    - "npm test"\n'].join(''),
    );
    await expect(commandsLoader.load(tmpDir)).resolves.toBeInstanceOf(Map);
  });
});

// ---------------------------------------------------------------------------
// .xci/commands/ directory loading
// ---------------------------------------------------------------------------

describe('commandsLoader.load — commands/ directory', () => {
  function writeCommandsDir(files: Record<string, string>): void {
    mkdirSync(join(tmpDir, '.xci', 'commands'), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(tmpDir, '.xci', 'commands', name), content, 'utf8');
    }
  }

  it('loads aliases from .xci/commands/ directory', async () => {
    writeCommandsDir({
      'build.yml': 'build: "npm run build"',
      'test.yml': 'test: "npm test"',
    });
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(2);
    expect(result.get('build')).toMatchObject({ kind: 'single' });
    expect(result.get('test')).toMatchObject({ kind: 'single' });
  });

  it('merges commands.yml and commands/ directory', async () => {
    writeCommands('lint: "npx biome check"');
    writeCommandsDir({
      'build.yml': 'build: "npm run build"',
    });
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(2);
    expect(result.get('lint')).toMatchObject({ kind: 'single' });
    expect(result.get('build')).toMatchObject({ kind: 'single' });
  });

  it('throws CommandSchemaError on duplicate alias between commands.yml and commands/', async () => {
    writeCommands('build: "npm run build"');
    writeCommandsDir({
      'build.yml': 'build: "npx tsup"',
    });
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });

  it('throws CommandSchemaError on duplicate alias across files in commands/', async () => {
    writeCommandsDir({
      'a.yml': 'deploy: "npm run deploy"',
      'b.yml': 'deploy: "npm run deploy:prod"',
    });
    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });

  it('ignores non-YAML files in commands/ directory', async () => {
    writeCommandsDir({
      'build.yml': 'build: "npm run build"',
    });
    writeFileSync(join(tmpDir, '.xci', 'commands', 'readme.txt'), 'not yaml', 'utf8');
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(1);
  });

  it('supports .yaml extension in commands/ directory', async () => {
    writeCommandsDir({
      'build.yaml': 'build: "npm run build"',
    });
    const result = await commandsLoader.load(tmpDir);
    expect(result.get('build')).toMatchObject({ kind: 'single' });
  });

  it('loads files in alphabetical order from commands/', async () => {
    // Both define different aliases; order matters for sequential references
    writeCommandsDir({
      'z-deploy.yml': 'deploy:\n  steps:\n    - build\n  description: "Deploy"',
      'a-build.yml': 'build: "npm run build"',
    });
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(2);
    // deploy references build — validation should pass since build is loaded first
    expect(result.get('deploy')).toMatchObject({ kind: 'sequential', steps: ['build'] });
  });

  it('skips empty files in commands/ directory', async () => {
    writeCommandsDir({
      'empty.yml': '',
      'build.yml': 'build: "npm run build"',
    });
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(1);
  });

  it('works with only commands/ directory and no commands.yml', async () => {
    writeCommandsDir({
      'build.yml': 'build: "npm run build"',
    });
    // No commands.yml written
    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(1);
    expect(result.get('build')).toMatchObject({ kind: 'single' });
  });

  it('loads aliases from nested subdirectories in commands/', async () => {
    mkdirSync(join(tmpDir, '.xci', 'commands', 'deploy'), { recursive: true });
    mkdirSync(join(tmpDir, '.xci', 'commands', 'ci', 'checks'), { recursive: true });
    writeFileSync(join(tmpDir, '.xci', 'commands', 'build.yml'), 'build: "npm run build"', 'utf8');
    writeFileSync(join(tmpDir, '.xci', 'commands', 'deploy', 'staging.yml'), 'deploy-staging: "npm run deploy:staging"', 'utf8');
    writeFileSync(join(tmpDir, '.xci', 'commands', 'ci', 'checks', 'lint.yml'), 'lint: "npx biome check"', 'utf8');

    const result = await commandsLoader.load(tmpDir);
    expect(result.size).toBe(3);
    expect(result.get('build')).toMatchObject({ kind: 'single' });
    expect(result.get('deploy-staging')).toMatchObject({ kind: 'single' });
    expect(result.get('lint')).toMatchObject({ kind: 'single' });
  });

  it('throws on duplicate alias across nested subdirectories', async () => {
    mkdirSync(join(tmpDir, '.xci', 'commands', 'sub'), { recursive: true });
    writeFileSync(join(tmpDir, '.xci', 'commands', 'build.yml'), 'build: "npm run build"', 'utf8');
    writeFileSync(join(tmpDir, '.xci', 'commands', 'sub', 'build.yml'), 'build: "npx tsup"', 'utf8');

    await expect(commandsLoader.load(tmpDir)).rejects.toBeInstanceOf(CommandSchemaError);
  });
});

// ---------------------------------------------------------------------------
// for_each.in — string form (quick-260421-ewq)
// ---------------------------------------------------------------------------

describe('for_each.in — string form', () => {
  it('accepts array form unchanged (regression guard)', async () => {
    writeCommands(
      'deploy:\n' +
      '  for_each:\n' +
      '    var: region\n' +
      '    in: ["a", "b"]\n' +
      '    cmd: ["echo", "${region}"]\n',
    );
    const result = await commandsLoader.load(tmpDir);
    const def = result.get('deploy');
    expect(def).toMatchObject({ kind: 'for_each', in: ['a', 'b'] });
  });

  it('accepts string form with ${...} placeholder', async () => {
    writeCommands(
      'deploy:\n' +
      '  for_each:\n' +
      '    var: region\n' +
      '    in: "${AwsLocations}"\n' +
      '    cmd: ["echo", "${region}"]\n',
    );
    const result = await commandsLoader.load(tmpDir);
    const def = result.get('deploy');
    expect(def).toMatchObject({ kind: 'for_each', in: '${AwsLocations}' });
  });

  it('rejects scalar string without any ${...} placeholder', async () => {
    writeCommands(
      'deploy:\n' +
      '  for_each:\n' +
      '    var: region\n' +
      '    in: "plain-string"\n' +
      '    cmd: ["echo", "${region}"]\n',
    );
    await expect(commandsLoader.load(tmpDir)).rejects.toThrow(CommandSchemaError);
    await expect(commandsLoader.load(tmpDir)).rejects.toThrow(/\$\{\.\.\.\}/);
  });

  it.each([
    ['number', '    in: 123\n'],
    ['null', '    in: null\n'],
    ['object', '    in:\n      obj: true\n'],
  ])('rejects non-array non-string for_each.in (%s)', async (_label, inBlock) => {
    writeCommands(
      'deploy:\n' +
      '  for_each:\n' +
      '    var: region\n' +
      inBlock +
      '    cmd: ["echo", "${region}"]\n',
    );
    await expect(commandsLoader.load(tmpDir)).rejects.toThrow(CommandSchemaError);
    await expect(commandsLoader.load(tmpDir)).rejects.toThrow(/array of strings OR/);
  });
});
