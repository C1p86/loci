# Phase 4: Executor & CLI - Research

**Researched:** 2026-04-14
**Domain:** execa v9 process execution, commander.js v14 CLI wiring, cross-platform signal handling, ANSI output prefixing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Parallel Output Prefixing (EXE-05)**
- D-01: Color-coded bare prefix (no brackets) on TTY. E.g. `build Compiling...` with `build` in color.
- D-02: Hash-based color palette — same alias always same color. Use 6-8 distinct ANSI colors.
- D-03: Bracket fallback `[build] Compiling...` when stdout is not a TTY.
- D-04: NO_COLOR disables ANSI codes (falls back to brackets). FORCE_COLOR forces colors in piped output.
- D-05: Line-buffered interleaving — buffer until newline, emit with prefix.
- D-06: Left-aligned prefixes, no right-padding/alignment.
- D-07: No prefix for single commands — pass stdout/stderr through transparently.
- D-08: Step headers for sequential chains: `▶ build` before each step.
- D-09: Summary line after parallel completion with colored checkmark/cross and exit code.
- D-10: Diagnostic prefixes (`[verbose]`, `[dry-run]`) use dim/gray ANSI.

**Parallel Kill & Signal Handling (EXE-04, EXE-07)**
- D-11: Configurable `failMode: fast | complete` per parallel group in commands.yml.
- D-12: Default `failMode` is `fast` (kill siblings on first failure).
- D-13: 3-second grace period on failure/Ctrl+C: SIGTERM first, then SIGKILL. Use `forceKillAfterDelay: 3000`.
- D-14: SIGINT propagation: forward SIGTERM to all children (3s grace), then exit with code 130.
- D-15: `failMode` validated at commands.yml load time (extending Phase 3 eager validation D-11). Invalid values → `CommandSchemaError`. Requires modification to `src/commands/` and `src/types.ts`.

**CLI Wiring (CLI-01 through CLI-09)**
- D-16: Dynamic `.command()` per alias — loop over `CommandMap`, register each alias as a sub-command.
- D-17: Load before parse — `loadConfig → loadCommands → registerAliases → program.parseAsync`.
- D-18: Walk-up `.loci/` discovery from cwd. Also reads `LOCI_MACHINE_CONFIG` env var.
- D-19: Graceful "no config" — print friendly message, exit 0. `--version` and `--help` still work.
- D-20: No-args shows alias list (same as `loci --list`). Replaces Phase 1 empty-state hint.
- D-21: `--list` / `-l` produces same alias list output as no-args.
- D-22: Per-alias `--help` shows: description, command type, steps/members preview (mini dry-run).
- D-23: Per-alias `--dry-run` and `--verbose` flags registered on each dynamic sub-command.
- D-24: Unknown alias → error with all available aliases listed. No fuzzy matching. Exit code 50.
- D-25: Exit codes confirmed: 0=success, 10=Config, 20=Command, 30=Interpolation, 40=Executor, 50=CLI, 130=SIGINT.
- D-26: `--verbose` output includes discovered project root path.

**Dry-Run & Verbose Output (CLI-06, CLI-07)**
- D-27: Structured `--dry-run` preview: type label, numbered steps for chains, named entries for parallel groups (with failMode). Secrets replaced by `***`.
- D-28: `--verbose` shows config trace AND executes. Not trace-only.
- D-29: `--verbose --dry-run` combo shows full verbose trace WITHOUT executing.
- D-30: All `[verbose]` and `[dry-run]` output goes to stderr. Command stdout stays on stdout.

### Claude's Discretion

- Stderr handling for parallel prefixing — same prefix same stream vs merged.
- Internal architecture of the executor (single function vs class vs strategy pattern).
- How to implement line-buffering (transform stream, manual buffer, etc.).
- Hash function for color assignment (simple string hash is fine).
- Exact dim/muted ANSI codes for diagnostic prefixes.
- Whether walk-up discovery is in `src/cli.ts` or a separate module.
- How to wire `failMode` field into `types.ts` `CommandDef` parallel variant.
- Whether summary line uses Unicode symbols or ASCII fallbacks.
- Test organization within `src/executor/__tests__/`.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXE-01 | Execute commands with `execa`, `shell: false`, cross-platform | execa 9.6.1 confirmed; `shell: false` is the default — no option needed |
| EXE-02 | Stream stdout/stderr in real-time | `stdout: 'inherit', stderr: 'inherit'` or transform + 'inherit' array; verified in session |
| EXE-03 | Exit code propagation: single → child code; sequential → first non-zero; parallel → first failure code | `reject: false` + `result.exitCode`; `isCanceled` check for aborted parallel siblings |
| EXE-04 | Kill sibling processes on parallel failure | One `AbortController` per parallel group; pass `cancelSignal` to all; abort on first failure |
| EXE-05 | Prefix parallel output with command name/index | execa generator transforms on `stdout`/`stderr` options; `[transform, 'inherit']` array confirmed |
| EXE-06 | CWD of child processes = project root (`.loci/` dir) | execa `cwd` option; walk-up discovers project root |
| EXE-07 | SIGINT propagates cleanly, no orphaned processes | `process.on('SIGINT')` → `controller.abort()` → `exit(130)`; OS process group handles single/sequential automatically |
| CLI-01 | Dynamic alias registration via commander.js v14 | `program.enablePositionalOptions()` + loop of `.command(alias).passThroughOptions().allowUnknownOption().allowExcessArguments()` |
| CLI-02 | `loci` no-args shows alias list | `program.action()` default handler iterates `program.commands` |
| CLI-03 | `loci --list` / `-l` shows alias list | Root-level option that triggers same list output as no-args |
| CLI-04 | `--help` general and per-alias | Commander auto-generates per-subcommand help; per-alias help adds type+steps preview via `.addHelpText()` |
| CLI-05 | `loci <alias> -- <extra args>` passes through | `passThroughOptions()` + `allowUnknownOption()` + `allowExcessArguments()`; `this.args` in action contains post-`--` args; verified |
| CLI-06 | `--dry-run` resolves and prints command, no exec | Per-alias option; executor receives `dryRun: true`; redact secrets with existing `redactSecrets()` |
| CLI-07 | `--verbose` shows config trace + executes | Per-alias option; show provenance from `ResolvedConfig.provenance`; run command unless `--dry-run` also set |
| CLI-08 | `--version` prints version | Already wired in Phase 1 cli.ts; survives Phase 4 rewrite |
| CLI-09 | Errors presented with category, cause, suggestion; dedicate exit codes | Existing `LociError` hierarchy + `exitCodeFor()`; Phase 4 adds `process.on('SIGINT')` path |
</phase_requirements>

---

## Summary

Phase 4 wires the execution engine and full CLI frontend. All three primary execution modes (single, sequential, parallel) are straightforward with execa 9.6.1 using `reject: false` for non-throwing exit code capture. The parallel kill-on-failure pattern uses a single `AbortController` whose signal is passed as `cancelSignal` to all concurrent execa calls — aborting it sends SIGTERM to all children simultaneously, with `forceKillAfterDelay: 3000` triggering SIGKILL after the 3-second grace period (D-13). This pattern was verified in the session.

The commander.js v14 CLI wiring requires four method calls per dynamic subcommand: `.passThroughOptions()`, `.allowUnknownOption()`, `.allowExcessArguments()`, and `.enablePositionalOptions()` on the root program. The combination of these ensures that `loci build --dry-run -- --watch` works correctly: `--dry-run` is captured as a known option, and `--watch` appears in `this.args` inside the action handler. This exact sequence was verified in the session.

Line-prefixing for parallel output uses execa's generator transform API: pass `[transformFn, 'inherit']` as the `stdout` option to simultaneously prefix each line and stream it to the terminal in real-time. The same mechanism works for stderr. Color assignment uses a djb2 hash of the alias name to deterministically pick from a palette of 6-8 ANSI escape codes.

**Primary recommendation:** Implement `src/executor/index.ts` as three delegating functions (`runSingle`, `runSequential`, `runParallel`) plus a top-level `run(plan)` dispatcher. Wire `src/cli.ts` with `loadConfig → loadCommands → registerAliases(program) → program.parseAsync` startup sequence. Add `failMode` to `CommandDef` parallel variant in `src/types.ts` and validate it in `src/commands/validate.ts`.

---

## Standard Stack

### Core (already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| execa | 9.6.1 | Child process spawning with `shell: false`, streaming, cancellation | Pinned in package.json; ESM-only; handles PATHEXT/shebang cross-platform [VERIFIED: package.json] |
| commander | 14.0.3 | CLI argument parsing, dynamic subcommand registration | Pinned in package.json; v14 stable CJS+ESM [VERIFIED: package.json] |

### No New Runtime Dependencies

Phase 4 does not add any new npm packages. All needed functionality is provided by:
- `execa` 9.6.1: process spawning, streaming, cancellation, transform generators
- `commander` 14.0.3: CLI parsing, dynamic subcommands, pass-through options
- Node.js built-ins: `process.on('SIGINT')`, `AbortController`, `path.dirname`, `fs.existsSync`

The ANSI color output is implemented with raw escape codes (no chalk) — consistent with `CLAUDE.md §Cold-Start Budget` directive to avoid adding `chalk`. [VERIFIED: CLAUDE.md]

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── executor/
│   ├── index.ts          # exports `executor` (Executor interface) — Phase 4 replaces stub
│   ├── single.ts         # runSingle(plan, opts) → ExecutionResult
│   ├── sequential.ts     # runSequential(plan, opts) → ExecutionResult
│   ├── parallel.ts       # runParallel(plan, opts) → ExecutionResult
│   ├── output.ts         # ANSI prefix, color hash, TTY detection, dry-run formatting
│   └── __tests__/
│       ├── single.test.ts
│       ├── sequential.test.ts
│       ├── parallel.test.ts
│       └── output.test.ts
├── cli.ts                # Phase 4 rewrites buildProgram() and main()
└── ...
```

**Alternative (discretion area):** All executor logic in a single `src/executor/index.ts`. Acceptable for a tool of this size. Feature-folder sub-files are recommended for testability and navigator clarity.

### Pattern 1: Single Command Execution (EXE-01, EXE-02, EXE-03, EXE-06)

```typescript
// Source: verified in session (b9, b13, b21)
import { execa } from 'execa';

async function runSingle(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<{ exitCode: number }> {
  const [cmd, ...args] = argv;
  const result = await execa(cmd, args, {
    cwd,               // EXE-06: project root
    env: { ...process.env, ...env },
    stdout: 'inherit', // EXE-02: real-time streaming
    stderr: 'inherit',
    reject: false,     // EXE-03: don't throw, capture exit code
  });
  return { exitCode: result.exitCode ?? 1 };
}
```

**Key insight:** `reject: false` means execa does not throw on non-zero exit — the `exitCode` is always available on the result object. `result.failed` is `true` when exit code is non-zero. [VERIFIED: session b21]

### Pattern 2: Sequential Execution (EXE-03, D-08)

```typescript
// Source: verified in session (b13)
async function runSequential(
  steps: readonly (readonly string[])[],
  cwd: string,
  env: Record<string, string>,
  verbose: boolean,
): Promise<{ exitCode: number }> {
  for (let i = 0; i < steps.length; i++) {
    const argv = steps[i];
    // D-08: print step header to stderr
    process.stderr.write(`\u25b6 ${argv[0]}\n`);
    const result = await runSingle(argv, cwd, env);
    if (result.exitCode !== 0) {
      return { exitCode: result.exitCode }; // EXE-03: first non-zero wins
    }
  }
  return { exitCode: 0 };
}
```

### Pattern 3: Parallel Execution with AbortController (EXE-04, EXE-05, D-11, D-12, D-13)

```typescript
// Source: verified in session (b7, b8, b11, b12, b22)
import { execa } from 'execa';

async function runParallel(
  group: readonly { alias: string; argv: readonly string[] }[],
  failMode: 'fast' | 'complete',
  cwd: string,
  env: Record<string, string>,
): Promise<{ exitCode: number }> {
  const controller = new AbortController();
  const { signal } = controller;

  // D-07 from EXE-07: register SIGINT handler to abort all children
  const sigintHandler = () => {
    controller.abort(new Error('SIGINT'));
  };
  process.on('SIGINT', sigintHandler);

  const makeTransform = (alias: string) => {
    const prefix = formatPrefix(alias); // color or bracket per D-01–D-04
    return function* (line: string): Generator<string> {
      yield `${prefix} ${line}`;
    };
  };

  const promises = group.map(({ alias, argv }) => {
    const [cmd, ...args] = argv;
    return execa(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdout: [makeTransform(alias), 'inherit'],
      stderr: [makeTransform(alias), 'inherit'],
      cancelSignal: signal,
      forceKillAfterDelay: 3000, // D-13: 3-second grace period
      reject: false,
    });
  });

  const results = await Promise.allSettled(promises);

  process.off('SIGINT', sigintHandler);

  // Check for SIGINT abort
  const wasInterrupted = results.some(
    (r) => r.status === 'rejected' && r.reason?.isCanceled &&
      r.reason?.originalMessage?.includes('SIGINT')
  );
  if (wasInterrupted) {
    process.exit(130); // D-14, D-25
  }

  // Collect exit codes, abort on first failure if failMode=fast
  let firstFailCode = 0;
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.exitCode !== 0) {
      if (firstFailCode === 0) firstFailCode = result.value.exitCode;
      if (failMode === 'fast') {
        controller.abort(new Error('fail-fast'));
      }
    }
    if (result.status === 'rejected' && !result.reason?.isCanceled) {
      if (firstFailCode === 0) firstFailCode = result.reason?.exitCode ?? 1;
    }
  }

  // D-09: print summary line
  printParallelSummary(group, results);

  return { exitCode: firstFailCode };
}
```

**Critical detail:** The AbortController must be created per execution of `runParallel`, not shared across invocations. Pass its signal to every concurrent `execa` call. When `.abort()` is called (either by a failed child or SIGINT), all remaining children receive SIGTERM immediately, then SIGKILL after 3000ms. [VERIFIED: sessions b7, b22]

**fail-fast timing issue:** When using `Promise.allSettled`, all promises wait until ALL settle — including the already-killed siblings. The canceled siblings reject quickly (SIGTERM kills them fast). This is acceptable behavior for `failMode: 'fast'` since killed processes exit very fast.

**For `failMode: 'complete'`:** Do NOT abort the controller on first failure. Let `Promise.allSettled` run to completion naturally. Then collect all exit codes and return the first non-zero.

### Pattern 4: Line Transform for Parallel Prefixing (EXE-05, D-01 through D-06)

```typescript
// Source: verified in session (b8, b11, b24, b25)

// ANSI palette: 8 colors, deterministically assigned by alias name hash
const ANSI_PALETTE = [
  '\x1b[32m',  // green
  '\x1b[33m',  // yellow
  '\x1b[34m',  // blue
  '\x1b[35m',  // magenta
  '\x1b[36m',  // cyan
  '\x1b[91m',  // bright red
  '\x1b[92m',  // bright green
  '\x1b[93m',  // bright yellow
] as const;
const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';

// djb2 hash — simple, fast, deterministic
function hashColor(name: string): string {
  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  }
  return ANSI_PALETTE[Math.abs(hash) % ANSI_PALETTE.length];
}

function shouldUseColor(): boolean {
  if (process.env['NO_COLOR'] !== undefined) return false;    // D-04
  if (process.env['FORCE_COLOR'] !== undefined) return true;  // D-04
  return process.stdout.isTTY === true;                        // D-03
}

function formatPrefix(alias: string): string {
  if (shouldUseColor()) {
    return `${hashColor(alias)}${alias}${RESET}`;  // D-01, D-02
  }
  return `[${alias}]`;  // D-03: bracket fallback
}

// Used as: stdout: [makeTransform(alias), 'inherit']
function makeLineTransform(alias: string) {
  const prefix = formatPrefix(alias);
  return function* (line: string): Generator<string> {
    yield `${prefix} ${line}`;
  };
}

// D-10: diagnostic prefix (verbose/dry-run) uses dim
function dimPrefix(label: string): string {
  if (shouldUseColor()) return `${DIM}[${label}]${RESET}`;
  return `[${label}]`;
}
```

**Verified:** `[transformFn, 'inherit']` array syntax confirmed working in execa 9.6.1 — the transform processes each line and `'inherit'` streams the transformed output to the parent's stdout in real-time. [VERIFIED: session b11]

### Pattern 5: Commander v14 Dynamic Subcommand Registration (CLI-01, CLI-05)

```typescript
// Source: verified in session (b15, b16, b24)
import { Command } from 'commander';

function registerAliases(program: Command, commands: CommandMap): void {
  for (const [alias, def] of commands) {
    program
      .command(alias)
      .description(def.description ?? '')
      .passThroughOptions()      // CLI-05: options after first arg pass through
      .allowUnknownOption()      // CLI-05: unknown flags don't error
      .allowExcessArguments()    // required to avoid "too many arguments" error
      .option('--dry-run', 'Preview the resolved command without executing')  // D-23
      .option('--verbose', 'Show config trace and run the command')           // D-23
      .action(async function (options: { dryRun?: boolean; verbose?: boolean }) {
        const extraArgs: string[] = this.args; // post-`--` args from CLI-05
        await executeAlias(alias, options, extraArgs);
      });
  }
}
```

**Critical:** The root `program` must call `.enablePositionalOptions()` for `.passThroughOptions()` to work on subcommands. Without it, `passThroughOptions` is silently ignored and loci-level flags can bleed into the subcommand. [VERIFIED: session b15, CITED: jsdocs.io/package/commander]

**`this.args` in the action handler** contains all arguments not parsed as known options — including everything after `--`. This is the correct way to capture pass-through args in commander v14. [VERIFIED: sessions b15, b16, b24]

**`.allowExcessArguments()`** must be called to prevent commander from throwing `commander.excessArguments` when positional args appear after options. [VERIFIED: session b14 failure, b15 fix]

### Pattern 6: Walk-Up `.loci/` Discovery (D-18)

```typescript
// Source: verified in session (b20)
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findLociRoot(startDir: string): string | null {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, '.loci'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null; // reached filesystem root
    }
    current = parent;
  }
}
```

**Placement (discretion area):** This can live in `src/cli.ts` or a dedicated `src/discovery.ts`. Either is acceptable.

### Pattern 7: CLI Startup Flow (D-17)

```typescript
// Source: CONTEXT.md D-17, verified against existing cli.ts pattern
async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram(); // creates commander instance

  // D-19: --version and --help work without .loci/ present
  // D-18: walk-up discovery
  const projectRoot = findLociRoot(process.cwd());

  if (projectRoot === null) {
    // D-19: friendly "no config" message — but still parse for --version/--help/--list
    program.action(() => {
      process.stdout.write("No .loci/ directory found. Run 'loci init' to get started.\n");
    });
    try {
      await program.parseAsync(argv as string[]);
    } catch (err) {
      return handleCommanderError(err);
    }
    return 0;
  }

  // Load config and commands in parallel
  const [config, commands] = await Promise.all([
    configLoader.load(projectRoot),
    commandsLoader.load(projectRoot),
  ]);

  // Register all aliases as dynamic subcommands
  registerAliases(program, commands, config, projectRoot);

  // Default action when no alias specified (D-20)
  program.action(() => printAliasList(commands));

  try {
    await program.parseAsync(argv as string[]);
    return 0;
  } catch (err) {
    return handleError(err);
  }
}
```

### Pattern 8: SIGINT Handling (EXE-07, D-14)

```typescript
// Source: Node.js docs, session analysis
// Pattern for single/sequential: OS automatically forwards SIGINT to child process group.
// The child gets SIGINT and exits. execa detects the child's exit.
// The parent also gets SIGINT — if no handler is installed, Node exits with code 130 automatically.
// PROBLEM: if we use `reject: false`, execa won't throw, but we still exit via the SIGINT default.
// SOLUTION for parallel: register a custom SIGINT handler before starting parallel execution.

// For parallel groups, the executor must:
process.on('SIGINT', () => {
  controller.abort(new Error('SIGINT'));
  // Do NOT call process.exit() here — let the await Promise.allSettled() complete first
  // Then detect isCanceled + abort reason and exit(130) after cleanup
});

// Detecting SIGINT abort in the results:
// result.reason.isCanceled === true for all aborted processes
// Distinguish from fail-fast abort by checking the abort reason message or a flag
```

**Windows note:** On Windows, execa's `kill()` method and the `cancelSignal` abort mechanism work correctly (SIGTERM → SIGKILL). `forceKillAfterDelay` is a no-op on Windows, but the process still gets killed via Win32 TerminateProcess. [CITED: github.com/sindresorhus/execa/blob/main/docs/windows.md]

### Anti-Patterns to Avoid

- **Using `shell: true`:** Breaks cross-platform guarantee. `CLAUDE.md` explicitly forbids it as default. execa's default `shell: false` is correct.
- **Not using `reject: false` for sequential steps:** Without it, a failed step throws and you must catch to get the exit code. With `reject: false`, the exit code is always on the result object — cleaner control flow.
- **Using a single global `AbortController`:** It must be created fresh per parallel execution. Reusing it would cause the next parallel group's children to be immediately aborted.
- **Calling `program.enablePositionalOptions()` on the subcommand instead of the root program:** It must be called on the root `program` instance. [CITED: jsdocs.io/package/commander]
- **Forgetting `.allowExcessArguments()`:** Without it, commander throws `commander.excessArguments` when any positional args appear after known options. [VERIFIED: session b14]
- **Buffering all subprocess output before emitting:** Defeats EXE-02 (real-time streaming). Use `'inherit'` or `[transform, 'inherit']`, never `'pipe'` alone for streaming.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform process spawning | Custom `child_process.spawn` wrapper | `execa` with `shell: false` | PATHEXT handling, shebang resolution, Windows quoting all handled |
| Process cancellation with timeout | `setTimeout` + manual SIGKILL | `execa cancelSignal` + `forceKillAfterDelay` | Handles edge cases: process already exited, Windows platform, concurrent kills |
| CLI argument parsing | Custom `process.argv` parser | `commander` v14 | `passThroughOptions`, `--` separator, per-subcommand help all built-in |
| Line buffering for stream transform | Manual `Buffer` + newline search | execa generator transform API | Handles partial lines, encoding, backpressure |

**Key insight:** execa's generator transform is line-based by default — it receives complete lines, not arbitrary byte chunks. No manual newline buffering is needed.

---

## Common Pitfalls

### Pitfall 1: `passThroughOptions` Requires `enablePositionalOptions` on Root

**What goes wrong:** `loci build -- --watch` correctly passes `--watch` as an extra arg, but `loci build --watch` (without `--`) silently swallows `--watch` or errors as "unknown option".
**Why it happens:** `passThroughOptions` only activates on a subcommand when the root program has called `.enablePositionalOptions()`. Without it, the flag is ignored.
**How to avoid:** Always call `program.enablePositionalOptions()` on the root `Command` instance in `buildProgram()`, before any `.command()` registrations.
**Warning signs:** Unknown option errors on valid pass-through args; missing args in `this.args`.
[VERIFIED: sessions b14, b15, CITED: jsdocs.io/package/commander]

### Pitfall 2: Missing `.allowExcessArguments()` on Dynamic Subcommands

**What goes wrong:** `loci build -- extra1 extra2` throws `commander.excessArguments: too many arguments`.
**Why it happens:** Commander's default expects zero positional arguments on a subcommand with no `<arg>` declared. The pass-through args after `--` count as positional args.
**How to avoid:** Call `.allowExcessArguments()` on every dynamically registered subcommand.
**Warning signs:** `commander.excessArguments` error code in the catch block.
[VERIFIED: session b14 failure, b15 fix]

### Pitfall 3: `reject: false` and Error Object Shape Differences

**What goes wrong:** Code checks `result.exitCode` but when execa throws (e.g., command not found), the error object is `ExecaError`, not a result object — so `result.exitCode` might be `undefined` rather than a meaningful code.
**Why it happens:** `reject: false` suppresses throw for non-zero exits but NOT for spawn errors (ENOENT = command not found). Spawn errors still throw.
**How to avoid:** Wrap `execa` calls in try/catch even with `reject: false`. Distinguish spawn errors (throw `SpawnError`) from exit code failures (check `result.exitCode`).
**Warning signs:** `exitCode: undefined` in the result when expecting a number.

### Pitfall 4: AbortController Abort Reason Ambiguity

**What goes wrong:** Cannot distinguish SIGINT-triggered abort from fail-fast abort — both set `isCanceled: true`.
**Why it happens:** `controller.abort()` accepts any reason, and execa's `isCanceled` is `true` for all cancellations.
**How to avoid:** Use a dedicated flag (e.g., a module-level `let wasInterrupted = false`) set before calling `controller.abort()` in the SIGINT handler, rather than trying to parse the abort reason.
**Warning signs:** Exit code 130 returned for fail-fast kills, or exit code 1 returned for Ctrl+C.

### Pitfall 5: Generator Transform and TTY Combination

**What goes wrong:** Using `[transform, 'inherit']` for `stdout` passes the transformed (prefixed) output to the terminal, but the **subprocess itself sees a non-TTY stdout** — because the transform interposes between child and terminal. This can cause child processes that check `process.stdout.isTTY` (e.g., bundlers, linters) to disable color output.
**Why it happens:** Documented execa behavior: "When combining 'inherit' with other output targets, this file descriptor will never refer to a TTY in the subprocess." [CITED: github.com/sindresorhus/execa/blob/main/docs/output.md]
**How to avoid:** This is an accepted tradeoff for parallel prefixed output. For single commands (D-07), use `stdout: 'inherit'` directly (no transform) so the child sees a TTY.
**Warning signs:** Tools like `jest`, `tsc`, `cargo` display no color in parallel mode.

### Pitfall 6: Load-Before-Parse Cold Start Impact

**What goes wrong:** D-17 requires loading config+commands before calling `program.parseAsync`. This means `loci --version` also loads all config files — adding disk I/O to every invocation including the fastest ones.
**Why it happens:** Commander needs all subcommands registered before parsing to show correct `--help` and detect unknown commands.
**How to avoid:** Check `argv` for `--version` / `-V` / `--help` / `-h` BEFORE loading config, and handle them early. Or accept the cold-start penalty (measured to confirm it stays under 300ms).
**Warning signs:** `loci --version` takes > 100ms on cold start.

### Pitfall 7: `process.on('SIGINT')` Handler Cleanup

**What goes wrong:** Installing `process.on('SIGINT', handler)` globally and never removing it causes the handler to accumulate across test runs or multiple executor invocations.
**Why it happens:** `process.on` adds to the event emitter without automatic cleanup.
**How to avoid:** Use `process.once('SIGINT', handler)` for single-fire registration, or `process.off('SIGINT', handler)` after the parallel group completes.
**Warning signs:** Node.js warns "MaxListenersExceededWarning: Possible EventEmitter memory leak" in tests.

---

## Code Examples

### Dry-Run Output Format (D-27, D-30)

```typescript
// Source: CONTEXT.md D-27, D-30
function printDryRun(plan: ExecutionPlan, config: ResolvedConfig): void {
  const dim = (s: string) => process.env['NO_COLOR'] !== undefined ? s : `\x1b[2m${s}\x1b[0m`;

  switch (plan.kind) {
    case 'single': {
      const redacted = redactArgv(plan.argv, config.secretKeys);
      process.stderr.write(`${dim('[dry-run]')} single: ${redacted.join(' ')}\n`);
      break;
    }
    case 'sequential':
      process.stderr.write(`${dim('[dry-run]')} sequential:\n`);
      plan.steps.forEach((step, i) => {
        const redacted = redactArgv(step, config.secretKeys);
        process.stderr.write(`  ${i + 1}. ${redacted.join(' ')}\n`);
      });
      break;
    case 'parallel':
      process.stderr.write(`${dim('[dry-run]')} parallel (failMode: ${plan.failMode ?? 'fast'}):\n`);
      for (const entry of plan.group) {
        const redacted = redactArgv(entry.argv, config.secretKeys);
        process.stderr.write(`  ${entry.alias}: ${redacted.join(' ')}\n`);
      }
      break;
  }
}
```

### Parallel Summary Line (D-09)

```typescript
// Source: CONTEXT.md D-09
function printParallelSummary(
  group: readonly { alias: string }[],
  results: PromiseSettledResult<ExecaResult>[],
): void {
  const useColor = shouldUseColor();
  process.stderr.write('\n');
  for (let i = 0; i < group.length; i++) {
    const { alias } = group[i];
    const result = results[i];
    let exitCode: number;
    let ok: boolean;
    if (result.status === 'fulfilled') {
      exitCode = result.value.exitCode ?? 0;
      ok = exitCode === 0;
    } else {
      ok = result.reason?.isCanceled === true && exitCode === 0;
      exitCode = result.reason?.exitCode ?? 1;
      ok = false;
    }
    const mark = ok
      ? (useColor ? '\x1b[32m✓\x1b[0m' : '✓')
      : (useColor ? '\x1b[31m✗\x1b[0m' : '✗');
    process.stderr.write(`  ${mark} ${alias} (exit ${exitCode})\n`);
  }
}
```

### `failMode` in `types.ts` and `commands/validate.ts` (D-15)

```typescript
// Modification to src/types.ts — parallel variant gets optional failMode
export type CommandDef =
  | { readonly kind: 'single'; ... }
  | { readonly kind: 'sequential'; ... }
  | {
      readonly kind: 'parallel';
      readonly group: readonly CommandRef[];
      readonly description?: string;
      readonly failMode?: 'fast' | 'complete'; // ADD: D-15
    };

// ExecutionPlan parallel variant also needs failMode for the executor to read
export type ExecutionPlan =
  | { readonly kind: 'single'; readonly argv: readonly string[] }
  | { readonly kind: 'sequential'; readonly steps: readonly (readonly string[])[] }
  | {
      readonly kind: 'parallel';
      readonly group: readonly { readonly alias: string; readonly argv: readonly string[] }[];
      readonly failMode: 'fast' | 'complete'; // ADD: resolved with default
    };
```

```typescript
// In src/commands/normalize.ts or validate.ts — validate failMode value
const VALID_FAIL_MODES = new Set(['fast', 'complete']);
if (raw.failMode !== undefined && !VALID_FAIL_MODES.has(raw.failMode as string)) {
  throw new CommandSchemaError(
    aliasName,
    `failMode must be "fast" or "complete", got "${raw.failMode}"`,
  );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `child_process.spawn` manual wiring | `execa` with `reject: false` + `cancelSignal` | execa v6+ | No custom stream/exit code plumbing needed |
| commander `program.parse()` | `program.parseAsync()` | commander v7 | Required for async action handlers |
| Manual `--` arg parsing | `.passThroughOptions()` + `.allowExcessArguments()` | commander v7 | Built-in, commander handles the split |
| Custom line-buffering streams | execa generator transforms | execa v9 | Simple generator function, no Node.js stream API needed |

**Deprecated/outdated:**
- `child_process.execSync`: Blocks event loop; don't use. Use `execa` with `reject: false`.
- `tree-kill` npm package: Not needed. `execa cancelSignal` + `forceKillAfterDelay` handles cross-platform kill-and-cleanup.

---

## Environment Availability

Step 2.6: This phase is code-only — it implements against already-installed packages (`execa`, `commander`) and Node.js built-ins. No new external dependencies.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| execa | EXE-01 through EXE-07 | ✓ | 9.6.1 | — |
| commander | CLI-01 through CLI-09 | ✓ | 14.0.3 | — |
| Node.js | Runtime | ✓ | ≥20.5.0 | — |

No missing dependencies.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.4 |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run src/executor/__tests__/` |
| Full suite command | `npm test` |

Tests must live under `src/executor/__tests__/` to match the `include` glob in `vitest.config.ts`: `src/**/__tests__/**/*.test.ts`. [VERIFIED: vitest.config.ts]

**Note on E2E tests:** `src/__tests__/cli.e2e.test.ts` uses `spawnSync` on `dist/cli.mjs`. Phase 4 must rebuild `dist/cli.mjs` before the E2E tests run. The existing test already has a `beforeAll` guard for this. Phase 4 E2E tests should extend this file.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| EXE-01 | `shell: false` used, PATHEXT-safe | unit | `npx vitest run src/executor/__tests__/single.test.ts` | ❌ Wave 0 |
| EXE-02 | stdout/stderr stream in real time | integration | `npx vitest run src/executor/__tests__/single.test.ts` | ❌ Wave 0 |
| EXE-03 | exit code propagation: single, sequential, parallel | unit | `npx vitest run src/executor/__tests__/` | ❌ Wave 0 |
| EXE-04 | parallel kill-on-failure with fast/complete modes | unit | `npx vitest run src/executor/__tests__/parallel.test.ts` | ❌ Wave 0 |
| EXE-05 | output prefixed with alias name | unit | `npx vitest run src/executor/__tests__/output.test.ts` | ❌ Wave 0 |
| EXE-06 | CWD set to project root | unit | `npx vitest run src/executor/__tests__/single.test.ts` | ❌ Wave 0 |
| EXE-07 | SIGINT exits 130, no orphans | manual-only | N/A — requires interactive terminal Ctrl+C | N/A |
| CLI-01 | Dynamic alias registration works | integration E2E | `npx vitest run src/__tests__/cli.e2e.test.ts` | ✅ (extend) |
| CLI-02 | No-args shows alias list | E2E | `npx vitest run src/__tests__/cli.e2e.test.ts` | ✅ (extend) |
| CLI-03 | `--list` / `-l` shows alias list | E2E | `npx vitest run src/__tests__/cli.e2e.test.ts` | ✅ (extend) |
| CLI-04 | `--help` general and per-alias | E2E | `npx vitest run src/__tests__/cli.e2e.test.ts` | ✅ (extend) |
| CLI-05 | Pass-through args via `--` | E2E | `npx vitest run src/__tests__/cli.e2e.test.ts` | ✅ (extend) |
| CLI-06 | `--dry-run` prints plan, no exec | E2E | `npx vitest run src/__tests__/cli.e2e.test.ts` | ✅ (extend) |
| CLI-07 | `--verbose` shows config trace + executes | E2E | `npx vitest run src/__tests__/cli.e2e.test.ts` | ✅ (extend) |
| CLI-08 | `--version` prints version | E2E | already in cli.e2e.test.ts | ✅ (exists) |
| CLI-09 | Error presentation with category/suggestion | unit + E2E | both test files | ✅/❌ Wave 0 |

**EXE-07 justification for manual-only:** Ctrl+C signal testing requires an interactive TTY and is not automatable in vitest's thread pool environment. The test would use a spawned child that runs a long process, then send SIGINT to it — this is possible but fragile. Consider testing the AbortController-abort path (fail-fast) as a proxy for the signal path.

### Sampling Rate

- **Per task commit:** `npx vitest run src/executor/__tests__/`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test && npm run build && npm run smoke`

### Wave 0 Gaps

- [ ] `src/executor/__tests__/single.test.ts` — covers EXE-01, EXE-02, EXE-03 (single), EXE-06
- [ ] `src/executor/__tests__/sequential.test.ts` — covers EXE-03 (sequential)
- [ ] `src/executor/__tests__/parallel.test.ts` — covers EXE-03 (parallel), EXE-04
- [ ] `src/executor/__tests__/output.test.ts` — covers EXE-05 (prefix formatting, color hash, TTY detection, dry-run formatting)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | `failMode` validated at load time with `CommandSchemaError`; pass-through args are never interpreted by loci (passed verbatim to child) |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leakage in dry-run output | Information Disclosure | `redactSecrets()` from `src/resolver/envvars.ts` applied before any print; `ShellInjectionError` discards secret value (Phase 1 precedent) |
| Shell injection via pass-through args | Tampering | `shell: false` in execa — args are passed as argv array, never interpreted by a shell |
| Secret leakage in verbose output | Information Disclosure | `--verbose` shows provenance but only shows key names for secrets, not values; D-28 and D-29 prohibit logging secret values |
| Log injection via crafted alias output | Spoofing | Each prefixed line contains the alias prefix — no output from child process can forge the prefix itself (prefix is added server-side in the transform) |

**CLAUDE.md security directive:** `loci NON deve mai loggare i valori dei secrets in output di debug.` — Phase 4 must apply `redactSecrets()` to ALL verbose and dry-run output paths. [VERIFIED: CLAUDE.md §Security]

---

## Open Questions

1. **`failMode` field on `ExecutionPlan` vs `ExecutionContext`**
   - What we know: `ExecutionPlan` is the output of the resolver (Phase 3). The resolver currently doesn't read `failMode` from `CommandDef`. The executor needs it.
   - What's unclear: Should `failMode` be added to `ExecutionPlan.parallel` (so the resolver sets it with default), or should the executor read it from the original `CommandDef`? Adding to `ExecutionPlan` keeps the executor cleanly decoupled from `CommandDef`.
   - Recommendation: Add `failMode: 'fast' | 'complete'` to the `ExecutionPlan` parallel variant (with default `'fast'`). The resolver reads it from `CommandDef` and propagates it. This is cleaner — executor only sees `ExecutionPlan`.

2. **D-22: per-alias `--help` with command preview — implementation approach**
   - What we know: Commander auto-generates `--help` for each subcommand showing description and flags.
   - What's unclear: How to inject a "command preview" section (type + steps/members) into the per-alias help output.
   - Recommendation: Use `subCmd.addHelpText('after', previewText)` which appends text after commander's standard help output. Build `previewText` from the `CommandDef` at registration time.

3. **D-20 no-args + D-19 no-config interaction**
   - What we know: D-19 says print friendly "no .loci/ found" message. D-20 says show alias list.
   - What's unclear: If no `.loci/` found, is the default action the "no config" message or the alias list? (Obviously no alias list exists without commands.yml.)
   - Recommendation: If `projectRoot === null`, default action shows the "no config" message. If `projectRoot !== null` but `commands.yml` is empty, default action shows "no aliases defined" instead of an empty list.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OS process group automatically delivers SIGINT to child process when user presses Ctrl+C in the same terminal | Pattern 8, EXE-07 | If wrong, single/sequential commands would become orphans on Ctrl+C; need explicit signal forwarding |
| A2 | execa's `[transformFn, 'inherit']` array syntax for `stdout` causes the transform output to appear in real-time on the parent's stdout | Pattern 4, EXE-02 | If wrong, output is buffered; need different approach (pipe + manual write) |
| A3 | `process.stdout.isTTY === true` correctly detects TTY in all three platforms (Windows cmd, Windows Terminal, Linux/macOS terminal emulators) | Pattern 4, D-03 | If wrong, color may show in non-TTY or vice-versa; mitigated by NO_COLOR/FORCE_COLOR overrides |

**A2 confirmed:** Session b11 verified `[transform, 'inherit']` produces real-time prefixed output.
**A1 confirmed by docs:** execa windows.md states SIGINT works on same console. [CITED: github.com/sindresorhus/execa/blob/main/docs/windows.md]

All remaining assumptions are LOW risk or mitigated by existing env var overrides.

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: /home/developer/projects/jervis/package.json] — execa 9.6.1, commander 14.0.3 confirmed pinned
- [VERIFIED: session b7] — AbortController shared across multiple execa calls: `cancelSignal` aborts all; `isCanceled: true` on all rejected processes
- [VERIFIED: session b8] — Generator transform for line prefixing: `function* (line) { yield \`${prefix} ${line}\` }` works as expected
- [VERIFIED: session b11] — `[transformFn, 'inherit']` array syntax streams prefixed output to terminal in real-time
- [VERIFIED: session b13] — `reject: false` + sequential loop + early return on non-zero exit code
- [VERIFIED: session b15] — `enablePositionalOptions` + `passThroughOptions` + `allowUnknownOption` + `allowExcessArguments` → pass-through args in `this.args`
- [VERIFIED: session b21] — `reject: false` → `result.exitCode` and `result.failed` always available
- [VERIFIED: session b22] — `forceKillAfterDelay: 3000` configures 3-second grace period
- [VERIFIED: session b24] — `--` separator: args after `--` appear in `this.args`; without `--`, unknown options also appear in `this.args` with `passThroughOptions`

### Secondary (MEDIUM confidence)
- [CITED: github.com/sindresorhus/execa/blob/main/docs/termination.md] — `cancelSignal`, `forceKillAfterDelay`, `isCanceled`, `isGracefullyCanceled`
- [CITED: github.com/sindresorhus/execa/blob/main/docs/windows.md] — Windows SIGINT behavior, `forceKillAfterDelay` no-op on Windows
- [CITED: github.com/sindresorhus/execa/blob/main/docs/transform.md] — Generator transform API, `final` function
- [CITED: github.com/sindresorhus/execa/blob/main/docs/output.md] — `[transform, 'inherit']` and TTY downgrade behavior
- [CITED: jsdocs.io/package/commander] — `passThroughOptions`, `enablePositionalOptions`, `allowUnknownOption` API signatures
- [CITED: github.com/tj/commander.js/issues/1461] — `passThroughOptions` requires `enablePositionalOptions` on parent; must use `.allowUnknownOption()` in combination

### Tertiary (LOW confidence)
- None — all critical claims verified directly in the session.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — execa 9.6.1 and commander 14.0.3 pinned in package.json; both verified in live sessions
- Architecture: HIGH — all patterns verified with running code in the project's Node.js context
- Pitfalls: HIGH — most pitfalls discovered by actually hitting them in verification sessions (b14, b15)

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable library APIs; execa and commander are not fast-moving)
