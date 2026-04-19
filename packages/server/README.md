# @xci/server

HTTP API server for xci Remote CI (v2.0). Fastify + Drizzle + Postgres.

## What This Package Is

`@xci/server` is the backend for the xci web dashboard and agent fleet. In Phase 7 (this release) it provides:

- User signup, email verification, login, logout, password reset
- Multi-tenant org model (Owner / Member / Viewer roles)
- Org invites (email-pinned, 7-day expiry)
- Free-plan quota entity (enforcement lands in Phase 10)
- Multi-tenant isolation enforced by a scoped repository wrapper + two-org integration fixture

Phase 8+ will add: agent registration and WebSocket protocol (Phase 8), task definitions and secrets (Phase 9), dispatch pipeline and quota enforcement (Phase 10), log streaming (Phase 11), plugin system (Phase 12), web dashboard (Phase 13), Docker and publishing (Phase 14).

## Status

- **Current phase:** Phase 7 — Database Schema and Auth (this release)
- **npm package:** `@xci/server` (scope pre-verified; first publish happens in Phase 14)
- **Node.js:** >=20.5.0 (22 LTS recommended)
- **Database:** Postgres 16 (16-alpine used for CI / testcontainers; full Postgres 16 recommended for production)

## Prerequisites

- Node.js >=20.5.0
- pnpm 10.33.0 (pinned via root `packageManager`)
- Docker (ONLY required to run the integration test suite locally; unit tests do not need it)
- Postgres 16 for running the server locally (testcontainers auto-provisions a container for tests)

## Stack

| Dependency | Version | Purpose |
|------------|---------|---------|
| fastify | 5.8.5 | HTTP server framework |
| drizzle-orm | 0.45.2 | Type-safe ORM |
| postgres (postgres-js) | 3.4.9 | Postgres driver |
| @node-rs/argon2 | 2.0.2 | Password hashing (Argon2id, m=19456/t=2/p=1) |
| @fastify/env | 6.0.0 | Env var JSON-schema validation, fail-fast at boot |
| @fastify/cookie | 11.0.2 | Cookie parser and signing |
| @fastify/csrf-protection | 7.1.0 | Signed double-submit CSRF |
| @fastify/rate-limit | 10.3.0 | Per-route rate limiting |
| @fastify/helmet | 13.0.2 | Security headers |
| fastify-plugin | 5.0.1 | Plugin encapsulation |
| nodemailer | 8.0.5 | Email transport |
| pino | 10.3.1 | Logger (Fastify default) |
| drizzle-kit | 0.31.10 | dev only — migration generation |
| @testcontainers/postgresql | 11.14.0 | dev only — integration test DB |
| tsx | 4.21.0 | dev only — TypeScript-on-the-fly for `dev` script |

## Environment Variables

See `.env.example` for the full list. Required at boot (server fails to start if missing or invalid):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Postgres connection string (`postgresql://user:pass@host:5432/db`) |
| `SESSION_COOKIE_SECRET` | >=32 bytes; used by `@fastify/cookie` to sign the `xci_sid` session cookie |
| `EMAIL_TRANSPORT` | `log` or `stub` or `smtp` (see below) |

`EMAIL_TRANSPORT` modes:
- `log` (dev default) — prints email metadata to stdout, no real SMTP
- `stub` (test default) — captures in-memory, exposed to tests via `getCapturedEmails()`
- `smtp` (prod) — requires `SMTP_HOST` + `SMTP_FROM`; optional `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`

Optional variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `PORT` | `3000` | HTTP listen port |
| `LOG_LEVEL` | `info` | pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) |

## Commands

All commands run from the monorepo root as `pnpm --filter @xci/server <script>`:

| Command | What it does |
|---------|-------------|
| `build` | `tsc -b` — emits `dist/` |
| `dev` | `tsx src/server.ts` — runs server with TypeScript-on-the-fly |
| `typecheck` | `tsc -b --noEmit` |
| `lint` | `biome check .` |
| `lint:fix` | `biome check --write .` |
| `test` | Unit suite only (delegates to `test:unit`) |
| `test:unit` | `vitest run --config vitest.unit.config.ts` — no DB required |
| `test:integration` | `vitest run --config vitest.integration.config.ts` — spins up Postgres 16-alpine via testcontainers |
| `test:watch` | `vitest --config vitest.unit.config.ts` |
| `db:generate` | `drizzle-kit generate` — produces SQL migration files under `drizzle/` |

## Running Locally

```bash
# Copy env template
cp packages/server/.env.example packages/server/.env

# Edit .env with your values (minimum: DATABASE_URL + SESSION_COOKIE_SECRET + EMAIL_TRANSPORT)

# Start local Postgres (any Postgres 16 instance works)
docker run -d --name xci-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:16

# Install and run
pnpm install
pnpm --filter @xci/server dev
```

Migrations run programmatically at boot — no manual `drizzle-kit migrate` step needed.

## Running Tests

```bash
# Unit tests (no Docker needed — runs on all platforms)
pnpm --filter @xci/server test:unit

# Integration tests (requires Docker for testcontainers — Linux recommended)
pnpm --filter @xci/server test:integration

# Both
pnpm --filter @xci/server test:unit && pnpm --filter @xci/server test:integration
```

In CI, integration tests run on a Linux-only job (`integration-tests` in `.github/workflows/ci.yml`) after the main 6-matrix `build-test-lint` job passes. Windows and macOS matrix jobs run unit tests only (Docker not reliably available on those runners).

## Architecture Overview

`@xci/server` is a Fastify v5 app backed by Postgres via Drizzle ORM. The entire data access layer is organized around a scoped repository pattern that structurally enforces multi-tenant isolation: every org-scoped table is reachable only through `forOrg(orgId)`, making cross-tenant data leakage a compile-time error rather than a runtime risk.

### Scoped Repository Wrapper (D-01)

The only way to query org-scoped tables is through `forOrg(orgId)`. Importing individual repo files directly from a route handler is blocked by Biome's `noRestrictedImports` rule. Example:

```ts
import { makeRepos } from '@xci/server/repos';

const repos = makeRepos(fastify.db);
const { users } = repos.forOrg(request.org.id);
const member = await users.findById(userId); // org_id = request.org.id filter is automatic
```

Cross-org operations (signup, cross-org lookups, invite acceptance) use the deliberately friction-inducing `repos.admin` namespace. Any `repos.admin.*` call in a route handler is an immediate code-review flag.

### D-04 Auto-Discovery Isolation Test

`src/repos/__tests__/isolation-coverage.isolation.test.ts` walks `src/repos/` at test time and fails CI if any public `makeXxxRepo()` factory lacks a corresponding `<name>.isolation.test.ts` or the test does not reference the factory by name. Adding a new repo function without a test makes CI red.

### Fastify Plugin Registration Order (D-06, locked)

```
@fastify/env
  → db-plugin (decorates fastify.db)
  → @fastify/helmet (security headers)
  → @fastify/cookie (session cookie signing)
  → @fastify/csrf-protection (double-submit, per-route opt-in)
  → @fastify/rate-limit (global 100/min default + per-route overrides)
  → auth-plugin (decorates req.user / req.org / req.session)
  → error-handler (centralized XciServerError → HTTP mapping)
  → routes (prefix /api)
```

Each plugin declares `dependencies` so Fastify enforces the order at register time. `@fastify/autoload` is deliberately not used (explicit is safer in Phase 7).

### API Endpoints

**Auth routes** (`/api/auth/*`):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/signup` | Create account + personal org; sends verification email |
| POST | `/api/auth/verify-email` | Consume single-use 24h token from email |
| POST | `/api/auth/login` | Verify credentials; set `xci_sid` session cookie |
| POST | `/api/auth/logout` | Revoke session; clear cookie (CSRF required) |
| POST | `/api/auth/request-reset` | Send password-reset email (always 204, no enumeration) |
| POST | `/api/auth/reset` | Consume single-use 1h token; update password; revoke all sessions |
| GET  | `/api/auth/csrf` | Issue CSRF token for SPA pre-flight |

**Org routes** (`/api/orgs/:orgId/*`, owner-only):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/orgs/:orgId/invites` | Send email-pinned invite (7d expiry) |
| GET | `/api/orgs/:orgId/invites` | List pending invites |
| DELETE | `/api/orgs/:orgId/invites/:inviteId` | Revoke invite |
| PATCH | `/api/orgs/:orgId/members/:userId` | Change member role (owner immutable) |

**Invite routes** (`/api/invites/*`, authenticated):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/invites/:token/accept` | Accept invite (email-pinned: must match session user's email) |

**Utility**:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/healthz` | Health probe (200 OK) |

### Database Schema

8 tables, all with text PKs (`xci_<prefix>_<rand>`), `created_at`/`updated_at` timestamps, and `org_id` FKs on every org-scoped table:

| Table | Description |
|-------|-------------|
| `orgs` | Organizations (slug unique) |
| `users` | Accounts (lower(email) unique, emailVerifiedAt) |
| `org_members` | M:N org-user with role (Owner partial unique index) |
| `org_plans` | 1:1 with org; Free defaults: maxAgents=5, maxConcurrentTasks=5, logRetentionDays=30 |
| `sessions` | Opaque token, slidingExpiry 14d (max 30d), revokedAt for logout |
| `email_verifications` | Single-use 24h tokens for signup flow |
| `password_resets` | Single-use 1h tokens for reset flow |
| `org_invites` | Email-pinned tokens with 7d expiry, role locked at creation |

### Adding New Migrations

```bash
# Edit packages/server/src/db/schema.ts to add columns/tables
pnpm --filter @xci/server db:generate
# Commit the new SQL file in packages/server/drizzle/
```

The programmatic migrator (`src/db/migrator.ts`) runs all pending SQL migrations at server boot. `drizzle-kit` stays a devDependency and never enters the production image.

## Security Properties

- **Passwords**: Argon2id, m=19456/t=2/p=1 (OWASP 2024). `argon2SelfTest()` runs before `listen()` and warns if timing is outside 100ms–2000ms.
- **Session cookies**: `xci_sid`, `httpOnly`, `secure` (production), `sameSite=strict`. 32-byte random opaque token.
- **CSRF**: `@fastify/csrf-protection` double-submit, per-route opt-in. Signup/login are CSRF-exempt (no session yet).
- **Rate limiting**: 5/h per IP on signup; 10/15min per IP+email on login; 3/h per IP+email on password-reset.
- **Email enumeration**: login and request-reset never disclose whether an email exists.
- **Pino redaction**: `req.body.password`, `req.body.token`, `req.headers.cookie`, `req.headers.authorization`, and `req.raw.headers.*` equivalents are redacted from logs.
- **Invite email-pin**: invite acceptance validates that the accepting user's email matches the invite email (case-insensitive). Anyone-with-link is rejected.

## Agents

The server accepts persistent WebSocket connections from `xci --agent` daemons and exposes 5 REST endpoints for agent lifecycle management.

### WebSocket Endpoint: `GET /ws/agent`

Unauthenticated HTTP upgrade. Authentication happens via the **first frame** (never in URL — ATOK-03).

#### First-Frame Handshake

- Agent MUST send a `register` or `reconnect` frame within 5 seconds of WS open, else server closes with code `4005` (handshake_timeout).
- `{type: 'register', token, labels}` — single-use 24h registration token; server returns `{type: 'register_ack', agent_id, credential}`. The credential is plaintext returned ONCE; server stores sha256 hash at rest.
- `{type: 'reconnect', credential, running_runs: []}` — permanent credential from previous registration; server returns `{type: 'reconnect_ack', reconciliation: []}` (Phase 10 populates reconciliation with real task run state).

#### Heartbeat (D-16)

Server sends WS `ping` every 25s; agent's `ws` library auto-replies with `pong`. Missing pong within 10s → close `4003` (heartbeat_timeout). `last_seen_at` column updated on every pong and every incoming frame.

#### Close Codes

| Code | Meaning |
|------|---------|
| 1000 | Normal closure (agent goodbye) |
| 1001 | Server shutting down |
| 4001 | Credential revoked (terminal — agent stops reconnecting) |
| 4002 | Token invalid or frame invalid (terminal) |
| 4003 | Heartbeat timeout |
| 4004 | Superseded (another agent with same id connected) |
| 4005 | Handshake timeout (first frame not received within 5s) |

### REST Endpoints

All routes are session-authenticated (Phase 7 session cookie). Mutating routes require CSRF token.

| Method | Path | Role | CSRF | Description |
|--------|------|------|------|-------------|
| `POST` | `/api/orgs/:orgId/agent-tokens` | Owner, Member | yes | Create a single-use 24h registration token. Rate-limited 10/h per org+user. Returns `{token, expiresAt}` — plaintext shown ONCE. |
| `GET` | `/api/orgs/:orgId/agents` | any org member | no | List agents with computed state `online\|offline\|draining`. State is derived from `last_seen_at` (< 60s → online) unless admin-set to `draining`. |
| `PATCH` | `/api/orgs/:orgId/agents/:agentId` | Owner, Member | yes | Update `hostname` or `state` (toggle `draining`/`online`). Drain change propagates as `{type:'state', state:'draining'}` frame to connected agent (AGENT-06). |
| `POST` | `/api/orgs/:orgId/agents/:agentId/revoke` | Owner, Member | yes | Mark credential `revoked_at = now()` AND force-close connected WS with code `4001` (ATOK-04). |
| `DELETE` | `/api/orgs/:orgId/agents/:agentId` | Owner only | yes | Hard delete (CASCADE removes credentials). |

### Database Schema (Phase 8 additions)

Three new tables added in migration `0001_agents_websocket.sql`:

| Table | Description |
|-------|-------------|
| `agents` | One row per registered agent. Stores `hostname`, `labels` (jsonb), `state`, `last_seen_at`, `registered_at`. Org-scoped. |
| `agent_credentials` | Stores sha256 hash of the permanent credential. Partial unique index enforces at-most-one active credential per agent (`WHERE revoked_at IS NULL`). |
| `registration_tokens` | Single-use 24h tokens for initial registration. Stores sha256 hash; plaintext returned once on creation. |

### Operational Notes

- **Single-instance only** — the in-memory `agentRegistry: Map<agentId, WebSocket>` is per-process. Horizontal scaling requires a Redis pub/sub layer (deferred to post-v2.0).
- **TLS is the operator's responsibility** — use a reverse proxy (nginx, Caddy) or cloud LB to terminate TLS before Fastify.
- **Token security** — all token comparisons use `crypto.timingSafeEqual()` (ATOK-06). Credentials are never logged (pino redact rules cover `req.body.credential` and `*.credential`).
- **Phase 10 scope** — quota enforcement (`max_agents=5` per Free plan) and task dispatch frames are implemented in Phase 10. Phase 8 delivers the full registration/auth/heartbeat/lifecycle framework.

## Secrets & Tasks (Phase 9)

Phase 9 introduced server-side task definitions (stored YAML DSL, validated at save) and org-level encrypted secrets. The full API is documented inline; the section below covers operational runbook for MEK rotation.

### API Endpoints (Phase 9)

**Task routes** (`/api/orgs/:orgId/tasks/*`, session required):

| Method | Path | Role | CSRF | Description |
|--------|------|------|------|-------------|
| `GET` | `/api/orgs/:orgId/tasks` | any member | no | List tasks (metadata, no yamlDefinition) |
| `GET` | `/api/orgs/:orgId/tasks/:taskId` | any member | no | Get full task including yamlDefinition |
| `POST` | `/api/orgs/:orgId/tasks` | Owner/Member | yes | Create task; validates YAML at save (4-step D-12 pipeline) |
| `PATCH` | `/api/orgs/:orgId/tasks/:taskId` | Owner/Member | yes | Update task; same validation as POST |
| `DELETE` | `/api/orgs/:orgId/tasks/:taskId` | Owner only | yes | Delete task |

**Secrets routes** (`/api/orgs/:orgId/secrets/*`, session required):

| Method | Path | Role | CSRF | Description |
|--------|------|------|------|-------------|
| `GET` | `/api/orgs/:orgId/secrets` | any member | no | List secrets (metadata only — name, created_at; no plaintext ever) |
| `POST` | `/api/orgs/:orgId/secrets` | Owner/Member | yes | Create secret; encrypts value under org DEK; never returns plaintext |
| `PATCH` | `/api/orgs/:orgId/secrets/:secretId` | Owner/Member | yes | Update secret value; re-encrypts with new IV |
| `DELETE` | `/api/orgs/:orgId/secrets/:secretId` | Owner only | yes | Delete secret; audit log entry written |
| `GET` | `/api/orgs/:orgId/secret-audit-log` | Owner only | no | List audit log entries (action history, metadata only) |

**Admin routes** (`/api/admin/*`, platform-admin only):

| Method | Path | Auth | CSRF | Description |
|--------|------|------|------|-------------|
| `POST` | `/api/admin/rotate-mek` | Platform admin session + PLATFORM_ADMIN_EMAIL match | yes | Re-wrap all org DEKs under new MEK atomically |

### Envelope Encryption Overview

Secrets use two-layer envelope encryption (AES-256-GCM):

1. **MEK (Master Encryption Key)**: 32-byte key stored in `XCI_MASTER_KEY` env var. Parsed once at boot as `fastify.mek`. Never logged.
2. **DEK (Data Encryption Key)**: 32-byte random key per org. Wrapped under MEK and stored in `org_deks` table.
3. **Secret value**: Encrypted under the org's DEK using AES-256-GCM with a random 12-byte IV per call. The AAD (`<orgId>:<secretName>`) binds each ciphertext to its location — moving a row to another org causes authentication tag failure.

No API endpoint ever returns plaintext secret values. The `resolveByName()` repo method is the only code path that returns plaintext, and it is called exclusively by the Phase 10 dispatcher.

### MEK Rotation Runbook

MEK rotation re-wraps all org DEKs under a new MEK without changing any plaintext secret value. The operation is atomic (single Postgres transaction with SELECT FOR UPDATE) and idempotent (calling again with the same new MEK returns `rotated=0`).

**Prerequisites:**
- Shell access to the server environment
- Ability to update the `XCI_MASTER_KEY` environment variable and redeploy
- A session for the account whose email matches `PLATFORM_ADMIN_EMAIL`

**Step 0 — Generate a new 32-byte MEK:**

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
# Output example: bGV0IG1lIGJlIGEgc2VjcmV0IGtleQ==
```

Save this as `<NEW_MEK>`.

**Step 1 — Deploy the server with the current (old) `XCI_MASTER_KEY`.**

The server that performs the rotation reads the OLD mek from `fastify.mek` (set at boot). No transition env vars are needed — the rotation endpoint accepts the new MEK in the request body.

**Step 2 — Call the rotate endpoint:**

```bash
curl -X POST https://<server>/api/admin/rotate-mek \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf-token>" \
  -b "xci_sid=<session-cookie>" \
  -d '{"newMekBase64": "<NEW_MEK>"}'
```

Expected response:

```json
{ "rotated": 3, "mekVersion": 2 }
```

`rotated` is the number of org DEKs re-wrapped. `mekVersion` is the new version counter applied to all rows.

**Step 3 — Redeploy with `XCI_MASTER_KEY=<NEW_MEK>`.**

After redeployment, `fastify.mek` is the new key. All DEKs are already wrapped under it, so decryption resumes immediately.

**Step 4 — Verify:**

Log in, list secrets (metadata should be intact), and confirm a dispatch (Phase 10 once available) succeeds end-to-end.

**Failure handling:**

If Step 2 fails mid-rotation, Drizzle rolls back the entire transaction (atomicity). On retry with the SAME `newMekBase64`, the D-28 idempotency guard skips rows already at the new `mek_version` — `rotated` returns the remaining count or 0. Safe to re-run.

**Accepted downtime risk (T-09-06-10):**

Between Step 2 commit and Step 3 server restart, the running server still has the OLD `fastify.mek`. Any secret read attempt using the old mek against newly re-wrapped DEKs will fail with a decryption error. Plan the rotation during a low-traffic window or accept a short read outage. A future enhancement would hot-swap via SIGHUP + env re-read.

## Dispatch Pipeline & Quota Enforcement (Phase 10)

Phase 10 wires the server-side dispatch pipeline and closes the loop between task definitions (Phase 9) and agent execution (agent-side runner).

### REST Endpoints

| Method | Path | Role | CSRF | Description |
|--------|------|------|------|-------------|
| `POST` | `/api/orgs/:orgId/tasks/:taskId/runs` | Owner/Member | yes | Trigger a run. Body: `{param_overrides?: Record<string,string>, timeout_seconds?: int}`. Returns `{runId, state:'queued'}`. QUOTA-04 enforces queue-depth cap (max_concurrent*2). |
| `GET` | `/api/orgs/:orgId/runs` | any member | no | List runs. Query: `?state=&taskId=&limit=&since=`. Paginated (cursor). |
| `GET` | `/api/orgs/:orgId/runs/:runId` | any member | no | Get full run row including task_snapshot and exit_code. |
| `POST` | `/api/orgs/:orgId/runs/:runId/cancel` | Owner/Member | yes | Cancel a running or queued run. Sends `cancel` WS frame to agent. Idempotent on terminal runs (200 + current state). |
| `GET` | `/api/orgs/:orgId/usage` | any member | no | Returns `{agents:{used,max}, concurrent:{used,max}, retention_days}`. QUOTA-06. |

### WebSocket Frame Types (Phase 10 additions)

In addition to the Phase 8 handshake frames, Phase 10 adds:

**Server → Agent:**

| Frame | Description |
|-------|-------------|
| `{type:'dispatch', run_id, task_snapshot, params, timeout_seconds}` | Dispatch a task run to the agent. `task_snapshot` is the YAML definition snapshot at dispatch time. `params` are server-resolved parameters (org secrets merged). |
| `{type:'cancel', run_id, reason}` | Cancel a running task. `reason`: `manual` \| `timeout` \| `reconciled_terminal`. |

**Agent → Server:**

| Frame | Description |
|-------|-------------|
| `{type:'state', state:'running', run_id}` | Dispatch acceptance ACK. Transitions run DB state from `dispatched` to `running`. |
| `{type:'log_chunk', run_id, seq, stream, data, ts}` | Stdout/stderr chunk from the spawned subprocess. Phase 10 server discards; Phase 11 will persist and fan out to UI subscribers. |
| `{type:'result', run_id, exit_code, duration_ms, cancelled?}` | Run completion. `exit_code=0` → `succeeded`; non-zero → `failed`; `cancelled:true` → `cancelled`/`timed_out` depending on trigger. |

### Dispatch Architecture

```
POST /runs (trigger)
  → INSERT task_runs (state=queued) + enqueue in-memory DispatchQueue
  → DispatchQueue.tick() every 250ms:
      → findEligibleAgent(labelRequirements, orgId, maxConcurrent)
        → agents WHERE online AND labels match AND active_runs < max_concurrent
        → least-busy; round-robin tiebreak
      → atomicDispatch(): UPDATE task_runs SET state=dispatched WHERE state=queued
      → send {type:'dispatch'} frame via WS
  → agent sends {type:'state', state:'running'} → UPDATE task_runs SET state=running
  → agent sends {type:'result'} → UPDATE task_runs SET state=succeeded|failed + exit_code + duration_ms
```

### Run State Machine

```
queued → dispatched (dispatcher tick picks up the run)
dispatched → running  (agent sends state:running ACK)
dispatched → orphaned (agent offline before ACK — boot reconciliation)
running → succeeded   (agent result with exit_code=0)
running → failed      (agent result with non-zero exit_code)
running → cancelled   (cancel frame sent + agent result with cancelled:true)
running → timed_out   (timeout fires — server sends cancel; agent result overridden)
any → orphaned        (boot reconciliation: active run without connected agent session)
```

All state transitions are guarded by `UPDATE WHERE state=expected` (atomic CAS) to prevent races.

### Quota Rules

| Rule | Enforcement | Error |
|------|-------------|-------|
| QUOTA-03: max agents | At WS registration handshake: `count(agents WHERE org_id) >= orgPlan.max_agents` → close WS with code `4006` | `AGENT_QUOTA_EXCEEDED` |
| QUOTA-04: concurrent runs | At queue entry: `count(dispatched+running) >= orgPlan.max_concurrent_tasks * 2` → 429 | `RunQuotaExceededError` |
| QUOTA-05: retention config | `orgPlan.log_retention_days` exposed via GET /usage; log purge owned by Phase 11 | — |
| QUOTA-06: usage display | GET /usage returns `{agents:{used,max}, concurrent:{used,max}, retention_days}` | — |

### Boot Reconciliation (DISP-08)

On `app.ready()`:
1. `state=queued` → re-add to in-memory DispatchQueue (no DB change).
2. `state=dispatched|running` with `agent_id` NOT in live `agentRegistry` → `state=orphaned`, `exit_code=-1`, `finished_at=now()`.
3. `state=dispatched|running` whose timeout window expired → `state=timed_out`, `exit_code=-1`.
4. `state=dispatched|running` whose agent IS connected → leave alone; agent reconciles via `running_runs` in reconnect frame.

### Timeout Management (DISP-06)

Per-run `setTimeout(timeoutSeconds * 1000)` registered when run enters `dispatched` state. On timeout: server sends `{type:'cancel', run_id, reason:'timeout'}` to agent and transitions run to `timed_out`. On result received: timer cleared. On server crash: boot reconciliation (#3 above) catches expired timers.

## Phase 11 — Log Streaming & Persistence

Agent `log_chunk` frames are persisted to Postgres and fanned out to subscribed UI clients in real time.

- **Table**: `log_chunks` — columns: `run_id` (FK → task_runs ON DELETE CASCADE), `seq` (integer), `stream` (stdout/stderr), `data` (text, Postgres TOAST), `ts` (timestamptz), `persisted_at`; unique index on `(run_id, seq)` for idempotent replay
- **Pipeline**: `handleLogChunkFrame` → `redactChunk` (server-side org-secret redaction, longest-first) → `LogBatcher` (flush at 50 chunks OR 200ms, 1000-item drop-head overflow) → `forOrg.logChunks.insertBatch`; live fanout via `LogFanout` (500-queue drop-head per subscriber, gap frame on overflow)
- **Subscribe endpoint**: `GET /ws/orgs/:orgId/runs/:runId/logs` — WebSocket upgrade (no `/api` prefix); cookie auth via `authPlugin.onRequest` before upgrade; client sends `{type:'subscribe', sinceSeq?}`; server replays from DB then streams live; terminal run sends `{type:'end'}` + 5s close grace
- **Download endpoint**: `GET /api/orgs/:orgId/runs/:runId/logs.log` — `text/plain; charset=utf-8` attachment; streaming via `reply.hijack()` + cursor pagination (1000 rows/page); `Cache-Control: no-store`
- **Retention**: `startLogRetentionJob` runs one immediate pass on `onReady` + `setInterval().unref()` every `LOG_RETENTION_INTERVAL_MS`; CTE DELETE batched at 10k rows/iteration across all orgs using `org_plan.log_retention_days`
- **Server-side redaction**: `runRedactionTables` Map seeded at dispatch time (org secrets + raw/base64/URL/hex variants, sorted longest-first); `clearRedactionTable` called on terminal result frame
- **Agent-side redaction**: `runner.ts redactLine` applies `.xci/secrets.yml` values (≥4 chars, longest-first) to each chunk before the `onChunk` callback fires; chunks split to 8KB max via `splitChunk`

### Environment Variables (Phase 11)

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_RETENTION_INTERVAL_MS` | `86400000` (24h) | How often the log retention cleanup job runs |

### WebSocket Frame Grammar (`/ws/orgs/:orgId/runs/:runId/logs`)

**Client → Server:**

| Frame | Description |
|-------|-------------|
| `{type:'subscribe', sinceSeq?: number}` | First and only client frame; `sinceSeq` resumes replay after a reconnect |

**Server → Client:**

| Frame | Description |
|-------|-------------|
| `{type:'chunk', seq, stream, data, ts}` | Log chunk (catch-up replay or live) |
| `{type:'gap', droppedCount}` | Slow subscriber buffer overflow; `droppedCount` chunks were dropped |
| `{type:'end', state, exitCode}` | Run reached terminal state; socket closed after 5s |
| `{type:'error', code}` | Auth or validation failure; socket closed |

## Plugin System & Webhooks (Phase 12)

xci server supports incoming webhooks via a pluggable trigger architecture. Two bundled plugins ship with every release: GitHub and Perforce. Plugins are bundled at build time — NO dynamic runtime install (PLUG-02).

### Webhook endpoints

- `POST /hooks/github/:orgToken` — GitHub push + pull_request events
- `POST /hooks/perforce/:orgToken` — Perforce change-commit trigger (JSON body)

Both endpoints are unauthenticated at the session layer — the `:orgToken` URL path segment identifies the org (via sha256 hash lookup in `webhook_tokens`). GitHub requests are verified by HMAC-SHA256 against the per-token `plugin_secret`. Perforce requests are verified by `X-Xci-Token` header match.

### Managing webhook tokens

`POST /api/orgs/:orgId/webhook-tokens` (Owner/Member, CSRF):
- body: `{ pluginName: 'github' | 'perforce', pluginSecret?: string }`
- returns: `{ id, plaintext, endpointUrl }` — **plaintext is returned ONCE; store it immediately**

Other endpoints: `GET /api/orgs/:orgId/webhook-tokens` (list), `POST /api/orgs/:orgId/webhook-tokens/:id/revoke`, `DELETE /api/orgs/:orgId/webhook-tokens/:id` (Owner-only).

### Dead Letter Queue (DLQ)

Any webhook that fails the verify→parse→mapToTask pipeline lands in `dlq_entries`. Sensitive headers (`Authorization`, `X-Hub-Signature`, `X-Hub-Signature-256`, `X-GitHub-Token`, `X-Xci-Token`, `Cookie`, `Set-Cookie`) are stripped before persist (PLUG-08).

- `GET /api/orgs/:orgId/dlq` — list DLQ entries (any member; filter by plugin/reason/since)
- `POST /api/orgs/:orgId/dlq/:dlqId/retry` — replay through parse→mapToTask→dispatch (Owner/Member; CSRF)

**Retry semantics:** signature verification is **skipped** on retry (D-20) — the admin is consciously accepting the event. The retry endpoint logs `dlq_retry_skipping_signature_verify` at WARN level for audit.

### Idempotency

The `webhook_deliveries` table tracks `(plugin_name, delivery_id)` uniquely. A duplicate GitHub `X-GitHub-Delivery` or Perforce `delivery_id` returns `200 {status:'duplicate'}` with a WARN log; no second task_run is created.

### Task trigger configuration

Tasks store `trigger_configs` JSONB on the `tasks` table — an array of `GitHubTriggerConfig | PerforceTriggerConfig`. Explicit per-task configuration (no naming convention): a task with an empty `trigger_configs` array is NOT triggerable via webhook. Validation happens on task create/update via `validateTriggerConfigs`.

## Phase 13 additions

### GET /api/auth/me (authenticated)

Returns the current session's user, org membership, and plan details. Used by the web SPA to hydrate its `authStore` on boot. The `role` field in `org` is the current user's role in the active org.

```
GET /api/auth/me
Cookie: xci_sid=<session-cookie>
```

Response (200 OK):

```json
{
  "ok": true,
  "user": {
    "id": "xci_usr_...",
    "email": "alice@example.com"
  },
  "org": {
    "id": "xci_org_...",
    "name": "Acme",
    "slug": "acme",
    "role": "owner"
  },
  "plan": {
    "planName": "free",
    "maxAgents": 5,
    "maxConcurrentTasks": 5,
    "logRetentionDays": 30
  }
}
```

Returns 401 if the session cookie is missing or expired. The `org` block includes the active org's `slug` field (added by migration 0006 — see below). The `role` value is one of `"owner"`, `"member"`, or `"viewer"`.

### GET /badge/:orgSlug/:taskSlug.svg (unauthenticated, public)

Returns a shields.io-compatible SVG build-status badge (100×20px) for a specific task.

```
GET /badge/acme/deploy-prod.svg
```

Badge states:

| State | Color | Condition |
|-------|-------|-----------|
| `passing` | green | Last terminal run has `state=succeeded` |
| `failing` | red | Last terminal run has `state=failed`, `cancelled`, `timed_out`, or `orphaned` |
| `unknown` | grey | No terminal run exists, task `expose_badge=false`, org/task slug not found |

**Security:** The endpoint returns `200 + grey SVG` for missing or badge-disabled tasks — it never returns 404. This prevents org/task slug enumeration.

Response headers:

```
Content-Type: image/svg+xml
Cache-Control: public, max-age=30
```

Rate limit: 120 requests/minute per IP.

**Embedding in a README:**

```markdown
![build status](https://your-xci-server.example.com/badge/acme/deploy-prod.svg)
```

### Schema migration 0006 — badge slugs

Migration `drizzle/0006_badge_slugs.sql` adds:

- `tasks.slug` — URL-safe task identifier, unique within org. Backfilled from `name` at migration time (lowercased, spaces → hyphens, special chars stripped).
- `tasks.expose_badge` — boolean, default `false`. Tasks with `false` return the grey "unknown" badge.
- `orgs.slug` pre-existed from Phase 7; migration 0006 is a no-op for that column if already present.

To enable a badge for a task, update the task via the UI (Settings tab in the task editor) or via the API:

```bash
curl -X PATCH https://<server>/api/orgs/<orgId>/tasks/<taskId> \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <csrf>" \
  -b "xci_sid=<session>" \
  -d '{"expose_badge": true}'
```

## Design References

- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` — 39 locked decisions
- `.planning/phases/07-database-schema-auth/07-RESEARCH.md` — full stack research and code examples
- `.planning/phases/08-agent-registration-websocket-protocol/08-CONTEXT.md` — 43 locked decisions for Phase 8
- `.planning/phases/09-task-definitions-secrets-management/09-CONTEXT.md` — 44 locked decisions for Phase 9
- `.planning/phases/09-task-definitions-secrets-management/09-TRACEABILITY.md` — Phase 9 requirement-to-test mapping

## License

MIT. See root `LICENSE`.

---

*v2.0 Phase 9 — part of the xci monorepo. See [packages/xci](../xci/README.md) for the v1 CLI.*
