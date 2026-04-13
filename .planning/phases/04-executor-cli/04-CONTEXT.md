# Phase 4: Executor & CLI - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 delivers the **cross-platform command execution engine and full commander.js CLI frontend** — the final runtime layer that takes an `ExecutionPlan` from Phase 3's resolver and actually spawns processes:

- An executor (`src/executor/index.ts`) that runs single commands, sequential chains, and parallel groups using `execa` with `shell: false`. Handles stdout/stderr streaming, exit code propagation, parallel process lifecycle (kill-on-failure with configurable `failMode`), and Ctrl+C signal forwarding.
- A CLI frontend that dynamically registers aliases from `commands.yml` as commander.js sub-commands, with per-alias `--dry-run`, `--verbose`, `--help`, and pass-through args (`--`). Includes `.loci/` project root discovery (walk-up from cwd), graceful "no config" handling, and structured error output.
- Output formatting: color-coded parallel prefixes, line-buffered interleaving, sequential step headers, structured dry-run preview, verbose config trace to stderr.

**Phase 4 does NOT deliver:** `loci init` scaffolding, README, npm publication, shell completions, `--timing`, `loci config` inspection. Those are Phase 5 or v2.

</domain>

<decisions>
## Implementation Decisions

### Parallel Output Prefixing (EXE-05)
- **D-01: Color-coded bare prefix.** Parallel command output is prefixed with the alias name in color, no brackets. E.g. `build Compiling...` with `build` in color.
- **D-02: Hash-based color palette.** Color for each alias is derived from a hash of the alias name, so the same alias always gets the same color across runs. Use a palette of 6-8 distinct ANSI colors.
- **D-03: Bracket fallback on no-TTY.** When stdout is not a TTY (piped/redirected), prefix switches to bracket format: `[build] Compiling...`. Colors are stripped.
- **D-04: NO_COLOR / FORCE_COLOR respected.** `NO_COLOR` env var disables all ANSI codes (falls back to brackets). `FORCE_COLOR` forces colors even in piped output. Standard https://no-color.org/ convention.
- **D-05: Line-buffered interleaving.** Buffer output until newline, then emit with prefix. Lines from different commands may alternate but each line is complete.
- **D-06: Left-aligned prefixes.** No right-padding/alignment of alias names. Shorter names produce ragged alignment — acceptable for simplicity.
- **D-07: No prefix for single commands.** Single command execution passes stdout/stderr through transparently — no prefix, no modification.
- **D-08: Step headers for sequential chains.** Before each step in a sequential chain, print a header line like `▶ build`. Helps track which step produced which output.
- **D-09: Summary line after parallel completion.** After all parallel commands finish (or are killed), print a summary showing each alias with colored checkmark/cross and exit code. Green for success, red for failure. Same NO_COLOR rules apply.
- **D-10: Diagnostic prefixes dim/muted.** `[verbose]`, `[dry-run]` prefixes use dim/gray ANSI color to visually separate them from command output. Same NO_COLOR rules apply.

### Parallel Kill & Signal Handling (EXE-04, EXE-07)
- **D-11: Configurable failMode per parallel group.** Parallel groups in `commands.yml` accept an optional `failMode: fast | complete` field. `fast` = kill siblings on first failure (default). `complete` = let all commands finish, then report all results.
- **D-12: Default failMode is `fast`.** Matches CI pipeline expectations (fail fast). User opts into `complete` explicitly.
- **D-13: 3-second grace period.** On failure (or Ctrl+C), send SIGTERM to remaining processes. Wait 3 seconds for cleanup, then SIGKILL any survivors. On Windows, execa's `kill()` handles the equivalent.
- **D-14: SIGINT propagation.** On Ctrl+C, forward SIGTERM to all child processes (same 3s grace period), wait for cleanup, then exit with code 130 (standard SIGINT convention). No orphaned processes.
- **D-15: Load-time validation of failMode.** `failMode` is validated at commands.yml load time (extending Phase 3's eager validation pattern D-11). Invalid values produce `CommandSchemaError`. This requires a small addition to `src/commands/` and `src/types.ts`.

### CLI Wiring (CLI-01 through CLI-09)
- **D-16: Dynamic `.command()` per alias.** Loop over `CommandMap` and register each alias as a commander sub-command with `.command(alias)`, `.description()`, `.passThroughOptions()`, `.allowUnknownOption()`. Each alias gets its own `--help`, pass-through args, and per-alias flags.
- **D-17: Load before parse.** Startup flow: `loadConfig(cwd) → loadCommands(cwd) → registerAliases(program, commands) → program.parseAsync(argv)`. Commander sees all aliases and handles --help/errors correctly. Adds loading time to every invocation including --version.
- **D-18: Walk-up `.loci/` discovery.** Starting from cwd, walk up parent directories until a `.loci/` folder is found. This becomes the project root (cwd for child processes per EXE-06). Unified discovery step also reads `LOCI_MACHINE_CONFIG` from env.
- **D-19: Graceful "no config" handling.** If no `.loci/` directory found, print friendly message: `No .loci/ directory found. Run 'loci init' to get started.` Exit 0. `--version` and `--help` still work regardless.
- **D-20: No-args shows alias list.** `loci` with no arguments shows the alias list (same as `loci --list`). Each alias shows its description. Replaces Phase 1's empty-state hint.
- **D-21: `--list` same as no-args.** `loci --list` / `-l` produces the same alias list output as `loci` with no arguments. No separate machine-friendly format.
- **D-22: Per-alias `--help` with command preview.** `loci <alias> --help` shows: description, command type (single/sequential/parallel), and a preview of steps/members (like a mini dry-run without config resolution).
- **D-23: Per-alias flags.** `--dry-run` and `--verbose` are registered on each dynamic sub-command. `loci build --dry-run` works (user doesn't need `loci --dry-run build`).
- **D-24: Unknown alias error + list.** Unknown alias shows error with all available aliases listed (no fuzzy "did you mean?" matching). Exits with CLI error code (50).
- **D-25: Phase 1 exit codes confirmed.** `0`=success, `10`=Config, `20`=Command, `30`=Interpolation, `40`=Executor, `50`=CLI. Child process exit codes pass through unchanged (1-255). SIGINT = 130.
- **D-26: Verbose shows project root.** `--verbose` output includes the discovered project root path, useful when running from subdirectories.

### Dry-Run & Verbose Output (CLI-06, CLI-07)
- **D-27: Structured dry-run preview.** `--dry-run` shows the fully-resolved command(s) in structured format: type label, numbered steps for chains, named entries for parallel groups (with failMode). Secrets replaced by `***`.
- **D-28: Verbose = config trace + execute.** `--verbose` shows: discovered project root, which config files were loaded (and which were not found), per-key provenance for values used in the command (secrets as `***`), then runs the command. Verbose AND execution, not just trace.
- **D-29: `--verbose --dry-run` combo.** Combining both flags shows the full verbose trace (including env var injection list) WITHOUT executing. Env vars are only shown when `--verbose` is active.
- **D-30: Diagnostics to stderr.** All `[verbose]` and `[dry-run]` output goes to stderr. Command stdout stays clean on stdout. Allows piping: `loci build --verbose > output.txt` captures only build output.

### Claude's Discretion

The planner/executor has flexibility on:
- Stderr handling for parallel prefixing — same prefix same stream vs merged. Pick what works best for typical CLI usage.
- Internal architecture of the executor (single function vs class vs strategy pattern per command kind) — as long as it implements `Executor` from `types.ts`.
- How to implement the line-buffering for parallel output (transform stream, manual buffer, etc.).
- Hash function for color assignment (simple string hash is fine).
- Exact dim/muted ANSI codes for diagnostic prefixes.
- Whether walk-up discovery is a utility function in `src/cli.ts` or a separate module.
- How to wire the `failMode` field into `types.ts` `CommandDef` — could be a field on the parallel variant or a separate union.
- Whether the summary line uses Unicode symbols (checkmark/cross) or ASCII fallbacks.
- Test organization within `src/executor/__tests__/` and how to test parallel execution, signal handling, and output prefixing.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Contracts (locked — do not modify except D-15 failMode addition)
- `src/types.ts` §Executor — `ExecutionPlan`, `ExecutionResult`, `Executor` interface
- `src/types.ts` §CommandsLoader — `CommandDef` parallel variant (MODIFY: add optional `failMode` field)
- `src/errors.ts` — `ExecutorError`, `CliError`, `UnknownAliasError`, `UnknownFlagError` already declared
- `src/cli.ts` — Phase 4 rewrites the commander wiring (currently Phase 1 skeleton)

### Phase 2 Contracts (locked — consume, do not modify)
- `src/config/index.ts` — `configLoader.load(cwd)` returns `ResolvedConfig` with `values`, `provenance`, `secretKeys`

### Phase 3 Contracts (consume + extend for failMode)
- `src/commands/index.ts` — `commandsLoader.load(cwd)` returns `CommandMap` (EXTEND: validate `failMode` field on parallel groups)
- `src/resolver/index.ts` — `resolver.resolve(alias, commands, config)` returns `ExecutionPlan`
- `src/resolver/envvars.ts` — env var builder (consume for child process env injection)
- `src/resolver/interpolate.ts` — secrets redaction utility (consume for dry-run output)

### Project Instructions
- `CLAUDE.md` §Technology Stack — execa 9.6.1 (ESM-only, shell: false, AbortController pattern), commander 14.0.3 (passThroughOptions, dynamic registration)
- `CLAUDE.md` §Constraints — security (no secret logging), performance (<300ms cold start)

### Requirements
- `.planning/REQUIREMENTS.md` §Execution — EXE-01 through EXE-07
- `.planning/REQUIREMENTS.md` §CLI Frontend — CLI-01 through CLI-09

### Research Needs (flagged in STATE.md)
- execa v9 `AbortController`/`cancelSignal` pattern for parallel kill-on-failure
- commander v14 `passThroughOptions` + `enablePositionalOptions` + dynamic `.command()` registration edge cases

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `execa` package (9.6.1): Already installed and pinned. ESM-only. Use for all child process spawning with `shell: false`. Provides `cancelSignal` option for AbortController-based cancellation, cross-platform kill, and stream handling.
- `commander` package (14.0.3): Already wired in `src/cli.ts`. Supports `.command()` for dynamic sub-commands, `.passThroughOptions()`, `.allowUnknownOption()`, `.exitOverride()`.
- `LociError` hierarchy: `ExecutorError`, `CliError`, `UnknownAliasError`, `UnknownFlagError` already declared in `src/errors.ts`.
- Config loader: `configLoader.load(cwd)` returns `ResolvedConfig` with flat `values` map, `provenance` map, and `secretKeys` set.
- Commands loader: `commandsLoader.load(cwd)` returns `CommandMap` with validated command definitions.
- Resolver: `resolver.resolve(alias, commands, config)` returns `ExecutionPlan` with `kind`, `argv`/`steps`/`group`.
- Env var builder: `src/resolver/envvars.ts` builds the env var injection map.
- Secrets redaction: `src/resolver/interpolate.ts` has redaction utility for `--dry-run` display.

### Established Patterns
- Feature-folder layout: `src/executor/index.ts` is the Phase 4 landing point (currently stub).
- Stub pattern: current stub exports typed `executor` object that throws `NotImplementedError`. Phase 4 replaces implementation in-place.
- Type contracts: `Executor.run(plan: ExecutionPlan): Promise<ExecutionResult>` is the interface to implement.
- Eager validation at load time (Phase 3 D-11): all schema validation happens before any command runs.
- Error hierarchy: every throw site uses a specific concrete error class from `src/errors.ts`.

### Integration Points
- `src/cli.ts`: Phase 4 rewrites the default action and adds dynamic sub-commands per alias. The `buildProgram()` function and `main()` entry point are the modification targets.
- `src/executor/index.ts`: Phase 4 replaces the stub with the real executor implementation.
- `src/types.ts`: Add `failMode?: 'fast' | 'complete'` to the parallel variant of `CommandDef`.
- `src/commands/`: Extend validation to accept and validate `failMode` on parallel groups.
- `dist/cli.mjs`: The bundled output — must stay under cold-start budget after Phase 4 additions.

</code_context>

<specifics>
## Specific Ideas

- User chose color-coded bare prefix over brackets for TTY because it's cleaner visually. Bracket fallback for no-TTY ensures machine readability.
- User wants hash-based colors (not rotation) so the same alias always gets the same color across runs — helpful for long-running parallel processes.
- User chose `failMode: fast | complete` over a fixed kill strategy — values configurability for parallel groups where you might want all results (e.g., running multiple linters independently).
- User chose walk-up `.loci/` discovery so you can run `loci build` from any subdirectory — common pattern in git/npm/etc.
- User chose `--verbose` to both trace AND execute (not just trace). `--verbose --dry-run` combo gives trace without execution.
- User chose per-alias `--help` with command preview (type + steps/members) — goes beyond just showing the description.
- Sequential chain step headers (▶ build) were chosen over no-separator — helps track multi-step pipelines.
- User explicitly rejected "did you mean?" fuzzy matching for unknown aliases — prefers listing all available aliases instead.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-executor-cli*
*Context gathered: 2026-04-13*
