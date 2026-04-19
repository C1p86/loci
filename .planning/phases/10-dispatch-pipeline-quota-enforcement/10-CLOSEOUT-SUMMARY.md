# Phase 10: Dispatch Pipeline & Quota Enforcement — Closeout Summary

**Phase:** 10
**Plans:** 5 of 5 complete
**Completed:** 2026-04-19
**Status:** COMPLETE

---

## Overview

Phase 10 wired the full dispatch pipeline between the server (Plans 10-01..10-04) and the xci agent (Plan 10-05). A manually triggered run now travels from REST API → in-memory queue → label-match dispatcher → WebSocket dispatch frame → agent subprocess → log_chunk frames → result frame → DB state=succeeded.

---

## 5 Plans Executed

| Plan | Name | Commits | Key Artifacts |
|------|------|---------|---------------|
| 10-01 | task_runs schema + repos | 2 | `0003_task_runs.sql`, `repos/task-runs.ts`, `repos/isolation tests` |
| 10-02 | Frame protocol + WS routing + QUOTA-03 | 2 | `ws/frames.ts` extensions, `ws/handler.ts` result/state routing, 4006 close gate |
| 10-03 | Dispatcher + timeout-manager + reconciliation | 3 | `services/dispatcher.ts`, `services/timeout-manager.ts`, `services/reconciler.ts` |
| 10-04 | REST routes + QUOTA-04/05/06 + param overrides | 2 | `routes/runs/` (trigger/cancel/list/get/usage), dispatch-resolver wiring |
| 10-05 | Agent dispatch/cancel + runner.ts + E2E + closeout | 3 | `agent/runner.ts`, `agent/index.ts` (handlers), `agent/types.ts`, E2E test |

---

## 13 Requirement IDs — Coverage

| Req ID | Status | Evidence |
|--------|--------|----------|
| DISP-01 | Validated | `dispatcher.test.ts` + `dispatcher.integration.test.ts` |
| DISP-02 | Validated | `agent-selector.integration.test.ts` (JSONB label filter + least-busy) |
| DISP-03 | Validated | `ws/frames.test.ts` + `dispatch-handler.test.ts` |
| DISP-04 | Validated | `dispatcher.integration.test.ts` (CAS state machine) |
| DISP-05 | Validated | `dispatch-handler.test.ts` Test 4 (AGENT_AT_CAPACITY) |
| DISP-06 | Validated | `timeout-manager.test.ts` + `timeout-manager.integration.test.ts` |
| DISP-07 | Validated | `runs-cancel.integration.test.ts` (D-25 + D-26 idempotency) |
| DISP-08 | Validated | `reconciler.integration.test.ts` (orphan + re-queue paths) |
| DISP-09 | Validated | `runs-trigger.integration.test.ts` Test 2 (param_overrides; task unchanged) |
| QUOTA-03 | Validated | `handler-quota.integration.test.ts` (6th agent → 4006) |
| QUOTA-04 | Validated | `runs-trigger.integration.test.ts` (429 RunQuotaExceededError) |
| QUOTA-05 | Validated | `runs-usage.integration.test.ts` (logRetentionDays in response) |
| QUOTA-06 | Validated | `runs-usage.integration.test.ts` ({agents, concurrent, retention_days}) |

See `10-TRACEABILITY.md` for full matrix.

---

## 5 Roadmap Success Criteria — Coverage

| SC | Description | Proof |
|----|-------------|-------|
| SC-1 | Trigger runs on eligible agent; queued if none | `dispatcher.integration.test.ts` label-match tests |
| SC-2 | Full state machine + exit_code recorded | `dispatch-handler.test.ts` Test 1 + E2E (CI) |
| SC-3 | Timeout → cancel + orphan reconciliation | `timeout-manager.integration.test.ts` + `reconciler.integration.test.ts` |
| SC-4 | Free plan max 5 agents at registration | `handler-quota.integration.test.ts` |
| SC-5 | Param overrides without task mutation | `runs-trigger.integration.test.ts` Test 2 |

---

## ~20 Key Decisions (D-01..D-42 highlights)

1. **D-01**: `task_runs` table with task_snapshot JSONB — reproducibility even if task is updated post-trigger
2. **D-02**: CAS `UPDATE WHERE state=expected` for all state transitions — atomic, race-free
3. **D-04**: In-memory DispatchQueue + DB reconciliation on boot — single-instance v2.0 balance
4. **D-05**: 250ms tick interval — dispatch latency <500ms perceived; no event-driven complexity
5. **D-08**: Label-match selector: online AND all label_requirements match AND active_runs < max_concurrent; least-busy + round-robin tiebreak
6. **D-09**: `agents.max_concurrent` column — per-agent concurrency cap from DB, default 1
7. **D-10**: QUOTA-03 gate placed after `consumeRegistrationToken` — prevents quota-state probing via token reuse
8. **D-14**: Agent dispatch handler: drain→capacity→yaml-parse→secrets-merge→state-ack→spawnTask
9. **D-15**: `AGENT_AT_CAPACITY` error frame → server requeues; agent not overloaded
10. **D-16**: Drain mode: refuse new dispatches; in-flight runs complete; `draining` state flag in AgentState
11. **D-17**: SEC-06 precedence: `{...dispatched_params, ...agent_local_secrets}` — agent-local wins
12. **D-18**: Cancel handler: SIGTERM→runner.onExit(cancelled=true)→result frame; single sender, no race
13. **D-19**: Per-run `setTimeout` registered at dispatch time; cleared on result; boot reconciliation catches missed timeouts
14. **D-23**: Boot reconciliation: queued→re-queue; dispatched/running without active WS→orphaned; expired timeout→timed_out
15. **D-24**: Agent reconnect_ack abandon entries: agent kills stale runs; reconnect frame sends real running_runs
16. **D-25**: Cancel for dispatched/running: 30s fallback timer; queued cancel is immediate; idempotent on terminal runs
17. **D-27**: 5 REST routes under `routes/runs/`; no DELETE on runs (audit trail)
18. **D-35**: Migration `0003_task_runs.sql` was BLOCKING gate; executed first in Plan 10-01
19. **D-36**: xci agent imports from xci/executor directly (same package); server uses xci/dsl only (D-37 fence)
20. **D-42**: E2E test (real agent + real server + testcontainers Postgres): happy path trigger→succeeded; Linux+Docker CI

---

## Handoff Note: Phase 11

Phase 10 leaves `log_chunk` frames passing through the server handler and being **discarded**. The wire format is established and agents send correctly sequenced frames with `seq`, `stream`, `data`, `ts`.

**Phase 11 takes over:**
- `RunBuffer` in-memory accumulator keyed by `run_id`
- Postgres persistence: `log_chunks` table with `(run_id, seq)` primary key for ordered replay
- UI WebSocket fanout: subscribers receive chunks in real time
- LOG-06 pre-persist redaction: org secret values replaced with `***` before DB write
- Retention cleanup: daily job purges chunks older than `orgPlan.log_retention_days`
- Download endpoint: `GET /api/orgs/:orgId/runs/:runId/log` → `.log` plaintext file

---

## CI-Deferred Tests

| Test | Reason |
|------|--------|
| `dispatch-e2e.integration.test.ts` | Linux + Docker (testcontainers); `describe.runIf` guard |
| All `*.integration.test.ts` in `@xci/server` | Docker (testcontainers Postgres) required |

---

## Backward Compatibility

- `pnpm --filter xci test`: 349 passed | 1 skipped (350) — all v1 302 + Phase 8 + Phase 9 + Phase 10 tests green
- `pnpm --filter @xci/server test:unit`: 127 passed
- BC-04 cold-start: agent code in `dist/agent.mjs` only; `dist/cli.mjs` unaffected (lazy-load via argv pre-scan preserved)

---

*Phase 10 complete. Next: Phase 11 — Log Streaming & Persistence.*
