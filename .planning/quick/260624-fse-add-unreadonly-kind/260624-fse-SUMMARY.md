---
phase: quick-260624-fse
plan: 01
subsystem: xci/executor
tags: [unreadonly, chmod, command-kind, cross-platform, filesystem]
dependency_graph:
  requires: [uproject-kind-quick-260618-h1d]
  provides: [unreadonly-command-kind]
  affects: [types.ts, normalize.ts, resolver/index.ts, executor/cwd.ts, executor/index.ts, executor/sequential.ts]
tech_stack:
  added: []
  patterns: [discriminated-union-extension, node-fs-chmod, pipeline-stage-wiring]
key_files:
  created:
    - packages/xci/src/executor/unreadonly.ts
    - packages/xci/src/executor/__tests__/unreadonly.test.ts
  modified:
    - packages/xci/src/types.ts
    - packages/xci/src/commands/normalize.ts
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/executor/cwd.ts
    - packages/xci/src/executor/index.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/commands/__tests__/commands.test.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
    - packages/xci/src/__tests__/types.test.ts
    - packages/xci/src/executor/output.ts
    - packages/xci/src/cli.ts
    - packages/xci/src/tui/dashboard.ts
decisions:
  - "path: 'project' resolves to effectiveCwd in both top-level and inline sequential executors, matching the plan specification"
  - "No new runtime dependencies — removeReadonly uses only node:fs and node:path"
  - "Symlinks are chmod'd but not recursed through (isSymbolicLink guard in walkAndChmod)"
metrics:
  duration: 23m
  completed: "2026-06-24T09:35:47Z"
  tasks: 3
  files_created: 2
  files_modified: 12
---

# Phase quick-260624-fse Plan 01: Add unreadonly Command Kind Summary

**One-liner:** New `unreadonly` kind that removes readonly filesystem attributes via `fs.chmodSync` (file: 0o666, dir: 0o777, recursive walk) wired through all 5 pipeline stages with `path: 'project'` support.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add unreadonly to three type unions + create removeReadonly | c21e093 | types.ts, executor/unreadonly.ts |
| 2 | Wire through normalize, resolver, cwd | 208852a | normalize.ts, resolver/index.ts, executor/cwd.ts |
| 3 | Wire executors + add removeReadonly unit tests | 208852a | executor/index.ts, executor/sequential.ts, __tests__/unreadonly.test.ts |

## What Was Built

Added a new `unreadonly` command kind to the xci DSL. It mirrors the existing `uproject` kind pattern exactly across all 5 pipeline stages:

1. **types.ts** — Three new union members added: `CommandDef | { kind: 'unreadonly'; path; recursive?; ... }`, `SequentialStep | { kind: 'unreadonly'; path; recursive; ... }`, `ExecutionPlan | { kind: 'unreadonly'; path; recursive; ... }`.

2. **normalize.ts** — Detection block using `Object.hasOwn(obj, 'unreadonly')`. Validates path is a string and optional recursive is a boolean. Returns `CommandDef` with conditional-spread style.

3. **resolver/index.ts** — `case 'unreadonly':` added to both `resolveToStepsLenient` (produces `SequentialStep`) and `resolveAlias` (produces `ExecutionPlan`). Path interpolated; `recursive` defaults to `false`.

4. **executor/cwd.ts** — `case 'unreadonly':` in `resolveAbsoluteCwds` rewrites `cwd` to absolute. `path` is NOT rewritten (resolved in executor against effectiveCwd, matching uproject pattern).

5. **executor/index.ts** + **executor/sequential.ts** — Top-level and inline sequential executors handle `kind: 'unreadonly'`. `path === 'project'` resolves to the effective cwd. Error handling mirrors uproject try/catch pattern; no secret values logged.

6. **executor/unreadonly.ts** (new) — `removeReadonly(targetPath, recursive)`: uses `statSync` → `chmodSync(dir, 0o777)` / `chmodSync(file, 0o666)`. Recursive walk via `readdirSync` with `withFileTypes`. Symlinks are chmod'd but not recursed through.

## Test Coverage

- **7 unit tests** for `removeReadonly`: readonly file → writable, dir non-recursive, dir recursive, empty dir, ENOENT throws, error message contains path info.
- **4 normalize tests**: valid file path, recursive:true preserved, non-string path throws, non-boolean recursive throws.
- **4 resolver tests**: standalone alias → ExecutionPlan, recursive:true, `${VAR}` interpolation, sequential step → SequentialStep with breadcrumb.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript exhaustiveness errors required simultaneous wiring of all stages**

- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** Adding `unreadonly` to the `SequentialStep` and `ExecutionPlan` union immediately broke switch exhaustiveness in `executor/cwd.ts`, `executor/index.ts`, `executor/output.ts`, `cli.ts`, `tui/dashboard.ts`, and narrowing type guards in test files.
- **Fix:** Wired all 5 pipeline stages and updated all switch/narrowing code in a single pass before verifying compilation. Tasks 2 and 3 were committed together since TypeScript requires complete wiring to compile.
- **Files modified:** All 12 listed above (types + new file in first commit; everything else in second commit).

**2. [Rule 2 - Missing critical functionality] Updated `types.test.ts` kind union assertions**

- **Found during:** Task 1 verification
- **Issue:** `types.test.ts` had literal union assertions `'single' | 'sequential' | 'parallel' | 'for_each' | 'ini' | 'uproject' | 'xci'` that did not include `'unreadonly'`.
- **Fix:** Added `'unreadonly'` to both `CommandDef` and `ExecutionPlan` union assertions.

## Known Stubs

None. The implementation is fully wired and functional.

## Threat Flags

None. The new surface (`removeReadonly`) does not introduce network endpoints, auth paths, or external file access beyond the project workspace the operator already controls. T-fse-02 mitigation confirmed: executor prints only the resolved path, never config/secret values.

## Self-Check: PASSED

Files verified:
- `packages/xci/src/executor/unreadonly.ts` — FOUND
- `packages/xci/src/executor/__tests__/unreadonly.test.ts` — FOUND
- Commit c21e093 — FOUND
- Commit 208852a — FOUND
