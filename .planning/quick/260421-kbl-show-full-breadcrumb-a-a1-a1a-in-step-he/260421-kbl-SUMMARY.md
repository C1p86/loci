---
phase: quick-260421-kbl
plan: 01
subsystem: xci-resolver, xci-executor
tags: [breadcrumb, nested-aliases, step-headers, ux]
tech-stack:
  added: []
  patterns:
    - "ExecutionPlan/SequentialStep extended with optional readonly breadcrumb field"
    - "Resolver threads chain[] from root alias down and stamps each emit site with breadcrumb: [...chain]"
    - "Executor derives displayLabel = breadcrumb.join(' > ') with leaf fallback"
    - "--from accepts both leaf name and full-path string"
key-files:
  created: []
  modified:
    - packages/xci/src/types.ts
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/executor/__tests__/sequential.test.ts
    - packages/xci/src/__tests__/cli.e2e.test.ts
    - packages/xci/README.md
decisions:
  - "Breadcrumb is stored as readonly string[] (free spread, no runtime cost beyond array clone at emit sites)"
  - "Single-segment breadcrumb renders as the leaf (backward-compat for top-level sequential aliases with inline commands only)"
  - "Top-level single-kind ExecutionPlan does not get breadcrumb — printRunHeader already covers it"
  - "Parallel group entries store breadcrumb on the entry (not on the sub-plan) for future parallel output use; v1 leaves parallel rendering unchanged"
  - "--from accepts leaf OR full-path match to preserve existing muscle memory while enabling disambiguation when the same leaf name appears in multiple chains"
metrics:
  duration: "~16 minutes"
  completed: 2026-04-21
  tasks_completed: 3
  files_modified: 7
  tests_added: 16 (9 resolver + 6 executor + 1 e2e)
---

# Phase quick-260421-kbl Plan 01: Show full breadcrumb (A > A1 > A1a) in step headers — Summary

**One-liner:** Sequential executor step headers now display the full path of containing alias names (e.g. `▶ A > A1 > A1a [1/3]`) instead of only the leaf alias, via an additive readonly `breadcrumb` field stamped by the resolver and rendered by the executor. `--from` accepts both leaf and full-path match.

## What was built

- **`packages/xci/src/types.ts`** — Extended every variant of `SequentialStep` (cmd/ini/set) and the parallel group entry shape with `readonly breadcrumb?: readonly string[]`. Preserves backward compatibility (optional field).
- **`packages/xci/src/resolver/index.ts`** — Wired `breadcrumb: [...chain]` into every emit site in both `resolveToStepsLenient` and `resolveAlias`. Parallel alias-ref entries and for_each parallel-mode alias-ref entries use `[...chain, entry]` / `[...chain, def.run]` (so the sub-alias name is included). Inline entries use `[...chain]`.
- **`packages/xci/src/executor/sequential.ts`** — Derived `leafLabel` (for --from leaf matching) and `displayLabel = breadcrumb.join(' > ')` (for rendering). Routed `displayLabel` to every `printStepHeader` / `printStepResult` call inside `runSequential` (cmd, set, ini, capture, skipped, pass, fail branches). `--from` now matches against either `leafLabel` or `displayLabel`.
- **`packages/xci/README.md`** — Added "Nested step headers" subsection under Sequential Steps documenting the full-path display and `--from` leaf-or-path matching.
- **Test coverage (+16 tests):** 9 resolver tests (nested sequential, for_each with run/cmd, parallel alias-ref / inline, single has no breadcrumb, additive regression), 6 executor tests (multi-segment display, single-segment fallback, legacy-absent fallback, --from by leaf, --from by full path, --from unknown skips all), 1 real-CLI e2e test against the built `dist/cli.mjs`.

## How it works

1. `resolver.resolve(aliasName, …)` seeds `chain = [aliasName]` and recursively threads `chain` through every branch. At each emit site, the current step/entry object spreads `breadcrumb: [...chain]` (or `[...chain, entry]` for parallel alias-ref entries so the sub-alias name is the tail segment).
2. `runSequential` computes `leafLabel` from kind-specific logic (`ini:<mode>`, `'set'`, `step.label ?? argv[0]`) and `displayLabel` from the breadcrumb when present. `displayLabel` is what the user sees in headers.
3. `--from` skipping stops when `fromStep === leafLabel || fromStep === displayLabel` — so both `--from compile` and `--from "release > build > compile"` resume at the same step.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - Test regression] Updated pre-existing parallel tests to include `breadcrumb`**
- **Found during:** Task 1 (resolver GREEN phase)
- **Issue:** The two pre-existing `resolver.resolve - parallel` tests at lines 369-406 use strict `.toEqual(...)` with the literal expected `group: [{ alias, argv }, ...]`. Adding `breadcrumb` to every parallel entry (an additive change) caused these tests to fail because the actual output now contained an extra `breadcrumb` property not present in the expected literal.
- **Fix:** Updated the two expected literals to include the new `breadcrumb` field on each group entry (`['watch']` for inline, `['watch', 'watch:ts']` / `['watch', 'watch:css']` for alias-refs).
- **Files modified:** `packages/xci/src/resolver/__tests__/resolver.test.ts`
- **Commit:** 5fe19e0 (bundled with Task 1)
- **Why this is Rule 1 (bug in tests), not a plan deviation:** the plan description explicitly states "breadcrumb is ADDITIVE" and "Existing assertions stay" in Test 9, but this only works when the assertion uses `.argv` / `.kind` projection. Strict `.toEqual` on the whole object requires updating the expected shape. Minor, scope-local fix.

### Decisions made

- Kept the `stepCmd` local name inside `runSequential` and assigned `displayLabel` to it to minimize diff noise in the cmd branch.
- Documented the decision in a block comment ("quick-260421-kbl: compute the true leaf label ...") so future readers understand why both labels exist.

## Verification Results

Baseline before this plan: **503 passing / 1 cold-start fail / 1 skip** (post quick-260421-hnr).

After this plan (full `npx vitest run` in `packages/xci/`):
- **519 passing** (503 + 9 resolver + 6 executor + 1 e2e = 519) ✓ exactly matches the plan's prediction
- **1 failed** — the same pre-existing cold-start test (`dist/cli.mjs dynamic import points to ./agent/index.js at runtime`), which the plan explicitly allowed ("1 pre-existing cold-start fail is acceptable").
- **1 skipped** (pre-existing).

No regressions. Type errors count unchanged (107 pre-existing tsc errors across the package, none new).

Smoke test via the new e2e test passed: building `dist/cli.mjs` and running `xci A` on a nested-sequential temp project shows `A > A1 > A1a`, `A > A1 > A1b`, `A > A2` in stderr and no pure-leaf headers.

## Commits

- **5fe19e0** — `feat(quick-260421-kbl): add breadcrumb field to steps and wire through resolver` (types.ts, resolver/index.ts, resolver.test.ts)
- **4e4c3ff** — `feat(quick-260421-kbl): render breadcrumb in sequential step headers, accept --from leaf-or-full-path` (executor/sequential.ts, executor/sequential.test.ts)
- **18d8ea8** — `feat(quick-260421-kbl): add e2e test and README for nested breadcrumb step headers` (cli.e2e.test.ts, README.md)

## Self-Check: PASSED

- Files created/modified: all 7 files present and tracked.
  - packages/xci/src/types.ts ✓ (breadcrumb added to all 3 SequentialStep variants and parallel entry shape)
  - packages/xci/src/resolver/index.ts ✓ (breadcrumb: [...chain] at every emit site)
  - packages/xci/src/resolver/__tests__/resolver.test.ts ✓ (9 new tests)
  - packages/xci/src/executor/sequential.ts ✓ (displayLabel derivation + --from leaf-or-full-path)
  - packages/xci/src/executor/__tests__/sequential.test.ts ✓ (6 new tests)
  - packages/xci/src/__tests__/cli.e2e.test.ts ✓ (1 new e2e test)
  - packages/xci/README.md ✓ (Nested step headers subsection)
- Commits 5fe19e0, 4e4c3ff, 18d8ea8 all present in `git log`.
- Full test suite passes at 519/521 (1 pre-existing cold-start fail, 1 pre-existing skip).
- No new npm dependencies (verified: only touched source + tests + README).
