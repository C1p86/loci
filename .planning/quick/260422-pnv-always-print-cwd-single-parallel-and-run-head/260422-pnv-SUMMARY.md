---
id: 260422-pnv
title: Always print effective cwd for single, sequential, parallel — unconditional top-level cwd in printRunHeader
status: complete
date: 2026-04-22
---

# Quick Task 260422-pnv — Summary

## Outcome

User could not see the `cwd:` line for every executed command. Three gaps were fixed so the effective working directory is surfaced for every command kind and unconditionally in the run-header.

## Changes

- `packages/xci/src/executor/index.ts` — single case now passes `cwd: effectiveCwd` into `printStepPreview`, matching the sequential path.
- `packages/xci/src/executor/parallel.ts` — before spawning, loop over `group` and emit one `[alias]` label followed by a `printStepPreview` (cwd + run) per entry. Import `printStepPreview` added.
- `packages/xci/src/executor/output.ts` — `printRunHeader` no longer suppresses the top-level `cwd:` line when it equals `projectRoot`. The unused `projectRoot?` parameter was dropped.
- `packages/xci/src/cli.ts` — caller updated to the new `printRunHeader` signature (no `projectRoot` arg).
- `packages/xci/src/executor/__tests__/output.test.ts` — regression test asserts `cwd: /project/root` is printed even when the plan cwd coincides with the project root.
- `packages/xci/dist/cli.mjs` — rebuilt via tsup so the updated behavior ships.

## Verification

- `vitest run packages/xci/src/executor/__tests__/output.test.ts` — 187/187 passing, including the new `always prints the top-level cwd line` case.
- `grep` over the rebuilt dist confirms `redactedTopCwd !== void 0` (no `projectRoot` guard), the single-case `printStepPreview` receives `cwd: effectiveCwd`, and `parallel` iterates over `group` to print per-entry previews.

## Notes

- Type errors in `src/tui/dashboard.ts` and `src/tui/picker.ts` reported by `tsc --noEmit` are pre-existing and unrelated to this change.
- Full-suite vitest failures come from stale worktree copies under `.claude/worktrees/agent-*` and e2e tests that resolve `dist/cli.mjs` from the monorepo root rather than `packages/xci/dist/` — pre-existing infrastructure gaps, not regressions from this change.
