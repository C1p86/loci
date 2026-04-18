// src/init/index.ts
//
// `xci init` subcommand — scaffolds a .xci/ directory with example config files
// and updates .gitignore to ignore secrets.yml and local.yml.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Command } from 'commander';
import { CONFIG_YML, COMMANDS_YML, LOCAL_EXAMPLE_YML, SECRETS_EXAMPLE_YML } from './templates.js';

/* ------------------------------------------------------------------ */
/* Types                                                                 */
/* ------------------------------------------------------------------ */

export type SummaryItem = {
  path: string;
  action: 'created' | 'skipped' | 'updated';
};

/* ------------------------------------------------------------------ */
/* Helpers                                                               */
/* ------------------------------------------------------------------ */

const GITIGNORE_ENTRIES = ['.xci/secrets.yml', '.xci/local.yml'];

/**
 * Write `content` to `filePath` only if the file does not already exist.
 * Pushes a SummaryItem with action 'created' or 'skipped'.
 * The path stored in the summary is relative to `baseDir`.
 */
function writeIfAbsent(
  filePath: string,
  content: string,
  baseDir: string,
  results: SummaryItem[],
): void {
  const rel = relative(baseDir, filePath);
  if (existsSync(filePath)) {
    results.push({ path: rel, action: 'skipped' });
  } else {
    writeFileSync(filePath, content, 'utf8');
    results.push({ path: rel, action: 'created' });
  }
}

/**
 * Ensure .gitignore in `projectDir` contains entries for
 * `.xci/secrets.yml` and `.xci/local.yml`.
 *
 * - If .gitignore does not exist: create it with the xci header + entries.
 * - If .gitignore exists: read existing lines, append only missing entries
 *   with a `# xci` header; push 'updated' or 'skipped' accordingly.
 */
function ensureGitignore(projectDir: string, results: SummaryItem[]): void {
  const gitignorePath = join(projectDir, '.gitignore');

  if (!existsSync(gitignorePath)) {
    const content = `# xci\n${GITIGNORE_ENTRIES.join('\n')}\n`;
    writeFileSync(gitignorePath, content, 'utf8');
    results.push({ path: '.gitignore', action: 'created' });
    return;
  }

  // Read existing .gitignore, normalise line endings (handles CRLF per Pitfall 2)
  const existing = readFileSync(gitignorePath, 'utf8');
  const existingLines = existing.split('\n').map((l) => l.trim());

  const missing = GITIGNORE_ENTRIES.filter((entry) => !existingLines.includes(entry));

  if (missing.length === 0) {
    results.push({ path: '.gitignore', action: 'skipped' });
    return;
  }

  const appendContent = `\n# xci\n${missing.join('\n')}\n`;
  writeFileSync(gitignorePath, existing + appendContent, 'utf8');
  results.push({ path: '.gitignore', action: 'updated' });
}

/* ------------------------------------------------------------------ */
/* Output                                                                */
/* ------------------------------------------------------------------ */

/**
 * Print the init summary to stdout.
 *
 * Example output:
 *   xci init
 *
 *     created  .xci/config.yml
 *     created  .xci/commands.yml
 *     skipped  .gitignore
 *
 *   Run `xci hello` to test your setup.
 */
function printInitSummary(results: SummaryItem[]): void {
  process.stdout.write('xci init\n\n');
  for (const { action, path } of results) {
    process.stdout.write(`  ${action.padEnd(8)} ${path}\n`);
  }
  process.stdout.write('\nRun `xci hello` to test your setup.\n');
}

/* ------------------------------------------------------------------ */
/* Public API                                                            */
/* ------------------------------------------------------------------ */

/**
 * Scaffold a .xci/ directory in `cwd`.
 *
 * Idempotent: existing files are never overwritten.
 * Synchronous: all fs operations use sync APIs for simplicity and speed.
 */
export function runInit(cwd: string): void {
  const xciDir = join(cwd, '.xci');

  // mkdirSync with recursive:true is idempotent — safe to call even if .xci/ exists (Pitfall 3)
  mkdirSync(xciDir, { recursive: true });

  const results: SummaryItem[] = [];

  writeIfAbsent(join(xciDir, 'config.yml'), CONFIG_YML, cwd, results);
  writeIfAbsent(join(xciDir, 'commands.yml'), COMMANDS_YML, cwd, results);
  writeIfAbsent(join(xciDir, 'secrets.yml.example'), SECRETS_EXAMPLE_YML, cwd, results);
  writeIfAbsent(join(xciDir, 'local.yml.example'), LOCAL_EXAMPLE_YML, cwd, results);

  ensureGitignore(cwd, results);

  printInitSummary(results);
}

/**
 * Register the `init` subcommand on `program`.
 * Must be called BEFORE findXciRoot() so `xci init` works in a directory
 * that does not yet have a .xci/ directory.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Scaffold a .xci/ directory in the current project')
    .action(() => {
      runInit(process.cwd());
    });
}
