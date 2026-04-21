// src/executor/output.ts
//
// All output formatting for the executor and CLI (D-01 to D-10, D-27, D-28, D-30).

import { appendFileSync } from 'node:fs';
import { redactSecrets } from '../resolver/envvars.js';
import type { CaptureConfig, CommandDef, ExecutionPlan, ResolvedConfig } from '../types.js';
import type { CaptureValidationResult } from './capture.js';

/* ------------------------------------------------------------------ */
/* ANSI constants                                                        */
/* ------------------------------------------------------------------ */

export const ANSI_PALETTE: readonly string[] = [
  '\x1b[32m', // green
  '\x1b[33m', // yellow
  '\x1b[34m', // blue
  '\x1b[35m', // magenta
  '\x1b[36m', // cyan
  '\x1b[91m', // bright red
  '\x1b[92m', // bright green
  '\x1b[93m', // bright yellow
];

export const RESET = '\x1b[0m';
export const DIM = '\x1b[2m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const CYAN = '\x1b[36m';
export const BOLD = '\x1b[1m';

/* ------------------------------------------------------------------ */
/* Color detection (D-04)                                               */
/* ------------------------------------------------------------------ */

/**
 * Returns true if ANSI color should be used.
 * Respects NO_COLOR (disable) and FORCE_COLOR (enable) env vars.
 * Falls back to TTY detection.
 */
export function shouldUseColor(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;
  if (process.env['FORCE_COLOR'] !== undefined) return true;
  return process.stdout.isTTY === true;
}

/**
 * Wrap a message in YELLOW ANSI (for warnings). No-op when color is disabled.
 */
export function formatWarning(msg: string): string {
  return shouldUseColor() ? `${YELLOW}${msg}${RESET}` : msg;
}

/**
 * Wrap a message in RED ANSI (for errors). No-op when color is disabled.
 */
export function formatError(msg: string): string {
  return shouldUseColor() ? `${RED}${msg}${RESET}` : msg;
}

/* ------------------------------------------------------------------ */
/* Color utilities (D-01, D-02, D-03)                                   */
/* ------------------------------------------------------------------ */

/**
 * djb2 hash to deterministically pick a color from ANSI_PALETTE for an alias name.
 */
export function hashColor(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  }
  return ANSI_PALETTE[Math.abs(hash) % ANSI_PALETTE.length] as string;
}

/**
 * Format the alias prefix for parallel output lines.
 * TTY: colored alias name. Non-TTY: [alias] bracket format.
 */
export function formatPrefix(alias: string): string {
  if (shouldUseColor()) {
    return `${hashColor(alias)}${alias}${RESET}`;
  }
  return `[${alias}]`;
}

/**
 * Returns a generator transform function that prefixes each line with the alias.
 * Compatible with execa's `stdout`/`stderr` transform option (D-05, EXE-05).
 */
export function makeLineTransform(alias: string): (line: string) => Generator<string> {
  const prefix = formatPrefix(alias);
  return function* (line: string) {
    yield `${prefix} ${line}`;
  };
}

/**
 * Format a dim label prefix for dry-run and verbose output (D-10).
 */
export function dimPrefix(label: string): string {
  if (shouldUseColor()) {
    return `${DIM}[${label}]${RESET}`;
  }
  return `[${label}]`;
}

/* ------------------------------------------------------------------ */
/* Step header (D-08)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Print a step header to stderr before each sequential step.
 */
export function printStepHeader(stepName: string, stepNum?: number, totalSteps?: number): void {
  const counter = stepNum !== undefined && totalSteps !== undefined
    ? ` [${stepNum}/${totalSteps}]` : '';
  if (shouldUseColor()) {
    process.stderr.write(`${BOLD}${CYAN}\u25b6 ${stepName}${counter}${RESET}\n`);
  } else {
    process.stderr.write(`\u25b6 ${stepName}${counter}\n`);
  }
}

/**
 * Print a step result summary to stderr after each sequential/parallel step.
 */
export function printStepResult(stepName: string, exitCode: number, durationMs?: number, statusOverride?: string): void {
  const useColor = shouldUseColor();
  if (statusOverride) {
    const dim = useColor ? '\x1b[2m' : '';
    const reset = useColor ? '\x1b[0m' : '';
    process.stderr.write(`${dim}⊘ ${stepName} ${statusOverride}${reset}\n`);
    return;
  }
  const ok = exitCode === 0;
  const icon = ok
    ? (useColor ? '\x1b[32m\u2713\x1b[0m' : '\u2713')
    : (useColor ? '\x1b[31m\u2717\x1b[0m' : '\u2717');
  const status = ok
    ? (useColor ? '\x1b[32mOK\x1b[0m' : 'OK')
    : (useColor ? `\x1b[31mFAILED (exit ${exitCode})\x1b[0m` : `FAILED (exit ${exitCode})`);
  const duration = durationMs !== undefined ? ` ${formatDuration(durationMs)}` : '';
  process.stderr.write(`${icon} ${stepName} ${status}${duration}\n`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

/* ------------------------------------------------------------------ */
/* Run header (printed before real execution, skipped on dry-run / ui)  */
/* ------------------------------------------------------------------ */

/**
 * Scan a raw CommandDef for ${placeholder} tokens. Returns the set of placeholder
 * names (the text between `${` and `}`). Uses the raw command definition rather
 * than the resolved ExecutionPlan so we only surface variables that the alias
 * author literally referenced.
 */
function collectReferencedPlaceholders(def: CommandDef): Set<string> {
  const out = new Set<string>();
  const re = /\$\{([^}]+)\}/g;
  const scanString = (s: string): void => {
    let m: RegExpExecArray | null = re.exec(s);
    while (m !== null) {
      const name = m[1];
      if (name !== undefined) out.add(name);
      m = re.exec(s);
    }
    re.lastIndex = 0;
  };
  const scanArray = (arr: readonly string[]): void => {
    for (const s of arr) scanString(s);
  };
  switch (def.kind) {
    case 'single':
      scanArray(def.cmd);
      break;
    case 'sequential':
      scanArray(def.steps);
      break;
    case 'parallel':
      scanArray(def.group);
      break;
    case 'for_each':
      if (def.cmd) scanArray(def.cmd);
      if (def.run) scanString(def.run);
      if (typeof def.in === 'string') {
        scanString(def.in);
      } else {
        for (const v of def.in) scanString(v);
      }
      break;
    case 'ini':
      scanString(def.file);
      if (def.set) {
        for (const section of Object.values(def.set)) {
          for (const v of Object.values(section)) scanString(v);
        }
      }
      break;
  }
  return out;
}

/**
 * Print a summary of the alias about to run: title, referenced variables (secrets
 * masked), and resolved steps. Intended for non-dry-run, non-TUI execution so the
 * operator sees what will happen before anything spawns. All secret values are
 * redacted — the variables block masks by secretKeys, and the steps block uses
 * redactArgv over the resolved argv.
 */
export function printRunHeader(
  alias: string,
  def: CommandDef,
  plan: ExecutionPlan,
  effectiveValues: Readonly<Record<string, string>>,
  secretKeys: ReadonlySet<string>,
  projectRoot?: string,
): void {
  const useColor = shouldUseColor();
  const bold = useColor ? BOLD : '';
  const cyan = useColor ? CYAN : '';
  const dim = useColor ? DIM : '';
  const reset = useColor ? RESET : '';

  // Title
  process.stderr.write(`${bold}${cyan}\u25b6 running: ${alias}${reset}\n`);

  // Variables block — only show vars the alias actually references via ${...}
  const referenced = collectReferencedPlaceholders(def);
  const keys = Object.keys(effectiveValues).filter((k) => {
    const upper = k.toUpperCase().replace(/[.\-]/g, '_');
    return referenced.has(k) || referenced.has(upper);
  });
  // Dedupe dot-notation vs UPPER_UNDERSCORE duplicates (match printDryRun's filter).
  const sortedKeys = keys.slice().sort();
  const displayedKeys = sortedKeys.filter((key) =>
    key.includes('.') ||
    !sortedKeys.some((k) => k.includes('.') && k.toUpperCase().replace(/[.\-]/g, '_') === key)
  );

  if (displayedKeys.length > 0) {
    process.stderr.write('variables:\n');
    for (const key of displayedKeys) {
      const isSecret = secretKeys.has(key);
      const value = isSecret ? '**********' : effectiveValues[key];
      process.stderr.write(`  ${key} = ${value}\n`);
    }
  }

  // Steps block — use redactArgv so any argv token matching a secret value is ***.
  const secretValues = new Set<string>();
  for (const k of secretKeys) {
    const v = effectiveValues[k];
    if (v !== undefined && v !== '') secretValues.add(v);
  }

  // quick-260421-g99: top-level cwd line (hidden if the plan's effective cwd equals projectRoot).
  const topCwd = topLevelCwd(plan);
  const redactedTopCwd = redactCwd(topCwd, secretValues);
  if (redactedTopCwd !== undefined && (projectRoot === undefined || redactedTopCwd !== projectRoot)) {
    process.stderr.write(`${dim}cwd: ${redactedTopCwd}${reset}\n`);
  }

  process.stderr.write('steps:\n');
  switch (plan.kind) {
    case 'single': {
      const redacted = redactArgv(plan.argv, secretValues);
      process.stderr.write(`  ${redacted.join(' ')}\n`);
      break;
    }
    case 'sequential': {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        if (!step) continue;
        if (step.kind === 'ini') {
          const stepCwdDisplay = step.cwd && step.cwd !== topCwd
            ? ` ${dim}(cwd: ${redactCwd(step.cwd, secretValues)})${reset}`
            : '';
          process.stderr.write(`  ${i + 1}. ini:${step.mode} ${step.file}${stepCwdDisplay}\n`);
        } else if (step.kind === 'set') {
          const assignments = Object.entries(step.vars).map(([k, v]) => `${k}=${v}`).join(', ');
          process.stderr.write(`  ${i + 1}. set ${assignments}\n`);
        } else {
          const redacted = redactArgv(step.argv, secretValues);
          const captureTag = step.capture ? ` [capture → ${step.capture.var}]` : '';
          const label = step.label ? `${step.label}: ` : '';
          const stepCwdDisplay = step.cwd && step.cwd !== topCwd
            ? ` ${dim}(cwd: ${redactCwd(step.cwd, secretValues)})${reset}`
            : '';
          process.stderr.write(`  ${i + 1}. ${label}${redacted.join(' ')}${captureTag}${stepCwdDisplay}\n`);
        }
      }
      break;
    }
    case 'parallel': {
      for (const entry of plan.group) {
        const redacted = redactArgv(entry.argv, secretValues);
        const entryCwdDisplay = entry.cwd && entry.cwd !== topCwd
          ? ` ${dim}(cwd: ${redactCwd(entry.cwd, secretValues)})${reset}`
          : '';
        process.stderr.write(`  [${entry.alias}] ${redacted.join(' ')}${entryCwdDisplay}\n`);
      }
      break;
    }
    case 'ini': {
      process.stderr.write(`  ini ${plan.mode}: ${plan.file}\n`);
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Secret value extraction                                              */
/* ------------------------------------------------------------------ */

/**
 * Build a set of actual secret values (not keys) for argv redaction in dry-run output.
 */
export function buildSecretValues(config: ResolvedConfig): ReadonlySet<string> {
  const values = new Set<string>();
  for (const key of config.secretKeys) {
    const val = config.values[key];
    if (val !== undefined && val !== '') {
      values.add(val);
    }
  }
  return values;
}

/**
 * Replace argv tokens that match any secret value with '***'.
 */
function redactArgv(argv: readonly string[], secretValues: ReadonlySet<string>): readonly string[] {
  return argv.map((token) => (secretValues.has(token) ? '***' : token));
}

/**
 * Redact a cwd string: if its exact value matches a secret, display `***`.
 * Returns undefined unchanged.
 * quick-260421-g99
 */
function redactCwd(cwd: string | undefined, secretValues: ReadonlySet<string>): string | undefined {
  if (cwd === undefined) return undefined;
  return secretValues.has(cwd) ? '***' : cwd;
}

/**
 * Pick a representative top-level cwd for header display: single/ini → plan.cwd;
 * sequential → first spawn step's cwd; parallel → first group entry's cwd.
 * quick-260421-g99
 */
function topLevelCwd(plan: ExecutionPlan): string | undefined {
  switch (plan.kind) {
    case 'single':
      return plan.cwd;
    case 'ini':
      return plan.cwd;
    case 'sequential': {
      for (const step of plan.steps) {
        if (step.kind === 'set') continue;
        if (step.cwd !== undefined) return step.cwd;
      }
      return undefined;
    }
    case 'parallel':
      return plan.group[0]?.cwd;
  }
}

/* ------------------------------------------------------------------ */
/* Dry-run output (D-27, D-30)                                          */
/* ------------------------------------------------------------------ */

/**
 * Print a structured dry-run preview of the execution plan to stderr.
 * Secret values in argv are replaced with ***.
 *
 * @param secretValues - The actual string values of secrets (from buildSecretValues(config)),
 *   NOT the config key names (config.secretKeys). Tokens matching these values are
 *   replaced with *** in dry-run output.
 */
export function printDryRun(
  plan: ExecutionPlan,
  secretValues: ReadonlySet<string>,
  envVars?: Record<string, string>,
  secretKeys?: ReadonlySet<string>,
): void {
  const prefix = dimPrefix('dry-run');

  // quick-260421-g99: top-level cwd summary line before the plan body.
  const topCwd = topLevelCwd(plan);
  const redactedTopCwd = redactCwd(topCwd, secretValues);
  if (redactedTopCwd !== undefined) {
    process.stderr.write(`${prefix} cwd: ${redactedTopCwd}\n`);
  }

  switch (plan.kind) {
    case 'single': {
      const redacted = redactArgv(plan.argv, secretValues);
      process.stderr.write(`${prefix} single: ${redacted.join(' ')}\n`);
      break;
    }
    case 'sequential': {
      process.stderr.write(`${prefix} sequential (${plan.steps.length} steps):\n`);
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        if (step) {
          if (step.kind === 'ini') {
            const stepCwdDisplay = step.cwd && step.cwd !== topCwd
              ? ` (cwd: ${redactCwd(step.cwd, secretValues)})`
              : '';
            process.stderr.write(`${prefix}   ${i + 1}. ini:${step.mode} ${step.file}${stepCwdDisplay}\n`);
          } else if (step.kind === 'set') {
            const assignments = Object.entries(step.vars).map(([k, v]) => `${k}=${v}`).join(', ');
            process.stderr.write(`${prefix}   ${i + 1}. set ${assignments}\n`);
          } else {
            const redacted = redactArgv(step.argv, secretValues);
            const captureTag = step.capture ? ` [capture → ${step.capture.var}]` : '';
            const stepCwdDisplay = step.cwd && step.cwd !== topCwd
              ? ` (cwd: ${redactCwd(step.cwd, secretValues)})`
              : '';
            process.stderr.write(`${prefix}   ${i + 1}. ${redacted.join(' ')}${captureTag}${stepCwdDisplay}\n`);
          }
        }
      }
      break;
    }
    case 'parallel': {
      process.stderr.write(
        `${prefix} parallel (failMode: ${plan.failMode}, ${plan.group.length} commands):\n`,
      );
      for (const entry of plan.group) {
        const redacted = redactArgv(entry.argv, secretValues);
        const entryCwdDisplay = entry.cwd && entry.cwd !== topCwd
          ? ` (cwd: ${redactCwd(entry.cwd, secretValues)})`
          : '';
        process.stderr.write(`${prefix}   [${entry.alias}] ${redacted.join(' ')}${entryCwdDisplay}\n`);
      }
      break;
    }
    case 'ini': {
      process.stderr.write(`${prefix} ini ${plan.mode}: ${plan.file}\n`);
      if (plan.set) {
        for (const [section, keys] of Object.entries(plan.set)) {
          for (const [k, v] of Object.entries(keys)) {
            const masked = secretValues.has(v) ? '**********' : v;
            process.stderr.write(`${prefix}   [${section}] ${k}=${masked}\n`);
          }
        }
      }
      break;
    }
  }

  // Print imported variables with secrets masked
  if (envVars) {
    process.stderr.write(`${prefix}\n${prefix} variables:\n`);
    const sortedKeys = Object.keys(envVars).sort();
    for (const key of sortedKeys) {
      // Skip UPPER_UNDERSCORE duplicates — show only dot-notation or original keys
      if (key.includes('.') || !sortedKeys.some((k) => k.includes('.') && k.toUpperCase().replace(/[.\-]/g, '_') === key)) {
        const isSecret = secretKeys?.has(key) ?? false;
        const value = isSecret ? '**********' : envVars[key];
        process.stderr.write(`${prefix}   ${key} = ${value}\n`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Verbose trace output (D-26, D-28, CLI-07)                            */
/* ------------------------------------------------------------------ */

/**
 * Print verbose trace info to stderr: project root, config files loaded, env vars
 * with secrets redacted to ***.
 */
export function printVerboseTrace(
  projectRoot: string,
  configFiles: { path: string; found: boolean }[],
  envVars: Record<string, string>,
  secretKeys: ReadonlySet<string>,
): void {
  const prefix = dimPrefix('verbose');

  process.stderr.write(`${prefix} project root: ${projectRoot}\n`);

  for (const cf of configFiles) {
    const status = cf.found ? 'loaded' : 'not found';
    process.stderr.write(`${prefix} config: ${cf.path} [${status}]\n`);
  }

  const redacted = redactSecrets(envVars, secretKeys);
  for (const [key, value] of Object.entries(redacted)) {
    process.stderr.write(`${prefix} env: ${key}=${value}\n`);
  }
}

/**
 * Print the raw (uninterpolated) command definition and the resolved (interpolated) plan.
 * Shows placeholders before and values after resolution.
 */
export function printVerboseCommand(
  aliasDef: CommandDef,
  plan: ExecutionPlan,
  secretValues: ReadonlySet<string>,
): void {
  const prefix = dimPrefix('verbose');

  // Raw command (with ${placeholders})
  switch (aliasDef.kind) {
    case 'single':
      process.stderr.write(`${prefix} raw cmd: ${aliasDef.cmd.join(' ')}\n`);
      break;
    case 'sequential':
      process.stderr.write(`${prefix} raw steps:\n`);
      for (const step of aliasDef.steps) {
        process.stderr.write(`${prefix}   - ${step}\n`);
      }
      break;
    case 'parallel':
      process.stderr.write(`${prefix} raw parallel:\n`);
      for (const entry of aliasDef.group) {
        process.stderr.write(`${prefix}   - ${entry}\n`);
      }
      break;
  }

  // quick-260421-g99: resolved cwd summary — verbose is the right place to be exhaustive.
  const topCwd = topLevelCwd(plan);
  const redactedTopCwd = redactCwd(topCwd, secretValues);
  if (redactedTopCwd !== undefined) {
    process.stderr.write(`${prefix} resolved cwd: ${redactedTopCwd}\n`);
  }

  // Resolved command (interpolated, secrets redacted)
  switch (plan.kind) {
    case 'single': {
      const redacted = redactArgv(plan.argv, secretValues);
      process.stderr.write(`${prefix} resolved: ${redacted.join(' ')}\n`);
      break;
    }
    case 'sequential':
      process.stderr.write(`${prefix} resolved steps:\n`);
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        if (step) {
          if (step.kind === 'ini') {
            const stepCwdDisplay = step.cwd && step.cwd !== topCwd
              ? ` (cwd: ${redactCwd(step.cwd, secretValues)})`
              : '';
            process.stderr.write(`${prefix}   ${i + 1}. ini:${step.mode} ${step.file}${stepCwdDisplay}\n`);
          } else if (step.kind === 'set') {
            const assignments = Object.entries(step.vars).map(([k, v]) => `${k}=${v}`).join(', ');
            process.stderr.write(`${prefix}   ${i + 1}. set ${assignments}\n`);
          } else {
            const redacted = redactArgv(step.argv, secretValues);
            const captureTag = step.capture ? ` [capture → ${step.capture.var}]` : '';
            const stepCwdDisplay = step.cwd && step.cwd !== topCwd
              ? ` (cwd: ${redactCwd(step.cwd, secretValues)})`
              : '';
            process.stderr.write(`${prefix}   ${i + 1}. ${redacted.join(' ')}${captureTag}${stepCwdDisplay}\n`);
          }
        }
      }
      break;
    case 'parallel':
      process.stderr.write(`${prefix} resolved parallel:\n`);
      for (const entry of plan.group) {
        const redacted = redactArgv(entry.argv, secretValues);
        const entryCwdDisplay = entry.cwd && entry.cwd !== topCwd
          ? ` (cwd: ${redactCwd(entry.cwd, secretValues)})`
          : '';
        process.stderr.write(`${prefix}   [${entry.alias}] ${redacted.join(' ')}${entryCwdDisplay}\n`);
      }
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Step command preview (shown before each step)                        */
/* ------------------------------------------------------------------ */

/**
 * Print raw → resolved preview for a single step before execution.
 * If raw and resolved are the same, only prints one line.
 * Secrets in resolved argv are redacted.
 */
export function printStepPreview(
  rawArgv: readonly string[] | undefined,
  resolvedArgv: readonly string[],
  secretValues?: ReadonlySet<string>,
  options?: { verbose?: boolean; logFile?: string },
): void {
  const rawStr = rawArgv ? rawArgv.join(' ') : undefined;
  const resArgv = secretValues ? redactArgv(resolvedArgv, secretValues) : resolvedArgv;
  const resStr = resArgv.join(' ');

  // Write to stderr only in verbose mode
  if (options?.verbose !== false) {
    const useColor = shouldUseColor();
    const dim = useColor ? DIM : '';
    const reset = useColor ? RESET : '';

    if (rawStr && rawStr !== resStr) {
      process.stderr.write(`${dim}  raw: ${rawStr}${reset}\n`);
      process.stderr.write(`${dim}  run: ${resStr}${reset}\n`);
    } else {
      process.stderr.write(`${dim}  run: ${resStr}${reset}\n`);
    }
  }

  // Always write to log file if provided
  if (options?.logFile) {
    if (rawStr && rawStr !== resStr) {
      appendFileSync(options.logFile, `  raw: ${rawStr}\n  run: ${resStr}\n`);
    } else {
      appendFileSync(options.logFile, `  run: ${resStr}\n`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Capture result output                                                */
/* ------------------------------------------------------------------ */

/**
 * Print a formatted capture result block to stderr.
 * Shows the variable name, value, validation status, and (in verbose) type + assert config.
 */
export function printCaptureResult(
  cap: CaptureConfig,
  validation: CaptureValidationResult,
  verbose = false,
): void {
  const useColor = shouldUseColor();
  const dim = useColor ? DIM : '';
  const reset = useColor ? RESET : '';
  const green = useColor ? '\x1b[32m' : '';
  const red = useColor ? '\x1b[31m' : '';

  process.stderr.write(`${dim}  ┌─ capture: ${cap.var} ─────────────────${reset}\n`);
  process.stderr.write(`${dim}  │${reset} value: ${validation.coerced}\n`);

  if (verbose) {
    process.stderr.write(`${dim}  │${reset} type:  ${cap.type ?? 'string'}\n`);
    if (cap.assert) {
      const asserts = typeof cap.assert === 'string' ? [cap.assert] : cap.assert;
      process.stderr.write(`${dim}  │${reset} assert: ${asserts.join(', ')}\n`);
    }
  }

  if (validation.valid) {
    process.stderr.write(`${dim}  │${reset} ${green}PASS${reset}\n`);
  } else {
    process.stderr.write(`${dim}  │${reset} ${red}FAIL: ${validation.error}${reset}\n`);
  }

  process.stderr.write(`${dim}  └──────────────────────────────────${reset}\n`);
}

/* ------------------------------------------------------------------ */
/* Parallel summary (D-09)                                              */
/* ------------------------------------------------------------------ */

/**
 * Print a summary of parallel execution results to stderr.
 * Shows checkmark (success) or cross (failure) per alias with exit code.
 */
export function printParallelSummary(
  group: readonly { alias: string }[],
  results: { exitCode: number; canceled: boolean }[],
): void {
  const useColor = shouldUseColor();
  const check = useColor ? '\x1b[32m\u2713\x1b[0m' : '\u2713';
  const cross = useColor ? '\x1b[31m\u2717\x1b[0m' : '\u2717';

  process.stderr.write('\n');
  for (let i = 0; i < group.length; i++) {
    const entry = group[i];
    const result = results[i];
    if (!entry || !result) continue;

    const icon = result.exitCode === 0 ? check : cross;
    const codeStr = result.canceled ? 'canceled' : `exit ${result.exitCode}`;
    process.stderr.write(`  ${icon} ${entry.alias} (${codeStr})\n`);
  }
}
