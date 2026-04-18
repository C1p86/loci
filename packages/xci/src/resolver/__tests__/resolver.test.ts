// src/resolver/__tests__/resolver.test.ts
//
// Tests for resolver modules: platform.ts, envvars.ts, interpolate.ts, and index.ts

import { describe, expect, it, vi } from 'vitest';
import { CommandSchemaError, UndefinedPlaceholderError, UnknownAliasError } from '../../errors.js';
import type { CommandDef, CommandMap, ResolvedConfig } from '../../types.js';
import { buildEnvVars, redactSecrets } from '../envvars.js';
import { resolver } from '../index.js';
import { interpolateArgv } from '../interpolate.js';
import { currentOsKey, selectPlatformCmd } from '../platform.js';

/* ============================================================
 * platform.ts tests
 * ============================================================ */

describe('currentOsKey', () => {
  it('returns linux when process.platform is linux', () => {
    vi.stubEnv('FORCE_OS', '');
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    expect(currentOsKey()).toBe('linux');
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns windows when process.platform is win32', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    expect(currentOsKey()).toBe('windows');
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns macos when process.platform is darwin', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    expect(currentOsKey()).toBe('macos');
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});

describe('selectPlatformCmd', () => {
  it('returns linux override cmd when on linux and linux override is defined', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const def: CommandDef & { kind: 'single' } = {
      kind: 'single',
      cmd: ['default-cmd'],
      platforms: { linux: ['linux-cmd', '--flag'] },
    };
    expect(selectPlatformCmd(def, 'test')).toEqual(['linux-cmd', '--flag']);
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns default cmd when no override for current OS', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const def: CommandDef & { kind: 'single' } = {
      kind: 'single',
      cmd: ['default-cmd'],
      platforms: { windows: ['win-cmd'] },
    };
    expect(selectPlatformCmd(def, 'test')).toEqual(['default-cmd']);
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('throws CommandSchemaError when no default cmd and no matching platform override', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const def: CommandDef & { kind: 'single' } = {
      kind: 'single',
      cmd: [],
      platforms: { windows: ['win-cmd'] },
    };
    expect(() => selectPlatformCmd(def, 'cleanup')).toThrow(CommandSchemaError);
    expect(() => selectPlatformCmd(def, 'cleanup')).toThrow('cleanup');
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns matching platform override when no default cmd but OS matches', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const def: CommandDef & { kind: 'single' } = {
      kind: 'single',
      cmd: [],
      platforms: { windows: ['win-cmd', '--win'] },
    };
    expect(selectPlatformCmd(def, 'test')).toEqual(['win-cmd', '--win']);
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns cmd when no platforms overrides at all', () => {
    const def: CommandDef & { kind: 'single' } = {
      kind: 'single',
      cmd: ['npm', 'run', 'build'],
    };
    expect(selectPlatformCmd(def, 'build')).toEqual(['npm', 'run', 'build']);
  });
});

/* ============================================================
 * envvars.ts tests
 * ============================================================ */

describe('buildEnvVars', () => {
  it('transforms deploy.host to DEPLOY_HOST', () => {
    expect(buildEnvVars({ 'deploy.host': 'server.com' })).toEqual({ DEPLOY_HOST: 'server.com' });
  });

  it('transforms multiple keys', () => {
    expect(buildEnvVars({ 'api.key': 'abc', name: 'app' })).toEqual({
      API_KEY: 'abc',
      NAME: 'app',
    });
  });

  it('returns empty object for empty input', () => {
    expect(buildEnvVars({})).toEqual({});
  });

  it('uppercases all keys', () => {
    expect(buildEnvVars({ host: 'localhost', port: '8080' })).toEqual({
      HOST: 'localhost',
      PORT: '8080',
    });
  });
});

describe('redactSecrets', () => {
  it('replaces secret env values with ***', () => {
    const envVars = { DEPLOY_HOST: 'server.com', API_KEY: 'secret123' };
    const secretKeys = new Set(['api.key']);
    expect(redactSecrets(envVars, secretKeys)).toEqual({
      DEPLOY_HOST: 'server.com',
      API_KEY: '***',
    });
  });

  it('returns all values unchanged when secretKeys is empty', () => {
    const envVars = { HOST: 'localhost', PORT: '8080' };
    const secretKeys = new Set<string>();
    expect(redactSecrets(envVars, secretKeys)).toEqual({ HOST: 'localhost', PORT: '8080' });
  });

  it('correctly maps dot-notation secretKeys to UPPER_UNDERSCORE env names', () => {
    const envVars = { DEPLOY_HOST: 'server.com', MY_SECRET_TOKEN: 'xyz' };
    const secretKeys = new Set(['my.secret.token']);
    expect(redactSecrets(envVars, secretKeys)).toEqual({
      DEPLOY_HOST: 'server.com',
      MY_SECRET_TOKEN: '***',
    });
  });
});

/* ============================================================
 * interpolate.ts tests
 * ============================================================ */

describe('interpolateArgv', () => {
  it('expands a simple ${name} placeholder', () => {
    expect(interpolateArgv(['echo', '${name}'], 'test', { name: 'world' })).toEqual([
      'echo',
      'world',
    ]);
  });

  it('expands multiple placeholders in one token', () => {
    expect(
      interpolateArgv(['scp', '${user}@${host}:/app'], 'deploy', { user: 'admin', host: 'srv' }),
    ).toEqual(['scp', 'admin@srv:/app']);
  });

  it('handles $${VAR} escape producing literal ${VAR}', () => {
    expect(interpolateArgv(['echo', '$${VAR}'], 'test', {})).toEqual(['echo', '${VAR}']);
  });

  it('throws UndefinedPlaceholderError for missing placeholder', () => {
    expect(() => interpolateArgv(['echo', '${missing}'], 'test', {})).toThrow(
      UndefinedPlaceholderError,
    );
    expect(() => interpolateArgv(['echo', '${missing}'], 'test', {})).toThrow('missing');
    expect(() => interpolateArgv(['echo', '${missing}'], 'test', {})).toThrow('test');
  });

  it('supports dot-notation keys', () => {
    expect(interpolateArgv(['echo', '${deploy.host}'], 'test', { 'deploy.host': 'srv' })).toEqual([
      'echo',
      'srv',
    ]);
  });

  it('returns token unchanged when no placeholders', () => {
    expect(interpolateArgv(['no-placeholders'], 'test', {})).toEqual(['no-placeholders']);
  });

  it('handles multiple placeholders in one token (two replacements)', () => {
    expect(interpolateArgv(['${a}${b}'], 'test', { a: 'x', b: 'y' })).toEqual(['xy']);
  });
});

/* ============================================================
 * resolver/index.ts tests
 * ============================================================ */

function makeConfig(
  values: Record<string, string> = {},
  secretKeys: string[] = [],
): ResolvedConfig {
  return {
    values,
    provenance: {},
    secretKeys: new Set(secretKeys),
  };
}

function makeCommands(defs: Record<string, CommandDef>): CommandMap {
  return new Map(Object.entries(defs));
}

describe('resolver.resolve - single command', () => {
  it('resolves a simple single command to single ExecutionPlan', () => {
    const commands = makeCommands({
      build: { kind: 'single', cmd: ['npm', 'run', 'build'] },
    });
    const config = makeConfig();
    const plan = resolver.resolve('build', commands, config);
    expect(plan).toEqual({ kind: 'single', argv: ['npm', 'run', 'build'] });
  });

  it('resolves a single command with placeholder', () => {
    const commands = makeCommands({
      deploy: { kind: 'single', cmd: ['scp', '${user}@${host}:/app'] },
    });
    const config = makeConfig({ user: 'admin', host: 'srv.com' });
    const plan = resolver.resolve('deploy', commands, config);
    expect(plan).toEqual({ kind: 'single', argv: ['scp', 'admin@srv.com:/app'] });
  });

  it('throws UnknownAliasError for unknown alias', () => {
    const commands = makeCommands({});
    const config = makeConfig();
    expect(() => resolver.resolve('nonexistent', commands, config)).toThrow(UnknownAliasError);
    expect(() => resolver.resolve('nonexistent', commands, config)).toThrow('nonexistent');
  });

  it('handles $${} escape in single command', () => {
    const commands = makeCommands({
      test: { kind: 'single', cmd: ['echo', '$${VAR}'] },
    });
    const config = makeConfig();
    const plan = resolver.resolve('test', commands, config);
    expect(plan).toEqual({ kind: 'single', argv: ['echo', '${VAR}'] });
  });

  it('throws UndefinedPlaceholderError for missing placeholder in single command', () => {
    const commands = makeCommands({
      test: { kind: 'single', cmd: ['echo', '${missing}'] },
    });
    const config = makeConfig();
    expect(() => resolver.resolve('test', commands, config)).toThrow(UndefinedPlaceholderError);
  });
});

describe('resolver.resolve - platform overrides', () => {
  it('uses linux platform override when on linux', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const commands = makeCommands({
      open: {
        kind: 'single',
        cmd: ['open'],
        platforms: { linux: ['xdg-open'], macos: ['open'], windows: ['start'] },
      },
    });
    const config = makeConfig();
    const plan = resolver.resolve('open', commands, config);
    expect(plan).toEqual({ kind: 'single', argv: ['xdg-open'] });
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('throws CommandSchemaError for platform-only alias with no match for current OS', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const commands = makeCommands({
      cleanup: {
        kind: 'single',
        cmd: [],
        platforms: { windows: ['del', '/q', 'tmp'] },
      },
    });
    const config = makeConfig();
    expect(() => resolver.resolve('cleanup', commands, config)).toThrow(CommandSchemaError);
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });
});

describe('resolver.resolve - sequential', () => {
  it('resolves a sequential alias with inline steps', () => {
    const commands = makeCommands({
      ci: {
        kind: 'sequential',
        steps: ['npm run lint', 'npm run test', 'npm run build'],
      },
    });
    const config = makeConfig();
    const plan = resolver.resolve('ci', commands, config);
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps.map((s) => s.argv)).toEqual([
        ['npm', 'run', 'lint'],
        ['npm', 'run', 'test'],
        ['npm', 'run', 'build'],
      ]);
    }
  });

  it('resolves a sequential alias with alias refs', () => {
    const commands = makeCommands({
      lint: { kind: 'single', cmd: ['npm', 'run', 'lint'] },
      test: { kind: 'single', cmd: ['npm', 'run', 'test'] },
      ci: { kind: 'sequential', steps: ['lint', 'test'] },
    });
    const config = makeConfig();
    const plan = resolver.resolve('ci', commands, config);
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps.map((s) => s.argv)).toEqual([
        ['npm', 'run', 'lint'],
        ['npm', 'run', 'test'],
      ]);
    }
  });

  it('resolves mixed inline and alias ref steps', () => {
    const commands = makeCommands({
      lint: { kind: 'single', cmd: ['npm', 'run', 'lint'] },
      ci: { kind: 'sequential', steps: ['lint', 'npm run build'] },
    });
    const config = makeConfig();
    const plan = resolver.resolve('ci', commands, config);
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps.map((s) => s.argv)).toEqual([
        ['npm', 'run', 'lint'],
        ['npm', 'run', 'build'],
      ]);
    }
  });

  it('expands nested sequential alias steps inline', () => {
    const commands = makeCommands({
      lint: { kind: 'single', cmd: ['npm', 'run', 'lint'] },
      test: { kind: 'single', cmd: ['npm', 'run', 'test'] },
      checks: { kind: 'sequential', steps: ['lint', 'test'] },
      ci: { kind: 'sequential', steps: ['checks', 'npm run build'] },
    });
    const config = makeConfig();
    const plan = resolver.resolve('ci', commands, config);
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps.map((s) => s.argv)).toEqual([
        ['npm', 'run', 'lint'],
        ['npm', 'run', 'test'],
        ['npm', 'run', 'build'],
      ]);
    }
  });
});

describe('resolver.resolve - parallel', () => {
  it('resolves a parallel alias with inline entries', () => {
    const commands = makeCommands({
      watch: {
        kind: 'parallel',
        group: ['npm run watch:ts', 'npm run watch:css'],
      },
    });
    const config = makeConfig();
    const plan = resolver.resolve('watch', commands, config);
    expect(plan).toEqual({
      kind: 'parallel',
      failMode: 'fast',
      group: [
        { alias: 'npm run watch:ts', argv: ['npm', 'run', 'watch:ts'] },
        { alias: 'npm run watch:css', argv: ['npm', 'run', 'watch:css'] },
      ],
    });
  });

  it('resolves a parallel alias with alias refs', () => {
    const commands = makeCommands({
      'watch:ts': { kind: 'single', cmd: ['npm', 'run', 'watch:ts'] },
      'watch:css': { kind: 'single', cmd: ['npm', 'run', 'watch:css'] },
      watch: { kind: 'parallel', group: ['watch:ts', 'watch:css'] },
    });
    const config = makeConfig();
    const plan = resolver.resolve('watch', commands, config);
    expect(plan).toEqual({
      kind: 'parallel',
      failMode: 'fast',
      group: [
        { alias: 'watch:ts', argv: ['npm', 'run', 'watch:ts'] },
        { alias: 'watch:css', argv: ['npm', 'run', 'watch:css'] },
      ],
    });
  });
});

describe('resolver.resolve - depth cap', () => {
  it('throws CommandSchemaError when nesting depth exceeds 10', () => {
    // Create a chain of 12 sequential aliases, each referencing the next
    const defs: Record<string, CommandDef> = {};
    defs.cmd0 = { kind: 'single', cmd: ['echo', 'base'] };
    for (let i = 1; i <= 12; i++) {
      defs[`step${i}`] = {
        kind: 'sequential',
        steps: [i === 1 ? 'cmd0' : `step${i - 1}`],
      };
    }
    const commands = makeCommands(defs);
    const config = makeConfig();
    expect(() => resolver.resolve('step12', commands, config)).toThrow(CommandSchemaError);
  });
});

describe('resolver re-exports', () => {
  it('re-exports buildEnvVars', () => {
    // Import from index and verify it works
    const envVars = buildEnvVars({ 'deploy.host': 'server.com' });
    expect(envVars).toEqual({ DEPLOY_HOST: 'server.com' });
  });

  it('re-exports redactSecrets', () => {
    const result = redactSecrets({ API_KEY: 'secret' }, new Set(['api.key']));
    expect(result).toEqual({ API_KEY: '***' });
  });
});
