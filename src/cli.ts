// src/cli.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { ReadStream } from 'node:tty';
import { Command } from 'commander';
import { configLoader } from './config/index.js';
import { commandsLoader } from './commands/index.js';
import { resolver, buildEnvVars, redactSecrets } from './resolver/index.js';
import { validateParams, getParamNames } from './resolver/params.js';
import { executor, printDryRun, printVerboseCommand, printVerboseTrace, buildSecretValues } from './executor/index.js';
import { CliError, exitCodeFor, XciError, UnknownAliasError, UnknownFlagError } from './errors.js';
import { XCI_VERSION } from './version.js';
import type { CommandDef, CommandMap, ExecutionPlan, ResolvedConfig } from './types.js';
import { dimPrefix } from './executor/output.js';
import { registerInitCommand } from './init/index.js';
import { registerTemplateCommand } from './template/index.js';
import { isTTY, showPicker, runWithDashboard, type DashboardContext } from './tui/index.js';

// Re-export CliError for backward-compat with existing tests
export { CliError };

/* ------------------------------------------------------------------ */
/* Log file setup                                                       */
/* ------------------------------------------------------------------ */

function createLogFile(projectRoot: string, alias: string): string {
  const logDir = join(projectRoot, '.xci', 'log');
  mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return join(logDir, `${alias}-${timestamp}.log`);
}

function askShowLog(logFile: string): Promise<boolean> {
  if (!isTTY()) return Promise.resolve(false);
  return new Promise((res) => {
    process.stderr.write(`\nLog saved to: ${logFile}\nShow log? [y/N] `);
    const stdin = process.stdin as ReadStream;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    function onData(data: Buffer): void {
      stdin.removeListener('data', onData);
      try { stdin.setRawMode(wasRaw ?? false); stdin.pause(); } catch { /* */ }
      const key = data.toString().toLowerCase();
      process.stderr.write(key + '\n');
      res(key === 'y');
    }
    stdin.on('data', onData);
  });
}

function printLogFile(logFile: string): void {
  try {
    const content = readFileSync(logFile, 'utf8');
    process.stderr.write('\n--- log start ---\n');
    process.stderr.write(content);
    process.stderr.write('--- log end ---\n');
  } catch {
    process.stderr.write(`(could not read log file: ${logFile})\n`);
  }
}

/* ------------------------------------------------------------------ */
/* Walk-up .xci/ discovery (D-18)                                      */
/* ------------------------------------------------------------------ */

function findXciRoot(startDir: string): string | null {
  let current = resolve(startDir);
  while (true) {
    if (existsSync(join(current, '.xci'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/* ------------------------------------------------------------------ */
/* Recursive YAML file discovery                                        */
/* ------------------------------------------------------------------ */

function listYamlFilesRecursive(dirPath: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }
  for (const entry of entries.sort()) {
    const full = join(dirPath, entry);
    try {
      if (statSync(full).isDirectory()) {
        results.push(...listYamlFilesRecursive(full));
      } else if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
        results.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Alias list printer (D-20, D-21, CLI-02, CLI-03)                      */
/* ------------------------------------------------------------------ */

function printAliasList(commands: CommandMap): void {
  process.stdout.write('xci — Local CI command runner\n\n');

  // Built-in commands
  process.stdout.write('Built-in commands:\n\n');
  process.stdout.write('  xci init                     Scaffold .xci/ directory\n');
  process.stdout.write('  xci template                 Generate shareable template\n');
  process.stdout.write('  xci completion [shell]       Output shell completion script\n');
  process.stdout.write('  xci install [shell]          Install shell completion permanently\n');
  process.stdout.write('  xci uninstall [shell]        Remove shell completion\n');

  // Flags
  process.stdout.write('\nFlags:\n\n');
  process.stdout.write('  --log              Show full command output in terminal\n');
  process.stdout.write('  --short-log <N>    Show last N lines of output (default: 10)\n');
  process.stdout.write('  --verbose          Show config trace + full output\n');
  process.stdout.write('  --dry-run          Preview without executing\n');
  process.stdout.write('  --list             Show command details and sub-steps\n');
  process.stdout.write('  --from <step>      Start from a specific step (skip earlier)\n');
  process.stdout.write('  --ui               Interactive TUI dashboard\n');
  process.stdout.write('  -l                 List all aliases\n');

  // Project aliases
  if (commands.size > 0) {
    process.stdout.write('\nProject aliases:\n\n');
    // Calculate padding for alignment
    const maxLen = Math.max(...[...commands.keys()].map((a) => a.length));
    for (const [alias, def] of commands) {
      const pad = ' '.repeat(maxLen - alias.length + 2);
      const desc = def.description ? `${def.description} ` : '';
      process.stdout.write(`  ${alias}${pad}${desc}(${def.kind})\n`);
    }
  } else {
    process.stdout.write('\nNo aliases defined. Edit .xci/commands.yml to add aliases.\n');
  }

  process.stdout.write('\nRun `xci <alias> --list` for details on a specific alias.\n');
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
    case 'for_each':
      lines.push(`  var: ${def.var}`);
      lines.push(`  in: [${def.in.join(', ')}]`);
      lines.push(`  mode: ${def.mode}`);
      if (def.cmd) lines.push(`  cmd: ${def.cmd.join(' ')}`);
      if (def.run) lines.push(`  run: ${def.run}`);
      break;
    case 'ini':
      lines.push(`  file: ${def.file}`);
      lines.push(`  mode: ${def.mode ?? 'overwrite'}`);
      if (def.set) {
        for (const [section, keys] of Object.entries(def.set)) {
          lines.push(`  [${section}]`);
          for (const [k, v] of Object.entries(keys)) {
            lines.push(`    ${k} = ${v}`);
          }
        }
      }
      break;
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* --list: detailed alias info                                           */
/* ------------------------------------------------------------------ */

function printAliasDetails(
  alias: string,
  def: CommandDef,
  commands: CommandMap,
  config: ResolvedConfig,
  projectRoot: string,
): void {
  const builtins: Record<string, string> = { 'xci.project.path': projectRoot, 'XCI_PROJECT_PATH': projectRoot };
  const effectiveValues = { ...config.values, ...builtins };

  process.stderr.write(`\n${alias}`);
  if (def.description) process.stderr.write(` — ${def.description}`);
  process.stderr.write(`\n  type: ${def.kind}\n`);

  // Show steps/sub-commands recursively
  switch (def.kind) {
    case 'sequential':
      process.stderr.write('  steps:\n');
      for (let i = 0; i < def.steps.length; i++) {
        const step = def.steps[i];
        const subDef = commands.get(step);
        const desc = subDef?.description ? ` — ${subDef.description}` : '';
        const kind = subDef ? ` (${subDef.kind})` : '';
        process.stderr.write(`    ${i + 1}. ${step}${kind}${desc}\n`);
      }
      break;
    case 'parallel':
      process.stderr.write(`  parallel (failMode: ${def.failMode ?? 'fast'}):\n`);
      for (const entry of def.group) {
        const subDef = commands.get(entry);
        const desc = subDef?.description ? ` — ${subDef.description}` : '';
        process.stderr.write(`    - ${entry}${desc}\n`);
      }
      break;
    case 'single':
      process.stderr.write(`  cmd: ${def.cmd.join(' ')}\n`);
      break;
    case 'for_each':
      process.stderr.write(`  var: ${def.var}  in: [${def.in.join(', ')}]  mode: ${def.mode}\n`);
      if (def.cmd) process.stderr.write(`  cmd: ${def.cmd.join(' ')}\n`);
      if (def.run) process.stderr.write(`  run: ${def.run}\n`);
      break;
    case 'ini':
      process.stderr.write(`  file: ${def.file}  mode: ${def.mode ?? 'overwrite'}\n`);
      break;
  }

  // Show params (declared + auto-detected)
  const params = getParamNames(alias, commands, effectiveValues);
  if (params.length > 0) {
    process.stderr.write('  params:\n');
    for (const p of params) {
      const tag = p.required ? 'required' : p.hasDefault ? 'has default' : 'optional';
      const desc = p.description ? ` — ${p.description}` : '';
      process.stderr.write(`    ${p.name} (${tag})${desc}\n`);
    }
  }

  process.stderr.write('\n');
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
      // Append to the LAST cmd step in the chain (skip ini steps)
      if (plan.steps.length === 0) return plan;
      const lastIdx = plan.steps.length - 1;
      const lastStep = plan.steps[lastIdx];
      if (lastStep.kind === 'ini') return plan;
      const newSteps = plan.steps.map((s, i) =>
        i === lastIdx && s.kind !== 'ini' ? { ...s, argv: [...s.argv, ...extra] } : s
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
    case 'ini':
      // Extra args don't apply to ini operations
      return plan;
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
      .option('--log', 'Show command output in terminal (default: hidden)')
      .option('--short-log <N>', 'Show last N lines of output per command')
      .option('--ui', 'Run with interactive TUI dashboard')
      .option('--list', 'Show command details and sub-steps')
      .option('--from <step>', 'Start execution from this step, skip earlier ones')
      .addHelpText('after', buildAliasHelpText(alias, def));

    sub.action(async function (this: Command, options: { dryRun?: boolean; verbose?: boolean; log?: boolean; shortLog?: string; ui?: boolean }) {
      // Reconstruct raw user args preserving the '--' boundary.
      // commander strips '--' from this.args with passThroughOptions(), so we
      // re-derive the user args slice from parent.rawArgs (which keeps '--').
      // We strip the binary path, alias name, and xci-owned flags.
      const XCI_FLAGS = new Set(['--dry-run', '--verbose', '--log', '--no-log', '--ui', '--list', '--dry-run=true', '--verbose=true', '--log=true', '--ui=true', '--list=true']);
      const rawArgs: readonly string[] = this.parent?.rawArgs ?? [];
      const aliasIdx = rawArgs.indexOf(alias);
      const afterAlias = aliasIdx >= 0 ? rawArgs.slice(aliasIdx + 1) : [...this.args];
      // Strip --short-log, --from and their values
      const filteredArgs: string[] = [];
      for (let i = 0; i < afterAlias.length; i++) {
        if (afterAlias[i] === '--short-log' || afterAlias[i] === '--from') { i++; continue; }
        if (afterAlias[i].startsWith('--short-log=') || afterAlias[i].startsWith('--from=')) continue;
        filteredArgs.push(afterAlias[i]);
      }
      const userArgs = filteredArgs.filter((a) => !XCI_FLAGS.has(a));
      const { overrides, passThrough } = parseCliOverrides(userArgs);

      // With passThroughOptions(), xci flags (--dry-run, --verbose) placed after positional
      // args are not parsed by commander and end up in afterAlias. Merge both sources.
      const isDryRun = options.dryRun === true || afterAlias.includes('--dry-run');
      const isVerbose = options.verbose === true || afterAlias.includes('--verbose');
      const isLog = options.log === true || afterAlias.includes('--log');
      const isUi = options.ui === true || afterAlias.includes('--ui');
      // --short-log may not be parsed by commander when passThroughOptions is active
      // and it appears after positional args. Fall back to manual extraction from afterAlias.
      let shortLogValue = options.shortLog;
      if (!shortLogValue) {
        const slIdx = afterAlias.indexOf('--short-log');
        if (slIdx >= 0 && slIdx + 1 < afterAlias.length) {
          shortLogValue = afterAlias[slIdx + 1];
        } else {
          const slEq = afterAlias.find((a) => a.startsWith('--short-log='));
          if (slEq) shortLogValue = slEq.split('=')[1];
        }
      }
      const parsedTail = shortLogValue ? Number.parseInt(shortLogValue, 10) : undefined;
      // Default: short-log 10. --log/--verbose: full output. --short-log 0: silent.
      const showOutput = isVerbose || isLog;
      const tailLines = showOutput ? undefined : (parsedTail ?? 10);

      const isList = (options as Record<string, unknown>).list === true || afterAlias.includes('--list');

      // --from: extract step name
      let fromStep: string | undefined = (options as Record<string, unknown>).from as string | undefined;
      if (!fromStep) {
        const fromIdx = afterAlias.indexOf('--from');
        if (fromIdx >= 0 && fromIdx + 1 < afterAlias.length) {
          fromStep = afterAlias[fromIdx + 1];
        } else {
          const fromEq = afterAlias.find((a) => a.startsWith('--from='));
          if (fromEq) fromStep = fromEq.split('=')[1];
        }
      }

      // --list: show command details, sub-steps, and params
      if (isList) {
        printAliasDetails(alias, def, commands, config, projectRoot);
        return;
      }

      // Built-in variables always available for interpolation and as env vars.
      // Registered in both dot-notation and UPPER_UNDERSCORE so users can write
      // either ${xci.project.path} or ${XCI_PROJECT_PATH} in commands.yml.
      const builtins: Record<string, string> = {
        'xci.project.path': projectRoot,
        'XCI_PROJECT_PATH': projectRoot,
      };

      // Merge: config values < builtins < CLI overrides
      const mergedValues = { ...config.values, ...builtins, ...overrides };

      // Validate params: apply defaults, check required params across the full chain
      const effectiveValues = validateParams(alias, commands, mergedValues);
      const effectiveConfig: ResolvedConfig = { ...config, values: effectiveValues };

      // Resolve the execution plan using effective config (includes builtins + overrides + param defaults)
      const plan = resolver.resolve(alias, commands, effectiveConfig);

      // Build env vars: include both original keys (for ${placeholder} interpolation in
      // sequential steps) and UPPER_UNDERSCORE keys (for child process env vars).
      const env: Record<string, string> = { ...effectiveValues, ...buildEnvVars(effectiveValues) };
      if (isVerbose) env['XCI_VERBOSE'] = '1';
      const secretValues = buildSecretValues(config);

      // Verbose trace (D-28, D-26, D-30) — always to stderr
      if (isVerbose) {
        const configFiles: { path: string; found: boolean }[] = [];
        // Machine configs directory
        const machineConfigsDir = process.env['XCI_MACHINE_CONFIGS'];
        if (machineConfigsDir) {
          let isDir = false;
          try { isDir = statSync(machineConfigsDir).isDirectory(); } catch { /* ignore */ }
          if (isDir) {
            configFiles.push({ path: join(machineConfigsDir, 'commands.yml'), found: existsSync(join(machineConfigsDir, 'commands.yml')) });
            configFiles.push({ path: join(machineConfigsDir, 'secrets.yml'), found: existsSync(join(machineConfigsDir, 'secrets.yml')) });
            const mSecretsDir = join(machineConfigsDir, 'secrets');
            if (existsSync(mSecretsDir)) {
              for (const f of listYamlFilesRecursive(mSecretsDir)) {
                configFiles.push({ path: f, found: true });
              }
            }
            const mCommandsDir = join(machineConfigsDir, 'commands');
            if (existsSync(mCommandsDir)) {
              for (const f of listYamlFilesRecursive(mCommandsDir)) {
                configFiles.push({ path: f, found: true });
              }
            }
          }
        }
        // Project files
        configFiles.push(
          { path: join(projectRoot, '.xci', 'config.yml'), found: existsSync(join(projectRoot, '.xci', 'config.yml')) },
          { path: join(projectRoot, '.xci', 'secrets.yml'), found: existsSync(join(projectRoot, '.xci', 'secrets.yml')) },
          { path: join(projectRoot, '.xci', 'local.yml'), found: existsSync(join(projectRoot, '.xci', 'local.yml')) },
        );
        // Project secrets/ directory
        const projSecretsDir = join(projectRoot, '.xci', 'secrets');
        if (existsSync(projSecretsDir)) {
          for (const f of listYamlFilesRecursive(projSecretsDir)) {
            configFiles.push({ path: f, found: true });
          }
        }
        const redactedEnv = redactSecrets(env, config.secretKeys);
        printVerboseTrace(projectRoot, configFiles, redactedEnv, config.secretKeys);
        printVerboseCommand(def, plan, secretValues);
      }

      // Dry-run (D-27, D-30) — print and return without executing
      if (isDryRun) {
        printDryRun(plan, secretValues, effectiveValues, config.secretKeys);
        return;
      }

      // Append pass-through args to the plan's argv
      const finalPlan = passThrough.length > 0 ? appendExtraArgs(plan, passThrough) : plan;

      // Create log file
      const logFile = createLogFile(projectRoot, alias);

      // Execute — use TUI dashboard only when --ui is explicitly requested
      const result = isUi && isTTY()
        ? await runWithDashboard(finalPlan, projectRoot, env, {
            commandMap: commands,
            config: effectiveConfig,
            cwd: projectRoot,
            env,
          } satisfies DashboardContext)
        : await executor.run(finalPlan, { cwd: projectRoot, env, logFile, showOutput, tailLines, fromStep });
      if (result.exitCode !== 0) {
        process.exitCode = result.exitCode;
        // On error, offer to show the log (if output was hidden)
        if (!showOutput) {
          const show = await askShowLog(logFile);
          if (show) printLogFile(logFile);
        }
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
    .version(XCI_VERSION, '-V, --version', 'output the current xci version')
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
  if (err instanceof XciError) {
    process.stderr.write(`error [${err.code}]: ${err.message}\n`);
    if (err.cause) {
      const causeMsg = err.cause instanceof Error ? err.cause.message : String(err.cause);
      process.stderr.write(`  cause: ${causeMsg}\n`);
    }
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
    // Try to extract alias name from commander message, then from raw process.argv
    const match = commanderErr.message?.match(/excess arguments?: (.+)/i);
    let aliasName = match ? match[1].split(',')[0]?.trim().replace(/^'|'$/g, '') : undefined;
    if (!aliasName) {
      // Fallback: first non-flag arg after the script path is likely the alias
      const args = process.argv.slice(2);
      aliasName = args.find((a) => !a.startsWith('-') && !a.includes('=')) ?? '(unknown)';
    }
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
/* Shell completion                                                      */
/* ------------------------------------------------------------------ */

const XCI_FLAGS = ['--dry-run', '--verbose', '--log', '--short-log', '--ui', '--help'];

function generatePowerShellScript(): string {
  return `# xci PowerShell completion — add to your $PROFILE
Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete
if ((Get-Module PSReadLine).Version -ge [version]'2.2.0') { Set-PSReadLineOption -PredictionViewStyle ListView }
Register-ArgumentCompleter -CommandName xci -Native -ScriptBlock { param($wordToComplete, $commandAst, $cursorPosition); $words = $commandAst.ToString() -split '\\s+'; $result = & xci --get-completions @words 2>$null; if ($result) { $result -split '\\n' | ForEach-Object { $parts = $_ -split '\\t', 2; $text = $parts[0]; $tooltip = if ($parts.Length -gt 1) { $parts[1] } else { $text }; [System.Management.Automation.CompletionResult]::new($text, $text, 'ParameterValue', $tooltip) } } }
`;
}

async function handleGetCompletions(argv: readonly string[]): Promise<string[]> {
  // argv: ['node', 'cli.mjs', '--get-completions', 'xci', ...words]
  const words = argv.slice(4); // skip node, script, --get-completions, 'xci'
  const completions: string[] = [];

  const projectRoot = findXciRoot(process.cwd());
  if (projectRoot === null) return completions;

  let config: ResolvedConfig;
  let commands: CommandMap;
  try {
    [config, commands] = await Promise.all([
      configLoader.load(projectRoot),
      commandsLoader.load(projectRoot),
    ]);
  } catch {
    return completions;
  }

  const aliasName = words[0];

  // No alias yet or completing alias name
  if (!aliasName || (words.length === 1 && !commands.has(aliasName))) {
    // Complete alias names
    const builtins = ['init', 'template', 'completion'];
    for (const name of builtins) {
      if (name.startsWith(aliasName ?? '')) {
        completions.push(name);
      }
    }
    for (const [name, def] of commands) {
      if (name.startsWith(aliasName ?? '')) {
        completions.push(`${name}\t${def.description ?? ''}`);
      }
    }
    return completions;
  }

  // Alias is known — complete flags and params
  if (!commands.has(aliasName)) return completions;

  const currentWord = words[words.length - 1] ?? '';

  // Complete flags
  if (currentWord.startsWith('-')) {
    for (const flag of XCI_FLAGS) {
      if (flag.startsWith(currentWord)) {
        completions.push(flag);
      }
    }
    return completions;
  }

  // Complete param names (KEY=value style)
  // Collect already-provided overrides
  const providedKeys = new Set<string>();
  for (const w of words.slice(1)) {
    const eqIdx = w.indexOf('=');
    if (eqIdx > 0) providedKeys.add(w.substring(0, eqIdx));
  }

  const builtins: Record<string, string> = {
    'xci.project.path': projectRoot,
    'XCI_PROJECT_PATH': projectRoot,
  };
  const effectiveValues = { ...config.values, ...builtins };

  const params = getParamNames(aliasName, commands, effectiveValues);
  const prefix = currentWord.includes('=') ? '' : currentWord;

  for (const p of params) {
    if (providedKeys.has(p.name)) continue;
    if (p.name.startsWith(prefix)) {
      const suffix = p.required ? ' (required)' : p.hasDefault ? ' (has default)' : ' (optional)';
      completions.push(`${p.name}=\t${(p.description ?? '') + suffix}`);
    }
  }

  return completions;
}

/* ------------------------------------------------------------------ */
/* main (D-17, D-19, D-20, D-24)                                        */
/* ------------------------------------------------------------------ */

async function main(argv: readonly string[]): Promise<number> {
  // Handle --get-completions early, before commander parsing
  if (argv[2] === '--get-completions') {
    const completions = await handleGetCompletions(argv);
    if (completions.length > 0) {
      process.stdout.write(completions.join('\n') + '\n');
    }
    return 0;
  }

  const program = buildProgram();

  // Register init, template, and completion commands BEFORE findXciRoot so they work from any directory
  registerInitCommand(program);
  registerTemplateCommand(program);
  program
    .command('completion')
    .description('Output shell completion script')
    .argument('[shell]', 'Shell type (powershell)', 'powershell')
    .action((shell: string) => {
      if (shell === 'powershell' || shell === 'pwsh') {
        process.stdout.write(generatePowerShellScript());
      } else {
        process.stderr.write(`Unsupported shell: ${shell}. Supported: powershell\n`);
        process.exitCode = 1;
      }
    });

  program
    .command('install')
    .description('Install shell completion permanently')
    .argument('[shell]', 'Shell type (powershell)', 'powershell')
    .action(async (shell: string) => {
      if (shell !== 'powershell' && shell !== 'pwsh') {
        process.stderr.write(`Unsupported shell: ${shell}. Supported: powershell\n`);
        process.exitCode = 1;
        return;
      }
      const script = generatePowerShellScript();
      const marker = '# xci PowerShell completion';

      // Find PowerShell profile path
      const { execSync } = await import('node:child_process');
      let profilePath: string;
      try {
        profilePath = execSync('powershell -NoProfile -Command "$PROFILE"', { encoding: 'utf8' }).trim();
      } catch {
        try {
          profilePath = execSync('pwsh -NoProfile -Command "$PROFILE"', { encoding: 'utf8' }).trim();
        } catch {
          process.stderr.write('Could not detect PowerShell profile path.\n');
          process.stderr.write('Run manually: xci completion powershell >> $PROFILE\n');
          process.exitCode = 1;
          return;
        }
      }

      // Read existing profile, check if already installed
      const { existsSync: exists, readFileSync: readFile, appendFileSync: appendFile, mkdirSync: mkDir } = await import('node:fs');
      const { dirname: dir } = await import('node:path');
      let existing = '';
      if (exists(profilePath)) {
        existing = readFile(profilePath, 'utf8');
      }

      if (existing.includes(marker)) {
        process.stderr.write(`xci completion already installed in ${profilePath}\n`);
        process.stderr.write('To reinstall, remove the existing xci block from your $PROFILE and run again.\n');
        return;
      }

      // Ensure profile directory exists
      mkDir(dir(profilePath), { recursive: true });

      // Append completion script
      appendFile(profilePath, '\n' + script);
      process.stderr.write(`xci completion installed in ${profilePath}\n`);
      process.stderr.write('Restart PowerShell or run: . $PROFILE\n');
    });

  program
    .command('uninstall')
    .description('Remove shell completion from profile')
    .argument('[shell]', 'Shell type (powershell)', 'powershell')
    .action(async (shell: string) => {
      if (shell !== 'powershell' && shell !== 'pwsh') {
        process.stderr.write(`Unsupported shell: ${shell}. Supported: powershell\n`);
        process.exitCode = 1;
        return;
      }

      const { execSync } = await import('node:child_process');
      let profilePath: string;
      try {
        profilePath = execSync('powershell -NoProfile -Command "$PROFILE"', { encoding: 'utf8' }).trim();
      } catch {
        try {
          profilePath = execSync('pwsh -NoProfile -Command "$PROFILE"', { encoding: 'utf8' }).trim();
        } catch {
          process.stderr.write('Could not detect PowerShell profile path.\n');
          process.exitCode = 1;
          return;
        }
      }

      const { existsSync: exists, readFileSync: readFile, writeFileSync: writeFile } = await import('node:fs');
      if (!exists(profilePath)) {
        process.stderr.write('No PowerShell profile found. Nothing to remove.\n');
        return;
      }

      const content = readFile(profilePath, 'utf8');
      // Remove the xci block: from marker line through the Register-ArgumentCompleter line
      const cleaned = content.replace(/\n?# xci PowerShell completion[^\n]*(?:\n[^\n]*(?:Set-PSReadLineKeyHandler|Set-PSReadLineOption|Register-ArgumentCompleter)[^\n]*)*/g, '');

      if (cleaned === content) {
        process.stderr.write('xci completion not found in profile. Nothing to remove.\n');
        return;
      }

      writeFile(profilePath, cleaned);
      process.stderr.write(`xci completion removed from ${profilePath}\n`);
      process.stderr.write('Restart PowerShell to apply.\n');
    });

  // D-18: walk-up discovery
  const projectRoot = findXciRoot(process.cwd());

  if (projectRoot === null) {
    // D-19: no .xci/ found — --version, --help, --list, and init still work
    let helpOrVersionDisplayed = false;
    let subcommandRan = false;
    program.action(() => {
      process.stdout.write("No .xci/ directory found. Run 'xci init' to get started.\n");
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
    if (err instanceof XciError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      if (err.cause) {
        const causeMsg = err.cause instanceof Error ? err.cause.message : String(err.cause);
        process.stderr.write(`  cause: ${causeMsg}\n`);
      }
      if (err.suggestion) process.stderr.write(`  suggestion: ${err.suggestion}\n`);
      return exitCodeFor(err);
    }
    throw err;
  }

  // Register dynamic alias sub-commands
  registerAliases(program, commands, config, projectRoot);

  // D-20: no-args shows alias list; D-21: --list option triggers alias list.
  // With --ui in a TTY: show interactive picker, let user select and execute.
  // Without --ui or in non-TTY: print plain alias list.
  program.option('--ui', 'Interactive TUI mode');
  program.action(async (options: { list?: boolean; ui?: boolean }) => {
    if (options.ui && isTTY()) {
      const selected = await showPicker(commands);
      if (selected === null) return; // user quit
      // Execute the selected alias by re-parsing with the alias name + --ui
      await program.parseAsync([...argv.slice(0, 2), selected, '--ui']);
      return;
    }
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
