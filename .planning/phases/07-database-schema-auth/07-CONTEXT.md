# Phase 7: Database Schema & Auth - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** auto-selected (user requested autonomous chain through milestone end)

<domain>
## Phase Boundary

This phase delivers the foundation of `@xci/server`:

1. **Postgres + Drizzle wiring** — connection, migrator (run programmatically at boot per Phase 14 SC-2), `drizzle-kit` as dev dep only
2. **Schema** — `orgs`, `users`, `org_members` (M:N with role), `org_plans` (Free quota), `sessions`, `email_verifications`, `password_resets`, `org_invites`
3. **Auth flows end-to-end** — signup → email verification → login → session cookie → logout; password reset (1h expiry, single-use); org invites (7d expiry, email-pinned)
4. **Multi-tenant isolation as architecture** — every org-scoped repo unreachable without `forOrg(orgId)` wrapper; two-org integration fixture proves no leak across all repo functions
5. **Quota entities** — `OrgPlan` table + Free plan auto-created per org (max_agents=5, max_concurrent_tasks=5, log_retention_days=30). Enforcement at *registration/dispatch* deferred to Phase 10 (this phase only persists the entity + defaults)
6. **Fastify app baseline** — `buildApp()` factory, env-schema config, plugin registration order, error handler, `req.user`/`req.org`/`req.session` decorators that the rest of v2.0 inherits
7. **Security hygiene** — CSRF protection on mutations, rate limiting on signup/login/password-reset (Phase 12 will add webhook ingress)

This phase does NOT deliver:
- Agent registration tokens (ATOK-*) — Phase 8
- Agent entity table (`agents`) — Phase 8
- Task definitions / secrets entities — Phase 9
- Dispatch pipeline / quota *enforcement* — Phase 10
- Log streaming entities — Phase 11
- Webhook ingress / plugin entities — Phase 12
- Web UI for any of the above — Phase 13
- Docker image / docker-compose — Phase 14

**Hard scope rule:** the only requirements implemented here are AUTH-01..12, QUOTA-01, QUOTA-02, QUOTA-07. The `@xci/server` package flips `private: false` here (per Phase 6 D-12) but is not yet published — first publish is Phase 14.

</domain>

<decisions>
## Implementation Decisions

### Multi-tenant Isolation Pattern (the architecture spine of v2.0 server)

- **D-01:** **Scoped repository wrapper** is the structural enforcement of `org_id` filtering. The org-scoped repos are *not exported* from `@xci/server/repos/index.ts` — only the factory `forOrg(orgId)` is. Calling `forOrg('org_abc').users.findById('u1')` is the *only* way to query org-scoped tables. Type system enforces it; no Biome lint rule needed; no runtime check that can be bypassed. Refactor-safe by construction.

- **D-02:** **`orgId` reaches the repo via Fastify request decorator + explicit threading.** A `preHandler` hook in the auth plugin sets `request.user`, `request.org`, `request.session` after session lookup. Route handlers read `request.org.id` and call `forOrg(request.org.id)` explicitly. No AsyncLocalStorage — it breaks for cron jobs (Phase 11 retention) and webhook handlers (Phase 12) that run outside a request context.

- **D-03:** **Cross-org operations live in a separate `adminRepo` namespace.** Used by: signup (creates org before user has session), quota counts (Phase 10), retention cleanup (Phase 11), webhook plugins (Phase 12). Visually distinct in code review — `adminRepo.*` calls in a route handler are an immediate red flag. Org-scoped repos via `forOrg()` are mutually exclusive with `adminRepo` — they live in different modules.

- **D-04:** **SC-4 proof = two-org integration fixture per public repo function + auto-discovery test.** For every function exported from `repos/<table>.ts`, an integration test seeds Org A and Org B with parallel data, calls the function on Org A, asserts Org B data never appears in the result. A meta-test walks the repo exports via `ts-morph` (or simple module introspection) and fails CI if a public function lacks a corresponding isolation test. New repo function added → test must exist or CI red.

### Fastify App Structure

- **D-05:** **App factory pattern.** `buildApp(opts: BuildOpts): FastifyInstance` exported from `src/app.ts`. `opts` accepts `dbPool`, `emailTransport`, `clock`, `crypto.randomBytes` so tests can inject deterministic substitutes. The CLI entry `src/server.ts` calls `buildApp` with prod defaults.

- **D-06:** **Explicit plugin registration order, no autoload.** Server is small in Phase 7; `@fastify/autoload` adds magic without payoff. Order: `@fastify/env` → DB plugin (`db-plugin.ts` decorates `fastify.db`) → `@fastify/cookie` → `@fastify/csrf-protection` → `@fastify/rate-limit` → auth plugin (decorates request) → routes (registered with `prefix: '/api'`). Phase 8+ adds `@fastify/websocket` after auth plugin.

- **D-07:** **`@fastify/env` for env config**, JSON-schema-validated. Required env: `DATABASE_URL`, `SESSION_COOKIE_SECRET` (32+ bytes), `EMAIL_TRANSPORT` (`smtp` | `log` | `stub`), and conditional SMTP fields. Server *fails to boot* on missing/invalid env — no silent defaults.

- **D-08:** **Error handling: `XciServerError` hierarchy mirroring v1's `LociError`.** Subclasses: `ValidationError`, `AuthnError`, `AuthzError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `InternalError`. Centralized error handler maps each to HTTP status + machine-readable `{code, message, requestId}` JSON body. Stack traces only in dev. Secrets never appear in error bodies (same discipline as v1 `ShellInjectionError` from Phase 1 P02).

- **D-09:** **Request decorators set in auth plugin:** `request.user` (User | null), `request.org` (Org | null), `request.session` (Session | null). Routes that need auth use a per-route `preHandler: [requireAuth]` that throws `AuthnError` if `request.session` is null. No global "everything authenticated" middleware — auth is per-route, opt-in.

- **D-10:** **Logging via Fastify's pino default.** Log level from env. Request-id propagated to error responses. Pino redaction config strips known sensitive paths (`req.body.password`, `req.body.token`, `req.headers.cookie`, `req.headers.authorization`). Same secrets-never-logged discipline as v1.

### Session Model

- **D-11:** **Sessions table:** `id (text pk = randomBytes(32) base64url)`, `user_id`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at`. No `ip`/`user_agent` in Phase 7 (privacy default — add later if needed for security audit).

- **D-12:** **Cookie:** name `xci_sid`, attributes `httpOnly + secure + sameSite=strict` (per AUTH-03), `Path=/`, no `Domain` (defaults to host). Cookie value is the session id (the random opaque token). Server stores hash of token? No — token is already 256 bits of entropy and never leaves DB except in the response cookie; storing plaintext is acceptable per AUTH-03 design. (If we later want defense against DB read by attacker, we hash with sha256; flagged as a future hardening, not in Phase 7.)

- **D-13:** **Sliding expiry: 14 days from `last_seen_at`, refreshed on each authenticated request** if `last_seen_at` is older than 1 hour (avoids a write per request). Absolute cap: 30 days from `created_at` regardless of activity. Logout sets `revoked_at` — auth plugin treats `revoked_at IS NOT NULL` as no-session (AUTH-12: irreversible).

- **D-14:** **Multiple concurrent sessions per user allowed** (one per device/browser). No "log out everywhere" UI in Phase 7 (Phase 13 may add it).

### Org Invite Mechanics

- **D-15:** **Email-pinned invites.** `org_invites` row stores invitee email + role + expiry + token. Acceptance flow validates the authenticated user's email matches the invite email (case-insensitive). Anyone-with-link is rejected — security default.

- **D-16:** **Role assigned at invite-time, locked through acceptance.** Owner picks `member` or `viewer` when sending the invite. Invitee cannot upgrade themselves. Owner can change a member's role post-acceptance (different endpoint). Owner role itself is non-transferable in Phase 7 (Phase 13 may add transfer flow).

- **D-17:** **No pre-create user row on invite.** The invite stores email + token only. On acceptance:
  - If invitee email matches an existing user → add `org_members` row with the locked role
  - If no user exists → invitee goes through signup flow first, then accepts invite (link survives signup via session). Personal org is still auto-created at signup.

- **D-18:** **Invitee with existing Personal org keeps it.** Acceptance adds a new `org_members` row for the new org; Personal org membership untouched. User now belongs to 2 orgs. Active org per session is in `sessions.active_org_id` (Phase 13 will surface a switcher; Phase 7 just defaults to most recently active or Personal).

- **D-19:** **Invite token = `randomBytes(32)` base64url**, single-use (`accepted_at` set on acceptance), 7d expiry from `created_at`, `revoked_at` for owner-cancellation. `org_invites` is org-scoped (uses `forOrg`).

### Integration Test Infrastructure

- **D-20:** **`@testcontainers/postgresql` per test suite.** Each `vitest` integration suite spins up an ephemeral Postgres 16-alpine container, runs migrations once, runs all tests, tears down. Container is reused within a suite (faster) but isolated between suites.

- **D-21:** **Postgres image: `postgres:16-alpine`** for tests (lightweight, fast boot). Production image stays `postgres:16` on whatever distro the deployer chooses (server's Dockerfile is Phase 14). Migration SQL must work on both.

- **D-22:** **Cleanup between tests: `TRUNCATE … RESTART IDENTITY CASCADE` on all tables in a single transaction.** Faster than dropping/recreating schema per test. A single `resetDb()` helper wraps it.

- **D-23:** **CI policy: integration tests Linux-only.** Same pattern as Phase 6 D-17 (hyperfine Linux-only). Windows/macOS GitHub runners get unit tests + lint + typecheck + build only. Rationale: testcontainers needs Docker; Linux runners have it preinstalled, Mac/Win runners require Docker Desktop install (slow, flaky). Integration coverage is the same regardless of runner OS.

- **D-24:** **Test layering:**
  - **Unit tests** — pure functions, schema/zod validation, password hashing, token generation. No DB. Run on all 6 matrix jobs.
  - **Repo integration tests** — exercise repo functions against real Postgres. Linux-only. Two-org isolation fixture lives here (D-04).
  - **HTTP integration tests** — `fastify.inject()` for full request/response cycles. Linux-only. Cover auth flows, CSRF, rate-limit.
  - **No E2E tests in Phase 7** — true E2E (multi-process) is Phase 14 docker smoke test.

### Schema Conventions

- **D-25:** **All tables: `id` text PK (`xci_<prefix>_<base32-rand>` — e.g., `xci_org_01h…`).** Not `uuid` — text IDs are URL-safe, sortable-ish, and trivially debuggable. Generated server-side via `nanoid`-style scheme. `created_at`/`updated_at` timestamps on every table (default `now()`).

- **D-26:** **Org-scoped tables have non-null `org_id` FK with `ON DELETE CASCADE`.** Deleting an org wipes all its data — clean tenant isolation, simpler retention.

- **D-27:** **No soft-deletes in Phase 7.** Hard deletes only. Audit log is out of scope for v2.0 (deferred).

- **D-28:** **Migrations: `drizzle-kit generate` produces SQL files in `packages/server/drizzle/`.** Committed to repo. Programmatic migrator at boot reads them in numeric order. `drizzle-kit` is `devDependencies`-only; runtime uses `drizzle-orm/postgres-js/migrator`.

### Email Transport (Phase 7 dev posture)

- **D-29:** **Three transports, env-selected:**
  - `EMAIL_TRANSPORT=log` (dev default) — writes formatted email to stdout, returns success. No real SMTP.
  - `EMAIL_TRANSPORT=stub` (test default) — captures messages in an in-memory array, exposed to tests via `getCapturedEmails()`. No I/O.
  - `EMAIL_TRANSPORT=smtp` (prod) — `nodemailer` SMTP using `SMTP_HOST/PORT/USER/PASS/FROM` env. Mailhog wiring is Phase 14.

- **D-30:** **Email templates as TS template literals in `src/email/templates/*.ts`.** Each template exports `{subject, html, text}` factory functions. No file-based templating engine in Phase 7 — overkill for ~5 transactional emails (verification, reset, invite, invite-revoked, owner-changed).

### Password & Crypto

- **D-31:** **`@node-rs/argon2` Argon2id parameters: `memoryCost: 19456` (19 MiB), `timeCost: 2`, `parallelism: 1`.** Current OWASP 2024 guidance. Centralize in `src/crypto/password.ts`; all hashing/verifying goes through it.

- **D-32:** **Password policy minimum: ≥12 chars, no other complexity rules.** Length-based per current NIST guidance (length > complexity). No haveibeenpwned check in Phase 7 (deferred — adds latency + external dep).

- **D-33:** **Tokens (session, email-verification, password-reset, invite): all `randomBytes(32)` encoded base64url.** Single helper `generateToken()` in `src/crypto/tokens.ts`. Never log token values.

### CSRF & Rate Limit

- **D-34:** **`@fastify/csrf-protection` (double-submit cookie pattern).** Token issued on session creation; validated on all `POST/PUT/PATCH/DELETE` to `/api/*` except `/api/auth/login`, `/api/auth/signup` (session doesn't exist yet — these are protected by rate-limit instead) and webhook routes (Phase 12 has signature-based auth).

- **D-35:** **`@fastify/rate-limit` in-memory store** for v2.0 single-instance server. Limits: signup 5/h per IP, login 10/15min per IP+email-bucket, password-reset 3/h per IP+email-bucket, email-verification resend 3/h per user. `keyGenerator` per-route. Limits configurable via env later.

- **D-36:** **No Redis dependency in Phase 7.** All rate-limit / session storage in Postgres or in-memory. Adds Redis only when horizontal scaling forces it (out of scope for v2.0).

### Quota Entity

- **D-37:** **`org_plans` table** (1:1 with `orgs`, FK + unique on `org_id`). Columns per QUOTA-01: `plan_name` (text, default `'free'`), `max_agents` (int, default 5), `max_concurrent_tasks` (int, default 5), `log_retention_days` (int, default 30), `created_at`, `updated_at`. Auto-created in the same transaction as the org (signup or admin org creation).

- **D-38:** **No enforcement code in Phase 7.** QUOTA-03/04/05/06 enforcement is Phase 10 (dispatcher) and Phase 11 (retention). Phase 7 only persists the entity + defaults.

### Backward Compat

- **D-39:** **Zero changes to `packages/xci/`.** No imports, no shared utilities promoted out yet. Phase 9 will introduce shared YAML parser between `xci` and `@xci/server`. Phase 7 keeps the fence Phase 6 erected.

### Claude's Discretion (planner picks)

- Exact directory layout under `packages/server/src/` (e.g., `routes/`, `services/`, `repos/`, `crypto/`, `email/`, `db/` — planner refines).
- Drizzle schema column types beyond `id text` and `org_id text` (e.g., bcrypt-hash `text` vs `varchar(255)`, timestamp precision).
- Specific `@fastify/env` JSON-schema shape.
- Exact format of test discovery for D-04 (ts-morph traversal vs simple convention "every `repos/<x>.ts` exports must be matched in `repos/__tests__/<x>.isolation.test.ts`").
- Exact route paths for auth flows (e.g., `/api/auth/signup` vs `/api/users` — REST style, planner picks).
- `vitest.config.ts` shape for separating unit vs integration suites (separate `vitest.unit.config.ts` + `vitest.integration.config.ts`, or single config with `--project` flag).
- Whether to add a `packages/server/.env.example` (highly recommended — leave to planner).

### Folded Todos

None — `gsd-tools todo match-phase 7` returned 0 matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §User Authentication & Org (AUTH-01 through AUTH-12) — all 12 reqs in scope this phase
- `.planning/REQUIREMENTS.md` §Billing / Quota Stub (QUOTA-01, QUOTA-02, QUOTA-07) — entity + defaults only; enforcement deferred
- `.planning/REQUIREMENTS.md` §Backward Compatibility (BC-01..04) — fence still applies; `packages/xci/` untouched

### Roadmap
- `.planning/ROADMAP.md` §Phase 7 — goal, depends-on, 5 success criteria
- `.planning/ROADMAP.md` §v2.0 Roadmap decisions — Docker base must be `node:22-slim` (glibc for argon2 prebuilt binaries); agent token never in URL (relevant for Phase 8 but worth noting now); QUOTA assignment split between Phase 7 (entity) and Phase 10 (enforcement)

### Project Vision
- `.planning/PROJECT.md` §Current Milestone v2.0 — Server stack: Fastify + TypeScript + Postgres, Docker image, multi-tenant SaaS, hybrid secrets model
- `.planning/PROJECT.md` §Constraints — security baseline (no logging secrets), tech stack
- `.planning/STATE.md` §Decisions — accumulated v1 + v2.0 decisions to date

### Project Instructions
- `CLAUDE.md` §Technology Stack — Node `>=20.5.0`, ESM-only, TypeScript 5.x, biome 2.x; v1 stack lock still applies to `xci` package
- `CLAUDE.md` §GSD Workflow Enforcement — all file changes via GSD commands

### Prior Phase Context (decisions that carry forward)
- `.planning/phases/06-monorepo-setup-backward-compat-fence/06-CONTEXT.md` D-12 — `@xci/server` is `private: true` until real code lands; flips to `private: false` here in Phase 7
- `.planning/phases/06-monorepo-setup-backward-compat-fence/06-CONTEXT.md` D-09 — Turbo pipeline (`build`, `test`, `lint`, `typecheck`); add server tasks here
- `.planning/phases/06-monorepo-setup-backward-compat-fence/06-CONTEXT.md` D-15..19 — fence gates active on every PR; new server code must not regress them
- `.planning/phases/01-foundation/01-CONTEXT.md` — `LociError` hierarchy pattern; `XciServerError` (D-08) mirrors this discipline
- `.planning/phases/05-init-distribution/05-CONTEXT.md` D-01 — npm package name `xci`; `@xci/server` is the server package name (Phase 6 verified scope)

### External Specs
- OWASP Argon2 Password Hashing 2024 — guides D-31 parameter choice
- NIST SP 800-63B — password length-over-complexity guidance for D-32
- Fastify v5 docs (https://fastify.dev/docs/latest/) — plugin lifecycle, request decorators, error handler, env-schema, csrf-protection, rate-limit
- Drizzle ORM docs (https://orm.drizzle.team/docs/migrations) — programmatic migrator, drizzle-kit generate workflow
- `@testcontainers/postgresql` docs (https://node.testcontainers.org/modules/postgresql/) — image selection, container reuse

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Patterns from `packages/xci/`
- **`LociError` hierarchy** (`packages/xci/src/errors.ts`) — typed error classes with stable `code` strings; same discipline applies to `XciServerError` (D-08). Don't share the class itself across packages in Phase 7 (no cross-package imports yet); duplicate the pattern in `packages/server/src/errors.ts`.
- **Secrets-never-logged** — Phase 1 P02 established `ShellInjectionError` discards its value; same rule for any `XciServerError` carrying email/password/token data (D-08, D-10).
- **Test conventions** — `.js` suffix imports (`moduleResolution: bundler` + `verbatimModuleSyntax`), test files in `__tests__/` siblings to source (Phase 1 P03 pattern).

### Current `packages/server/` State (Phase 6 stub)
- `packages/server/package.json` — `private: true`, all scripts are echo-noops. Phase 7 replaces all of this with real config.
- `packages/server/src/index.ts` — single empty export stub. Phase 7 grows this into full server source tree.
- No `tsconfig.json` in the package yet (Phase 6 D-03 deferred). Phase 7 creates `packages/server/tsconfig.json` extending `tsconfig.base.json`.
- No `vitest.config.ts` yet. Phase 7 creates one (or two — unit + integration split per D-24).
- No `tsup.config.ts` yet. Server doesn't need bundling (Node runs source directly via `tsx` or compiled JS); planner decides build mechanism (likely `tsc --build` straight to `dist/`, no tsup).

### Established Patterns Phase 7 Must Respect
- **Phase 6 fence** — `packages/xci/` cannot import from `@xci/server`; the reverse is also avoided in Phase 7 (no shared utilities promoted yet, see D-39).
- **CI matrix** — 3 OS × Node [20, 22] = 6 jobs; new server tasks go through `pnpm turbo run …` and inherit the matrix; integration tests gate on Linux only (D-23, mirrors Phase 6 D-17).
- **Changesets fixed-versioning** (Phase 6 D-11) — `xci`, `@xci/server`, `@xci/web` always release at the same version. When `@xci/server` flips `private: false` here, fixed-versioning still applies; no publish in Phase 7 (Phase 14 owns first publish).

### Integration Points
- Root `package.json` Turbo scripts already proxy to `turbo run …` — server scripts plug in for free
- `turbo.json` task graph (Phase 6 D-09) already covers `build`/`test`/`lint`/`typecheck`; new server tasks just declare them in `packages/server/package.json`
- GitHub Actions workflow (`.github/workflows/ci.yml`) — Phase 7 must add a Linux-only integration-test job (matches D-23) without breaking the existing matrix
- Changesets — first changeset for `@xci/server` lands in this phase as part of the schema/auth feature

### Creative Options the Architecture Enables
- Once Phase 9 lands the shared YAML parser, the `forOrg(orgId).tasks.list()` API extends naturally — same scoped-wrapper pattern.
- The `adminRepo` namespace (D-03) becomes the natural home for Phase 10's dispatcher and Phase 11's retention cleanup — no new pattern needed.
- The `XciServerError` hierarchy (D-08) extends to Phase 8 agent errors (`AgentRevokedError`, `RegistrationLimitError`), Phase 10 dispatch errors, etc. — single error contract for the entire server.

</code_context>

<specifics>
## Specific Ideas

- **The "by design" language in SC-4 is the load-bearing phrase.** A scoped wrapper (D-01) is the only option that's truly "unreachable by design" — every other option is "unreachable by convention + check". The wrapper makes the wrong code not compile.

- **`adminRepo` as a deliberate friction point.** Every `adminRepo.*` call should be obvious in code review. Don't be tempted to give it a polite name like `systemRepo` or `unscoped` — `admin` connotes "this is the dangerous version", which is exactly what we want.

- **Sliding session expiry with 1-hour write-throttle (D-13).** Naive sliding expiry writes to DB on every request — kills perf. The 1-hour throttle means at most 1 session-table write per active user per hour, and expiry remains accurate within that window.

- **Email-pinned invites (D-15) are non-negotiable.** Anyone-with-link invites are how SaaS gets owned (link forwarded, link leaked, link archived). The invite email itself can be forwarded, but only the matching email can accept.

- **Argon2 parameters (D-31) — measure on CI.** OWASP 2024 says aim for ~500ms per hash. The 19MiB/2/1 numbers are a starting point; planner should add a startup self-test that times one hash and warns if it's <100ms (params too weak) or >2s (will starve event loop).

- **No haveibeenpwned check in Phase 7 (D-32).** Tempting but: adds external HTTP call latency on signup, requires fallback when service is down, and we'd want to debounce. Defer to a later hardening phase.

- **`postgres:16-alpine` for tests, full `postgres:16` in prod (D-21).** Alpine is faster to pull/boot in CI; full is what we recommend deployers run because Alpine's musl can have edge cases with extensions. Migrations must work on both — keep them ANSI-ish.

</specifics>

<deferred>
## Deferred Ideas

- **"Log out everywhere" UI** — deferred to Phase 13 (web dashboard).
- **Owner role transfer** — deferred (Phase 13 candidate).
- **Audit log table** — deferred (post-v2.0 hardening).
- **haveibeenpwned password check** — deferred per D-32.
- **Soft-deletes / undelete** — deferred per D-27.
- **Session token hashing at rest** — deferred per D-12.
- **Rate-limit storage in Redis** — deferred per D-36 (single-instance v2.0 doesn't need it).
- **Email template engine** — deferred per D-30 (TS literals are enough for ~5 emails).
- **Configurable rate-limit thresholds** — deferred per D-35 (env-tunable arrives when we have ops feedback).
- **TypeScript project references between packages** — Phase 6 already deferred; same here.
- **Redis-backed sessions** — same as rate-limit, deferred.
- **2FA / TOTP** — deferred (Phase 13+ candidate).
- **OAuth/SSO providers** — deferred (post-v2.0).
- **Per-user IP/UserAgent on sessions** — deferred per D-11 (privacy + simplicity default).
- **`fastify.inject()` E2E tests** — included as HTTP integration (D-24); true multi-process E2E is Phase 14 Docker smoke.

### Reviewed Todos (not folded)
None — no matches from `gsd-tools todo match-phase 7`.

</deferred>

---

*Phase: 07-database-schema-auth*
*Context gathered: 2026-04-18*
*Mode: auto-selected (user requested autonomous chain to milestone end)*
