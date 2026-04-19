---
phase: 09-task-definitions-secrets-management
plan: "06"
subsystem: server
tags:
  - mek-rotation
  - platform-admin
  - envelope-encryption
  - dispatch-resolver
  - phase-closeout
dependency_graph:
  requires:
    - 09-03 (adminRepo.rotateMek + unwrapDek/wrapDek)
    - 09-02 (fastify.mek + PLATFORM_ADMIN_EMAIL env + MekRotationError + PlatformAdminRequiredError)
    - 09-05 (secrets repo resolveByName — used in D-26 test)
  provides:
    - POST /api/admin/rotate-mek (SEC-08)
    - requirePlatformAdmin middleware (D-24)
    - resolveTaskParams pure function (TASK-06 / D-33)
  affects:
    - routes/index.ts (admin routes mounted)
    - test-utils/global-setup.ts (XCI_MASTER_KEY + PLATFORM_ADMIN_EMAIL now set)
    - test-utils/db-harness.ts (getTestMek() exported)
tech_stack:
  added: []
  patterns:
    - "requirePlatformAdmin: preHandler hook comparing req.user.email to PLATFORM_ADMIN_EMAIL env (case-insensitive)"
    - "rotate-mek: onRequest CSRF + preHandler [requireAuth, requirePlatformAdmin] + AJV body schema"
    - "resolveTaskParams: pure string-level regex replace with Set<string> for dedup of unresolved names"
key_files:
  created:
    - packages/server/src/plugins/require-platform-admin.ts
    - packages/server/src/routes/admin/index.ts
    - packages/server/src/routes/admin/rotate-mek.ts
    - packages/server/src/routes/admin/__tests__/rotate-mek.integration.test.ts
    - packages/server/src/services/dispatch-resolver.ts
    - packages/server/src/services/__tests__/dispatch-resolver.test.ts
    - .planning/phases/09-task-definitions-secrets-management/09-TRACEABILITY.md
  modified:
    - packages/server/src/routes/index.ts
    - packages/server/src/test-utils/global-setup.ts
    - packages/server/src/test-utils/db-harness.ts
    - packages/server/README.md
    - .planning/STATE.md
    - .planning/ROADMAP.md
decisions:
  - "Reused PlatformAdminRequiredError (added in 09-02) rather than reusing RoleInsufficientError — more precise code AUTHZ_PLATFORM_ADMIN_REQUIRED and avoids confusion with per-org role checks"
  - "rotate-mek does NOT hot-swap fastify.mek after rotation — requires server restart per runbook (T-09-06-10 accepted risk); avoids concurrency hazard with in-flight decrypts"
  - "resolveTaskParams operates on yamlDefinition string directly (not parsed CommandMap) — simpler for Phase 10 which passes the full task row; xci/dsl resolvePlaceholders (argv-level) not used"
  - "getTestMek() added to db-harness.ts to derive test MEK from process.env.XCI_MASTER_KEY — ensures makeRepos() and buildApp() use the same key during integration tests"
  - "global-setup.ts updated to set XCI_MASTER_KEY + PLATFORM_ADMIN_EMAIL — Phase 9 env vars required at buildApp() boot"
metrics:
  duration_minutes: 45
  tasks_completed: 3
  files_created: 7
  files_modified: 6
  completed_date: "2026-04-19"
---

# Phase 9 Plan 06: MEK Rotation Endpoint + Dispatch Resolver + Phase Closeout Summary

**One-liner:** AES-256-GCM MEK rotation admin endpoint with platform-admin gate (SEC-08) + pure dispatch-resolver service (TASK-06) + Phase 9 closeout artifacts.

## What Was Built

### Task 1: requirePlatformAdmin guard + rotate-mek route

**`packages/server/src/plugins/require-platform-admin.ts`**

Prehandler function that compares `req.user.email.toLowerCase()` to `fastify.config.PLATFORM_ADMIN_EMAIL.toLowerCase()`. Throws `PlatformAdminRequiredError` (403) on mismatch. Throws `SessionRequiredError` (401) if no session.

**`packages/server/src/routes/admin/rotate-mek.ts`**

POST `/rotate-mek` handler:
- `onRequest: [fastify.csrfProtection]` — CSRF gate
- `preHandler: [fastify.requireAuth, requirePlatformAdmin]` — session + platform-admin gates
- AJV body schema: `minLength: 44, maxLength: 44, pattern: '^[A-Za-z0-9+/]{43}=$'`
- Secondary Buffer length check: `newMek.length !== 32` → `MekRotationError` 500
- Calls `adminRepo.rotateMek(oldMek, newMek)` (single Postgres transaction, FOR UPDATE, idempotent)
- Returns `{rotated: N, mekVersion: V}`

**Routes/index.ts** now mounts `registerAdminRoutes` at `/admin` prefix (final path: `/api/admin/rotate-mek`).

### Integration Tests (D-26 + D-28 acceptance)

8 test cases in `routes/admin/__tests__/rotate-mek.integration.test.ts`:

1. `non-admin user (org Owner) gets 403` — RoleInsufficientError guard
2. `no session gets 401` — SessionRequiredError guard
3. `missing CSRF token gets 403` — CSRF plugin gate
4. `valid rotation returns {rotated, mekVersion}` — happy path shape
5. **D-26: plaintext unchanged through rotation** — seeds 6 secrets across 2 orgs; calls rotate-mek; rebuilds app with new MEK; calls `resolveByName()` for each secret; asserts plaintext matches pre-rotation value
6. **D-28: idempotency** — first call returns `rotated >= 1`; second identical call returns `rotated=0`
7. `invalid base64 (43 chars) returns 400` — AJV minLength
8. `wrong-pattern base64 (ends with ==) returns 400` — AJV pattern

### Task 2: dispatch-resolver service

**`packages/server/src/services/dispatch-resolver.ts`**

Pure function `resolveTaskParams(input: ResolveInput): ResolveOutput`:
- Merges `{...orgSecrets, ...runOverrides}` (D-34 precedence: runOverrides wins on collision)
- Replaces each `${VAR}` placeholder: substitutes if in merged dict, else leaves as-is
- Returns `{resolvedYaml, unresolved: readonly string[]}` — unresolved names deduplicated via Set
- Zero imports from drizzle/fastify/console — verified by lint

8 unit tests in `services/__tests__/dispatch-resolver.test.ts` — all green.

### Task 3: Phase closeout docs

- **`packages/server/README.md`** — added "Secrets & Tasks" section with API table + envelope encryption overview + MEK rotation runbook (4-step operator guide + failure handling + T-09-06-10 accepted downtime risk note)
- **`09-TRACEABILITY.md`** — 14-row requirement-to-test mapping + 5 SC coverage table
- **`ROADMAP.md`** — Phase 9 marked 6/6 Complete 2026-04-19; plan checklist all [x]
- **`STATE.md`** — progress 9/14 phases (64%); 11 Phase 9 decisions appended; session continuity updated

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] global-setup.ts missing Phase 9 env vars**
- **Found during:** Task 1 implementation
- **Issue:** `global-setup.ts` only set 4 env vars; `buildApp()` now requires `XCI_MASTER_KEY` and `PLATFORM_ADMIN_EMAIL` at boot (Phase 9 D-13/D-24). Integration tests would fail to start.
- **Fix:** Added `XCI_MASTER_KEY` (random 32-byte base64) and `PLATFORM_ADMIN_EMAIL = 'admin@xci.test'` to global-setup; added `getTestMek()` to db-harness.ts so repos and buildApp use the same MEK.
- **Files modified:** `src/test-utils/global-setup.ts`, `src/test-utils/db-harness.ts`
- **Commit:** bfd65f6

**2. [Rule 1 - Formatting] Biome formatter issues in 3 files**
- **Found during:** Task 3 verification
- **Issue:** Biome flagged formatting differences in `dispatch-resolver.ts`, `dispatch-resolver.test.ts`, `db-harness.ts`
- **Fix:** `pnpm exec biome check --write .` auto-fixed all 3 files; 0 errors remaining
- **Commit:** a4ddac0

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @xci/server exec tsc --noEmit` | PASS |
| `pnpm --filter @xci/server build` | PASS |
| `pnpm --filter @xci/server test:unit` (88 tests) | PASS |
| `pnpm --filter @xci/server lint` (0 errors) | PASS |
| `pnpm --filter xci test` (328 tests, BC-01) | PASS |
| `pnpm --filter xci build` (cli + agent + dsl) | PASS |
| SEC-04 grep gate (no plaintext in reply.send) | PASS |
| Dispatch-resolver purity check (0 DB/logger imports) | PASS |

## CI-Deferred Tests

The following tests require Docker + testcontainers and are deferred to Linux CI:

- `routes/admin/__tests__/rotate-mek.integration.test.ts` — 8 tests including D-26 + D-28 acceptance
- All existing Phase 9 integration tests (secrets CRUD, task CRUD, audit-log)

## Phase 9 ROADMAP Success Criteria

| SC | Test | Local Status |
|----|------|-------------|
| SC1: Valid YAML accepted; invalid rejected with line+suggestion | `routes/tasks/__tests__/validation.integration.test.ts` | CI-deferred |
| SC2: Secret plaintext NEVER returned by API or log | `routes/secrets/__tests__/no-plaintext-leak.integration.test.ts` | CI-deferred |
| SC3: Two encrypts → different IV+ciphertext; both decrypt | `crypto/__tests__/secrets.test.ts` | PASS (unit) |
| SC4: Agent-local wins over org-level at dispatch | v1 xci suite unchanged (BC-01) | PASS (328 tests) |
| SC5: MEK rotation re-wraps DEKs without changing plaintext | `routes/admin/__tests__/rotate-mek.integration.test.ts` D-26 | CI-deferred |

## Pending Todos

- Deploy: set `XCI_MASTER_KEY` (32-byte base64) and `PLATFORM_ADMIN_EMAIL` in production environment before starting server
- Branch protection: add `integration-tests` CI job as required status check for PRs (Phase 9 tests run there)
- Phase 10: call `resolveTaskParams` from the dispatcher (Phase 10 scope — D-33 pure function is ready)
- Phase 10: pass `db`, `orgId`, `dispatchId` to `resolveTaskParams` to trigger audit log writes for 'resolve' action (D-35 — function signature extension)

## Phase 09 — COMPLETE

All 6 plans delivered:
- 09-01: DSL subpath facade + schema migration
- 09-02: AES-256-GCM crypto + env schema + error hierarchy + pino redaction
- 09-03: forOrg repos + adminRepo DEK/MEK helpers + Biome fence
- 09-04: Task CRUD routes + 4-step D-12 validation
- 09-05: Secret CRUD routes + audit-log endpoint + SEC-04 invariant guard
- 09-06: rotate-mek admin endpoint (SEC-08) + dispatch-resolver (TASK-06) + closeout

14 requirements traced (TASK-01..06 + SEC-01..08). 5/5 ROADMAP Phase 9 success criteria covered. Phase 10 ready to plan.
