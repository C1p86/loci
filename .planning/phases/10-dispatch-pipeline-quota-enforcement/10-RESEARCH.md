# Phase 10: Dispatch Pipeline & Quota Enforcement - Research

**Researched:** 2026-04-18
**Domain:** WebSocket frame protocol, in-memory task queue, Drizzle CAS state machine, execa subprocess kill, Fastify plugin lifecycle
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All 42 decisions in 10-CONTEXT.md are locked. Key ones for planning:
- D-01/D-02: `task_runs` schema + state machine
- D-04/D-05: In-memory DispatchQueue + 250ms setInterval tick
- D-08: Label-match selector in `services/agent-selector.ts`
- D-09: `agents.max_concurrent` column added here
- D-10/D-11: Quota enforcement at WS handshake + dispatch time
- D-14/D-18: Agent-side dispatch + cancel handlers
- D-19/D-22: Server-side per-run setTimeout; crash-safe boot reconciliation
- D-23/D-24: Startup reconciliation logic + agent reconnect reconciliation
- D-27: REST routes under `packages/server/src/routes/runs/`
- D-29/D-30: `repos/task-runs.ts` + adminRepo additions
- D-32/D-33: Frame protocol implemented in frames.ts + agent/client.ts
- D-35: Migration `0003_task_runs.sql` is BLOCKING gate
- D-36/D-37: Cross-package boundary — xci agent imports xci/executor directly; server uses xci/dsl only
- D-40/D-41/D-42: Testing strategy (unit + integration + E2E)

### Claude's Discretion
- Dispatcher tick interval (250ms suggested)
- Structured "system event" log on orphan detection (recommend: pino warn-level)
- Exact pagination shape for runs list (cursor vs offset)

### Deferred Ideas (OUT OF SCOPE)
- Run priority / queue jumping
- Distributed dispatcher (multi-instance)
- SELECT FOR UPDATE SKIP LOCKED queue
- Run retry with backoff
- Run archival / soft-delete
- Webhook trigger source (Phase 12)
- Scheduler / cron triggers
- Agent affinity / sticky dispatch
- Run dependencies / pipelines
- Real-time UI updates of run state (Phase 13)
- Per-org dispatch isolation
- Quota upgrade UI
- Audit log for run trigger/cancel actions (pino log only)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISP-01 | In-memory dispatch queue on server | DispatchQueue class + setInterval tick pattern (FA-2) |
| DISP-02 | Label-match selector: online + all label_requirements satisfied; least-busy; round-robin tiebreak | Drizzle JSONB sql`` pattern for label filter (FA-3); COUNT subquery for least-busy |
| DISP-03 | `dispatch` frame to agent with run_id, task snapshot, params, timeout | Frame schema extension pattern (FA-6) |
| DISP-04 | TaskRun persisted with full state machine | CAS UPDATE WHERE state=expected (FA-1) |
| DISP-05 | Per-agent concurrency default 1; per-org plan limit | `agents.max_concurrent` column + quota count query (FA-10) |
| DISP-06 | Timeout default 1h; expired → cancel frame + timed_out | setTimeout map per run (FA-4) |
| DISP-07 | Manual cancel via REST → cancel frame → cancelled state | POST /runs/:runId/cancel route (FA-11) |
| DISP-08 | Boot reconciliation: queued/dispatched without agent → re-queue or orphaned | fastify.ready() hook ordering (FA-5) |
| DISP-09 | Run with param overrides — no task mutation | dispatch-resolver.ts already implements this (FA-1 + dispatch-resolver.ts) |
| QUOTA-03 | Registration enforcement: max_agents check at WS handshake | Extend handler.ts register branch (FA-9) |
| QUOTA-04 | Concurrent enforcement: dispatch over limit stays queued; queue depth limit → 429 | adminRepo.countConcurrentByOrg (FA-10) |
| QUOTA-05 | Retention config exposure via GET orgs endpoint | `orgPlan.log_retention_days` already in schema; Phase 10 exposes via /usage |
| QUOTA-06 | Usage display endpoint GET /api/orgs/:orgId/usage | New route returning {agents, concurrent, retention_days} |
</phase_requirements>

---

## Executive Summary

Phase 10 wires the dispatch pipeline by (1) adding the `task_runs` table with its 8-state machine guarded by atomic CAS updates, (2) building a DispatchQueue service with a 250ms setInterval tick that pulls from an in-memory FIFO and pushes `dispatch` frames to the winning agent, (3) implementing the full frame protocol on both server and agent sides, (4) managing per-run timeouts via a `Map<runId, NodeJS.Timeout>` with crash-safe reconciliation at boot, and (5) enforcing QUOTA-03/04 at WS handshake and dispatch time. The v1 executor (`packages/xci/src/executor/`) is invoked directly by the agent — the server never touches execution. No new npm packages are needed: execa, Drizzle, ws, and @fastify/websocket already cover every requirement.

**Primary recommendation:** Schema migration first (blocking gate), then frame protocol + repos, then dispatcher service, then REST routes, then agent-side handlers, then reconciliation + quota closeout.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TaskRun state machine | API / Backend (DB) | — | CAS updates must be atomic in Postgres; in-memory state is ephemeral |
| In-memory dispatch queue | API / Backend (process) | DB (crash recovery) | Single-instance; DB backs crash recovery |
| Label-match selector | API / Backend | — | Needs DB query for agent online state + concurrency counts |
| Timeout timer | API / Backend (process) | DB (boot reconciliation) | setTimeout per run in server process; DB provides truth on restart |
| Frame routing (dispatch/cancel/result) | API / Backend (WS) | — | Server-to-agent WS; agent reports results back |
| Task execution | Agent (xci) | — | Executor runs locally on agent; server delegates entirely |
| Log chunk emission | Agent (xci) | — | Phase 10 sends frames; Phase 11 stores/fans out |
| Quota enforcement | API / Backend | — | Server-side only; agent enforces concurrency per D-15 |
| Param resolution | API / Backend (pure fn) | Agent (agent-local secrets) | dispatch-resolver.ts resolves server-side params; agent merges local secrets |

---

## Library Version Table (no new libraries needed)

All required libraries are already declared in existing packages. Confirmed via codebase inspection:

[VERIFIED: packages/server/package.json + packages/xci/package.json]

| Library | Version in Use | Purpose in Phase 10 | New? |
|---------|---------------|---------------------|------|
| drizzle-orm | existing | CAS UPDATE, COUNT queries, schema | No |
| drizzle-kit | existing (devDep) | Generate `0003_task_runs.sql` migration | No |
| execa | 9.x | Agent subprocess kill (SIGTERM/SIGKILL) | No |
| ws | 8.x | WS send/close in handler.ts | No |
| @fastify/websocket | 11.x | WS frame routing | No |
| yaml | 2.x | Agent parses task_snapshot.yaml_definition | No |

**No `npm install` required for Phase 10.** Every dependency was introduced in Phases 7–9.

---

## Focus Area Patterns

### FA-1: TaskRun State Machine — Atomic CAS Transitions

**Pattern:** Drizzle UPDATE with WHERE clause on current state prevents concurrent races.

```typescript
// [VERIFIED: existing admin.ts consumeRegistrationToken pattern — same CAS discipline]
// packages/server/src/repos/task-runs.ts

import { and, eq, inArray, sql } from 'drizzle-orm';
import { taskRuns } from '../db/schema.js';

// Atomic CAS: only transitions if run is currently in expectedState.
// Returns the updated row, or undefined if the guard failed (another writer won).
async function updateState(
  db: PostgresJsDatabase,
  runId: string,
  expectedState: TaskRunState,
  newState: TaskRunState,
  extra?: Partial<NewTaskRun>,
): Promise<TaskRun | undefined> {
  const rows = await db
    .update(taskRuns)
    .set({ state: newState, updatedAt: sql`now()`, ...extra })
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.state, expectedState)))
    .returning();
  return rows[0];
}

// Usage: transition queued → dispatched when dispatcher picks a run
const updated = await updateState(db, runId, 'queued', 'dispatched', {
  agentId,
  dispatchedAt: sql`now()`,
});
if (!updated) {
  // Another tick already dispatched this run — skip
  return;
}
```

**Gotcha:** When `updated` is undefined after a CAS update, it means either (a) the run was already dispatched by a concurrent tick or (b) the runId doesn't exist. Both cases: silently skip, dequeue, continue. Do NOT retry with a different state — that defeats the guard.

**Gotcha:** `running → cancelled` and `running → timed_out` can race if the result frame and a cancel frame arrive near simultaneously. The CAS guard handles this: whichever writer commits first wins. The loser gets `undefined` back and just logs at debug level.

---

### FA-2: In-Memory Dispatch Queue + setInterval Tick

**Pattern:** `DispatchQueue` class registered as `fastify.dispatchQueue`. Timer started in `onReady` hook, stopped in `onClose`.

```typescript
// [ASSUMED - pattern derived from Fastify lifecycle docs + project conventions]
// packages/server/src/services/dispatcher.ts

export interface QueueEntry {
  runId: string;
  orgId: string;
  taskSnapshot: TaskSnapshot;
  params: Record<string, string>;
  labelRequirements: string[]; // ["os=linux", "arch=x64"]
  timeoutSeconds: number;
}

export class DispatchQueue {
  private queue: QueueEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastDispatchedAgentCursor = new Map<string, string>(); // orgId → lastAgentId

  enqueue(entry: QueueEntry): void {
    this.queue.push(entry);
  }

  dequeue(runId: string): void {
    this.queue = this.queue.filter((e) => e.runId !== runId);
  }

  countByOrg(orgId: string): number {
    return this.queue.filter((e) => e.orgId === orgId).length;
  }

  start(tickFn: () => Promise<void>, intervalMs = 250): void {
    if (this.timer) return; // idempotent
    this.timer = setInterval(() => { void tickFn(); }, intervalMs);
    // Unref: don't prevent process exit if only this timer remains
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// Fastify plugin to attach + lifecycle hooks
async function dispatcherPlugin(fastify: FastifyInstance) {
  const queue = new DispatchQueue();
  fastify.decorate('dispatchQueue', queue);

  fastify.addHook('onReady', async () => {
    // Boot reconciliation BEFORE starting tick (see FA-5)
    await runBootReconciliation(fastify);
    queue.start(() => tickDispatcher(fastify), 250);
  });

  fastify.addHook('onClose', async () => {
    queue.stop();
  });
}
```

**Gotcha — timer.unref():** Without `.unref()` on the setInterval, the Node process will never exit cleanly if the Fastify close hook somehow doesn't fire (e.g. test cleanup). Add `.unref()` immediately after creating the timer. [VERIFIED: Node.js timer docs — `timer.unref()` is standard for background timers]

**Gotcha — tick overlap:** If a tick takes longer than 250ms (e.g., DB is slow), the next tick fires before the first completes. Guard with a `ticking = false` flag and skip the tick if `ticking` is true:

```typescript
let ticking = false;
async function tickDispatcher(fastify: FastifyInstance) {
  if (ticking) return;
  ticking = true;
  try {
    await processQueue(fastify);
  } finally {
    ticking = false;
  }
}
```

---

### FA-3: Label-Match Selector Algorithm + JSONB Query

The label filter must check that ALL `key=value` requirements in the task are satisfied by the agent's `labels` JSONB column. Two viable approaches:

**Approach A (recommended): SQL filter with Drizzle `sql` template**

```typescript
// [VERIFIED: Drizzle JSONB column definition in codebase — agents.labels is jsonb.$type<Record<string,string>>()]
// [CITED: https://github.com/drizzle-team/drizzle-orm-docs — sql template for custom operators]
// packages/server/src/services/agent-selector.ts

import { and, eq, lt, sql } from 'drizzle-orm';
import { agents, taskRuns } from '../db/schema.js';

export async function selectEligibleAgent(
  db: PostgresJsDatabase,
  orgId: string,
  labelRequirements: string[], // ["os=linux", "arch=x64"]
  maxConcurrent: number, // will be overridden per-agent from DB
): Promise<string | null> {
  // Build JSONB containment checks for each label requirement
  // Postgres @> operator: left JSONB contains right JSONB
  // agents.labels @> '{"os":"linux","arch":"x64"}'::jsonb
  const reqObject: Record<string, string> = {};
  for (const req of labelRequirements) {
    const idx = req.indexOf('=');
    if (idx === -1) continue;
    reqObject[req.slice(0, idx)] = req.slice(idx + 1);
  }
  const labelJson = JSON.stringify(reqObject);

  // Subquery: count active runs per agent
  const activeRunsSq = db
    .select({ agentId: taskRuns.agentId, cnt: sql<number>`count(*)::int`.as('cnt') })
    .from(taskRuns)
    .where(inArray(taskRuns.state, ['dispatched', 'running']))
    .groupBy(taskRuns.agentId)
    .as('active_runs');

  const candidates = await db
    .select({
      agentId: agents.id,
      maxConcurrent: agents.maxConcurrent,
      activeCount: sql<number>`coalesce(${activeRunsSq.cnt}, 0)`,
    })
    .from(agents)
    .leftJoin(activeRunsSq, eq(agents.id, activeRunsSq.agentId))
    .where(
      and(
        eq(agents.orgId, orgId),
        eq(agents.state, 'online'),
        sql`${agents.lastSeenAt} > now() - interval '60 seconds'`,
        sql`${agents.labels} @> ${labelJson}::jsonb`,
        // Per-agent concurrency filter: active < max_concurrent
        sql`coalesce(${activeRunsSq.cnt}, 0) < ${agents.maxConcurrent}`,
      ),
    )
    .orderBy(sql`coalesce(${activeRunsSq.cnt}, 0) ASC`); // least-busy first

  return candidates[0]?.agentId ?? null;
}
```

**Gotcha — `draining` state:** The D-08 says `state column != 'draining'`. Since the state column enum is `'online' | 'offline' | 'draining'`, `eq(agents.state, 'online')` alone excludes both offline and draining. Correct — no extra filter needed.

**Gotcha — read-time computation:** The online check `eq(agents.state, 'online') AND last_seen_at > now() - 60s` matches Phase 8 D-12 exactly. Do NOT use `state='online'` alone — a crashed agent retains `state='online'` until the heartbeat timeout fires.

**Approach B (application-level filter):** Load all online agents for the org, filter in TypeScript. Simpler code but N+1 per tick when org has many agents. Use Approach A — the DB can filter efficiently with the `(org_id, state)` index.

---

### FA-4: Per-Run setTimeout Timer + Cleanup

```typescript
// [ASSUMED - standard Node.js pattern]
// packages/server/src/services/dispatcher.ts (or timeout-manager.ts)

const runTimers = new Map<string, NodeJS.Timeout>();

export function registerRunTimer(
  fastify: FastifyInstance,
  runId: string,
  timeoutSeconds: number,
): void {
  const existing = runTimers.get(runId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(
    async () => {
      runTimers.delete(runId);
      await handleRunTimeout(fastify, runId);
    },
    timeoutSeconds * 1000,
  );
  timer.unref(); // don't block process exit
  runTimers.set(runId, timer);
}

export function cancelRunTimer(runId: string): void {
  const timer = runTimers.get(runId);
  if (timer) {
    clearTimeout(timer);
    runTimers.delete(runId);
  }
}

// Called from app onClose and during test teardown
export function clearAllRunTimers(): void {
  for (const timer of runTimers.values()) clearTimeout(timer);
  runTimers.clear();
}

async function handleRunTimeout(fastify: FastifyInstance, runId: string): Promise<void> {
  const db = fastify.db;
  // CAS: only transition from 'running' → 'timed_out' (if still in dispatched, use that state too)
  const updated = await updateStateMulti(db, runId, ['dispatched', 'running'], 'timed_out', {
    finishedAt: sql`now()`,
    exitCode: -1,
  });
  if (!updated) return; // already terminal

  // Send cancel frame if agent is still connected
  const agentId = updated.agentId;
  if (agentId) {
    const ws = fastify.agentRegistry.get(agentId);
    if (ws?.readyState === WS.OPEN) {
      ws.send(JSON.stringify({ type: 'cancel', run_id: runId, reason: 'timeout' }));
    }
  }
  fastify.log.warn({ runId }, 'run timed out');
}
```

**Gotcha — timer memory leak:** The most common leak is registering a timer on `dispatched` and never clearing it when the run finishes. Two clear points: (1) when `result` frame arrives, call `cancelRunTimer(runId)` before the CAS update, (2) on `cancel` REST endpoint, call `cancelRunTimer(runId)` immediately. Also call `clearAllRunTimers()` in the `onClose` Fastify hook.

**Gotcha — large timeout multiplication overflow:** `timeoutSeconds * 1000` for a 1h run = 3,600,000ms. `setTimeout` max is ~24.8 days in Node.js, so 1h is safe. If `timeoutSeconds` is user-provided, cap at 86400 (24h) server-side.

---

### FA-5: Boot-Time Reconciliation + Plugin Ordering

**Plugin registration order matters:** `@fastify/websocket` must be registered BEFORE the WS route handler, and reconciliation must run AFTER the DB connection is ready. The existing `buildApp` already registers `@fastify/websocket` in the plugin chain (Phase 8). The reconciliation runs in `onReady` hook, which fires after all plugins are registered and `app.listen()` is called.

```typescript
// [VERIFIED: existing Phase 8 handler.ts onReady registration comment]
// packages/server/src/services/reconciler.ts

export async function runBootReconciliation(fastify: FastifyInstance): Promise<void> {
  const db = fastify.db;
  const registry = fastify.agentRegistry;

  // Step 1: queued runs → re-add to in-memory queue (no DB change)
  const queuedRuns = await findRunsByState(db, ['queued']);
  for (const run of queuedRuns) {
    fastify.dispatchQueue.enqueue(toQueueEntry(run));
  }
  fastify.log.info({ count: queuedRuns.length }, 'reconciliation: re-queued runs');

  // Step 2: dispatched/running runs — check if agent is still connected
  const activeRuns = await findRunsByState(db, ['dispatched', 'running']);
  for (const run of activeRuns) {
    const agentConnected = run.agentId && registry.has(run.agentId);

    // Check if timeout window has already expired
    if (run.agentId && run.dispatchedAt) {
      const dispatchedMs = new Date(run.dispatchedAt).getTime();
      const expiresAt = dispatchedMs + run.timeoutSeconds * 1000;
      if (Date.now() > expiresAt) {
        // Timeout expired during server downtime
        await updateStateMulti(db, run.id, ['dispatched', 'running'], 'timed_out', {
          finishedAt: sql`now()`,
          exitCode: -1,
        });
        fastify.log.warn({ runId: run.id }, 'reconciliation: run timeout expired during downtime');
        continue;
      }
    }

    if (agentConnected) {
      // Agent is online — register remaining timeout and let it continue
      const elapsed = Date.now() - new Date(run.dispatchedAt!).getTime();
      const remaining = Math.max(1, run.timeoutSeconds - Math.floor(elapsed / 1000));
      registerRunTimer(fastify, run.id, remaining);
    } else {
      // Agent gone — orphan if it reached 'running' (may have side-effected); re-queue if only 'dispatched'
      if (run.state === 'dispatched') {
        await updateState(db, run.id, 'dispatched', 'queued');
        fastify.dispatchQueue.enqueue(toQueueEntry(run));
        fastify.log.info({ runId: run.id }, 'reconciliation: re-queued dispatched run (agent gone)');
      } else {
        // running → orphaned (had side effects)
        await updateState(db, run.id, 'running', 'orphaned', {
          finishedAt: sql`now()`,
          exitCode: -1,
        });
        fastify.log.warn({ runId: run.id }, 'reconciliation: orphaned running run (agent gone)');
      }
    }
  }
}
```

**Gotcha — plugin ordering:** The dispatcher plugin (which calls `runBootReconciliation` in `onReady`) must be registered AFTER the DB plugin AND after `@fastify/websocket`. The existing Phase 8 plugin chain: `env → db → helmet → cookie → csrf → rate-limit → auth → error-handler → websocket-plugin → routes`. Add dispatcher plugin AFTER websocket-plugin so `fastify.agentRegistry` is available when reconciliation runs.

**Gotcha — `onReady` vs `addHook('onReady')`:** `fastify.ready()` fires after ALL plugins register. If reconciliation uses `fastify.agentRegistry` (populated by the WS connection handler), it will be empty on a fresh boot — agents haven't connected yet. Reconciliation only re-queues/orphans existing DB rows; it does NOT depend on the registry being populated. The registry check (`registry.has(agentId)`) in reconciliation will always be false on fresh boot, correctly orphaning runs. This is the intended behavior per D-23.

---

### FA-6: Frame Protocol Extensions

**Server-side frames.ts additions** — extend the existing discriminated union pattern. The existing parser throws for `dispatch`/`cancel`/`result` types (Phase 8 placeholder). Phase 10 implements them:

```typescript
// [VERIFIED: packages/server/src/ws/frames.ts Phase 8 RESERVED pattern]
// packages/server/src/ws/types.ts — add to AgentIncomingFrame:

// Extend AgentIncomingFrame (agent → server):
| { type: 'state'; state: 'running'; run_id: string }
| { type: 'result'; run_id: string; exit_code: number; duration_ms: number; cancelled?: boolean }
| { type: 'log_chunk'; run_id: string; seq: number; stream: 'stdout' | 'stderr'; data: string; ts: string }

// Extend ServerOutgoingFrame (server → agent):
| { type: 'dispatch'; run_id: string; task_snapshot: TaskSnapshot; params: Record<string,string>; timeout_seconds: number }
| { type: 'cancel'; run_id: string; reason: 'manual' | 'timeout' | 'reconciled_terminal' }
```

**Frame routing in handler.ts** — after authentication, incoming frames are routed by type. Add below the existing `goodbye` handler:

```typescript
// In the authenticated branch of socket.on('message', ...) in handler.ts:
if (frame.type === 'state' && conn) {
  await handleStateAck(fastify, conn, frame);
  return;
}
if (frame.type === 'result' && conn) {
  await handleResultFrame(fastify, conn, frame);
  return;
}
if (frame.type === 'log_chunk' && conn) {
  // Phase 10: receive and discard (Phase 11 stores)
  // Still update last_seen_at (already done above for all authenticated frames)
  return;
}
```

**`handleStateAck`** — `dispatched → running` transition:
```typescript
async function handleStateAck(fastify, conn, frame) {
  await updateState(fastify.db, frame.run_id, 'dispatched', 'running', {
    startedAt: sql`now()`,
  });
}
```

**`handleResultFrame`** — transitions to terminal state:
```typescript
async function handleResultFrame(fastify, conn, frame) {
  cancelRunTimer(frame.run_id); // FA-4 cleanup FIRST
  const targetState = frame.cancelled ? 'cancelled' : (frame.exit_code === 0 ? 'succeeded' : 'failed');
  // But if state is already 'timed_out', don't overwrite
  await updateStateMulti(fastify.db, frame.run_id, ['running', 'dispatched'], targetState, {
    exitCode: frame.exit_code,
    finishedAt: sql`now()`,
  });
}
```

**Gotcha — frame routing to wrong run:** The `run_id` in incoming frames must be validated against the `conn.orgId`. A compromised agent must not be able to send a result for a run_id belonging to another org. Add: `await taskRunsRepo.verifyBelongsToOrg(frame.run_id, conn.orgId)` before processing any result/state frame. Return error frame + ignore if mismatch.

---

### FA-7: Agent-Side Executor Invocation + Log Chunk Streaming

The v1 executor (`packages/xci/src/executor/`) uses `execa` with `stdout: 'pipe'` / `stderr: 'pipe'` and registers `data` event listeners. Phase 10 intercepts these streams to emit `log_chunk` frames.

**Key insight from reading `executor/single.ts`:** The existing `runSingle` function pipes stdout/stderr through `proc.stdout.on('data', ...)` listeners when `useInherit` is false. The agent must use `stdout: 'pipe'` mode (pass `showOutput: false` to suppress terminal output, or create a custom wrapper).

**Recommended approach — spawn directly from the agent, not through the existing executor:**

The v1 executor.run() is designed for CLI use (it calls `printStepHeader`, writes to `process.stdout`). For agent dispatch, the agent should call execa directly with streaming hooks, rather than reusing the high-level executor.run(). The shared logic to reuse is the YAML parsing (`xci/dsl`) and param merging, not the execution layer.

```typescript
// [VERIFIED: packages/xci/src/executor/single.ts — execa with stdout/stderr pipe pattern]
// packages/xci/src/agent/runner.ts — NEW file in Phase 10

import { execa } from 'execa';

export interface RunnerOptions {
  argv: readonly string[];
  cwd: string;
  env: Record<string, string>;
  onChunk: (stream: 'stdout' | 'stderr', data: string, seq: number) => void;
  onExit: (exitCode: number) => void;
  timeoutMs: number;
}

export interface RunHandle {
  cancel: () => Promise<void>;
}

export function spawnTask(opts: RunnerOptions): RunHandle {
  const [cmd, ...args] = opts.argv;
  if (!cmd) throw new Error('empty argv');

  let seq = 0;
  const proc = execa(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
  });

  proc.stdout?.on('data', (chunk: Buffer) => {
    opts.onChunk('stdout', chunk.toString('utf8'), seq++);
  });
  proc.stderr?.on('data', (chunk: Buffer) => {
    opts.onChunk('stderr', chunk.toString('utf8'), seq++);
  });

  void proc.then((result) => {
    opts.onExit(result.exitCode ?? 1);
  });

  return {
    async cancel(): Promise<void> {
      proc.kill('SIGTERM');
      const forceKill = setTimeout(() => proc.kill('SIGKILL'), 5000);
      try {
        await proc;
      } catch { /* expected */ } finally {
        clearTimeout(forceKill);
      }
    },
  };
}
```

**Important:** The `seq` counter must be monotonically increasing per run, not global. Store `seq` in a per-run context, not shared state.

---

### FA-8: Subprocess Kill on Cancel (SIGTERM → SIGKILL)

```typescript
// [VERIFIED: packages/xci/src/executor/single.ts killAndWait function]
// [CITED: https://github.com/sindresorhus/execa/blob/main/docs/termination.md — subprocess.kill API]
// The existing killAndWait in single.ts already implements this pattern for Unix + Windows.

// For agent dispatch, the RunHandle.cancel() in FA-7 above is the clean version.
// Key points from execa 9.x docs:
//   subprocess.kill()           → SIGTERM (default, handleable)
//   subprocess.kill('SIGKILL')  → SIGKILL (force, 5s grace from SIGTERM)
//   subprocess.pid              → access PID for external tools if needed

// On Windows: execa does NOT automatically kill the process tree.
// Must use: execSync(`taskkill /f /t /pid ${proc.pid}`, { stdio: 'pipe' })
// This pattern already exists in executor/single.ts killAndWait — reuse it.

const IS_WINDOWS = process.platform === 'win32';

async function cancelAndWait(proc: ResultPromise): Promise<void> {
  if (IS_WINDOWS && proc.pid) {
    try {
      execSync(`taskkill /f /t /pid ${proc.pid}`, { stdio: 'pipe' });
    } catch { /* already exited */ }
  } else {
    proc.kill('SIGTERM');
  }
  const forceTimer = setTimeout(() => {
    IS_WINDOWS && proc.pid
      ? (try { execSync(`taskkill /f /t /pid ${proc.pid}`, { stdio: 'pipe' }); } catch {})
      : proc.kill('SIGKILL');
  }, 5_000);
  try {
    await proc;
  } catch { /* expected */ } finally {
    clearTimeout(forceTimer);
  }
}
```

---

### FA-9: Quota Enforcement at WS Handshake (QUOTA-03)

In `handleHandshake` in `handler.ts`, extend the `register` branch BEFORE calling `registerNewAgent`:

```typescript
// [VERIFIED: packages/server/src/ws/handler.ts handleHandshake — register branch]
// Insert AFTER consumeRegistrationToken, BEFORE registerNewAgent:

const plan = await repos.forOrg(orgId).orgPlans.getByOrg(orgId);
const agentCount = await repos.admin.countAgentsByOrg(orgId);
if (agentCount >= plan.maxAgents) {
  send(socket, {
    type: 'error',
    code: 'AGENT_QUOTA_EXCEEDED',
    message: `Org has ${agentCount} of ${plan.maxAgents} agents (${plan.planName} plan limit). Revoke an agent or upgrade.`,
    close: true,
  });
  socket.close(4006, 'quota_exceeded');
  return null;
}
```

**Gotcha — TOCTOU race:** Between `countAgentsByOrg` and `registerNewAgent`, another concurrent registration could succeed. Mitigate by wrapping the count check + insert in `registerNewAgent` as a DB-level constraint (a trigger or a Postgres function), or accept the rare off-by-one for v2.0 (single-instance; race probability negligible). The existing `signupTx` pattern (PG unique violation catches races) is the model for this.

**New close code 4006:** Phase 8 defines close codes 4001–4005. Phase 10 adds 4006 for quota exceeded. Document in the ws/handler.ts constants comment block.

---

### FA-10: Concurrent Count Query (QUOTA-04)

```typescript
// [ASSUMED - standard Drizzle COUNT pattern]
// packages/server/src/repos/admin.ts additions (D-30):

async countConcurrentByOrg(orgId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.orgId, orgId),
        inArray(taskRuns.state, ['dispatched', 'running']),
      ),
    );
  return rows[0]?.count ?? 0;
},

async countAgentsByOrg(orgId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agents)
    .where(eq(agents.orgId, orgId));
  return rows[0]?.count ?? 0;
},
```

**Should this be cached?** No. The count query is fast on the `(org_id, state)` index, cold-path (registration and dispatch trigger). Caching adds invalidation complexity for negligible gain. The `(org_id, state)` index from Phase 8 schema handles this efficiently.

---

### FA-11: Reconnect Reconciliation (Phase 8 D-18 stub ACTIVATED)

The Phase 8 `handleHandshake` for `reconnect` type sends `reconciliation: []` (stub). Phase 10 fills it. In `handler.ts`, after successful credential validation:

```typescript
// Replace the stub in handleHandshake reconnect branch:
const runningRuns = frame.running_runs; // from agent's handshake
const reconciliation: ReconcileEntry[] = [];

for (const agentRun of runningRuns) {
  const dbRun = await repos.forOrg(orgId).taskRuns.getById(agentRun.run_id);
  if (!dbRun) {
    // Unknown run — agent should abort it
    reconciliation.push({ run_id: agentRun.run_id, action: 'abandon' });
  } else if (['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned'].includes(dbRun.state)) {
    reconciliation.push({ run_id: agentRun.run_id, action: 'abandon' });
  } else {
    // DB says active — agent continues; promote dispatched → running if needed
    if (dbRun.state === 'dispatched') {
      await updateState(db, agentRun.run_id, 'dispatched', 'running', { startedAt: sql`now()` });
    }
    // Restore timer for remaining window
    const dispatchedAt = dbRun.dispatchedAt ? new Date(dbRun.dispatchedAt).getTime() : Date.now();
    const elapsed = Math.floor((Date.now() - dispatchedAt) / 1000);
    const remaining = Math.max(1, dbRun.timeoutSeconds - elapsed);
    registerRunTimer(fastify, agentRun.run_id, remaining);
    reconciliation.push({ run_id: agentRun.run_id, action: 'continue' });
  }
}
send(socket, { type: 'reconnect_ack', reconciliation });
```

---

### FA-12: Cross-Package Import Boundary

[VERIFIED: Phase 9 D-37/D-38 Biome rules in biome.json; agent/index.ts imports from ./executor/ within xci]

- `packages/xci/src/agent/` → `packages/xci/src/executor/` : **ALLOWED** (same package, internal import)
- `packages/xci/src/agent/` → `packages/xci/src/dsl/` : **ALLOWED** (same package)
- `packages/server/src/` → `xci/dsl` : **ALLOWED** (existing Phase 9 fence)
- `packages/server/src/` → `xci` (root) or `xci/agent` : **FORBIDDEN** (Phase 9 D-37 Biome rule)
- `packages/xci/src/` → `@xci/server` : **FORBIDDEN** (Phase 9 D-38 Biome rule)

The agent DOES NOT import `@xci/server`; it gets all task/run information from the WS frame payload.

---

## Common Pitfalls

### Pitfall 1: Timer Not Cleared on Result Frame
**What goes wrong:** A `result` frame arrives from the agent for run X. The handler transitions the state but forgets to call `cancelRunTimer(runId)`. The setTimeout fires 1h later, tries to transition a terminal run, CAS returns undefined (correct), but the timer Map entry was never freed — memory leak accumulates over days.
**Prevention:** Call `cancelRunTimer(runId)` as the FIRST action in `handleResultFrame`, before any DB writes. Also call it in the cancel REST handler.

### Pitfall 2: CAS Race Not Handled — Silent Double Dispatch
**What goes wrong:** Two tick cycles run concurrently (if tick takes >250ms and the reentrancy guard is missing). Both read the same queued run, both try to CAS `queued → dispatched`. One succeeds; the other gets `undefined`. If the losing tick doesn't check the CAS result, it sends a second `dispatch` frame to a second agent.
**Prevention:** The `ticking` guard in FA-2 prevents concurrent ticks. Additionally, always check the CAS return value before sending the frame. Only send the `dispatch` frame if the CAS succeeded.

### Pitfall 3: JSONB Label Filter Missing `draining` Exclusion
**What goes wrong:** The label selector uses `eq(agents.state, 'online')` but the online check also requires `last_seen_at > now() - 60s`. Forgetting the last_seen_at filter dispatches to stale agents that are `state='online'` but haven't pinged in hours.
**Prevention:** Always AND both conditions: `eq(agents.state, 'online') AND last_seen_at > now() - interval '60 seconds'`.

### Pitfall 4: Boot Reconciliation Runs Before DB Plugin Is Ready
**What goes wrong:** Reconciliation is triggered in a route hook or early in plugin setup, before the DB pool is fully connected. Any DB query panics.
**Prevention:** Use `addHook('onReady', ...)` exclusively for reconciliation. `onReady` fires only after all plugins (including the DB plugin) have fully registered.

### Pitfall 5: Agent Sends Result for Wrong Org's Run
**What goes wrong:** A compromised or buggy agent sends `{type:'result', run_id: 'xci_run_OTHER_ORG'}`. The handler doesn't verify org scope, marks the run terminal, and the correct owner sees their run fail.
**Prevention:** After parsing a result/state frame, verify `taskRuns WHERE id=run_id AND org_id=conn.orgId`. If mismatch, send error frame + log warn + ignore.

### Pitfall 6: Reconciliation Re-Queues Orphaned `running` Runs
**What goes wrong:** A run reached `running` state (agent sent state ack), server crashes, agent also crashes. On restart, reconciliation re-queues the run thinking it's recoverable. But the agent already executed half the task — re-running causes double side-effects (double deploy, double send, etc.).
**Prevention:** Per D-23 interpretation: only re-queue `dispatched` runs (no state ack received, likely no side effects). Mark `running` runs as `orphaned`. This is locked in D-23 — ensure the implementation matches.

### Pitfall 7: log_chunk Frames Flood the Handler Without Backpressure
**What goes wrong:** A verbose task generates thousands of log_chunk frames/second. The Phase 10 handler receives all of them and just discards them. But each frame still triggers `recordHeartbeat(agentId)` (the `conn &&` branch in handler.ts), creating DB write pressure.
**Prevention:** Move `recordHeartbeat` to execute at most once per 5s (debounce) rather than on every message. Or skip heartbeat update for `log_chunk` frames specifically (they don't affect the agent-online determination — pings do that). Phase 11 owns actual storage; Phase 10 just needs to not thrash the DB.

### Pitfall 8: Missing `.unref()` on timers in Test Environment
**What goes wrong:** Integration tests complete but the process hangs for up to 1h waiting for the run timeout timer.
**Prevention:** Always call `.unref()` on run timers (FA-4). Also expose `clearAllRunTimers()` and call it in the test teardown `afterAll`. Alternatively, pass a short `timeout_seconds` in integration tests (e.g. 5s).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform process tree kill | Custom kill logic | Reuse `killAndWait` from `executor/single.ts` (already handles Windows taskkill + Unix SIGTERM/SIGKILL) | Windows process tree kill is subtle — execSync taskkill /f /t /pid is already there |
| Subprocess spawn with stream capture | New execa wrapper | `execa` with `stdout:'pipe'` + `data` events (existing pattern in executor) | execa 9.x handles PATHEXT, shebangs, exit code propagation |
| JSONB containment checks | Application-level label filter loop | Postgres `@>` operator via `sql` template in Drizzle | One DB round-trip vs N for N agents |
| Lease-based queue (SELECT FOR UPDATE SKIP LOCKED) | Complex distributed queue | In-memory FIFO + CAS guard | Single-instance v2.0; complexity unjustified |
| Token/credential comparison | `===` string compare | `hashToken()` + DB column compare (existing adminRepo pattern) | Timing-safe; ATOK-06 compliance |

---

## File Structure Recommendation

```
packages/server/src/
├── db/
│   └── schema.ts                    # extend: taskRuns table + agents.maxConcurrent + tasks.defaultTimeoutSeconds
├── drizzle/
│   └── 0003_task_runs.sql           # [BLOCKING] generated by drizzle-kit
├── repos/
│   ├── task-runs.ts                 # NEW: list, getById, listActiveByAgent, updateState, markTerminal
│   ├── admin.ts                     # EXTEND: countConcurrentByOrg, countAgentsByOrg, findRunsForReconciliation
│   └── index.ts                     # EXTEND: export task-runs repo
├── services/
│   ├── dispatcher.ts                # NEW: DispatchQueue class + tickDispatcher + dispatcherPlugin
│   ├── agent-selector.ts            # NEW: selectEligibleAgent (label-match + least-busy)
│   ├── reconciler.ts                # NEW: runBootReconciliation
│   ├── timeout-manager.ts           # NEW: registerRunTimer, cancelRunTimer, clearAllRunTimers
│   └── dispatch-resolver.ts         # EXISTING: Phase 9, used by POST trigger route
├── ws/
│   ├── frames.ts                    # EXTEND: add dispatch/cancel/result/state/log_chunk parsers
│   ├── types.ts                     # EXTEND: add new frame types to union
│   └── handler.ts                   # EXTEND: route result/state/log_chunk frames; quota check in register
└── routes/
    └── runs/
        ├── index.ts                 # register all run routes under /api/orgs/:orgId/...
        ├── trigger.ts               # POST /api/orgs/:orgId/tasks/:taskId/runs
        ├── list.ts                  # GET /api/orgs/:orgId/runs
        ├── get.ts                   # GET /api/orgs/:orgId/runs/:runId
        ├── cancel.ts                # POST /api/orgs/:orgId/runs/:runId/cancel
        └── usage.ts                 # GET /api/orgs/:orgId/usage

packages/xci/src/agent/
├── index.ts          # EXTEND: wire dispatch/cancel handlers; update goodbye to include running_runs
├── client.ts         # EXTEND: send() typed frame; add types for dispatch/cancel
├── state.ts          # EXTEND: RunningRunsMap Map<runId, RunHandle>
├── runner.ts         # NEW: spawnTask() — execa spawn with log_chunk streaming
└── types.ts          # EXTEND: add dispatch/cancel/result/state/log_chunk to AgentFrame union
```

---

## Sequencing — Suggested 5 Plans

### Plan 10-01: Schema Migration + DB Foundation [BLOCKING]
**Wave 0 only — no implementation without green migration.**
1. Extend `schema.ts`: add `taskRuns` table (D-01), add `agents.maxConcurrent` column (D-09), add `tasks.defaultTimeoutSeconds` column (D-20).
2. Add Drizzle relations for `taskRuns` → `orgs`, `agents`, `tasks`, `users`.
3. Run `pnpm --filter @xci/server exec drizzle-kit generate --name task_runs` → commit `0003_task_runs.sql`.
4. Create `repos/task-runs.ts` with `makeTaskRunsRepo(db, orgId)`: `create`, `getById`, `list`, `updateState` (CAS), `markTerminal`, `listActiveByAgent`.
5. Extend `repos/admin.ts`: `countConcurrentByOrg`, `countAgentsByOrg`, `findRunsForReconciliation`.
6. Add `task-runs.isolation.test.ts` per Phase 7 D-04 contract.
7. Add `NewTaskRun` / `TaskRun` / `TaskRunState` type exports.
**Gate:** migration applies cleanly; isolation tests green; `pnpm --filter @xci/server test` green.

### Plan 10-02: Frame Protocol + WS Handler Extensions
1. Extend `ws/types.ts`: add `state`, `result`, `log_chunk` to `AgentIncomingFrame`; add `dispatch`, `cancel` to `ServerOutgoingFrame`.
2. Extend `ws/frames.ts`: implement parsers for `state`, `result`, `log_chunk` (replaces Phase 8 RESERVED throw).
3. Extend `ws/handler.ts`:
   - `register` branch: add QUOTA-03 quota check (D-10) with close code 4006.
   - Authenticated frame routing: add `state`, `result`, `log_chunk` handlers.
   - Reconnect branch: activate Phase 8 D-18 stub with real reconciliation logic (D-24).
4. Add `send()` helper overloads for `dispatch` and `cancel` outgoing frames.
5. Integration tests: quota registration rejection (6th agent → 4006), result frame transitions state correctly, state ack promotes dispatched → running.
**Gate:** `pnpm --filter @xci/server test` green; BC-02 green.

### Plan 10-03: Dispatcher Service + Timeout Manager + Reconciliation
1. Create `services/agent-selector.ts`: `selectEligibleAgent` (FA-3 JSONB label match + least-busy COUNT subquery).
2. Create `services/timeout-manager.ts`: `registerRunTimer`, `cancelRunTimer`, `clearAllRunTimers`.
3. Create `services/reconciler.ts`: `runBootReconciliation` (FA-5).
4. Create `services/dispatcher.ts`: `DispatchQueue` class, `tickDispatcher`, `dispatcherPlugin` (Fastify plugin with `onReady` + `onClose` hooks, 250ms interval, reentrancy guard).
5. Register `dispatcherPlugin` in `app.ts` AFTER the WebSocket plugin.
6. Unit tests: label-match filter (exact match, partial match, no match, empty requirements), queue FIFO + depth limit, timer registration/cancellation, reconciliation logic.
**Gate:** unit tests green; no timer leak in test suite.

### Plan 10-04: REST Routes + dispatch-resolver integration
1. Create `routes/runs/trigger.ts`: `POST /api/orgs/:orgId/tasks/:taskId/runs`
   - Auth: requireAuth + requireMemberOrAbove + CSRF.
   - Validate request body (`param_overrides`, `timeout_seconds`).
   - QUOTA-04 queue depth check (D-07): count queued+active, reject 429 if >= max_concurrent_tasks * 2.
   - Call `dispatch-resolver.ts` to resolve params (Phase 9 service).
   - Snapshot task definition into `task_snapshot`.
   - INSERT `task_runs` row with state='queued' + enqueue to DispatchQueue.
   - Return `{runId, state:'queued'}`.
2. Create `routes/runs/list.ts`, `get.ts`, `cancel.ts`, `usage.ts` (D-27, D-13).
3. Integration tests: trigger happy path → queued, trigger with quota exceeded → 429, cancel running run → cancelled, usage endpoint returns correct counts.
**Gate:** `pnpm --filter @xci/server test` green.

### Plan 10-05: Agent-Side Dispatch Handler + Closeout
1. Create `packages/xci/src/agent/runner.ts`: `spawnTask()` with execa streaming + log_chunk emission (FA-7).
2. Extend `packages/xci/src/agent/types.ts`: add `dispatch`, `cancel` to incoming AgentFrame; add `state`, `log_chunk`, `result` to outgoing.
3. Extend `packages/xci/src/agent/state.ts`: add `runningRuns: Map<string, RunHandle>` (replace Phase 8 `RunState[]` array).
4. Extend `packages/xci/src/agent/index.ts`:
   - Handle `dispatch` frame: drain check (D-16), concurrency check (D-15), spawnTask, send `state` ack, stream `log_chunk`, send `result` on exit.
   - Handle `cancel` frame: look up RunHandle, call cancel(), send result with `cancelled:true, exit_code:130`.
   - Update `goodbye` to include running_runs (D-27 AGENT-08).
   - Update `reconnect` to include running_runs from state.
5. Extend `packages/xci/src/agent/client.ts`: typed send for new outgoing frame types.
6. E2E test (D-42): start testcontainers Postgres + server, spawn real `xci --agent` process, trigger `echo "hello"` task, assert `exit_code=0` result.
7. BC fences: `pnpm --filter xci test` (all v1 tests + agent unit tests), cold-start <300ms.
**Gate:** E2E green; all BC gates green; `pnpm turbo run test` clean.

---

## Open Questions

1. **`updateStateMulti` helper for multiple-source states**
   - What we know: `handleResultFrame` and `handleRunTimeout` both need to guard against MULTIPLE possible source states (e.g., both `dispatched` and `running` can time out).
   - What's unclear: Drizzle's `inArray` works for `WHERE state IN (...)` but the standard `update().where(inArray(col, [...]))` doesn't guarantee exactly-one semantics.
   - **RESOLVED:** Use `inArray(taskRuns.state, [...])` in the WHERE clause. The `.returning()` will return the updated row only if the state matched. Check `rows[0]` — if undefined, the CAS failed (already terminal). This is safe for multi-source transitions.

2. **Pagination shape for GET /runs list**
   - What we know: cursor-based pagination avoids offset drift on live data; offset-based is simpler.
   - What's unclear: Phase 13 UI design preference.
   - **RESOLVED (planner discretion):** Use cursor-based with `since` (ISO timestamp of `queued_at`) + `limit` (default 50, max 200). Matches Phase 9 audit log convention. Simple to implement: `WHERE queued_at < :since ORDER BY queued_at DESC LIMIT :limit`.

3. **`agents.max_concurrent` — default value in migration**
   - What we know: D-09 says `DEFAULT 1`. Phase 8 schema doesn't have this column.
   - What's unclear: Existing agents in DB (created in Phase 8 integration tests) need a value.
   - **RESOLVED:** `ALTER TABLE agents ADD COLUMN max_concurrent integer NOT NULL DEFAULT 1;` — the DEFAULT 1 backfills existing rows automatically. No data migration needed.

4. **`tasks.default_timeout_seconds` — nullable vs not null**
   - D-20 says `NULLABLE — null means use system default (3600s)`.
   - **RESOLVED:** `integer NULLABLE DEFAULT NULL`. The trigger route reads `task.defaultTimeoutSeconds ?? 3600` and the run body can override. Simple.

5. **How should `log_chunk` frames from Phase 10 be handled at the server?**
   - Phase 10 sends them from the agent; Phase 11 stores them.
   - **RESOLVED:** Phase 10 server handler receives `log_chunk` frames and discards (no storage). The `last_seen_at` update already happens for all authenticated frames. Do NOT write a placeholder `log_chunks` table in Phase 10 — Phase 11 owns the schema.

6. **Should `reconnect` frame send running_runs in Phase 10?**
   - Phase 8 agent sends `running_runs: []` (empty, no real runs). Phase 10 adds real runs.
   - **RESOLVED:** Yes, Phase 10 agent must populate `running_runs` in both `reconnect` and `goodbye` frames from `state.runningRuns`. Update `index.ts` `handleOpen` to read from `state.runningRuns` map.

---

## Validation Architecture

`nyquist_validation` is `false` in `.planning/config.json` — this section is intentionally omitted per config.

---

## Security Domain

ASVS categories relevant to Phase 10:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | `requireAuth` + org-scoped repos; `taskRuns WHERE org_id` guard on frame routing |
| V5 Input Validation | yes | Hand-rolled frame parser in frames.ts; body schema validation in routes |
| V13 API | yes | Rate limit on POST /runs trigger (existing @fastify/rate-limit); CSRF on mutations |

**Specific threat: frame spoofing.** An agent presenting valid credentials for org A must not be able to affect runs belonging to org B. The fix is FA-6's recommendation: verify `taskRuns.orgId === conn.orgId` before processing any result/state/log_chunk frame. This is NOT currently in the Phase 8 handler (because there were no runs in Phase 8) — it must be added in Plan 10-02.

**No secrets in frames.** The `params` object in the `dispatch` frame contains decrypted org secret values (per DISP-03, SEC-06). These must NEVER be logged. Extend Pino redaction in app.ts to cover `*.params` when the path involves dispatch frames (or use structured log that omits params entirely for dispatch).

---

## Sources

### Primary (HIGH confidence)
- `packages/server/src/ws/handler.ts` — Phase 8 WS handler; Phase 10 extends this file
- `packages/server/src/ws/frames.ts` — Phase 8 frame parser; Phase 10 extends
- `packages/server/src/repos/admin.ts` — CAS pattern (`consumeRegistrationToken`); quota count pattern modeled here
- `packages/server/src/db/schema.ts` — existing table/column shapes; Phase 10 additions extend this
- `packages/xci/src/executor/single.ts` — SIGTERM/SIGKILL kill pattern; execa stream pipe pattern
- `packages/xci/src/agent/index.ts` + `client.ts` + `state.ts` — agent dispatch handler extends these
- `packages/server/src/services/dispatch-resolver.ts` — Phase 9 pure resolver function called from trigger route
- `/sindresorhus/execa` via Context7 — `subprocess.kill()`, SIGTERM/SIGKILL API confirmed [VERIFIED]
- `/drizzle-team/drizzle-orm-docs` via Context7 — `sql` template for JSONB operators, COUNT pattern [VERIFIED]

### Secondary (MEDIUM confidence)
- Phase 8 D-14/D-15/D-18 reconciliation framework — informs Phase 10 activation
- Phase 9 D-32/D-33/D-34 dispatch-resolver — param resolution precedence confirmed

### Tertiary (LOW confidence — ASSUMED)
- Timer `.unref()` discipline — [ASSUMED] based on Node.js documentation knowledge; standard pattern
- `ticking` reentrancy guard for setInterval — [ASSUMED] standard Node.js pattern

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `timer.unref()` prevents process hang in tests and clean shutdown | FA-2, FA-4 | Tests may hang without it; low risk (Node.js docs confirm unref behavior) |
| A2 | `setInterval` reentrancy guard pattern (`ticking` flag) is sufficient | FA-2 | Concurrent ticks could double-dispatch a run if guard is absent |
| A3 | Cursor-based pagination via `queued_at` is appropriate for runs list | Open Q #2 | Phase 13 UI may prefer offset; swap is trivial |
| A4 | `spawnTask` in `runner.ts` should bypass `executor.run()` for streaming | FA-7 | If executor is extended to support stream callbacks, this could be unified; low risk — separate runner is simpler |

**If this table is empty for HIGH-verified claims:** All critical patterns (CAS, JSONB filter, execa kill, frame routing) were verified against actual codebase files and Context7 docs.

---

## RESEARCH COMPLETE
