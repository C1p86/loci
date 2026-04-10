// src/__tests__/errors.test.ts
import { describe, expect, it } from 'vitest';
import {
  CircularAliasError,
  CliError,
  CommandError,
  CommandSchemaError,
  ConfigError,
  ConfigReadError,
  ExecutorError,
  ExitCode,
  exitCodeFor,
  InterpolationError,
  LociError,
  NotImplementedError,
  SecretsTrackedError,
  ShellInjectionError,
  SpawnError,
  UndefinedPlaceholderError,
  UnknownAliasError,
  UnknownFlagError,
  YamlParseError,
} from '../errors.js';

/**
 * Factory returning a fresh instance of every concrete LociError subclass.
 * Used by code-uniqueness and exit-code-mapping tests to avoid drift.
 */
function oneOfEachConcrete(): readonly LociError[] {
  return [
    new YamlParseError('.loci/config.yml', 7, new Error('bad token')),
    new ConfigReadError('.loci/config.yml', new Error('EACCES')),
    new SecretsTrackedError('.loci/secrets.yml'),
    new CircularAliasError(['a', 'b', 'a']),
    new UnknownAliasError('missing'),
    new CommandSchemaError('ci', 'expected array, got string'),
    new UndefinedPlaceholderError('DEPLOY_HOST', 'deploy'),
    new ShellInjectionError('$(rm -rf /)'),
    new SpawnError('/usr/bin/foo', new Error('ENOENT')),
    new UnknownFlagError('--bogus'),
    new NotImplementedError('ConfigLoader (Phase 2)'),
  ];
}

describe('LociError hierarchy — instanceof chains', () => {
  it('YamlParseError → ConfigError → LociError → Error', () => {
    const err = new YamlParseError('.loci/config.yml', 7, new Error('bad token'));
    expect(err).toBeInstanceOf(YamlParseError);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err).toBeInstanceOf(LociError);
    expect(err).toBeInstanceOf(Error);
  });

  it('CircularAliasError → CommandError → LociError → Error', () => {
    const err = new CircularAliasError(['a', 'b', 'a']);
    expect(err).toBeInstanceOf(CircularAliasError);
    expect(err).toBeInstanceOf(CommandError);
    expect(err).toBeInstanceOf(LociError);
    expect(err).toBeInstanceOf(Error);
  });

  it('UndefinedPlaceholderError → InterpolationError → LociError → Error', () => {
    const err = new UndefinedPlaceholderError('DEPLOY_HOST', 'deploy');
    expect(err).toBeInstanceOf(UndefinedPlaceholderError);
    expect(err).toBeInstanceOf(InterpolationError);
    expect(err).toBeInstanceOf(LociError);
    expect(err).toBeInstanceOf(Error);
  });

  it('ShellInjectionError and SpawnError → ExecutorError → LociError → Error', () => {
    const shell = new ShellInjectionError('$(rm -rf /)');
    expect(shell).toBeInstanceOf(ExecutorError);
    expect(shell).toBeInstanceOf(LociError);
    const spawn = new SpawnError('/usr/bin/foo', new Error('ENOENT'));
    expect(spawn).toBeInstanceOf(ExecutorError);
    expect(spawn).toBeInstanceOf(LociError);
  });

  it('UnknownFlagError and NotImplementedError → CliError → LociError → Error', () => {
    const flag = new UnknownFlagError('--bogus');
    expect(flag).toBeInstanceOf(CliError);
    expect(flag).toBeInstanceOf(LociError);
    const notImpl = new NotImplementedError('ConfigLoader (Phase 2)');
    expect(notImpl).toBeInstanceOf(CliError);
    expect(notImpl).toBeInstanceOf(LociError);
  });
});

describe('LociError — runtime name (new.target.name)', () => {
  it('sets name to the concrete subclass, not LociError or Error', () => {
    const err = new CircularAliasError(['a', 'b', 'a']);
    expect(err.name).toBe('CircularAliasError');
  });

  it('preserves the name across all concrete subclasses', () => {
    const instances = oneOfEachConcrete();
    for (const err of instances) {
      // name should match the constructor name, never fall back to 'Error' or 'LociError'
      expect(err.name).toBe(err.constructor.name);
      expect(err.name).not.toBe('Error');
      expect(err.name).not.toBe('LociError');
    }
  });
});

describe('LociError — Error.cause propagation (ES2022)', () => {
  it('YamlParseError propagates the cause argument', () => {
    const inner = new Error('root parse failure');
    const err = new YamlParseError('.loci/config.yml', 1, inner);
    expect(err.cause).toBe(inner);
  });

  it('ConfigReadError propagates the cause argument', () => {
    const inner = new Error('EACCES');
    const err = new ConfigReadError('.loci/config.yml', inner);
    expect(err.cause).toBe(inner);
  });

  it('SpawnError propagates the cause argument', () => {
    const inner = new Error('ENOENT');
    const err = new SpawnError('/usr/bin/nothere', inner);
    expect(err.cause).toBe(inner);
  });

  it('errors without a cause argument have `cause` undefined', () => {
    const err = new UnknownFlagError('--bogus');
    expect(err.cause).toBeUndefined();
  });
});

describe('LociError — structured error shape (D-04)', () => {
  it('every concrete subclass has a non-empty string `code`', () => {
    const instances = oneOfEachConcrete();
    for (const err of instances) {
      expect(typeof err.code).toBe('string');
      expect(err.code.length).toBeGreaterThan(0);
    }
  });

  it('every concrete subclass has a unique `code` across the hierarchy', () => {
    const instances = oneOfEachConcrete();
    const codes = instances.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('suggestion is optional — some classes have it, some do not', () => {
    const withSuggestion = new YamlParseError('f', 1, null);
    expect(withSuggestion.suggestion).toBeDefined();
    // CommandSchemaError has no suggestion per RESEARCH.md pattern
    const withoutSuggestion = new CommandSchemaError('ci', 'bad shape');
    expect(withoutSuggestion.suggestion).toBeUndefined();
  });
});

describe('ExitCode + exitCodeFor — category-to-exit-code mapping (D-02)', () => {
  it('ExitCode ranges are stable: 0/10/20/30/40/50', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.CONFIG_ERROR).toBe(10);
    expect(ExitCode.COMMAND_ERROR).toBe(20);
    expect(ExitCode.INTERPOLATION_ERROR).toBe(30);
    expect(ExitCode.EXECUTOR_ERROR).toBe(40);
    expect(ExitCode.CLI_ERROR).toBe(50);
  });

  it('maps every concrete subclass category to the correct exit code', () => {
    expect(exitCodeFor(new YamlParseError('f', 1, null))).toBe(ExitCode.CONFIG_ERROR);
    expect(exitCodeFor(new ConfigReadError('f', null))).toBe(ExitCode.CONFIG_ERROR);
    expect(exitCodeFor(new SecretsTrackedError('f'))).toBe(ExitCode.CONFIG_ERROR);

    expect(exitCodeFor(new CircularAliasError(['a', 'b', 'a']))).toBe(ExitCode.COMMAND_ERROR);
    expect(exitCodeFor(new UnknownAliasError('x'))).toBe(ExitCode.COMMAND_ERROR);
    expect(exitCodeFor(new CommandSchemaError('x', 'y'))).toBe(ExitCode.COMMAND_ERROR);

    expect(exitCodeFor(new UndefinedPlaceholderError('X', 'y'))).toBe(ExitCode.INTERPOLATION_ERROR);

    expect(exitCodeFor(new ShellInjectionError('x'))).toBe(ExitCode.EXECUTOR_ERROR);
    expect(exitCodeFor(new SpawnError('x', null))).toBe(ExitCode.EXECUTOR_ERROR);

    expect(exitCodeFor(new UnknownFlagError('--x'))).toBe(ExitCode.CLI_ERROR);
    expect(exitCodeFor(new NotImplementedError('x'))).toBe(ExitCode.CLI_ERROR);
  });
});

describe('ShellInjectionError — secrets-safe by construction', () => {
  it('does NOT embed the offending value in the error message', () => {
    const secret = 'password123$(rm -rf /)';
    const err = new ShellInjectionError(secret);
    expect(err.message).not.toContain(secret);
    expect(err.message).not.toContain('password123');
    expect(err.message).not.toContain('rm -rf');
    // The message describes the SHAPE of the problem, not the VALUE.
    expect(err.message).toContain('shell metacharacters');
  });
});

describe('SecretsTrackedError — suggestion uses the filename, not secret contents', () => {
  it('includes the file path in the suggestion (safe to display)', () => {
    const err = new SecretsTrackedError('.loci/secrets.yml');
    expect(err.suggestion).toBeDefined();
    expect(err.suggestion).toContain('.loci/secrets.yml');
    expect(err.suggestion).toContain('git rm --cached');
  });
});
