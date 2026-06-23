---
phase: quick
plan: 260623-hp3
subsystem: xci-executor
tags: [command-kind, delegation, tee, logging, anti-hang]
dependency_graph:
  requires: [260623-fr4]
  provides: [xci-kind-output-tee, xci-kind-logfile, xci-kind-anti-hang]
  affects: [packages/xci/src/executor]
tech_stack:
  added: [packages/xci/src/executor/tee.ts]
  patterns: [exit-event-resolution, piped-stdin-inherited, stream-destroy-unref]
key_files:
  created:
    - packages/xci/src/executor/tee.ts
    - .changeset/xci-delegate-output-tee.md
  modified:
    - packages/xci/src/executor/xci-delegate.ts
    - packages/xci/src/executor/single.ts
    - packages/xci/src/executor/index.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/executor/__tests__/xci-delegate.test.ts
    - packages/xci/src/__tests__/cli.e2e.test.ts
    - packages/xci/README.md
decisions:
  - "attachTee is shared between runSingle and runXciDelegate; isNested() check lives inside tee.ts"
  - "runXciDelegate resolves on child 'exit' event (not stream close) for anti-hang on normal + SIGINT paths"
  - "killDelegateAndWait destroys/unrefs piped streams BEFORE killing to prevent SIGINT hang from leaked grandchild"
  - "outputFlag is a literal '--log'/'--verbose' appended to argv — never an arg value (secret-safe)"
  - "injected spawnFn returns stdout/stderr EventEmitters so unit tests exercise real data-handler path"
  - "grandchild in ANTI-HANG e2e spawned in os.tmpdir() to avoid Windows EPERM on cleanup"
metrics:
  duration: "~15 min"
  completed: "2026-06-23"
  tasks: 3
  files: 9
---

# Quick 260623-hp3: Fix kind:xci delegated output not shown — SUMMARY

**One-liner:** Tee piped delegate stdout/stderr to outer terminal and outer .xci/log/ file via shared `attachTee` helper; resolve on child exit event (not stream close) for anti-hang on both normal and SIGINT paths.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | RED: extend xci-delegate unit tests for outputFlag, tee-to-logFile, showOutput gating | ac7a06f | xci-delegate.test.ts |
| 2 | GREEN: extract attachTee, rewire runSingle, rewrite runXciDelegate with piped+exit-event anti-hang | 2171dc3 | tee.ts, single.ts, xci-delegate.ts |
| 3 | Wire call sites, e2e SHOW+SAVE + anti-hang, README, changeset | 3c90081 | index.ts, sequential.ts, cli.e2e.test.ts, README.md, changeset |

## What Changed

### `tee.ts` (new)
Shared helper `attachTee(stdout, stderr, logStream, showOutput, tailLines)` extracted from `runSingle`'s inline data-handler block. Attaches 'data' listeners that write each chunk to: (a) logStream if provided, (b) process.stdout/stderr when showOutput, (c) the tail redraw buffer when tail is active. isNested() check lives here (isTail disabled when nested). Returns a cleanup function that removes listeners.

### `xci-delegate.ts`
- `buildDelegateInvocation` gains 5th param `outputFlag: '--log' | '--verbose'` appended to argv. Literal, never an arg value — secret-safe.
- `runXciDelegate` gains `logFile?, showOutput=true, tailLines?, verbose=false` params. Spawns with `stdout:'pipe', stderr:'pipe', stdin:'inherit'`. Opens logStream. Calls `attachTee` on proc's streams.
- **ANTI-HANG normal path:** Promise resolved from proc `'exit'` event (not `await proc` stream close). After exit: remove listeners, `destroy()+unref()` stdout/stderr.
- **ANTI-HANG SIGINT path:** `killDelegateAndWait` removes tee listeners and `destroy()+unref()` streams BEFORE killing, then waits on `'exit'` event. No stream-EOF dependency.
- injected spawnFn returns `{ exitCode, stdout?, stderr? }` (EventEmitter shape); tee attached on fake streams so unit tests exercise real data-handler path.

### `single.ts`
Pure extraction: replaced inline `proc.stdout?.on('data', ...)` / `proc.stderr?.on('data', ...)` block with `attachTee(...)` call. Behavior byte-identical.

### `index.ts`, `sequential.ts`
Both `case 'xci'` and sequential inline xci step now pass `logFile, show/showOutput, tailLines, verbose` to `runXciDelegate`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest 4 API change: `it(name, fn, options)` → `it(name, options, fn)`**
- **Found during:** Task 3, writing anti-hang e2e test
- **Issue:** Vitest 4 removed the deprecated signature `it(name, fn, {timeout})` — options must be second arg
- **Fix:** Moved `{ timeout: 20000 }` to second argument position
- **Files modified:** `packages/xci/src/__tests__/cli.e2e.test.ts`
- **Commit:** 3c90081

**2. [Rule 3 - Blocking] Windows EPERM on temp dir cleanup in anti-hang e2e**
- **Found during:** Task 3, running ANTI-HANG e2e test
- **Issue:** Detached background grandchild process inherited cwd from inner project temp dir; Windows couldn't remove the dir while the process was running (400ms)
- **Fix:** Added `cwd: require('os').tmpdir()` to the background grandchild spawn options
- **Files modified:** `packages/xci/src/__tests__/cli.e2e.test.ts`
- **Commit:** 3c90081

## Verification

- `npm run build`: passes
- `npx tsc --noEmit`: clean
- `npx vitest run src/executor/__tests__/xci-delegate.test.ts`: 17/17 pass
- `npx vitest run src/executor/__tests__/nesting.test.ts`: all pass
- `npx vitest run src/executor/__tests__/single.test.ts`: 5/6 pass (pre-existing SpawnError test)
- `npx vitest run src/__tests__/cli.e2e.test.ts -t "xci command kind"`: 9/9 pass (7 pre-existing + 2 new)
- biome check on changed files: no new issues introduced (pre-existing issues unchanged)

## Pre-existing Failures (not introduced by this work)

Per constraints: "the single.ts SpawnError test", "hardcoded version 0.0.0 vs 0.3.0", "Windows backslash path assertions", "cold-start agent-import regex" — all pre-existing and confirmed unchanged.

## Self-Check: PASSED

- `packages/xci/src/executor/tee.ts` — FOUND
- `.changeset/xci-delegate-output-tee.md` — FOUND
- `packages/xci/src/executor/xci-delegate.ts` — FOUND (contains `showOutput`, `attachTee`, exit-event resolution)
- `packages/xci/src/executor/__tests__/xci-delegate.test.ts` — FOUND (contains `forward`, `BUILD-LINE-STDOUT` skipped — e2e in cli.e2e.test.ts)
- `packages/xci/src/__tests__/cli.e2e.test.ts` — FOUND (contains `BUILD-LINE-STDOUT`)
- Commit ac7a06f — FOUND
- Commit 2171dc3 — FOUND
- Commit 3c90081 — FOUND
