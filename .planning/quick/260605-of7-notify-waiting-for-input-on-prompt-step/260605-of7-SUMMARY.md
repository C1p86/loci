---
phase: quick-260605-of7
plan: "01"
subsystem: executor/output
tags: [notification, prompt, sequential, ux]
dependency_graph:
  requires: []
  provides: [notifyWaitingForInput export in output.ts]
  affects: [packages/xci/src/executor/output.ts, packages/xci/src/executor/sequential.ts]
tech_stack:
  added: []
  patterns: [mirror notifyCompletion WinRT + node-notifier pattern]
key_files:
  created: []
  modified:
    - packages/xci/src/executor/output.ts
    - packages/xci/src/executor/sequential.ts
decisions:
  - Pass undefined as projectName in sequential.ts — projectName is not available in that scope; notifyWaitingForInput already defaults to 'xci'
  - Pass step.message (not message local var) — step.message is undefined when not set, which correctly triggers the 'in attesa di input' default
metrics:
  duration: ~5m
  completed: "2026-06-05"
  tasks_completed: 2
  files_modified: 2
---

# Phase quick-260605-of7 Plan 01: Notify Waiting for Input on Prompt Step Summary

**One-liner:** Added OS toast notification before interactive prompt steps using WinRT/node-notifier pause glyph pattern matching notifyCompletion.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add notifyWaitingForInput to output.ts | da033a1 | packages/xci/src/executor/output.ts |
| 2 | Call notifyWaitingForInput before promptUser in sequential.ts | 8d41580 | packages/xci/src/executor/sequential.ts |

## What Was Built

`notifyWaitingForInput(projectName?, promptMessage?)` exported from `output.ts`:
- Title: `projectName ?? 'xci'`
- Body: `⏸ ${promptMessage ?? 'in attesa di input'}`
- Win32: PowerShell WinRT ToastText02 template (same AUMID as notifyCompletion)
- Non-Windows: node-notifier dynamic import fallback
- Outer try/catch ensures silent failure — prompt flow is never interrupted

`sequential.ts` TTY branch (inside `if (step.kind === 'prompt')`):
- Added `await notifyWaitingForInput(undefined, step.message)` immediately before `promptUser`
- Non-TTY branch (default-value path) is unchanged — no notification fires in non-interactive mode

## Verification

- `tsc --noEmit` reports zero errors (validated against main repo node_modules)
- Existing vitest suite: 11 failures were pre-existing (E2E tests require built dist/cli.mjs, Windows node.exe path issue) — no regressions introduced

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- Commit da033a1 exists: confirmed
- Commit 8d41580 exists: confirmed
- `notifyWaitingForInput` exported from output.ts: confirmed
- `notifyWaitingForInput` called in sequential.ts TTY branch: confirmed
