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
    expect(() =>
      resolver.resolve('deploy', makeCommands({ deploy: def }), makeConfig({})),
    ).toThrow(UndefinedPlaceholderError);
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
    if (!step || step.kind === 'set') throw new Error('unreachable');
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
    if (!step || step.kind === 'set') throw new Error('unreachable');
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
    if (!step || step.kind === 'set') throw new Error('unreachable');
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
    if (!step || step.kind === 'set') throw new Error('unreachable');
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
      if (step.kind === 'set') continue;
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
    if (!step || step.kind === 'set') throw new Error('unreachable');
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
    if (s0.kind === 'set' || s1.kind === 'set') throw new Error('unreachable');

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
    if (s0.kind === 'set' || s1.kind === 'set') throw new Error('unreachable');

    expect(s0.rawArgv).toEqual(['deploy', 'api', '--region', 'us']);
    expect(s1.rawArgv).toEqual(['deploy', 'web', '--region', 'us']);
  });
});
