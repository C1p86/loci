// src/cli.ts
import { Command } from 'commander';
import { CliError, exitCodeFor, LociError, UnknownFlagError } from './errors.js';
import { LOCI_VERSION } from './version.js';

function buildProgram(): Command {
  const program = new Command();

  program
    .name('loci')
    .description('Local CI — cross-platform command alias runner')
    .version(LOCI_VERSION, '-V, --version', 'output the current loci version')
    .helpOption('-h, --help', 'display help for command')
    .showHelpAfterError()
    .exitOverride(); // convert commander errors into throws we control

  // Default action: print help + phase-1 hint (D-15)
  program.action(() => {
    program.outputHelp();
    process.stdout.write(
      '\n(no aliases defined yet — .loci/commands.yml will be loaded once Phase 2+ ships)\n',
    );
  });

  return program;
}

async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[]);
    return 0;
  } catch (err) {
    // commander.exitOverride() throws CommanderError with a `.code` like 'commander.unknownOption'.
    if (err instanceof LociError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      if (err.suggestion) {
        process.stderr.write(`  suggestion: ${err.suggestion}\n`);
      }
      return exitCodeFor(err);
    }
    // Commander's own errors — help/version are success paths; real parse errors are not.
    const commanderErr = err as { code?: string; exitCode?: number; message?: string };
    if (
      commanderErr.code === 'commander.helpDisplayed' ||
      commanderErr.code === 'commander.version'
    ) {
      return 0;
    }
    if (commanderErr.code?.startsWith('commander.')) {
      const wrapped = new UnknownFlagError(commanderErr.message ?? 'cli error');
      process.stderr.write(`error [${wrapped.code}]: ${wrapped.message}\n`);
      if (wrapped.suggestion) {
        process.stderr.write(`  suggestion: ${wrapped.suggestion}\n`);
      }
      return exitCodeFor(wrapped);
    }
    // Unexpected non-loci, non-commander error
    process.stderr.write(`unexpected error: ${(err as Error).message}\n`);
    return 1;
  }
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(1);
  },
);

// Re-export for programmatic tests (Plan 03 may import `main` directly)
// CliError is used via `instanceof` in the catch block; re-exported so tree-shaking does not drop it
export { buildProgram, CliError, main };
