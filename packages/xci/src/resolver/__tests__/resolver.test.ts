// src/resolver/__tests__/resolver.test.ts
//
// Tests for resolver modules: platform.ts, envvars.ts, interpolate.ts, and index.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XCI_BREADCRUMB_ENV } from '../../executor/nesting.js';
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
      expect(
        plan.steps
          .filter((s) => s.kind !== 'set' && s.kind !== 'prompt' && s.kind !== 'ini')
          .map((s) => (s as { argv: readonly string[] }).argv),
      ).toEqual([
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
      expect(
        plan.steps
          .filter((s) => s.kind !== 'set' && s.kind !== 'prompt' && s.kind !== 'ini')
          .map((s) => (s as { argv: readonly string[] }).argv),
      ).toEqual([
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
      expect(
        plan.steps
          .filter((s) => s.kind !== 'set' && s.kind !== 'prompt' && s.kind !== 'ini')
          .map((s) => (s as { argv: readonly string[] }).argv),
      ).toEqual([
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
      expect(
        plan.steps
          .filter((s) => s.kind !== 'set' && s.kind !== 'prompt' && s.kind !== 'ini')
          .map((s) => (s as { argv: readonly string[] }).argv),
      ).toEqual([
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
        { alias: 'npm run watch:ts', argv: ['npm', 'run', 'watch:ts'], breadcrumb: ['watch'] },
        { alias: 'npm run watch:css', argv: ['npm', 'run', 'watch:css'], breadcrumb: ['watch'] },
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
        { alias: 'watch:ts', argv: ['npm', 'run', 'watch:ts'], breadcrumb: ['watch', 'watch:ts'] },
        {
          alias: 'watch:css',
          argv: ['npm', 'run', 'watch:css'],
          breadcrumb: ['watch', 'watch:css'],
        },
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

/* ============================================================
 * resolver.resolve - for_each with string in (CSV-split, quick-260421-ewq)
 * ============================================================ */

describe('resolver — for_each with string in (CSV-split)', () => {
  it('sequential mode: CSV-splits interpolated string into 2 steps', () => {
    const def: CommandDef = {
      kind: 'for_each',
      var: 'region',
      in: '${AwsLocations}',
      mode: 'steps',
      cmd: ['echo', '${region}'],
    };
    const plan = resolver.resolve(
      'deploy',
      makeCommands({ deploy: def }),
      makeConfig({ AwsLocations: 'eu-west-1,us-east-1' }),
    );
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    const s0 = plan.steps[0];
    const s1 = plan.steps[1];
    if (!s0 || !s1) throw new Error('unreachable');
    expect('argv' in s0 && s0.argv).toEqual(['echo', 'eu-west-1']);
    expect('argv' in s1 && s1.argv).toEqual(['echo', 'us-east-1']);
  });

  it('trims whitespace and drops empty entries', () => {
    const def: CommandDef = {
      kind: 'for_each',
      var: 'region',
      in: '${AwsLocations}',
      mode: 'steps',
      cmd: ['echo', '${region}'],
    };
    const plan = resolver.resolve(
      'deploy',
      makeCommands({ deploy: def }),
      makeConfig({ AwsLocations: ' a , , b ' }),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    const s0 = plan.steps[0];
    const s1 = plan.steps[1];
    if (!s0 || !s1) throw new Error('unreachable');
    expect('argv' in s0 && s0.argv).toEqual(['echo', 'a']);
    expect('argv' in s1 && s1.argv).toEqual(['echo', 'b']);
  });

  it('throws when CSV split yields zero entries', () => {
    const def: CommandDef = {
      kind: 'for_each',
      var: 'region',
      in: '${X}',
      mode: 'steps',
      cmd: ['echo', '${region}'],
    };
    expect(() =>
      resolver.resolve('deploy', makeCommands({ deploy: def }), makeConfig({ X: ' , , ' })),
    ).toThrow(/empty after CSV split/);
  });

  it('parallel mode: CSV-splits into group entries with default failMode fast', () => {
    const def: CommandDef = {
      kind: 'for_each',
      var: 'region',
      in: '${AwsLocations}',
      mode: 'parallel',
      cmd: ['echo', '${region}'],
    };
    const plan = resolver.resolve(
      'deploy',
      makeCommands({ deploy: def }),
      makeConfig({ AwsLocations: 'eu-west-1,us-east-1' }),
    );
    expect(plan.kind).toBe('parallel');
    if (plan.kind !== 'parallel') throw new Error('unreachable');
    expect(plan.group).toHaveLength(2);
    expect(plan.failMode).toBe('fast');
    expect(plan.group[0]?.argv).toEqual(['echo', 'eu-west-1']);
    expect(plan.group[1]?.argv).toEqual(['echo', 'us-east-1']);
  });

  it('throws UndefinedPlaceholderError when the referenced var is missing', () => {
    const def: CommandDef = {
      kind: 'for_each',
      var: 'region',
      in: '${AwsLocations}',
      mode: 'steps',
      cmd: ['echo', '${region}'],
    };
    expect(() => resolver.resolve('deploy', makeCommands({ deploy: def }), makeConfig({}))).toThrow(
      UndefinedPlaceholderError,
    );
  });
});

/* ============================================================
 * resolver — for_each bakes loop variable into rawArgv
 * (regression test for quick-260421-lhg: runtime re-interpolation
 * was throwing UndefinedPlaceholderError for the loop var because
 * rawArgv retained the raw ${loopVar} placeholder)
 * ============================================================ */

describe('resolver — for_each bakes loop variable into rawArgv (runtime re-interpolation fix)', () => {
  it('inline cmd: bakes loop var into rawArgv, preserves captured-var placeholder', () => {
    const def: CommandDef = {
      kind: 'for_each',
      var: 'region',
      in: ['eu-west-1', 'us-east-1'],
      mode: 'steps',
      cmd: ['deploy', '--region', '${region}', '--fleet', '${FleetId}'],
    };
    const plan = resolver.resolve(
      'deploy-all',
      makeCommands({ 'deploy-all': def }),
      makeConfig({}),
    );
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    const s0 = plan.steps[0];
    const s1 = plan.steps[1];
    if (!s0 || !s1) throw new Error('unreachable');
    // Both argv and rawArgv have loop var substituted; ${FleetId} survives untouched
    expect('argv' in s0 ? s0.argv : null).toEqual([
      'deploy',
      '--region',
      'eu-west-1',
      '--fleet',
      '${FleetId}',
    ]);
    expect('rawArgv' in s0 ? s0.rawArgv : null).toEqual([
      'deploy',
      '--region',
      'eu-west-1',
      '--fleet',
      '${FleetId}',
    ]);
    expect('argv' in s1 ? s1.argv : null).toEqual([
      'deploy',
      '--region',
      'us-east-1',
      '--fleet',
      '${FleetId}',
    ]);
    expect('rawArgv' in s1 ? s1.rawArgv : null).toEqual([
      'deploy',
      '--region',
      'us-east-1',
      '--fleet',
      '${FleetId}',
    ]);
  });

  it('run: sub-alias: bakes outer loop var into sub-step rawArgv, preserves captured-var placeholder', () => {
    const commands = makeCommands({
      'deploy-one': {
        kind: 'single',
        cmd: ['deploy', '--region', '${region}', '--fleet', '${FleetId}'],
      },
      'deploy-all': {
        kind: 'for_each',
        var: 'region',
        in: ['eu-west-1', 'us-east-1'],
        mode: 'steps',
        run: 'deploy-one',
      },
    });
    const plan = resolver.resolve('deploy-all', commands, makeConfig({}));
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    const s0 = plan.steps[0];
    const s1 = plan.steps[1];
    if (!s0 || !s1) throw new Error('unreachable');
    expect('rawArgv' in s0 ? s0.rawArgv : null).toEqual([
      'deploy',
      '--region',
      'eu-west-1',
      '--fleet',
      '${FleetId}',
    ]);
    expect('rawArgv' in s1 ? s1.rawArgv : null).toEqual([
      'deploy',
      '--region',
      'us-east-1',
      '--fleet',
      '${FleetId}',
    ]);
  });

  it('non-for_each sequential step keeps ${CapturedVar} in rawArgv intact (no regression)', () => {
    const commands = makeCommands({
      prep: {
        kind: 'sequential',
        steps: ['deploy --fleet ${FleetId}'],
      },
    });
    const plan = resolver.resolve('prep', commands, makeConfig({}));
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const s0 = plan.steps[0];
    if (!s0 || !('rawArgv' in s0)) throw new Error('unreachable');
    // rawArgv comes from tokenize('deploy --fleet ${FleetId}', ...)
    // — three tokens, last one unchanged ${FleetId}
    expect(s0.rawArgv).toEqual(['deploy', '--fleet', '${FleetId}']);
    expect('argv' in s0 ? s0.argv : null).toEqual(['deploy', '--fleet', '${FleetId}']);
  });

  it('end-to-end: baked rawArgv + captured vars at runtime produces final argv without throwing', () => {
    const def: CommandDef = {
      kind: 'for_each',
      var: 'region',
      in: ['eu-west-1'],
      mode: 'steps',
      cmd: ['deploy', '--region', '${region}', '--fleet', '${FleetId}'],
    };
    const plan = resolver.resolve(
      'deploy-all',
      makeCommands({ 'deploy-all': def }),
      makeConfig({}),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const s0 = plan.steps[0];
    if (!s0 || !('rawArgv' in s0) || s0.rawArgv === undefined) throw new Error('unreachable');
    // Simulate executor/sequential.ts:186-187
    const finalArgv = interpolateArgv(s0.rawArgv, '(step)', { FleetId: 'fleet-abc' });
    expect(finalArgv).toEqual(['deploy', '--region', 'eu-west-1', '--fleet', 'fleet-abc']);
  });

  it('nested for_each: outer then inner loop vars baked, captured var preserved', () => {
    const commands = makeCommands({
      inner: {
        kind: 'for_each',
        var: 'env',
        in: ['dev', 'prod'],
        mode: 'steps',
        cmd: ['deploy', '--region', '${region}', '--env', '${env}', '--fleet', '${FleetId}'],
      },
      outer: {
        kind: 'for_each',
        var: 'region',
        in: ['eu', 'us'],
        mode: 'steps',
        run: 'inner',
      },
    });
    const plan = resolver.resolve('outer', commands, makeConfig({}));
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(4);
    const expected = [
      ['deploy', '--region', 'eu', '--env', 'dev', '--fleet', '${FleetId}'],
      ['deploy', '--region', 'eu', '--env', 'prod', '--fleet', '${FleetId}'],
      ['deploy', '--region', 'us', '--env', 'dev', '--fleet', '${FleetId}'],
      ['deploy', '--region', 'us', '--env', 'prod', '--fleet', '${FleetId}'],
    ];
    for (let i = 0; i < 4; i++) {
      const s = plan.steps[i];
      if (!s || !('rawArgv' in s)) throw new Error('unreachable');
      expect(s.rawArgv).toEqual(expected[i]);
    }
  });
});

/* ============================================================
 * resolver.resolve - cwd field + parent→child inheritance (quick-260421-g99)
 * ============================================================ */

describe('resolver — cwd field', () => {
  it('emits cwd on a single plan when def has a static cwd', () => {
    const plan = resolver.resolve(
      'build',
      makeCommands({ build: { kind: 'single', cmd: ['echo', 'hi'], cwd: 'sub' } }),
      makeConfig(),
    );
    expect(plan.kind).toBe('single');
    if (plan.kind !== 'single') throw new Error('unreachable');
    expect(plan.cwd).toBe('sub');
  });

  it('lenient-interpolates ${placeholder} cwd at resolve time', () => {
    const plan = resolver.resolve(
      'build',
      makeCommands({ build: { kind: 'single', cmd: ['echo', 'hi'], cwd: '${dir}' } }),
      makeConfig({ dir: 'foo' }),
    );
    if (plan.kind !== 'single') throw new Error('unreachable');
    expect(plan.cwd).toBe('foo');
  });

  it('plan.cwd is undefined when def has no cwd', () => {
    const plan = resolver.resolve(
      'build',
      makeCommands({ build: { kind: 'single', cmd: ['echo', 'hi'] } }),
      makeConfig(),
    );
    if (plan.kind !== 'single') throw new Error('unreachable');
    expect(plan.cwd).toBeUndefined();
  });

  it('sequential parent cwd inherits to child with no cwd', () => {
    const plan = resolver.resolve(
      'pipe',
      makeCommands({
        pipe: { kind: 'sequential', steps: ['child'], cwd: 'a' },
        child: { kind: 'single', cmd: ['echo', 'hi'] },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const step = plan.steps[0];
    if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
      throw new Error('unreachable');
    expect(step.cwd).toBe('a');
  });

  it('child cwd wins over parent cwd', () => {
    const plan = resolver.resolve(
      'pipe',
      makeCommands({
        pipe: { kind: 'sequential', steps: ['child'], cwd: 'a' },
        child: { kind: 'single', cmd: ['echo', 'hi'], cwd: 'b' },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const step = plan.steps[0];
    if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
      throw new Error('unreachable');
    expect(step.cwd).toBe('b');
  });

  it('sequential parent with no cwd: child-only cwd still surfaces', () => {
    const plan = resolver.resolve(
      'pipe',
      makeCommands({
        pipe: { kind: 'sequential', steps: ['child'] },
        child: { kind: 'single', cmd: ['echo', 'hi'], cwd: 'b' },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const step = plan.steps[0];
    if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
      throw new Error('unreachable');
    expect(step.cwd).toBe('b');
  });

  it('inline sequential step inherits parent cwd', () => {
    const plan = resolver.resolve(
      'pipe',
      makeCommands({
        pipe: { kind: 'sequential', steps: ['echo hello'], cwd: 'a' },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const step = plan.steps[0];
    if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
      throw new Error('unreachable');
    expect(step.cwd).toBe('a');
  });

  it('set step does NOT receive cwd', () => {
    const plan = resolver.resolve(
      'pipe',
      makeCommands({
        pipe: { kind: 'sequential', steps: ['X=hello', 'echo ${X}'], cwd: 'a' },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const setStep = plan.steps[0];
    if (!setStep || setStep.kind !== 'set') throw new Error('expected set step');
    expect(setStep).not.toHaveProperty('cwd');
  });

  it('parallel cwd propagates to every group entry', () => {
    const plan = resolver.resolve(
      'group',
      makeCommands({
        group: { kind: 'parallel', group: ['a', 'b'], cwd: 'shared' },
        a: { kind: 'single', cmd: ['echo', 'a'] },
        b: { kind: 'single', cmd: ['echo', 'b'] },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'parallel') throw new Error('unreachable');
    expect(plan.group[0]?.cwd).toBe('shared');
    expect(plan.group[1]?.cwd).toBe('shared');
  });

  it('parallel without cwd: only entries with own cwd carry one', () => {
    const plan = resolver.resolve(
      'group',
      makeCommands({
        group: { kind: 'parallel', group: ['a', 'b'] },
        a: { kind: 'single', cmd: ['echo', 'a'] },
        b: { kind: 'single', cmd: ['echo', 'b'], cwd: 'e' },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'parallel') throw new Error('unreachable');
    expect(plan.group[0]?.cwd).toBeUndefined();
    expect(plan.group[1]?.cwd).toBe('e');
  });

  it('for_each (sequential mode with inline cmd) applies cwd to every expanded step', () => {
    const plan = resolver.resolve(
      'deploy',
      makeCommands({
        deploy: {
          kind: 'for_each',
          var: 'region',
          in: ['us', 'eu'],
          mode: 'steps',
          cmd: ['echo', '${region}'],
          cwd: 'deploy',
        },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    for (const step of plan.steps) {
      if (step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini') continue;
      expect(step.cwd).toBe('deploy');
    }
  });

  it('for_each (parallel mode with inline cmd) applies cwd to every group entry', () => {
    const plan = resolver.resolve(
      'deploy',
      makeCommands({
        deploy: {
          kind: 'for_each',
          var: 'region',
          in: ['us', 'eu'],
          mode: 'parallel',
          cmd: ['echo', '${region}'],
          cwd: 'deploy',
        },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'parallel') throw new Error('unreachable');
    expect(plan.group).toHaveLength(2);
    for (const entry of plan.group) {
      expect(entry.cwd).toBe('deploy');
    }
  });

  it('ini kind carries cwd through to plan', () => {
    const plan = resolver.resolve(
      'cfg',
      makeCommands({
        cfg: {
          kind: 'ini',
          file: 'x.ini',
          set: { Section: { k: 'v' } },
          cwd: 'work',
        },
      }),
      makeConfig(),
    );
    expect(plan.kind).toBe('ini');
    if (plan.kind !== 'ini') throw new Error('unreachable');
    expect(plan.cwd).toBe('work');
  });

  it('grandparent cwd reaches grandchild through middle sequential', () => {
    const plan = resolver.resolve(
      'release',
      makeCommands({
        release: { kind: 'sequential', steps: ['mid'], cwd: 'grand' },
        mid: { kind: 'sequential', steps: ['leaf'] },
        leaf: { kind: 'single', cmd: ['echo', 'x'] },
      }),
      makeConfig(),
    );
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const step = plan.steps[0];
    if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
      throw new Error('unreachable');
    expect(step.cwd).toBe('grand');
  });
});

/* ============================================================
 * resolver.resolve - for_each rawArgv bakes loop variable (quick-260422-dfh)
 * ============================================================ */

describe('for_each rawArgv bakes loop variable', () => {
  it('strict path (inline cmd): rawArgv has loop variable replaced for each step', () => {
    const def: CommandDef = {
      kind: 'for_each',
      var: 'svc',
      in: ['api', 'web'],
      mode: 'steps',
      cmd: ['deploy', '${svc}', '--region', 'us'],
    };
    const plan = resolver.resolve('deploy-all', makeCommands({ 'deploy-all': def }), makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);

    const s0 = plan.steps[0];
    const s1 = plan.steps[1];
    if (!s0 || !s1) throw new Error('unreachable');
    if (
      s0.kind === 'set' ||
      s0.kind === 'prompt' ||
      s0.kind === 'ini' ||
      s0.kind === 'uproject' ||
      s0.kind === 'unreadonly' ||
      s0.kind === 'xci'
    )
      throw new Error('unreachable');
    if (
      s1.kind === 'set' ||
      s1.kind === 'prompt' ||
      s1.kind === 'ini' ||
      s1.kind === 'uproject' ||
      s1.kind === 'unreadonly' ||
      s1.kind === 'xci'
    )
      throw new Error('unreachable');

    // rawArgv must NOT contain the unresolved ${svc} placeholder
    expect(s0.rawArgv).toEqual(['deploy', 'api', '--region', 'us']);
    expect(s1.rawArgv).toEqual(['deploy', 'web', '--region', 'us']);
  });

  it('lenient path (for_each with run referencing alias): rawArgv has loop variable replaced', () => {
    // The lenient path (resolveToStepsLenient) is exercised when for_each uses `run`
    // pointing to another alias. That alias is resolved via resolveToStepsLenient which
    // has its own for_each inline-cmd branch.
    const def: CommandDef = {
      kind: 'for_each',
      var: 'svc',
      in: ['api', 'web'],
      mode: 'steps',
      cmd: ['deploy', '${svc}', '--region', 'us'],
    };
    // Use a sequential wrapper so the for_each is resolved via resolveToStepsLenient
    const commands = makeCommands({
      'deploy-all': def,
      wrapper: { kind: 'sequential', steps: ['deploy-all'] },
    });
    const plan = resolver.resolve('wrapper', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);

    const s0 = plan.steps[0];
    const s1 = plan.steps[1];
    if (!s0 || !s1) throw new Error('unreachable');
    if (
      s0.kind === 'set' ||
      s0.kind === 'prompt' ||
      s0.kind === 'ini' ||
      s0.kind === 'uproject' ||
      s0.kind === 'unreadonly' ||
      s0.kind === 'xci'
    )
      throw new Error('unreachable');
    if (
      s1.kind === 'set' ||
      s1.kind === 'prompt' ||
      s1.kind === 'ini' ||
      s1.kind === 'uproject' ||
      s1.kind === 'unreadonly' ||
      s1.kind === 'xci'
    )
      throw new Error('unreachable');

    expect(s0.rawArgv).toEqual(['deploy', 'api', '--region', 'us']);
    expect(s1.rawArgv).toEqual(['deploy', 'web', '--region', 'us']);
  });
});

/* ============================================================
 * cwd inheritance — nested sub-aliases and for_each (quick-260422-mxr)
 * Verification-only: expected to pass against current resolver (Phase
 * quick-260421-g99 already wired computeEffectiveCwd + parentCwd).
 * ============================================================ */

describe('cwd inheritance — nested sub-aliases and for_each', () => {
  it('leaf inherits outer sequential cwd through middle sequential that has no own cwd', () => {
    const commands = makeCommands({
      outer: { kind: 'sequential', steps: ['middle'], cwd: '/top' },
      middle: { kind: 'sequential', steps: ['leaf'] },
      leaf: { kind: 'single', cmd: ['echo', 'hi'] },
    });
    const plan = resolver.resolve('outer', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps).toHaveLength(1);
      const step = plan.steps[0];
      if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
        throw new Error('unreachable');
      expect(step.cwd).toBe('/top');
    }
  });

  it('middle sequential cwd overrides outer cwd for downstream leaf', () => {
    const commands = makeCommands({
      outer: { kind: 'sequential', steps: ['middle'], cwd: '/top' },
      middle: { kind: 'sequential', steps: ['leaf'], cwd: '/mid' },
      leaf: { kind: 'single', cmd: ['echo', 'hi'] },
    });
    const plan = resolver.resolve('outer', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps).toHaveLength(1);
      const step = plan.steps[0];
      if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
        throw new Error('unreachable');
      expect(step.cwd).toBe('/mid');
    }
  });

  it('for_each without own cwd inherits outer sequential cwd for each iteration (run mode)', () => {
    const commands = makeCommands({
      outer: { kind: 'sequential', steps: ['loop'], cwd: '/top' },
      loop: { kind: 'for_each', var: 'x', in: ['a', 'b'], mode: 'steps', run: 'leaf' },
      leaf: { kind: 'single', cmd: ['echo', '${x}'] },
    });
    const plan = resolver.resolve('outer', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps).toHaveLength(2);
      const s0 = plan.steps[0];
      const s1 = plan.steps[1];
      if (!s0 || s0.kind === 'set' || s0.kind === 'prompt' || s0.kind === 'ini')
        throw new Error('unreachable');
      if (!s1 || s1.kind === 'set' || s1.kind === 'prompt' || s1.kind === 'ini')
        throw new Error('unreachable');
      expect(s0.cwd).toBe('/top');
      expect(s1.cwd).toBe('/top');
    }
  });

  it('for_each with own cwd overrides outer sequential cwd', () => {
    const commands = makeCommands({
      outer: { kind: 'sequential', steps: ['loop'], cwd: '/top' },
      loop: {
        kind: 'for_each',
        var: 'x',
        in: ['a'],
        mode: 'steps',
        run: 'leaf',
        cwd: '/loop',
      },
      leaf: { kind: 'single', cmd: ['echo', 'hi'] },
    });
    const plan = resolver.resolve('outer', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps).toHaveLength(1);
      const step = plan.steps[0];
      if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
        throw new Error('unreachable');
      expect(step.cwd).toBe('/loop');
    }
  });

  it('for_each inline cmd inherits outer sequential cwd', () => {
    const commands = makeCommands({
      outer: { kind: 'sequential', steps: ['loop'], cwd: '/top' },
      loop: {
        kind: 'for_each',
        var: 'x',
        in: ['a'],
        mode: 'steps',
        cmd: ['echo', '${x}'],
      },
    });
    const plan = resolver.resolve('outer', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.steps).toHaveLength(1);
      const step = plan.steps[0];
      if (!step || step.kind === 'set' || step.kind === 'prompt' || step.kind === 'ini')
        throw new Error('unreachable');
      expect(step.cwd).toBe('/top');
    }
  });
});

/* ============================================================
 * resolver.resolve - breadcrumb (quick-260421-kbl)
 * ============================================================ */

describe('resolver.resolve - breadcrumb (quick-260421-kbl)', () => {
  it('Test 1: nested sequential — each step carries the full containing path', () => {
    const commands = makeCommands({
      A1a: { kind: 'single', cmd: ['echo', 'a1a'] },
      A1b: { kind: 'single', cmd: ['echo', 'a1b'] },
      A2: { kind: 'single', cmd: ['echo', 'a2'] },
      A1: { kind: 'sequential', steps: ['A1a', 'A1b'] },
      A: { kind: 'sequential', steps: ['A1', 'A2'] },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(3);
    const s0 = plan.steps[0];
    const s1 = plan.steps[1];
    const s2 = plan.steps[2];
    if (!s0 || !s1 || !s2) throw new Error('unreachable');
    expect(s0.breadcrumb).toEqual(['A', 'A1', 'A1a']);
    expect(s1.breadcrumb).toEqual(['A', 'A1', 'A1b']);
    expect(s2.breadcrumb).toEqual(['A', 'A2']);
  });

  it('Test 2: inline step inside a sub-sequential inherits chain of containing alias', () => {
    const commands = makeCommands({
      A1: { kind: 'sequential', steps: ['echo hi'] },
      A: { kind: 'sequential', steps: ['A1'] },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const s0 = plan.steps[0];
    if (!s0) throw new Error('unreachable');
    expect(s0.breadcrumb).toEqual(['A', 'A1']);
  });

  it('Test 3: top-level sequential alias with only inline commands — breadcrumb = ["A"]', () => {
    const commands = makeCommands({
      A: { kind: 'sequential', steps: ['echo one', 'echo two'] },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    for (const step of plan.steps) {
      expect(step.breadcrumb).toEqual(['A']);
    }
  });

  it('Test 4: top-level SINGLE alias does NOT get a breadcrumb field on the plan', () => {
    const commands = makeCommands({
      A: { kind: 'single', cmd: ['echo', 'hi'] },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    expect(plan.kind).toBe('single');
    expect((plan as Record<string, unknown>).breadcrumb).toBeUndefined();
  });

  it('Test 5: for_each with `run: sub-alias` stamps breadcrumb including sub-alias name', () => {
    const commands = makeCommands({
      greet: { kind: 'single', cmd: ['echo', 'hello ${name}'] },
      A: {
        kind: 'for_each',
        var: 'name',
        in: ['alice', 'bob'],
        mode: 'steps',
        run: 'greet',
      },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    for (const step of plan.steps) {
      expect(step.breadcrumb).toEqual(['A', 'greet']);
    }
  });

  it('Test 6: for_each with inline cmd (no run) — breadcrumb = chain to the for_each alias only', () => {
    const commands = makeCommands({
      A: {
        kind: 'for_each',
        var: 'n',
        in: ['1', '2'],
        mode: 'steps',
        cmd: ['echo', '${n}'],
      },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    for (const step of plan.steps) {
      expect(step.breadcrumb).toEqual(['A']);
    }
  });

  it('Test 7: parallel group with sub-alias entries — each entry carries breadcrumb', () => {
    const commands = makeCommands({
      lint: { kind: 'single', cmd: ['npm', 'run', 'lint'] },
      test: { kind: 'single', cmd: ['npm', 'run', 'test'] },
      A: { kind: 'parallel', group: ['lint', 'test'] },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    expect(plan.kind).toBe('parallel');
    if (plan.kind !== 'parallel') throw new Error('unreachable');
    expect(plan.group[0]?.breadcrumb).toEqual(['A', 'lint']);
    expect(plan.group[1]?.breadcrumb).toEqual(['A', 'test']);
  });

  it('Test 8: parallel group with inline entries — breadcrumb = ["A"]', () => {
    const commands = makeCommands({
      A: { kind: 'parallel', group: ['echo one', 'echo two'] },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    if (plan.kind !== 'parallel') throw new Error('unreachable');
    expect(plan.group[0]?.breadcrumb).toEqual(['A']);
    expect(plan.group[1]?.breadcrumb).toEqual(['A']);
  });

  it('Test 9: regression for "expands nested sequential alias steps inline" — breadcrumb is additive', () => {
    const commands = makeCommands({
      lint: { kind: 'single', cmd: ['npm', 'run', 'lint'] },
      test: { kind: 'single', cmd: ['npm', 'run', 'test'] },
      checks: { kind: 'sequential', steps: ['lint', 'test'] },
      ci: { kind: 'sequential', steps: ['checks', 'npm run build'] },
    });
    const plan = resolver.resolve('ci', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    // Existing argv assertion preserved
    expect(plan.steps.map((s) => ('argv' in s ? s.argv : null))).toEqual([
      ['npm', 'run', 'lint'],
      ['npm', 'run', 'test'],
      ['npm', 'run', 'build'],
    ]);
    // New breadcrumb assertion
    expect(plan.steps.map((s) => s.breadcrumb)).toEqual([
      ['ci', 'checks', 'lint'],
      ['ci', 'checks', 'test'],
      ['ci'],
    ]);
  });
});

/* ============================================================
 * resolver.resolve - XCI_BREADCRUMB prefix seeding (quick-260623-ipz)
 * ============================================================ */

describe('resolver.resolve - XCI_BREADCRUMB prefix seeding (quick-260623-ipz)', () => {
  // Isolate XCI_BREADCRUMB env from the outer process so these tests
  // do NOT pollute the existing Tests 1-9 above (vitest runs in same process).
  let origBreadcrumb: string | undefined;

  beforeEach(() => {
    origBreadcrumb = process.env[XCI_BREADCRUMB_ENV];
  });

  afterEach(() => {
    if (origBreadcrumb === undefined) {
      delete process.env[XCI_BREADCRUMB_ENV];
    } else {
      process.env[XCI_BREADCRUMB_ENV] = origBreadcrumb;
    }
  });

  it('with XCI_BREADCRUMB unset, existing breadcrumb behavior is unchanged (byte-identical)', () => {
    delete process.env[XCI_BREADCRUMB_ENV];
    const commands = makeCommands({
      A1a: { kind: 'single', cmd: ['echo', 'a1a'] },
      A1: { kind: 'sequential', steps: ['A1a'] },
      A: { kind: 'sequential', steps: ['A1'] },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const s0 = plan.steps[0];
    if (!s0) throw new Error('unreachable');
    // byte-identical to today: prefix=[] so seed=['A']
    expect(s0.breadcrumb).toEqual(['A', 'A1', 'A1a']);
  });

  it("with XCI_BREADCRUMB='outer > mid', nested sequential breadcrumb is prefixed", () => {
    process.env[XCI_BREADCRUMB_ENV] = 'outer > mid';
    const commands = makeCommands({
      A1a: { kind: 'single', cmd: ['echo', 'a1a'] },
      A1: { kind: 'sequential', steps: ['A1a'] },
      A: { kind: 'sequential', steps: ['A1'] },
    });
    const plan = resolver.resolve('A', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    const s0 = plan.steps[0];
    if (!s0) throw new Error('unreachable');
    // prefix=['outer','mid'], seed=['outer','mid','A'] → chain grows to ['outer','mid','A','A1','A1a']
    expect(s0.breadcrumb).toEqual(['outer', 'mid', 'A', 'A1', 'A1a']);
  });

  it('depth-cap guard: a LONG XCI_BREADCRUMB prefix (20 segments) + shallow real nesting does NOT throw', () => {
    // Build a 20-segment prefix. This only enriches the breadcrumb display —
    // depth is tracked INDEPENDENTLY (starts at 0 regardless of prefix length).
    const longPrefix = Array.from({ length: 20 }, (_, i) => `seg${i}`).join(' > ');
    process.env[XCI_BREADCRUMB_ENV] = longPrefix;
    const commands = makeCommands({
      leaf: { kind: 'single', cmd: ['echo', 'hi'] },
      mid: { kind: 'sequential', steps: ['leaf'] }, // depth 1
      top: { kind: 'sequential', steps: ['mid'] }, // depth 2
    });
    // Must NOT throw CommandSchemaError about depth cap
    expect(() => resolver.resolve('top', commands, makeConfig())).not.toThrow();
    const plan = resolver.resolve('top', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
  });
});

/* ============================================================
 * resolver.resolve — unreadonly kind (quick-260624-fse)
 * ============================================================ */

describe('resolver.resolve — unreadonly kind', () => {
  it('standalone unreadonly alias resolves to ExecutionPlan kind unreadonly with interpolated path', () => {
    const def: CommandDef = { kind: 'unreadonly', path: './readme.md' };
    const plan = resolver.resolve('unlock', makeCommands({ unlock: def }), makeConfig());
    expect(plan.kind).toBe('unreadonly');
    if (plan.kind !== 'unreadonly') throw new Error('unreachable');
    expect(plan.path).toBe('./readme.md');
    expect(plan.recursive).toBe(false); // default applied at resolve time
  });

  it('unreadonly with recursive: true resolves with recursive: true', () => {
    const def: CommandDef = { kind: 'unreadonly', path: './Binaries', recursive: true };
    const plan = resolver.resolve('unlock-bin', makeCommands({ 'unlock-bin': def }), makeConfig());
    expect(plan.kind).toBe('unreadonly');
    if (plan.kind !== 'unreadonly') throw new Error('unreachable');
    expect(plan.path).toBe('./Binaries');
    expect(plan.recursive).toBe(true);
  });

  it('unreadonly path supports ${VAR} interpolation', () => {
    const def: CommandDef = { kind: 'unreadonly', path: './dist/${BUILD_TARGET}' };
    const config = makeConfig({ BUILD_TARGET: 'release' });
    const plan = resolver.resolve('unlock-dist', makeCommands({ 'unlock-dist': def }), config);
    expect(plan.kind).toBe('unreadonly');
    if (plan.kind !== 'unreadonly') throw new Error('unreachable');
    expect(plan.path).toBe('./dist/release');
  });

  it('unreadonly as a sequential step resolves to SequentialStep kind unreadonly with breadcrumb', () => {
    const commands = makeCommands({
      unlock: { kind: 'unreadonly', path: './file.txt' },
      setup: { kind: 'sequential', steps: ['unlock'] },
    });
    const plan = resolver.resolve('setup', commands, makeConfig());
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(1);
    const step = plan.steps[0];
    expect(step?.kind).toBe('unreadonly');
    if (!step || step.kind !== 'unreadonly') throw new Error('unreachable');
    expect(step.path).toBe('./file.txt');
    expect(step.recursive).toBe(false);
    expect(step.breadcrumb).toContain('unlock');
  });
});

/* ============================================================
 * resolver — for_each bakes loop variable into step.cwd (quick-260630-uq4)
 * Regression: bakeLoopVarIntoRawArgv must also bake loop var into step.cwd,
 * not just into rawArgv. A for_each with cwd:'${region}' produces effectiveCwd
 * '${region}' (computed from config without loop var); sub-steps inherit that
 * cwd. Without the fix the step has cwd:'${region}' after resolve; at runtime
 * resolveRuntimeCwd throws UndefinedPlaceholderError because region is not a
 * captured var.
 * ============================================================ */

describe('resolver — for_each bakes loop variable into step.cwd (quick-260630-uq4)', () => {
  it('(a) for_each with cwd "${region}" and run sub-alias (no own cwd): bakes per-iteration', () => {
    // for_each has cwd:'${region}'. computeEffectiveCwd is called with config (no loop var)
    // so effectiveCwd='${region}'. Sub-steps inherit it as parentCwd. bakeLoopVarIntoRawArgv
    // must bake '${region}' → 'eu'/'us' on each step.
    const commands = makeCommands({
      'deploy-one': {
        kind: 'single',
        cmd: ['echo', 'deploying'],
        // NO own cwd — inherits effectiveCwd from for_each parent
      },
      'deploy-all': {
        kind: 'for_each',
        var: 'region',
        in: ['eu', 'us'],
        mode: 'steps',
        run: 'deploy-one',
        cwd: '${region}',
      },
    });
    const plan = resolver.resolve('deploy-all', commands, makeConfig({}));
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    const s0 = plan.steps[0];
    const s1 = plan.steps[1];
    if (!s0 || !s1) throw new Error('unreachable');
    // Loop var baked: placeholder must be gone
    expect(s0.cwd).toBe('eu');
    expect(s1.cwd).toBe('us');
  });

  it('(b) mixed cwd "${region}/${CAPTURED}": loop var baked, captured placeholder preserved', () => {
    const commands = makeCommands({
      'deploy-one': {
        kind: 'single',
        cmd: ['echo', 'deploying'],
      },
      'deploy-all': {
        kind: 'for_each',
        var: 'region',
        in: ['eu', 'us'],
        mode: 'steps',
        run: 'deploy-one',
        cwd: '${region}/${CAPTURED}',
      },
    });
    const plan = resolver.resolve('deploy-all', commands, makeConfig({}));
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.cwd).toBe('eu/${CAPTURED}');
    expect(plan.steps[1]?.cwd).toBe('us/${CAPTURED}');
  });

  it('(c) regression: for_each body step with no cwd has no cwd, rawArgv still baked', () => {
    const commands = makeCommands({
      'deploy-one': {
        kind: 'single',
        cmd: ['echo', '${region}'],
        // NO cwd
      },
      'deploy-all': {
        kind: 'for_each',
        var: 'region',
        in: ['eu'],
        mode: 'steps',
        run: 'deploy-one',
        // No cwd on for_each
      },
    });
    const plan = resolver.resolve('deploy-all', commands, makeConfig({}));
    expect(plan.kind).toBe('sequential');
    if (plan.kind !== 'sequential') throw new Error('unreachable');
    expect(plan.steps).toHaveLength(1);
    const s0 = plan.steps[0];
    if (!s0) throw new Error('unreachable');
    // No cwd added
    expect(s0.cwd).toBeUndefined();
    // rawArgv still has loop var baked (existing behaviour)
    if (!('rawArgv' in s0) || s0.rawArgv === undefined) throw new Error('unreachable');
    expect(s0.rawArgv).toEqual(['echo', 'eu']);
  });
});
