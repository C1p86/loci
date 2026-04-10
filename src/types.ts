// src/types.ts
//
// Shared contracts for all pipeline stages (D-06).
// Fully populated in Phase 1 so Phases 2-5 just implement against these interfaces.

/* ------------------------------------------------------------
 * ConfigLoader contract (Phase 2)
 * ------------------------------------------------------------ */

/** A value loaded from a config file. All values are strings; YAML 1.2 semantics via `yaml`. */
export type ConfigValue = string;

/** Which of the 4 layers a config key came from — used for redaction and --verbose trace. */
export type ConfigLayer = 'machine' | 'project' | 'secrets' | 'local';

/** Flat, merged config after precedence resolution machine → project → secrets → local (last wins). */
export interface ResolvedConfig {
  /** Flat key → value map after merge. */
  readonly values: Readonly<Record<string, ConfigValue>>;
  /** For each key, which layer provided the final value. */
  readonly provenance: Readonly<Record<string, ConfigLayer>>;
  /** Set of keys whose final value came from secrets.yml (for redaction). */
  readonly secretKeys: ReadonlySet<string>;
}

export interface ConfigLoader {
  load(cwd: string): Promise<ResolvedConfig>;
}

/* ------------------------------------------------------------
 * CommandsLoader contract (Phase 3)
 * ------------------------------------------------------------ */

/** Reference to another alias (composition). */
export type CommandRef = string;

export interface PlatformOverrides {
  readonly linux?: readonly string[];
  readonly windows?: readonly string[];
  readonly macos?: readonly string[];
}

/** Union type matching the commands.yml schema after parse + validation. */
export type CommandDef =
  | {
      readonly kind: 'single';
      readonly cmd: readonly string[];
      readonly description?: string;
      readonly platforms?: PlatformOverrides;
    }
  | {
      readonly kind: 'sequential';
      readonly steps: readonly CommandRef[];
      readonly description?: string;
    }
  | {
      readonly kind: 'parallel';
      readonly group: readonly CommandRef[];
      readonly description?: string;
    };

export type CommandMap = ReadonlyMap<string, CommandDef>;

export interface CommandsLoader {
  load(cwd: string): Promise<CommandMap>;
}

/* ------------------------------------------------------------
 * Resolver contract (Phase 3)
 * ------------------------------------------------------------ */

export type ExecutionPlan =
  | { readonly kind: 'single'; readonly argv: readonly string[] }
  | { readonly kind: 'sequential'; readonly steps: readonly (readonly string[])[] }
  | {
      readonly kind: 'parallel';
      readonly group: readonly {
        readonly alias: string;
        readonly argv: readonly string[];
      }[];
    };

export interface Resolver {
  resolve(aliasName: string, commands: CommandMap, config: ResolvedConfig): ExecutionPlan;
}

/* ------------------------------------------------------------
 * Executor contract (Phase 4)
 * ------------------------------------------------------------ */

export interface ExecutionResult {
  readonly exitCode: number;
}

export interface Executor {
  run(plan: ExecutionPlan): Promise<ExecutionResult>;
}
