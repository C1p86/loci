---
phase: 10-dispatch-pipeline-quota-enforcement
plan: "02"
subsystem: websocket-protocol
tags: [websocket, frames, quota, agent_protocol, state_machine, spoofing_guard]
dependency_graph:
  requires: [10-01]
  provides: [10-03, 10-04]
  affects: [packages/server/src/ws/, packages/server/src/services/timeout-manager.ts]
tech_stack:
  added: []
  patterns:
    - "verifyBelongsToOrg guard on all run-keyed WS frames (T-10-02-01 / Pitfall 5)"
    - "Pitfall 7 fix: recordHeartbeat skipped for log_chunk frames"
    - "QUOTA-03: after-consume WS handshake quota gate (close code 4006)"
    - "CAS state transitions via updateState/updateStateMulti (FA-1 discipline)"
    - "timeout-manager.ts stub pattern: no-op exports replaced by Plan 10-03"
key_files:
  created:
    - packages/server/src/ws/types.ts (TaskSnapshot interface + extended unions)
    - packages/server/src/services/timeout-manager.ts (stub for Plan 10-03)
    - packages/server/src/__tests__/ws/frames.test.ts (27 unit tests)
    - packages/server/src/__tests__/ws/handler-quota.integration.test.ts (6 integration tests)
    - packages/server/src/__tests__/ws/handler-frames.integration.test.ts (9 integration tests)
  modified:
    - packages/server/src/ws/types.ts
    - packages/server/src/ws/frames.ts
    - packages/server/src/ws/handler.ts
decisions:
  - "QUOTA-03 gate placed AFTER consumeRegistrationToken (security: prevents quota-state probing via token reuse)"
  - "log_chunk recordHeartbeat skip: Pitfall 7 — prevents DB thrash on verbose task streams"
  - "timeout-manager.ts stub: allows handler.ts import without Plan 10-03 timer logic"
  - "dispatch/cancel still rejected as incoming frames with 'server-to-agent only' message"
  - "goodbye now parses real running_runs (Phase 8 stub [] replaced)"
metrics:
  duration: 866s
  completed: "2026-04-19"
  tasks_completed: 3
  files_modified: 7
  files_created: 5
---

# Phase 10 Plan 02: Frame Protocol Extensions + QUOTA-03 Registration Gate Summary

**One-liner:** WebSocket frame protocol extended with state/result/log_chunk parsers, QUOTA-03 6th-agent gate (close code 4006), and cross-tenant frame-spoofing guard via verifyBelongsToOrg.

## What Was Built

### Task 1: Frame type unions + parseAgentFrame implementations

**`packages/server/src/ws/types.ts`** — Extended discriminated unions:
- Added `TaskSnapshot` interface (5 fields: task_id, name, description, yaml_definition, label_requirements)
- Added to `AgentIncomingFrame`: `state` (run_id + state:'running'), `result`, `log_chunk`
- Added to `ServerOutgoingFrame`: `dispatch`, `cancel` (server-to-agent only)
- Removed Phase 8 reserved-frame comment block — no longer reserved

**`packages/server/src/ws/frames.ts`** — parseAgentFrame extended:
- Replaced Phase 8 THROW for `state`/`result`/`log_chunk` with real parser cases
- `dispatch`/`cancel` still throw with "server-to-agent only" message
- `goodbye` now parses real running_runs array (Phase 8 `return { running_runs: [] }` stub replaced)
- Extracted `parseRunStateArray` helper shared between `reconnect` and `goodbye`
- Result `cancelled` field uses conditional set to satisfy `exactOptionalPropertyTypes`

**27 unit tests green** (frames.test.ts — covers all 11 plan behaviors + Phase 8 regression).

### Task 2: Handler register-branch quota gate (QUOTA-03)

**`packages/server/src/ws/handler.ts`** — QUOTA-03 gate inserted:
- After `consumeRegistrationToken`, before `registerNewAgent`
- Parallel `Promise.all([repos.forOrg(orgId).plan.get(), repos.admin.countAgentsByOrg(orgId)])`
- If `agentCount >= orgPlan.maxAgents`: send `AGENT_QUOTA_EXCEEDED` error frame, close 4006
- Message includes count, max, and planName for QUOTA-06 UX
- Added WS close code registry comment (4001–4006)

**handler-quota.integration.test.ts** (6 tests, requires Docker).

### Task 3: Authenticated-frame routing + frame-spoofing guard

**`packages/server/src/services/timeout-manager.ts`** — Plan 10-02 stub:
- Exports `registerRunTimer`, `cancelRunTimer`, `clearAllRunTimers` as no-ops
- Plan 10-03 replaces with real `Map<runId, NodeJS.Timeout>` implementation

**`packages/server/src/ws/handler.ts`** — Frame routing added:
- `handleStateAck`: CAS `dispatched → running`, sets `startedAt = sql\`now()\``
- `handleResultFrame`: `cancelRunTimer` first (Pitfall 1), then CAS to `succeeded/failed/cancelled`
- `handleLogChunkFrame`: spoofing guard only, discard payload (Phase 11 adds storage)
- `verifyRunOwnership` helper: `taskRuns.verifyBelongsToOrg(run_id)` — 3 call sites
- Pitfall 7 fix: `recordHeartbeat` skipped when `frame.type === 'log_chunk'`

**handler-frames.integration.test.ts** (9 tests, requires Docker).

## Frame Union Diff

| Union | Before (Phase 8) | Added in Plan 10-02 |
|-------|-----------------|---------------------|
| AgentIncomingFrame | register, reconnect, goodbye | state(run_id), result, log_chunk |
| ServerOutgoingFrame | register_ack, reconnect_ack, state(admin), error | dispatch, cancel |

## verifyBelongsToOrg Call Sites in handler.ts

1. `handleStateAck` — before CAS dispatched→running
2. `handleResultFrame` — after cancelRunTimer, before CAS to terminal state
3. `handleLogChunkFrame` — before discarding payload

## timeout-manager.ts Stub Note (Plan 10-03 TODO)

The file at `packages/server/src/services/timeout-manager.ts` is a stub. Plan 10-03 replaces it with:
- `Map<runId, NodeJS.Timeout>` timer store
- Real `registerRunTimer` with `.unref()` (prevents process hang in tests — Pitfall 8)
- Real `cancelRunTimer` with clearTimeout + map.delete
- Real `clearAllRunTimers` for app.close hook (leak prevention)
- `handleRunTimeout`: CAS to timed_out + send cancel frame to agent

## Handoff Note for Plan 10-03

Plan 10-03 will:
1. **Replace timeout-manager.ts stub** with full implementation (FA-4 pattern)
2. **Activate reconnect_ack reconciliation** (Phase 8 empty-array stub → real D-24 logic)
   - Requires timeout-manager to register remaining timer for reconnected agents
3. **Add dispatcher service** (DispatchQueue + tickDispatcher + dispatcherPlugin)
4. **Wire app.close hook** for `clearAllRunTimers()` (Pitfall 8 prevention)

## Deviations from Plan

### Auto-detected Issues

**1. [Rule 1 - Bug] TypeScript exactOptionalPropertyTypes on result.cancelled**
- **Found during:** Task 1 GREEN phase (`tsc --noEmit`)
- **Issue:** `cancelled: boolean | undefined` not assignable to `cancelled?: boolean` with exactOptionalPropertyTypes=true
- **Fix:** Conditional property set: `if (o.cancelled === true) result.cancelled = true`
- **Files modified:** packages/server/src/ws/frames.ts
- **Commit:** 88046cf

**2. [Rule 3 - Blocking] Biome useLiteralKeys auto-fixable warnings**
- **Found during:** Post-task lint check
- **Issue:** 3 lint errors (auto-fixable) from bracket notation on non-computed keys
- **Fix:** `npx @biomejs/biome check --write` auto-fixed frames.ts and handler.ts
- **Files modified:** packages/server/src/ws/frames.ts, packages/server/src/ws/handler.ts
- **Commit:** ffe190e

### Integration Tests — Docker Not Available

All 3 plans' integration tests (handler-quota.integration.test.ts: 6 tests, handler-frames.integration.test.ts: 9 tests) require testcontainers Docker runtime. This environment does not have a container runtime available. The tests compile cleanly (TypeScript) and follow the exact same harness pattern as Phase 8 ws-handshake.integration.test.ts which is known-working.

**Quality gate achieved via:**
- TypeScript typecheck (tsc --noEmit): clean
- Biome lint: clean (0 errors)
- Unit tests: 115/115 green (including 27 new frames.test.ts tests)
- xci v1 BC-01/BC-02: 328/328 green

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `registerRunTimer` no-op | services/timeout-manager.ts | Plan 10-03 implements real timer; stub allows handler.ts import without Plan 10-03 |
| `cancelRunTimer` no-op | services/timeout-manager.ts | Same — called in handleResultFrame but currently no-op |
| `clearAllRunTimers` no-op | services/timeout-manager.ts | Same — app.close hook wired in Plan 10-03 |
| `reconnect_ack reconciliation: []` | ws/handler.ts | D-24 real reconciliation requires timeout-manager; Plan 10-03 activates |

These stubs do not prevent Plan 10-02's goal (QUOTA-03 gate + frame routing). Plan 10-03 replaces them.

## Self-Check: PASSED
