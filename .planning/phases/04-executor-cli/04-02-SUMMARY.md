---
phase: 04-executor-cli
plan: "02"
subsystem: cli
tags: [cli, commander, walk-up-discovery, dry-run, verbose, pass-through, e2e-tests]
dependency_graph:
  requires:
    - src/config/index.ts
    - src/commands/index.ts
    - src/resolver/index.ts
    - src/executor/index.ts
    - src/executor/output.ts
    - src/errors.ts
    - src/types.ts
    - src/version.ts
  provides:
    - src/cli.ts
    - src/__tests__/cli.e2e.test.ts
  affects:
    - src/cli.ts (complete rewrite from Phase 1 stub)
    - src/__tests__/cli.e2e.test.ts (complete rewrite with E2E suite)
tech_stack:
  added:
    - commander.js enablePositionalOptions + passThroughOptions subcommand pattern
    - spawnSync cwd-isolated E2E testing with mkdtempSync temp project fixture
  patterns:
    - Walk-up filesystem discovery (findLociRoot) for .loci/ detection
    - Dynamic alias registration as commander sub-commands (registerAliases)
    - appendExtraArgs for pass-through args to single/sequential/parallel plans
    - NO_COLOR=1 in all E2E spawn envs for stable bracket-format output
key_files:
  created: []
  modified:
    - src/cli.ts
    - src/__tests__/cli.e2e.test.ts
decisions:
  - Walk-up discovery (findLociRoot) mirrors git/npm convention — accepted as per threat model T-04-10
  - enablePositionalOptions() on root program is mandatory for passThroughOptions() to work on sub-commands (commander v14 pitfall)
  - allowExcessArguments() + allowUnknownOption() on each sub-command prevents commander throwing excessArguments error
  - this.args inside sub-command action captures post-'--' args correctly with passThroughOptions enabled
  - Pass-through test uses script file (print-args.mjs) not 'node -e' to avoid Node interpreting '--foo' as its own option
  - dimPrefix import retained from executor/output.ts for future direct use; unused import lint warning is benign
metrics:
  duration: "~5 minutes"
  completed_date: "2026-04-14"
  tasks_completed: 2
  files_created: 0
  files_modified: 2
  tests_added: 14
  tests_total: 202
---

# Phase 4 Plan 02: CLI Frontend Summary

**One-liner:** Full commander.js CLI frontend with walk-up .loci/ discovery, dynamic alias registration, --dry-run/--verbose/pass-through flags, and 22-test E2E suite covering all CLI requirements.

## What Was Built

### Task 1: Rewrite cli.ts with full commander.js wiring

Completely rewrote `src/cli.ts` from the Phase 1 stub into a fully wired CLI frontend:

- `findLociRoot(startDir)`: filesystem walk-up to find `.loci/` directory (D-18), mirrors git/npm convention
- `printAliasList(commands)`: formats alias list with description and kind to stdout (D-20, D-21, CLI-02, CLI-03)
- `buildAliasHelpText(alias, def)`: per-alias help text showing command type, steps/members preview (D-22, CLI-04)
- `buildProgram()`: root commander.js program with `.enablePositionalOptions()` (CRITICAL for subcommand passThroughOptions), `--list`/`-l` flag, `--version`/`-V`, `--help`/`-h`, `.exitOverride()`
- `registerAliases(program, commands, config, projectRoot)`: dynamically registers each alias as a commander sub-command with `.passThroughOptions()`, `.allowUnknownOption()`, `.allowExcessArguments()`, `--dry-run`, `--verbose`
- `appendExtraArgs(plan, extra)`: appends pass-through args to single argv, last sequential step, or all parallel entries (CLI-05)
- `main()`: loads config + commands in parallel (`Promise.all`), registers aliases, handles D-19 (no .loci/ friendly message), D-24 (unknown command → exit 50), all LociError categories with exit codes
- `handleError()`: maps commander error codes and LociError categories to correct exit codes

### Task 2: E2E tests for all CLI requirements

Rewrote `src/__tests__/cli.e2e.test.ts` with 22 tests covering all requirements:

- `createTempProject(files)` + `runCliInDir(dir, args)` helpers with `NO_COLOR=1` for stable output
- `afterEach` cleanup of temp dirs via `rmSync(dir, { recursive: true, force: true })`
- Coverage: `--version`, `-V`, D-19 no-.loci/ message, --version/--help without .loci/, CLI-02/D-20 no-args alias list, CLI-03/D-21 `--list`/`-l`, CLI-01 alias execution, EXE-03 exit code propagation, CLI-06/D-27 --dry-run stderr-only, D-30 stdout-empty, CLI-07/D-28 --verbose config trace, D-26 project root in verbose, D-29 --verbose --dry-run combo, CLI-05 pass-through args, CLI-04/D-22 per-alias --help, D-24/CLI-09 unknown alias exit 50, CLI-09 YAML parse error exit 20, bundle shebang, no `__LOCI_VERSION__` literal

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Node.js v22 treats `--foo` as a node option when appended after `node -e <expr>`**
- **Found during:** Task 2 — CLI-05 pass-through args test
- **Issue:** The test used `cmd: ["node", "-e", "process.stdout.write(...)"]` and appended `--foo bar` via pass-through. Node v22 interpreted `--foo` as a node option (exit code 9, `node: bad option: --foo`)
- **Fix:** Changed test to use a script file (`print-args.mjs` placed in the temp project) instead of `node -e`. `node script.mjs --foo bar` correctly passes `--foo` to `process.argv` without Node interpreting it.
- **Files modified:** `src/__tests__/cli.e2e.test.ts`
- **Commit:** 42504e9

## Known Stubs

None — cli.ts is fully wired end-to-end. All alias execution, dry-run, verbose, pass-through, error handling paths are implemented and tested.

## Threat Flags

None — all threat mitigations from the plan's threat model were implemented:
- T-04-07: `printVerboseTrace` receives `redactedEnv` (passed through `redactSecrets()`) — secret values show as `***`
- T-04-08: `printDryRun` uses `buildSecretValues(config)` result to redact argv tokens
- T-04-09: pass-through args appended to argv array (not shell-interpreted) — execa uses `shell: false`

## Self-Check: PASSED
