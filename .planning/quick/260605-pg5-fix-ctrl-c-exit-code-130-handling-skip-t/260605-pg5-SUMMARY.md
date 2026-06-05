---
phase: quick-260605-pg5
plan: 01
subsystem: xci-cli-executor
tags: [sigint, exit-code, ux, abort, ctrl-c]
dependency_graph:
  requires: []
  provides: [sigint-abort-ux-suppression]
  affects: [packages/xci/src/executor/index.ts, packages/xci/src/cli.ts]
tech_stack:
  added: []
  patterns: [exit-code-130-gate, stderr-confirmation]
key_files:
  created: []
  modified:
    - packages/xci/src/executor/index.ts
    - packages/xci/src/cli.ts
decisions:
  - "Gate notifyCompletion at call site in executor/index.ts, not inside notifyCompletion itself, to keep all other exit codes unaffected"
  - "Gate error UX (printErrorLines + askShowLog) with if/else-if branching: 130 branch writes '[xci] Abortito.' to stderr; else-if handles non-zero failures"
  - "Abort confirmation goes to stderr (not stdout) per project pitfall: stdout must stay clean for capture/completion parsing"
metrics:
  duration: ~5 min
  completed: "2026-06-05T16:25:20Z"
  tasks_completed: 2
  files_modified: 2
---

# Quick Task 260605-pg5: Fix CTRL+C Exit Code 130 Handling — Skip Toast and askShowLog

**One-liner:** Gate both notifyCompletion (toast) and error UX (printErrorLines + askShowLog) on `exitCode !== 130` so CTRL+C abort skips noise and prints `[xci] Abortito.` to stderr.

## What Was Done

### Task 1 — Skip completion toast on SIGINT (exit 130)
**File:** `packages/xci/src/executor/index.ts`

Wrapped the `notifyCompletion` call at the end of `executor.run` in a guard:
```typescript
if (result.exitCode !== 130) {
  await notifyCompletion(result.exitCode, options.projectName, options.alias);
}
```
Exit code 130 = POSIX SIGINT (128 + 2). A deliberate user abort has no useful completion to notify about.

**Commit:** `8991799`

### Task 2 — Skip error UX on SIGINT and print abort confirmation
**File:** `packages/xci/src/cli.ts`

Replaced the single `if (result.exitCode !== 0)` block with an `if/else-if` that branches on 130 first:
- **130 branch:** sets `process.exitCode = 130`, writes `[xci] Abortito.` to stderr, returns — no `printErrorLines`, no `askShowLog`
- **else-if (non-zero, non-130):** existing error path unchanged (printErrorLines + askShowLog)

**Commit:** `f8f744e`

## Verification

- `npx tsc --noEmit -p .` passes with zero errors in packages/xci after both tasks.
- Code inspection confirms: 130 branch has no `printErrorLines`/`askShowLog` calls.
- Non-130 failure path is byte-identical to the original code.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `packages/xci/src/executor/index.ts` modified — contains `exitCode !== 130` guard at line ~109.
- `packages/xci/src/cli.ts` modified — contains `exitCode === 130` branch with `[xci] Abortito.`.
- Commits `8991799` and `f8f744e` verified in git log.
