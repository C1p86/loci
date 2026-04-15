// src/cli.ts
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Command } from 'commander';
import { configLoader } from './config/index.js';
import { commandsLoader } from './commands/index.js';
import { resolver, buildEnvVars, redactSecrets } from './resolver/index.js';
import { executor, printDryRun, printVerboseTrace, buildSecretValues } from './executor/index.js';
import { CliError, exitCodeFor, LociError, UnknownAliasError, UnknownFlagError } from './errors.js';
import { LOCI_VERSION } from './version.js';
import type { CommandDef, CommandMap, ExecutionPlan, ResolvedConfig } from './types.js';
import { dimPrefix } from './executor/output.js';
import { registerInitCommand } from './init/index.js';

// Re-export CliError for backward-compat with existing tests
export { CliError };

/* ------------------------------------------------------------------ */
/* Walk-up .loci/ discovery (D-18)                                      */
/* ------------------------------------------------------------------ */

function findLociRoot(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, '.loci'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/* ------------------------------------------------------------------ */
/* Alias list printer (D-20, D-21, CLI-02, CLI-03)                      */
/* ------------------------------------------------------------------ */

function printAliasList(commands: CommandMap): void {
  if (commands.size === 0) {
    process.stdout.write('No aliases defined in commands.yml\n');
    return;
  }
  process.stdout.write('Available aliases:\n\n');
  for (const [alias, def] of commands) {
    const desc = def.description ?? '';
    const kind = def.kind;
    process.stdout.write(`  ${alias}  ${desc ? '- ' + desc : ''}  (${kind})\n`);
  }
  process.stdout.write('\nRun `xci <alias> --help` for details on a specific alias.\n');
}

/* ------------------------------------------------------------------ */
/* Per-alias help text builder (D-22, CLI-04)                           */
/* ------------------------------------------------------------------ */

function buildAliasHelpText(alias: string, def: CommandDef): string {
  const lines: string[] = [''];
  lines.push(`Command type: ${def.kind}`);
  switch (def.kind) {
    case 'single':
      lines.push(`  cmd: ${def.cmd.join(' ')}`);
      if (def.platforms) {
        for (const [os, cmd] of Object.entries(def.platforms)) {
          if (cmd) lines.push(`  ${os}: ${(cmd as readonly string[]).join(' ')}`);
        }
      }
      break;
    case 'sequential':
      lines.push('  steps:');
      def.steps.forEach((step, i) => lines.push(`    ${i + 1}. ${step}`));
      break;
    case 'parallel':
      lines.push(`  members (failMode: ${def.failMode ?? 'fast'}):`);
      def.group.forEach((entry) => lines.push(`    - ${entry}`));
      break;
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* parseCliOverrides helper (CLI-KV)                                     */
/* ------------------------------------------------------------------ */

/**
 * Partition raw CLI args into KEY=VALUE overrides and pass-through args.
 *
 * Rules:
 * - Split at the first '--' separator (if present). Everything after '--' is pass-through verbatim.
 * - Before '--': args matching /^([^=]+)=(.*)$/ (non-empty key) are overrides.
 * - Before '--': args NOT matching that pattern are pass-through.
 * - Overrides have highest config precedence (above local.yml). No redaction applies.
 */
export function parseCliOverrides(args: readonly string[]): {
  overrides: Record<string, string>;
  passThrough: string[];
} {
  const dashDashIdx = args.indexOf('--');
  const preArgs = dashDashIdx === -1 ? args : args.slice(0, dashDashIdx);
  const postArgs = dashDashIdx === -1 ? [] : [...args.slice(dashDashIdx + 1)];

  const overrides: Record<string, string> = {};
  const prePassThrough: string[] = [];

  for (const arg of preArgs) {
    const match = /^([^=]+)=(.*)$/.exec(arg);
    if (match?.[1] !== undefined) {
      overrides[match[1]] = match[2] ?? '';
    } else {
      prePassThrough.push(arg);
    }
  }

  return { overrides, passThrough: [...prePassThrough, ...postArgs] };
}

/* ------------------------------------------------------------------ */
/* appendExtraArgs helper (CLI-05)                                       */
/* ------------------------------------------------------------------ */

function appendExtraArgs(plan: ExecutionPlan, extra: readonly string[]): ExecutionPlan {
  switch (plan.kind) {
    case 'single':
      return { ...plan, argv: [...plan.argv, ...extra] };
    case 'sequential': {
      // Append to the LAST step in the chain
      if (plan.steps.length === 0) return plan;
      const lastIdx = plan.steps.length - 1;
      const newSteps = plan.steps.map((s, i) =>
        i === lastIdx ? [...s, ...extra] : s
      );
      return { ...plan, steps: newSteps };
    }
    case 'parallel':
      // Append to ALL parallel entries
      return {
        ...plan,
        group: plan.group.map((entry) => ({
          ...entry,
          argv: [...entry.argv, ...extra],
        })),
      };
  }
}

/* ------------------------------------------------------------------ */
/* registerAliases (D-16, D-23, CLI-01, CLI-05)                         */
/* ------------------------------------------------------------------ */

function registerAliases(
  program: Command,
  commands: CommandMap,
  config: ResolvedConfig,
  projectRoot: string,
): void {
  for (const [alias, def] of commands) {
    const sub = program
      .command(alias)
      .description(def.description ?? '')
      .passThroughOptions()
      .allowUnknownOption()
      .allowExcessArguments()
      .option('--dry-run', 'Preview the resolved command without executing')
      .option('--verbose', 'Show config trace and run the command')
      .addHelpText('after', buildAliasHelpText(alias, def));

    sub.action(async function (this: Command, options: { dryRun?: boolean; verbose?: boolean }) {
      const { overrides, passThrough } = parseCliOverrides(this.args);

      // Merge CLI overrides into config values (highest precedence — above local.yml)
      const effectiveValues = Object.keys(overrides).length > 0
        ? { ...config.values, ...overrides }
        : config.values;
      const effectiveConfig: ResolvedConfig = Object.keys(overrides).length > 0
        ? { ...config, values: effectiveValues }
        : config;

      // Resolve the execution plan using effective (override-patched) config
      const plan = resolver.resolve(alias, commands, effectiveConfig);

      // Build env vars: base from effectiveValues (includes CLI overrides); no redaction for overrides
      const env = buildEnvVars(effectiveValues);
      const secretValues = buildSecretValues(config);

      // Verbose trace (D-28, D-26, D-30) — always to stderr
      if (options.verbose) {
        const configFiles = [
          { path: join(projectRoot, '.loci', 'config.yml'), found: existsSync(join(projectRoot, '.loci', 'config.yml')) },
          { path: join(projectRoot, '.loci', 'secrets.yml'), found: existsSync(join(projectRoot, '.loci', 'secrets.yml')) },
          { path: join(projectRoot, '.loci', 'local.yml'), found: existsSync(join(projectRoot, '.loci', 'local.yml')) },
        ];
        // Add machine config if set
        const machineConfig = process.env['LOCI_MACHINE_CONFIG'];
        if (machineConfig) {
          configFiles.unshift({ path: machineConfig, found: existsSync(machineConfig) });
        }
        const redactedEnv = redactSecrets(env, config.secretKeys);
        printVerboseTrace(projectRoot, configFiles, redactedEnv, config.secretKeys);
      }

      // Dry-run (D-27, D-30) — print and return without executing
      if (options.dryRun) {
        printDryRun(plan, secretValues);
        return;
      }

      // Append pass-through args to the plan's argv
      const finalPlan = passThrough.length > 0 ? appendExtraArgs(plan, passThrough) : plan;

      // Execute
      const result = await executor.run(finalPlan, { cwd: projectRoot, env });
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
      }
    });
  }
}

/* ------------------------------------------------------------------ */
/* buildProgram                                                          */
/* ------------------------------------------------------------------ */

function buildProgram(): Command {
  const program = new Command();
  program
    .name('xci')
    .description('Local CI - cross-platform command alias runner')
    .version(LOCI_VERSION, '-V, --version', 'output the current xci version')
    .helpOption('-h, --help', 'display help for command')
    .enablePositionalOptions() // CRITICAL for passThroughOptions on subcommands
    .exitOverride()
    // Suppress commander's own stderr output for errors we handle ourselves.
    // Without this, showHelpAfterError() + exitOverride() causes double output:
    // commander writes "error: too many arguments\n<help>" then throws, then
    // handleError() writes our clean "error [CLI_UNKNOWN_ALIAS]" message.
    .configureOutput({ writeErr: () => {} });

  program.option('-l, --list', 'list all available aliases');

  return program;
}

/* ------------------------------------------------------------------ */
/* handleError (CLI-09, D-24, D-25)                                     */
/* ------------------------------------------------------------------ */

function handleError(err: unknown, _program?: Command): number {
  if (err instanceof LociError) {
    process.stderr.write(`error [${err.code}]: ${err.message}\n`);
    if (err.suggestion) process.stderr.write(`  suggestion: ${err.suggestion}\n`);
    return exitCodeFor(err);
  }

  const commanderErr = err as { code?: string; exitCode?: number; message?: string };
  if (commanderErr.code === 'commander.helpDisplayed' || commanderErr.code === 'commander.version') {
    return 0;
  }

  // Gap 1 fix: commander.excessArguments fires for unknown aliases in some v14 edge cases.
  // Suppress commander's own output by using exitOverride(); then reformat as UnknownAliasError.
  if (commanderErr.code === 'commander.excessArguments') {
    const match = commanderErr.message?.match(/excess arguments: (.+)/i);
    const aliasName = match ? match[1].split(',')[0]?.trim().replace(/^'|'$/g, '') : 'unknown';
    process.stderr.write(`error [CLI_UNKNOWN_ALIAS]: Unknown alias: "${aliasName}"\n`);
    process.stderr.write('  suggestion: Run `xci --list` to see available aliases\n');
    return 50;
  }

  // D-24: unknown command (alias not found) — show error + available aliases
  if (commanderErr.code === 'commander.unknownCommand') {
    process.stderr.write(`error [CLI_UNKNOWN_ALIAS]: Unknown alias: "${commanderErr.message}"\n`);
    process.stderr.write('  suggestion: Run `xci --list` to see available aliases\n');
    return 50;
  }

  if (commanderErr.code?.startsWith('commander.')) {
    const wrapped = new UnknownFlagError(commanderErr.message ?? 'cli error');
    process.stderr.write(`error [${wrapped.code}]: ${wrapped.message}\n`);
    if (wrapped.suggestion) process.stderr.write(`  suggestion: ${wrapped.suggestion}\n`);
    return exitCodeFor(wrapped);
  }

  process.stderr.write(`unexpected error: ${(err as Error).message}\n`);
  return 1;
}

/* ------------------------------------------------------------------ */
/* main (D-17, D-19, D-20, D-24)                                        */
/* ------------------------------------------------------------------ */

async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram();

  // Register init command BEFORE findLociRoot so `loci init` works from any directory
  registerInitCommand(program);

  // D-18: walk-up discovery
  const projectRoot = findLociRoot(process.cwd());

  if (projectRoot === null) {
    // D-19: no .loci/ found — --version, --help, --list, and init still work
    let helpOrVersionDisplayed = false;
    let subcommandRan = false;
    program.action(() => {
      process.stdout.write("No .loci/ directory found. Run 'xci init' to get started.\n");
    });
    // Track when a registered subcommand (e.g. init) runs successfully
    program.hook('postAction', (_thisCommand, actionCommand) => {
      if (actionCommand !== program) {
        subcommandRan = true;
      }
    });
    try {
      await program.parseAsync(argv as string[]);
    } catch (err) {
      const commanderErr = err as { code?: string };
      if (
        commanderErr.code === 'commander.helpDisplayed' ||
        commanderErr.code === 'commander.version'
      ) {
        helpOrVersionDisplayed = true;
      } else {
        return handleError(err, program);
      }
    }
    // Exit 0 when --help/--version shown or a subcommand (init) ran successfully
    return helpOrVersionDisplayed || subcommandRan ? 0 : 1;
  }

  // Load config and commands
  let config: ResolvedConfig;
  let commands: CommandMap;
  try {
    [config, commands] = await Promise.all([
      configLoader.load(projectRoot),
      commandsLoader.load(projectRoot),
    ]);
  } catch (err) {
    if (err instanceof LociError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      if (err.suggestion) process.stderr.write(`  suggestion: ${err.suggestion}\n`);
      return exitCodeFor(err);
    }
    throw err;
  }

  // Register dynamic alias sub-commands
  registerAliases(program, commands, config, projectRoot);

  // D-20: no-args shows alias list; D-21: --list option triggers alias list.
  // Both `loci` (no args) and `loci --list` show the alias list.
  // Commander routes here when no subcommand is matched.
  program.action((_options: { list?: boolean }) => {
    printAliasList(commands);
  });

  try {
    await program.parseAsync(argv as string[]);
    return process.exitCode ? Number(process.exitCode) : 0;
  } catch (err) {
    return handleError(err, program);
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                           */
/* ------------------------------------------------------------------ */

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(1);
  },
);

export { buildProgram, main };
