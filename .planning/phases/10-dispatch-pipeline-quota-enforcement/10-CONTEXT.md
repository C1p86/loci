# Phase 10: Dispatch Pipeline & Quota Enforcement - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** auto-selected (user requested autonomous chain to milestone end)

<domain>
## Phase Boundary

Phase 10 wires Phase 8 (agents + WS) and Phase 9 (tasks + secrets) into the actual dispatch pipeline:

**Server-side:**
- Drizzle schema for `task_runs` table (state machine: queued → dispatched → running → succeeded|failed|cancelled|timed_out|orphaned)
- In-memory dispatch queue (per DISP-01) backed by Postgres reconciliation on boot/disconnect
- Label-match dispatcher: select `online` agent satisfying all `label_requirements`; least-busy first; round-robin tiebreak
- REST routes: trigger run (manual + with param overrides), get run status, list runs, cancel run
- WebSocket frame handlers: `dispatch` (server→agent), `cancel` (server→agent), `result` (agent→server)
- Timeout manager: default 1h per task, configurable per-task or per-run; expired → send `cancel` + mark `timed_out`
- Startup reconciliation (DISP-08): on server boot, queued/dispatched runs without active agent session → re-queue or `orphaned`
- Quota enforcement: agent registration limit (QUOTA-03) + concurrent task limit (QUOTA-04) + retention cleanup config (QUOTA-05); usage display data (QUOTA-06)

**xci agent-side (`packages/xci/src/agent/`):**
- Handle incoming `dispatch` frame: parse, set up env, run the task using v1's existing executor (single/sequential/parallel)
- Stream `log_chunk` frames during execution (Phase 11 owns the actual streaming UI; Phase 10 just sends the frames)
- Send `result` frame on completion (with exit code, duration)
- Handle incoming `cancel` frame: kill subprocess(es), respond
- Merge agent-local `.xci/secrets.yml` into dispatched params (SEC-06 — agent-local wins on collision)
- Track running runs locally; report on reconnect handshake (Phase 8 reconnect_ack reconciliation now ACTIVE)
- Honor concurrency-per-agent (default 1, configurable via flag)
- Drain mode (Phase 8 D-24): refuse new dispatches; allow current to finish

**This phase does NOT deliver:**
- Log streaming persistence + UI fanout (Phase 11) — Phase 10 sends `log_chunk` frames; Phase 11 stores them and broadcasts to UI subscribers
- Webhook trigger ingest (Phase 12) — Phase 10 only supports manual UI trigger via REST
- Task UI editor (Phase 13)
- Run history UI (Phase 13)
- Per-task scheduler / cron triggers (out of scope for v2.0)

**Hard scope rule:** every requirement implemented here is one of DISP-01..09 or QUOTA-03..06.

</domain>

<decisions>
## Implementation Decisions

### TaskRun Schema

- **D-01:** **`task_runs` table** (org-scoped, follows Phase 7 D-01 forOrg pattern):
  - `id text PK` (xci_run_*)
  - `org_id text FK orgs ON DELETE CASCADE`
  - `task_id text FK tasks ON DELETE CASCADE` (the source task definition; preserved on task update by snapshot fields below)
  - `task_snapshot jsonb NOT NULL` — full snapshot of task definition at dispatch time (yaml_definition, label_requirements, name, description). DISP-09 enables param overrides without altering the task; this snapshot ensures the run is reproducible even if the task is updated/deleted later.
  - `param_overrides jsonb DEFAULT '{}'` — UI-supplied overrides for `${VAR}` placeholders (DISP-09). Preserved for audit; merged at dispatch time per Phase 9 D-34 precedence.
  - `state text NOT NULL` — enum `queued | dispatched | running | succeeded | failed | cancelled | timed_out | orphaned`
  - `agent_id text NULLABLE FK agents ON DELETE SET NULL` (the agent that took the run; null while queued)
  - `exit_code int NULLABLE` (set when state in succeeded/failed/timed_out)
  - `triggered_by_user_id text FK users NULLABLE` (null for webhook-triggered runs in Phase 12)
  - `trigger_source text NOT NULL DEFAULT 'manual'` (enum: 'manual' | 'webhook' — Phase 12 adds webhook)
  - `timeout_seconds int NOT NULL DEFAULT 3600` (DISP-06 default 1h; per-run override)
  - `queued_at timestamptz NOT NULL DEFAULT now()`
  - `dispatched_at timestamptz NULLABLE`
  - `started_at timestamptz NULLABLE`
  - `finished_at timestamptz NULLABLE`
  - `cancelled_by_user_id text FK users NULLABLE` (DISP-07)
  - `created_at`, `updated_at`
  - Index: `(org_id, state)` for queue scans + `(agent_id, state)` for per-agent concurrency counts + `(state, queued_at)` for FIFO selection + `(state, dispatched_at)` for orphan detection

- **D-02:** **State machine transitions** (enforced in `repos/task-runs.ts` updates):
  ```
  queued → dispatched (when picked by dispatcher; sets agent_id + dispatched_at)
  dispatched → running (when agent sends 'state' frame ack OR first log_chunk arrives)
  dispatched → orphaned (if dispatcher detects agent went offline before ack — DISP-08 boot path)
  running → succeeded (agent sends result with exit_code 0)
  running → failed (agent sends result with non-zero exit_code)
  running → cancelled (cancel frame succeeded — sets cancelled_by_user_id + finished_at)
  running → timed_out (timeout fires — DISP-06)
  any → orphaned (boot reconciliation can't find a session — DISP-08 second path)
  ```
  Transitions persisted via UPDATE WHERE current_state = expected_state (atomic guard against race).

- **D-03:** **No "retry" or "rerun" in Phase 10.** Re-running a task creates a NEW TaskRun row. Audit/history-friendly.

### In-Memory Dispatch Queue (DISP-01)

- **D-04:** **`DispatchQueue` class** decorated as `fastify.dispatchQueue`. In-memory FIFO `Array<{runId, orgId, taskSnapshot, params, labelRequirements}>`. Backed by Postgres: on boot, queue is rebuilt from `task_runs WHERE state='queued'` (DISP-08 first half). On enqueue (manual trigger), entry is added to BOTH the in-memory queue AND the DB row is INSERTed atomically.
- **D-05:** **Dispatcher tick:** `setInterval(tickDispatcher, 250ms)` checks the queue; for each entry, finds eligible agents (D-08 selector); if found, atomically transitions the run to `dispatched`, dequeues, sends `dispatch` frame. If no eligible agent, leaves in queue.
- **D-06:** **Eligibility recomputed on each tick** — handles agents going online/offline mid-tick. NO event-driven dispatch in Phase 10 (simpler; revisit perf later if 250ms is too slow).
- **D-07:** **Queue depth limit per org (QUOTA-04 second clause):** if `count(state='queued' AND org_id=X) >= max_queue_threshold`, reject new triggers with 429 + "quota exceeded, retry later". `max_queue_threshold = max_concurrent_tasks * 2` (so Free plan allows up to 10 queued; reasonable burst capacity).

### Label-Match Selector (DISP-02)

- **D-08:** **Selection algorithm** in `services/agent-selector.ts`:
  1. Eligible set = agents WHERE `org_id = run.org_id` AND `state computed = 'online'` (per Phase 8 D-12 read-time computation: state column='online' AND last_seen_at > now() - 60s) AND `state column != 'draining'` (drain agents excluded).
  2. Filter by label match: every `key=value` in `task.label_requirements` MUST equal the agent's labels[key]. Missing key = no match.
  3. Filter by per-agent concurrency: agents with `count(state IN ('dispatched','running') WHERE agent_id=X) < concurrency_per_agent` (default 1, override via `agents.max_concurrent` column added in Phase 8 schema or here).
  4. From remaining: select agent with FEWEST active runs (least-busy). On tie: round-robin (track `last_dispatched_to_agent_id` cursor in DispatchQueue state).
  5. If empty set: leave in queue.

- **D-09:** **Per-agent concurrency** stored as `agents.max_concurrent int DEFAULT 1` column — add via Phase 10 migration (extend agents table from Phase 8). Configurable via PATCH agent route (extend Phase 8 PATCH handler).

### Org Quota Enforcement

- **D-10:** **QUOTA-03 (registration enforcement)** — extend the WS handshake `register` handler from Phase 8: BEFORE calling `adminRepo.registerNewAgent(...)`, check `agentsRepo.countByOrg(orgId) >= orgPlan.max_agents`. If yes, send `{type:'error', code:'AGENT_QUOTA_EXCEEDED', message:'Org has reached max agents (5). Revoke an existing agent or upgrade your plan.', close:true}` and close WS with code 4006.
- **D-11:** **QUOTA-04 (concurrent enforcement)** — at dispatch time: count `task_runs WHERE org_id=X AND state IN ('dispatched','running')`. If `>= orgPlan.max_concurrent_tasks`, the run STAYS queued (D-04 already does this implicitly since dispatcher won't pick it; but add explicit check so the run isn't even queued if `queued + active >= 2*max_concurrent` per D-07).
- **D-12:** **QUOTA-05 (retention config exposure)** — `secret-audit-log.cleanup` job (Phase 11 owns log retention; Phase 10 just exposes `orgPlan.log_retention_days` via the existing GET orgs endpoint). 
- **D-13:** **QUOTA-06 (usage display)** — new endpoint `GET /api/orgs/:orgId/usage` returns `{agents: {used: N, max: 5}, concurrent: {used: X, max: 5}, retention_days: 30}`. Phase 13 UI consumes.

### Agent-Side Dispatch Handler

- **D-14:** **Extend `packages/xci/src/agent/client.ts`** to handle incoming `dispatch` frame:
  1. Parse frame: `{type:'dispatch', run_id, task_snapshot, params, timeout_seconds}`
  2. Send `state` frame `{type:'state', state:'running', run_id}` to confirm acceptance
  3. Spawn task execution using v1's existing executor (`xci/src/executor/`). The agent module IMPORTS the executor (already part of the agent bundle from Phase 8).
  4. Stream stdout/stderr via `log_chunk` frames (Phase 11 wires the actual streaming logic; Phase 10 sends frames with `seq` numbers — the wire format is reserved per Phase 8 D-15)
  5. On exit, send `result` frame `{type:'result', run_id, exit_code, duration_ms}`
  6. Update local state (RunningRunsMap; remove on completion)
- **D-15:** **Concurrency on agent (`agents.max_concurrent`):** if a `dispatch` arrives but agent is already at max, agent sends `{type:'error', code:'AGENT_AT_CAPACITY', run_id}` — server requeues the run.
- **D-16:** **Drain mode honored on agent:** if `agents.state='draining'` (received via `state` frame from server per Phase 8 D-24), agent rejects new dispatches with `AGENT_DRAINING` error frame. Currently-running tasks complete naturally.
- **D-17:** **Param resolution at agent (SEC-06):** agent receives `params` from server (already includes org-secrets resolved). Agent merges its local `.xci/secrets.yml` (loaded via existing v1 config layer) — agent-local wins on collision.
- **D-18:** **Cancel frame handler:** `{type:'cancel', run_id, reason}` → agent locates the running subprocess, sends SIGTERM (5s grace), then SIGKILL. Sends `{type:'result', run_id, exit_code: 130, cancelled: true}` to confirm.

### Timeout Management (DISP-06)

- **D-19:** **Server-side timer per dispatched run.** When a run transitions to `dispatched`, register a `setTimeout(timeoutSeconds * 1000, () => cancelRun(runId, 'timeout'))`. On `result` frame received, cancel the timer.
- **D-20:** **Default timeout 3600s (1h)** per DISP-06; configurable per-task (extend `tasks` table with `default_timeout_seconds int NULLABLE` — null means use system default) and per-run (POST trigger body accepts `timeout_seconds` override).
- **D-21:** **Timeout fired:** server transitions run to `timed_out`, sends `cancel` frame to agent (which kills subprocess + sends result with `cancelled:true`). The result frame is logged but the state stays `timed_out` (not overwritten).
- **D-22:** **Server crash with active timer:** on boot reconciliation (DISP-08), runs in `dispatched`/`running` state with `dispatched_at + timeout_seconds < now()` are immediately marked `timed_out`. Runs still within their timeout window get a fresh setTimeout created.

### Startup Reconciliation (DISP-08)

- **D-23:** **On `app.ready()`:** scan task_runs for active state (queued/dispatched/running):
  1. `queued` → re-add to in-memory dispatch queue (no DB change)
  2. `dispatched`/`running` with `agent_id` whose WS is NOT in `fastify.agentRegistry` → mark `orphaned`, set `finished_at = now()`, set `exit_code = -1` (no result was received). Log to a "system events" channel (Phase 12 audit log candidate).
  3. `dispatched`/`running` whose timeout window has expired → mark `timed_out`, `exit_code = -1`.
  4. `dispatched`/`running` whose agent IS connected → leave alone; agent will reconcile via its own `running_runs` handshake (Phase 8 reconnect_ack).

- **D-24:** **Agent-side reconciliation (Phase 8 reconnect_ack ACTIVE here):**
  - Agent sends `running_runs: [{run_id, started_at}]` in `reconnect` frame.
  - Server cross-references with DB:
    - Agent says running, DB says running → continue (server just keeps the active timer alive)
    - Agent says running, DB says dispatched → server promotes DB to running (reusing Phase 8 D-22 logic)
    - Agent says running, DB says succeeded/failed/cancelled/timed_out/orphaned → server sends `{type:'cancel', run_id, reason:'reconciled_terminal'}` to abort the agent's stale execution
    - Agent reports unknown run_id (no DB record) → server sends `cancel` to abort

### Cancel Flow (DISP-07)

- **D-25:** **Manual cancel endpoint:** `POST /api/orgs/:orgId/runs/:runId/cancel` (Owner/Member + CSRF; can also be the user who triggered if Member). Sets `cancelled_by_user_id`, sends `cancel` frame to the agent, transitions to `cancelled` on agent's result OR after 30s timeout (whichever first).
- **D-26:** **Idempotency:** cancelling an already-terminal run returns 200 with the current state (no-op).

### REST Routes

- **D-27:** **Routes** (`packages/server/src/routes/runs/`):
  - POST `/api/orgs/:orgId/tasks/:taskId/runs` — Owner/Member + CSRF + rate-limit. Body: `{param_overrides?: Record<string,string>, timeout_seconds?: int}`. Resolves params via `dispatch-resolver.ts` (Phase 9), enqueues, returns `{runId, state:'queued'}`.
  - GET `/api/orgs/:orgId/runs` — any member; query params `?state=&taskId=&limit=&since=`. Paginated.
  - GET `/api/orgs/:orgId/runs/:runId` — any member; full row including snapshots.
  - POST `/api/orgs/:orgId/runs/:runId/cancel` — Owner/Member + CSRF. Per D-25.
  - GET `/api/orgs/:orgId/usage` — any member. Per D-13.
- **D-28:** **No DELETE on runs** in Phase 10 — runs are kept for audit; retention applies only to log chunks (Phase 11). v2.1 may add archival.

### Repos

- **D-29:** **New org-scoped repo** `packages/server/src/repos/task-runs.ts`:
  - list, getById, listActiveByAgent, listByState, create (transaction with audit), updateState (atomic CAS via WHERE state=expected), markTerminal (sets exit_code + finished_at)
- **D-30:** **adminRepo additions:**
  - `findRunsForReconciliation()` — boot-time scan for active runs
  - `countConcurrentByOrg(orgId)` — for QUOTA-04 enforcement at dispatch time
  - `countAgentsByOrg(orgId)` — for QUOTA-03 enforcement at registration

- **D-31:** **Auto-discovery isolation tests:** new `task-runs.isolation.test.ts` per Phase 7 D-04 contract.

### Frame Protocol Implementation (extend Phase 8 reservations)

- **D-32:** **`packages/server/src/ws/frames.ts`** — implement parsers for `dispatch`, `cancel`, `result` (Phase 8 D-15 RESERVED these). Hand-rolled discriminated union per existing Phase 8 pattern.
- **D-33:** **`packages/xci/src/agent/client.ts`** — implement handlers for incoming `dispatch`/`cancel` and outgoing `state`/`log_chunk` (placeholder)/`result` frames.
- **D-34:** **Frame schema extensions:**
  ```ts
  | { type: 'dispatch'; run_id: string; task_snapshot: TaskSnapshot; params: Record<string,string>; timeout_seconds: number }
  | { type: 'cancel'; run_id: string; reason: 'manual' | 'timeout' | 'reconciled_terminal' }
  | { type: 'result'; run_id: string; exit_code: number; duration_ms: number; cancelled?: boolean }
  | { type: 'state'; state: 'running'; run_id: string }  // agent → server transition ack
  | { type: 'log_chunk'; run_id: string; seq: number; stream: 'stdout'|'stderr'; data: string; ts: string }  // Phase 11 sends/receives; Phase 10 sends from agent + server discards
  ```

### Schema Migration

- **D-35:** **Migration `0003_task_runs.sql`** — adds task_runs table + agents.max_concurrent column + tasks.default_timeout_seconds column. [BLOCKING] gate.

### Cross-Package Boundary

- **D-36:** **xci agent imports from xci internal** (NOT through xci/dsl) — `packages/xci/src/executor/` and `packages/xci/src/resolver/` are imported by `packages/xci/src/agent/` directly (same package). This is fine; both live in xci. The Phase 9 D-37 cross-package fence applies only to server↔xci, not to internal xci-↔-xci imports.
- **D-37:** **Server uses `xci/dsl` for task validation only** (already wired in Phase 9). Server does NOT use the executor — execution always happens on the agent.

### Backward Compat

- **D-38:** **v1 fence:** `pnpm --filter xci test` (302 + Phase 8 + Phase 9 ~328) still passes after every plan.
- **D-39:** **Cold-start gate (<300ms)** — agent module grows substantially (now includes dispatch handler + executor invocation + log streaming framework), but it's lazy-loaded so cli.mjs cold-start unchanged.

### Testing Strategy

- **D-40:** **Unit tests:** dispatch-resolver invocation patterns, label-matcher logic, state machine transitions, queue FIFO + back-pressure, timeout timer registration/cancellation.
- **D-41:** **Integration tests** (Linux + Docker):
  - Full dispatch happy path: trigger → queued → dispatched → agent receives → state ack → result → succeeded
  - Timeout: dispatch with timeout_seconds=1, run sleeps 5s, server sends cancel after 1s, run marked timed_out
  - Cancel: trigger run that sleeps 60s, cancel via REST, verify cancelled state + exit_code 130
  - Quota registration: register 6th agent on Free plan → rejected with quota error + WS close 4006
  - Quota concurrent: trigger 6 runs, 5 dispatch, 6th stays queued; cancel one, 6th dispatches
  - Reconciliation: dispatch run → kill server mid-run → restart server → run marked orphaned (assuming agent went away too)
  - Param overrides (DISP-09): trigger with overrides → resolved values reach agent (verify via mock executor capture)
  - Label match: 2 agents with different labels, run requires specific label, only matching agent receives dispatch
- **D-42:** **E2E test:** trigger a real task that runs `echo "hello"` on a real spawned xci agent (extends Phase 8 E2E pattern with actual dispatch); verify exit_code 0 + result frame received.

### Claude's Discretion (planner picks)

- Dispatcher tick interval (250ms suggested; planner may tune)
- Whether to add `runs.priority int DEFAULT 0` column for FIFO override (LEAVE OUT — explicit deferred, see <deferred>)
- Whether to emit a structured "system event" log on orphan detection (recommend: pino warn-level log; full audit log deferred)
- Exact pagination shape for runs list (cursor vs offset)

</decisions>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` §Task Dispatch (DISP-01..09) — full state machine, label match, timeout, cancellation, reconciliation, param overrides
- `.planning/REQUIREMENTS.md` §Billing/Quota (QUOTA-03..06) — registration + concurrent + retention config + usage display
- `.planning/REQUIREMENTS.md` §Backward Compatibility (BC-01..04)

### Roadmap
- `.planning/ROADMAP.md` §Phase 10 — 5 success criteria

### Project Vision
- `.planning/PROJECT.md` §Current Milestone v2.0 — dispatch via label matching; in-memory queue + DB reconciliation

### Project Instructions
- `CLAUDE.md` §Technology Stack

### Prior Phase Context
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` — forOrg/adminRepo/CSRF patterns
- `.planning/phases/08-agent-registration-websocket-protocol/08-CONTEXT.md` D-15 — frame envelope (dispatch/cancel/result RESERVED here, IMPLEMENTED in Phase 10); D-22 reconciliation framework (Phase 10 fills); D-37 adminRepo helpers
- `.planning/phases/09-task-definitions-secrets-management/09-CONTEXT.md` D-32..D-35 — dispatch-resolver service that Phase 10 calls; D-37 cross-pkg fence still active
- `.planning/phases/09-task-definitions-secrets-management/09-CLOSEOUT-SUMMARY.md` (or 09-TRACEABILITY.md) — secrets infrastructure ready

### v1 Code (Agent Executor)
- `packages/xci/src/executor/` — single/sequential/parallel execution; agent imports
- `packages/xci/src/resolver/params.ts` — param merging precedence (agent merges local + dispatched)
- `packages/xci/src/config/secrets.ts` — agent-local `.xci/secrets.yml` loader (existing v1)

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 7/8/9 Patterns Inherited
- forOrg + adminRepo (Phase 7 D-01/D-03)
- Auto-discovery isolation meta-test (Phase 7 D-04)
- WS handler open-then-handshake + connection registry (Phase 8 D-13/D-17)
- Reconnect reconciliation framework (Phase 8 D-18 — Phase 10 fills with real run reconciliation)
- Cross-package fence (Phase 9 D-37/D-38) — server uses xci/dsl only
- Dispatch-resolver pure service (Phase 9 D-33) — Phase 10 invokes from POST trigger
- XciServerError hierarchy — extend with `RunNotFoundError`, `RunAlreadyTerminalError`, `RunQuotaExceededError`, `AgentQuotaExceededError`, `NoEligibleAgentError` (the last is logged but doesn't surface to user — just keeps run queued)

### Phase 8 Frame Protocol Reservations Now Active
- `dispatch` (server→agent): IMPLEMENTED in Phase 10
- `cancel` (server→agent): IMPLEMENTED
- `result` (agent→server): IMPLEMENTED
- `log_chunk` (agent→server): WIRED in Phase 10 agent (sends frames); SERVER STORAGE in Phase 11
- `state` (agent→server transition ack): NEW in Phase 10

### Integration Points
- `packages/xci/src/agent/client.ts` — extend with dispatch/cancel handlers + result/log_chunk emitters
- `packages/xci/src/agent/state.ts` — extend RunningRunsMap with real run tracking
- `packages/xci/src/agent/index.ts` — wire dispatch handler to v1 executor
- `packages/server/src/db/schema.ts` — add task_runs table + extend agents.max_concurrent + tasks.default_timeout_seconds
- `packages/server/src/repos/index.ts` — add task-runs repo
- `packages/server/src/routes/runs/` — new route directory
- `packages/server/src/services/dispatcher.ts` — new dispatcher service (DispatchQueue + tick + selector)
- `packages/server/src/services/reconciler.ts` — new boot-time reconciliation service
- `packages/server/src/ws/handler.ts` — extend for dispatch/cancel/result/state frame routing
- `packages/server/src/ws/frames.ts` — extend with new frame types

</code_context>

<specifics>
## Specific Ideas

- **Task snapshot stored at dispatch time (D-01)** is critical for reproducibility. If the user updates the task's yaml_definition while a run is in queued/dispatched state, the run uses the OLD definition — predictable behavior.

- **In-memory queue + DB reconciliation (D-04)** is the right balance for v2.0 single-instance. A pure-DB queue (`SELECT FOR UPDATE SKIP LOCKED`) would scale to multi-instance but adds complexity. In-memory is fast (250ms tick), DB-backed for crash safety.

- **State transitions via atomic UPDATE WHERE current_state = expected_state (D-02)** prevents race conditions where two server replicas (post-v2.0) might both try to dispatch the same run. Phase 10 is single-instance but the discipline costs nothing.

- **Timeout timer in setTimeout (D-19)** is per-process; server crash loses timers — but D-22 boot-time check catches this. Acceptable.

- **DISP-08 second clause "ri-queued (o marcati orphaned se non recuperabili)"** — interpretation: if the agent that took the dispatch is no longer connected AND the run never reached `running` state (no `state` ack received), it's recoverable → re-queue. If it reached `running`, it might have side-effected things (file writes, deploys) — mark orphaned and let a human investigate.

- **Quota error UX (QUOTA-03/04):** include the limit + current count in the error message so the user knows exactly what to do. Bad: "quota exceeded". Good: "Org has 5 of 5 agents (Free plan limit). Revoke an agent or contact support."

- **The dispatcher's 250ms tick interval is generous.** Trigger latency: user clicks "Run" → POST returns immediately with state=queued; the next dispatcher tick (within 250ms) picks it up. Total perceived latency <500ms even on cold paths.

</specifics>

<deferred>
## Deferred Ideas

- **Run priority / queue jumping** — out of scope; FIFO only in v2.0
- **Distributed dispatcher (multi-instance)** — single-instance v2.0; revisit if scaling forces
- **`SELECT FOR UPDATE SKIP LOCKED` queue** — same; in-memory + DB reconciliation suffices
- **Run retry with backoff** — no retry; user manually re-triggers (creates new run)
- **Run archival / soft-delete after N days** — runs kept indefinitely in v2.0; revisit retention later
- **Webhook trigger source** — Phase 12 owns
- **Scheduler / cron triggers** — out of scope for v2.0
- **Agent affinity / sticky dispatch (always same agent for same task)** — out of scope; least-busy + round-robin only
- **Run dependencies / pipelines (run B after run A succeeds)** — out of scope (the `tasks` themselves can express sequential composition; pipeline-of-runs is different)
- **Real-time UI updates of run state** — Phase 13 (UI) + Phase 11 (log streaming) own this
- **Per-org dispatch isolation (different worker pools)** — single dispatcher serves all orgs in v2.0
- **Quota upgrade UI** — QUOTA-07 explicitly defers this; Free plan only
- **Audit log for run trigger/cancel actions** — log via pino; no dedicated table in Phase 10

### Reviewed Todos (not folded)
None.

</deferred>

---

*Phase: 10-dispatch-pipeline-quota-enforcement*
*Context gathered: 2026-04-19*
*Mode: auto-selected (user requested autonomous chain to milestone end)*
