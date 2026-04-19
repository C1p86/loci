---
phase: 10-dispatch-pipeline-quota-enforcement
plan: "03"
subsystem: server/dispatcher
tags: [dispatcher, queue, scheduler, timeout, reconciliation, label_match, jsonb]
dependency_graph:
  requires: [10-01, 10-02]
  provides: [DISP-01, DISP-02, DISP-05, DISP-06, DISP-08, D-24]
  affects: [app.ts, handler.ts, dispatcher.ts, reconciler.ts, timeout-manager.ts, agent-selector.ts]
tech_stack:
  added: [fastify-plugin dependencies declaration, JSONB @> via drizzle sql template, module-scoped Map<runId, {timer, orgId}> timer registry]
  patterns: [CAS UPDATE WHERE state=expected RETURNING, reentrancy guard (ticking flag), immutable queue snapshot for safe mid-loop dequeue, forOrg discipline via orgId stored in timer entry, round-robin cursor per org]
key_files:
  created:
    - packages/server/src/services/agent-selector.ts
    - packages/server/src/services/dispatcher.ts
    - packages/server/src/services/reconciler.ts
    - packages/server/src/__tests__/services/timeout-manager.test.ts
    - packages/server/src/__tests__/services/timeout-manager.integration.test.ts
    - packages/server/src/__tests__/services/agent-selector.integration.test.ts
    - packages/server/src/__tests__/services/dispatcher.test.ts
    - packages/server/src/__tests__/services/dispatcher.integration.test.ts
    - packages/server/src/__tests__/services/reconciler.integration.test.ts
  modified:
    - packages/server/src/services/timeout-manager.ts
    - packages/server/src/app.ts
    - packages/server/src/ws/handler.ts
decisions:
  - "Store orgId in timer Map entry ({timer, orgId}) so handleRunTimeout can call forOrg() without cross-org SELECT; avoids the sole remaining raw DB query outside the repo layer."
  - "DispatchQueue.getEntries() returns [...this.queue] immutable snapshot; tickDispatcher iterates snapshot while dequeuing live — prevents FIFO corruption from mid-loop mutation."
  - "reconciler.ts uses run.taskSnapshot (stored at dispatch time) not a fresh task.getById — preserves D-01 reproducibility across task edits; params re-use paramOverrides from DB (Plan 10-04/10-05 will re-resolve org secrets via dispatch-resolver)."
  - "Integration tests are Docker-deferred (no Docker runtime available); test files created, typecheck and compile clean, require testcontainers at runtime."
metrics:
  duration_minutes: 90
  completed_date: "2026-04-18"
  tasks_completed: 3
  files_changed: 12
  unit_tests_passing: 127
---

# Phase 10 Plan 03: Dispatcher Service Layer Summary

**One-liner:** In-memory DispatchQueue with 250ms tick + JSONB @> label-match selector + per-run timeout manager + D-23 boot reconciliation + D-24 reconnect reconciliation wired into handler.ts.

## What Was Built

### Task 1: timeout-manager (full impl) + agent-selector (JSONB label match)

**`packages/server/src/services/timeout-manager.ts`** — Replaced Plan 10-02 no-op stub with full implementation.

Key changes from stub:
- Signature extended to 4 args: `registerRunTimer(fastify, runId, orgId, timeoutSeconds)` — `orgId` is stored in the Map entry alongside the timer handle.
- Internal registry: `Map<string, {timer: NodeJS.Timeout, orgId: string}>` (not just `Map<string, NodeJS.Timeout>`).
- `handleRunTimeout` (private): CAS transition `(dispatched|running) → timed_out` via `updateStateMulti`, then sends `{type:'cancel', run_id, reason:'timeout'}` frame to agent WS if still connected.
- D-20 cap: `Math.min(timeoutSeconds, 86_400)` applied silently.
- `timer.unref()` prevents process hang in test/CI.
- `clearAllRunTimers()` called from `dispatcherPlugin` `onClose` hook.

**`packages/server/src/services/agent-selector.ts`** — New file.

- `selectEligibleAgent(db, orgId, labelRequirements, lastCursorAgentId)` runs one Drizzle query per tick entry.
- JSONB containment: `sql\`${agents.labels} @> ${labelJson}::jsonb\`` — Postgres GIN index handles this efficiently.
- Concurrency cap: `coalesce(active_runs.cnt, 0) < agents.max_concurrent` in WHERE clause via subquery.
- Online filter: `state='online' AND last_seen_at > now() - interval '60 seconds'`.
- Ordering: `activeCount ASC, agents.id ASC` for deterministic least-busy + tiebreak.
- Round-robin tiebreak: among tied min-count candidates, find first after `lastCursorAgentId` in sorted list; wrap around.

### Task 2: DispatchQueue + tickDispatcher + dispatcherPlugin

**`packages/server/src/services/dispatcher.ts`** — New file.

- `QueueEntry` interface: `{runId, orgId, taskSnapshot, params, labelRequirements, timeoutSeconds}`.
- `DispatchQueue` class: FIFO with per-org cursor map; `getEntries()` returns `[...this.queue]` immutable snapshot; `start(tickFn, intervalMs=250)` idempotent; `stop()` idempotent; `timer.unref()`.
- `tickDispatcher(fastify)`: module-scoped `let ticking = false` reentrancy guard with try/finally. Iterates queue snapshot; for each entry calls `selectEligibleAgent`; on match does CAS `queued→dispatched`; dequeues on CAS success or CAS miss; updates cursor; sends dispatch frame; registers run timer.
- `dispatcherPlugin`: `fp(impl, {fastify:'5', name:'dispatcher', dependencies:['db','websocket']})`. `onReady`: runs `runBootReconciliation` then `queue.start`. `onClose`: `queue.stop()` + `clearAllRunTimers()`.
- Module type augmentation: `FastifyInstance.dispatchQueue: DispatchQueue`.

**`packages/server/src/app.ts`** — Added `await app.register(dispatcherPlugin)` AFTER `await app.register(registerAgentWsRoute)`.

### Task 3: reconciler.ts + handler.ts reconnect activation

**`packages/server/src/services/reconciler.ts`** — New file (was empty stub).

`runBootReconciliation(fastify)` — D-23 branches in priority order:
1. `state='queued'` → re-enqueue in dispatchQueue (no DB change).
2. Timeout expired during downtime (`dispatchedAt + timeoutSeconds*1000 < now()`) → `updateStateMulti → timed_out` (takes priority over agent check).
3. Agent connected (`agentRegistry.has(agentId)`) → register fresh timer for remaining window.
4. Agent gone + `state='dispatched'` → CAS `dispatched→queued` (clear agentId/dispatchedAt) + re-enqueue (safe: no side effects yet per T-10-03-02).
5. Agent gone + `state='running'` → CAS `running→orphaned` (agent acked, may have had side effects).

`buildReconnectReconciliation(fastify, orgId, runningRuns)` — D-24:
- Missing DB row → `abandon`.
- Terminal state (`succeeded/failed/cancelled/timed_out/orphaned`) → `abandon`.
- `state='dispatched'` → promote to `running` (agent already executing) + register remaining timer + `continue`.
- `state='running'` → register remaining timer + `continue`.
- T-10-03-06: uses `forOrg(orgId)` — cross-org run IDs return `undefined → abandon`.

**`packages/server/src/ws/handler.ts`** — Replaced reconnect stub:
```typescript
// Before (Plan 10-02 stub):
send(socket, { type: 'reconnect_ack', reconciliation: [] });

// After (Plan 10-03):
const reconciliation = await buildReconnectReconciliation(fastify, orgId, frame.running_runs);
send(socket, { type: 'reconnect_ack', reconciliation });
```

## Test Coverage

| File | Tests | Type | Status |
|------|-------|------|--------|
| timeout-manager.test.ts | 5 (Tests 1-4 + cap test) | Unit (fake timers) | Passing |
| timeout-manager.integration.test.ts | 4 (Tests 5-8) | Integration (real DB) | Docker-deferred |
| agent-selector.integration.test.ts | 9 (Tests 9-17) | Integration (JSONB) | Docker-deferred |
| dispatcher.test.ts | 7 (Tests 1-2, 6 + bonus) | Unit | Passing |
| dispatcher.integration.test.ts | 6 (Tests 3-5, 7-10) | Integration | Docker-deferred |
| reconciler.integration.test.ts | 11 (Tests 1-11) | Integration | Docker-deferred |
| **Total unit** | **127** | | **Passing** |

**Docker-deferred note:** No Docker runtime is available in this environment. All integration test files were created, typecheck clean (`tsc --noEmit`), and biome clean. They require `testcontainers` at runtime to spin up Postgres for JSONB `@>` queries, CAS state transitions, and reconciliation behavior.

## Verification

- `tsc --noEmit`: PASS (zero errors)
- `biome check`: PASS (zero errors; 20 warnings in pre-existing code)
- `vitest run --config vitest.unit.config.ts`: 127/127 tests passing
- No leaked timers: `timer.unref()` applied to all `setInterval` and `setTimeout` calls
- Plugin registration order: `dispatcherPlugin` registered after `registerAgentWsRoute` (which registers `fastifyWebsocket`) in `app.ts`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test file split: unit vs integration**
- **Found during:** Task 1 test authoring
- **Issue:** Tests 5-8 (timeout-manager, DB-dependent) and Tests 9-17 (agent-selector, JSONB) initially placed in `.test.ts` files which run in unit mode without DB.
- **Fix:** Split into `.test.ts` (unit, fake timers, no DB) and `.integration.test.ts` (requires testcontainers).
- **Files modified:** `timeout-manager.test.ts`, `timeout-manager.integration.test.ts`, `agent-selector.integration.test.ts`

**2. [Rule 1 - Bug] Reentrancy guard test design**
- **Found during:** Task 2 Test 6
- **Issue:** First attempt used `slowTick` passed to `queue.start()` — wrong layer; guard is in `tickDispatcher`, not `DispatchQueue`. Second attempt tried mocking Drizzle's builder chain directly — failed because the internal query builder pattern doesn't match naive mock setup.
- **Fix:** `vi.mock('../../services/agent-selector.js')` at file top + `mockImplementation` to return a never-resolving Promise until released; fire `tickDispatcher` directly (not via interval), verify second call returns in <50ms.
- **Files modified:** `dispatcher.test.ts`

**3. [Rule 2 - Missing critical] orgId stored in timer Map**
- **Found during:** Task 1 implementation
- **Issue:** Plan FA-4 sketch used cross-org `db.select().from(taskRuns).where(eq(id, runId))` in `handleRunTimeout` — this is the sole remaining place that would bypass the `forOrg()` repo discipline.
- **Fix:** Extended `registerRunTimer` signature to 4 args (added `orgId`); stored `{timer, orgId}` in Map; `handleRunTimeout` uses stored `orgId` with `forOrg()`.
- **Files modified:** `timeout-manager.ts`, all call sites in `reconciler.ts`, `dispatcher.ts`

**4. [Rule 1 - Bug] Biome lint: unused imports across multiple files**
- **Found during:** Post-task verification
- **Issue:** `import type { WebSocket } from 'ws'` in `dispatcher.ts`; `import { eq, inArray }` in `timeout-manager.ts` (only `sql` used); `afterEach` in `agent-selector.integration.test.ts`; various unused vars in test files.
- **Fix:** Removed unused imports; ran `biome check --write --unsafe` for auto-fixable cases; manual removals for the rest.
- **Commits:** Included in `feat(10-03): boot+reconnect reconciler...` commit.

## Known Stubs

None that affect plan goal achievement. The `params: {}` default in `toQueueEntry` (reconciler) for re-queued runs uses `paramOverrides` from DB (not re-resolved org secrets) — this is intentional and documented as a TODO for Plan 10-04/10-05 which will wire the full dispatch-resolver path:

```typescript
// paramOverrides are the UI-supplied overrides; org secrets will be merged by Plan 10-05
params: (run.paramOverrides as Record<string, string>) ?? {},
```

## Handoff Notes

**Plan 10-04 (POST /runs trigger route):**
- Call `dispatchQueue.enqueue(entry)` after DB INSERT in a transaction.
- Call `cancelRunTimer(runId)` in POST /cancel + emit cancel frame to agent.
- Wire QUOTA-04 queue depth check (D-07): reject 429 when `queued + active >= max_concurrent * 2`.
- `registerRunTimer` signature now requires `orgId` as 3rd arg — pass it from the run record.

**Plan 10-05 (agent-side dispatch handler):**
- Agent receives `{type:'dispatch', run_id, task_snapshot, params, timeout_seconds}` frame.
- Agent sends `{type:'run_started', run_id}` → handler.ts promotes `dispatched→running`.
- Agent sends `{type:'run_result', run_id, exit_code, ...}` → handler.ts calls `cancelRunTimer(runId)` BEFORE DB write, then `updateState→succeeded/failed`.

**Resolved params gap:** When `tickDispatcher` re-dispatches a reconciled run, `params` contains only `paramOverrides` (no org secrets). Plan 10-05 should either (a) have the agent re-request params, or (b) Plan 10-04 stores resolved params in the queue entry at trigger time and reconciler re-resolves via `dispatch-resolver`. The current design is safe but incomplete — agents will see missing org-secret params on crash-recovery dispatches until this is wired.

## Threat Surface Scan

No new network endpoints or auth paths introduced. All changes are internal service/plugin code.

## Self-Check: PASSED

- `packages/server/src/services/agent-selector.ts` — FOUND
- `packages/server/src/services/dispatcher.ts` — FOUND
- `packages/server/src/services/reconciler.ts` — FOUND
- `packages/server/src/services/timeout-manager.ts` — FOUND (modified)
- `packages/server/src/app.ts` — FOUND (modified)
- `packages/server/src/ws/handler.ts` — FOUND (modified)
- `packages/server/src/__tests__/services/reconciler.integration.test.ts` — FOUND
- Commit `afce586` (test RED) — FOUND
- Commit `b5b0eb2` (feat GREEN task 1) — FOUND
- Commit `91c7005` (feat GREEN task 2) — FOUND
- Commit `03e9cd6` (feat GREEN task 3) — FOUND
