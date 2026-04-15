---
phase: 04-executor-cli
plan: "03"
status: complete
started: 2026-04-15
completed: 2026-04-15
type: gap-closure
tags: [cli, error-handling, exit-codes, uat-fix]
key-files:
  modified:
    - src/cli.ts
    - src/__tests__/cli.e2e.test.ts
decisions:
  - "configureOutput writeErr noop to suppress commander's stderr double-output with exitOverride"
  - "Removed showHelpAfterError() — loci controls all error output via handleError()"
metrics:
  duration: 2m
  tasks: 2
  files: 2
---

# Phase 04 Plan 03: UAT Gap Closure Summary

Fixed two UAT failures: no-.loci/ directory exits 1 instead of 0, and commander.excessArguments errors reformatted as clean "Unknown alias" messages.

## What was done

- Fixed no-.loci/ exit code: returns 1 when no --help/--version shown (was always 0)
- Added commander.excessArguments handler to suppress double-output and reformat as clean "Unknown alias" message
- Suppressed commander's own stderr output via `configureOutput({ writeErr: () => {} })` to prevent double-output when `exitOverride()` is active
- Removed `showHelpAfterError()` since loci controls all error formatting through `handleError()`
- Added 2 regression tests, updated 1 existing test expectation
- All 204 tests pass (11 test files, 24 E2E tests)

## Files changed

- `src/cli.ts` — handleError: added excessArguments branch; main: no-.loci/ branch returns 1 unless --help/--version; buildProgram: removed showHelpAfterError, added configureOutput writeErr noop
- `src/__tests__/cli.e2e.test.ts` — 2 new regression tests (D-19 exit code, Gap 1 clean output), 1 updated test (D-19 exits non-zero)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Commander stderr double-output from showHelpAfterError + exitOverride**
- **Found during:** Task 2 verification
- **Issue:** `showHelpAfterError()` causes commander to write "error: too many arguments" + full help text to stderr before throwing, producing double output alongside our `handleError()` message
- **Fix:** Removed `showHelpAfterError()` and added `configureOutput({ writeErr: () => {} })` to suppress all commander stderr writes — loci's `handleError()` already formats all error output cleanly
- **Files modified:** `src/cli.ts`
- **Commit:** 11d37cb

## Verification

- Build passes cleanly
- All 24 E2E tests pass
- All 204 tests pass across 11 test files
- No stubs or placeholder code introduced

## Commits

| Hash | Message |
|------|---------|
| 11d37cb | fix(04-03): exit non-zero when no .loci/ dir, suppress excessArguments noise |
