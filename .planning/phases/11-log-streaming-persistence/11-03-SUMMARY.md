---
phase: 11-log-streaming-persistence
plan: "03"
subsystem: server
tags: [websocket, streaming, log-download, retention, cleanup]
dependency_graph:
  requires: [11-01, 11-02]
  provides: [WS-subscribe-endpoint, download-endpoint, log-retention-service]
  affects: [app.ts, routes/runs/index.ts, config/env.schema.ts]
tech_stack:
  added: []
  patterns:
    - reply.hijack() + reply.raw for unbuffered streaming download
    - sinceSeq catch-up loop with cursor pagination (1000 rows/page)
    - setInterval().unref() for best-effort cleanup job
    - onReady immediate pass + periodic interval (D-20)
key_files:
  created:
    - packages/server/src/routes/runs/logs-ws.ts
    - packages/server/src/routes/runs/download.ts
    - packages/server/src/services/log-retention.ts
    - packages/server/src/__tests__/routes/logs-download.integration.test.ts
    - packages/server/src/__tests__/routes/logs-ws.integration.test.ts
    - packages/server/src/__tests__/services/log-retention.integration.test.ts
  modified:
    - packages/server/src/routes/runs/index.ts
    - packages/server/src/app.ts
    - packages/server/src/config/env.schema.ts
decisions:
  - WS route registered at root level (not under /api/orgs) — mirrors agent WS pattern; cookie auth still works because authPlugin onRequest fires on HTTP upgrade
  - reply.hijack() chosen over reply.send(Readable) per D-15 explicit recommendation; writeHead called manually after hijack
  - logsWsRoute exported from runs/index.ts barrel and registered in app.ts at root; downloadLogRoute stays inside registerRunRoutes under /api/orgs prefix
  - LogRetentionJobError caught at service level (best-effort); not re-thrown so setInterval continues firing
  - Integration tests written but Docker-deferred (no container runtime in this environment); unit tests all green
metrics:
  duration: ~45m
  completed: 2026-04-19
  tasks_completed: 2
  files_created: 6
  files_modified: 3
---

# Phase 11 Plan 03: WS Subscribe + Download + Log Retention Summary

Exposes the persisted log stream to users via three new delivery surfaces.

**One-liner:** Cookie-authed WS catch-up subscribe with sinceSeq replay, streaming text/plain download via reply.hijack cursor pagination, and unref'd setInterval retention cleanup with onReady immediate boot pass.

## What Was Built

### WS Subscribe Endpoint
- **URL:** `GET /ws/orgs/:orgId/runs/:runId/logs` (WebSocket upgrade, no `/api` prefix)
- **Auth:** xci_sid session cookie validated by authPlugin onRequest BEFORE the WS upgrade handshake (T-11-03-03); `requireAnyMember` enforces org membership
- **Frame grammar (client → server):**
  - `{type:'subscribe', sinceSeq?: number}` — first and only client frame
- **Frame grammar (server → client):**
  - `{type:'chunk', seq, stream, data, ts}` — each log chunk (catch-up + live)
  - `{type:'gap', droppedCount}` — slow subscriber buffer overflow (from LogFanout)
  - `{type:'end', state, exitCode}` — run reached terminal state; socket closed after 5s grace
  - `{type:'error', code}` — auth/validation failure before close
- **Catch-up:** pages through `logChunks.getByRunId(runId, {sinceSeq, limit:1000})` until exhausted, then registers with `logFanout.addSubscriber`
- **Terminal run:** if run already terminal after catch-up, sends `{type:'end'}` and closes after 5s — does NOT register as live subscriber
- **Cross-org:** `forOrg(orgId).taskRuns.getById(runId)` returns `undefined` for cross-org runId → `{type:'error', code:'NF_RUN'}` + close 1008 (T-11-03-01)

### Download Endpoint
- **URL:** `GET /api/orgs/:orgId/runs/:runId/logs.log`
- **Auth:** `preHandler:[requireAuth]` + `requireAnyMember`
- **Headers:** `Content-Type: text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="run-<runId>.log"`, `Cache-Control: no-store`
- **Streaming strategy:** `reply.hijack()` → `raw.writeHead(200, {...})` → cursor pagination loop (`sinceSeq` starting at -1, `limit:1000`) → `raw.end()` in finally block
- **Line format:** `[<ISO-ts> <STREAM>] <data>\n` (no double newline if data already ends with `\n`)
- **No max size** per D-16 — org-scoped auth is the access control

### Log Retention Service
- **File:** `packages/server/src/services/log-retention.ts`
- **Exports:**
  - `runRetentionCleanup(fastify)` — calls `adminRepo.runRetentionCleanup({batchSize:10_000, maxIterations:100})`, logs `{rowsDeleted, iterations, orgs, perOrg}` at info level (T-11-03-06: never includes chunk data)
  - `startLogRetentionJob(fastify)` — runs one immediate pass (D-20) + starts `setInterval().unref()`
- **Wiring in app.ts:**
  - `app.decorate('logRetentionTimer', null)` before onClose hook
  - `app.addHook('onReady', ...)` → `startLogRetentionJob(app)`
  - `app.addHook('onClose', ...)` → `clearInterval(app.logRetentionTimer)`
- **Env var:** `LOG_RETENTION_INTERVAL_MS` (default `86400000` = 24h); configurable for testing (D-17)

### Route Registration
- `logsWsRoute` exported from `routes/runs/index.ts` and registered in `app.ts` at root (no prefix) — same pattern as `registerAgentWsRoute`
- `downloadLogRoute` registered inside `registerRunRoutes` under the `/api/orgs` prefix

## Known Tolerated Edge Case

**Race window between catch-up final SELECT and `addSubscriber`:** If an agent emits a log_chunk after the last DB page fetch but before `addSubscriber` completes, the client may receive that chunk twice — once from the catch-up replay (when the batcher flushes it to DB) and once from the live fanout. The DB `(run_id, seq)` unique index guarantees persistence-level idempotency. Wire-level dedup by seq is the caller's responsibility. This is within LOG-01's tolerance per CONTEXT §specifics.

## Integration Tests (Docker-Deferred)

Three integration test files were created but could not be executed — no Docker container runtime available in this environment.

| File | Tests | Status |
|------|-------|--------|
| logs-download.integration.test.ts | 3 | Written, Docker-deferred |
| logs-ws.integration.test.ts | 6 | Written, Docker-deferred |
| log-retention.integration.test.ts | 3 | Written, Docker-deferred |

Test scenarios covered:
- **Download:** happy path (5 chunks ordered with prefix), cross-org 404, unauthenticated 401
- **WS:** full replay, sinceSeq filter, unauthenticated close, cross-org NF_RUN, terminal run end frame, live push via logFanout
- **Retention:** orgA 31d-old chunks deleted / orgB 1d-old preserved; perOrg return value; batchSize=2 → 3 iterations

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written with one structural deviation:

**1. [Rule 2 - Pattern] WS route registration at root level**
- **Found during:** Task 1 implementation
- **Issue:** Plan spec showed `logsWsRoute` in `registerRunRoutes` barrel, but that barrel is mounted under `/api/orgs` prefix, which would make the WS URL `/api/orgs/ws/orgs/:orgId/...`
- **Fix:** Exported `logsWsRoute` from the barrel and registered it directly in `app.ts` at root level (no prefix), matching the existing agent WS route pattern
- **Files modified:** `routes/runs/index.ts`, `app.ts`
- **Commit:** 8b90bf5

## Threat Surface Scan

All new surfaces are covered by the plan's threat model:
- T-11-03-01: cross-org isolation (forOrg scoping)
- T-11-03-03: WS auth via cookie (onRequest fires before upgrade)
- T-11-03-04: streaming download (no memory buffering)
- T-11-03-05: retention cleanup (batched, unref'd)
- T-11-03-06: retention log output (no secret material)
- T-11-03-07: sinceSeq input validation
- T-11-03-08: readyState check in catch-up loop

No new surfaces introduced beyond the plan's threat model.

## Self-Check: PASSED

Files created/modified:
- [x] packages/server/src/routes/runs/logs-ws.ts — FOUND
- [x] packages/server/src/routes/runs/download.ts — FOUND
- [x] packages/server/src/services/log-retention.ts — FOUND
- [x] packages/server/src/routes/runs/index.ts — FOUND (modified)
- [x] packages/server/src/app.ts — FOUND (modified)
- [x] packages/server/src/config/env.schema.ts — FOUND (modified)
- [x] packages/server/src/__tests__/routes/logs-download.integration.test.ts — FOUND
- [x] packages/server/src/__tests__/routes/logs-ws.integration.test.ts — FOUND
- [x] packages/server/src/__tests__/services/log-retention.integration.test.ts — FOUND

Commit 8b90bf5 verified in git log.
TypeScript build: clean (tsc -b --noEmit exits 0).
Unit tests: 157 passed (xci: 349+1 passed).
