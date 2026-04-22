---
id: 260422-pnv
title: Always print effective cwd for single, sequential, parallel — unconditional top-level cwd in printRunHeader
status: ready
---

# Quick Task 260422-pnv

## Description

User reports the `cwd:` line still isn't visible across all command kinds. Three gaps identified:

1. **`executor/index.ts:28` (single kind):** `printStepPreview(...)` is called without the `cwd` option, so the dark-yellow `cwd:` line is never printed for `single` aliases.
2. **`executor/parallel.ts` (parallel kind):** never calls `printStepPreview` — no per-entry `cwd:` line on stderr at spawn time.
3. **`output.ts` `printRunHeader`:** the top-level `cwd:` line is hidden when the effective cwd equals `projectRoot`. Operators asked to see the cwd on every run.

## Tasks

### 1. Fix `printStepPreview` call in `executor/index.ts` single case
- `files`: `packages/xci/src/executor/index.ts`
- `action`: pass `cwd: effectiveCwd` in the options object when invoking `printStepPreview` for `plan.kind === 'single'`.
- `verify`: searching the file for the single-case call shows `cwd: effectiveCwd` in the options.
- `done`: `single` aliases print the dark-yellow `cwd:` line before `run:`.

### 2. Add per-entry `cwd` preview in `executor/parallel.ts`
- `files`: `packages/xci/src/executor/parallel.ts`
- `action`: before building the spawn promises, loop over `group` and call `printStepPreview(undefined, argv, undefined, { cwd: entryCwd ?? cwd, verbose, logFile })`. Import `printStepPreview` from `./output.js`.
- `verify`: running a parallel alias shows one `[alias]` label + `cwd:` + `run:` preview per entry on stderr before the concurrent output starts.
- `done`: parallel commands show cwd for every entry.

### 3. Unconditional top-level `cwd:` in `printRunHeader`
- `files`: `packages/xci/src/executor/output.ts`, `packages/xci/src/cli.ts`
- `action`: remove the `(projectRoot === undefined || redactedTopCwd !== projectRoot)` guard from the top-level `cwd:` emission in `printRunHeader`. Drop the now-unused `projectRoot?: string` parameter from the signature and from the CLI caller.
- `verify`: running any alias whose effective cwd equals projectRoot shows a `cwd: <root>` line in the run-header.
- `done`: `cwd:` line is always visible in `printRunHeader` when the plan has a resolvable cwd.

### 4. Add regression test + rebuild dist
- `files`: `packages/xci/src/executor/__tests__/output.test.ts`, `packages/xci/dist/cli.mjs`
- `action`: add a test asserting `printRunHeader` prints `cwd: /project/root` for a plan whose cwd matches what was previously the hidden case. Rebuild dist via tsup so the behavior ships.
- `verify`: `vitest run packages/xci/src/executor/__tests__/output.test.ts` is green; `grep 'redactedTopCwd !== void 0)' dist/cli.mjs` matches.
- `done`: tests pass, dist contains the updated conditional.

## Must-haves

- `truths`:
  - Every `single` spawn prints the dark-yellow `cwd:` line before `run:`.
  - Every `parallel` spawn prints a `[alias]` + `cwd:` + `run:` preview per entry.
  - `printRunHeader` always prints `cwd:` when the plan resolves a cwd.
- `artifacts`:
  - `packages/xci/src/executor/index.ts`
  - `packages/xci/src/executor/parallel.ts`
  - `packages/xci/src/executor/output.ts`
  - `packages/xci/src/cli.ts`
  - `packages/xci/src/executor/__tests__/output.test.ts`
- `key_links`:
  - Predecessor: quick-260422-mxr (sequential-step cwd preview)
  - Predecessor: quick-260421-nmx (initial dark-yellow cwd line)
  - Predecessor: quick-260421-g99 (plan-level cwd resolution)
