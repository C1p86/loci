---
phase: quick-260421-nmx
plan: 01
subsystem: cli-ux
tags: [executor, output, stderr, ansi, cwd, preview]

requires:
  - phase: quick-260421-g99
    provides: step.cwd on SequentialStep (cmd/ini) — the field this task surfaces to stderr/log
  - phase: quick-260421-ewq
    provides: spread-if pattern convention for exactOptionalPropertyTypes
provides:
  - Yellow `  cwd: <abs>` preview line printed to stderr before `raw:`/`run:` for each sequential cmd step whose step.cwd is set
  - logFile plain-text `  cwd: <path>` line prepended before `raw:`/`run:` when both options are provided
  - Silent behavior (no cwd line) when step.cwd is undefined — no default-case noise
  - Preservation of existing raw/run dedup, dim styling, secret redaction
affects: [future-quick-tasks-on-step-preview, parallel-executor (intentionally not modified here)]

tech-stack:
  added: []
  patterns:
    - "cwd preamble: emit only when options.cwd !== undefined, yellow on stderr (gated by shouldUseColor()), plain on logFile"
    - "spread-if call-site pattern: `...(step.cwd !== undefined ? { cwd: step.cwd } : {})` to satisfy exactOptionalPropertyTypes"

key-files:
  created: []
  modified:
    - packages/xci/src/executor/output.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/executor/__tests__/output.test.ts

key-decisions:
  - "Emit cwd line ONLY when step.cwd is set — no default 'cwd: <process.cwd()>' noise for steps that inherit the alias-level cwd"
  - "Plain text (no ANSI) in log file even when stderr would color — log files are intended for tail/grep, not terminal rendering"
  - "Kept cwd emission inside the existing `if (options?.verbose !== false)` block so `verbose:false` callers remain silent as before"
  - "Placed tests in output.test.ts (NOT cwd.test.ts) — cwd.test.ts covers cwd routing through executors; output formatting belongs in output.test.ts"
  - "Did NOT modify parallel.ts — out of scope per plan; only sequential cmd-step path wires cwd through printStepPreview"

patterns-established:
  - "quick-260421-nmx: cwd preamble in printStepPreview — emit yellow ANSI cwd line BEFORE raw:/run: with identical stderr + logFile ordering (stderr colored, file plain)"

requirements-completed: [quick-260421-nmx]

duration: ~13m
completed: 2026-04-21
---

# Phase quick-260421-nmx Plan 01: Print step cwd in dark yellow before each step Summary

**Added a dark-yellow `  cwd: <absolute-path>` preview line on stderr (and plain-text in logFile) before the existing `raw:`/`run:` preview for sequential cmd steps whose effective cwd is set — silent when cwd is undefined — so operators can diagnose where a command actually ran (especially for_each iterations).**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-04-21T17:01:00Z (approx — plan spawn)
- **Completed:** 2026-04-21T17:14:14Z
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- **Task 1 (RED):** Extended `printStepPreview` options type with `cwd?: string` (type-only) and appended a `describe('printStepPreview — cwd preview')` block with 5 tests covering color-on, absent-cwd, color-off, logFile, and cwd→raw→run ordering. Confirmed 4 failing + 1 passing (absence case) as expected.
- **Task 2 (GREEN):** Implemented the cwd emission in `printStepPreview` (yellow on stderr gated by `shouldUseColor()`, plain on logFile) and wired the sequential.ts cmd-step call site using the spread-if pattern. All 5 new tests pass. Full executor suite: 111/111 green.

## Verification

- New tests: `vitest run src/executor/__tests__/output.test.ts` — 37/37 pass (5 new + 32 pre-existing).
- Executor regression: `vitest run src/executor` — 111/111 pass (cwd.test.ts 11/11, sequential.test.ts 11/11, parallel.test.ts 7/7, output.test.ts 37/37).
- Type check: `tsc --noEmit` executor-file error count = 14, identical to pre-change baseline (14). No new TS errors.
- Files untouched: `packages/xci/src/executor/parallel.ts` and `packages/xci/src/types.ts` have zero diff across both commits.

## Commits

| Task | Type | Commit  | Description |
| ---- | ---- | ------- | ----------- |
| 1    | test | fffe103 | test(quick-260421-nmx): add failing tests for cwd preview in printStepPreview |
| 2    | feat | e6ff3bd | feat(quick-260421-nmx): print step cwd in dark yellow before raw/run preview |

## Deviations from Plan

None — plan executed exactly as written. The two-task TDD sequence (RED: tests + type scaffold, GREEN: implementation + call site) followed the plan verbatim.

## Deferred Issues

**Pre-existing failure (out of scope):** `src/__tests__/cold-start.test.ts > "dist/cli.mjs dynamic import points to ./agent/index.js at runtime"` fails because `dist/cli.mjs` is a stale build artifact (Apr 21 16:02) that does not contain the expected `import('./agent/index.js')` string. Not caused by this task — my changes only touch source files under `src/executor/`. Logged in `deferred-items.md`. Fix: rebuild dist in the next release cycle.

## Self-Check: PASSED

**Files created:**
- FOUND: `/home/developer/projects/loci/.planning/quick/260421-nmx-print-step-cwd-in-dark-yellow-before-eac/260421-nmx-SUMMARY.md`
- FOUND: `/home/developer/projects/loci/.planning/quick/260421-nmx-print-step-cwd-in-dark-yellow-before-eac/deferred-items.md`

**Files modified:**
- FOUND (modified): `/home/developer/projects/loci/packages/xci/src/executor/output.ts`
- FOUND (modified): `/home/developer/projects/loci/packages/xci/src/executor/sequential.ts`
- FOUND (modified): `/home/developer/projects/loci/packages/xci/src/executor/__tests__/output.test.ts`

**Commits:**
- FOUND: fffe103 (Task 1: test RED)
- FOUND: e6ff3bd (Task 2: feat GREEN)
