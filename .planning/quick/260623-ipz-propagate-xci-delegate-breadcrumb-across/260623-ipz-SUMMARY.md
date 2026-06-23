---
phase: quick-260623-ipz
plan: "01"
subsystem: xci
tags: [breadcrumb, xci-delegate, cross-process, output]
dependency_graph:
  requires: [quick-260623-hp3]
  provides: [xci-breadcrumb-propagation]
  affects: [executor/nesting.ts, resolver/index.ts, executor/xci-delegate.ts, executor/output.ts, executor/index.ts, executor/sequential.ts, types.ts]
tech_stack:
  added: []
  patterns: [XCI_BREADCRUMB env var, resolver chain seeding, breadcrumb forwarding]
key_files:
  created: [.changeset/xci-breadcrumb-propagate.md]
  modified:
    - packages/xci/src/executor/nesting.ts
    - packages/xci/src/executor/__tests__/nesting.test.ts
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
    - packages/xci/src/types.ts
    - packages/xci/src/executor/xci-delegate.ts
    - packages/xci/src/executor/index.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/executor/output.ts
    - packages/xci/src/__tests__/cli.e2e.test.ts
    - packages/xci/README.md
decisions:
  - "getBreadcrumbPrefix splits on ' > ' (the join separator), trims segments, drops empties — mirrors getNestingDepth defensive style"
  - "depth-cap counts only post-seed recursion (depth=0 regardless of prefix length); prefix only enriches display breadcrumb"
  - "buildDelegateInvocation sets XCI_BREADCRUMB from passed-in breadcrumb only (no re-read of process.env to prevent double-counting)"
  - "ExecutionPlan xci variant gains breadcrumb? field matching the SequentialStep xci variant"
  - "printRunHeader renames pre-existing unused 'dim' variable to '_dim' to clear biome noUnusedVariables error"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-23"
  tasks_completed: 3
  files_modified: 11
---

# Phase quick-260623-ipz Plan 01: Propagate XCI Delegate Breadcrumb Summary

## One-liner

XCI_BREADCRUMB env var propagates accumulated alias path into delegated child xci processes so step headers and run header show the full cross-process breadcrumb (e.g. `run-child > inner-seq > inner-step`).

## What Was Built

### Task 1: XCI_BREADCRUMB env constant + getBreadcrumbPrefix() pure helper; resolver seed

- **nesting.ts**: Added `XCI_BREADCRUMB_ENV = 'XCI_BREADCRUMB'` constant and `getBreadcrumbPrefix(): string[]` pure helper. Reads `process.env[XCI_BREADCRUMB_ENV]`, splits on `' > '`, trims segments, filters empties. Absent/empty returns `[]`. No imports added (cold-start budget: <300ms).
- **resolver/index.ts**: Added `import { getBreadcrumbPrefix } from '../executor/nesting.js'`. In `resolver.resolve()` entry point, seed changed from `[aliasName]` to `[...getBreadcrumbPrefix(), aliasName]`. The `depth` counter remains 0 — prefix only enriches breadcrumb display and error messages, never the nesting budget.
- **Tests**: 6 new `getBreadcrumbPrefix` unit tests in nesting.test.ts; 3 new resolver prefix-seeding tests including depth-cap guard test.

Commit: `db31722`

### Task 2: Carry breadcrumb on plan-level xci variant; inject XCI_BREADCRUMB into childEnv

- **types.ts**: Added `readonly breadcrumb?: readonly string[]` to `ExecutionPlan` xci variant.
- **resolver/index.ts** plan-level `case 'xci'`: Added `...(chain.length > 0 ? { breadcrumb: [...chain] } : {})` so the resolved plan carries the full chain.
- **xci-delegate.ts**: Added `readonly breadcrumb?: readonly string[]` to `XciDelegateFields`. In `buildDelegateInvocation`, conditionally sets `childEnv[XCI_BREADCRUMB_ENV] = fields.breadcrumb.join(' > ')` when breadcrumb is non-empty. Does NOT re-read `process.env` (prevents double-counting across levels).
- **executor/index.ts** `case 'xci'`: Forwards `plan.breadcrumb` to `runXciDelegate` fields.
- **sequential.ts** `if (step.kind === 'xci')`: Forwards `step.breadcrumb` to `runXciDelegate` fields.
- **Tests**: 4 new `buildDelegateInvocation` env tests in xci-delegate.test.ts.

Commit: `f65b839`

### Task 3: Render breadcrumb prefix in printRunHeader; e2e, changeset, README

- **output.ts**: Added `import { getBreadcrumbPrefix, isNested } from './nesting.js'`. In `printRunHeader` title line, compute `const prefix = getBreadcrumbPrefix()` and build `displayAlias = prefix.length > 0 ? prefix.join(' > ') + ' > ' + alias : alias`. No-prefix branch is byte-identical. Also renamed pre-existing unused `dim` variable to `_dim` to clear biome `noUnusedVariables` error.
- **cli.e2e.test.ts**: Added full-path breadcrumb e2e test inside `xci command kind` describe block. OUTER runs `run-child` (kind:xci → child's `inner-seq`). Asserts outer captured output contains `'running: run-child > inner-seq'` and `'INNER-LINE'` (tee path exercised).
- **.changeset/xci-breadcrumb-propagate.md**: Patch changeset for xci package.
- **README.md**: Added "Breadcrumb propagation across the delegate boundary" section in xci kind docs.

Commit: `25dead7`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TDD RED test initially passed unexpectedly for wrong reason**

- **Found during:** Task 3 RED phase
- **Issue:** The initial breadcrumb e2e test checked for `'run-child > inner-seq'` which was already present in step header output (`run-child > inner-seq > inner-step [1/1]`) even before the `printRunHeader` output.ts change. The test passed in RED when it should have failed.
- **Fix:** Updated the assertion to `'running: run-child > inner-seq'` which specifically tests the `printRunHeader` title line (the actual Task 3 behavior). This correctly failed in RED and passed after GREEN.
- **Files modified:** packages/xci/src/__tests__/cli.e2e.test.ts

**2. [Rule 1 - Bug] Pre-existing biome noUnusedVariables error for 'dim' in printRunHeader**

- **Found during:** Task 3 biome check
- **Issue:** `const dim = useColor ? DIM : '';` was declared in `printRunHeader` but never referenced — a pre-existing issue that became a blocking biome error for the Task 3 verify.
- **Fix:** Renamed to `_dim` (biome-safe unused variable convention) without functional impact.
- **Files modified:** packages/xci/src/executor/output.ts
- **Commit:** 25dead7

## Test Results

Final gate: `npm run build && npx tsc --noEmit && npx vitest --run`

- **639 tests passed**
- **6 tests failed** — all pre-existing known environmental failures on this machine:
  - `--version` / `-V`: hardcoded 0.0.0 vs current 0.3.x
  - `--verbose` / `${xci.project.path}`: Windows backslash path assertion
  - `cold-start`: agent-import regex
  - `single.test.ts`: SpawnError when command does not exist (execa-on-Windows)

No new test failures introduced.

## Known Stubs

None — all breadcrumb paths are fully wired. No placeholder/TODO values.

## Threat Flags

None — XCI_BREADCRUMB contains alias names only (T-ipz-01 mitigated). Depth cap is independent of prefix length (T-ipz-02 mitigated). Input parsing is defensive (T-ipz-03 accepted).

## Self-Check: PASSED

All files verified to exist. All 3 task commits verified in git log.

| Check | Result |
|-------|--------|
| packages/xci/src/executor/nesting.ts | FOUND |
| packages/xci/src/executor/output.ts | FOUND |
| .changeset/xci-breadcrumb-propagate.md | FOUND |
| commit db31722 (Task 1) | FOUND |
| commit f65b839 (Task 2) | FOUND |
| commit 25dead7 (Task 3) | FOUND |
