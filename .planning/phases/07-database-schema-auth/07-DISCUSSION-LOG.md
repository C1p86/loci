# Phase 7: Database Schema & Auth - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 07-database-schema-auth
**Areas discussed:** Multi-tenant isolation pattern, Fastify app structure & conventions, Org invite mechanics, Integration test infrastructure
**Mode:** Auto-selected (user requested autonomous chain to milestone end after gray-area selection)

---

## Multi-tenant Isolation Pattern

### Q1: How should `org_id` filtering be enforced in the repository layer?

| Option | Description | Selected |
|--------|-------------|----------|
| Scoped repository wrapper | Repos exposed only via `forOrg(orgId).users.findById(...)`; type system enforces; refactor-safe | ✓ |
| Drizzle query helper | Helper auto-injects `WHERE org_id = ctx.orgId`; needs lint/test to verify every query routes through it | |
| Postgres RLS | DB-level enforcement via `SET app.org_id` + `CREATE POLICY`; strongest but couples to PG, complicates cross-org and tests | |
| Convention + Biome rule | Every repo function signature must start with `orgId: string`; lint rule enforces | |

**Selected:** Scoped repository wrapper
**Rationale:** SC-4 demands "unreachable by design" — only the wrapper makes the wrong code refuse to compile. Other options reduce to "wrong code that lint/CI catches", which is weaker than "wrong code that doesn't exist".

### Q2: How should `orgId` reach the repo layer at request time?

| Option | Description | Selected |
|--------|-------------|----------|
| Fastify request decorator | Auth plugin sets `request.org`; routes pass `request.org.id` explicitly to `forOrg()` | ✓ |
| AsyncLocalStorage context | Implicit ctx via ALS; `getCurrentOrgId()` in repos | |
| Explicit params everywhere | Thread `orgId` as first arg through every layer | |

**Selected:** Fastify request decorator + explicit `forOrg(req.org.id)` at handler boundary
**Rationale:** ALS breaks for cron jobs (Phase 11 retention) and webhook handlers (Phase 12) running outside requests — silent bugs filtering by `undefined`. Decorator is pure for handlers; explicit threading from there is safe and unit-testable.

### Q3: How do we handle the cross-org "escape hatch"?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate `adminRepo` namespace | Cross-org operations live in clearly-named module; visible in code review | ✓ |
| Bypass token argument | Repo functions accept `{ bypass: true }`; every call site is a potential leak | |
| Separate raw-query layer | No abstraction for cross-org; raw Drizzle directly in calling module | |

**Selected:** Separate `adminRepo` namespace
**Rationale:** The visual contrast in code review is the safety mechanism. `adminRepo.foo(...)` jumps out vs `forOrg(...).foo()` and answers reviewer's "why is this not org-scoped?" question by its very name.

### Q4: How do we PROVE isolation in tests?

| Option | Description | Selected |
|--------|-------------|----------|
| Two-org fixture per repo + auto-discovery test | Per-function fixture with seeded Org A/B; meta-test fails if a public repo function lacks an isolation test | ✓ |
| Property test (fast-check) | Generative random repo calls; assert no cross-org row returned | |
| Static analysis only | ts-morph/Biome scans for `eq(t.org_id, ...)` in queries | |

**Selected:** Two-org fixture per repo + auto-discovery test
**Rationale:** Static analysis can't catch JOIN-leak (joined table missing its own org_id filter). Property tests are great for finding edge cases but harder to debug. The discovery meta-test ensures regressions ("new repo function added without test") fail CI.

---

## Fastify App Structure & Conventions

(All sub-decisions auto-selected per user's chain request — no per-question Q&A surfaced; rationale captured inline in CONTEXT.md D-05 through D-10.)

| Decision | Choice | Alternatives considered |
|----------|--------|-------------------------|
| App entry shape | `buildApp(opts)` factory | Singleton instance; direct `fastify()` in entry |
| Plugin registration | Explicit, in fixed order | `@fastify/autoload` (deferred — magic w/o payoff at this scale) |
| Env config | `@fastify/env` with JSON schema | `zod-fastify`; custom env loader |
| Error handling | `XciServerError` hierarchy + central handler | Throw raw + per-route handler; HTTP-status-per-throw |
| Auth surface | Per-route `preHandler: [requireAuth]` opt-in | Global "everything authenticated" middleware with per-route opt-out |
| Logging | Fastify pino default + redaction config | Custom transport; structured-log lib (winston) |

---

## Org Invite Mechanics

| Decision | Choice | Alternatives considered |
|----------|--------|-------------------------|
| Invite addressing | Email-pinned (acceptor email must match) | Anyone-with-link |
| Role assignment | At invite-time, locked through acceptance | At acceptance (invitee picks) |
| User row pre-creation | None — only on acceptance | Pre-create `pending` user row |
| Invitee with Personal org | Keeps Personal, adds new membership (M:N) | Migrate Personal data into new org; replace Personal |
| Token format | `randomBytes(32)` base64url, single-use, 7d expiry | UUID; JWT with embedded claims |

---

## Integration Test Infrastructure

| Decision | Choice | Alternatives considered |
|----------|--------|-------------------------|
| Postgres source | `@testcontainers/postgresql` (ephemeral per suite) | docker-compose shared instance; pg-mem (in-memory shim); skip integration |
| Image | `postgres:16-alpine` for tests | `postgres:16` (slower pull/boot); pinned digest |
| Cleanup | `TRUNCATE … RESTART IDENTITY CASCADE` between tests | Drop/recreate schema per test (slower); per-test transactions w/ rollback |
| CI policy | Linux-only (matches Phase 6 D-17 hyperfine) | Run on full 3-OS matrix (Docker Desktop install required on Mac/Win — slow, flaky) |
| Test layering | Unit (no DB, all OSes) + repo integration (Linux) + HTTP integration via `fastify.inject()` (Linux) | Single integration suite; pure unit + Phase 14 E2E only |

---

## Claude's Discretion

The following sub-decisions were left to the planner per CONTEXT.md "Claude's Discretion" section:
- Exact directory layout under `packages/server/src/`
- Drizzle column types beyond `id text` and `org_id text`
- Specific `@fastify/env` JSON-schema shape
- Exact format of test discovery for D-04 (ts-morph vs naming convention)
- Exact REST route paths for auth flows
- `vitest.config.ts` shape for unit/integration split
- `.env.example` content

## Deferred Ideas

See CONTEXT.md `<deferred>` section. Highlights:
- "Log out everywhere" UI → Phase 13
- Owner role transfer → Phase 13
- Audit log → post-v2.0
- haveibeenpwned check → post-v2.0 hardening
- 2FA/TOTP, OAuth/SSO → post-v2.0
- Redis-backed sessions/rate-limit → only when horizontal scaling forces it
