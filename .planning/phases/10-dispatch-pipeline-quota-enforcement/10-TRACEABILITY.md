# Phase 10: Dispatch Pipeline & Quota Enforcement — Traceability Matrix

**Phase:** 10-dispatch-pipeline-quota-enforcement
**Plans:** 10-01 through 10-05
**Completed:** 2026-04-19

---

## Requirement IDs → Plans → Test Files

| Req ID | Description | Plan | Primary Test File(s) | Notes |
|--------|-------------|------|----------------------|-------|
| DISP-01 | In-memory dispatch queue on server | 10-01 | `packages/server/src/__tests__/services/dispatcher.test.ts`<br>`packages/server/src/__tests__/services/dispatcher.integration.test.ts` | DispatchQueue FIFO + setInterval tick |
| DISP-02 | Label-match selector: online + label match + least-busy + round-robin | 10-01 | `packages/server/src/__tests__/services/agent-selector.integration.test.ts` | SQL JSONB filter + COUNT subquery |
| DISP-03 | `dispatch` frame to agent with run_id, task snapshot, params, timeout | 10-01, 10-05 | `packages/server/src/__tests__/ws/frames.test.ts`<br>`packages/xci/src/__tests__/agent/dispatch-handler.test.ts` | Frame schema + agent acceptance |
| DISP-04 | TaskRun persisted with full state machine | 10-01 | `packages/server/src/__tests__/services/dispatcher.integration.test.ts`<br>`packages/server/src/__tests__/routes/runs-list-get.integration.test.ts` | CAS UPDATE WHERE state=expected |
| DISP-05 | Per-agent concurrency default 1; per-org plan limit | 10-01, 10-05 | `packages/server/src/__tests__/services/dispatcher.integration.test.ts`<br>`packages/xci/src/__tests__/agent/dispatch-handler.test.ts` | agents.max_concurrent column + AGENT_AT_CAPACITY |
| DISP-06 | Timeout default 1h; expired → cancel frame + timed_out | 10-03 | `packages/server/src/__tests__/services/timeout-manager.test.ts`<br>`packages/server/src/__tests__/services/timeout-manager.integration.test.ts` | setTimeout per run; boot reconciliation |
| DISP-07 | Manual cancel via REST → cancel frame → cancelled state | 10-04 | `packages/server/src/__tests__/routes/runs-cancel.integration.test.ts` | D-25 idempotency included |
| DISP-08 | Boot reconciliation: queued/dispatched without agent → re-queue or orphaned | 10-03 | `packages/server/src/__tests__/services/reconciler.integration.test.ts` | app.ready() hook; orphaned + re-queue paths |
| DISP-09 | Run with param overrides — no task mutation | 10-04 | `packages/server/src/__tests__/routes/runs-trigger.integration.test.ts` (Test 2) | dispatch-resolver.ts; task row unchanged |
| QUOTA-03 | Registration enforcement: max_agents at WS handshake | 10-02 | `packages/server/src/__tests__/ws/handler-quota.integration.test.ts` | WS close 4006; AGENT_QUOTA_EXCEEDED |
| QUOTA-04 | Concurrent enforcement: over limit stays queued; queue depth → 429 | 10-04 | `packages/server/src/__tests__/routes/runs-trigger.integration.test.ts` | countConcurrentByOrg; 429 RunQuotaExceededError |
| QUOTA-05 | Retention config exposure via GET /usage | 10-04 | `packages/server/src/__tests__/routes/runs-usage.integration.test.ts` | orgPlan.logRetentionDays in response |
| QUOTA-06 | Usage display endpoint GET /api/orgs/:orgId/usage | 10-04 | `packages/server/src/__tests__/routes/runs-usage.integration.test.ts` | {agents, concurrent, retention_days} shape |

---

## Roadmap Success Criteria → Test Coverage

| SC # | Description | Evidence | Test File(s) |
|------|-------------|----------|--------------|
| SC-1 | Manually triggered task runs on eligible agent; queued if none available | `dispatcher.integration.test.ts` label-match tests; `runs-trigger.integration.test.ts` queued state | `dispatcher.integration.test.ts`<br>`agent-selector.integration.test.ts` |
| SC-2 | Full state machine: queued→dispatched→running→succeeded/failed + exit_code recorded | `dispatch-handler.test.ts` Test 1 (happy path + exit_code=0); E2E test confirms DB state=succeeded | `dispatch-handler.test.ts`<br>`dispatch-e2e.integration.test.ts` (CI) |
| SC-3 | Timeout sends cancel + reconciliation re-queues orphans | `timeout-manager.integration.test.ts` timeout→cancel flow; `reconciler.integration.test.ts` orphan + re-queue | `timeout-manager.integration.test.ts`<br>`reconciler.integration.test.ts` |
| SC-4 | Free plan max 5 agents enforced at registration | `handler-quota.integration.test.ts` Test (6th agent → close 4006) | `handler-quota.integration.test.ts` |
| SC-5 | Param overrides without altering task definition | `runs-trigger.integration.test.ts` Test 2 (DISP-09: param_overrides in snapshot; source task unchanged) | `runs-trigger.integration.test.ts` |

---

## CI-Deferred Tests

| Test File | Reason | Gate |
|-----------|--------|------|
| `packages/server/src/__tests__/e2e/dispatch-e2e.integration.test.ts` | Requires Docker (testcontainers Postgres) + xci dist/agent.mjs; Linux CI only | `describe.runIf(isLinux && existsSync(xciDistAgent))` |
| `packages/server/src/__tests__/services/dispatcher.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/services/reconciler.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/services/timeout-manager.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/ws/handler-frames.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/ws/handler-quota.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/routes/runs-trigger.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/routes/runs-cancel.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/routes/runs-list-get.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/routes/runs-usage.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |
| `packages/server/src/__tests__/services/agent-selector.integration.test.ts` | Requires Docker for Postgres | Docker CI gate |

---

## Backward Compatibility Coverage

| BC ID | Description | Test |
|-------|-------------|------|
| BC-01 | v1 xci 302-test suite still green | `pnpm --filter xci test` → 328 tests pass (pre-Phase 10 baseline) |
| BC-02 | Phase 8 agent + Phase 9 DSL tests still green | Included in `pnpm --filter xci test` (350 total including Phase 10) |
| BC-04 | Cold-start `xci --version` < 300ms (agent code lazy-loaded) | `cold-start.test.ts`; agent.ts only loaded when `--agent` in argv |

---

*Generated: 2026-04-19*
*Phase: 10-dispatch-pipeline-quota-enforcement*
