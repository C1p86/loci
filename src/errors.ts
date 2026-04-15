// src/errors.ts
//
// Full LociError hierarchy (D-01, D-03).
// Phases 2-5 import and throw; they never add to this file unless a genuinely
// new failure mode emerges.

/**
 * Exit codes per category (D-02). Stable ranges — do not renumber in later phases.
 */
export const ExitCode = {
  SUCCESS: 0,
  CONFIG_ERROR: 10,
  COMMAND_ERROR: 20,
  INTERPOLATION_ERROR: 30,
  EXECUTOR_ERROR: 40,
  CLI_ERROR: 50,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export type LociErrorCategory = 'config' | 'command' | 'interpolation' | 'executor' | 'cli';

export interface LociErrorOptions {
  /** Machine ID, e.g. "CFG_YAML_PARSE". Must be unique across the entire hierarchy. */
  code: string;
  suggestion?: string;
  /** Standard ES2022 Error.cause — use for wrapping underlying errors. */
  cause?: unknown;
}

/**
 * Abstract base for all loci errors. Never throw this directly — always throw
 * a concrete subclass (e.g. YamlParseError, CircularAliasError).
 */
export abstract class LociError extends Error {
  public readonly code: string;
  public abstract readonly category: LociErrorCategory;
  public readonly suggestion?: string;

  constructor(message: string, options: LociErrorOptions) {
    // Pass Error.cause through the standard ES2022 channel.
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    if (options.suggestion !== undefined) {
      this.suggestion = options.suggestion;
    }
  }
}

/* ---------- Area base classes ---------- */

export abstract class ConfigError extends LociError {
  public readonly category = 'config' as const;
}

export abstract class CommandError extends LociError {
  public readonly category = 'command' as const;
}

export abstract class InterpolationError extends LociError {
  public readonly category = 'interpolation' as const;
}

export abstract class ExecutorError extends LociError {
  public readonly category = 'executor' as const;
}

export abstract class CliError extends LociError {
  public readonly category = 'cli' as const;
}

/* ---------- Concrete subclasses (D-03: declared in Phase 1, thrown in Phases 2-5) ---------- */

// ConfigError subclasses (for Phase 2)
export class YamlParseError extends ConfigError {
  constructor(filePath: string, line: number | undefined, cause: unknown) {
    super(`Invalid YAML in ${filePath}${line !== undefined ? ` at line ${line}` : ''}`, {
      code: 'CFG_YAML_PARSE',
      cause,
      suggestion: 'Check the file for unmatched quotes or indentation errors',
    });
  }
}

export class ConfigReadError extends ConfigError {
  constructor(filePath: string, cause: unknown) {
    super(`Cannot read config file: ${filePath}`, {
      code: 'CFG_READ',
      cause,
      suggestion: 'Check file permissions and that the path exists',
    });
  }
}

export class SecretsTrackedError extends ConfigError {
  constructor(filePath: string) {
    super(`Secrets file appears tracked by git: ${filePath}`, {
      code: 'CFG_SECRETS_TRACKED',
      suggestion: `Run: git rm --cached ${filePath}`,
    });
  }
}

// CommandError subclasses (for Phase 3)
export class CircularAliasError extends CommandError {
  constructor(cyclePath: readonly string[]) {
    super(`Circular alias reference: ${cyclePath.join(' → ')}`, {
      code: 'CMD_CIRCULAR_ALIAS',
      suggestion: 'Break the cycle by redefining one of the aliases in the chain',
    });
  }
}

export class UnknownAliasError extends CommandError {
  constructor(aliasName: string) {
    super(`Unknown alias: "${aliasName}"`, {
      code: 'CMD_UNKNOWN_ALIAS',
      suggestion: 'Run `xci --list` to see available aliases',
    });
  }
}

export class CommandSchemaError extends CommandError {
  constructor(aliasName: string, details: string) {
    super(`Invalid command definition for alias "${aliasName}": ${details}`, {
      code: 'CMD_SCHEMA',
    });
  }
}

// InterpolationError subclasses (for Phase 3)
export class UndefinedPlaceholderError extends InterpolationError {
  constructor(placeholder: string, aliasName: string) {
    super(`Undefined placeholder \${${placeholder}} in alias "${aliasName}"`, {
      code: 'INT_UNDEFINED_PLACEHOLDER',
      suggestion: `Add ${placeholder} to one of your .loci config files`,
    });
  }
}

// ExecutorError subclasses (for Phase 4)
export class ShellInjectionError extends ExecutorError {
  constructor(value: string) {
    super('Command contains shell metacharacters in an argument slot', {
      code: 'EXE_SHELL_INJECTION',
      suggestion: 'xci uses shell:false by default; review your command definition',
    });
    // NB: never include `value` in the message — it may be a secret.
    // The value is accepted into the constructor for Phase 4 API compatibility
    // but is deliberately discarded here so it cannot leak via Error.toString().
    void value;
  }
}

export class SpawnError extends ExecutorError {
  constructor(commandPath: string, cause: unknown) {
    super(`Failed to spawn command: ${commandPath}`, {
      code: 'EXE_SPAWN',
      cause,
      suggestion: 'Check the command exists in PATH',
    });
  }
}

// CliError subclasses (for Phase 1's own cli.ts + Phase 5)
export class UnknownFlagError extends CliError {
  constructor(flag: string) {
    super(`Unknown flag: ${flag}`, {
      code: 'CLI_UNKNOWN_FLAG',
      suggestion: 'Run `xci --help` for available flags',
    });
  }
}

// NotImplementedError — used by feature stubs in Phase 1 so Phases 2-5 have a typed hole to fill.
export class NotImplementedError extends CliError {
  constructor(component: string) {
    super(`Not implemented: ${component}`, {
      code: 'CLI_NOT_IMPLEMENTED',
      suggestion: 'This feature lands in a later phase',
    });
  }
}

/* ---------- Category → exit code mapping (single source of truth) ---------- */

/**
 * Exhaustive switch on LociErrorCategory — adding a new category without
 * updating this function causes a TypeScript compile error.
 */
export function exitCodeFor(error: LociError): ExitCode {
  switch (error.category) {
    case 'config':
      return ExitCode.CONFIG_ERROR;
    case 'command':
      return ExitCode.COMMAND_ERROR;
    case 'interpolation':
      return ExitCode.INTERPOLATION_ERROR;
    case 'executor':
      return ExitCode.EXECUTOR_ERROR;
    case 'cli':
      return ExitCode.CLI_ERROR;
  }
}
