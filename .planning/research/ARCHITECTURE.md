# Architecture Patterns — xci v2.0: Remote CI (Agents + Web Dashboard)

**Domain:** Distributed CI platform — agent-based remote execution, SaaS server, web dashboard
**Researched:** 2026-04-16
**Scope:** v2.0 additions only. v1 CLI internals are frozen.

---

## 1. Monorepo Layout

### Directory Tree

```
xci/                                        ← repo root (was project root in v1)
├── package.json                            ← workspace root (pnpm workspaces)
├── pnpm-workspace.yaml                     ← packages: ["packages/*", "packages/@xci/*"]
├── turbo.json                              ← pipeline: build, test, lint, typecheck
├── biome.json                              ← shared lint/format config (inherits per-package)
├── .changeset/                             ← changesets for versioning
├── docker/
│   ├── Dockerfile                          ← multi-stage (builder → runtime)
│   └── docker-compose.yml                 ← dev: server + postgres + mailhog
│
├── packages/
│   ├── xci/                               ← npm: xci (EXISTING — moved from repo root)
│   │   ├── package.json                   ← unchanged from v1 (same bin, same deps)
│   │   ├── tsconfig.json                  ← unchanged from v1
│   │   ├── tsup.config.ts                 ← EXTENDED: adds agent entry (see §9)
│   │   ├── vitest.config.ts               ← unchanged — 202 tests still green
│   │   └── src/
│   │       ├── cli.ts                     ← UNCHANGED entry point for v1 CLI
│   │       ├── agent.ts                   ← NEW entry point for agent mode
│   │       ├── config/                    ← UNCHANGED — configLoader
│   │       ├── commands/                  ← UNCHANGED — commandsLoader
│   │       ├── executor/                  ← UNCHANGED — execa-based executor
│   │       ├── resolver/                  ← UNCHANGED — interpolation + platform
│   │       ├── tui/                       ← UNCHANGED — TUI picker
│   │       ├── init/                      ← UNCHANGED — xci init
│   │       ├── template/                  ← UNCHANGED — xci template
│   │       ├── errors.ts                  ← UNCHANGED
│   │       ├── types.ts                   ← UNCHANGED (v1 types; shared subset exported)
│   │       └── version.ts                 ← UNCHANGED
│   │
│   └── @xci/
│       ├── server/                        ← npm: @xci/server
│       │   ├── package.json
│       │   ├── tsconfig.json
│       │   ├── tsup.config.ts             ← entry: src/index.ts → dist/index.mjs
│       │   ├── drizzle.config.ts          ← drizzle-kit migration config
│       │   └── src/
│       │       ├── index.ts               ← server entry: build fastify app, start
│       │       ├── app.ts                 ← buildApp(): registers all plugins + routes
│       │       ├── config.ts              ← env var validation (TypeBox)
│       │       ├── db/
│       │       │   ├── schema.ts          ← Drizzle ORM table definitions
│       │       │   ├── migrate.ts         ← run migrations on startup
│       │       │   └── migrations/        ← generated SQL migration files
│       │       ├── plugins/
│       │       │   ├── auth.ts            ← session cookie verification decorator
│       │       │   ├── db.ts              ← postgres connection pool decorator
│       │       │   ├── crypto.ts          ← envelope encryption helpers decorator
│       │       │   └── ws.ts              ← @fastify/websocket registration
│       │       ├── repos/                 ← org-scoped repository layer (see §8)
│       │       │   ├── agents.repo.ts
│       │       │   ├── tasks.repo.ts
│       │       │   ├── taskruns.repo.ts
│       │       │   ├── secrets.repo.ts
│       │       │   ├── users.repo.ts
│       │       │   └── orgs.repo.ts
│       │       ├── routes/
│       │       │   ├── auth.ts            ← POST /api/auth/signup|login|logout|password-reset
│       │       │   ├── agents.ts          ← REST CRUD /api/agents
│       │       │   ├── tasks.ts           ← REST CRUD /api/tasks
│       │       │   ├── taskruns.ts        ← REST /api/taskruns + dispatch trigger
│       │       │   ├── secrets.ts         ← REST /api/secrets (org-level)
│       │       │   ├── ws-agent.ts        ← WS /ws/agent — agent protocol handler
│       │       │   ├── ws-log.ts          ← WS /ws/logs/:runId — UI log subscription
│       │       │   └── hooks/
│       │       │       ├── github.ts      ← POST /hooks/github/:orgId
│       │       │       └── perforce.ts    ← POST /hooks/perforce/:orgId
│       │       ├── dispatch/
│       │       │   ├── dispatcher.ts      ← label-match + dispatch state machine
│       │       │   ├── queue.ts           ← in-memory queue (v2.0 single-instance)
│       │       │   └── scheduler.ts       ← cron-based trigger (node-cron)
│       │       ├── triggers/              ← plugin system (see §7)
│       │       │   ├── interface.ts       ← TriggerPlugin interface
│       │       │   ├── registry.ts        ← static registration at build time
│       │       │   ├── github/
│       │       │   │   └── index.ts
│       │       │   └── perforce/
│       │       │       └── index.ts
│       │       ├── logs/
│       │       │   ├── buffer.ts          ← in-memory per-run accumulator
│       │       │   ├── persist.ts         ← flush chunks to Postgres
│       │       │   └── fanout.ts          ← broadcast to subscribed WS clients
│       │       └── types.ts              ← server-side shared types (WS frames, etc.)
│       │
│       └── web/                           ← npm: @xci/web (SPA)
│           ├── package.json
│           ├── vite.config.ts
│           ├── tsconfig.json
│           ├── index.html
│           └── src/
│               ├── main.tsx
│               ├── App.tsx                ← React Router routes
│               ├── api/
│               │   ├── client.ts          ← fetch wrapper with session cookie
│               │   └── types.ts           ← mirrored TypeBox schemas (generated or shared)
│               ├── ws/
│               │   └── logStream.ts       ← reconnecting-websocket log client
│               ├── pages/
│               │   ├── Login.tsx
│               │   ├── Dashboard.tsx      ← agent list, status
│               │   ├── Tasks.tsx          ← task YAML editor + trigger
│               │   └── Logs.tsx           ← live log viewer
│               ├── components/
│               │   └── ui/               ← shadcn/ui components (copied source)
│               └── store/
│                   └── ui.ts             ← zustand UI state
```

### Package Boundaries and Shared Code

**Key rule: v1 code in `packages/xci/src/` is NOT moved or refactored.** The YAML DSL types (`CommandDef`, `CommandMap`, `ResolvedConfig`, `ExecutionPlan`) are already well-defined in `packages/xci/src/types.ts`. Server and agent mode import them via workspace dependency.

| What | Where Lives | Consumers | How Shared |
|------|------------|-----------|------------|
| v1 CLI types (`CommandDef`, `CommandMap`, `ExecutionPlan`, `ResolvedConfig`) | `packages/xci/src/types.ts` | `@xci/server` (task validation), `packages/xci/src/agent.ts` | `@xci/server` adds `"xci": "workspace:*"` to deps and imports `from 'xci/types'` via `exports` field |
| YAML parser + normalizer (`commandsLoader`, `normalizeCommands`) | `packages/xci/src/commands/` | `@xci/server` (parse task YAML stored in DB before dispatch) | Same workspace import. `commandsLoader.load()` takes a `cwd`; server uses a memory-backed variant that loads from a string instead of filesystem — add `parseCommandsYaml(yaml: string): Promise<CommandMap>` export alongside the existing loader |
| Config loader (`configLoader`) | `packages/xci/src/config/` | Agent mode only (local config loading before merge with server-injected params) | Not shared with server — server has its own config format |
| WS frame type definitions | `packages/xci/src/types.ts` OR new `packages/@xci/server/src/types.ts` | Both agent and server | Defined in `@xci/server/src/types.ts`, imported by `packages/xci/src/agent.ts` via workspace dep |
| API type definitions (REST request/response shapes) | `packages/@xci/server/src/types.ts` (TypeBox schemas) | `@xci/web` via generated types or direct workspace dep | `@xci/web` adds `"@xci/server": "workspace:*"` and imports types only (no runtime server code) — TypeScript project references ensure no server code leaks into the SPA bundle |

**What `packages/xci/package.json` exports field needs:**
```json
{
  "exports": {
    ".": "./dist/cli.mjs",
    "./agent": "./dist/agent.mjs",
    "./types": {
      "types": "./src/types.ts",
      "import": "./dist/types.mjs"
    },
    "./commands": {
      "types": "./src/commands/index.ts",
      "import": "./dist/commands.mjs"
    }
  }
}
```
The `./types` and `./commands` sub-exports expose the DSL types and `parseCommandsYaml` to `@xci/server` without touching the CLI bundle.

---

## 2. Data Model

All entities carry `orgId` as a foreign key. Every query is filtered by `orgId` derived from the authenticated session — this is enforced at the repository layer, not individually in route handlers.

### Entity Definitions (Drizzle ORM notation)

```typescript
// --- org-level entities ---

orgs {
  id: uuid PK default gen_random_uuid()
  name: text NOT NULL
  slug: text NOT NULL UNIQUE          // URL-safe, used in webhook routes
  plan: text NOT NULL DEFAULT 'free'  // 'free' | 'pro' (stub)
  quota_agents: int NOT NULL DEFAULT 5
  quota_runs_per_month: int NOT NULL DEFAULT 200
  dek_iv: bytea NOT NULL              // AES-256-GCM IV for wrapping DEK with MEK
  dek_ciphertext: bytea NOT NULL      // Encrypted DEK (wrapped with master key)
  dek_tag: bytea NOT NULL             // GCM authentication tag
  created_at: timestamptz NOT NULL DEFAULT now()
}

users {
  id: uuid PK default gen_random_uuid()
  email: text NOT NULL UNIQUE
  password_hash: text NOT NULL        // argon2id hash
  display_name: text
  email_verified: bool NOT NULL DEFAULT false
  created_at: timestamptz NOT NULL DEFAULT now()
}

memberships {
  id: uuid PK
  user_id: uuid FK → users.id ON DELETE CASCADE
  org_id: uuid FK → orgs.id ON DELETE CASCADE
  role: text NOT NULL DEFAULT 'member'  // 'owner' | 'admin' | 'member'
  UNIQUE(user_id, org_id)
}

sessions {
  id: uuid PK
  user_id: uuid FK → users.id ON DELETE CASCADE
  token_hash: text NOT NULL UNIQUE    // sha256 of opaque token; token itself never stored
  org_id: uuid FK → orgs.id          // active org for this session
  expires_at: timestamptz NOT NULL
  created_at: timestamptz NOT NULL DEFAULT now()
  INDEX(token_hash)
  INDEX(expires_at)                   // for cleanup job
}

password_reset_tokens {
  id: uuid PK
  user_id: uuid FK → users.id ON DELETE CASCADE
  token_hash: text NOT NULL UNIQUE
  expires_at: timestamptz NOT NULL
  used_at: timestamptz               // NULL = unused
}

// --- agent entities ---

agents {
  id: uuid PK
  org_id: uuid FK → orgs.id ON DELETE CASCADE NOT NULL
  hostname: text NOT NULL
  display_name: text                  // user-overridable in UI
  labels: jsonb NOT NULL DEFAULT '{}'  // { os: "linux", arch: "x64", ...custom }
  status: text NOT NULL DEFAULT 'offline'  // 'online' | 'offline' | 'draining'
  last_seen_at: timestamptz
  registered_at: timestamptz NOT NULL DEFAULT now()
  INDEX(org_id, status)
}

agent_tokens {
  id: uuid PK
  agent_id: uuid FK → agents.id ON DELETE CASCADE NOT NULL
  org_id: uuid FK → orgs.id NOT NULL  // denormalized for fast lookup
  token_hash: text NOT NULL UNIQUE    // sha256 of the raw token
  revoked_at: timestamptz             // NULL = active
  created_at: timestamptz NOT NULL DEFAULT now()
  INDEX(token_hash)
}

// --- task definition entities ---

tasks {
  id: uuid PK
  org_id: uuid FK → orgs.id ON DELETE CASCADE NOT NULL
  name: text NOT NULL
  slug: text NOT NULL
  description: text
  commands_yaml: text NOT NULL        // full commands.yml content for this task
  require_labels: jsonb NOT NULL DEFAULT '{}'  // { os: "linux", arch: "x64" }
  timeout_seconds: int NOT NULL DEFAULT 3600
  created_by: uuid FK → users.id
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz NOT NULL DEFAULT now()
  UNIQUE(org_id, slug)
  INDEX(org_id)
}

// --- execution entities ---

task_runs {
  id: uuid PK
  org_id: uuid FK → orgs.id ON DELETE CASCADE NOT NULL
  task_id: uuid FK → tasks.id NOT NULL
  agent_id: uuid FK → agents.id      // NULL until dispatched
  triggered_by: text NOT NULL        // 'manual' | 'webhook:github' | 'webhook:perforce' | 'schedule'
  trigger_metadata: jsonb             // { event_id, ref, author, ... } from webhook
  status: text NOT NULL DEFAULT 'queued'
    -- 'queued' | 'dispatched' | 'running' | 'succeeded' | 'failed'
    -- | 'cancelled' | 'timed_out' | 'orphaned'
  param_overrides: jsonb NOT NULL DEFAULT '{}'  // caller-supplied ${KEY}=val overrides
  exit_code: int                      // NULL until terminal state
  queued_at: timestamptz NOT NULL DEFAULT now()
  dispatched_at: timestamptz
  started_at: timestamptz
  finished_at: timestamptz
  timeout_at: timestamptz             // set at dispatch time = dispatched_at + timeout_seconds
  INDEX(org_id, status)
  INDEX(org_id, task_id)
  INDEX(agent_id, status)             // for agent reconciliation on reconnect
}

log_chunks {
  id: bigserial PK
  run_id: uuid FK → task_runs.id ON DELETE CASCADE NOT NULL
  org_id: uuid NOT NULL               // denormalized for tenant-scoped purge
  seq: int NOT NULL                   // monotonically increasing per run (sent by agent)
  stream: text NOT NULL DEFAULT 'stdout'  // 'stdout' | 'stderr'
  data: text NOT NULL                 // UTF-8 text chunk (max 64KB enforced server-side)
  received_at: timestamptz NOT NULL DEFAULT now()
  UNIQUE(run_id, seq)
  INDEX(run_id, seq)
  INDEX(org_id, received_at)          // for retention enforcement
}

// --- secret entities ---

org_secrets {
  id: uuid PK
  org_id: uuid FK → orgs.id ON DELETE CASCADE NOT NULL
  name: text NOT NULL                 // placeholder name, e.g. "DEPLOY_TOKEN"
  iv: bytea NOT NULL                  // AES-256-GCM IV
  ciphertext: bytea NOT NULL          // encrypted value
  tag: bytea NOT NULL                 // GCM auth tag
  created_by: uuid FK → users.id
  updated_at: timestamptz NOT NULL DEFAULT now()
  UNIQUE(org_id, name)
  INDEX(org_id)
}

// --- trigger plugin config ---

webhook_events {
  id: uuid PK
  org_id: uuid FK → orgs.id NOT NULL
  plugin: text NOT NULL               // 'github' | 'perforce'
  raw_payload: jsonb NOT NULL
  signature_verified: bool NOT NULL
  mapped_task_id: uuid FK → tasks.id  // NULL if no match
  task_run_id: uuid FK → task_runs.id // NULL if no dispatch
  received_at: timestamptz NOT NULL DEFAULT now()
  INDEX(org_id, plugin, received_at)
}

plugin_configs {
  id: uuid PK
  org_id: uuid FK → orgs.id ON DELETE CASCADE NOT NULL
  plugin: text NOT NULL               // 'github' | 'perforce'
  config: jsonb NOT NULL              // plugin-specific (e.g. { secret: "...", repo: "..." })
  -- NOTE: webhook secrets in config are stored encrypted via org DEK
  UNIQUE(org_id, plugin)
}
```

### Multi-Tenant Isolation Strategy

Every repository function requires `orgId` as its first parameter. The pattern is:

```typescript
// repos/tasks.repo.ts — canonical pattern
export function makeTasksRepo(db: PostgresDb, orgId: string) {
  return {
    findById: (id: string) =>
      db.queryOne`SELECT * FROM tasks WHERE id = ${id} AND org_id = ${orgId}`,
    list: () =>
      db.query`SELECT * FROM tasks WHERE org_id = ${orgId} ORDER BY created_at DESC`,
    create: (data: NewTask) =>
      db.queryOne`INSERT INTO tasks ${sql(data)} RETURNING *`,
    // ...
  };
}
```

The `orgId` is NEVER accepted from request body or query params — it is extracted exclusively from the verified session (`request.session.orgId`). Route handlers construct repos as:

```typescript
fastify.get('/api/tasks', { onRequest: [fastify.authenticate] }, async (request, reply) => {
  const repo = makeTasksRepo(fastify.db, request.session.orgId);
  return repo.list();
});
```

No query in the system reads from a table without an `org_id` filter (except `sessions` and `users` which are per-user, and `orgs` itself).

---

## 3. Agent WebSocket Protocol

### Frame Schema

All messages are JSON-encoded. The outer envelope:

```typescript
interface WsFrame<T = unknown> {
  type: FrameType;
  messageId: string;          // uuid, used for ack correlation
  payload: T;
}

type FrameType =
  | 'agent:handshake'         // agent → server, first frame after WS upgrade
  | 'server:handshake_ack'    // server → agent
  | 'server:handshake_reject' // server → agent (auth failure, version too old)
  | 'agent:heartbeat'         // agent → server, every 30s
  | 'server:heartbeat_ack'    // server → agent
  | 'server:dispatch'         // server → agent, send task run
  | 'agent:dispatch_ack'      // agent → server, acknowledged receipt
  | 'agent:run_started'       // agent → server, execution has begun
  | 'agent:log_chunk'         // agent → server, streaming stdout/stderr
  | 'agent:result'            // agent → server, run complete with exit code
  | 'server:task_cancelled'   // server → agent, run was cancelled
  | 'agent:error'             // agent → server, unrecoverable agent-side error
  | 'agent:goodbye'           // agent → server, graceful shutdown in progress
  | 'server:goodbye_ack'      // server → agent, clean close confirmed
```

### Payload Definitions

```typescript
// agent:handshake
interface HandshakePayload {
  agentToken: string;             // raw long-lived token from agent_tokens table
  hostname: string;
  labels: Record<string, string>; // { os, arch, ...custom }
  clientVersion: string;          // xci package semver
  currentTaskRunId: string | null; // non-null if agent is mid-task on reconnect
}

// server:handshake_ack
interface HandshakeAckPayload {
  agentId: string;
  sessionToken: string;           // short-lived WS session token for this connection
  serverVersion: string;
  dispatchEnabled: boolean;       // false if agent is beyond quota or draining server-side
}

// server:handshake_reject
interface HandshakeRejectPayload {
  reason: 'invalid_token' | 'token_revoked' | 'version_too_old' | 'quota_exceeded';
  message: string;
  minClientVersion?: string;      // present when reason = version_too_old
}

// server:dispatch
interface DispatchPayload {
  taskRunId: string;
  taskId: string;
  taskSlug: string;
  commandsYaml: string;           // full commands.yml content
  aliasName: string;              // which alias to run
  params: Record<string, string>; // merged: org secrets (plaintext) + caller overrides
  timeoutSeconds: number;
}

// agent:dispatch_ack
interface DispatchAckPayload {
  taskRunId: string;
  accepted: boolean;              // false if agent can't accept (e.g. already busy)
}

// agent:run_started
interface RunStartedPayload {
  taskRunId: string;
  startedAt: string;              // ISO-8601
}

// agent:log_chunk
interface LogChunkPayload {
  taskRunId: string;
  seq: number;                    // monotonically increasing, starts at 0 per run
  stream: 'stdout' | 'stderr';
  data: string;                   // UTF-8 text, max 64KB per chunk
  timestamp: string;              // ISO-8601 when chunk was emitted
}

// agent:result
interface ResultPayload {
  taskRunId: string;
  exitCode: number;
  finishedAt: string;             // ISO-8601
}

// server:task_cancelled
interface TaskCancelledPayload {
  taskRunId: string;
  reason: 'user_cancelled' | 'timed_out' | 'agent_replaced';
}

// agent:error
interface AgentErrorPayload {
  taskRunId: string | null;       // null if not run-specific
  code: string;                   // e.g. "EXECUTOR_SPAWN_FAILED"
  message: string;
}

// agent:goodbye
interface GoodbyePayload {
  reason: 'sigterm' | 'user_initiated';
  currentTaskRunId: string | null;
}
```

### Reconnection and Task-State Reconciliation

On WS disconnect and subsequent reconnect, the agent sends `agent:handshake` with `currentTaskRunId` set to the in-progress run ID (if any).

Server reconciliation logic on receiving `agent:handshake`:

```
1. Verify token → look up agent row → verify orgId + not revoked
2. If currentTaskRunId is non-null:
   a. Look up task_run by (id, agent_id = this agent)
   b. If task_run.status = 'cancelled' or 'timed_out':
      → send server:task_cancelled back to agent immediately after handshake_ack
      → agent cleans up, kills subprocess if still running
   c. If task_run.status = 'dispatched' or 'running':
      → resume: task_run stays in current status; agent resumes streaming
      → server re-registers agent's WS connection in the fanout map for that run_id
   d. If task_run.status is terminal (succeeded/failed):
      → agent's process may have finished during partition; send task_cancelled to clean up
3. Update agents.status = 'online', agents.last_seen_at = now()
4. Send handshake_ack
```

### Backpressure on Log Streaming

The agent must not flood the server on fast-output commands. Strategy:

- Agent buffers chunks in a local queue (max 1000 pending frames).
- Agent sends `log_chunk` frames as fast as the WS socket write buffer allows. Node.js's WS implementation provides backpressure via `ws.bufferedAmount`. When `bufferedAmount > 128KB`, agent pauses reading from the subprocess's stdout pipe.
- Server processes `log_chunk` messages synchronously in the WS message handler: appends to per-run in-memory buffer (see §5), does not wait for DB write to ack. This keeps the message loop non-blocking.
- If the in-memory buffer exceeds 5000 chunks (configurable), server sends `server:task_cancelled` with reason `agent_replaced` (or a new frame `server:backpressure_exceeded`). This is a last-resort protection, not normal operation.

---

## 4. Dispatch Pipeline and TaskRun State Machine

### State Machine

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                  │
         trigger    ▼                                                  │
  ──────────────► QUEUED ──── no_eligible_agent (poll) ───────────────┤
                    │                                                  │
       label_match  │                                                  │
       + send WS    ▼                                                  │
              DISPATCHED ──── dispatch_ack(accepted=false) ────────────┤
                    │                                                  │
    agent:run_      │                                                  │
    started         ▼                                                  │
               RUNNING ──────────────────────────────────────────────►│
                    │                                                  │
          ┌─────────┼────────────────────────────────────┐            │
          │         │                                    │            │
  exit=0  ▼  exit≠0 ▼           user cancel ▼   timeout ▼            │
      SUCCEEDED   FAILED        CANCELLED    TIMED_OUT               │
          │         │                │           │                    │
          └────all terminal──────────┴───────────┘                    │
                                                                       │
         agent_lost (missed heartbeats) while DISPATCHED/RUNNING       │
                    └──────────────────────────────────────────────► ORPHANED
```

**State transitions:**

| From | To | Trigger | Side effects |
|------|----|---------|--------------|
| (new) | QUEUED | `POST /api/taskruns` or webhook mapToTask | Insert task_run row; enqueue in dispatcher |
| QUEUED | DISPATCHED | Dispatcher finds eligible agent; sends `server:dispatch` | Set `agent_id`, `dispatched_at`, `timeout_at`; update agents.status if needed |
| DISPATCHED | RUNNING | Receive `agent:run_started` | Set `started_at` |
| DISPATCHED | QUEUED | `dispatch_ack(accepted=false)` | Clear `agent_id`, `dispatched_at`; re-enqueue |
| RUNNING | SUCCEEDED | Receive `agent:result` with exitCode=0 | Set `exit_code=0`, `finished_at`; stop log fanout; persist remaining buffer |
| RUNNING | FAILED | Receive `agent:result` with exitCode≠0 | Set `exit_code`, `finished_at`; stop log fanout; persist remaining buffer |
| RUNNING/DISPATCHED | CANCELLED | `DELETE /api/taskruns/:id` or UI cancel | Send `server:task_cancelled`; set `finished_at` |
| RUNNING/DISPATCHED | TIMED_OUT | `timeout_at` exceeded (scheduler polls every 30s) | Send `server:task_cancelled` with reason `timed_out`; set `finished_at` |
| DISPATCHED/RUNNING | ORPHANED | Agent WS disconnects AND does not reconnect within `orphan_timeout` (default 5 min) | Set `finished_at`; no agent to notify |

**Dispatcher logic (single-instance in-memory queue, v2.0):**

```typescript
// dispatch/queue.ts
class DispatchQueue {
  private queue: string[] = [];       // ordered list of taskRunIds

  enqueue(taskRunId: string): void { this.queue.push(taskRunId); }
  dequeue(): string | undefined { return this.queue.shift(); }
  remove(taskRunId: string): void {
    this.queue = this.queue.filter(id => id !== taskRunId);
  }
  size(): number { return this.queue.length; }
}

// dispatch/dispatcher.ts
class Dispatcher {
  // Called after: new task_run inserted, agent comes online, dispatch_ack=false
  async tryDispatch(db: Db, queue: DispatchQueue, wsRegistry: WsRegistry): Promise<void> {
    while (queue.size() > 0) {
      const runId = queue.dequeue()!;
      const run = await taskRunsRepo.findById(runId);
      const task = await tasksRepo.findById(run.taskId);
      const agent = await agentsRepo.findEligible(run.orgId, task.requireLabels);
      if (!agent) {
        queue.enqueue(runId);         // put back at end — try again on next agent event
        break;                        // no eligible agent right now
      }
      // Send dispatch via WS
      const conn = wsRegistry.get(agent.id);
      if (!conn || conn.readyState !== WebSocket.OPEN) {
        // Agent just went offline, mark offline and retry
        await agentsRepo.markOffline(agent.id);
        queue.enqueue(runId);
        continue;
      }
      const params = await secretsRepo.resolveForRun(run.orgId, task, run.paramOverrides);
      const frame: WsFrame<DispatchPayload> = { type: 'server:dispatch', messageId: uuid(), payload: { ... } };
      conn.send(JSON.stringify(frame));
      await taskRunsRepo.setDispatched(runId, agent.id);
    }
  }
}
```

**Label matching:**

```typescript
// Agent is eligible if ALL required labels match agent labels (exact equality)
function isEligible(agentLabels: Record<string, string>, required: Record<string, string>): boolean {
  return Object.entries(required).every(([k, v]) => agentLabels[k] === v);
}
```

---

## 5. Log Streaming Path

### End-to-End Flow

```
Agent subprocess
  │
  │ stdout/stderr lines
  ▼
Agent log emitter (packages/xci/src/agent/logEmitter.ts)
  │ – reads from execa subprocess stdout/stderr streams
  │ – batches lines into chunks (flush every 100ms or 4KB, whichever first)
  │ – assigns monotonically increasing seq numbers
  │
  │ WS frame: agent:log_chunk { seq, stream, data }
  ▼
Server WS handler (routes/ws-agent.ts)
  │ – validates run ownership (agentId matches run's agent_id)
  │ – appends to in-memory RunBuffer
  │
  ▼
RunBuffer (logs/buffer.ts)
  │ – per-run Map<runId, Chunk[]>
  │ – when buffer grows to 100 chunks or 5s idle: flush to Postgres
  │ – also triggers fanout to subscribed UI clients immediately on each chunk
  │
  ├──── persist (logs/persist.ts) ────────────────────────────────────►
  │       INSERT INTO log_chunks (run_id, org_id, seq, stream, data)   Postgres
  │       ON CONFLICT (run_id, seq) DO NOTHING                         (idempotent)
  │
  └──── fanout (logs/fanout.ts) ───────────────────────────────────────►
          WsLogRegistry: Map<runId, Set<WebSocket>>
          For each subscribed UI WS client:
            send JSON: { type: 'log:chunk', payload: { seq, stream, data, timestamp } }
```

### Log Persistence Strategy: Postgres jsonb rows vs Blobs

**Decision: Postgres rows (one row per chunk) in v2.0.**

Rationale:
- Postgres is already in the stack; no additional infrastructure.
- Queries for log replay (`SELECT * FROM log_chunks WHERE run_id = $1 ORDER BY seq`) are fast with the `(run_id, seq)` index for typical run sizes (< 10K chunks = < 640MB per run in text, but practical runs are 100–10K lines).
- Blob storage (S3, GCS, Minio) adds an external service dependency and complicates Docker Compose dev setup.
- Retention enforcement with Postgres is a single `DELETE FROM log_chunks WHERE org_id = $1 AND received_at < $2`.
- Migrate to object store in v2.1 if runs routinely exceed 100K chunks. The `persist.ts` module is the only thing that changes.

**Retention enforcement:**

- `OrgPlan.log_retention_days` (default: 7 for Free, 30 for Pro — stub in v2.0).
- A background job (setInterval every 6h) runs: `DELETE FROM log_chunks WHERE org_id IN (...) AND received_at < now() - INTERVAL '$days days'`.
- Also cleans up `task_runs` older than retention window.

### UI Log Subscription (WebSocket)

Browser connects to `GET /ws/logs/:runId?token=<session_token>`. Server verifies session, checks `task_run.org_id` matches user's org, then registers the client in `WsLogRegistry[runId]`.

On subscribe, server:
1. Sends all existing chunks from Postgres for `runId` in order (replay).
2. Keeps client in fanout set for new live chunks.
3. On run completion (`agent:result` received), sends a terminal frame: `{ type: 'log:finished', payload: { exitCode } }` and removes client from fanout set.

---

## 6. Secret Resolution During Dispatch

### The Question

Task YAML references `${DEPLOY_TOKEN}`. At dispatch time, the server needs to inject the value. The options are:

1. Server resolves to plaintext, sends plaintext in `server:dispatch` params.
2. Server sends encrypted bundle + DEK, agent decrypts locally.

**Decision: Server resolves to plaintext and sends over the WS connection (TLS-protected transport).**

Rationale:
- The WS connection is TLS-encrypted in production (nginx/caddy terminates TLS). Plaintext params are safe in transit.
- The agent is a trusted process (it authenticated with a valid token, TOFU'd at registration). Agents run on infrastructure the org controls.
- Sending an encrypted bundle requires the agent to have key material to decrypt — which is just moving the trust boundary without improving security.
- Option 2 would require the agent to hold a org-specific decryption key, which must itself be transmitted securely — circular problem.
- The pattern used by GitHub Actions, Buildkite, and CircleCI: secrets are injected as environment variables at dispatch time, sent over the encrypted control channel.

**Secret resolution flow:**

```typescript
// repos/secrets.repo.ts
async function resolveForRun(
  orgId: string,
  task: Task,
  callerOverrides: Record<string, string>
): Promise<Record<string, string>> {
  // 1. Parse task YAML to find all ${PLACEHOLDER} references
  const commandMap = await parseCommandsYaml(task.commandsYaml);
  const placeholders = extractPlaceholders(commandMap);  // Set<string>

  // 2. Fetch org secrets for the referenced placeholder names
  const orgSecretRows = await db.query`
    SELECT name, iv, ciphertext, tag FROM org_secrets
    WHERE org_id = ${orgId} AND name = ANY(${[...placeholders]})`;

  // 3. Decrypt each org secret using the org's DEK
  const orgDek = await unwrapOrgDek(orgId);  // fetch + decrypt with MEK
  const params: Record<string, string> = {};
  for (const row of orgSecretRows) {
    params[row.name] = await aesGcmDecrypt(orgDek, row.iv, row.ciphertext, row.tag);
  }

  // 4. Caller overrides WIN over org secrets (same precedence as local.yml in v1)
  Object.assign(params, callerOverrides);

  return params;
  // IMPORTANT: params is NEVER logged — pino serializer strips 'params' field from dispatch log entries
}
```

**Agent-side local overrides (per-agent secrets.yml):**

The agent receives `params` from the server in `server:dispatch`. Before passing to the executor, the agent merges with its local config (same 4-layer loader as v1):

```typescript
// packages/xci/src/agent/agent.ts
async function executeDispatch(dispatch: DispatchPayload): Promise<void> {
  // Load local config (4-layer: machine, project, secrets, local)
  const localConfig = await configLoader.load(process.cwd());

  // Server params are the HIGHEST precedence (above all local layers, including secrets.yml)
  // This mirrors: org admin's secrets override per-developer overrides.
  const mergedParams: Record<string, string> = {
    ...localConfig.values,
    ...dispatch.params,             // server wins over local
  };
  const commandMap = await parseCommandsYaml(dispatch.commandsYaml);
  const plan = resolver.resolve(dispatch.aliasName, commandMap, { values: mergedParams, provenance: {}, secretKeys: new Set() });
  return executor.run(plan, { cwd: process.cwd(), env: mergedParams, ... });
}
```

**Security invariants:**
- `dispatch.params` is NEVER written to `agent.log` or any file. The agent executor only uses values during subprocess spawn (passed as env vars).
- The server NEVER writes plaintext secret values to `log_chunks`. If a user's command echoes a secret, that's the user's problem (same as any CI system).
- Log viewer in UI does not mask secrets (too complex, v2.1+). Documented in threat model.

---

## 7. Plugin System

### Interface

```typescript
// triggers/interface.ts

export interface TriggerContext {
  db: PostgresDb;
  orgId: string;
  pluginConfig: Record<string, string>;  // decrypted at call time from plugin_configs
}

export interface ParsedEvent {
  eventType: string;          // e.g. 'push', 'pull_request', 'changelist'
  ref?: string;               // git ref or P4 changelist number
  author?: string;
  metadata: Record<string, string>;  // passed as param_overrides to task_run
}

export interface TriggerPlugin {
  readonly name: string;      // 'github' | 'perforce'
  readonly version: string;   // semver

  /**
   * Verify the incoming request is authentic.
   * Called first. If throws or returns false, request is rejected 401.
   */
  verify(
    headers: Record<string, string>,
    rawBody: Buffer,
    ctx: TriggerContext
  ): Promise<boolean>;

  /**
   * Parse the raw body into a structured event.
   * Only called if verify() returns true.
   */
  parse(
    headers: Record<string, string>,
    rawBody: Buffer,
    ctx: TriggerContext
  ): Promise<ParsedEvent>;

  /**
   * Map the parsed event to a task run request, or return null if no task matches.
   * Receives the org's full task list; returns the task to run + any param overrides.
   */
  mapToTask(
    event: ParsedEvent,
    tasks: Task[],
    ctx: TriggerContext
  ): Promise<{ task: Task; paramOverrides: Record<string, string> } | null>;
}
```

### Plugin Registration (Build-Time)

Plugins are NOT dynamically loaded at runtime. They are statically imported and registered:

```typescript
// triggers/registry.ts
import { GithubPlugin } from './github/index.js';
import { PerforcePlugin } from './perforce/index.js';

const REGISTRY = new Map<string, TriggerPlugin>([
  ['github', new GithubPlugin()],
  ['perforce', new PerforcePlugin()],
]);

export function getPlugin(name: string): TriggerPlugin | undefined {
  return REGISTRY.get(name);
}
```

This means adding a plugin requires a server rebuild and redeploy. This is intentional for v2.0 — dynamic plugin loading (npm install at runtime) is a security and stability risk.

### Fastify Route → Plugin Flow

```typescript
// routes/hooks/github.ts
fastify.post<{ Params: { orgSlug: string } }>(
  '/hooks/:plugin/:orgSlug',
  { config: { rawBody: true } },   // @fastify/rawbody to preserve HMAC input
  async (request, reply) => {
    const plugin = getPlugin(request.params.plugin);
    if (!plugin) return reply.code(404).send({ error: 'unknown_plugin' });

    const org = await orgsRepo.findBySlug(request.params.orgSlug);
    if (!org) return reply.code(404).send({ error: 'org_not_found' });

    const pluginConfigRow = await pluginConfigsRepo.find(org.id, request.params.plugin);
    if (!pluginConfigRow) return reply.code(404).send({ error: 'plugin_not_configured' });

    // Decrypt plugin config (may contain webhook secret)
    const pluginConfig = await decryptPluginConfig(pluginConfigRow, org);

    const ctx: TriggerContext = { db: fastify.db, orgId: org.id, pluginConfig };
    const rawBody = (request as any).rawBody as Buffer;

    // Step 1: verify
    const verified = await plugin.verify(request.headers as Record<string, string>, rawBody, ctx);
    if (!verified) return reply.code(401).send({ error: 'signature_invalid' });

    // Step 2: parse
    const event = await plugin.parse(request.headers as Record<string, string>, rawBody, ctx);

    // Step 3: mapToTask
    const tasks = await tasksRepo.listByOrg(org.id);
    const match = await plugin.mapToTask(event, tasks, ctx);

    // Record event regardless of match
    await webhookEventsRepo.create({ orgId: org.id, plugin: request.params.plugin, rawPayload: JSON.parse(rawBody.toString()), signatureVerified: true, mappedTaskId: match?.task.id ?? null });

    if (!match) return reply.code(200).send({ dispatched: false, reason: 'no_task_match' });

    // Enqueue task run
    const run = await taskRunsRepo.create({ orgId: org.id, taskId: match.task.id, triggeredBy: `webhook:${request.params.plugin}`, paramOverrides: match.paramOverrides });
    await dispatcher.tryDispatch(fastify.db, fastify.queue, fastify.wsRegistry);

    return reply.code(202).send({ dispatched: true, taskRunId: run.id });
  }
);
```

### GitHub Plugin Implementation Pattern

```typescript
// triggers/github/index.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export class GithubPlugin implements TriggerPlugin {
  name = 'github';
  version = '1.0.0';

  async verify(headers, rawBody, ctx): Promise<boolean> {
    const sig = headers['x-hub-signature-256'];
    if (!sig) return false;
    const expected = 'sha256=' + createHmac('sha256', ctx.pluginConfig.webhookSecret)
      .update(rawBody).digest('hex');
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  async parse(headers, rawBody, ctx): Promise<ParsedEvent> {
    const payload = JSON.parse(rawBody.toString());
    const eventType = headers['x-github-event'] as string;
    return {
      eventType,
      ref: payload.ref,
      author: payload.sender?.login,
      metadata: { repository: payload.repository?.full_name ?? '', sha: payload.after ?? '' },
    };
  }

  async mapToTask(event, tasks, ctx): Promise<{ task: Task; paramOverrides: Record<string, string> } | null> {
    // Match tasks where task.slug matches a naming convention or task has a github_event label
    // Simple v2.0: match by task slug = event.eventType or task with matching trigger config
    const match = tasks.find(t => t.slug === `on-${event.eventType}` || t.slug === 'on-push');
    if (!match) return null;
    return { task: match, paramOverrides: { GIT_REF: event.ref ?? '', GIT_SHA: event.metadata.sha } };
  }
}
```

---

## 8. Multi-Tenancy: Request Isolation

### Auth Decorator

```typescript
// plugins/auth.ts
fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
  const rawToken = request.cookies['xci_session'];
  if (!rawToken) return reply.code(401).send({ error: 'unauthenticated' });

  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const session = await db.queryOne`
    SELECT s.*, m.org_id, m.role
    FROM sessions s
    JOIN memberships m ON m.user_id = s.user_id AND m.org_id = s.org_id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > now()
    LIMIT 1`;

  if (!session) return reply.code(401).send({ error: 'session_expired' });

  request.session = {
    userId: session.user_id,
    orgId: session.org_id,
    role: session.role,
    sessionId: session.id,
  };
});
```

### Repository Layer Pattern

All repositories are created per-request with the verified `orgId`:

```typescript
// app.ts — request lifecycle
fastify.addHook('onRequest', async (request) => {
  // Lazily constructed — routes that don't need auth skip this
});

// Route handler
fastify.get('/api/tasks', { onRequest: [fastify.authenticate] }, async (request, reply) => {
  // request.session.orgId is guaranteed non-null here
  const tasksRepo = makeTasksRepo(fastify.db, request.session.orgId);
  const tasks = await tasksRepo.list();
  return tasks;
});
```

**No cross-org data access is possible** because:
1. `orgId` comes only from the verified session (not from request params).
2. Every repository function embeds `AND org_id = ${orgId}` in all queries.
3. TypeScript types ensure repo functions require an `orgId` — missing it is a compile error.

### Agent WS Auth (separate path)

Agent WS connections don't use session cookies. They authenticate with a long-lived `agentToken` in the `agent:handshake` frame. The server resolves `orgId` from `agent_tokens → agents → orgId` and creates org-scoped repos for the duration of the WS connection:

```typescript
// routes/ws-agent.ts
fastify.get('/ws/agent', { websocket: true }, async (connection, request) => {
  connection.on('message', async (raw) => {
    const frame = JSON.parse(raw.toString());
    if (frame.type === 'agent:handshake') {
      const tokenHash = sha256(frame.payload.agentToken);
      const tokenRow = await db.queryOne`
        SELECT at.*, a.org_id FROM agent_tokens at
        JOIN agents a ON a.id = at.agent_id
        WHERE at.token_hash = ${tokenHash} AND at.revoked_at IS NULL`;
      if (!tokenRow) {
        connection.send(JSON.stringify({ type: 'server:handshake_reject', payload: { reason: 'invalid_token' } }));
        connection.close();
        return;
      }
      // From this point, orgId is fixed for this WS connection
      const orgId = tokenRow.org_id;
      const agentId = tokenRow.agent_id;
      wsRegistry.register(agentId, connection);
      // ... rest of handshake
    }
  });
});
```

---

## 9. Build Orchestration

### tsup Configuration for `packages/xci`

The v1 entry (`src/cli.ts`) remains untouched. Agent mode is a **separate entry point** that bundles `ws` and `reconnecting-websocket` — these are NOT included in the CLI bundle.

```typescript
// packages/xci/tsup.config.ts
export default defineConfig([
  // Entry 1: v1 CLI (UNCHANGED — must stay byte-compatible with v1 dist/cli.mjs)
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    outDir: 'dist',
    outExtension: () => ({ js: '.mjs' }),
    bundle: true,
    noExternal: [/.*/],                         // bundle ALL deps including commander, execa, yaml
    external: ['ws', 'reconnecting-websocket'], // EXPLICIT exclusion — must not pollute CLI bundle
    banner: { js: '#!/usr/bin/env node\n...' },
    define: { __XCI_VERSION__: JSON.stringify(pkg.version) },
    platform: 'node',
    target: 'node20.5',
  },
  // Entry 2: agent mode (NEW)
  {
    entry: ['src/agent.ts'],
    format: ['esm'],
    outDir: 'dist',
    outExtension: () => ({ js: '.mjs' }),
    bundle: true,
    noExternal: [/.*/],   // bundle ws + reconnecting-websocket + shared xci internals
    // No shebang — agent.mjs is invoked from cli.ts via dynamic import, not as a standalone bin
    platform: 'node',
    target: 'node20.5',
  },
  // Entry 3: shared types/commands (for @xci/server workspace dep)
  {
    entry: ['src/types.ts', 'src/commands/index.ts'],
    format: ['esm'],
    outDir: 'dist',
    dts: true,
    bundle: false,   // no bundling — just compile; deps are declared in server's own node_modules
    platform: 'node',
    target: 'node20.5',
  },
]);
```

**How agent mode is invoked from `cli.ts` without bundling `ws`:**

```typescript
// src/cli.ts  — agent mode detection (added at top of main())
if (process.argv.includes('--agent')) {
  // Dynamic import: agent.mjs is loaded only when --agent is passed
  // This keeps cli.mjs free of ws/reconnecting-websocket
  const { runAgent } = await import('./agent.mjs');
  await runAgent(process.argv);
  return 0;  // agent mode doesn't reach the rest of main()
}
```

This preserves the cold-start budget: the v1 CLI path never loads `ws`.

### Turbo Pipeline

```json
// turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],      // build dependencies first
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": []
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "lint": {
      "outputs": []
    }
  }
}
```

Build order enforced by Turbo:
1. `packages/xci` builds first (server imports its types).
2. `packages/@xci/server` builds second (web imports its TypeBox schemas).
3. `packages/@xci/web` builds third (depends on server types and API shape).
4. Tests run after all builds (integration tests in server need CLI agent.mjs).

Parallel: `lint` and `typecheck` run in parallel across all packages after `^build` deps resolve.

### Docker Multi-Stage Build

```dockerfile
# docker/Dockerfile

# Stage 1: builder
FROM node:22-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace definition files first (layer cache optimization)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/xci/package.json ./packages/xci/
COPY packages/@xci/server/package.json ./packages/@xci/server/
COPY packages/@xci/web/package.json ./packages/@xci/web/

RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build: xci first (server depends on its types), then server + web in parallel via turbo
RUN pnpm turbo run build --filter=xci --filter=@xci/server --filter=@xci/web

# Stage 2: runtime (server + static SPA only; xci CLI not needed in Docker image)
FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/@xci/server/package.json ./packages/@xci/server/

# Install production deps only (no xci dev deps, no web dev deps)
RUN pnpm install --prod --frozen-lockfile --filter=@xci/server

# Copy built artifacts
COPY --from=builder /app/packages/@xci/server/dist ./packages/@xci/server/dist
COPY --from=builder /app/packages/@xci/web/dist ./packages/@xci/server/dist/public
# ^^^ web SPA is served as static files from within the server's dist directory

# Copy migration files (needed at runtime for drizzle-kit migrate on startup)
COPY --from=builder /app/packages/@xci/server/src/db/migrations ./packages/@xci/server/dist/migrations

EXPOSE 3000
HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "packages/@xci/server/dist/index.mjs"]
```

The server's `index.ts` serves the SPA static files via `@fastify/static` pointing at `./dist/public/`:

```typescript
// packages/@xci/server/src/app.ts
await fastify.register(fastify_static, {
  root: join(import.meta.dirname, 'public'),
  prefix: '/',
  decorateReply: false,
});
// SPA fallback: all unmatched non-/api/ routes serve index.html
fastify.setNotFoundHandler((request, reply) => {
  if (!request.url.startsWith('/api/') && !request.url.startsWith('/ws/') && !request.url.startsWith('/hooks/')) {
    return reply.sendFile('index.html');
  }
  reply.code(404).send({ error: 'not_found' });
});
```

---

## 10. Build Order Dependency DAG

### Phase Dependency Graph

```
Phase A: Monorepo Setup
  └── outputs: pnpm workspace, turbo, biome, tsconfig paths, package.json files
      (no dependencies — pure scaffolding)

Phase B: Database + Schema (depends on A)
  └── outputs: Drizzle schema, migration files, Postgres docker-compose, migration runner
      B is required by: C (auth), D (agents), E (tasks), F (dispatch)

Phase C: Auth + Session (depends on A, B)
  └── outputs: /api/auth routes, session table, password hashing, cookie, CSRF
      C is required by: all authenticated routes

Phase D: Agent Registration + WebSocket Protocol (depends on A, B, C)
  └── outputs: agent table, agent_tokens, WS upgrade route, handshake, heartbeat,
               TOFU registration, agent status tracking, disconnect detection
      D is required by: F (dispatch needs live agents), G (logs need agent WS)

Phase E: Task CRUD + YAML DSL Server-Side (depends on A, B, C)
  └── outputs: tasks table, /api/tasks CRUD, YAML validation using xci commandsLoader,
               require_labels schema, task editor in UI
      E is required by: F (dispatch references tasks), H (plugins map to tasks)

Phase F: Dispatch Pipeline + TaskRun State Machine (depends on A, B, C, D, E)
  └── outputs: task_runs table, dispatcher, queue, label matching, dispatch WS frame,
               state machine transitions, timeout enforcement, orphan detection,
               manual trigger REST endpoint
      F is required by: G (logs belong to runs), H (plugins trigger dispatch)

Phase G: Log Streaming (depends on A, B, D, F)
  └── outputs: log_chunks table, RunBuffer, persist, fanout, UI WS /ws/logs/:runId,
               log viewer page, retention job
      G can be developed in parallel with Phase E and parts of Phase H.

Phase H: Plugin System + Webhooks (depends on A, B, C, E, F)
  └── outputs: TriggerPlugin interface, registry, /hooks/:plugin/:orgId route,
               GitHub plugin (HMAC verify + push/PR parse + mapToTask),
               Perforce plugin (trigger script format + mapToTask),
               plugin_configs table + UI config form, webhook_events table

Phase I: Secrets Management (depends on A, B, C)
  └── outputs: org_secrets table, envelope encryption (MEK/DEK), /api/secrets CRUD,
               secret resolution at dispatch (in F — add to F or as F.1),
               secret injection into DispatchPayload
      I can be developed in parallel with D, E; must complete before F is fully functional.

Phase J: Web Dashboard UI (depends on C, D, E, F, G)
  └── outputs: React SPA scaffolding, auth pages, agent dashboard, task editor,
               log viewer, manual trigger button
      J can start in parallel with D/E/F since UI pages are feature-flagged.
      J.log-viewer specifically depends on G.

Phase K: Billing Stub + Org Management (depends on A, B, C)
  └── outputs: OrgPlan field, quota enforcement at dispatch + registration,
               /api/org CRUD, membership invite flow
      K is largely independent; can run in parallel with D-J.
      Quota enforcement in dispatch (Phase F) needs K's model.

Phase L: Docker + Publishing (depends on all)
  └── outputs: Dockerfile, docker-compose, CI workflow, npm publish config
```

### DAG Summary (parallelism noted)

```
A ──┬──► B ──┬──► C ──┬──► D ──────────────► F ──► G
    │        │        │                      ▲     ▲
    │        │        ├──► E ────────────────┘     │
    │        │        │                            │
    │        │        └──► I ──────────────────────┘
    │        │
    │        └── (B alone enables K in parallel)
    │
    └── J starts after C; UI pages gate on D/E/F/G completion
        H starts after E + F

Terminal: L depends on all phases completing
```

**Phases that CAN be built in parallel (after their dependencies):**
- D and E: both depend on B+C, no dependency between them.
- G and H: G depends on D+F; H depends on E+F. They share F as a dependency but not each other.
- I and D/E: I only needs B+C; can run in parallel with D and E.
- K and D/E/G/H: K only needs B+C; organizational quota enforcement plugs in at F boundary.
- J.auth (login/signup pages): can start once C exists.
- J.agent-dashboard: starts after D.
- J.task-editor: starts after E.
- J.log-viewer: starts after G.

**v1 backward-compat checkpoint:**
After Phase A (monorepo setup), the CI MUST run `pnpm --filter xci test` and verify all 202 tests pass. This check runs on every PR touching `packages/xci/` or the monorepo workspace config. No changes to `packages/xci/src/cli.ts`, `packages/xci/src/config/`, `packages/xci/src/commands/`, `packages/xci/src/executor/`, or `packages/xci/src/resolver/` are permitted unless they are strictly additive (new exports, not mutations of existing behavior). The tsup entry for `cli.ts` must not change (no new imports in the bundle).

---

## Integration Points with v1 Architecture

| v1 Component | v2.0 Treatment | Notes |
|-------------|----------------|-------|
| `src/cli.ts` | UNTOUCHED except for 3-line dynamic import guard at top of `main()` | The agent dynamic import is inserted before `buildProgram()` is called — no other changes |
| `src/types.ts` | UNTOUCHED in place; re-exported via `packages/xci` exports field | New `WsFrame` types go in `packages/@xci/server/src/types.ts`, not here |
| `src/config/` | UNTOUCHED | Used by agent mode to load local config before merging server params |
| `src/commands/` | UNTOUCHED + one additive export | `parseCommandsYaml(yaml: string)` added as a named export alongside existing `commandsLoader` — used by server to validate task YAML |
| `src/executor/` | UNTOUCHED | Agent mode calls `executor.run()` with the same interface |
| `src/resolver/` | UNTOUCHED | Agent mode calls `resolver.resolve()` with the same interface |
| `dist/cli.mjs` | Same filename, same bundle, same shebang | Must not grow by more than ~5KB from the agent mode changes (dynamic import is lazy) |
| `vitest.config.ts` + 202 tests | UNTOUCHED | Run in CI with `pnpm --filter xci test`; must stay green on every commit |

---

## Anti-Patterns to Avoid

### Mixing Agent WS State with HTTP Request Context

The WS connection for an agent is a long-lived object that persists across many HTTP request cycles. Do not store it in a per-request context or a Fastify reply. Use a singleton `WsRegistry` (decorated onto the Fastify instance via `fastify.decorate`) that maps `agentId → WebSocket`.

### Cross-Org Queries Without orgId Filter

Every Drizzle query that reads from a tenant table must include `WHERE org_id = ${orgId}`. Enforce this via TypeScript: repository functions accept `orgId` as a required parameter, not an optional one. A linting rule or code review checklist is sufficient; a generic "tenant filter" decorator is over-engineering for v2.0.

### Bundling ws into the CLI Entry

`ws` and `reconnecting-websocket` must be in the `external` list for the `cli.ts` tsup entry. Verify with `node --print "require.resolve('./dist/cli.mjs')"` and check bundle size does not exceed 140KB. Add a CI step: `du -sh dist/cli.mjs` and fail if > 200KB.

### Server-Side Secret Logging

The pino instance must have a custom serializer that strips `params`, `value`, `password_hash`, `token`, `ciphertext` from any log object. Apply at server startup:

```typescript
const fastify = Fastify({
  logger: {
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),  // no body
      res: (res) => ({ statusCode: res.statusCode }),
    },
  },
});
```

Route handlers that log task dispatch must explicitly pass a redacted payload:

```typescript
request.log.info({ taskRunId: run.id, agentId: agent.id }, 'task dispatched');
// NOT: request.log.info({ frame }, 'dispatched') — frame contains plaintext params
```

### In-Memory Queue Loss on Restart

The v2.0 in-memory dispatch queue will lose `QUEUED` runs on server restart. Mitigation: on server startup, query `SELECT id FROM task_runs WHERE status = 'queued'` and re-enqueue them. This is a startup reconciliation step, not a persistent queue. Document this behavior; v2.1 can add a proper queue if needed.

---

## Sources

- Buildkite agent protocol docs (MEDIUM confidence — proprietary, inferred from public docs + OSS agent source)
- GitHub Actions self-hosted runner source (MEDIUM confidence — behavior documented in official docs)
- Fastify WebSocket plugin docs: https://github.com/fastify/fastify-websocket — plugin usage confirmed
- Drizzle ORM relations/multi-tenant patterns: https://orm.drizzle.team/docs/rqb — confirmed
- node:crypto AES-256-GCM: https://nodejs.org/api/crypto.html — HIGH confidence
- Envelope encryption pattern: standard KMS pattern, confirmed by AWS KMS documentation
- TypeBox schema sharing pattern: https://fastify.dev/docs/latest/Reference/TypeScript/ — HIGH confidence
- pnpm workspaces: https://pnpm.io/workspaces — HIGH confidence
- Turborepo pipeline: https://turborepo.dev/docs/crafting-your-repository/running-tasks — HIGH confidence
