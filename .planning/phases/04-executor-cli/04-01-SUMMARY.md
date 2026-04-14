---
phase: 04-executor-cli
plan: "01"
subsystem: executor
tags: [executor, types, output, parallel, sequential, single, execa, AbortController]
dependency_graph:
  requires:
    - src/types.ts
    - src/errors.ts
    - src/resolver/envvars.ts
    - src/commands/normalize.ts
    - src/resolver/index.ts
  provides:
    - src/executor/output.ts
    - src/executor/single.ts
    - src/executor/sequential.ts
    - src/executor/parallel.ts
    - src/executor/index.ts
  affects:
    - src/types.ts (ExecutionPlan parallel extended with failMode, Executor interface extended with ExecutorOptions)
    - src/commands/normalize.ts (parallel block validates failMode)
    - src/resolver/index.ts (parallel case propagates failMode with default 'fast')
tech_stack:
  added:
    - execa cancelSignal pattern for AbortController-based parallel kill
  patterns:
    - TDD (RED → GREEN) for executor implementations
    - Generator function for execa line transform (makeLineTransform)
    - djb2 hash for deterministic color assignment per alias name
    - reject:false + result.failed detection for ENOENT SpawnError
key_files:
  created:
    - src/executor/output.ts
    - src/executor/single.ts
    - src/executor/sequential.ts
    - src/executor/parallel.ts
    - src/executor/__tests__/output.test.ts
    - src/executor/__tests__/single.test.ts
    - src/executor/__tests__/sequential.test.ts
    - src/executor/__tests__/parallel.test.ts
  modified:
    - src/types.ts
    - src/commands/normalize.ts
    - src/resolver/index.ts
    - src/resolver/__tests__/resolver.test.ts
    - src/__tests__/types.test.ts
decisions:
  - reject:false used with execa; ENOENT detected via result.failed===true + result.cause present, then re-thrown as SpawnError
  - failMode abort in parallel.ts happens in per-promise .then() callback (not after allSettled) so abort fires before all promises settle
  - ExecutorOptions interface added to types.ts to keep Executor.run contract clean with cwd+env
  - resolver parallel case always returns failMode (defaults to 'fast') — a required field not optional
metrics:
  duration: "~20 minutes"
  completed_date: "2026-04-14"
  tasks_completed: 2
  files_created: 8
  files_modified: 5
  tests_added: 39
  tests_total: 188
---

# Phase 4 Plan 01: Executor Core Summary

**One-liner:** Cross-platform executor engine with execa shell:false spawn, sequential stop-on-failure, parallel AbortController kill-on-failure, and ANSI-prefixed real-time output.

## What Was Built

### Task 1: Types, failMode validation, output formatting

Extended `src/types.ts` with:
- `failMode?: 'fast' | 'complete'` on `CommandDef` parallel variant (D-15)
- `failMode: 'fast' | 'complete'` (required) on `ExecutionPlan` parallel variant
- `ExecutorOptions` interface (`cwd`, `env`) and updated `Executor.run` signature

Updated `src/commands/normalize.ts` to validate `failMode` at load time, throwing `CommandSchemaError` for invalid values.

Updated `src/resolver/index.ts` to propagate `failMode` to the `ExecutionPlan` with default `'fast'`.

Created `src/executor/output.ts` with all output formatting functions:
- `shouldUseColor()` respecting `NO_COLOR`/`FORCE_COLOR`/TTY
- `hashColor(name)` via djb2 hash over 8-color ANSI palette
- `formatPrefix(alias)` — colored on TTY, `[alias]` bracket format off-TTY
- `makeLineTransform(alias)` — generator for execa stdout/stderr prefixing
- `dimPrefix(label)` — dim ANSI wrap for dry-run and verbose labels
- `printStepHeader`, `printDryRun`, `printVerboseTrace`, `printParallelSummary`
- `buildSecretValues` for extracting secret values from config (not just keys)

### Task 2: Executor implementations (TDD)

Created `src/executor/single.ts`: execa with `shell:false`, `reject:false`, real-time stdout/stderr via `inherit`. ENOENT detected via `result.failed && !result.exitCode && result.cause` and thrown as `SpawnError`.

Created `src/executor/sequential.ts`: iterates steps, calls `printStepHeader` before each, stops on first non-zero exit code.

Created `src/executor/parallel.ts`: `AbortController` shared across all child processes via `cancelSignal`. Abort on failure happens in a per-promise `.then()` callback (not after `allSettled`) so remaining processes are killed promptly for `failMode: 'fast'`. `forceKillAfterDelay: 3000` ensures SIGKILL after 3s. SIGINT handler registered/cleaned up with `process.on`/`process.off`. Parallel summary printed after all settle.

Updated `src/executor/index.ts`: replaced stub with dispatch to `runSingle`/`runSequential`/`runParallel`, re-exports `printDryRun`, `printVerboseTrace`, `buildSecretValues`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] reject:false does not throw on ENOENT — SpawnError detection needed**
- **Found during:** Task 2 GREEN phase — single.test.ts SpawnError test failed
- **Issue:** With `reject: false`, execa returns a result object (no throw) even on ENOENT. The plan's code sample assumed an exception would be thrown.
- **Fix:** Added detection: `if (result.failed && result.exitCode === undefined && result.cause)` → `throw new SpawnError(cmd, result.cause)`
- **Files modified:** `src/executor/single.ts`
- **Commit:** fb2c302

**2. [Rule 1 - Bug] failMode 'fast' abort did not fire before Promise.allSettled completed**
- **Found during:** Task 2 GREEN phase — parallel abort timing test exceeded 8s budget
- **Issue:** The plan's code iterated `Promise.allSettled` results after all settled, then called `controller.abort()` — by that time all processes had already finished.
- **Fix:** Moved abort logic into per-promise `.then()` callback so `controller.abort()` fires as soon as the first failure is detected, while remaining processes are still running.
- **Files modified:** `src/executor/parallel.ts`
- **Commit:** fb2c302

**3. [Rule 1 - Bug] Existing resolver and types tests broke on interface changes**
- **Found during:** Full test suite run after Task 1
- **Issue:** `resolver.test.ts` parallel tests expected `ExecutionPlan` without `failMode`; `types.test.ts` expected `Executor.run([ExecutionPlan])` (one param).
- **Fix:** Updated both test files to match the new interfaces.
- **Files modified:** `src/resolver/__tests__/resolver.test.ts`, `src/__tests__/types.test.ts`
- **Commit:** 52ca109

## Known Stubs

None — all exported functions are fully implemented and wired. The executor is now a real implementation (not `NotImplementedError`).

## Threat Flags

None — all threat mitigations from the plan's threat model were implemented:
- T-04-01: `shell: false` via execa argv array (no shell interpretation)
- T-04-02: `printDryRun` uses `redactArgv` with secret values set
- T-04-03: `printVerboseTrace` calls `redactSecrets` from envvars.ts
- T-04-04: `forceKillAfterDelay: 3000` in parallel.ts
- T-04-05: SIGINT handler cleaned up with `process.off` after completion

## Self-Check: PASSED

All 9 created/modified executor files confirmed present on disk.
All 3 task commits confirmed in git log (52ca109, 51ac666, fb2c302).
Full test suite: 188/188 passing. Build: dist/cli.mjs 126.41 KB.
