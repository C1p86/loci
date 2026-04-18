---
phase: 07-database-schema-auth
plan: "03"
subsystem: server-errors-crypto-email
tags: [errors, crypto, argon2, tokens, email, fastify-env]
dependency_graph:
  requires: [07-01]
  provides: [XciServerError, generateToken, generateId, hashPassword, verifyPassword, argon2SelfTest, envSchema, createTransport, email-templates]
  affects: [07-04, 07-06]
tech_stack:
  added: ["@node-rs/argon2 (Argon2id, m=19456/t=2/p=1)", "nodemailer (SMTP transport)", "@fastify/env (JSON schema config)"]
  patterns: ["XciServerError hierarchy mirror", "oneOfEachConcrete TDD factory", "3-kind transport factory", "TS literal email templates", "HTML entity escape helper"]
key_files:
  created:
    - packages/server/src/errors.ts
    - packages/server/src/__tests__/errors.test.ts
    - packages/server/src/crypto/tokens.ts
    - packages/server/src/crypto/password.ts
    - packages/server/src/crypto/__tests__/tokens.test.ts
    - packages/server/src/crypto/__tests__/password.test.ts
    - packages/server/src/config/env.schema.ts
    - packages/server/src/email/transport.ts
    - packages/server/src/email/templates/_escape.ts
    - packages/server/src/email/templates/verify-email.ts
    - packages/server/src/email/templates/password-reset.ts
    - packages/server/src/email/templates/invite.ts
    - packages/server/src/email/templates/invite-revoked.ts
    - packages/server/src/email/templates/role-changed.ts
    - packages/server/src/email/__tests__/transport.test.ts
  modified:
    - packages/server/src/test-utils/two-org-fixture.ts
decisions:
  - "Algorithm.Argon2id ambient const enum incompatible with verbatimModuleSyntax — used literal 2 per @node-rs/argon2 index.d.ts (stable OWASP-specified value)"
  - "SMTP_PASS in createTransport uses spread pattern to avoid passing auth object when SMTP_USER undefined (avoids nodemailer auth quirks)"
  - "LOG_LEVEL added to envSchema beyond plan spec (completes Fastify config type augmentation for Plan 04 use)"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-18"
  tasks_completed: 3
  files_created: 15
  files_modified: 1
  tests_added: 50
---

# Phase 07 Plan 03: Server Error Hierarchy + Crypto + Env Schema + Email Summary

**One-liner:** XciServerError hierarchy (7 areas, 19 concretes) + Argon2id crypto + @fastify/env schema + 3-kind email transport + 5 TS-literal templates, all unit-tested and typecheck-clean.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | XciServerError hierarchy + oneOfEachConcrete tests | 5411616 | errors.ts, errors.test.ts |
| 2 | Crypto primitives (tokens + password + argon2SelfTest) | a6b0de1 | tokens.ts, password.ts, 2 test files, two-org-fixture.ts |
| 3 | Env schema + email transport + 5 templates | 5f5ac6d | env.schema.ts, transport.ts, _escape.ts, 5 templates, transport.test.ts |

## Artifact Details

### XciServerError Hierarchy (`packages/server/src/errors.ts`)

**Concrete subclasses and codes (19 total):**

| Class | Category | Code |
|-------|----------|------|
| SchemaValidationError | validation | VAL_SCHEMA |
| WeakPasswordError | validation | VAL_WEAK_PASSWORD |
| InvalidCredentialsError | authn | AUTHN_INVALID_CREDENTIALS |
| SessionRequiredError | authn | AUTHN_SESSION_REQUIRED |
| SessionExpiredError | authn | AUTHN_SESSION_EXPIRED |
| TokenInvalidError | authn | AUTHN_TOKEN_INVALID |
| EmailNotVerifiedError | authn | AUTHN_EMAIL_NOT_VERIFIED |
| OrgMembershipRequiredError | authz | AUTHZ_NOT_ORG_MEMBER |
| RoleInsufficientError | authz | AUTHZ_ROLE_INSUFFICIENT |
| CsrfTokenError | authz | AUTHZ_CSRF_INVALID |
| UserNotFoundError | notfound | NF_USER |
| OrgNotFoundError | notfound | NF_ORG |
| InviteNotFoundError | notfound | NF_INVITE |
| EmailAlreadyRegisteredError | conflict | CONFLICT_EMAIL_TAKEN |
| InviteAlreadyAcceptedError | conflict | CONFLICT_INVITE_USED |
| OwnerRoleImmutableError | conflict | CONFLICT_OWNER_IMMUTABLE |
| RateLimitExceededError | ratelimit | RATE_EXCEEDED |
| DatabaseError | internal | INT_DATABASE |
| EmailTransportError | internal | INT_EMAIL_TRANSPORT |

### Argon2id Hash Format (captured from real run)

```
$argon2id$v=19$m=19456,t=2,p=1$<22-char-salt>$<43-char-hash>
```

Typical `argon2SelfTest` timing on this dev hardware: ~125ms (well within 100-2000ms range, logs `info`).

### Env Schema Fields

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| NODE_ENV | string | No | development | enum: development/test/production |
| PORT | integer | No | 3000 | — |
| LOG_LEVEL | string | No | info | enum: fatal/error/warn/info/debug/trace |
| DATABASE_URL | string | Yes | — | pattern: ^postgres(ql)?:// |
| SESSION_COOKIE_SECRET | string | Yes | — | minLength: 32 |
| EMAIL_TRANSPORT | string | Yes | — | enum: log/stub/smtp |
| SMTP_HOST | string | No | — | required when EMAIL_TRANSPORT=smtp (runtime) |
| SMTP_PORT | integer | No | 587 | — |
| SMTP_USER | string | No | — | — |
| SMTP_PASS | string | No | — | — |
| SMTP_FROM | string | No | — | format: email; required when EMAIL_TRANSPORT=smtp (runtime) |

### Email Template Files

| Template | Factory | Key Params |
|----------|---------|------------|
| verify-email.ts | verifyEmailTemplate | link, email |
| password-reset.ts | passwordResetTemplate | link, email |
| invite.ts | inviteTemplate | link, orgName, inviterEmail, role |
| invite-revoked.ts | inviteRevokedTemplate | orgName, revokerEmail |
| role-changed.ts | roleChangedTemplate | orgName, newRole, changedByEmail |

All templates use `escapeHtml()` on every interpolated string (T-07-03-06 XSS defense).

## Test Results

```
pnpm --filter @xci/server typecheck   → exit 0 (clean)
pnpm --filter @xci/server test:unit   → 50 passed (27 errors + 12 tokens + 6 password + 5 transport)
pnpm --filter @xci/server lint        → 28 files checked, no errors
pnpm --filter xci test                → 302 passed (D-39 fence intact)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Algorithm ambient const enum incompatible with verbatimModuleSyntax**
- **Found during:** Task 2 typecheck after implementing password.ts
- **Issue:** `Algorithm.Argon2id` from `@node-rs/argon2` is declared as `const enum` in its `.d.ts`. TypeScript with `verbatimModuleSyntax: true` (from tsconfig.base.json) cannot access ambient const enums as they require inlining at compile time, which verbatimModuleSyntax forbids.
- **Fix:** Replaced `Algorithm.Argon2id` with literal `2` (Argon2id = 2 per the type definition, stable value). Added inline comment documenting the reason and source.
- **Files modified:** `packages/server/src/crypto/password.ts`
- **Commit:** a6b0de1

### Minor Divergences

**2. LOG_LEVEL added to envSchema** — The plan spec listed `NODE_ENV`, `PORT`, `EMAIL_TRANSPORT`, and `DATABASE_URL`/`SESSION_COOKIE_SECRET`. `LOG_LEVEL` was added to complete the Fastify config type augmentation needed by Plan 04 (which configures pino log level from env). Not a behavioral change.

**3. Biome import organize** — `biome check --write` reordered imports alphabetically in 6 files after Task 3 implementation. No logic changed.

## Threat Mitigations Applied

| Threat | Status |
|--------|--------|
| T-07-03-01: Password in error body | Mitigated — 0-arg InvalidCredentialsError/TokenInvalidError constructors |
| T-07-03-02: Argon2 params too weak | Mitigated — test asserts `$argon2id$v=19$m=19456,t=2,p=1$` prefix |
| T-07-03-03: Argon2 cold-start event loop | Mitigated — argon2SelfTest() implemented and tested |
| T-07-03-04: Argon2 params too slow | Mitigated — argon2SelfTest warns if >2000ms |
| T-07-03-05: verifyPassword error leak | Mitigated — try/catch returns false on malformed hash; tested |
| T-07-03-06: Stored XSS in email HTML | Mitigated — escapeHtml() applied to all interpolated template params |
| T-07-03-08: Missing SMTP_HOST silent fail | Mitigated — createTransport('smtp',...) throws EmailTransportError synchronously |

## Known Stubs

None — all exported functions are fully implemented with no placeholder values.

## Self-Check: PASSED

- `packages/server/src/errors.ts` — FOUND
- `packages/server/src/crypto/tokens.ts` — FOUND
- `packages/server/src/crypto/password.ts` — FOUND
- `packages/server/src/config/env.schema.ts` — FOUND
- `packages/server/src/email/transport.ts` — FOUND
- All 5 email templates — FOUND
- Commits 5411616, a6b0de1, 5f5ac6d — FOUND in git log
- 50 tests passing, typecheck clean, lint clean, xci fence intact
