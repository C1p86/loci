---
phase: quick
plan: 260415-jxl
subsystem: cli
tags: [cli, key-value-overrides, config-precedence, env-vars]
dependency_graph:
  requires: []
  provides: [cli-kv-overrides]
  affects: [src/cli.ts]
tech_stack:
  added: []
  patterns: [rawArgs-boundary-detection, commander-passthrough-workaround]
key_files:
  created: []
  modified:
    - src/cli.ts
    - src/__tests__/cli.e2e.test.ts
decisions:
  - id: D-KV-01
    summary: "Use parent.rawArgs to reconstruct -- boundary since commander strips it from this.args with passThroughOptions()"
  - id: D-KV-02
    summary: "Detect --dry-run/--verbose from afterAlias slice in addition to options object since passThroughOptions() prevents parsing flags after positional args"
metrics:
  duration: 15m
  completed: 2026-04-15
  tasks: 2
  files: 2
---

# Quick Task 260415-jxl: Add CLI KEY=VALUE Parameter Overrides Summary

**One-liner:** CLI KEY=VALUE overrides as highest-precedence config layer, with rawArgs-based -- boundary detection working around commander passThroughOptions() stripping.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add parseCliOverrides helper and wire into alias action | 52a67b4 | src/cli.ts |
| 2 | Add E2E tests for KEY=VALUE override behavior | 5a1fa83 | src/__tests__/cli.e2e.test.ts |

## What Was Built

### parseCliOverrides (src/cli.ts)

Exported pure function that partitions raw CLI args into KEY=VALUE overrides and pass-through args. Handles:
- `--` boundary: everything after `--` is pass-through verbatim
- Before `--`: args matching `/^([^=]+)=(.*)$/` (non-empty key) are overrides
- Before `--`: args NOT matching that pattern are pass-through

### Alias action wiring (src/cli.ts)

The alias action now:
1. Derives user args from `parent.rawArgs` (preserves `--`) rather than `this.args` (which has `--` stripped by commander)
2. Filters out loci flags (`--dry-run`, `--verbose`) from the raw args slice
3. Calls `parseCliOverrides(userArgs)` to split overrides vs pass-through
4. Patches `effectiveConfig` with CLI overrides merged on top of `config.values`
5. Resolves plan and builds env vars using `effectiveValues` (overrides included)
6. `secretValues` for dry-run redaction still uses original `config` (no override redaction per spec)
7. Detects `--dry-run`/`--verbose` from both `options` object AND `afterAlias` slice (needed because `passThroughOptions()` skips flag parsing when a positional arg precedes the flag)

### E2E tests (src/__tests__/cli.e2e.test.ts)

7 new tests covering: env var injection, override vs config precedence, multiple overrides, local.yml precedence, `--` pass-through boundary, non-KEY=VALUE pass-through, and dry-run display.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] commander strips -- from this.args with passThroughOptions()**
- **Found during:** Task 1 verification (CLI-KV-05 failed)
- **Issue:** commander's `passThroughOptions()` strips the `--` separator before passing args to the action handler via `this.args`. `parseCliOverrides` received `['baz=x']` without `--` and treated it as a KEY=VALUE override.
- **Fix:** Derive user args from `this.parent.rawArgs` (which preserves `--`), slice after the alias name, filter out loci-owned flags, then pass to `parseCliOverrides`.
- **Files modified:** src/cli.ts
- **Commit:** 52a67b4 (amended into Task 1 commit)

**2. [Rule 1 - Bug] --dry-run/--verbose not parsed when placed after KEY=VALUE arg**
- **Found during:** Task 2 verification (CLI-KV-07 failed)
- **Issue:** commander's `passThroughOptions()` prevents parsing `--dry-run` as a flag when a positional arg precedes it. `options.dryRun` was `undefined`, causing the command to execute instead of dry-running.
- **Fix:** Added `isDryRun` and `isVerbose` local variables that merge both `options.dryRun/verbose` (commander-parsed when flag is first) and `afterAlias.includes('--dry-run/--verbose')` (raw-args detection when flag comes after positional).
- **Files modified:** src/cli.ts
- **Commit:** 52a67b4 (amended into Task 1 commit)

## Known Stubs

None.

## Threat Flags

No new threat surface introduced. CLI overrides are per-invocation only, no files written. Per threat model T-KV-01/02/03: all accepted.

## Self-Check: PASSED

- `src/cli.ts` — modified, parseCliOverrides exported
- `src/__tests__/cli.e2e.test.ts` — modified, 7 new tests
- Commit `52a67b4` — exists (Task 1)
- Commit `5a1fa83` — exists (Task 2)
- All 219 tests pass (`npm run build && npx vitest run`)
- No new biome lint errors introduced in modified files
