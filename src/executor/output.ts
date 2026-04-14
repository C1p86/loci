// src/executor/output.ts
//
// All output formatting for the executor and CLI (D-01 to D-10, D-27, D-28, D-30).

import { redactSecrets } from '../resolver/envvars.js';
import type { ExecutionPlan, ResolvedConfig } from '../types.js';

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
export function printStepHeader(stepName: string): void {
  process.stderr.write(`\u25b6 ${stepName}\n`);
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

/* ------------------------------------------------------------------ */
/* Dry-run output (D-27, D-30)                                          */
/* ------------------------------------------------------------------ */

/**
 * Print a structured dry-run preview of the execution plan to stderr.
 * Secret values in argv are replaced with ***.
 */
export function printDryRun(plan: ExecutionPlan, secretKeys: ReadonlySet<string>): void {
  // For dry-run we treat secretKeys as secret values (simplified: the caller
  // should pass buildSecretValues(config) result as secretKeys parameter here
  // when actual values are available; the type is ReadonlySet<string> either way).
  const prefix = dimPrefix('dry-run');

  switch (plan.kind) {
    case 'single': {
      const redacted = redactArgv(plan.argv, secretKeys);
      process.stderr.write(`${prefix} single: ${redacted.join(' ')}\n`);
      break;
    }
    case 'sequential': {
      process.stderr.write(`${prefix} sequential (${plan.steps.length} steps):\n`);
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        if (step) {
          const redacted = redactArgv(step, secretKeys);
          process.stderr.write(`${prefix}   ${i + 1}. ${redacted.join(' ')}\n`);
        }
      }
      break;
    }
    case 'parallel': {
      process.stderr.write(
        `${prefix} parallel (failMode: ${plan.failMode}, ${plan.group.length} commands):\n`,
      );
      for (const entry of plan.group) {
        const redacted = redactArgv(entry.argv, secretKeys);
        process.stderr.write(`${prefix}   [${entry.alias}] ${redacted.join(' ')}\n`);
      }
      break;
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
