# Phase 11: Log Streaming & Persistence - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** auto-selected (user requested autonomous chain to milestone end)

<domain>
## Phase Boundary

Phase 11 delivers the full log stream pipeline: agent → server persistence → UI live fanout, with ordered replay, redaction, retention cleanup, and download endpoint.

- Drizzle schema for `log_chunks` table (jsonb payload, seq-indexed per run, org-scoped via task_runs.org_id)
- Server receives `log_chunk` frames from agent (Phase 10 already emits them; Phase 10 server currently DISCARDS them — Phase 11 stores them)
- Pre-persist redaction (LOG-06): replace org-secret values + base64 variants with `***` BEFORE insert
- UI WebSocket subscribe endpoint for live log fanout (`/ws/run/:runId/logs`) with seq-based catch-up on (re)connect + live chunk forwarding
- Backpressure: slow UI subscriber drops oldest chunks (bounded buffer); never blocks agent or persistence path
- Download endpoint: authenticated, org-scoped, `Content-Disposition: attachment; filename=run-<runId>.log` (plaintext)
- Retention cleanup: daily cron-ish job deletes log chunks older than `orgPlan.log_retention_days` (Free = 30 days)

This phase does NOT deliver:
- Web UI for log viewing (Phase 13 consumes the WS endpoint + download endpoint)
- Real-time stdout/stderr colorization (text-only in Phase 11; UI layer handles ANSI)
- Search/grep inside logs (Phase 13+ candidate)
- Export formats other than plain `.log` (JSON, CSV deferred)
- Webhook triggers for "run complete" emails / notifications (out of scope v2.0)
- Log aggregation across runs (per-run only)

**Hard scope rule:** every requirement implemented here is one of LOG-01..08.

</domain>

<decisions>
## Implementation Decisions

### Schema

- **D-01:** **`log_chunks` table** (org-scoped via task_runs.org_id joining, but NOT direct org_id FK — join to task_runs instead; keeps the table lean since log volume is high):
  - `id text PK` (xci_lch_*)
  - `run_id text NOT NULL FK task_runs ON DELETE CASCADE` — chunks die with their run
  - `seq integer NOT NULL` — agent-assigned sequence number per run (LOG-01)
  - `stream text NOT NULL` enum `'stdout' | 'stderr'`
  - `data text NOT NULL` — the chunk payload AFTER redaction (LOG-06)
  - `ts timestamptz NOT NULL` — agent-origin timestamp (LOG-04)
  - `persisted_at timestamptz NOT NULL DEFAULT now()`
  - Index: `(run_id, seq)` unique — prevents duplicates, enables ordered fetch
  - Index: `(persisted_at)` for retention cleanup efficient scan

- **D-02:** **No jsonb compression in application layer.** LOG-02 mentions "compressione" but Postgres TOAST automatically compresses large text columns — don't reinvent. If a single chunk > 8KB, Postgres TOAST kicks in transparently. Acceptable.

- **D-03:** **Chunk size cap at application layer:** 8KB per chunk. Agent splits larger payloads before sending to server (Phase 10 D-14 already has the framework; Phase 11 formalizes the cap).

### Pre-Persist Redaction (LOG-06)

- **D-04:** **Redaction runs on server BEFORE DB insert.** NOT on agent (agent doesn't have org-secret values, only agent-local ones). The agent's own secrets live in `.xci/secrets.yml` and the agent redacts those locally before sending. Server redacts org-secret values using the DEK to decrypt, then regex-replace.

- **D-05:** **Redaction target values** (assembled per-run at dispatch time, cached in `fastify.runRedactionTables` Map<runId, Set<string>>):
  - All plaintext values from org secrets resolved for this run (dispatch-resolver output)
  - Base64 variants: `Buffer.from(value).toString('base64')` AND `Buffer.from(value, 'utf8').toString('base64')` (should be identical, but defensive)
  - URL-encoded variants: `encodeURIComponent(value)` (covers log lines that URL-encode secrets in query strings)
  - Hex variants: `Buffer.from(value).toString('hex')` (covers hex-dumped secrets)
  - Minimum length to redact: 4 chars (avoids replacing common words in logs)

- **D-06:** **Redaction algorithm:** `String.prototype.replaceAll(value, '***')` for each redaction target. Order matters: LONGEST values first (avoid partial replacements). The redaction table is built at dispatch time and cached per run; cleared when run reaches terminal state.

- **D-07:** **Redaction is defense-in-depth.** If a secret slips through (unexpected encoding), the primary control is still "secrets never appear in API responses" (Phase 9 architectural invariant). Redacted logs are a SECONDARY defense.

- **D-08:** **Agent-local secrets from `.xci/secrets.yml`** — agent redacts these BEFORE sending log_chunk frames. Agent already has the values (merged at dispatch time per Phase 10 D-17). Extend `packages/xci/src/agent/runner.ts` with `redactLine(line, secretValues)` helper applied to each line before emitting log_chunk.

### Persistence Flow (LOG-02)

- **D-09:** **Server receives `log_chunk` frame** (already routed in Phase 10 handler — currently DISCARDS). Replace discard with:
  1. Look up run redaction table from `fastify.runRedactionTables` (null if run terminal)
  2. Apply server-side redaction (the DEK-decrypted org secret values)
  3. INSERT into log_chunks (ON CONFLICT (run_id, seq) DO NOTHING — idempotent on replay; LOG-01 seq ordering)
  4. Fanout to live subscribers (via `fastify.logSubscribers` Map — see D-12)

- **D-10:** **Batched inserts:** buffer log_chunks in memory for up to 200ms OR 50 chunks (whichever first), then single INSERT statement. Reduces DB round-trips under high-volume streaming. Buffer flushed on run terminal + on app.close.

- **D-11:** **Backpressure on persistence:** if the DB write queue grows > 1000 pending chunks, START DROPPING oldest (log a warning). Never block the agent frame handler. This is the LOG-07 principle applied to persistence as well as UI fanout.

### Live UI Fanout (LOG-03, LOG-07)

- **D-12:** **`/ws/run/:runId/logs` WebSocket endpoint** (authenticated via session cookie, per Phase 7 pattern; WS upgrade reads cookie):
  - On connect: validate user has session AND run.org_id === session.org.id (org isolation)
  - On connect: client sends `{type:'subscribe', sinceSeq?: number}`. Server replays all persisted chunks WHERE seq > sinceSeq (ordered) → sends as `{type:'chunk', seq, stream, data, ts}` frames.
  - Register subscriber in `fastify.logSubscribers: Map<runId, Set<{ws, queue, orgId}>>`
  - When new chunks arrive (from agent log_chunk handler), server fans out to all subscribers for that runId.
  - On WS close: remove subscriber from the map.
  - On run terminal: send `{type:'end', state: finalState, exitCode}` frame; close connection after 5s grace.

- **D-13:** **Per-subscriber bounded queue (LOG-07 drop-head):**
  - Each subscriber has a `queue: AgentFrame[]` with max size 500.
  - On new chunk: if queue.length >= 500, `queue.shift()` (drop oldest), emit `{type:'gap', droppedCount: N}` frame once per overflow event. Then push new chunk.
  - Queue drained by an async pump that `ws.send`s. Slow subscriber means queue fills faster than it drains — drop-head preserves tail (most recent logs).

- **D-14:** **Reconnect with catch-up (LOG-01 "no duplicates even after WS reconnect mid-run"):**
  - Client persists the last received `seq` per run.
  - On reconnect, client sends `{type:'subscribe', sinceSeq: lastSeq}`.
  - Server replays seq > sinceSeq from DB, then resumes live stream.
  - The `(run_id, seq)` unique index guarantees idempotency on the server side even if agent resends a chunk.

### Download Endpoint (LOG-05)

- **D-15:** **GET `/api/orgs/:orgId/runs/:runId/logs.log`** (any member, requireAuth):
  - Streams all log chunks for the run in seq order, concatenated with newlines.
  - Format: `[<ts> <stream>] <data>` per chunk (e.g., `[2026-04-19T10:30:45.123Z STDOUT] hello world`).
  - `Content-Disposition: attachment; filename="run-<runId>.log"`
  - `Content-Type: text/plain; charset=utf-8`
  - Streaming response (not buffered) — use Fastify `reply.raw` or a Readable stream.
  - Query pagination: DB cursor with chunks of 1000 rows; avoid loading all into memory.

- **D-16:** **No max log size on download.** If a run produced 500MB of logs, that's what the user gets. The streaming response handles arbitrary size.

### Retention Cleanup (LOG-08)

- **D-17:** **Cron-ish job:** a service `packages/server/src/services/log-retention.ts` with `runRetentionCleanup(fastify)`. Uses `setInterval(runRetentionCleanup, 24*60*60*1000).unref()` started on `onReady`. Configurable interval via env `LOG_RETENTION_INTERVAL_MS` (default 24h) for testability.

- **D-18:** **Per-org retention:** the query JOINS log_chunks → task_runs → orgs → org_plans. For each chunk, if `persisted_at < now() - (org_plan.log_retention_days || ' days')::interval` → DELETE. Efficient as a single DELETE with JOIN:
  ```sql
  DELETE FROM log_chunks lc
  USING task_runs tr, org_plans op
  WHERE lc.run_id = tr.id
    AND op.org_id = tr.org_id
    AND lc.persisted_at < now() - (op.log_retention_days || ' days')::interval
  ```

- **D-19:** **Batching:** cleanup runs in batches of 10,000 rows (with LIMIT + subquery pattern since PG doesn't support LIMIT on DELETE directly). Repeats until no rows deleted. Prevents long locks.

- **D-20:** **Startup cleanup:** on boot, run one cleanup immediately (catches cases where server was offline through multiple cleanup windows). Don't wait 24h after a restart.

### Server-Side Error Handling

- **D-21:** **Secret leak audit log:** if the server's redaction detects a value that SHOULD have been redacted by the agent (agent-local secret) but wasn't (unlikely but possible with custom `--label` or env vars), log a PINO warning with run_id + secret name (metadata only, NOT value). Does NOT fail the chunk; just flags for operator review.

- **D-22:** **Invalid seq from agent** (seq decreasing or gap): store anyway with ON CONFLICT DO NOTHING. The (run_id, seq) unique index handles duplicates. Gaps are tolerated (reconnect may skip numbers).

### New Errors

- **D-23:** `LogChunkStorageError` (500), `LogSubscriptionUnauthorizedError` (403), `LogRetentionJobError` (500) — follow XciServerError pattern.

### Cross-Package

- **D-24:** **Agent-side log streaming** (Phase 10 D-14 emits log_chunk frames; Phase 11 enhances):
  - Extend `packages/xci/src/agent/runner.ts` with `redactLine(line, secrets)` helper applied per chunk before `onLogChunk` callback.
  - Agent-local secrets loaded at dispatch (already done Phase 10 D-17).
  - Chunk splitting: if a line exceeds 8KB (D-03), split into multiple chunks with contiguous seq numbers.
  - Flush partial chunks on subprocess exit.
  - No other agent changes — the emission pipeline is already set up.

- **D-25:** **NO cross-package imports introduced in Phase 11.** xci agent's redaction is self-contained. Server's redaction uses local run-redaction table. `xci/dsl` still the only shared surface.

### Repos

- **D-26:** **`log-chunks.ts` repo** (org-scoped via task_runs join):
  - `insertBatch(chunks[])` — bulk INSERT with ON CONFLICT DO NOTHING
  - `getByRunId(runId, sinceSeq?, limit?)` — ORDER BY seq; used for UI catch-up + download stream
  - `countByRunId(runId)` — for UI progress indicator (not strictly required; nice-to-have)
  - `deleteOlderThan(runId, beforeTimestamp)` — retention helper (unused by default cleanup which uses join-delete)

- **D-27:** **adminRepo additions:**
  - `runRetentionCleanup({beforeFactory?, batchSize=10000, maxIterations=100})` — the join-delete loop

### Schema Migration

- **D-28:** **Migration `0004_log_chunks.sql`** via `drizzle-kit generate --name log_chunks`. [BLOCKING] gate.

### Testing Strategy

- **D-29:** **Unit tests:**
  - `redact-line.test.ts` — agent redaction logic: simple value, base64 variant, URL-encoded, longest-first ordering
  - `log-batcher.test.ts` — batching logic (200ms OR 50 chunks)
  - `subscriber-queue.test.ts` — bounded queue drop-head behavior
  - `retention-cleanup.test.ts` — cleanup job iteration logic

- **D-30:** **Integration tests (Linux + Docker):**
  - log-persistence: agent emits 100 chunks; server persists in order; GET /logs.log returns all in order
  - log-redaction: trigger run with secret ${API_KEY}; task echoes it; persisted log chunks show `***` not the value; base64 variant also redacted
  - log-fanout: 3 subscribers connected; new chunk arrives; all 3 receive it; slow subscriber drops old chunks
  - log-catchup: subscribe with sinceSeq=50; receive only seq > 50; reconnect mid-run → no duplicates
  - log-download: GET /logs.log after run complete; streams entire log as text/plain
  - log-retention: manually set chunk persisted_at to 31 days ago; run cleanup; chunks deleted
  - log-isolation: org A subscriber cannot see org B run logs (403)

- **D-31:** **E2E (one):** full dispatch → task emits stdout → log chunks persisted → download endpoint returns expected text.

### Claude's Discretion (planner picks)

- Exact Pino log redaction config scope (route-scoped vs global — lean global for safety)
- Whether to add a "log chunk count" column on task_runs for UI (recommend: no, compute via COUNT query on demand)
- Whether to compress log_chunks.data at application level (recommend: no, rely on Postgres TOAST)
- Cron scheduler alternative to setInterval (recommend: keep setInterval for single-instance v2.0; node-cron deferred)
- Download endpoint max concurrency (recommend: 10 parallel per org; rate-limit)
- Whether to signature-sign download URLs (out of scope; auth is via session cookie)

</decisions>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` §Log Streaming (LOG-01..08)
- `.planning/REQUIREMENTS.md` §Backward Compatibility (BC-01..04)

### Roadmap
- `.planning/ROADMAP.md` §Phase 11 — 5 success criteria

### Prior Phase Context
- `.planning/phases/08-agent-registration-websocket-protocol/08-CONTEXT.md` D-15 — log_chunk frame type RESERVED, WIRED in Phase 10 emission, STORED in Phase 11
- `.planning/phases/09-task-definitions-secrets-management/09-CONTEXT.md` D-32..D-35 — dispatch-resolver gives server the org secret values for D-05 redaction table
- `.planning/phases/10-dispatch-pipeline-quota-enforcement/10-CONTEXT.md` D-14 — agent emits log_chunk; Phase 10 server discards; Phase 11 stores + fans out; D-17 agent-local secret merge still active

### External Specs
- PostgreSQL TOAST (https://www.postgresql.org/docs/current/storage-toast.html) — transparent compression of large text columns
- PostgreSQL `DELETE ... USING` syntax — for the retention JOIN delete

</canonical_refs>

<code_context>
## Existing Code Insights

### Inherited Patterns
- forOrg + adminRepo (Phase 7)
- WS handler + registry (Phase 8)
- Secret resolver + DEK unwrap (Phase 9)
- Dispatch pipeline sets up run redaction table at dispatch time (Phase 10 + Phase 11 D-05)
- xci agent emits log_chunk frames (Phase 10 D-14) — Phase 11 enhances with redaction

### Integration Points
- `packages/server/src/ws/handler.ts` — `handleLogChunkFrame`: replace DISCARD with redact → persist → fanout
- `packages/server/src/services/log-batcher.ts` — NEW: batching logic
- `packages/server/src/services/log-fanout.ts` — NEW: subscriber registry + drop-head queue
- `packages/server/src/services/log-retention.ts` — NEW: cleanup cron
- `packages/server/src/routes/runs/download.ts` — NEW: GET /logs.log streaming endpoint
- `packages/server/src/routes/runs/logs-ws.ts` — NEW: WS subscribe endpoint
- `packages/server/src/repos/log-chunks.ts` — NEW repo
- `packages/server/src/db/schema.ts` — extend with log_chunks table
- `packages/xci/src/agent/runner.ts` — extend with redactLine + 8KB split

</code_context>

<specifics>
## Specific Ideas

- **The `log_chunks` table will be the largest in the DB** by row count. Keep it lean (no jsonb; text `data` is efficient with TOAST). The `(run_id, seq)` index is critical.

- **LOG-07 drop-head is the right choice** — dropping recent chunks (drop-tail) is worse UX since the live log tail is where user attention is. Drop oldest + emit gap marker preserves informational content.

- **Retention defaults to 30 days (Free plan)** per QUOTA-02; configurable per org_plan. The cleanup is destructive — log a summary (rows deleted per org) on each run for operator visibility.

- **Redaction table scoped per run** prevents cross-run leaks: if run A uses secret X and run B doesn't, B's logs don't accidentally redact chunks that happen to contain X's value.

- **No compression at app layer** — TOAST is transparent, battle-tested, and free. Adding app-layer gzip would complicate the fanout path (live subscribers need uncompressed text).

</specifics>

<deferred>
## Deferred Ideas

- **Log search/grep** — Phase 13+ (UI-driven, likely via Postgres FTS); deferred
- **Log aggregation across runs** — out of scope v2.0
- **Export to JSON/CSV** — only plaintext `.log` in v2.0
- **Signed download URLs** — auth via session cookie only
- **Log notifications (email on failure)** — out of scope
- **Real-time ANSI colorization in streaming** — Phase 13 UI handles
- **Log partitioning by date** — not needed at v2.0 scale
- **Multi-instance log fanout (Redis pub/sub)** — single-instance v2.0
- **node-cron scheduler** — setInterval sufficient
- **Per-run chunk count indicator** — compute on demand

### Reviewed Todos (not folded)
None.

</deferred>

---

*Phase: 11-log-streaming-persistence*
*Context gathered: 2026-04-19*
*Mode: auto-selected*
