---
phase: 10-dispatch-pipeline-quota-enforcement
plan: "04"
subsystem: server/routes
tags: [rest, routes, trigger, cancel, quota, param_overrides, dispatch_resolver, pino_redaction]
one_liner: "REST routes for run trigger/list/get/cancel + usage endpoint with QUOTA-04 queue-depth gate, DISP-09 param overrides at trigger time, Pino redaction for param_overrides"
dependency_graph:
  requires: [10-01, 10-02, 10-03]
  provides: [run-trigger-api, run-cancel-api, run-list-api, run-get-api, usage-api]
  affects: [packages/server/src/routes, packages/server/src/app.ts]
tech_stack:
  added: []
  patterns:
    - forOrg-scoped repo calls from route handlers (Phase 7 discipline)
    - resolveTaskParams invoked at trigger time for DISP-09 param override resolution
    - QUOTA-04 gate: countConcurrentByOrg + dispatchQueue.countByOrg >= maxConcurrentTasks*2
    - Cancel 30s fallback: registerRunTimer(30) replaces original timer for dispatched/running runs
    - Pino redact.paths extended for param_overrides and task snapshot params
key_files:
  created:
    - packages/server/src/routes/runs/helpers.ts
    - packages/server/src/routes/runs/trigger.ts
    - packages/server/src/routes/runs/cancel.ts
    - packages/server/src/routes/runs/list.ts
    - packages/server/src/routes/runs/get.ts
    - packages/server/src/routes/runs/usage.ts
    - packages/server/src/routes/runs/index.ts
    - packages/server/src/__tests__/routes/runs-trigger.integration.test.ts
    - packages/server/src/__tests__/routes/runs-cancel.integration.test.ts
    - packages/server/src/__tests__/routes/runs-list-get.integration.test.ts
    - packages/server/src/__tests__/routes/runs-usage.integration.test.ts
  modified:
    - packages/server/src/routes/index.ts
    - packages/server/src/app.ts
decisions:
  - "Resolve params at trigger time (not dispatch tick): snapshot stores resolved YAML so secret rotation after trigger doesn't affect the run"
  - "param_overrides stored separately from task_snapshot for audit/introspection of per-run overrides"
  - "Cancel for dispatched/running: annotate cancelled_by_user_id + register 30s fallback timer (not immediate CAS) per D-25 design"
  - "Cancel for queued: immediate CAS queued→cancelled + dequeue from in-memory queue"
  - "Pino redact.paths uses remove:false (censor:'[REDACTED]') to preserve log structure while masking values"
  - "Viewer can read /runs and /usage (informational) but cannot POST trigger or cancel (T-10-04-08 accepted)"
metrics:
  duration_seconds: 738
  completed_at: "2026-04-19T13:14:55Z"
  tasks_completed: 2
  files_created: 11
  files_modified: 2
requirements_satisfied: [DISP-03, DISP-04, DISP-07, DISP-09, QUOTA-04, QUOTA-05, QUOTA-06]
---

# Phase 10 Plan 04: REST Routes for Run Trigger/List/Get/Cancel + Usage Summary

REST API surface wiring Phase 10's dispatch pipeline into public endpoints. Every manually-triggered run flows through POST /runs, and every manually-cancelled run flows through POST /runs/:runId/cancel.

## Endpoints Implemented

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/orgs/:orgId/tasks/:taskId/runs | Owner/Member + CSRF | Trigger run; body: {param_overrides?, timeout_seconds?} |
| GET | /api/orgs/:orgId/runs | Any member | List runs; ?state=&taskId=&limit=&since= cursor pagination |
| GET | /api/orgs/:orgId/runs/:runId | Any member | Get full run row (minus paramOverrides) |
| POST | /api/orgs/:orgId/runs/:runId/cancel | Owner or triggerer + CSRF | Cancel run; idempotent on terminal states |
| GET | /api/orgs/:orgId/usage | Any member | {agents:{used,max}, concurrent:{used,max}, retention_days} |

## QUOTA-04 Threshold Formula

```
max_queue_threshold = orgPlan.maxConcurrentTasks * 2
if countConcurrentByOrg(orgId) + dispatchQueue.countByOrg(orgId) >= max_queue_threshold:
    throw RunQuotaExceededError({ used, max: threshold, planName })
```

This is the "reject at intake" gate from D-07, separate from the dispatcher's per-agent concurrency filter. Prevents unbounded queue growth under label-mismatch scenarios.

Reference tests: runs-trigger.integration.test.ts Test 10.

## Cancel Flow State Transitions

**Queued run cancel:**
- CAS `queued → cancelled` immediately (no agent involved yet)
- `fastify.dispatchQueue.dequeue(runId)` removes from in-memory queue
- `cancelled_by_user_id` set

**Dispatched/running run cancel:**
1. Set `cancelled_by_user_id` (non-state mutation, intent annotation)
2. `cancelRunTimer(runId)` — clears existing timeout timer
3. Send `{type:'cancel', run_id, reason:'manual'}` to agent WS (if connected)
4. `registerRunTimer(fastify, runId, orgId, 30)` — 30s fallback that CAS-transitions `(dispatched|running) → cancelled` if agent doesn't respond
5. Agent sends `{type:'result', cancelled:true}` which goes through `handleResultFrame` — normal CAS path wins, 30s fallback timer gets cancelled

**Idempotent cancel (D-26):** Already-terminal run → 200 `{state, message:'already terminal'}`, no DB change.

**Authz (D-25):** Owner always allowed. Member iff `run.triggeredByUserId === req.user.id`. Viewer always rejected.

## Pino Redaction Paths Added (app.ts)

```
'req.body.param_overrides'        // whole object safety net
'req.body.param_overrides.*'      // individual key values
'*.taskSnapshot.params'           // dispatch queue entry params
'*.params'                        // catch-all for dispatch contexts
'*.paramOverrides'                // camelCase variant
```

Combined with existing Phase 9 paths (`*.token`, `*.credential`, `*.ciphertext`, etc.) to prevent any plaintext secret appearing in Pino log output. `remove: false` means values become `[REDACTED]` (not deleted), preserving log structure for debugging.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] DEK fetch was unused in trigger handler**
- **Found during:** Task 1 implementation
- **Issue:** `repos.admin.getOrgDek()` was called but returned value unused — `secrets.resolveByName()` handles DEK internally
- **Fix:** Removed the unused `dek` variable; `resolveByName` is self-contained
- **Files modified:** packages/server/src/routes/runs/trigger.ts

### Integration Tests (Docker-deferred)

Integration tests (runs-trigger, runs-cancel, runs-list-get, runs-usage) are written and included but cannot run in this environment as testcontainers requires Docker. Unit tests (127) and xci tests (328) all pass.

Test files created cover all 18+ behaviors specified in the plan including:
- DISP-09 param override resolution and task source unchanged
- QUOTA-04 rejection at 2x max concurrent
- Secret resolution at trigger time
- Pino redaction verification
- Cancel idempotency (D-26)
- Member cross-cancel rejection (T-10-04-04)
- Cross-org 404 isolation

## Self-Check

### Files exist
- packages/server/src/routes/runs/trigger.ts: FOUND
- packages/server/src/routes/runs/cancel.ts: FOUND
- packages/server/src/routes/runs/list.ts: FOUND
- packages/server/src/routes/runs/get.ts: FOUND
- packages/server/src/routes/runs/usage.ts: FOUND
- packages/server/src/routes/runs/index.ts: FOUND
- packages/server/src/routes/runs/helpers.ts: FOUND

### Commits exist
- 55952c2: feat(10-04): trigger + cancel run routes
- 3b1cf9f: feat(10-04): list/get/usage endpoints + Pino redaction

### TypeScript: CLEAN (tsc --noEmit)
### Biome: CLEAN (0 errors, 0 warnings)
### Unit tests: 127/127 PASS
### xci BC-01/BC-02: 328/328 PASS

## Self-Check: PASSED

## Handoff Note

Plan 10-05 wires agent-side handlers:
- Handle incoming `dispatch` frame: parse, set up env, spawn task via v1 executor
- Stream `log_chunk` frames during execution (wire format reserved in Phase 10)
- Send `result` frame on completion (exit_code, duration_ms)
- Handle incoming `cancel` frame: SIGTERM + SIGKILL subprocess, send result with cancelled:true
- Merge agent-local `.xci/secrets.yml` into dispatched params (SEC-06: agent-local wins)
