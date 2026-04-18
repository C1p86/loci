---
phase: 08-agent-registration-websocket-protocol
plan: "02"
subsystem: server-data-layer
tags: [crypto, repos, isolation, adminRepo, drizzle, timingSafeEqual]
dependency_graph:
  requires: [08-01]
  provides: [agent-repos, admin-agent-helpers, compareToken, hashToken, agent-error-classes]
  affects: [packages/server/src/crypto/tokens.ts, packages/server/src/errors.ts, packages/server/src/repos]
tech_stack:
  added: []
  patterns:
    - timingSafeEqual with length pre-check (ATOK-06 Pitfall 3)
    - sha256 hex digest for at-rest token/credential storage
    - tx revoke-before-insert for partial unique index on agent_credentials
    - cross-org adminRepo pattern extended for agent WS handshake helpers
key_files:
  created:
    - packages/server/src/repos/agents.ts
    - packages/server/src/repos/agent-credentials.ts
    - packages/server/src/repos/registration-tokens.ts
    - packages/server/src/repos/__tests__/agents.isolation.test.ts
    - packages/server/src/repos/__tests__/agent-credentials.isolation.test.ts
    - packages/server/src/repos/__tests__/registration-tokens.isolation.test.ts
    - packages/server/src/repos/__tests__/admin-agent.integration.test.ts
  modified:
    - packages/server/src/crypto/tokens.ts
    - packages/server/src/errors.ts
    - packages/server/src/__tests__/errors.test.ts
    - packages/server/src/crypto/__tests__/tokens.test.ts
    - packages/server/src/repos/admin.ts
    - packages/server/src/repos/for-org.ts
decisions:
  - "compareToken uses timingSafeEqual with byteLength pre-check per ATOK-06 Pitfall 3; returns false (not throw) on length mismatch"
  - "hashToken is sha256 hex (64 chars); plaintext crosses the boundary exactly once on creation"
  - "agent_credentials partial unique index requires tx revoke-then-insert to avoid PG 23505; makeAgentCredentialsRepo.createForAgent wraps both in db.transaction"
  - "adminRepo D-37 helpers are the ONLY entry point that bypasses org-scope at WS open; all use hashToken for comparison (no === on plaintext)"
  - "Integration tests (isolation + admin-agent) deferred to CI; Docker/testcontainers unavailable in local environment"
metrics:
  duration: ~8 minutes
  completed: 2026-04-18
  tasks_completed: 3
  files_changed: 12
---

# Phase 8 Plan 02: Server Crypto Extensions + Repos + AdminRepo Helpers Summary

Server-side data layer for agent registration: timing-safe crypto helpers, 3 org-scoped repos following Phase 7 D-01 pattern, adminRepo D-37 cross-org helpers, and 5 new error subclasses. Zero HTTP/WebSocket code — that is Plan 03.

## What Was Built

### Task 1: Crypto + Errors (commit 99d0d1a)

**`packages/server/src/crypto/tokens.ts` extensions:**
- `hashToken(plaintext)` — sha256 hex digest (64 chars); used for at-rest storage of credentials and registration tokens
- `compareToken(provided, expected)` — `timingSafeEqual` with `byteLength` pre-check; returns `false` (never throws) on length mismatch (ATOK-06 Pitfall 3)
- `generateId` prefix union extended with `'agt' | 'crd' | 'rtk'`

**`packages/server/src/errors.ts` additions (5 new subclasses):**
| Class | Base | Code |
|-------|------|------|
| `AgentTokenInvalidError` | `AuthnError` | `AUTHN_AGENT_TOKEN_INVALID` |
| `AgentRevokedError` | `AuthnError` | `AUTHN_AGENT_REVOKED` |
| `RegistrationTokenExpiredError` | `AuthnError` | `AUTHN_REGISTRATION_TOKEN_EXPIRED` |
| `AgentHandshakeTimeoutError` | `AuthnError` | `AUTHN_HANDSHAKE_TIMEOUT` |
| `AgentFrameInvalidError` | `ValidationError` | `VAL_AGENT_FRAME` |

All 5 registered in `oneOfEachConcrete()` — code-uniqueness test still passes (25 total subclasses).

**Tests:** 23 token unit tests + 27 error tests all green.

### Task 2: Three Org-Scoped Repos + forOrg Extension + Isolation Tests (commit 3aad362)

**`makeAgentsRepo(db, orgId)`** — list / getById / create / updateState / updateHostname / recordHeartbeat / delete

**`makeAgentCredentialsRepo(db, orgId)`** — createForAgent (tx revoke-then-insert to avoid PG 23505) / revokeForAgent / findActiveByAgentId

**`makeRegistrationTokensRepo(db, orgId)`** — create (returns plaintext once, stores hash) / listActive / revoke

**`for-org.ts`** extended: `agents`, `agentCredentials`, `registrationTokens` added to the returned object. None exported from `repos/index.ts` (D-01 discipline preserved).

**D-04 auto-discovery satisfied:** 3 new `*.isolation.test.ts` files exist for each repo; the meta-test filesystem walk picks them up automatically.

### Task 3: adminRepo D-37 Cross-Org Helpers + Integration Tests (commit 14ad6fd)

5 new methods on `makeAdminRepo`:
- `findValidRegistrationToken(plaintext)` — hash + WHERE consumed_at IS NULL AND expires_at > now()
- `consumeRegistrationToken(id)` — atomic UPDATE RETURNING; throws `RegistrationTokenExpiredError` if already consumed (single-use ATOK-01)
- `findActiveAgentCredential(plaintext)` — hash + WHERE revoked_at IS NULL; returns `{agentId, orgId}`
- `registerNewAgent({orgId, hostname, labels})` — tx: insert agents + agent_credentials; returns plaintext ONCE
- `issueAgentCredential(agentId, orgId)` — tx: revoke-old + insert-new; returns plaintext ONCE

All 5 helpers use `hashToken()` for DB comparisons — no `===` on plaintext.

**`admin-agent.integration.test.ts`** — 6 integration tests covering full lifecycle (token creation → validation → consumption, credential issuance → rotation, revoke).

## Verification

| Check | Result |
|-------|--------|
| `pnpm --filter @xci/server build` (typecheck) | PASS |
| `pnpm --filter @xci/server test --run` (71 unit tests) | 71/71 PASS |
| `pnpm --filter xci test --run` (BC-01/BC-02) | 302/302 PASS |
| Integration tests (isolation + admin-agent) | DEFERRED to CI (Docker unavailable locally) |
| D-04 meta-test (auto-discovery filesystem walk) | Statically verified: 9 public repo files, 9 isolation test files (3 new) |
| ATOK-06 grep: no `===` on token/credential/hash | CLEAN |

## Deviations from Plan

None — plan executed exactly as written. Integration tests are deferred to CI as documented in execution rules ("Integration tests deferred to CI Linux runner if Docker unavailable").

## Known Stubs

None — all repo functions are fully implemented. The `admin-agent.integration.test.ts` is complete but deferred to CI for execution.

## Threat Flags

None — all new surface is within the plan's threat model (T-08-02 boundaries: DB rows ↔ hashed-only crypto, cross-org adminRepo pattern, compareToken ↔ timingSafeEqual).

## Self-Check: PASSED

- packages/server/src/crypto/tokens.ts — FOUND (compareToken + hashToken + prefixes agt/crd/rtk)
- packages/server/src/repos/agents.ts — FOUND
- packages/server/src/repos/agent-credentials.ts — FOUND
- packages/server/src/repos/registration-tokens.ts — FOUND
- packages/server/src/repos/for-org.ts — FOUND (agents/agentCredentials/registrationTokens added)
- packages/server/src/repos/admin.ts — FOUND (5 D-37 helpers added)
- packages/server/src/repos/__tests__/agents.isolation.test.ts — FOUND
- packages/server/src/repos/__tests__/agent-credentials.isolation.test.ts — FOUND
- packages/server/src/repos/__tests__/registration-tokens.isolation.test.ts — FOUND
- packages/server/src/repos/__tests__/admin-agent.integration.test.ts — FOUND
- commit 99d0d1a — FOUND
- commit 3aad362 — FOUND
- commit 14ad6fd — FOUND
