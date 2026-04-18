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

## Design References

- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` — 39 locked decisions
- `.planning/phases/07-database-schema-auth/07-RESEARCH.md` — full stack research and code examples
- `.planning/phases/08-agent-registration-websocket-protocol/08-CONTEXT.md` — 43 locked decisions for Phase 8

## License

MIT. See root `LICENSE`.

---

*v2.0 Phase 8 — part of the xci monorepo. See [packages/xci](../xci/README.md) for the v1 CLI.*
