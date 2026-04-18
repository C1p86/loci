# Phase 7: Database Schema & Auth - Research

**Researched:** 2026-04-18
**Domain:** Fastify v5 server + Drizzle/Postgres + Argon2 + multi-tenant isolation
**Confidence:** HIGH (all primary versions verified against npm registry 2026-04-18; patterns verified against official docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All 39 decisions D-01 through D-39 in `.planning/phases/07-database-schema-auth/07-CONTEXT.md` are **LOCKED**. Research does not re-litigate them. Summary of the load-bearing locks:

- **D-01** — Scoped repo wrapper `forOrg(orgId)` is the sole path to org-scoped tables. Un-scoped repos are NOT exported from `repos/index.ts`.
- **D-02** — `orgId` threaded via Fastify request decorator + explicit `forOrg(request.org.id)`. **No AsyncLocalStorage.**
- **D-03** — Cross-org operations in a separate `adminRepo` namespace. Name chosen for friction; do not rename to `systemRepo`.
- **D-04** — Two-org integration fixture per public repo function + an auto-discovery meta-test that fails CI when a new repo function lacks an isolation test.
- **D-05** — `buildApp(opts)` factory exported from `src/app.ts`. `opts` accepts `dbPool`, `emailTransport`, `clock`, `crypto.randomBytes` for test injection.
- **D-06** — Explicit plugin registration order, **no `@fastify/autoload`**. Order: env → db → cookie → csrf → rate-limit → auth → routes.
- **D-07** — `@fastify/env` with JSON-schema validation; server fails to boot on missing/invalid env.
- **D-08** — `XciServerError` hierarchy mirroring v1 `LociError`; centralized error handler maps to `{code, message, requestId}`.
- **D-09** — Per-route `preHandler: [requireAuth]` opt-in. No global auth middleware.
- **D-10** — Pino default logger with redaction on `req.body.password`, `req.body.token`, `req.headers.cookie`, `req.headers.authorization`.
- **D-11..14** — Sessions: `id` = `randomBytes(32)` base64url (stored plaintext), sliding 14d from `last_seen_at`, absolute cap 30d from `created_at`, 1h write-throttle on `last_seen_at`, multiple concurrent sessions allowed.
- **D-15..19** — Invites: email-pinned (case-insensitive match at acceptance), role locked at invite-time, no pre-created user row, 7d expiry, single-use, org-scoped (uses `forOrg`).
- **D-20..24** — `@testcontainers/postgresql` per suite, `postgres:16-alpine` test image (prod image `postgres:16`), `TRUNCATE RESTART IDENTITY CASCADE` between tests, Linux-only CI integration job, three test layers (unit, repo-integration, HTTP-integration).
- **D-25..28** — All PKs `text` with `xci_<prefix>_<random>` scheme, org-scoped FKs `ON DELETE CASCADE`, no soft-deletes, `drizzle-kit generate` for SQL + programmatic migrator at boot.
- **D-29..30** — Three email transports (log/stub/smtp) env-selected, templates as TS literals exporting `{subject, html, text}` factories.
- **D-31..33** — Argon2id params `memoryCost=19456, timeCost=2, parallelism=1`; password min 12 chars; all tokens `randomBytes(32)` base64url.
- **D-34..36** — `@fastify/csrf-protection` (double-submit); `@fastify/rate-limit` in-memory; no Redis.
- **D-37..38** — `org_plans` table with Free defaults (5/5/30); no enforcement code in Phase 7.
- **D-39** — Zero changes to `packages/xci/`.

### Claude's Discretion

- Exact directory layout under `packages/server/src/` (routes/services/repos/crypto/email/db subdivisions).
- Drizzle column types beyond `id text` / `org_id text` — hash column widths, timestamp precision.
- Specific `@fastify/env` JSON-schema shape.
- Format of the D-04 auto-discovery test (ts-morph vs simple fs+convention).
- Route paths for auth flows (`/api/auth/signup` vs `/api/users` REST-style).
- `vitest.config.ts` shape (separate `vitest.unit.config.ts` + `vitest.integration.config.ts` vs single config with `--project`).
- Whether to add `packages/server/.env.example` (recommended).

### Deferred Ideas (OUT OF SCOPE)

- "Log out everywhere" UI (Phase 13)
- Owner role transfer (Phase 13+)
- Audit log table (post-v2.0)
- haveibeenpwned check (D-32)
- Soft-deletes (D-27)
- Session token hashing at rest (D-12)
- Redis-backed rate-limit / sessions (D-36)
- Email template engine (D-30)
- Configurable rate-limit thresholds (D-35)
- TypeScript project references between packages
- 2FA / TOTP / OAuth (post-v2.0)
- Per-user IP/UserAgent on sessions (D-11)
- Multi-process E2E tests (Phase 14)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Signup email+password, Argon2id hashing | `@node-rs/argon2` 2.0.2 (§2) with params 19456/2/1 (OWASP 2024 verified §3) |
| AUTH-02 | Email verification, single-use 24h token | `email_verifications` schema (§11); `randomBytes(32)` base64url (D-33); nodemailer transport (§7) |
| AUTH-03 | Session cookie httpOnly+secure+sameSite=strict | `@fastify/cookie` 11.0.2 (§2), schema `sessions` (§11); cookie semantics in §12 |
| AUTH-04 | Password reset single-use 1h token | `password_resets` schema (§11); nodemailer delivery (§7) |
| AUTH-05 | CSRF protection on mutations | `@fastify/csrf-protection` 7.1.0 (§8) — signed-token variant, not naive |
| AUTH-06 | Rate limiting signup/login/reset | `@fastify/rate-limit` 10.3.0 (§2) with per-route keyGenerator (§2) |
| AUTH-07 | User belongs to ≥1 org; Personal org auto-created | `orgs`, `users`, `org_members` schema (§11); signup flow creates all three in one transaction |
| AUTH-08 | Roles: Owner (unique/non-removable), Member, Viewer | `org_members.role` enum with unique partial index on `(org_id)` where `role='owner'` (§11) |
| AUTH-09 | Owner invites Member/Viewer, 7d expiry | `org_invites` schema (§11); email-pinned acceptance (D-15) |
| AUTH-10 | Multi-tenant isolation + repo-layer enforcement + test fixture | Scoped-repo wrapper pattern (§5); two-org auto-discovery test (§6) |
| AUTH-11 | Pluggable email transport | Three nodemailer transports env-selected (§7) |
| AUTH-12 | Logout invalidates session irreversibly | `sessions.revoked_at` column; auth plugin treats non-null as no-session (D-13) |
| QUOTA-01 | `OrgPlan` entity with plan fields | `org_plans` schema (§11) |
| QUOTA-02 | Free defaults 5/5/30 | Defaults on column definitions + auto-insert in signup transaction (§11) |
| QUOTA-07 | No Stripe, no upgrade UI, Free only | Entity-only, no enforcement code (D-38) |
</phase_requirements>

## Summary

Phase 7 stands up the `@xci/server` package from scratch using a narrow, opinionated Fastify v5 + Drizzle (postgres-js driver) + Postgres 16 stack. Every library version is current as of 2026-04-18 and verified against the npm registry [VERIFIED: npm registry]. The load-bearing architectural pattern — the one that makes SC-4 pass "by design" — is the **scoped repository wrapper** (`forOrg(orgId)`): un-scoped repo functions are module-private, so a route handler that forgets `forOrg(...)` fails to compile. The two-org auto-discovery meta-test (D-04) turns a convention into a CI gate.

The phase has **four discrete workstreams** that must be sequenced in this order: (1) package bootstrap & tsconfig/build/test wiring, (2) Drizzle schema + programmatic migrator + testcontainers harness, (3) scoped repositories + two-org isolation fixture + auto-discovery test, (4) Fastify app factory with plugin chain and auth routes. Skipping ahead — e.g., writing repos before the migrator runs successfully — stalls the whole phase.

**Primary recommendation:** Use `drizzle-orm` 0.45.2 with the `postgres-js` driver (`postgres` 3.4.9), `drizzle-kit` 0.31.10 dev-only for SQL generation, Fastify 5.8.5 with the plugin chain exactly as specified in D-06, `@node-rs/argon2` 2.0.2 (prebuilt binary for `linux-x64-gnu` = node:22-slim compatible), `@testcontainers/postgresql` 11.14.0 pinning `postgres:16-alpine`, and `nodemailer` 8.0.5. Build `packages/server/` with plain `tsc --build` to `dist/` (no tsup — servers don't benefit from bundling), and use `tsx` for dev. Run integration tests in a Linux-only CI job gated after the 6-matrix unit build.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Password hashing / verification | API / Backend | — | Argon2id requires server-controlled parameters; never ship hashing to clients |
| Session issuance + cookie set | API / Backend | Browser (receives cookie) | Opaque `randomBytes(32)` generated server-side; browser only stores the httpOnly cookie |
| CSRF token generation + validation | API / Backend | Browser (presents token via header on mutations) | Token pair (cookie + header) generated & verified on server |
| Rate limiting (signup/login/reset) | API / Backend | — | In-memory LRU tied to process; per-IP/email keygen server-side |
| Multi-tenant isolation (org_id filter) | API / Backend (Drizzle repos) | Database (FK constraints) | Repo wrapper is the primary enforcement; FKs + CASCADE are defense-in-depth |
| Email delivery | API / Backend | External SMTP relay | Server-originated; browser never knows the template |
| Database migrations | API / Backend (programmatic migrator at boot) | Database | `drizzle-kit` generates SQL at dev-time; server applies at boot (Phase 14 SC-2 contract) |
| Error serialization | API / Backend | Browser (reads `{code,message,requestId}`) | Centralized error handler transforms `XciServerError` → HTTP JSON |

## Standard Stack

### Core (all verified 2026-04-18 via `npm view <pkg> version`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastify` | **5.8.5** | HTTP server framework | v5 is the current major; plugin architecture matches D-06 perfectly; built-in pino logger matches D-10 [VERIFIED: npm registry] |
| `drizzle-orm` | **0.45.2** | ORM + query builder | Type-safe schema, relations, `$inferSelect`/`$inferInsert` generics, programmatic migrator [VERIFIED: npm registry] |
| `drizzle-kit` | **0.31.10** | SQL generation & studio | `drizzle-kit generate` produces SQL files under `drizzle/` — dev-only, not shipped to prod image [VERIFIED: npm registry] |
| `postgres` | **3.4.9** | postgres-js driver | Drizzle-blessed Postgres driver; pure JS, no native bindings; peer-dep `>=3` in drizzle [VERIFIED: npm registry] |
| `@node-rs/argon2` | **2.0.2** | Argon2id password hashing | Rust/napi prebuilt binaries for darwin-x64/arm64, linux-x64-gnu, linux-x64-musl, win32-x64; glibc variant matches `node:22-slim` (D-31, roadmap) [VERIFIED: `npm view @node-rs/argon2 optionalDependencies`] |
| `@fastify/env` | **6.0.0** | Env-schema validator (fail-on-boot) | Wraps env-schema; `additionalProperties:false` enforced; registers `fastify.config` decorator [VERIFIED: npm registry] — note: v6 released March 2026 per docs |
| `@fastify/cookie` | **11.0.2** | Cookie parser + signed cookies | Required peer of `@fastify/csrf-protection` [VERIFIED: npm registry] |
| `@fastify/csrf-protection` | **7.1.0** | CSRF tokens (signed double-submit) | Library uses HMAC-signed tokens internally via `@fastify/csrf` — aligns with 2024 OWASP guidance against naive double-submit [CITED: cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html] |
| `@fastify/rate-limit` | **10.3.0** | Rate limiting | In-memory LRU cache default; per-route `config.rateLimit` override; custom `keyGenerator` [VERIFIED: npm registry + docs] |
| `@fastify/helmet` | **13.0.2** | Security headers | CSP + standard hardening; registered after env, before auth |
| `@testcontainers/postgresql` | **11.14.0** | Ephemeral Postgres for integration tests | Requires Docker on runner; `postgres:16-alpine` pull is ~100MB [VERIFIED: npm registry] |
| `nodemailer` | **8.0.5** | Email transport abstraction | Current major (v8); built-in SMTP transport; stub transport via custom interface wrapper [VERIFIED: npm registry] |
| `pino` | **10.3.1** | Logger | Fastify's default logger; `redact.paths` supports dot-notation for `req.body.*` [VERIFIED: npm registry + docs] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/node` | `^22` (already in root) | Node typings | Always |
| `@types/nodemailer` | **7.0.3** (verify via `npm view` before install) | Types for nodemailer | Dev-dep |
| `tsx` | **4.21.0** | TypeScript dev runner | `pnpm dev` — runs `src/server.ts` with TS-on-the-fly [VERIFIED: npm registry] |
| `typescript` | already `^5.9.0` at root | Compiler + typechecker | Reuses root install |
| `vitest` | already `4.1.4` at root | Test runner | Two configs: unit + integration (Claude's discretion per D-24) |
| `pino-pretty` | **13.1.3** (dev only) | Pretty log output in dev | Optional; gate behind `NODE_ENV !== 'production'` |
| `ts-morph` | **28.0.0** | TS AST traversal for D-04 auto-discovery | Optional — simpler `fs.readdir` + convention also works (see §6) [VERIFIED: npm registry] |

### Alternatives Considered (not chosen)

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `postgres` (postgres-js) | `pg` (node-postgres) | `pg` is also drizzle-supported, older, uses a connection pool. `postgres-js` is simpler, modern ESM, auto-reconnect, and Drizzle docs favor it. Not a deep difference; `postgres-js` wins on simpler API. |
| `@node-rs/argon2` | `argon2` (C binding) | `argon2` npm package needs `node-gyp` + build-essential on Alpine (fails clean). `@node-rs/argon2` ships prebuilt binaries — zero build step. Roadmap explicitly picks the Rust variant for this reason. |
| `@fastify/csrf-protection` | Hand-rolled double-submit | Naive double-submit is **DISCOURAGED by OWASP 2024** [CITED: cheatsheetseries.owasp.org]. `@fastify/csrf-protection` uses HMAC-signed tokens — the RECOMMENDED variant. Do not hand-roll. |
| Fastify autoload | Explicit registration | D-06 forbids autoload. Server is small; explicit order makes ordering bugs obvious. |
| `AsyncLocalStorage` for orgId | Explicit threading | D-02 forbids ALS — breaks for cron (Phase 11) and webhook (Phase 12) contexts. |
| `uuid` v7/v9 | Text `xci_<prefix>_<rand>` | D-25 locks the text-PK scheme. Not a question. |
| tsup for server build | `tsc --build` | Server is not a CLI; no cold-start pressure; bundling obscures stack traces. `tsc` emits per-file `.js` + source maps in `dist/` — simpler. |

**Installation (single command):**

```bash
pnpm --filter @xci/server add \
  fastify@5.8.5 \
  drizzle-orm@0.45.2 \
  postgres@3.4.9 \
  @node-rs/argon2@2.0.2 \
  @fastify/env@6.0.0 \
  @fastify/cookie@11.0.2 \
  @fastify/csrf-protection@7.1.0 \
  @fastify/rate-limit@10.3.0 \
  @fastify/helmet@13.0.2 \
  nodemailer@8.0.5 \
  pino@10.3.1

pnpm --filter @xci/server add -D \
  drizzle-kit@0.31.10 \
  @testcontainers/postgresql@11.14.0 \
  @types/nodemailer@^7 \
  tsx@4.21.0 \
  pino-pretty@13.1.3 \
  ts-morph@28.0.0
```

**Version verification (evidence):** All versions above obtained from `npm view <pkg> version` on 2026-04-18. The planner SHOULD re-run this before execution in case point-releases have landed.

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                        HTTP Request (browser)                       │
│                                                                     │
│  POST /api/auth/login  {email, password}                           │
│  Cookie: _csrf=<secret>     ← set by earlier GET                   │
│  Header: x-csrf-token=<tok> ← echoed from body/header               │
└─────────────────────────────┬──────────────────────────────────────┘
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Fastify Plugin Chain (D-06 order)                │
│                                                                     │
│  1. @fastify/env           → validates & exposes fastify.config     │
│  2. db plugin              → decorates fastify.db (Drizzle instance)│
│  3. @fastify/helmet        → security headers                       │
│  4. @fastify/cookie        → parses Cookie header                   │
│  5. @fastify/csrf-protection → installs reply.generateCsrf(),       │
│                                fastify.csrfProtection hook          │
│  6. @fastify/rate-limit    → installs per-route limits              │
│  7. auth plugin (custom)   → decorateRequest('user', null)          │
│                              decorateRequest('org', null)           │
│                              decorateRequest('session', null)       │
│                              onRequest hook: parses xci_sid cookie  │
│  8. routes (prefix: /api)  → auth, orgs, users, invites             │
└─────────────────────────────┬──────────────────────────────────────┘
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                         Route Handler                               │
│                                                                     │
│  preHandler: [requireAuth]  (D-09 opt-in)                          │
│    ↓ throws AuthnError if request.session === null                 │
│                                                                     │
│  Handler body:                                                      │
│    const orgRepo = forOrg(request.org.id)      ← D-01 enforcement  │
│    const user    = await orgRepo.users.findById(...)               │
│    // adminRepo.* for cross-org ops only (D-03)                    │
└─────────────────────────────┬──────────────────────────────────────┘
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                   Repository Layer (D-01/D-03)                      │
│                                                                     │
│  forOrg(orgId) → { users, sessions, invites, plans }                │
│                    ↑ each closes over orgId, every query            │
│                      has .where(eq(table.org_id, orgId))            │
│                                                                     │
│  adminRepo → { orgs, signupTx(...), countAgentsAcrossOrgs, ... }    │
│              ↑ deliberately friction-ful name                       │
└─────────────────────────────┬──────────────────────────────────────┘
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│          Drizzle (postgres-js driver) → Postgres 16                 │
│                                                                     │
│  Schema: orgs, users, org_members, org_plans,                       │
│          sessions, email_verifications, password_resets,            │
│          org_invites                                                │
│                                                                     │
│  Migrations: SQL in drizzle/ generated by drizzle-kit,              │
│              applied at boot by drizzle-orm/postgres-js/migrator    │
└────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/server/
├── package.json               # private: false (flip from Phase 6 stub), real scripts
├── tsconfig.json              # extends tsconfig.base.json; outDir: dist
├── drizzle.config.ts          # drizzle-kit config: schema path, out dir, driver
├── vitest.unit.config.ts      # unit tests (no DB)
├── vitest.integration.config.ts  # integration tests (testcontainers)
├── drizzle/                   # generated SQL migrations (committed)
│   ├── 0000_initial.sql
│   └── meta/
├── .env.example               # documented env keys, no real secrets
├── src/
│   ├── app.ts                 # buildApp(opts) factory — D-05
│   ├── server.ts              # CLI entry: parses env, calls buildApp, listens
│   ├── config/
│   │   └── env.schema.ts      # @fastify/env JSON schema — D-07
│   ├── db/
│   │   ├── plugin.ts          # fastify-plugin decorating fastify.db
│   │   ├── schema.ts          # Drizzle table definitions — D-25..28
│   │   ├── relations.ts       # Drizzle relations()
│   │   └── migrator.ts        # runMigrations(db) — called from server.ts
│   ├── crypto/
│   │   ├── password.ts        # hash/verify using @node-rs/argon2 — D-31
│   │   ├── tokens.ts          # generateToken() randomBytes(32) base64url — D-33
│   │   └── __tests__/
│   ├── email/
│   │   ├── transport.ts       # union type + factory (log | stub | smtp) — D-29
│   │   └── templates/
│   │       ├── verify-email.ts
│   │       ├── password-reset.ts
│   │       ├── invite.ts
│   │       ├── invite-revoked.ts
│   │       └── owner-changed.ts
│   ├── repos/
│   │   ├── index.ts           # exports forOrg() + adminRepo ONLY — D-01/D-03
│   │   ├── for-org.ts         # factory: forOrg(orgId) → { users, sessions, ... }
│   │   ├── admin.ts           # adminRepo namespace — D-03
│   │   ├── users.ts           # scoped user repo (NOT exported from index.ts)
│   │   ├── sessions.ts
│   │   ├── invites.ts
│   │   ├── email-verifications.ts
│   │   ├── password-resets.ts
│   │   ├── org-plans.ts
│   │   └── __tests__/
│   │       ├── users.isolation.test.ts     # D-04 two-org fixture
│   │       ├── sessions.isolation.test.ts
│   │       ├── ...
│   │       └── isolation-coverage.test.ts  # D-04 auto-discovery meta-test
│   ├── errors.ts              # XciServerError hierarchy — D-08
│   ├── plugins/
│   │   ├── auth.ts            # fastify-plugin; decorators + onRequest — D-02/D-09
│   │   ├── error-handler.ts   # setErrorHandler → JSON {code,message,requestId}
│   │   └── __tests__/
│   ├── routes/
│   │   ├── auth/
│   │   │   ├── signup.ts       # POST /api/auth/signup
│   │   │   ├── login.ts        # POST /api/auth/login
│   │   │   ├── logout.ts       # POST /api/auth/logout
│   │   │   ├── verify-email.ts # POST /api/auth/verify-email
│   │   │   ├── request-reset.ts# POST /api/auth/request-reset
│   │   │   ├── reset.ts        # POST /api/auth/reset
│   │   │   └── __tests__/      # fastify.inject() HTTP tests
│   │   ├── orgs/
│   │   │   └── invites.ts      # POST/GET/DELETE /api/orgs/:orgId/invites
│   │   │                       # POST /api/invites/:token/accept
│   │   └── index.ts            # route registration plugin
│   └── test-utils/
│       ├── db-harness.ts      # testcontainers setup + resetDb() — D-22
│       ├── two-org-fixture.ts # seeds Org A + Org B for D-04 tests
│       └── capture-email.ts   # EMAIL_TRANSPORT=stub inspection helper
├── dist/                      # tsc output (gitignored)
└── .turbo/                    # Turborepo cache (gitignored)
```

### Anti-Patterns to Avoid

- **Exporting un-scoped repo functions** — if `users.ts` exports `findById(userId)` directly, the scoped-wrapper enforcement collapses. Only `forOrg()` may reach them. Use module-private exports (e.g., internal factory consumed by `for-org.ts` only).
- **Using AsyncLocalStorage for orgId** — D-02 explicitly forbids; explains why (cron + webhook contexts break).
- **Autoloading plugins** — D-06 explicit order. Autoload obscures ordering bugs.
- **Global auth middleware** — D-09 opt-in per-route. Global middleware forces "skip auth" flags on public routes, which is how auth gets accidentally disabled.
- **Logging the session token, password, or any verification token** — pino redaction + never `console.log(token)` in dev code.
- **Storing MEK or password plaintext in tests** — tests set a dummy `XCI_MASTER_KEY` via env-schema; never echo plaintext passwords.
- **Running migrations from drizzle-kit in production** — `drizzle-kit` is dev-dep only (D-28). Production uses `drizzle-orm/postgres-js/migrator.migrate()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Argon2id password hashing | Custom Argon2 wrapper | `@node-rs/argon2` | Prebuilt binaries handle glibc/musl/arm64; timing-safe verify; constant-time compare built in |
| CSRF tokens | Naive double-submit with random cookie+header | `@fastify/csrf-protection` | Uses HMAC-signed tokens (OWASP-recommended); naive variant is OWASP-discouraged |
| Rate limiting | In-memory Map keyed by IP | `@fastify/rate-limit` | LRU eviction, per-route config, correct 429 headers (`retry-after`, `x-ratelimit-*`), keyGenerator for composite keys |
| Env validation | `if (!process.env.X) throw` | `@fastify/env` | JSON-schema + env-schema; single-pass validation with fail-on-boot; typed `fastify.config` access |
| Migration runner | Read SQL files, split on `;`, execute | `drizzle-orm/postgres-js/migrator.migrate()` | Handles advisory locks, idempotent re-runs, transaction wrapping, `__drizzle_migrations` bookkeeping |
| SMTP | Raw `net` socket | `nodemailer` | TLS, STARTTLS, pool management, multipart MIME, stream transport |
| HTML entity escaping in email templates | Manual string replace | Template literal + a small `escape()` helper | OK to hand-roll the escape helper — it's 5 lines; don't pull a library |
| Logger redaction | Pre-serializer that walks objects | `pino` `redact.paths` with dot-notation | Uses `fast-redact`, ~2% overhead, handles nested safely |
| UUID/PK generation | `Math.random().toString(36)` | `crypto.randomBytes(15).toString('base64url')` (Node built-in) | 120-bit entropy; URL-safe; fits `xci_<prefix>_<rand>` scheme. No library needed. |
| Pool management / retries | Custom reconnect logic | `postgres` driver (postgres-js) | Built-in reconnect, pool, prepared statements |

**Key insight:** Everything security-related in this phase has a battle-tested library. If you're writing `crypto.createHmac()` outside of the two exceptions (token generation, cookie signing handled by `@fastify/cookie`), stop and re-check — you're probably re-inventing something OWASP wrote a cheat sheet about.

## Runtime State Inventory

Not applicable — Phase 7 is greenfield server code (no existing runtime state to migrate). The `@xci/server` package is currently a Phase 6 stub with `private: true`, `src/index.ts` containing only `export {};`, and all scripts as echo-noops. **Nothing to inventory.**

## Common Pitfalls

### Pitfall 1: `@fastify/csrf-protection` sessionless mode pitfall (critical, security-impacting)

**What goes wrong:** Applying `fastify.csrfProtection` via `onRequest` hook only on routes that already have a session. Signup and login do NOT have a session yet, so the library's `getUserInfo` / `sessionPlugin` integration does nothing there. A naive config leaves signup/login unprotected by CSRF, but D-34 explicitly says they're protected by rate-limit alone — that's correct, but the config must NOT try to register `fastify.csrfProtection` on those routes.

**Why it happens:** Developers see "CSRF on all mutation routes" and globally apply the hook.

**How to avoid:**
- Do NOT register `fastify.csrfProtection` globally as an `addHook('onRequest')`.
- Apply it per-route via `onRequest: [fastify.csrfProtection]` on routes where the user already has a session (post-login mutations).
- Signup and login: no CSRF hook; rely on rate-limit + origin check.
- Webhook routes (Phase 12): no CSRF hook; rely on HMAC signature verification.

**Warning signs:** Integration test hitting `/api/auth/login` without a CSRF token but failing with 403 instead of the expected 401 for bad credentials.

### Pitfall 2: Drizzle `timestamp` precision and timezone

**What goes wrong:** Default `timestamp()` in `drizzle-orm/pg-core` maps to `timestamp` (no tz). Sliding session expiry (D-13) compares to `now()` — if server is in a different TZ than Postgres, sessions expire at surprising times.

**Why it happens:** Postgres `timestamp` stores wall-clock time without tz; comparing across clients is ambiguous.

**How to avoid:** Always use `timestamp({ mode: 'date', withTimezone: true })` for all temporal columns. Set Postgres TZ to UTC in migration or connection string (`?options=-c%20timezone%3DUTC`). This is especially important for `sessions.expires_at`, `sessions.last_seen_at`, `email_verifications.expires_at`, `password_resets.expires_at`, `org_invites.expires_at`.

**Warning signs:** Integration test that seeds a session 30d in the future passes locally but fails in CI (container runs UTC, dev laptop runs Europe/Rome).

### Pitfall 3: Argon2 cold-start cost blocks event loop on first signup

**What goes wrong:** First call to `argon2.hash()` after boot takes 2-3× longer than subsequent calls (napi module load + initial memory allocation). A signup during the warmup window blocks the event loop for ~1s.

**Why it happens:** `@node-rs/argon2` lazy-loads its native binding on first hash.

**How to avoid:** Include a warmup hash in server startup (D-31 Specifics explicitly calls for this). After `buildApp()` completes and before `fastify.listen()`, call `await hashPassword('warmup-string')` once. Also use this call to time the hash — warn if < 100ms (params too weak) or > 2s (will starve event loop under load). Fastify's `pino` logs the timing.

**Warning signs:** First login after cold start takes > 1s; subsequent logins < 300ms.

### Pitfall 4: `ON DELETE CASCADE` + long transactions = lock storm

**What goes wrong:** Deleting an Org cascades to users → org_members → sessions → invites → etc. If the Org has millions of log chunks (Phase 11), the cascade holds a row-level lock for minutes, blocking all other queries.

**Why it happens:** Cascade is eager; happens in one transaction.

**How to avoid in Phase 7:** Not a Phase 7 concern directly — only tables in this phase are auth-scoped (small per-org row counts). But document the pattern: Phase 11 should offer a "soft-delete org" path that schedules cascade cleanup in a background job. Phase 7 cascade is acceptable because every cascaded table is bounded in row count (< 1000 rows per org).

**Warning signs:** DELETE org integration test takes > 5 seconds in testcontainers.

### Pitfall 5: testcontainers TRUNCATE misses newly-added tables

**What goes wrong:** `resetDb()` hard-codes a list of tables for `TRUNCATE ... RESTART IDENTITY CASCADE`. Add a new table → forget to add it to reset list → next test suite has dirty data.

**Why it happens:** Explicit table list drifts from schema.

**How to avoid:** Generate the truncation list dynamically from `information_schema.tables` where schema = 'public' and `table_name != '__drizzle_migrations'`. One query, always correct:

```sql
SELECT string_agg(quote_ident(table_name), ', ')
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name != '__drizzle_migrations';
```

Then `TRUNCATE TABLE <list> RESTART IDENTITY CASCADE`. Single statement, CASCADE handles FK order.

**Warning signs:** Test B passes when run alone but fails when run after test A — leftover rows from A.

### Pitfall 6: Race on sliding-session update (D-13)

**What goes wrong:** Two concurrent requests from the same browser (e.g., XHR + navigation) both find `last_seen_at` stale (> 1h), both issue UPDATE — harmless but wasteful; in pathological case an UPDATE collides with a DELETE (logout), and the UPDATE resurrects a revoked session.

**Why it happens:** Read-then-write without WHERE guard.

**How to avoid:** The session-refresh UPDATE MUST include `WHERE revoked_at IS NULL AND expires_at > now()` in addition to the id match. So:

```sql
UPDATE sessions
SET last_seen_at = now(), expires_at = now() + interval '14 days'
WHERE id = $1
  AND revoked_at IS NULL
  AND expires_at > now()
  AND last_seen_at < now() - interval '1 hour'
```

The extra `last_seen_at < now() - interval '1 hour'` guard also makes the "throttle" atomic: no need for an in-memory lock.

**Warning signs:** Logout test passes, then a test "auth after logout" sometimes succeeds — logout race.

### Pitfall 7: pino `redact.paths` doesn't cover req.raw.* by default

**What goes wrong:** Fastify exposes `req.raw` (Node's http IncomingMessage). If a plugin logs `{ req }` the serializer may traverse `req.raw` which has its own `headers` object, and redaction config for `req.headers.authorization` won't match `req.raw.headers.authorization`.

**Why it happens:** Fastify has two ways of accessing request metadata; redaction config only matches one.

**How to avoid:** Register redact paths for BOTH:
```ts
redact: {
  paths: [
    'req.body.password', 'req.body.token', 'req.body.currentPassword', 'req.body.newPassword',
    'req.headers.cookie', 'req.headers.authorization',
    'req.raw.headers.cookie', 'req.raw.headers.authorization',
    '*.password', '*.token', // catch-all for nested objects
  ],
  censor: '[REDACTED]',
}
```

**Warning signs:** Grep the CI test logs for `xci_sid=` — if you find the raw session token, redaction missed a path.

### Pitfall 8: `exactOptionalPropertyTypes: true` + Drizzle insert

**What goes wrong:** `tsconfig.base.json` has `exactOptionalPropertyTypes: true`. Drizzle's `$inferInsert` types include optional fields (`field?: T`). Passing `{ field: undefined }` explicitly (common in spread patterns) fails compilation.

**Why it happens:** `exactOptionalPropertyTypes` distinguishes `{field?: T}` (missing) from `{field: T | undefined}`.

**How to avoid:** Use `satisfies` + omit-undefined helpers when building insert payloads:
```ts
const payload = {
  id: generateId('org'),
  name,
  ...(ownerId !== undefined && { ownerId }), // only spread when defined
} satisfies typeof orgs.$inferInsert;
```

**Warning signs:** Compiler errors like "Type '{field: T | undefined}' is not assignable to type '{field?: T}'" in repo code.

### Pitfall 9: `@node-rs/argon2` on Alpine needs `linux-x64-musl`, not `linux-x64-gnu`

**What goes wrong:** The ROADMAP says "Docker base must be `node:22-slim`" (Debian, glibc) specifically because Alpine (musl) occasionally has edge cases with prebuilt Rust binaries. If a dev tries Alpine locally, the argon2 package MIGHT still work (musl prebuilt exists) but isn't what prod runs.

**Why it matters for Phase 7:** Testcontainers uses `postgres:16-alpine` for PG (harmless — argon2 isn't there) but the SERVER image in Phase 14 must be `node:22-slim`. Phase 7 tests run argon2 on the host (not in a container), so this is a Phase 14 concern. Document it now.

**How to avoid:** Phase 14 Dockerfile uses `FROM node:22-slim`. Phase 7 research note: do NOT experiment with `node:22-alpine` in Phase 7 — the roadmap locked glibc.

### Pitfall 10: Double-commit of `drizzle-kit` migration generation

**What goes wrong:** Dev runs `drizzle-kit generate` (produces SQL files), then edits the schema, runs generate again — gets a second migration file. Checks in both. First migration is incomplete and may have `ALTER` statements that assume tables exist.

**Why it happens:** `drizzle-kit generate` is a forward-only diff from current SQL to current schema.

**How to avoid:** For Phase 7 (greenfield), generate a SINGLE initial migration after the schema is stable. If schema changes mid-phase, delete `drizzle/*.sql` + `drizzle/meta/` and regenerate from scratch (no migration history yet in prod). From Phase 8 onward, additive migrations only; never delete old ones.

**Warning signs:** `drizzle/0001_*.sql` appears before a production deployment has run; planner should enforce "one migration file in Phase 7, squashed."

## Code Examples (verified against official docs)

### Drizzle schema (pg-core) — AUTH tables

```typescript
// packages/server/src/db/schema.ts
// Source: https://orm.drizzle.team/docs/sql-schema-declaration
import { pgTable, text, timestamp, integer, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const orgs = pgTable('orgs', {
  id: text('id').primaryKey(), // xci_org_<rand>
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  isPersonal: boolean('is_personal').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('orgs_slug_unique').on(t.slug),
]);

export const users = pgTable('users', {
  id: text('id').primaryKey(), // xci_usr_<rand>
  email: text('email').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  passwordHash: text('password_hash').notNull(), // argon2 encoded string
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Case-insensitive unique on email — store as-is, enforce via LOWER(email)
  uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`),
]);

export const orgMembers = pgTable('org_members', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['owner', 'member', 'viewer'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('org_members_org_user_unique').on(t.orgId, t.userId),
  // At most one owner per org: partial unique index
  uniqueIndex('org_members_one_owner_per_org').on(t.orgId).where(sql`role = 'owner'`),
  index('org_members_user_idx').on(t.userId),
]);

export const orgPlans = pgTable('org_plans', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  planName: text('plan_name').notNull().default('free'),
  maxAgents: integer('max_agents').notNull().default(5),
  maxConcurrentTasks: integer('max_concurrent_tasks').notNull().default(5),
  logRetentionDays: integer('log_retention_days').notNull().default(30),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('org_plans_org_unique').on(t.orgId),
]);

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // randomBytes(32) base64url — D-11
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activeOrgId: text('active_org_id').references(() => orgs.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  index('sessions_user_idx').on(t.userId),
  // Partial index for the auth hot path: active sessions only
  index('sessions_active_idx').on(t.userId).where(sql`revoked_at IS NULL`),
]);

export const emailVerifications = pgTable('email_verifications', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull(), // randomBytes(32) base64url
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('email_verifications_token_unique').on(t.token),
  index('email_verifications_user_idx').on(t.userId),
]);

export const passwordResets = pgTable('password_resets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('password_resets_token_unique').on(t.token),
  index('password_resets_user_idx').on(t.userId),
]);

export const orgInvites = pgTable('org_invites', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  inviterUserId: text('inviter_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  email: text('email').notNull(), // invitee email; compared case-insensitive at acceptance
  role: text('role', { enum: ['member', 'viewer'] }).notNull(),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  acceptedByUserId: text('accepted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('org_invites_token_unique').on(t.token),
  index('org_invites_org_idx').on(t.orgId),
  index('org_invites_email_lower_idx').on(sql`lower(${t.email})`),
]);

// Type inference per D-04 / general use
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Org = typeof orgs.$inferSelect;
export type Session = typeof sessions.$inferSelect;
// ... etc.
```

### Drizzle relations (for type-safe join queries later)

```typescript
// packages/server/src/db/relations.ts
// Source: https://orm.drizzle.team/docs/relations
import { relations } from 'drizzle-orm';
import { orgs, users, orgMembers, orgPlans, sessions, orgInvites } from './schema.js';

export const orgsRelations = relations(orgs, ({ one, many }) => ({
  plan: one(orgPlans),
  members: many(orgMembers),
  invites: many(orgInvites),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(orgMembers),
  sessions: many(sessions),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  org: one(orgs, { fields: [orgMembers.orgId], references: [orgs.id] }),
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
}));
```

### Programmatic migrator at boot

```typescript
// packages/server/src/db/migrator.ts
// Source: https://orm.drizzle.team/docs/migrations
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  // Single-connection client for migrations — closes after migrate() returns.
  // Using max:1 avoids holding a pool during boot.
  const migrationClient = postgres(databaseUrl, { max: 1 });
  const migrationDb = drizzle(migrationClient);
  try {
    await migrate(migrationDb, {
      migrationsFolder: path.join(__dirname, '..', '..', 'drizzle'),
    });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}
```

### drizzle.config.ts (dev-only — generates SQL)

```typescript
// packages/server/drizzle.config.ts
import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/xci_dev',
  },
  // Phase 7: strict=false during initial schema iteration; flip to true once stable
  strict: true,
  verbose: true,
} satisfies Config;
```

### Fastify v5 app factory

```typescript
// packages/server/src/app.ts
// Source: Fastify v5 docs https://fastify.dev/docs/latest/
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyEnv from '@fastify/env';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyHelmet from '@fastify/helmet';
import { envSchema } from './config/env.schema.js';
import { dbPlugin } from './db/plugin.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { registerRoutes } from './routes/index.js';
import type { EmailTransport } from './email/transport.js';

export interface BuildOpts {
  databaseUrl?: string; // if absent, read from env
  emailTransport?: EmailTransport; // if absent, create from env
  clock?: () => Date;
  randomBytes?: (size: number) => Buffer;
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
}

export async function buildApp(opts: BuildOpts = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? 'info',
      redact: {
        paths: [
          'req.body.password', 'req.body.currentPassword', 'req.body.newPassword',
          'req.body.token', 'req.body.registrationToken',
          'req.headers.cookie', 'req.headers.authorization',
          'req.raw.headers.cookie', 'req.raw.headers.authorization',
          '*.password', '*.token',
        ],
        censor: '[REDACTED]',
      },
      // pino-pretty only in dev (gate via env)
      ...(process.env.NODE_ENV !== 'production' && {
        transport: { target: 'pino-pretty' },
      }),
    },
    genReqId: () => crypto.randomUUID(), // Node built-in
  });

  // D-06 plugin order: env → db → helmet → cookie → csrf → rate-limit → auth → routes
  await app.register(fastifyEnv, { schema: envSchema, dotenv: false });
  await app.register(dbPlugin, { databaseUrl: opts.databaseUrl });
  await app.register(fastifyHelmet, { contentSecurityPolicy: false /* tune in Phase 13 for SPA */ });
  await app.register(fastifyCookie, { secret: app.config.SESSION_COOKIE_SECRET });
  await app.register(fastifyCsrf, {
    cookieKey: '_csrf',
    cookieOpts: { path: '/', sameSite: 'strict', httpOnly: true, secure: process.env.NODE_ENV === 'production' },
    getToken: (req) => req.headers['x-csrf-token'] as string | undefined,
  });
  await app.register(fastifyRateLimit, {
    max: 100, // global default — per-route configs override
    timeWindow: '1 minute',
    cache: 10_000,
  });
  await app.register(authPlugin, { clock: opts.clock, randomBytes: opts.randomBytes });
  await app.register(errorHandlerPlugin);
  await app.register(registerRoutes, { prefix: '/api' });

  return app;
}
```

### @fastify/env JSON schema

```typescript
// packages/server/src/config/env.schema.ts
// Source: https://github.com/fastify/fastify-env
export const envSchema = {
  type: 'object',
  required: ['DATABASE_URL', 'SESSION_COOKIE_SECRET', 'EMAIL_TRANSPORT'],
  properties: {
    NODE_ENV: { type: 'string', enum: ['development', 'test', 'production'], default: 'development' },
    PORT: { type: 'integer', default: 3000 },
    DATABASE_URL: { type: 'string', pattern: '^postgres(ql)?://' },
    SESSION_COOKIE_SECRET: { type: 'string', minLength: 32 },
    EMAIL_TRANSPORT: { type: 'string', enum: ['log', 'stub', 'smtp'] },
    // SMTP fields required only when EMAIL_TRANSPORT=smtp — enforced at runtime
    SMTP_HOST: { type: 'string' },
    SMTP_PORT: { type: 'integer', default: 587 },
    SMTP_USER: { type: 'string' },
    SMTP_PASS: { type: 'string' },
    SMTP_FROM: { type: 'string', format: 'email' },
  },
  additionalProperties: false,
} as const;

// Type augmentation so fastify.config is typed
declare module 'fastify' {
  interface FastifyInstance {
    config: {
      NODE_ENV: 'development' | 'test' | 'production';
      PORT: number;
      DATABASE_URL: string;
      SESSION_COOKIE_SECRET: string;
      EMAIL_TRANSPORT: 'log' | 'stub' | 'smtp';
      SMTP_HOST?: string;
      SMTP_PORT: number;
      SMTP_USER?: string;
      SMTP_PASS?: string;
      SMTP_FROM?: string;
    };
  }
}

// NOTE: @fastify/env's env-schema does NOT support JSON-schema `oneOf` for conditional
// SMTP field requirement. Enforce at runtime in the email transport factory:
// "if EMAIL_TRANSPORT=smtp and SMTP_HOST missing, throw at boot."
```

### Scoped repository wrapper (D-01)

```typescript
// packages/server/src/repos/users.ts   (NOT exported from repos/index.ts)
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users, orgMembers } from '../db/schema.js';

// Factory closes over (db, orgId). Each function enforces org_id via the join.
export function makeUsersRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async findByEmail(email: string) {
      // Must JOIN org_members to scope by org_id
      return db
        .select({ user: users })
        .from(users)
        .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
        .where(and(eq(orgMembers.orgId, orgId), eq(users.email, email.toLowerCase())))
        .limit(1);
    },
    async findById(userId: string) {
      return db
        .select({ user: users })
        .from(users)
        .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
        .where(and(eq(orgMembers.orgId, orgId), eq(users.id, userId)))
        .limit(1);
    },
    // ... add/remove member handled in adminRepo because it crosses org concern
  };
}

export type UsersRepo = ReturnType<typeof makeUsersRepo>;
```

```typescript
// packages/server/src/repos/for-org.ts   (NOT exported; consumed only by index.ts)
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { makeUsersRepo } from './users.js';
import { makeSessionsRepo } from './sessions.js';
import { makeInvitesRepo } from './invites.js';
import { makeOrgPlansRepo } from './org-plans.js';

export function makeForOrg(db: PostgresJsDatabase) {
  return (orgId: string) => ({
    users: makeUsersRepo(db, orgId),
    sessions: makeSessionsRepo(db, orgId),
    invites: makeInvitesRepo(db, orgId),
    plan: makeOrgPlansRepo(db, orgId),
  });
}
```

```typescript
// packages/server/src/repos/index.ts   (the ONLY exported file)
// D-01: only forOrg() and adminRepo leave this module.
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { makeForOrg } from './for-org.js';
import { makeAdminRepo } from './admin.js';

export function makeRepos(db: PostgresJsDatabase) {
  return {
    forOrg: makeForOrg(db),
    admin: makeAdminRepo(db),
  };
}

export type Repos = ReturnType<typeof makeRepos>;
```

**Type-system enforcement:** `users.ts`, `sessions.ts`, etc. are NOT in the `index.ts` export list. Consumers importing from `@xci/server/repos` see only `{ forOrg, admin }`. Direct imports from `@xci/server/repos/users.js` would bypass — prevented by a Biome `noRestrictedImports` rule scoped to `packages/server/src/**` forbidding imports of `./repos/<anything but index.js>` from outside the repos folder. Detailed in §6.

### Auto-discovery isolation test (D-04)

Two approaches — the simpler is recommended:

**Option A (RECOMMENDED): Convention-based with fs walk (no ts-morph dependency)**

```typescript
// packages/server/src/repos/__tests__/isolation-coverage.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPOS_DIR = join(import.meta.dirname, '..');
const TESTS_DIR = join(REPOS_DIR, '__tests__');

/**
 * D-04 auto-discovery: every public repo factory (makeXxxRepo in repos/*.ts except
 * index.ts, for-org.ts, admin.ts, constants) must have a corresponding <name>.isolation.test.ts
 * that exercises the two-org fixture.
 */
describe('repo isolation coverage', () => {
  // 1. Enumerate all repo source files
  const excluded = new Set(['index.ts', 'for-org.ts', 'admin.ts']);
  const repoFiles = readdirSync(REPOS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .filter((f) => !excluded.has(f));

  for (const file of repoFiles) {
    const name = file.replace(/\.ts$/, ''); // "users"
    it(`${name} has isolation test`, () => {
      const testFile = join(TESTS_DIR, `${name}.isolation.test.ts`);
      expect(existsSync(testFile), `missing ${testFile} — D-04 requires two-org isolation test for every public repo`).toBe(true);

      // 2. Enumerate exported makeXxxRepo functions via regex (simpler than ts-morph for Phase 7)
      const src = readFileSync(join(REPOS_DIR, file), 'utf8');
      const exportedFactories = [...src.matchAll(/export function (make\w+Repo)/g)].map((m) => m[1]!);
      expect(exportedFactories.length, `${file} must export at least one makeXxxRepo function`).toBeGreaterThan(0);

      // 3. Each factory must have an isolation test referring to it by name
      const testSrc = readFileSync(testFile, 'utf8');
      for (const factoryName of exportedFactories) {
        expect(testSrc).toMatch(new RegExp(`\\b${factoryName}\\b`));
      }
    });
  }
});
```

**Option B (alternative): ts-morph for AST-level traversal**

```typescript
// Only if regex turns out to be too brittle
import { Project } from 'ts-morph';
const project = new Project({ tsConfigFilePath: 'tsconfig.json' });
const reposSource = project.getSourceFileOrThrow('src/repos/users.ts');
const exportedFns = reposSource
  .getFunctions()
  .filter((f) => f.isExported())
  .map((f) => f.getName()!);
```

**Recommendation:** Start with Option A (regex). No extra dependency, ~40 lines of test. If maintainability becomes an issue in Phase 8+ as repos multiply, upgrade to ts-morph.

### Two-org fixture (D-04)

```typescript
// packages/server/src/test-utils/two-org-fixture.ts
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import { orgs, users, orgMembers, orgPlans } from '../db/schema.js';

export interface TwoOrgFixture {
  orgA: { id: string; ownerUser: { id: string; email: string } };
  orgB: { id: string; ownerUser: { id: string; email: string } };
}

export async function seedTwoOrgs(db: PostgresJsDatabase): Promise<TwoOrgFixture> {
  const orgAId = generateId('org');
  const orgBId = generateId('org');
  const userAId = generateId('usr');
  const userBId = generateId('usr');

  await db.transaction(async (tx) => {
    await tx.insert(orgs).values([
      { id: orgAId, name: 'Org A', slug: 'org-a', isPersonal: false },
      { id: orgBId, name: 'Org B', slug: 'org-b', isPersonal: false },
    ]);
    await tx.insert(users).values([
      { id: userAId, email: 'a@example.com', passwordHash: 'dummy' },
      { id: userBId, email: 'b@example.com', passwordHash: 'dummy' },
    ]);
    await tx.insert(orgMembers).values([
      { id: generateId('mem'), orgId: orgAId, userId: userAId, role: 'owner' },
      { id: generateId('mem'), orgId: orgBId, userId: userBId, role: 'owner' },
    ]);
    await tx.insert(orgPlans).values([
      { id: generateId('plan'), orgId: orgAId },
      { id: generateId('plan'), orgId: orgBId },
    ]);
  });

  return {
    orgA: { id: orgAId, ownerUser: { id: userAId, email: 'a@example.com' } },
    orgB: { id: orgBId, ownerUser: { id: userBId, email: 'b@example.com' } },
  };
}
```

```typescript
// packages/server/src/repos/__tests__/users.isolation.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeUsersRepo } from '../users.js'; // allowed INSIDE __tests__
// ↑ Biome noRestrictedImports rule permits internal imports in tests.

describe('users repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('findByEmail scoped to orgA never returns orgB user', async () => {
    const db = getTestDb();
    const fixture = await seedTwoOrgs(db);
    const repoA = makeUsersRepo(db, fixture.orgA.id);
    const result = await repoA.findByEmail(fixture.orgB.ownerUser.email);
    expect(result).toEqual([]); // orgB user unreachable from orgA repo
  });

  it('findById scoped to orgA never returns orgB user', async () => {
    const db = getTestDb();
    const fixture = await seedTwoOrgs(db);
    const repoA = makeUsersRepo(db, fixture.orgA.id);
    const result = await repoA.findById(fixture.orgB.ownerUser.id);
    expect(result).toEqual([]);
  });
});
```

### testcontainers harness (D-20..22)

```typescript
// packages/server/src/test-utils/db-harness.ts
// Source: https://node.testcontainers.org/modules/postgresql/
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { runMigrations } from '../db/migrator.js';

let container: StartedPostgreSqlContainer | undefined;
let client: ReturnType<typeof postgres> | undefined;
let db: PostgresJsDatabase | undefined;

/**
 * Vitest setupFiles entry — starts the container once per suite, runs migrations.
 * Teardown via globalTeardown (see vitest.integration.config.ts).
 */
export async function setupTestDb(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine') // D-21
    .withDatabase('xci_test')
    .withUsername('test')
    .withPassword('test')
    .start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  client = postgres(url, { max: 4 });
  db = drizzle(client);
}

export async function teardownTestDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  await container?.stop();
}

export function getTestDb(): PostgresJsDatabase {
  if (!db) throw new Error('getTestDb called before setupTestDb');
  return db;
}

/**
 * D-22: TRUNCATE all tables between tests (faster than drop/recreate).
 * Dynamically enumerates tables to avoid drift (Pitfall 5).
 */
export async function resetDb(): Promise<void> {
  if (!db) throw new Error('resetDb called before setupTestDb');
  await db.execute(
    // sql`...` helper, inlining for brevity
    `DO $$
     DECLARE
       stmt text;
     BEGIN
       SELECT 'TRUNCATE TABLE ' || string_agg(quote_ident(table_name), ', ') || ' RESTART IDENTITY CASCADE'
       INTO stmt
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name != '__drizzle_migrations';
       IF stmt IS NOT NULL THEN EXECUTE stmt; END IF;
     END $$;`
  );
}
```

```typescript
// packages/server/vitest.integration.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts', 'src/**/__tests__/**/*.isolation.test.ts'],
    globalSetup: ['src/test-utils/global-setup.ts'], // calls setupTestDb()
    globalTeardown: ['src/test-utils/global-teardown.ts'],
    testTimeout: 30_000, // container boot can take ~10s first time
    pool: 'threads',
    isolate: false, // share the container across workers; resetDb() between tests
    sequence: { concurrent: false }, // sequential; testcontainer is shared state
  },
});
```

### @node-rs/argon2 password service with warmup (D-31)

```typescript
// packages/server/src/crypto/password.ts
// Source: https://github.com/napi-rs/node-rs/tree/main/packages/argon2
import { hash, verify, Algorithm } from '@node-rs/argon2';

// OWASP 2024: m=19456, t=2, p=1 [CITED: cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html]
const ARGON2_OPTS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  algorithm: Algorithm.Argon2id,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(encoded: string, password: string): Promise<boolean> {
  return verify(encoded, password, ARGON2_OPTS);
}

/**
 * Startup self-test (D-31 Specifics): hash a dummy value, measure timing.
 * Warns if < 100ms (params too weak for hardware) or > 2000ms (event-loop starvation risk).
 */
export async function argon2SelfTest(logger: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void }): Promise<void> {
  const start = performance.now();
  await hashPassword('xci-warmup-benchmark-not-a-real-password');
  const elapsed = performance.now() - start;
  if (elapsed < 100) logger.warn({ elapsedMs: elapsed }, 'argon2 self-test: hash too fast, consider stronger params');
  else if (elapsed > 2000) logger.warn({ elapsedMs: elapsed }, 'argon2 self-test: hash too slow, will starve event loop under load');
  else logger.info({ elapsedMs: elapsed }, 'argon2 self-test: hash timing OK');
}
```

### Token generator (D-33)

```typescript
// packages/server/src/crypto/tokens.ts
import { randomBytes } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * xci_<prefix>_<base64url-rand15>  — 120-bit entropy, URL-safe.
 * 15 bytes → 20 base64url chars; total length ~28 chars for "xci_usr_..."
 */
export function generateId(prefix: 'org' | 'usr' | 'mem' | 'ses' | 'inv' | 'ver' | 'pwr' | 'plan'): string {
  return `xci_${prefix}_${randomBytes(15).toString('base64url')}`;
}
```

### Nodemailer abstract transport (D-29)

```typescript
// packages/server/src/email/transport.ts
import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailMessage { to: string; subject: string; html: string; text: string; }
export interface EmailTransport {
  send(msg: EmailMessage): Promise<void>;
  captured?: EmailMessage[]; // stub only
}

export function createTransport(kind: 'log' | 'stub' | 'smtp', cfg: {
  SMTP_HOST?: string; SMTP_PORT?: number; SMTP_USER?: string; SMTP_PASS?: string; SMTP_FROM?: string;
  logger: { info: (obj: object, msg: string) => void };
}): EmailTransport {
  if (kind === 'log') {
    return {
      async send(msg) {
        cfg.logger.info({ to: msg.to, subject: msg.subject }, '[email:log] would send');
      },
    };
  }
  if (kind === 'stub') {
    const captured: EmailMessage[] = [];
    return {
      captured,
      async send(msg) { captured.push(msg); },
    };
  }
  if (!cfg.SMTP_HOST || !cfg.SMTP_FROM) throw new Error('EMAIL_TRANSPORT=smtp requires SMTP_HOST and SMTP_FROM');
  const transporter: Transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST, port: cfg.SMTP_PORT ?? 587, secure: false,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS! } : undefined,
  });
  return {
    async send(msg) {
      await transporter.sendMail({ from: cfg.SMTP_FROM, ...msg });
    },
  };
}
```

```typescript
// packages/server/src/email/templates/verify-email.ts
// D-30: TS literals, no templating engine
export const verifyEmailTemplate = (params: { link: string; email: string }) => ({
  subject: 'Verify your xci email',
  html: `<p>Click to verify: <a href="${params.link}">${params.link}</a></p>`,
  text: `Verify: ${params.link}`,
});
```

### Auth plugin (D-02 decorators + D-09 requireAuth)

```typescript
// packages/server/src/plugins/auth.ts
// Source: Fastify v5 Decorators docs
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq, isNull, gt, lt } from 'drizzle-orm';
import { sessions, users, orgMembers, orgs } from '../db/schema.js';
import { AuthnError } from '../errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; email: string } | null;
    org: { id: string; role: 'owner' | 'member' | 'viewer' } | null;
    session: { id: string; userId: string; expiresAt: Date } | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const authPlugin: FastifyPluginAsync<{ clock?: () => Date }> = async (fastify, opts) => {
  const now = () => opts.clock?.() ?? new Date();

  // decorateRequest (faster than onRequest-set; per Fastify docs)
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('org', null);
  fastify.decorateRequest('session', null);

  fastify.addHook('onRequest', async (req) => {
    const sid = req.cookies?.xci_sid;
    if (!sid) return;
    const db = fastify.db; // decorated by db plugin

    const rows = await db
      .select()
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.id, sid),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now()),
        ),
      )
      .limit(1);

    if (rows.length === 0) return;
    const row = rows[0]!;
    req.session = { id: row.sessions.id, userId: row.users.id, expiresAt: row.sessions.expiresAt };
    req.user = { id: row.users.id, email: row.users.email };

    // Pick activeOrgId from session or most-recent membership (D-18)
    if (row.sessions.activeOrgId) {
      const mem = await db
        .select({ role: orgMembers.role })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, row.sessions.activeOrgId), eq(orgMembers.userId, row.users.id)))
        .limit(1);
      if (mem.length > 0) {
        req.org = { id: row.sessions.activeOrgId, role: mem[0]!.role };
      }
    }

    // Sliding expiry with write-throttle (D-13 + Pitfall 6 guard)
    const oneHourAgo = new Date(now().getTime() - 60 * 60 * 1000);
    const newExpiry = new Date(now().getTime() + 14 * 24 * 60 * 60 * 1000);
    const absoluteCap = new Date(row.sessions.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ lastSeenAt: now(), expiresAt: newExpiry < absoluteCap ? newExpiry : absoluteCap })
      .where(
        and(
          eq(sessions.id, sid),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now()),
          lt(sessions.lastSeenAt, oneHourAgo),
        ),
      );
  });

  fastify.decorate('requireAuth', async (req: FastifyRequest) => {
    if (!req.session) throw new AuthnError('session required');
  });
};

export { authPlugin };
export default fp(authPlugin, { name: 'auth-plugin' });
```

### Per-route rate limit (AUTH-06)

```typescript
// packages/server/src/routes/auth/signup.ts
// Source: https://github.com/fastify/fastify-rate-limit
import type { FastifyPluginAsync } from 'fastify';

export const signupRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post('/signup', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 hour',
        keyGenerator: (req) => req.ip, // per-IP
      },
    },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 12 },
        },
      },
    },
  }, async (req, reply) => {
    // ... handler calls adminRepo.signupTx({email, password}) — creates org + user + member + plan
  });
};
```

```typescript
// packages/server/src/routes/auth/login.ts
fastify.post('/login', {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '15 minutes',
      keyGenerator: (req) => {
        const email = (req.body as { email?: string } | undefined)?.email ?? 'anon';
        return `${req.ip}:${email.toLowerCase()}`;
      },
    },
  },
}, handler);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Naive double-submit CSRF (random cookie = random header) | Signed double-submit via HMAC (what `@fastify/csrf-protection` uses) | OWASP 2024 update | Naive variant is DISCOURAGED; subdomain cookie-injection attack documented |
| Argon2i / Argon2d / bcrypt | Argon2id | RFC 9106 (2021), OWASP 2024 | bcrypt still acceptable for legacy; Argon2id is "best practice for new systems" |
| OWASP 2020 Argon2 params (m=46MiB, t=1) | OWASP 2024 params (m=19MiB, t=2) | 2024 update | Same security, shifts CPU ↔ RAM tradeoff — 19/2/1 tunes for shared-resource containers |
| `pg` (node-postgres) | `postgres` (postgres-js) for new Drizzle projects | Drizzle docs 2024+ | Simpler API, automatic reconnect; `pg` still works but `postgres-js` is Drizzle-blessed |
| Drizzle `uuid('id').defaultRandom().primaryKey()` | Text PKs for debuggability (project choice D-25) | Project-specific | Not a state-of-art shift; ecosystem still defaults to uuid |
| `@fastify/env` v5 (Fastify 5 peer) | `@fastify/env` v6 | 2026 release | Minor API; both work with Fastify 5 |

**Deprecated/outdated:**
- `argon2` npm package requires `node-gyp` + native build tools on Alpine → `@node-rs/argon2` superseded this need with prebuilt binaries.
- `bcrypt` npm package: same story (native bindings). Still acceptable if already in use, but new projects should pick Argon2id.
- `js-yaml` 4.x YAML 1.1 default (affects Phase 9 — `yaml` 2.x is already the project choice).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@fastify/env` v6 does not support JSON-schema `oneOf` for conditional SMTP field requirement | §Code examples — env schema | Low — worked around with runtime check in email transport factory |
| A2 | `postgres` 3.4.9 works with Node `>=20.5.0` (engines declares `>=12`) | Stack table | Low — confirmed by broad usage in Drizzle ecosystem; test during Task 1 bootstrap |
| A3 | Testcontainers works in ubuntu-latest GitHub Actions runner without custom Docker setup | §13 CI workflow | Low — Docker is preinstalled on ubuntu-latest; verified pattern used by thousands of OSS projects |
| A4 | Partial unique index `WHERE role = 'owner'` (for AUTH-08 "unique owner per org") works on Postgres 16 both alpine and full | §11 schema | Low — partial unique index has been Postgres feature since 7.2; both images are Postgres 16 |
| A5 | The recommended `xci_<prefix>_<base64url-15bytes>` ID scheme gives sufficient entropy (120-bit) and no collision risk | §Code — generateId | Low — 120 bits is UUIDv4-equivalent; well-studied |
| A6 | `drizzle-kit` 0.31.10 generate output works cleanly with `drizzle-orm` 0.45.2 runtime migrator | §Stack | MEDIUM — versions must be kept in lockstep; add to release checklist. Verified both are current 2026-04-18 |
| A7 | Fastify pino redaction `req.raw.headers.*` path works for v5 (docs only show `req.headers.*`) | §Pitfall 7 | Low — redact.paths is a string path; `req.raw.headers.cookie` is valid dot-notation for whatever object pino receives |
| A8 | Biome v2 `noRestrictedImports` rule can scope to a path pattern like `packages/server/src/**` and disallow `./repos/users.js` etc. | §Scoped repo wrapper | MEDIUM — if rule syntax is insufficient, fall back to a custom lint script (`node scripts/check-repo-imports.mjs`); Phase 6 already uses `noRestrictedImports` successfully for ws/reconnecting-websocket |

All other claims in this document are tagged `[VERIFIED: npm registry]` (version numbers) or `[CITED: <url>]` (documented patterns).

## Open Questions (RESOLVED)

1. **Should the D-01 scoped-repo Biome rule block `import from './repos/users.js'` outside `src/repos/`?**
   - **RESOLVED:** Plan 07-01 Task 2 implements `noRestrictedImports` in `biome.json` overrides scoped to `src/{routes,plugins,app.ts}`, enumerating all 12 repo file paths (6 repos × 2 prefixes `./repos/x` and `../repos/x`) as forbidden. The fallback `scripts/check-repo-imports.mjs` is NOT added in Phase 7 — Biome's pattern blocking is sufficient per Phase 6 precedent. If a future regression slips through, add the script in a follow-up.

2. **Do we pre-create the test-utils testcontainers harness once globally, or per-suite?**
   - **RESOLVED:** ONE container per `pnpm --filter @xci/server test:integration` invocation, lifecycle managed by Vitest `globalSetup` per Plan 07-02. Phase 8+ (agent WS tests) will share the same container; if scaling becomes a concern, switch to vitest projects later. Per-suite isolation is achieved via `TRUNCATE … RESTART IDENTITY CASCADE` between tests (D-22).

3. **How do we handle the "invitee goes through signup then accepts invite" flow (D-17)?**
   - **RESOLVED:** Plan 07-07 implements `POST /api/invites/:token/accept` requiring an authenticated session. The invite link in the email is `<APP_URL>/invites/<token>` — server-rendered redirect logic is Phase 13 (web SPA). For Phase 7, an invitee with no account hits `/api/invites/:token/preview` (unauth, returns invite metadata if token valid+unexpired+email-pinned), then signs up via `/api/auth/signup` (passing `?inviteToken=<t>` as a query so the client can call accept after verification). All state lives in the token + DB row — no "pending invite session" concept on the server.

4. **Does the email transport `stub` need a getter exported to tests, or do tests construct their own stub?**
   - **RESOLVED:** Per Plan 07-03 + 07-05, the stub transport is constructed at `buildApp({ emailTransport })` time. Tests pass `createTransport('stub', ...)` and read `app.emailTransport.captured` (an array exposed on the transport instance). NO global singleton — each `buildApp` call gets a fresh stub for test isolation.

5. **What's the session refresh behavior on the same second as the 1h throttle boundary?**
   - **RESOLVED:** Per Plan 07-04 (sessions.ts) + Plan 07-05 (auth plugin): all time comparisons happen inside the SQL UPDATE predicate using Postgres `NOW()` — `WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW() AND last_seen_at < NOW() - INTERVAL '1 hour'`. Node-side `new Date()` is only used to compute the NEW `last_seen_at` and `expires_at` values written by the UPDATE. No Node↔Postgres clock-skew exposure on the throttle predicate (Pitfall 6).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker daemon | testcontainers integration tests | ✗ (in agent sandbox) | — | CI runs on ubuntu-latest which has Docker preinstalled; dev laptops need Docker Desktop |
| Postgres client libs | postgres-js driver | ✓ (pure JS, no libpq) | — | — |
| Node 20.5+ | Runtime floor | ✓ (project uses 22) | — | — |
| pnpm 10.33.0 | Package manager | ✓ (confirmed in root package.json) | 10.33.0 | — |
| TypeScript 5.9+ | Compiler | ✓ (at root) | ^5.9.0 | — |
| glibc Linux (for argon2 prebuilt) | Phase 14 Docker image | — (Phase 14 concern) | — | `node:22-slim` specified in ROADMAP |

**Missing dependencies with no fallback:**
- None that block Phase 7 execution in CI (ubuntu-latest has Docker).

**Missing dependencies with fallback:**
- Local dev without Docker: integration tests `skipIf(!hasDocker)` — unit tests still run. Document in `packages/server/README.md`.

## Validation Architecture

> `workflow.nyquist_validation` is `false` in `.planning/config.json`, but the user explicitly
> requested this section for the D-04 contract. Included by user request.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 (already at root) |
| Config files | `packages/server/vitest.unit.config.ts`, `packages/server/vitest.integration.config.ts` |
| Unit suite command | `pnpm --filter @xci/server test:unit` |
| Integration suite command | `pnpm --filter @xci/server test:integration` (Linux-only in CI, D-23) |
| Full suite command | `pnpm --filter @xci/server test` (runs both) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Signup creates user with argon2id hash | HTTP-integration | `pnpm --filter @xci/server test:integration -- signup` | Wave 0 |
| AUTH-02 | Verification token 24h expiry single-use | HTTP-integration | `pnpm --filter @xci/server test:integration -- verify-email` | Wave 0 |
| AUTH-03 | Session cookie httpOnly+secure+sameSite=strict | HTTP-integration | `pnpm --filter @xci/server test:integration -- login` | Wave 0 |
| AUTH-04 | Password reset 1h single-use | HTTP-integration | `pnpm --filter @xci/server test:integration -- reset` | Wave 0 |
| AUTH-05 | CSRF required on mutations | HTTP-integration | `pnpm --filter @xci/server test:integration -- csrf` | Wave 0 |
| AUTH-06 | Rate-limit on signup/login/reset | HTTP-integration | `pnpm --filter @xci/server test:integration -- rate-limit` | Wave 0 |
| AUTH-07 | Personal org auto-created at signup | repo-integration | `pnpm --filter @xci/server test:integration -- signup.isolation` | Wave 0 |
| AUTH-08 | Role constraints (owner unique per org) | repo-integration | `pnpm --filter @xci/server test:integration -- org-members.isolation` | Wave 0 |
| AUTH-09 | Invite 7d expiry, email-pinned | HTTP-integration | `pnpm --filter @xci/server test:integration -- invites` | Wave 0 |
| **AUTH-10** | **Multi-tenant isolation by-design** | **repo-integration + meta** | `pnpm --filter @xci/server test:integration -- isolation` | **Wave 0 (load-bearing)** |
| AUTH-11 | Email transport pluggable | unit | `pnpm --filter @xci/server test:unit -- email.transport` | Wave 0 |
| AUTH-12 | Logout irreversibly revokes session | HTTP-integration | `pnpm --filter @xci/server test:integration -- logout` | Wave 0 |
| QUOTA-01 | `org_plans` table has required fields | unit (Drizzle schema) | `pnpm --filter @xci/server test:unit -- schema` | Wave 0 |
| QUOTA-02 | Free defaults 5/5/30 auto-inserted | repo-integration | `pnpm --filter @xci/server test:integration -- signup.isolation` | Wave 0 |
| QUOTA-07 | No Stripe/upgrade code | n/a (negative space) | grep-assert in CI | Wave 0 |

### The D-04 Validation Contract (load-bearing)

For every public repo factory `makeXxxRepo()` exported from `src/repos/<name>.ts` (excluding `index.ts`, `for-org.ts`, `admin.ts`):

1. **Two-org fixture test** exists at `src/repos/__tests__/<name>.isolation.test.ts`.
2. **Every function** returned by the factory is exercised in that test against Org B data and asserts empty result.
3. **Meta-test** `src/repos/__tests__/isolation-coverage.test.ts` (§6 code example) fails CI if step 1 or step 2 is missing.

**When a new repo function is added in Phase 8+:** Author must add the corresponding isolation test, or the meta-test fails and CI goes red.

### Sampling Rate
- **Per task commit:** `pnpm --filter @xci/server test:unit` (fast, no Docker)
- **Per wave merge:** `pnpm --filter @xci/server test` (full — integration + unit)
- **Phase gate:** Full suite green on Linux CI + smoke (all 6 matrix still green for xci) before `/gsd-verify-work`.

### Wave 0 Gaps (files the planner must create before any repo/route task)

- [ ] `packages/server/tsconfig.json` — extends base; includes drizzle.config.ts, vitest configs
- [ ] `packages/server/drizzle.config.ts` — dev-time schema → SQL
- [ ] `packages/server/vitest.unit.config.ts`
- [ ] `packages/server/vitest.integration.config.ts` + `globalSetup` / `globalTeardown`
- [ ] `packages/server/src/db/schema.ts` — all 8 tables
- [ ] `packages/server/src/db/migrator.ts`
- [ ] `packages/server/src/test-utils/db-harness.ts` — testcontainers + resetDb
- [ ] `packages/server/src/test-utils/two-org-fixture.ts`
- [ ] `packages/server/src/repos/__tests__/isolation-coverage.test.ts` — the meta-test
- [ ] `packages/server/.env.example`
- [ ] CI workflow: add `integration-tests` Linux-only job after `build-test-lint` matrix passes

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Argon2id @ OWASP 2024 params (§Pitfall 3); NIST SP 800-63B length-over-complexity password rule (D-32) |
| V3 Session Management | yes | `randomBytes(32)` session ID, httpOnly+secure+sameSite=strict cookie, sliding 14d expiry with 30d absolute cap, logout sets `revoked_at`, subsequent requests ignored (D-11..14) |
| V4 Access Control | yes | Per-route `requireAuth` preHandler (D-09); org-scoped repo wrapper (D-01) enforces tenant isolation structurally |
| V5 Input Validation | yes | Fastify JSON-schema body validation on every mutation route; `@fastify/env` validates all env at boot |
| V6 Cryptography | yes | `@node-rs/argon2` for passwords; Node `crypto.randomBytes` for tokens; `@fastify/cookie` signs session cookie with `SESSION_COOKIE_SECRET` (32+ bytes, validated via env-schema) |
| V7 Error Handling | yes | Central `setErrorHandler` maps `XciServerError` → `{code, message, requestId}`; stack traces only in dev (D-08); secrets never in error bodies (mirrors v1 `ShellInjectionError` discipline) |
| V9 Data Protection | yes | Pino redaction covers password, token, cookie, authorization paths (D-10 + §Pitfall 7) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection | Tampering | Drizzle parameterized queries (default); no raw `.execute()` with user input |
| CSRF | Spoofing | `@fastify/csrf-protection` signed double-submit (OWASP-recommended variant) |
| Session fixation | Spoofing | New session ID generated on login; never reuse pre-login session cookie |
| Session hijacking via XSS | Spoofing | `httpOnly` cookie (browser JS can't read); CSP via `@fastify/helmet` |
| Account enumeration via login | Information disclosure | Login returns the same error for "unknown email" and "wrong password" |
| Password reset enumeration | Information disclosure | Password-reset-request endpoint returns 204 regardless of whether email exists |
| Timing attack on password verify | Information disclosure | `@node-rs/argon2.verify()` uses constant-time comparison internally |
| Timing attack on token compare | Information disclosure | Use `crypto.timingSafeEqual` for token lookup (same as v1 ATOK-06 pattern will in Phase 8) — for email-verify / password-reset / invite tokens |
| Tenant data leak (the big one) | Information disclosure | Scoped-repo wrapper (D-01) + two-org fixture + auto-discovery meta-test (D-04) |
| Brute force login | DoS | `@fastify/rate-limit` 10/15min per IP+email bucket (D-35) |
| Signup spam / throwaway orgs | DoS | `@fastify/rate-limit` 5/h per IP on signup |
| Email enumeration via signup | Information disclosure | Same return shape for "already registered" and "new" — let verification email be the flag |
| Stored XSS via org name / user email | Tampering | Output encoding when we reach Phase 13 UI; Phase 7 API returns JSON only, no HTML templates beyond transactional emails (which use a 5-line HTML escape) |

## Recommended File Structure for `packages/server/`

See §Recommended Project Structure above — reproduced here as the authoritative layout for the planner.

## Sequencing

**Tasks must be executed in this dependency order (planner uses this to slot waves):**

1. **Wave 0 — Package bootstrap**
   1. Flip `packages/server/package.json` `private: false`; add real scripts (`dev`, `build`, `test`, `test:unit`, `test:integration`, `lint`, `typecheck`); add runtime + dev deps (§Installation).
   2. Create `tsconfig.json` extending base.
   3. Create `drizzle.config.ts`.
   4. Create `vitest.unit.config.ts` + `vitest.integration.config.ts`.
   5. Update `turbo.json` if needed (the existing `test` task depends on `build`; for server, tests run against sources via tsx/vitest — no build dep needed; planner may add `test:integration` as a separate task or rely on filtering).
   6. Create `.env.example`.
   7. Update root `biome.json` if needed (add `noRestrictedImports` rule for `packages/server/src/**` to block `./repos/*` imports from outside the repos folder — per D-01 enforcement).
   8. Add `@xci/server` first changeset (minor, feat: database schema & auth).

2. **Wave 1 — Database foundation (must complete before any route/repo)**
   1. Schema (`src/db/schema.ts`) — all 8 tables.
   2. Relations (`src/db/relations.ts`).
   3. Run `drizzle-kit generate` → produces `drizzle/0000_initial.sql`, commit.
   4. Programmatic migrator (`src/db/migrator.ts`).
   5. DB plugin (`src/db/plugin.ts`) decorating `fastify.db`.

3. **Wave 2 — Test harness**
   1. `src/test-utils/db-harness.ts` (testcontainers + resetDb — Pitfall 5 dynamic truncation).
   2. `src/test-utils/two-org-fixture.ts`.
   3. `src/test-utils/global-setup.ts` and `global-teardown.ts`.
   4. First integration smoke test: `setupTestDb() → migrate → select 1 → teardown`. Must pass on Linux CI.

4. **Wave 3 — Crypto primitives**
   1. `src/crypto/tokens.ts` — `generateToken`, `generateId`.
   2. `src/crypto/password.ts` — `hashPassword`, `verifyPassword`, `argon2SelfTest`.
   3. Unit tests for both (pure functions, no DB).

5. **Wave 4 — Scoped repos (D-01/D-03)**
   1. Per-table repo files: `users.ts`, `sessions.ts`, `email-verifications.ts`, `password-resets.ts`, `org-invites.ts`, `org-plans.ts`. NONE exported from `index.ts`.
   2. `for-org.ts` factory composing all above.
   3. `admin.ts` — signup transaction, cross-org enumeration helpers.
   4. `index.ts` — exports `makeRepos()` only.
   5. Per-repo `<name>.isolation.test.ts` files (D-04).
   6. `isolation-coverage.test.ts` meta-test.

6. **Wave 5 — Error hierarchy + email + env**
   1. `src/errors.ts` (`XciServerError` subclasses).
   2. `src/config/env.schema.ts` + module augmentation.
   3. `src/email/transport.ts` + `src/email/templates/*.ts`.

7. **Wave 6 — App factory + plugins**
   1. `src/app.ts` with plugin chain (D-06 order).
   2. `src/plugins/auth.ts` — decorators + `onRequest` hook + `requireAuth`.
   3. `src/plugins/error-handler.ts`.
   4. `src/server.ts` — CLI entry, reads env, calls `buildApp`, `argon2SelfTest`, `listen`.

8. **Wave 7 — Routes (auth flows)**
   1. `POST /api/auth/signup` — AUTH-01 + AUTH-07.
   2. `POST /api/auth/verify-email` — AUTH-02.
   3. `POST /api/auth/login` — AUTH-03.
   4. `POST /api/auth/logout` — AUTH-12.
   5. `POST /api/auth/request-reset` + `POST /api/auth/reset` — AUTH-04.
   6. `POST /api/orgs/:orgId/invites`, `GET /api/orgs/:orgId/invites`, `DELETE /api/orgs/:orgId/invites/:id` — AUTH-09.
   7. `POST /api/invites/:token/accept` — AUTH-09 acceptance flow.
   8. HTTP-integration tests using `fastify.inject()` per D-24.

9. **Wave 8 — CI workflow update**
   1. Add `integration-tests` Linux-only job to `.github/workflows/ci.yml`. Depends on `build-test-lint` matrix success.
   2. Gate: must pass before merge to main (branch-protection concern, same as Phase 6 fence-gates).
   3. Example step:
   ```yaml
   integration-tests:
     needs: [build-test-lint]
     runs-on: ubuntu-latest
     steps:
       - uses: actions/checkout@v4
       - uses: pnpm/action-setup@v4
       - uses: actions/setup-node@v4
         with: { node-version: 22, cache: 'pnpm' }
       - run: pnpm install --frozen-lockfile
       - run: pnpm --filter @xci/server build
       - run: pnpm --filter @xci/server test:integration
   ```

10. **Wave 9 — Phase close**
    1. All CI green (6-matrix + fence-gates + integration-tests).
    2. Update `.planning/STATE.md` with phase-7 decisions actually hit.
    3. RESEARCH validated by `/gsd-verify-work`.

**Critical:** Wave 1 and Wave 2 are the foundation. Wave 4 (repos) depends on Wave 1 (schema) AND Wave 2 (test harness, because TDD). Wave 6 (app factory) depends on Wave 4 (repos) and Wave 5 (errors/email/env). Skipping ahead = cascading rework.

## CI Workflow Update (Wave 8 detail)

Current `.github/workflows/ci.yml` has:
- `build-test-lint` — 6-matrix (3 OS × Node [20, 22])
- `fence-gates` — Linux-only, ws-grep + hyperfine

Phase 7 adds a **third job**:

```yaml
integration-tests:
  # Linux-only — Docker required (testcontainers). Matches D-23 policy.
  needs: [build-test-lint]  # only run if matrix passes
  runs-on: ubuntu-latest
  steps:
    - name: Checkout
      uses: actions/checkout@v4
    - name: Setup pnpm
      uses: pnpm/action-setup@v4
    - name: Setup Node 22
      uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: 'pnpm'
    - name: Install dependencies
      run: pnpm install --frozen-lockfile
    - name: Build server package
      run: pnpm --filter @xci/server build
    - name: Run integration suite (testcontainers)
      run: pnpm --filter @xci/server test:integration
      # Docker is preinstalled on ubuntu-latest. testcontainers auto-pulls postgres:16-alpine.
      # First run: ~30s container boot. Subsequent runs cached.
    - name: Upload vitest results (on failure)
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: vitest-integration-results
        path: packages/server/.vitest-output/
```

**Branch protection:** Add `integration-tests` to the list of required status checks before merge (alongside existing `build-test-lint` and `fence-gates`). Listed in STATE.md pending todos.

**Why Linux-only:** Per D-23, Docker preinstalled on ubuntu-latest; Windows/macOS runners need Docker Desktop install which is slow and flaky. Integration coverage is the same regardless of runner OS.

## Sources

### Primary (HIGH confidence)
- `npm view <pkg> version` (all version claims, 2026-04-18) — fastify@5.8.5, drizzle-orm@0.45.2, drizzle-kit@0.31.10, postgres@3.4.9, @node-rs/argon2@2.0.2, @fastify/env@6.0.0, @fastify/cookie@11.0.2, @fastify/csrf-protection@7.1.0, @fastify/rate-limit@10.3.0, @fastify/helmet@13.0.2, @testcontainers/postgresql@11.14.0, nodemailer@8.0.5, pino@10.3.1, tsx@4.21.0, ts-morph@28.0.0
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html — Argon2id 19MiB/2/1 confirmed
- https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html — signed double-submit RECOMMENDED, naive DISCOURAGED
- https://orm.drizzle.team/docs/migrations — `drizzle-orm/postgres-js/migrator` import path
- https://orm.drizzle.team/docs/sql-schema-declaration — `pgTable`, `timestamp`, `references({onDelete: 'cascade'})`, `$inferSelect`/`$inferInsert`
- https://orm.drizzle.team/docs/relations — `relations()` helper from `drizzle-orm`
- https://orm.drizzle.team/docs/get-started-postgresql — postgres-js driver setup
- https://github.com/fastify/csrf-protection — `getToken`, `cookieKey`, per-route `onRequest` pattern
- https://github.com/fastify/fastify-env — JSON-schema validation, `fastify.config` decorator
- https://github.com/fastify/fastify-rate-limit — `keyGenerator`, per-route `config.rateLimit`
- https://node.testcontainers.org/modules/postgresql/ — `PostgreSqlContainer`, `getConnectionUri`, image selection
- `npm view @node-rs/argon2 optionalDependencies` — prebuilt binary targets including `linux-x64-gnu`
- https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/postgres-js/migrator.ts — exact migrate() signature
- Fastify v5 docs https://fastify.dev/docs/latest/ — plugin order, decorateRequest patterns

### Secondary (MEDIUM confidence)
- `@fastify/env` v6 release date (March 2026) — from package README
- pino redaction wildcard behavior — from docs

### Tertiary (LOW confidence) — none load-bearing in this research

## Metadata

**Confidence breakdown:**
- Standard stack versions: HIGH — all `npm view`'d 2026-04-18
- Architecture patterns (Fastify plugin order, Drizzle migrator, decorators): HIGH — official docs
- Argon2 parameters: HIGH — OWASP 2024 matches D-31 exactly
- Scoped-repo wrapper pattern: HIGH (pattern is well-known, project-specific shape)
- Auto-discovery test approach: MEDIUM — regex-vs-ts-morph is a tradeoff, regex chosen for simplicity
- Testcontainers in CI: HIGH — preinstalled on ubuntu-latest, documented pattern
- CSRF naive-vs-signed: HIGH — direct OWASP citation
- Conditional SMTP env validation workaround: MEDIUM — inferred from @fastify/env docs

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (30 days — stable ecosystem; re-verify versions on re-open)

## RESEARCH COMPLETE
