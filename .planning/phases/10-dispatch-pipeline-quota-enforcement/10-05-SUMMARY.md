---
phase: 10-dispatch-pipeline-quota-enforcement
plan: "05"
subsystem: xci-agent-dispatch
tags: [agent, dispatch, cancel, runner, sec-06, e2e, closeout]
dependency_graph:
  requires: [10-01, 10-02, 10-03, 10-04]
  provides: [agent-dispatch-pipeline, agent-cancel-handler, agent-runner, sec-06-merge, phase-10-closeout]
  affects: [packages/xci/src/agent/, packages/server/src/__tests__/e2e/]
tech_stack:
  added: []
  patterns:
    - spawnTask RunHandle pattern (cancelled flag + single onExit sender)
    - loadLocalSecrets on-every-dispatch (no cache, SEC-06 freshness)
    - parseYamlToArgv string/array/object discrimination
key_files:
  created:
    - packages/xci/src/agent/runner.ts
    - packages/xci/src/__tests__/agent/runner.test.ts
    - packages/xci/src/__tests__/agent/dispatch-handler.test.ts
    - packages/server/src/__tests__/e2e/dispatch-e2e.integration.test.ts
    - .planning/phases/10-dispatch-pipeline-quota-enforcement/10-TRACEABILITY.md
  modified:
    - packages/xci/src/agent/types.ts
    - packages/xci/src/agent/state.ts
    - packages/xci/src/agent/index.ts
    - packages/server/README.md
    - packages/xci/README.md
decisions:
  - runner.ts standalone (not importing executor/single.ts) to avoid pulling ANSI/log code into agent bundle
  - cancelled flag on RunHandle set before proc.kill; single result-frame sender avoids race
  - loadLocalSecrets called on every dispatch (no cache) for SEC-06 rotation support
  - Phase 10 single-command dispatch only; sequence/parallel deferred to future phase
  - E2E test CI-deferred (Docker unavailable in dev environment)
metrics:
  duration: ~30m
  completed: "2026-04-19"
  tasks_completed: 3
  files_changed: 9
---

# Phase 10 Plan 05: Agent Dispatch Pipeline Summary

**One-liner:** Agent-side dispatch pipeline with execa subprocess spawning, SIGTERM/SIGKILL cancel, SEC-06 agent-local secrets merge, and Phase 10 closeout with traceability matrix.

## What Was Built

### runner.ts — spawnTask API

`packages/xci/src/agent/runner.ts` exports `spawnTask(runId, opts): RunHandle`.

```typescript
interface RunHandle {
  runId: string;
  cancelled: boolean;        // set before kill; checked by onExit
  cancel(): Promise<void>;   // SIGTERM → 5s grace → SIGKILL
}

interface RunnerOptions {
  argv: readonly string[];
  cwd: string;
  env: Record<string, string>;
  onChunk: (stream: 'stdout'|'stderr', data: string, seq: number) => void;
  onExit: (exitCode: number, durationMs: number, cancelled: boolean) => void;
}
```

Key design: `cancelled` flag is set on the handle BEFORE `proc.kill()` is called. The `onExit` callback then fires exactly once with `cancelled=true`. This ensures a single result-frame sender — no race between the auto-exit path and the cancel path.

Windows kill pattern copied inline from `executor/single.ts killAndWait` (not imported — avoids pulling ANSI/log code into agent bundle).

### index.ts — dispatch/cancel handlers

`handleDispatch` flow:
1. Drain check → `AGENT_DRAINING` error frame
2. Capacity check → `AGENT_AT_CAPACITY` error frame
3. `parseYamlToArgv`: string→tokenize, JSON/YAML array→direct argv, object→`AGENT_UNSUPPORTED_TASK`
4. `loadLocalSecrets(process.cwd())` — reads `.xci/secrets.yml`, returns `{}` on missing
5. Merge: `{ ...frame.params, ...localSecrets }` — agent-local wins (SEC-06)
6. Send `{type:'state', state:'running', run_id}`
7. `spawnTask()` — store in `state.runningRuns`
8. `onChunk` → `log_chunk` frames; `onExit` → `result` frame + map delete

`handleCancel` flow:
1. Look up `state.runningRuns.get(run_id)` — if missing, log + return (stale cancel)
2. `await entry.handle.cancel()` — SIGTERM/SIGKILL per runner.ts
3. Runner's `onExit` fires with `cancelled=true` → sends result frame (single sender)

Reconnect/goodbye frames now send `running_runs` from `state.runningRuns` Map (Phase 8 D-18 stub now ACTIVE).

`reconnect_ack` handler: iterates `reconciliation` array; calls `handle.cancel()` for `action==='abandon'` entries (D-24).

### state.ts — Map + maxConcurrent

```typescript
interface AgentState {
  runningRuns: Map<string, { handle: RunHandle; startedAt: string; taskSnapshot: TaskSnapshot }>;
  draining: boolean;
  maxConcurrent: number;   // from --max-concurrent flag, default 1
}
```

### types.ts — 5 new AgentFrame variants

Added: `TaskSnapshot` interface (mirroring server-side shape), plus `dispatch`, `cancel`, `state(running)`, `log_chunk`, and `result` variants to the `AgentFrame` union.

### E2E Test

`packages/server/src/__tests__/e2e/dispatch-e2e.integration.test.ts`:
- Real xci agent (dist/agent.mjs) + real Fastify server + real DB (testcontainers Postgres)
- Happy path: trigger `echo hello from xci` → poll until `state=succeeded` → assert `exit_code=0`, `duration_ms>0`
- CI-deferred: Docker not available in dev environment; `describe.runIf(isLinux && existsSync(xciDistAgent))`

## Test Results

```
packages/xci:    349 passed | 1 skipped (350 total)
  - runner.test.ts:          10 tests (1 skipped Windows path on Linux)
  - dispatch-handler.test.ts: 12 tests all green
  - All prior 327 tests still green (BC-01/BC-02)

packages/server: 127 unit tests passed
  - E2E dispatch test: CI-deferred (no Docker)
```

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Known Limitations

**Sequence/parallel task dispatch deferred:** Phase 10 supports single-command dispatch only. Multi-step dispatch (YAML with `run:` array or `parallel:` key) returns `AGENT_UNSUPPORTED_TASK` error frame. Deferred to a future phase pending Phase 11 log_chunk storage maturity for correct per-step streaming.

**E2E test CI-deferred:** Docker (testcontainers) not available in dev environment. Test is correctly gated with `describe.runIf(isLinux && existsSync(xciDistAgent))`. Will run on Linux CI with Docker.

## BC-04 Cold-Start Discipline

Agent code (`runner.ts`, updated `index.ts`) is only in `dist/agent.mjs`. The `dist/cli.mjs` bundle remains unaffected — agent module lazy-loaded via argv pre-scan + dynamic import (Phase 8 pattern preserved).

## Known Stubs

None — all dispatch/cancel/log_chunk paths are wired. Server discards `log_chunk` frames (fire-and-forget) by design — Phase 11 owns storage.

## Threat Surface Scan

No new network endpoints or auth paths. The `log_chunk` frame forwards raw subprocess stdout/stderr to the server — T-10-05-02 accepted (Phase 11 adds LOG-06 redaction before persistence). The `dispatch` frame uses `execa` with `shell:false` — T-10-05-01 mitigated (no shell injection vector).

## Self-Check: PASSED

- runner.ts: exists at `packages/xci/src/agent/runner.ts`
- state.ts: `Map<string, ...>` present, `maxConcurrent` field present
- types.ts: `TaskSnapshot` + 5 new AgentFrame variants present
- index.ts: `handleDispatch` + `handleCancel` + `--max-concurrent` flag present
- dispatch-handler.test.ts: 12 tests green
- runner.test.ts: 10 tests green (1 Windows skip)
- E2E test file: created at `packages/server/src/__tests__/e2e/dispatch-e2e.integration.test.ts`
- Commits: 9239bc9, 63d6ee9, e72abeb (all verified in git log)
