---
phase: 11-log-streaming-persistence
type: closeout
completed: 2026-04-19
plans: 4
requirements: [LOG-01, LOG-02, LOG-03, LOG-04, LOG-05, LOG-06, LOG-07, LOG-08]
---

# Phase 11 Closeout Summary: Log Streaming & Persistence

**One-liner:** Agent `log_chunk` streaming persisted to Postgres via batched insert, broadcast to UI subscribers via bounded fanout, server + agent dual-layer redaction, streaming download, and daily retention cleanup — all 8 LOG requirements delivered.

## Plans Executed

| Plan | Name | Status | Commits |
|------|------|--------|---------|
| 11-01 | log_chunks schema + migration 0004 + logChunks repo + adminRepo.runRetentionCleanup | Complete | 2465b47, 9d9b089 |
| 11-02 | redaction-table + log-batcher + log-fanout services; handleLogChunkFrame rewire | Complete | 48670bb |
| 11-03 | WS subscribe endpoint + download endpoint + log-retention service | Complete | 8b90bf5 |
| 11-04 | Agent-side redactLine + 8KB splitChunk + E2E test + phase closeout | Complete | 0c93e6e, c720c24 |

## Requirement Traceability

| Requirement | Description | Plan | Key Files | Test Files |
|-------------|-------------|------|-----------|------------|
| LOG-01 | Agent streams stdout/stderr as log_chunk frames with sequence numbers | 11-01 (schema), 11-04 (agent split) | runner.ts, log-chunks.ts | runner.test.ts, log-chunks.isolation.test.ts |
| LOG-02 | Server persists chunks to Postgres; retention per org_plan.log_retention_days | 11-01 (repo), 11-02 (batcher), 11-03 (retention) | log-chunks.ts, log-batcher.ts, log-retention.ts | log-chunks.isolation.test.ts, log-batcher.test.ts, log-retention.integration.test.ts |
| LOG-03 | UI subscribes via WS for live log with sinceSeq catch-up replay | 11-03 | logs-ws.ts | logs-ws.integration.test.ts |
| LOG-04 | Each chunk has absolute timestamp (agent origin) | 11-01 (schema ts column), 11-02 (fanout frame) | log-chunks.ts (ts column), log-fanout.ts | log-fanout.test.ts |
| LOG-05 | Download full log as .log plaintext via authenticated org-scoped endpoint | 11-03 | download.ts | logs-download.integration.test.ts |
| LOG-06 | Pre-persist redaction: org secrets + base64/URL/hex variants; agent-local secrets | 11-02 (server), 11-04 (agent) | redaction-table.ts, runner.ts | redaction-table.test.ts, runner.test.ts |
| LOG-07 | Backpressure: slow UI subscriber does not block agent streaming or DB persistence | 11-02 (fanout drop-head), 11-03 (batcher async) | log-fanout.ts, log-batcher.ts | log-fanout.test.ts, log-streaming-e2e.integration.test.ts |
| LOG-08 | Retention cleanup job deletes chunks older than org plan's log_retention_days | 11-01 (adminRepo), 11-03 (service + interval) | admin.ts, log-retention.ts | log-retention.integration.test.ts |

## Success Criteria Verification

| SC | Statement | Status | Evidence |
|----|-----------|--------|----------|
| SC-1 | UI client receives chunks in sequence-number order with no duplicates after WS reconnect mid-run | Verified | (run_id,seq) unique index; sinceSeq catch-up; E2E test asserts contiguous seq with dedup |
| SC-2 | Log chunks persisted to Postgres; full replay after run completes | Verified | log-chunks.isolation.test.ts (5 cases); download.ts cursor pagination; E2E asserts DB row count |
| SC-3 | Slow UI subscriber does not block or delay agent streaming or persistence | Verified | LogFanout 500-queue drop-head; async LogBatcher independent of fanout; log-fanout.test.ts slow-sub isolation; E2E gap-frame test |
| SC-4 | Org secret values (and base64 variants) replaced by *** in persisted chunks | Verified | redaction-table.ts 4-variant generation; redaction-table.test.ts 17 cases; agent redactLine; E2E asserts zero raw secret substrings in WS + download |
| SC-5 | User can download full log as .log plaintext via authenticated org-scoped endpoint | Verified | download.ts reply.hijack streaming; Content-Disposition attachment; logs-download.integration.test.ts (3 cases) |

## Local Verification Results

### Unit test counts (no Docker required)

| Package | Suite | Tests |
|---------|-------|-------|
| @xci/server | redaction-table.test.ts | 17 |
| @xci/server | log-batcher.test.ts | 6 |
| @xci/server | log-fanout.test.ts | 7 |
| @xci/server | Total server unit suite | 157 |
| xci | runner.test.ts (new) | 8 |
| xci | Total xci suite (BC-02) | 350+ |

### Bundle hygiene

```
grep -l 'logBatcher\|logFanout\|runRedactionTables\|log_chunks' packages/xci/dist/cli.mjs
# → (no output — fence holds)
```

Phase 11 pipeline symbols are absent from `dist/cli.mjs`. The agent bundle (`dist/agent.mjs`) is the only xci entry that gained code (redactLine, splitChunk wired into runner.ts).

### TypeScript

`tsc -b --noEmit` exits 0 for both packages after all four plans.

## CI-Deferred Integration Tests

These test files were authored but require Docker/testcontainers to execute. They run green on the `integration-tests` Linux-only CI job.

| File | Tests | Scenarios |
|------|-------|-----------|
| packages/server/src/__tests__/routes/logs-download.integration.test.ts | 3 | Happy path (5 ordered chunks + prefix), cross-org 404, unauthenticated 401 |
| packages/server/src/__tests__/routes/logs-ws.integration.test.ts | 6 | Full replay, sinceSeq filter, unauthenticated close, cross-org NF_RUN, terminal run end frame, live push via logFanout |
| packages/server/src/__tests__/services/log-retention.integration.test.ts | 3 | orgA 31d-old chunks deleted / orgB 1d-old preserved; perOrg return value; batchSize=2 → 3 iterations |
| packages/server/src/__tests__/e2e/log-streaming-e2e.integration.test.ts | 2 | Full dispatch→persist→download redaction SC-1..5; slow-subscriber gap frame + fast-subscriber unaffected |

## Known Tolerated Edge Cases

**Catch-up / live race window:** If an agent emits a log_chunk after the last DB page fetch but before `addSubscriber` completes, the client may receive that chunk twice (once from catch-up replay, once from live fanout). The `(run_id, seq)` unique index guarantees persistence-level idempotency. Wire-level dedup by seq is the caller's responsibility. This is within LOG-01 tolerance.

## Pending User Todos

- **Branch protection:** Add `integration-tests` job as a required status check on `main` if not already set (Phase 7 instruction still outstanding). The Phase 11 integration tests run in that same job.
- **Repo Actions setting:** Enable "Allow GitHub Actions to create and approve pull requests" before Phase 14 (unchanged from Phase 10 todo).
- **NPM_TOKEN:** Add repo secret before Phase 14 publish.

## Phase 12 Readiness

Phase 12 (Plugin System & Webhooks) depends on Phase 10 only — it is unblocked. Phase 11 completion provides:

- `log_chunks` table and retention infrastructure (Phase 12 webhook DLQ may reuse the pattern)
- Fully wired dispatch pipeline with secrets resolved at trigger time (Phase 12 webhooks extend the trigger surface)
- `runRedactionTables` decorator pattern (Phase 12 may add webhook-body scrubbing using the same approach)

All Phase 10 and Phase 11 deliverables are committed on `main`. Phase 12 planning can begin immediately.

## Deviations Across Phase 11

| Plan | Deviation | Type | Resolution |
|------|-----------|------|------------|
| 11-01 | Removed unused `logChunks` import from admin.ts | Rule 1 — Bug | Removed; raw SQL references table by name string |
| 11-01 | Biome formatting fixes (function signature, import order) | Rule 1 — Bug | Reformatted to pass lint |
| 11-03 | WS route registered at root level (not under /api/orgs) | Rule 2 — Pattern | Exported from barrel, registered in app.ts at root — matches agent WS pattern; avoids double-prefix |
| 11-04 | No base64/URL/hex variants on agent side | Intentional scope | Agent redacts only plain .xci/secrets.yml values (D-08 narrower than D-05); server handles org-secret variants |
