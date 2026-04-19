# Phase 10: Dispatch Pipeline & Quota Enforcement - Discussion Log

> **Audit trail only.**

**Date:** 2026-04-19
**Mode:** Auto-selected by Claude per user authorization for autonomous chain to milestone end

| Decision | Choice | Why |
|----------|--------|-----|
| Queue architecture | In-memory FIFO + Postgres for crash safety | Single-instance v2.0; pure-DB queue overkill; mem+DB balanced |
| Dispatcher trigger | 250ms `setInterval` tick | Trigger latency <500ms on cold paths; event-driven deferred |
| TaskRun shape | Includes `task_snapshot` + `param_overrides` jsonb columns | Reproducibility — runs use the def at dispatch time, immune to later task edits |
| State machine | Atomic CAS via UPDATE WHERE state=expected | Race-safe even though v2.0 is single-instance |
| Selection algo | Online + drain-excluded + label-match + per-agent concurrency + least-busy + round-robin tiebreak | Spec-compliant DISP-02 |
| Per-agent concurrency | New column `agents.max_concurrent INT DEFAULT 1` | DISP-05 default |
| Timeout | setTimeout per dispatched run + boot-time stale check | Crash-safe per D-22 |
| Quota at registration | WS handshake checks `agentsRepo.countByOrg < orgPlan.max_agents` BEFORE registerNewAgent; 4006 close on excess | QUOTA-03 + clear UX message |
| Quota at concurrency | Run stays queued if concurrent count >= max; queue depth capped at 2× to avoid unbounded queue growth | QUOTA-04 — implicit + explicit gates |
| Reconciliation | Boot scan + agent reconnect_ack — server authoritative on terminal states; `running` runs killed-on-server become `orphaned` | DISP-08 + Phase 8 D-21 promotion |
| Cancel flow | REST endpoint sends cancel frame + 30s timeout for agent ack; idempotent on terminal | DISP-07 |
| Frame protocol | Hand-rolled discriminated union extension (no zod) | Phase 8 D-15 pattern |
| Agent dispatch handler | Imports v1 executor directly (same package); merges agent-local secrets per SEC-06 | Reuse battle-tested v1 engine |
| Schema migration | `0003_task_runs.sql` adds task_runs + extends agents/tasks columns | Single migration |
| Tests | Unit (state, selector, queue, timer); Integration (full dispatch happy path, timeout, cancel, quotas, reconciliation, label match, param overrides) — Linux+Docker | Standard Phase 7+ split |
| Endpoints | POST run trigger, GET runs, GET run, POST cancel, GET org usage | DISP + QUOTA-06 |

## Deferred

See CONTEXT `<deferred>` — distributed dispatcher, retry, scheduler, run dependencies, audit log table, archival, sticky dispatch, real-time UI fanout (Phase 11/13).
