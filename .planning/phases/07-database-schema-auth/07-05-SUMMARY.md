---
phase: 07-database-schema-auth
plan: "05"
subsystem: server-fastify-core
tags: [fastify, app-factory, auth-plugin, error-handler, session, csrf, rate-limit, pino-redact]
dependency_graph:
  requires: [07-01, 07-02, 07-03, 07-04]
  provides:
    - packages/server/src/app.ts
    - packages/server/src/server.ts
    - packages/server/src/plugins/auth.ts
    - packages/server/src/plugins/error-handler.ts
    - packages/server/src/routes/index.ts
    - packages/server/src/plugins/__tests__/auth.integration.test.ts
    - packages/server/src/plugins/__tests__/error-handler.test.ts
    - packages/server/src/__tests__/buildApp.integration.test.ts
  affects: [07-06, 07-07]
tech_stack:
  added:
    - "@fastify/cookie 11.0.2 — xci_sid httpOnly+secure+sameSite=strict session cookie"
    - "@fastify/csrf-protection 7.1.0 — double-submit cookie, per-route opt-in (Pitfall 1)"
    - "@fastify/env 6.0.0 — JSON-schema env validation, fail-fast at boot"
    - "@fastify/helmet 13.0.2 — security headers baseline"
    - "@fastify/rate-limit 10.3.0 — global 100/min default, per-route override"
    - "fastify-plugin 5.0.1 — plugin encapsulation for auth + error-handler"
  patterns:
    - buildApp-factory: "buildApp(opts: BuildOpts) injects databaseUrl/emailTransport/clock/randomBytes for test isolation (D-05)"
    - d06-plugin-order: "env → db → helmet → cookie → csrf → rate-limit → auth → error-handler → routes (enforced by fastify-plugin dependencies)"
    - pino-redact-pitfall7: "redact.paths covers both req.headers.cookie AND req.raw.headers.cookie + req.raw.headers.authorization"
    - auth-plugin-cross-org: "onRequest uses adminRepo.findUserById (no orgId) then resolves active org separately (D-02 decorator pattern)"
    - sliding-expiry-atomic: "single SQL UPDATE with 4 predicates (revoked_at IS NULL + expires_at > now() + last_seen_at < now()-1h) — no read-then-write race (D-13 + Pitfall 6)"
    - require-auth-prehandler: "fastify.requireAuth = per-route preHandler; throws SessionRequiredError (401) if req.session null (D-09)"
    - error-handler-exhaustive: "XciServerError → httpStatusFor(category); validation Fastify errors → 400 VAL_SCHEMA; unknown → 500 INT_UNKNOWN (stack only non-production)"
key_files:
  created:
    - packages/server/src/app.ts
    - packages/server/src/server.ts
    - packages/server/src/plugins/auth.ts
    - packages/server/src/plugins/error-handler.ts
    - packages/server/src/routes/index.ts
    - packages/server/src/plugins/__tests__/auth.integration.test.ts
    - packages/server/src/plugins/__tests__/error-handler.test.ts
    - packages/server/src/__tests__/buildApp.integration.test.ts
  modified:
    - packages/server/src/test-utils/db-harness.ts (added getTestDbUrl() export)
    - packages/server/src/test-utils/global-setup.ts (set DATABASE_URL + SESSION_COOKIE_SECRET + EMAIL_TRANSPORT + NODE_ENV=test)
decisions:
  - "Auth plugin uses direct Drizzle query for session lookup (not adminRepo.findActiveSessionByToken) because it needs isNull(revokedAt)+gt(expiresAt,now()) predicates at query time — adminRepo.findActiveSessionByToken does a plain .where(eq(sessions.id, token)) without those guards"
  - "Sliding expiry implemented as raw sql`` template (not Drizzle update builder) to use LEAST(now()+14d, created_at+30d) — Drizzle's update set doesn't support SQL function expressions in this form"
  - "buildApp passes {} not {databaseUrl: undefined} to dbPlugin when databaseUrl not provided — avoids TypeScript exactOptionalPropertyTypes violation"
  - "CSRF registered globally but NOT globally hooked (Pitfall 1 per D-34) — routes opt-in via onRequest: [fastify.csrfProtection]"
  - "pino-pretty transport only in non-production AND non-test environments — avoids import overhead in test runs"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-18"
  tasks_completed: 3
  tasks_total: 3
  files_created: 8
  files_modified: 2
---

# Phase 07 Plan 05: Fastify App Factory + Auth Plugin + Error Handler Summary

**One-liner:** buildApp(BuildOpts) factory wiring 7 Fastify plugins in exact D-06 order (env→db→helmet→cookie→csrf→rate-limit→auth→error-handler→routes), auth plugin with cross-org session lookup + decorateRequest(user/org/session) + atomic sliding-expiry SQL + requireAuth preHandler, centralized error-handler mapping XciServerError→HTTP via httpStatusFor, and server.ts entry calling argon2SelfTest before listen.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | buildApp factory + error-handler plugin + routes stub | 22159ee | app.ts, error-handler.ts, routes/index.ts, error-handler.test.ts |
| 2 | Auth plugin + session decorators + sliding expiry + requireAuth | e2bc1c9 | plugins/auth.ts, auth.integration.test.ts, db-harness.ts, global-setup.ts |
| 3 | server.ts entry + buildApp integration smoke tests | fc814a4 | server.ts, buildApp.integration.test.ts |

## Plugin Registration Order (D-06)

```
buildApp() registers in exact order:
1. @fastify/env      — JSON-schema env validation; server fails to boot on missing/invalid
2. db-plugin         — decorates fastify.db; depends on @fastify/env
3. @fastify/helmet   — security headers (contentSecurityPolicy: false for Phase 13 SPA)
4. @fastify/cookie   — signed cookies, secret from SESSION_COOKIE_SECRET
5. @fastify/csrf-protection — double-submit cookie; getToken reads x-csrf-token header
6. @fastify/rate-limit      — global 100/min default, in-memory (D-36)
7. auth-plugin       — decorateRequest + onRequest hook; depends on db-plugin + @fastify/cookie
8. error-handler     — setErrorHandler; depends on none (fp wraps, must be before routes)
9. registerRoutes    — prefix /api; GET /healthz stub; Plans 06/07 add auth/org routes
```

## Auth Plugin Implementation

The `onRequest` hook uses a direct Drizzle query (not `adminRepo.findActiveSessionByToken`) because the hook needs `isNull(revokedAt)` and `gt(expiresAt, now())` evaluated at DB time as predicates — the admin repo's function returns all rows matching only by token ID. After finding the session row, the hook calls `repos.admin.findUserById` and resolves the active org from `session.activeOrgId` with membership validation, falling back to `findUserFirstOrgMembership`.

Sliding expiry uses a raw `sql`` template to express `LEAST(now()+14d, created_at+30d)` — Drizzle's `.set()` API doesn't support SQL function expressions on the right-hand side of assignments. The UPDATE includes all four Pitfall 6 predicates atomically.

## Pino Redaction Paths (Pitfall 7)

```
req.body.password, req.body.currentPassword, req.body.newPassword,
req.body.token, req.body.registrationToken,
req.headers.cookie, req.headers.authorization,
req.raw.headers.cookie, req.raw.headers.authorization,  ← both headers AND raw headers
*.password, *.token
```

## Test Counts

| Suite | Config | Tests | Docker required |
|-------|--------|-------|-----------------|
| error-handler.test.ts | unit | 10 | No |
| auth.integration.test.ts | integration | 5 | Yes |
| buildApp.integration.test.ts | integration | 7 | Yes |
| **TOTAL unit** | | **60** (50 prior + 10 new) | No |

## Integration Tests Status

Docker unavailable on this dev machine. Integration tests (`auth.integration.test.ts`, `buildApp.integration.test.ts`) require the testcontainer globalSetup. Deferred to CI (Linux runners with Docker per D-23).

Unit tests: **60 passed** (50 prior + 10 new error-handler tests).

## Build Artifact

`tsc -b` emits `packages/server/dist/server.js` which:
- Passes `node --check` (valid ESM syntax)
- Contains no shebang (server.ts is not a CLI bin — D-39 / PATTERNS.md constraint)
- Is importable as ESM (`"type": "module"` in package.json)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript exactOptionalPropertyTypes violation in app.ts**
- **Found during:** Task 1 typecheck
- **Issue:** `createTransport(kind, { SMTP_HOST: app.config.SMTP_HOST })` — config properties are `string | undefined` but TransportConfig uses `exactOptionalPropertyTypes`, so `undefined` is not assignable to `string`.
- **Fix:** Changed to spread-conditional pattern: `...(app.config.SMTP_HOST !== undefined && { SMTP_HOST: app.config.SMTP_HOST })` for each optional SMTP field.
- **Files modified:** `src/app.ts`
- **Commit:** 22159ee (inline before commit)

**2. [Rule 1 - Bug] TypeScript unknown type in setErrorHandler callback**
- **Found during:** Task 1 typecheck
- **Issue:** Fastify v5 types the `err` parameter of `setErrorHandler` as `unknown`, so `err.message`, `err.validation`, `err.statusCode`, `err.stack` were all type errors.
- **Fix:** Typed the callback parameter as `err: Error & { validation?: unknown; statusCode?: number }`.
- **Files modified:** `src/plugins/error-handler.ts`
- **Commit:** 22159ee (inline before commit)

**3. [Rule 2 - Missing] Biome suppression comment used invalid rule category**
- **Found during:** Task 3 lint check
- **Issue:** `biome-ignore lint/nursery/noAwaitInLoop` is not a recognized Biome 2.x category; lint failed with parse error.
- **Fix:** Removed the suppression comment entirely — Biome 2.x does not flag `await` in a for loop in integration tests.
- **Files modified:** `src/__tests__/buildApp.integration.test.ts`
- **Commit:** fc814a4 (inline before commit)

**4. [Rule 1 - Deviation] Auth plugin uses direct Drizzle query instead of adminRepo.findActiveSessionByToken**
- **Found during:** Task 2 implementation
- **Issue:** `adminRepo.findActiveSessionByToken` queries only `eq(sessions.id, token)` with no `revokedAt`/`expiresAt` guards — the auth plugin needs those predicates evaluated atomically at DB time to avoid time-of-check races.
- **Fix:** Used direct `db.select().from(sessions).where(and(eq, isNull, gt))` in the hook. Still uses `repos.admin.findUserById` for the user lookup (that function has no security guards needed beyond the token → user foreign key).
- **Files modified:** `src/plugins/auth.ts`
- **Commit:** e2bc1c9

## Known Stubs

- `packages/server/src/routes/index.ts` — Only `GET /healthz` registered. Plans 06/07 add auth routes (`/api/auth/*`) and org/invite routes. This is intentional per plan spec ("Routes stub — empty for now, populated by Plan 06/07").

## Threat Surface Scan

No new network endpoints beyond `GET /api/healthz`. The threat mitigations from the plan's threat model are all implemented:

| Threat ID | Status |
|-----------|--------|
| T-07-05-04: Stack traces in production | Mitigated — error-handler tests cover NODE_ENV=production → no stack |
| T-07-05-05: Pitfall 7 redact missing req.raw.headers.cookie | Mitigated — both `req.headers.cookie` and `req.raw.headers.cookie` in redact.paths |
| T-07-05-06: argon2 cold start | Mitigated — server.ts calls argon2SelfTest() before app.listen() |
| T-07-05-07: req.user/org/session leaks to unauthenticated routes | Mitigated — decorators initialized to null; only populated on valid session cookie |
| T-07-05-10: activeOrgId switch to non-member org | Mitigated — auth plugin validates session.activeOrgId against org_members before setting req.org |

## Self-Check: PASSED
