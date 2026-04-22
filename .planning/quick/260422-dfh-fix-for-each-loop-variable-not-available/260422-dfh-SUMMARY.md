---
phase: quick-260422-dfh
plan: 01
subsystem: xci/resolver
tags: [bugfix, for_each, rawArgv, sequential-executor, tdd]
dependency_graph:
  requires: []
  provides: ["for_each rawArgv loop variable baked at resolve time"]
  affects: ["packages/xci/src/resolver/index.ts", "packages/xci/src/executor/sequential.ts"]
tech_stack:
  added: ["vitest@4.1.4 (local install in packages/xci — pnpm symlinks broken in WSL)"]
  patterns:
    - "TDD: RED (failing test commit) → GREEN (fix commit)"
    - "String.replaceAll for loop variable substitution in rawArgv tokens"
key_files:
  created: []
  modified:
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
decisions:
  - "Fix both lenient (resolveToStepsLenient) and strict (resolveAlias for_each sequential) paths — they share the same rawArgv: def.cmd bug"
  - "Use replaceAll(\`\${def.var}\`, value) to replace only the loop variable; other \${placeholder} tokens (captured vars) are left for executor re-interpolation at runtime"
  - "Installed vitest@4.1.4 locally in packages/xci — pnpm symlink chain broken in this WSL environment (symlinks point to /mnt/c/... Windows host path that is inaccessible)"
metrics:
  duration: "~15 min"
  completed: "2026-04-22"
  tasks: 2
  files_modified: 2
---

# Quick Task 260422-dfh: Fix for_each Loop Variable Not Available in Sequential Executor

**One-liner:** Bake for_each loop variable into rawArgv at resolve time so sequential executor re-interpolation does not throw UndefinedPlaceholderError for \${svc}-style loop vars.

## What Was Done

### Root Cause

`for_each` sequential steps set `rawArgv: def.cmd` (the raw template, e.g. `['deploy', '${svc}', '--region', 'us']`).

The sequential executor (sequential.ts line 182) re-interpolates `rawArgv` using `{ ...env, ...capturedVars }`. The loop variable (`svc`) is in neither `env` nor `capturedVars` — it only existed during resolver expansion. This caused `UndefinedPlaceholderError` at runtime when the step was executed.

### Fix

Two locations in `packages/xci/src/resolver/index.ts`:

**Lenient path** (`resolveToStepsLenient`, inside `case 'for_each'`, `else if (def.cmd)` branch):
```
rawArgv: def.cmd.map(t => t.replaceAll(`\${${def.var}}`, value))
```

**Strict path** (`resolveAlias`, inside `case 'for_each'` sequential mode, `else if (def.cmd)` branch):
```
rawArgv: def.cmd.map(t => t.replaceAll(`\${${def.var}}`, value))
```

The `argv` field is unchanged — it already receives `loopValues` via `interpolateArgvLenient`. Only `rawArgv` needed the loop variable baked in; other `${placeholder}` tokens (captured vars from prior steps) remain as-is for the executor to resolve at runtime.

## Verification

### Test suite result

`cd packages/xci && npm test -- src/resolver/__tests__/resolver.test.ts`:
- **59 passed**, 0 failed (59 total)

New describe block `for_each rawArgv bakes loop variable` — 2 new tests both green:
1. `strict path (inline cmd): rawArgv has loop variable replaced for each step`
2. `lenient path (for_each with run referencing alias): rawArgv has loop variable replaced`

### Full suite note

9 test files fail in the full suite (`npm test`) — all pre-existing failures caused by broken pnpm symlinks in WSL (execa's `is-plain-obj` transitive dep, cold-start requires built `dist/`). These are independent of this change. Resolver tests (the files modified here) are the only in-scope suite, and all 59 pass.

## Deviations from Plan

**[Rule 3 - Blocking] Installed vitest@4.1.4 locally in packages/xci**
- **Found during:** Task 1 verification attempt
- **Issue:** `npm test` failed with `Cannot find module '…/node_modules/vitest/vitest.mjs'` — pnpm symlink in `node_modules/vitest` points to `/mnt/c/…` Windows host path, inaccessible from WSL
- **Fix:** `sudo npm install --save-dev vitest@4.1.4 --prefix packages/xci` — installs vitest directly in the package's local `node_modules` so the test runner resolves correctly in this environment
- **Files modified:** `packages/xci/package.json`, `packages/xci/package-lock.json`
- **Commit:** 4b030ff

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 4b030ff | test | Add failing tests for for_each rawArgv loop variable baking (RED) |
| d771b51 | fix | Bake for_each loop variable into rawArgv in both code paths (GREEN) |

## Self-Check: PASSED

- [x] `packages/xci/src/resolver/index.ts` modified — confirmed (2 lines changed)
- [x] `packages/xci/src/resolver/__tests__/resolver.test.ts` modified — confirmed (57 lines added)
- [x] Commit 4b030ff exists: `git log --oneline | grep 4b030ff` → found
- [x] Commit d771b51 exists: `git log --oneline | grep d771b51` → found
- [x] 59/59 resolver tests pass
