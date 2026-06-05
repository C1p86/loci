---
phase: quick-260605-q1f
plan: 01
subsystem: cli
tags: [multi-alias, composition, cli, refactor, e2e-tests]
dependency_graph:
  requires: []
  provides: [multi-alias-plus-composition]
  affects: [packages/xci/src/cli.ts, packages/xci/src/__tests__/cli.e2e.test.ts]
tech_stack:
  added: []
  patterns: [extract-core-helper, pre-parser-short-circuit, early-validation-before-execution]
key_files:
  created: []
  modified:
    - packages/xci/src/cli.ts
    - packages/xci/src/__tests__/cli.e2e.test.ts
    - packages/xci/src/executor/output.ts
decisions:
  - RunAliasFlags interface + runAlias() extracted above registerAliases() so both sub.action and multi-alias pre-parser share identical execution logic
  - Multi-alias pre-parser uses early alias validation (before any execution) to guarantee exit 50 on unknown alias without side-effects
  - Run-level flags (--dry-run, --verbose, --log, --ui, --list, --short-log, --from) resolved once from full token stream and stripped from per-segment extraArgs
  - --parallel consumed at top level via filter(), never forwarded to segments
  - Sequential mode stops on first non-zero and returns that code; parallel mode uses Promise.all and returns first non-zero by segment order
metrics:
  duration: ~12 min
  completed: "2026-06-05T17:03:00Z"
  tasks: 3
  files: 3
---

# Quick Task 260605-q1f: Add CLI-Level Multi-Alias Composition with + Separator

**One-liner:** CLI-level `xci a + b` composition via extracted `runAlias()` core — sequential (stop on first failure) and `--parallel` (wait all, first non-zero) with per-segment arg routing and early unknown-alias validation.

## Summary

Added `xci a + b` multi-alias composition to the CLI. Users can now chain unrelated aliases in one invocation without defining wrapper sequential/parallel aliases in commands.yml.

Three tasks were executed:

1. **Refactor** — Extracted `runAlias()` async helper from `sub.action()` handler in `registerAliases()`. The function takes an alias name, its CommandDef, raw extra args (KEY=VALUE + pass-through), the commands map, config, projectRoot, and RunAliasFlags. It returns an exit code (int) instead of setting `process.exitCode`. `sub.action` now handles only commander-specific arg reconstruction + flag detection, then delegates to `runAlias()`. `parseCliOverrides` is called inside `runAlias`, not double-parsed.

2. **Feature** — Added multi-alias pre-parser block in `main()` that runs after `registerAliases()` but before `program.parseAsync`. When `+` is detected as a standalone token after at least one positional alias name, the pre-parser: extracts `--parallel`, splits tokens on `+` into segments, validates all alias names BEFORE any execution, resolves run-level flags once from the full token stream, strips them from per-segment extraArgs, then executes sequentially or concurrently via `runAlias()`.

3. **Tests** — Added 8 e2e test cases in `describe('multi-alias composition (+ separator)')`: sequential success, sequential stop-on-failure (with flag-file proof), parallel non-zero exit, parallel all-success, per-segment arg routing, unknown alias early exit (exit 50 + stderr check), `--parallel` non-forwarding, and flag-file proof that early validation prevents execution.

Also applied pre-execution changes: CI guard on `notifyCompletion`/`notifyWaitingForInput` in output.ts, and `CI: '1'` in both test runner helpers to suppress toast notifications during tests.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Extract runAlias() core + pre-applied CI guards | 28832d3 | cli.ts, output.ts, cli.e2e.test.ts |
| 2 | Add multi-alias + pre-parser in main() | 1d54c94 | cli.ts |
| 3 | Add e2e tests for + composition | 42448ae | cli.e2e.test.ts |

## Decisions Made

- **RunAliasFlags interface** defined just above `runAlias()` so it is naturally in scope for both the action handler and the multi-alias pre-parser block inside `main()`.
- **Early validation** (checking `commands.has(aliasName)` before any execution) ensures `xci writer + nonexistent` exits 50 without `writer` ever running — tested with flag-file assertion.
- **`--parallel` removal** uses `Array.filter()` removing ALL `--parallel` tokens before splitting segments, so it cannot leak into any segment's extra args.
- **Run-level flags stripped from extraArgs** per-segment, using a pair-skip loop for `--short-log`/`--from` to avoid their value tokens being treated as pass-through args.
- **Sequential mode**: first non-zero stops the chain and that code is returned; later segments are not executed.
- **Parallel mode**: `Promise.all` runs all segments; `codes.find(c => c !== 0)` returns the first non-zero by segment order (not by which finished first).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] Pre-applied changes not present in worktree**
- **Found during:** Task 1
- **Issue:** The `<pre_applied_changes>` block stated CI guards were already applied, but they were not present in the worktree.
- **Fix:** Applied `if (process.env.CI) return;` to `notifyCompletion` and `notifyWaitingForInput` in output.ts, and added `CI: '1'` to both `runCli` and `runCliInDir` env spreads in the test file.
- **Files modified:** `packages/xci/src/executor/output.ts`, `packages/xci/src/__tests__/cli.e2e.test.ts`
- **Commit:** 28832d3

**2. [Rule 1 - Bug] echoarg used `process.argv.slice(2)` but needed `slice(1)` for node -e invocations**
- **Found during:** Task 3 (first test run)
- **Issue:** In Node.js, when running `node -e "code" arg1`, `process.argv` is `[node, arg1]`, not `[node, -e, code, arg1]`. So `slice(2)` would return `[]` when only one arg is passed.
- **Fix:** Changed to `process.argv.slice(1)` in the test's `echoarg` cmd definition.
- **Files modified:** `packages/xci/src/__tests__/cli.e2e.test.ts`
- **Commit:** 42448ae

**3. [Pre-existing failures — out of scope] 4 tests were already failing before this task**
- `--version prints semver and exits 0` — expects `0.0.0` but package is `0.2.0`
- `-V short flag also prints version` — same
- `CLI-07, D-28: --verbose shows config trace` — trace output format differs
- `${xci.project.path} is usable in command interpolation` — exits 1 instead of 0
- These failures confirmed pre-existing in main branch; out of scope for this quick task.

## Known Stubs

None.

## Self-Check: PASSED

- `packages/xci/src/cli.ts` — modified (Task 1: runAlias() extraction; Task 2: pre-parser)
- `packages/xci/src/__tests__/cli.e2e.test.ts` — modified (Tasks 1+3)
- `packages/xci/src/executor/output.ts` — modified (Task 1: CI guards)
- Commit 28832d3 exists in git log
- Commit 1d54c94 exists in git log
- Commit 42448ae exists in git log
- All 8 new composition tests pass; 4 pre-existing failures unchanged (51 passed / 55 total)
