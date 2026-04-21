---
phase: quick-260421-ewq
plan: 01
subsystem: commands-resolver-executor
tags: [for_each, placeholders, csv, dsl]
dependency_graph:
  requires: [resolver.interpolateArgv, resolver.interpolateArgvLenient, errors.CommandSchemaError]
  provides: [for_each.in accepts scalar "${VAR}" string, CSV-split iteration values]
  affects: [normalize.ts, resolver/index.ts, resolver/params.ts, executor/output.ts, types.ts]
tech_stack:
  added: []
  patterns: [CSV split on ',' with trim + empty-drop, IIFE for inline lazy derivation]
key_files:
  created: []
  modified:
    - packages/xci/src/types.ts
    - packages/xci/src/commands/normalize.ts
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/resolver/params.ts
    - packages/xci/src/executor/output.ts
    - packages/xci/src/commands/__tests__/commands.test.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
    - packages/xci/README.md
decisions:
  - for_each.in union stays readonly string[] | string (no discriminated sub-type) — type narrowing via Array.isArray / typeof === 'string'
  - Scalar in must contain ${...} at normalize time (fail fast on obvious typos)
  - Empty-after-split at resolve time throws CommandSchemaError with the literal "empty after CSV split" substring for grep-friendly triage
  - Lenient branch uses interpolateArgvLenient (unknown vars kept), strict branch uses interpolateArgv (unknown vars -> UndefinedPlaceholderError) — mirrors existing def.cmd handling
  - Single csvSplit helper declared once at module scope in resolver/index.ts (trim + filter length>0); duplicated 6-line IIFE across lenient/strict branches rather than cross-file helper
metrics:
  duration: ~6m
  completed_date: 2026-04-21
  tasks_completed: 3
  files_modified: 8
  commits: 3
requirements:
  - quick-260421-ewq
---

# Quick Task 260421-ewq: Allow for_each.in to accept a ${VAR} placeholder Summary

Extends `for_each.in` in the xci DSL so it accepts either the existing `string[]` array OR a single scalar string containing `${VAR}`. At resolve time the placeholder is interpolated and the result is CSV-split (split on `,`, trimmed, empties filtered) to produce the iteration values. Unblocks `for_each: { in: "${regions}" }` style usage so CI/DX flows can pass a dynamic list from the CLI (`xci deploy-fleet regions=eu-west-1,us-east-1`) without editing `commands.yml` per-run.

## What Changed

### Production code (Task 1 — commit `9f54169`)

- `packages/xci/src/types.ts`: `CommandDef.for_each.in` type widened from `readonly string[]` to `readonly string[] | string`.
- `packages/xci/src/commands/normalize.ts`: three-way branch in the for_each block — array-of-strings (unchanged path), string-with-`${...}` (accepted as literal), bare string → `CommandSchemaError` ("for_each.in as string must reference a variable via ${...}"), other types → `CommandSchemaError` ("for_each.in must be an array of strings OR a \"${var}\" placeholder string"). The returned object uses the validated `inField` local instead of `fe.in as string[]`.
- `packages/xci/src/resolver/index.ts`: module-local `csvSplit(s)` helper added. Both `for_each` branches — `resolveToStepsLenient` (lenient interpolation) and `resolveAlias` (strict + parallel + sequential) — compute a `values: readonly string[]` via `Array.isArray(def.in) ? def.in : IIFE-over-interpolated-csvSplit`. Empty result throws `CommandSchemaError` with message containing `empty after CSV split` (grep-friendly). Array path is byte-for-byte unchanged.
- `packages/xci/src/resolver/params.ts`: `collectAll` for_each branch now calls `trackUsage(extractFromArgv([def.in]))` when `typeof def.in === 'string'`, so a missing `${VAR}` surfaces as `MissingParamsError` at CLI param validation time (before dispatch).
- `packages/xci/src/executor/output.ts`: `collectReferencedPlaceholders` for_each case branches on `typeof def.in === 'string'` — scans the literal string or iterates the array. This keeps `printRunHeader`'s variables block correct for both shapes.
- `packages/xci/src/dsl/validate.ts`: verified — `collectExplicitRefs` for for_each only returns `def.run ? [def.run] : []`, never touching `def.in`. No change needed.

### Tests (Task 2 — commit `ff4731a`)

- `packages/xci/src/commands/__tests__/commands.test.ts`: new top-level `describe('for_each.in — string form')` with 4 cases:
  - Array form regression guard (`in: ["a", "b"]` unchanged).
  - String form accept (`in: "${AwsLocations}"` normalized with literal string preserved).
  - Bare scalar reject (message contains `${...}`).
  - `it.each` over `number`/`null`/`object` — reject with message containing `array of strings OR`.
- `packages/xci/src/resolver/__tests__/resolver.test.ts`: new `describe('resolver — for_each with string in (CSV-split)')` with 5 cases:
  - Sequential mode CSV-split into 2 steps with interpolated region values.
  - Trim + empty-filter (`" a , , b "` → `["a", "b"]`).
  - Empty after split (`" , , "`) → throws `/empty after CSV split/`.
  - Parallel mode → `plan.kind === 'parallel'`, `group.length === 2`, default `failMode === 'fast'`.
  - Missing referenced var → `UndefinedPlaceholderError` (strict path).

### Docs (Task 3 — commit `1362c77`)

- `packages/xci/README.md`: new example block under `### For-Each Loop` (before `### Split Commands Across Files`) showing `deploy-fleet` with `in: "${regions}"` + `xci deploy-fleet regions=eu-west-1,us-east-1,ap-northeast-1`. One-liner explains CSV split / trim / empty-drop semantics. Existing array-form examples preserved.

## Verification

- `npx vitest run --no-coverage` in `packages/xci/`: 451 passed, 1 failed, 1 skipped. The only failure is `src/__tests__/cold-start.test.ts > dist/cli.mjs dynamic import points to ./agent/index.js at runtime (not inlined)` — confirmed pre-existing by running the test on the base commit (`c5d1f19`) BEFORE these changes; identical failure, identical `toMatch(/import\(['"]\.\/agent\/index\.js['"]\)/)` assertion. Documented as baseline in quick-260421-d0r.
- 9 new tests added by this plan; all 9 pass. No previous test modified.
- `npx tsc --noEmit`: errors on changed files are pre-existing (verified by stash + rerun on base — same 4 errors in `src/resolver/index.ts:75-80` and `src/resolver/params.ts:127/324/382` with `exactOptionalPropertyTypes` and `SequentialStep | undefined` narrowing). No new typecheck errors introduced. The remaining errors across `src/tui/dashboard.ts`, `src/tui/picker.ts`, `src/__tests__/agent/*`, `src/agent/*`, `src/cli.ts`, etc. are all pre-existing and unrelated.
- README sanity check: `grep -q 'CSV string split at resolve time' README.md && grep -q 'xci deploy-fleet regions=eu-west-1' README.md` → PASS.

## Commits

| Task | Type | Commit | Description |
| ---- | ---- | ------ | ----------- |
| 1 | feat | 9f54169 | Allow for_each.in to accept `${VAR}` placeholder string (5 files: types/normalize/resolver index/params/output) |
| 2 | test | ff4731a | Add 9 tests for string-form for_each.in (4 normalize + 5 resolver) |
| 3 | docs | 1362c77 | Document string-form for_each.in in README |

## Deviations from Plan

None — plan executed exactly as written. One non-deviation note for transparency:

- Task 1 frontmatter carried `tdd="true"`, but its own action block explicitly instructed "Do NOT create any new test files in this task — tests live in Task 2." I followed the action block literally (production changes only in Task 1, tests in Task 2). This is plan-intentional, not an auto-decision.

## Known Issues / Deferred

- The cold-start dist/cli.mjs dynamic-import assertion failure is unchanged from the prior quick task baseline (`260421-d0r`) — tracked there, out of scope for this plan.

## Self-Check: PASSED

Files verified:
- FOUND: packages/xci/src/types.ts (modified)
- FOUND: packages/xci/src/commands/normalize.ts (modified)
- FOUND: packages/xci/src/resolver/index.ts (modified)
- FOUND: packages/xci/src/resolver/params.ts (modified)
- FOUND: packages/xci/src/executor/output.ts (modified)
- FOUND: packages/xci/src/commands/__tests__/commands.test.ts (modified)
- FOUND: packages/xci/src/resolver/__tests__/resolver.test.ts (modified)
- FOUND: packages/xci/README.md (modified)

Commits verified (in `git log --all`):
- FOUND: 9f54169 (feat for_each.in scalar form)
- FOUND: ff4731a (test string-form for_each.in)
- FOUND: 1362c77 (docs README for-each loop)
