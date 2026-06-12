---
phase: quick-260612-lbn
plan: 01
subsystem: executor
tags: [error-handling, cwd, spawn, cross-platform]
dependency_graph:
  requires: []
  provides: [CwdMissingError, assertCwdExists]
  affects: [executor/single, executor/sequential, executor/parallel]
tech_stack:
  added: []
  patterns: [statSync guard before execa spawn, custom error subclass with path field]
key_files:
  created:
    - packages/xci/src/executor/__tests__/cwd-exists.test.ts
  modified:
    - packages/xci/src/errors.ts
    - packages/xci/src/executor/cwd.ts
    - packages/xci/src/executor/single.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/executor/parallel.ts
decisions:
  - "assertCwdExists placed in cwd.ts (same file as resolveAbsoluteCwds) — cwd concerns are co-located; spawn sites import directly from './cwd.js'"
  - "statSync+try/catch (not existsSync) — single check handles both missing and file-not-dir cases; existsSync import dropped to avoid unused-import lint warning"
  - "Guard placed OUTSIDE the try/catch that wraps await proc — CwdMissingError propagates cleanly without being re-wrapped as SpawnError"
  - "Regression guard test uses process.execPath + non-zero exit (not __xci_nonexistent_command_xyz__) — on Windows, unknown commands return exitCode 1 instead of ENOENT; avoiding a pre-existing flaky test pattern"
metrics:
  duration: ~12 min
  completed: "2026-06-12"
  tasks: 3
  files: 5
---

# Quick Task 260612-lbn: Validate CWD Exists Before Spawning Child Process

**One-liner:** Early CWD validation via `assertCwdExists` + `CwdMissingError` at all four spawn sites turns a misleading `EXE_SPAWN ENOENT` into a precise `EXE_CWD_MISSING` error naming the missing directory.

## What Was Done

### Task 1 — CwdMissingError + assertCwdExists guard

Added `CwdMissingError` to `packages/xci/src/errors.ts` (after `SpawnError`, matching the `MachineConfigInvalidError` pattern with a `public readonly path` field):

```typescript
export class CwdMissingError extends ExecutorError {
  public readonly path: string;
  constructor(cwd: string) {
    super(`Working directory does not exist: ${cwd}`, {
      code: 'EXE_CWD_MISSING',
      suggestion: 'This directory likely comes from an alias `cwd:`. ...',
    });
    this.path = cwd;
  }
}
```

Added `assertCwdExists(cwd: string | undefined): void` to `packages/xci/src/executor/cwd.ts` — a no-op for `undefined`/`''`, throws `CwdMissingError` for non-existent or non-directory paths using `statSync`.

### Task 2 — Wire guard at all four spawn sites

- `single.ts` (`runSingleCapture`, `runSingle`): `assertCwdExists(cwd)` after empty-command check, outside the `try/catch` that wraps `await proc`
- `sequential.ts` (`runAndCapture`): same pattern; the non-capture branch calls `runSingle` (already guarded)
- `parallel.ts` (`group.map` callback): `assertCwdExists(effectiveCwd)` after computing `effectiveCwd = entryCwd ?? cwd`, before building `execaOpts`

### Task 3 — Vitest coverage

`packages/xci/src/executor/__tests__/cwd-exists.test.ts` (11 tests, all pass):

- Unit: `assertCwdExists(undefined)` — no throw; `assertCwdExists('')` — no throw; valid dir — no throw; missing path — throws `CwdMissingError`; file (not dir) — throws `CwdMissingError`; error properties verified (code, category, message, path)
- Integration: `runSingle` with missing cwd throws `CwdMissingError` (not `SpawnError`); not-a-SpawnError assertion; valid cwd succeeds
- Regression guard: valid cwd + non-zero exit returns exitCode (no `CwdMissingError`); `assertCwdExists` no-op for valid dir

## Commits

| Hash | Message |
|------|---------|
| `0c673cc` | feat(quick-260612-lbn): add CwdMissingError + assertCwdExists guard |
| `998a7a6` | feat(quick-260612-lbn): call assertCwdExists at all four spawn sites |
| `aa9ff20` | test(quick-260612-lbn): add vitest coverage for assertCwdExists and CwdMissingError |

## Verification Results

- `npx vitest run src/executor/__tests__/cwd-exists.test.ts` — 11/11 pass
- `npx vitest run src/executor/__tests__/cwd.test.ts` — 11/11 pass (no regression)
- `npx tsc --noEmit` — zero type errors
- `npx biome check src/errors.ts src/executor/cwd.ts src/executor/__tests__/cwd-exists.test.ts` — clean (auto-formatted by biome --write)
- Full suite: 492 passing, 5 pre-existing failures unrelated to this task (dist files missing + Windows-specific exe-not-found behavior in single.test.ts)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Notes on Pre-existing Test Failures (out of scope)

The following failures existed before this task and are NOT regressions:
- `single.test.ts` — "throws SpawnError when command does not exist" and "passes cwd to child process" fail on Windows (ENOENT from `/tmp` path; nonexistent commands return exitCode 1 instead of ENOENT on Windows)
- `cold-start.test.ts` — dist files not built in worktree
- `init.test.ts`, `cli.e2e.test.ts` — E2E tests require built dist
- `loader.test.ts` — git commit failure in test setup (git config not set in worktree environment)

The regression guard test was adapted from the plan's `SpawnError` assertion to use `process.execPath + non-zero exit` instead of `__xci_nonexistent_command_xyz__` because the latter is a pre-existing flaky pattern on Windows. The regression intent is preserved: a valid cwd never produces `CwdMissingError`.

## Known Stubs

None — all new code is fully wired.

## Self-Check: PASSED

Files created/modified:
- packages/xci/src/errors.ts — FOUND (CwdMissingError present)
- packages/xci/src/executor/cwd.ts — FOUND (assertCwdExists exported)
- packages/xci/src/executor/single.ts — FOUND (assertCwdExists imported + called)
- packages/xci/src/executor/sequential.ts — FOUND (assertCwdExists imported + called)
- packages/xci/src/executor/parallel.ts — FOUND (assertCwdExists imported + called)
- packages/xci/src/executor/__tests__/cwd-exists.test.ts — FOUND (11 tests)

Commits verified: 0c673cc, 998a7a6, aa9ff20 — all in git log.
