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

/** Inline prompt step inside a sequential steps array. */
export interface PromptStepDef {
  readonly kind: 'prompt';
  readonly var: string;
  readonly message?: string;
  readonly default?: string;
}

/** Inline xci delegate step inside a sequential steps array. */
export interface XciInlineStepDef {
  readonly kind: 'xci';
  readonly alias: string;
  readonly project?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
}

export interface PlatformOverrides {
  readonly linux?: readonly string[];
  readonly windows?: readonly string[];
  readonly macos?: readonly string[];
}

/** Capture configuration: simple (just variable name) or extended (with validation). */
export type CaptureType = 'string' | 'int' | 'float' | 'json';

export interface CaptureConfig {
  readonly var: string;
  readonly type?: CaptureType; // default: 'string'
  readonly assert?: string | readonly string[]; // e.g. "> 0", "not empty", [">=1", "<=100"]
  readonly regex?: string; // extract first capture group from full output
}

/** Parameter definition for a command. */
export interface ParamDef {
  readonly required?: boolean; // default: false
  readonly default?: string; // default value if not provided
  readonly description?: string; // human-readable description
}

/** Union type matching the commands.yml schema after parse + validation. */
export type CommandDef =
  | {
      readonly kind: 'single';
      readonly cmd: readonly string[];
      readonly description?: string;
      readonly platforms?: PlatformOverrides;
      readonly capture?: CaptureConfig; // capture stdout into a named variable with optional validation
      readonly params?: Readonly<Record<string, ParamDef>>;
      readonly cwd?: string; // working directory — relative to projectRoot, absolute path, or ${placeholder}. Inherited by child aliases when they don't declare their own.
    }
  | {
      readonly kind: 'sequential';
      readonly steps: readonly (CommandRef | PromptStepDef | XciInlineStepDef)[];
      readonly description?: string;
      readonly params?: Readonly<Record<string, ParamDef>>;
      readonly cwd?: string; // working directory — relative to projectRoot, absolute path, or ${placeholder}. Inherited by child aliases when they don't declare their own.
    }
  | {
      readonly kind: 'parallel';
      readonly group: readonly CommandRef[];
      readonly description?: string;
      readonly failMode?: 'fast' | 'complete'; // D-15: validated at load time
      readonly params?: Readonly<Record<string, ParamDef>>;
      readonly cwd?: string; // working directory — relative to projectRoot, absolute path, or ${placeholder}. Inherited by child aliases when they don't declare their own.
    }
  | {
      readonly kind: 'for_each';
      readonly var: string; // loop variable name
      readonly in: readonly string[] | string; // values to iterate over — array of strings OR a single "${VAR}" placeholder (CSV-split at resolve time)
      readonly mode: 'steps' | 'parallel'; // sequential or parallel execution
      readonly cmd?: readonly string[]; // inline command (uses ${var})
      readonly run?: string; // alias reference
      readonly description?: string;
      readonly failMode?: 'fast' | 'complete'; // for parallel mode
      readonly params?: Readonly<Record<string, ParamDef>>;
      readonly cwd?: string; // working directory — relative to projectRoot, absolute path, or ${placeholder}. Inherited by child aliases when they don't declare their own.
    }
  | {
      readonly kind: 'ini';
      readonly file: string; // path to INI file (supports ${var})
      readonly mode?: 'overwrite' | 'merge'; // default: overwrite
      readonly set?: Readonly<Record<string, Readonly<Record<string, string>>>>; // section → key → value
      readonly delete?: Readonly<Record<string, readonly string[]>>; // section → keys to delete
      readonly description?: string;
      readonly params?: Readonly<Record<string, ParamDef>>;
      readonly cwd?: string; // working directory — relative to projectRoot, absolute path, or ${placeholder}. Inherited by child aliases when they don't declare their own.
    }
  | {
      readonly kind: 'uproject';
      readonly file: string; // path to .uproject file (supports ${var})
      readonly plugins?: {
        readonly enable?: readonly string[]; // plugin names to enable
        readonly disable?: readonly string[]; // plugin names to disable
        readonly remove?: readonly string[]; // plugin names to remove
      };
      readonly set?: Readonly<Record<string, string>>; // top-level .uproject fields to set
      readonly description?: string;
      readonly params?: Readonly<Record<string, ParamDef>>;
      readonly cwd?: string; // working directory — relative to projectRoot, absolute path, or ${placeholder}. Inherited by child aliases when they don't declare their own.
    }
  | {
      readonly kind: 'xci';
      readonly alias: string; // alias to run in the target project (required)
      readonly project?: string; // target project root (relative/absolute/${...}); default current cwd
      readonly args?: readonly string[]; // forwarded argv (KEY=VALUE overrides + pass-through)
      readonly description?: string;
      readonly params?: Readonly<Record<string, ParamDef>>;
      readonly cwd?: string; // standard cwd field (kept for uniformity / cwd inheritance)
    };

export type CommandMap = ReadonlyMap<string, CommandDef>;

export interface CommandsLoader {
  load(cwd: string, builtinCommandsDir?: string): Promise<CommandMap>;
}

/* ------------------------------------------------------------
 * Resolver contract (Phase 3)
 * ------------------------------------------------------------ */

export type SequentialStep =
  | {
      readonly kind?: 'cmd'; // default — omit for backward compat
      readonly label?: string; // alias name for display in step headers
      readonly argv: readonly string[]; // interpolated argv (best-effort at plan time)
      readonly rawArgv?: readonly string[]; // pre-interpolation tokens (for deferred interpolation with captured vars)
      readonly capture?: CaptureConfig;
      readonly cwd?: string; // effective working directory (absolute after resolveAbsoluteCwds)
      readonly breadcrumb?: readonly string[]; // path of containing alias names, e.g. ["release","build","compile"] (quick-260421-kbl)
    }
  | {
      readonly kind: 'ini';
      readonly file: string;
      readonly mode: 'overwrite' | 'merge';
      readonly set?: Readonly<Record<string, Readonly<Record<string, string>>>>;
      readonly delete?: Readonly<Record<string, readonly string[]>>;
      readonly cwd?: string; // effective working directory (absolute after resolveAbsoluteCwds)
      readonly breadcrumb?: readonly string[]; // path of containing alias names (quick-260421-kbl)
    }
  | {
      readonly kind: 'uproject';
      readonly file: string;
      readonly plugins?: {
        readonly enable?: readonly string[];
        readonly disable?: readonly string[];
        readonly remove?: readonly string[];
      };
      readonly set?: Readonly<Record<string, string>>;
      readonly cwd?: string; // effective working directory (absolute after resolveAbsoluteCwds)
      readonly breadcrumb?: readonly string[]; // path of containing alias names
    }
  | {
      readonly kind: 'xci';
      readonly alias: string; // alias to run in the target project
      readonly project?: string; // target project root (absolute after resolveAbsoluteCwds)
      readonly args?: readonly string[]; // forwarded argv (post-interpolation)
      readonly cwd?: string; // effective working directory (absolute after resolveAbsoluteCwds)
      readonly breadcrumb?: readonly string[]; // path of containing alias names
    }
  | {
      readonly kind: 'set';
      readonly vars: Readonly<Record<string, string>>; // variable assignments (raw, may contain ${placeholders})
      readonly breadcrumb?: readonly string[]; // path of containing alias names (quick-260421-kbl)
    }
  | {
      readonly kind: 'prompt';
      readonly var: string;
      readonly message?: string;
      readonly default?: string;
      readonly breadcrumb?: readonly string[];
    };

export type ExecutionPlan =
  | {
      readonly kind: 'single';
      readonly argv: readonly string[];
      readonly capture?: CaptureConfig;
      readonly cwd?: string;
    }
  | { readonly kind: 'sequential'; readonly steps: readonly SequentialStep[] }
  | {
      readonly kind: 'parallel';
      readonly group: readonly {
        readonly alias: string;
        readonly argv: readonly string[];
        readonly cwd?: string;
        readonly breadcrumb?: readonly string[]; // path of containing alias names (quick-260421-kbl)
      }[];
      readonly failMode: 'fast' | 'complete'; // resolved with default 'fast'
    }
  | {
      readonly kind: 'ini';
      readonly file: string;
      readonly mode: 'overwrite' | 'merge';
      readonly set?: Readonly<Record<string, Readonly<Record<string, string>>>>;
      readonly delete?: Readonly<Record<string, readonly string[]>>;
      readonly cwd?: string;
    }
  | {
      readonly kind: 'uproject';
      readonly file: string;
      readonly plugins?: {
        readonly enable?: readonly string[];
        readonly disable?: readonly string[];
        readonly remove?: readonly string[];
      };
      readonly set?: Readonly<Record<string, string>>;
      readonly cwd?: string;
    }
  | {
      readonly kind: 'xci';
      readonly alias: string; // alias to run in the target project
      readonly project?: string; // target project root (absolute after resolveAbsoluteCwds)
      readonly args?: readonly string[]; // forwarded argv (post-interpolation)
      readonly cwd?: string;
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

export interface ExecutorOptions {
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly logFile?: string; // path to log file (always written)
  readonly showOutput?: boolean; // pipe output to terminal (default: false)
  readonly tailLines?: number; // show last N lines of output after each command (--short-log N)
  readonly fromStep?: string; // start from this step label, skip earlier ones (--from)
  readonly secretValues?: ReadonlySet<string>; // redact these values from preview output
  readonly alias?: string; // command alias name — shown in completion notification
  readonly projectName?: string; // project name — shown in completion notification
}

export interface Executor {
  run(plan: ExecutionPlan, options: ExecutorOptions): Promise<ExecutionResult>;
}
