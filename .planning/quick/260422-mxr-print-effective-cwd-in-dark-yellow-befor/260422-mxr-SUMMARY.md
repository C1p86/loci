---
phase: quick-260422-mxr
plan: 01
subsystem: executor + resolver
tags:
  - cwd
  - output
  - color
  - regression-tests
  - resolver
dependency_graph:
  requires:
    - quick-260421-nmx (introduced cwd preview in BRIGHT_YELLOW)
    - quick-260421-g99 (parentCwd plumbing + computeEffectiveCwd)
  provides:
    - effective cwd preview visible before every sequential step (not only when step.cwd is explicitly set)
    - dark-yellow cwd preview color visually distinct from printRunHeader banner (still BRIGHT_YELLOW)
    - 5 regression tests guarding nested cwd inheritance through sub-aliases and for_each
  affects:
    - packages/xci/src/executor/sequential.ts (step-preview call site)
    - packages/xci/src/executor/output.ts (printStepPreview color constant)
tech-stack:
  added: []
  patterns:
    - "pre-declare stepSpawnCwd to fold preview + spawn into a single source of truth"
    - "SGR 33 (YELLOW) for pre-step preview; SGR 93 (BRIGHT_YELLOW) reserved for run-header banner"
key-files:
  created:
    - .planning/quick/260422-mxr-print-effective-cwd-in-dark-yellow-befor/260422-mxr-SUMMARY.md
  modified:
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/executor/output.ts
    - packages/xci/src/executor/__tests__/output.test.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
decisions:
  - "Cwd preview uses YELLOW (SGR 33) per user's explicit 'giallo scuro' wording; run-header banner keeps BRIGHT_YELLOW so the two yellow surfaces are visually separable"
  - "stepSpawnCwd declared before printStepPreview (single source of truth) rather than duplicated with the spread-if gate — also eliminates the 'inherited cwd is invisible' edge case"
  - "for_each test scenarios include mode: 'steps' explicitly (required by the CommandDef type; the PLAN sample was shorthand). No behavior change — same iteration semantics."
metrics:
  duration_sec: 614
  completed_date: "2026-04-22"
  tasks_completed: 2
  files_modified: 4
---

# Quick task 260422-mxr: Print effective cwd in dark yellow before every sequential step Summary

One-liner: Sequential executor now always surfaces the effective spawn cwd in dark yellow (SGR 33) on stderr before every step — inherited cwds are no longer invisible — and 5 new resolver regression tests lock in nested cwd-inheritance behavior through sub-aliases and for_each.

## Goal recap

Two coupled changes:

1. **Feature:** Every sequential cmd step must print `  cwd: <effective>` on stderr BEFORE `raw:`/`run:`, regardless of whether `step.cwd` was explicitly set. Previously the line only appeared when `step.cwd` was defined, so inherited cwds (from parent aliases or process-level default) were silently hidden from the operator.
2. **Color:** Switch the preview color from `BRIGHT_YELLOW` (SGR 93) to `YELLOW` (SGR 33) per user's literal "giallo scuro" wording. Preserves distinction vs. `printRunHeader` banner which stays BRIGHT.
3. **Verification:** Add 5 resolver tests covering nested sub-alias + for_each cwd inheritance — behavior-confirmation tests expected to pass against current code.

## Files modified

| File | Change | Line-count delta |
|------|--------|------------------|
| `packages/xci/src/executor/sequential.ts` | Move `stepSpawnCwd` declaration to before `printStepPreview`; pass `cwd: stepSpawnCwd` unconditionally; drop spread-if | +7 / -5 |
| `packages/xci/src/executor/output.ts` | Swap `BRIGHT_YELLOW` → `YELLOW` in `printStepPreview` cwd branch; add 2-line comment explaining 33 vs 93 split | +2 / -0 |
| `packages/xci/src/executor/__tests__/output.test.ts` | Update single SGR assertion from `\x1b[93m` to `\x1b[33m` (line 532) | +1 / -1 |
| `packages/xci/src/resolver/__tests__/resolver.test.ts` | Append new `describe('cwd inheritance — nested sub-aliases and for_each')` with 5 `it()` blocks (scenarios A–E) | +103 / -0 |

**Totals:** 2 source files + 2 test files = 4 files; +113 / -6 lines.

## Commits

| # | Hash | Subject |
|---|------|---------|
| 1 | `96747e6` | feat(quick-260422-mxr): surface effective cwd in dark yellow before every sequential step |
| 2 | `f1fd3f8` | test(quick-260422-mxr): add 5 resolver regression tests for nested cwd inheritance |

## Test results

### Task 1 verification — `output.test.ts`
```
Test Files  1 passed (1)
     Tests  37 passed (37)
```
All 37 tests green (1 assertion updated, no behavior changed for any pre-existing test).

### Task 2 verification — `resolver.test.ts`
```
Test Files  1 passed (1)
     Tests  76 passed (76)
```
Prior count was 71; all 5 new scenarios (A–E) PASS against current resolver code. No bug exposed.

### Broader regression sweep — `src/executor src/resolver`
```
Test Files  8 passed (8)
     Tests  199 passed (199)
```
No neighbor-suite regressions.

### TypeScript
`npx tsc --noEmit` under `packages/xci/` — **0 new errors introduced** by this task.

22 pre-existing errors remain in `src/executor/` (capture.ts, ini.ts, parallel.ts, single.ts, index.ts, sequential.ts line 197) and `src/resolver/` (params.ts, index.ts, resolver.test.ts lines 308/326/342/360). All confirmed pre-existing via `git stash` comparison against HEAD~2 — specifically, the `sequential.ts` exactOptionalPropertyTypes error for `logFile: string | undefined` existed at line 192 before this task and shifted to line 197 after the spread-if removal (same root cause — `logFile` field, which we did not touch).

## Task outcomes

### Task 1: Always surface effective cwd in dark yellow before every sequential step — PASS
- `sequential.ts`: `stepSpawnCwd` now declared once, before `printStepPreview`; passed unconditionally (no spread-if). Inherited cwd flows into the preview.
- `output.ts`: `printStepPreview` cwd branch uses `YELLOW` (SGR 33). `BRIGHT_YELLOW` import retained — still used by `printRunHeader`.
- `output.test.ts` line 532 asserts `\x1b[33m  cwd: /abs/dir\x1b[0m`. Other 4 tests in the `printStepPreview — cwd preview` block remain untouched — their ordering / plain-text / NO_COLOR assertions all pass.

### Task 2: 5 resolver regression tests for nested cwd inheritance — PASS (all 5 green)

| # | Scenario | Assertion | Result |
|---|----------|-----------|--------|
| A | Leaf inherits outer cwd through middle sequential with no own cwd (3-level) | `plan.steps[0].cwd === '/top'` | PASS |
| B | Middle sequential cwd overrides outer cwd | `plan.steps[0].cwd === '/mid'` | PASS |
| C | for_each run-mode inherits outer cwd per iteration | `plan.steps[0].cwd === '/top' && plan.steps[1].cwd === '/top'` | PASS |
| D | for_each with own cwd overrides outer | `plan.steps[0].cwd === '/loop'` | PASS |
| E | for_each inline cmd inherits outer cwd | `plan.steps[0].cwd === '/top'` | PASS |

The 3-level inheritance + for_each cwd inheritance (both `run` and inline `cmd` modes) are all fully wired in the current resolver (`parentCwd` plumbing from quick-260421-g99). Scenarios are now regression-guarded.

## Deviations from Plan

### Auto-applied (Rule 3 — blocking-issue micro-fix)

**1. [Rule 3 — type contract] Added `mode: 'steps'` to all for_each samples in the new tests**
- **Found during:** Task 2 (writing the new tests)
- **Issue:** The plan's sample code for Scenarios C/D/E omitted the `mode` field on for_each definitions, but `CommandDef.for_each` declares `mode: 'steps' | 'parallel'` as a required (non-optional) field in `types.ts`. Without `mode`, the tests would fail TypeScript compilation.
- **Fix:** Added `mode: 'steps'` to all three for_each sample definitions — consistent with the sequential/iterative semantics the test scenarios assert on (`plan.kind === 'sequential'` and `plan.steps.length === N`). No behavior change.
- **Files modified:** `packages/xci/src/resolver/__tests__/resolver.test.ts`
- **Commit:** `f1fd3f8`

## Auth gates

None — no authentication required by this task.

## Bug found (Task 2 resolver verification)

None. All 5 new regression scenarios PASS against the current resolver on first run. The `parentCwd` plumbing established by quick-260421-g99 handles 3-level sub-alias inheritance and for_each cwd inheritance (both `run` and inline `cmd` modes) correctly.

## Deferred Issues (out of scope)

The pre-existing 22 tsc errors in `packages/xci/src/executor/` and `packages/xci/src/resolver/` were logged but intentionally not addressed — they are pre-existing `exactOptionalPropertyTypes` and related drift from earlier phases, out of scope per the deviation-rule scope boundary ("only auto-fix issues DIRECTLY caused by the current task's changes"). Recommend a future cleanup quick task.

## Self-Check

**Files verified:**
- FOUND: `packages/xci/src/executor/sequential.ts`
- FOUND: `packages/xci/src/executor/output.ts`
- FOUND: `packages/xci/src/executor/__tests__/output.test.ts`
- FOUND: `packages/xci/src/resolver/__tests__/resolver.test.ts`
- FOUND: `.planning/quick/260422-mxr-print-effective-cwd-in-dark-yellow-befor/260422-mxr-SUMMARY.md`

**Commits verified:**
- FOUND: `96747e6` (Task 1)
- FOUND: `f1fd3f8` (Task 2)

## Self-Check: PASSED
