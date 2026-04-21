---
phase: quick-260421-lhg
plan: 01
subsystem: resolver
tags: [for_each, placeholders, resolver, bugfix, regression-test]
requires:
  - packages/xci/src/resolver/interpolate.ts (interpolateArgvLenient)
  - packages/xci/src/types.ts (SequentialStep union)
provides:
  - bakeLoopVarIntoRawArgv helper in packages/xci/src/resolver/index.ts
  - 5 regression tests in resolver.test.ts guarding the baking contract
affects:
  - packages/xci/src/executor/sequential.ts (downstream consumer of rawArgv — now receives baked loop var)
tech-stack:
  added: []
  patterns:
    - "Lenient single-variable substitution: interpolateArgvLenient(argv, { [loopVar]: value }) only rewrites the one key, preserves all others"
    - "Discriminated-union narrowing via (kind===undefined||kind==='cmd') gate — no casts"
key-files:
  created:
    - .planning/quick/260421-lhg-fix-for-each-loop-variable-lost-during-r/260421-lhg-SUMMARY.md
  modified:
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
decisions:
  - "bake inline (interpolateArgvLenient directly) for def.cmd branches; use helper for def.run branches — avoids single-element array alloc for the hot cmd path while keeping the helper a one-liner for subSteps arrays"
  - "helper returns SequentialStep[] (mutable) not readonly — widens cleanly into accumulators at call sites; readonly contract preserved at resolver-export boundary"
  - "Parallel for_each branch intentionally untouched — its group entries are {alias, argv, cwd?, breadcrumb?} (no rawArgv field), so no baking is needed and runtime reinterpolation never fires on them"
metrics:
  duration: 10m
  completed: 2026-04-21
  tasks: 2
  files: 2
  commits: 2
---

# Quick Task 260421-lhg: Fix for_each loop variable lost during runtime re-interpolation — Summary

Fixed a resolver bug where `for_each` loop variables survived into runtime `rawArgv` as
raw `${loopVar}` placeholders, causing `executor/sequential.ts:186-187` to throw
`UndefinedPlaceholderError` when it re-interpolated `rawArgv` against `env + capturedVars`
only. The fix bakes the loop var into `rawArgv` at resolve time via a small helper
that reuses `interpolateArgvLenient` with a single-entry substitution map, preserving
all other placeholders (captured vars, env vars, outer loop vars) untouched for
runtime resolution.

## Commits

| Commit  | Type | Description                                                               |
| ------- | ---- | ------------------------------------------------------------------------- |
| 1189b0a | test | Regression tests for for_each rawArgv baking (RED — 4/5 failing)          |
| 4c3e576 | fix  | Bake for_each loop var into rawArgv at resolve time (GREEN — all 5 pass)  |

## Tasks Completed

### Task 1 — Fix resolver to bake loop variable into rawArgv in all 4 for_each branches

- Added module-local `bakeLoopVarIntoRawArgv(steps, loopVar, loopValue)` helper in
  `packages/xci/src/resolver/index.ts` (after `csvSplit`, before `computeEffectiveCwd`).
  Uses discriminant narrowing (`kind === undefined || kind === 'cmd'`) so `set`/`ini`
  step kinds are returned unchanged. Calls `interpolateArgvLenient(s.rawArgv, { [loopVar]: loopValue })`
  — lenient semantics guarantee only the one key is replaced.
- Patched 4 call sites:
  - **Site 1 (lenient cmd, `resolveToStepsLenient` for_each → def.cmd):** inline
    `interpolateArgvLenient(def.cmd, { [def.var]: value })` for single-step bake.
  - **Site 2 (lenient run, `resolveToStepsLenient` for_each → def.run):** wrap returned
    subSteps with `bakeLoopVarIntoRawArgv(subSteps, def.var, value)` before pushing.
  - **Site 3 (strict sequential cmd, `resolveAlias` for_each mode='steps' → def.cmd):**
    same inline pattern as Site 1.
  - **Site 4 (strict sequential run, `resolveAlias` for_each mode='steps' → def.run):**
    same helper-wrap pattern as Site 2.
- Parallel for_each branch (`def.mode === 'parallel'`, lines 323-352) intentionally
  untouched — its group entries do not carry `rawArgv` (verified by type shape and diff).
- Commit: **4c3e576** — 1 file changed, 35 insertions(+), 4 deletions(-)

### Task 2 — Add regression tests for loop-var baking and captured-var preservation

- Added new top-level describe block
  `resolver — for_each bakes loop variable into rawArgv (runtime re-interpolation fix)`
  in `packages/xci/src/resolver/__tests__/resolver.test.ts`, positioned between the
  existing `for_each with string in (CSV-split)` block and the `cwd field` block.
- 5 `it(...)` blocks, each using precise `toEqual([...])` assertions:
  1. Inline `cmd` with `${region}` + `${FleetId}` — both `argv` and `rawArgv` have
     loop var substituted; `${FleetId}` preserved in both.
  2. `run:` sub-alias — outer `for_each` resolves sub-command; outer loop var baked
     into sub-step `rawArgv`, captured-var `${FleetId}` preserved.
  3. Non-`for_each` sequential baseline — `${FleetId}` intact in both `argv` and
     `rawArgv` (no regression against lenient pass for non-loop paths).
  4. End-to-end runtime chain — takes `rawArgv` from test 1 and feeds it to
     `interpolateArgv(rawArgv, '(step)', { FleetId: 'fleet-abc' })`; asserts final
     resolved argv is `['deploy', '--region', 'eu-west-1', '--fleet', 'fleet-abc']`
     — proves executor runtime path no longer throws.
  5. Nested `for_each` — outer `var: 'region' in: ['eu','us']` calling inner
     `var: 'env' in: ['dev','prod']`; asserts all 4 produced steps have **both**
     loop vars baked with `${FleetId}` still preserved.
- Used `'rawArgv' in s0 ? s0.rawArgv : null` narrowing pattern to match surrounding
  test style (line 462-463); no `as` casts.
- Commit: **1189b0a** — 1 file changed, 122 insertions(+)

## Verification

### Automated gates

- `vitest run --no-coverage src/resolver/__tests__/resolver.test.ts` → **71/71 pass**,
  including all 5 new regression tests.
- `tsc --noEmit` on `resolver/index.ts` → **1 pre-existing error** (line 133 parallel
  branch map — was line 106 pre-fix, shifted by helper insertion). **Zero new errors.**
- `biome check packages/xci/src/resolver/index.ts` → same pre-existing error count
  (3) before and after the fix. **Zero new lint/format findings.**

### Scope guardrails

- `git diff --name-only` → `packages/xci/src/resolver/index.ts` + test file only.
  No collateral file modifications.
- `git diff packages/xci/src/resolver/interpolate.ts` → empty (helper reused, not modified).
- `git diff packages/xci/src/executor/sequential.ts` → empty.
- Parallel for_each branch diff → empty (grep of "parallel" in the diff returns nothing).

### Red/Green proof of TDD

- RED (commit 1189b0a, before fix): `4 failed | 1 passed | 66 skipped (71)` — the 1
  passing is the non-regression baseline test (test 3) which already worked under old
  code. The 4 failures all flagged `${region}` / `${env}` surviving in `rawArgv` where
  the test expected them substituted.
- GREEN (commit 4c3e576, after fix): `5 passed | 66 skipped (71)` — full describe block
  green.

## Deviations from Plan

**None.** Plan executed exactly as written with two minor clarifications for the record:

- The plan claimed tsc baseline for `resolver/index.ts` was 4 lines of pre-existing
  errors (from quick-260421-ewq SUMMARY); actual baseline at execution time was **1 line**
  (line 106, parallel branch union-widening). Verified by `git stash && tsc --noEmit`.
  Post-fix count is still 1 — no new errors. Baseline had drifted downward since ewq.
- Environment required a `pnpm install` to restore vitest devDependencies (not present
  in checkout's `node_modules/.bin` at start). Install succeeded with 1 chmod warning
  on an unrelated dist file; vitest and tsc both ran cleanly afterward. Not a code
  deviation — purely environment bootstrap.

## Key Decisions

- **Helper scope:** module-local (not exported) — both `resolveToStepsLenient` and
  `resolveAlias` live in the same file and are the only two consumers.
- **Helper return type:** mutable `SequentialStep[]`, not `readonly` — call sites
  immediately spread into a mutable accumulator, so the readonly contract would only
  cost a cast. The exported `ExecutionPlan.steps` shape at resolver boundary still
  surfaces as `readonly` via the ExecutionPlan type declaration.
- **Inline vs helper at call sites:** For the two `def.cmd` branches (Site 1 and 3)
  the bake is a one-line `interpolateArgvLenient(def.cmd, { [def.var]: value })` —
  simpler than wrapping a single-element step array. For the two `def.run` branches
  (Site 2 and 4) the helper runs over a multi-step array, so the helper pays for
  itself. Mixed pattern is deliberate.
- **Nested for_each correctness:** outer loop baking runs first on the subSteps returned
  from the recursive call. Inner loop baking already ran during recursion. Since each
  bake only rewrites its own `def.var`, the two operations compose commutatively on
  their respective keys. Test 5 exercises this directly.

## Known Stubs

None. The fix is complete and closed — no deferred work, no placeholder branches.

## Self-Check: PASSED

- `packages/xci/src/resolver/index.ts` — FOUND (with new `bakeLoopVarIntoRawArgv` helper at line 35)
- `packages/xci/src/resolver/__tests__/resolver.test.ts` — FOUND (with new describe block)
- Commit 1189b0a — FOUND (`test(quick-260421-lhg): add regression tests for for_each rawArgv baking`)
- Commit 4c3e576 — FOUND (`fix(quick-260421-lhg): bake for_each loop var into rawArgv at resolve time`)
- All 5 new tests pass; all 71 tests in file pass; zero new tsc/biome findings.
