---
phase: 09-task-definitions-secrets-management
plan: "02"
subsystem: server-crypto + server-errors + server-config
tags: [aes-256-gcm, envelope-encryption, mek, dek, env-schema, error-hierarchy, pino-redact, tdd]
dependency_graph:
  requires:
    - 09-01 (orgDeks schema with bytea columns, SecretDecryptError import path)
  provides:
    - packages/server/src/crypto/secrets.ts (5 functions: encryptSecret, decryptSecret, wrapDek, unwrapDek, getOrCreateOrgDek)
    - packages/server/src/config/env.schema.ts (XCI_MASTER_KEY + PLATFORM_ADMIN_EMAIL)
    - packages/server/src/app.ts (fastify.mek Buffer decorator + extended redact paths)
    - packages/server/src/errors.ts (7 new subclasses + TaskValidationDetail interface)
    - packages/server/src/plugins/error-handler.ts (TaskValidationError special-case)
  affects:
    - All Phase 9 plans that use fastify.mek, SecretDecryptError, TaskValidationError, or call encryptSecret/decryptSecret
tech_stack:
  added: []
  patterns:
    - AES-256-GCM with 12-byte random IV per call (NIST SP 800-38D §8.2.1)
    - setAuthTag-before-update/final call order (Pitfall 1 — verified Node 22)
    - Envelope encryption: MEK wraps DEK, DEK wraps secret value
    - Boot-time Buffer.from(base64) parsed once and decorated on FastifyInstance (Pitfall 8)
    - Zero-arg SecretDecryptError constructor — no crypto material can leak via constructor args
    - TDD RED/GREEN/REFACTOR cycle for crypto module
key_files:
  created:
    - packages/server/src/crypto/secrets.ts
    - packages/server/src/crypto/__tests__/secrets.test.ts
  modified:
    - packages/server/src/config/env.schema.ts
    - packages/server/src/app.ts
    - packages/server/src/errors.ts
    - packages/server/src/__tests__/errors.test.ts
    - packages/server/src/plugins/error-handler.ts
decisions:
  - "setAuthTag MUST precede decipher.update/final — verified by Node 22 throwing TypeError when order is reversed (Pitfall 1 from RESEARCH §FA-2)"
  - "MEK parsed once at boot as Buffer(32) via Buffer.from(XCI_MASTER_KEY, 'base64'); explicit length check throws with remediation hint (Pitfall 8)"
  - "SecretDecryptError takes zero constructor args — prevents callers from accidentally serialising key material in JSON.stringify(err)"
  - "DEK_WRAP_AAD constant string 'dek-wrap' used for all DEK wrapping; org binding is in org_deks.org_id column (D-16)"
  - "Task 3 (errors.ts) executed before Task 1 verification because error-handler.ts imports TaskValidationError — dependency ordering handled in single commit"
  - "PlatformAdminRequiredError added as 8th class (plan said 7) — plan section D-24 requires this for requirePlatformAdmin middleware in Plan 09-06"
  - "Non-null assertions replaced with explicit guards (rows[0] check, caught undefined guard) to satisfy biome noNonNullAssertion rule"
metrics:
  duration_seconds: 500
  completed_date: "2026-04-18T23:13:37Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 5
---

# Phase 9 Plan 02: Env Extension + AES-256-GCM Crypto + 7 Error Classes + Pino Redaction + MEK Boot Decorator Summary

Server-side AES-256-GCM envelope encryption substrate wired at boot: `XCI_MASTER_KEY` validated and decoded to a 32-byte `fastify.mek` Buffer; `crypto/secrets.ts` implements 5 functions with RESEARCH-verified call ordering; 8 new error subclasses (including `PlatformAdminRequiredError`) and `TaskValidationDetail` interface added; Pino redact paths extended for secrets routes; `error-handler.ts` returns `errors[]` array for `TaskValidationError`.

## Tasks Executed

### Task 1: Env schema + app.ts + error-handler (executed with Task 3 in a single commit)

**env.schema.ts changes:**
- Added `'XCI_MASTER_KEY'` and `'PLATFORM_ADMIN_EMAIL'` to `required[]`
- `XCI_MASTER_KEY` property: `type: string`, `minLength: 44`, `maxLength: 44`, `pattern: ^[A-Za-z0-9+/]{43}=$`
- `PLATFORM_ADMIN_EMAIL` property: `type: string`, `format: email`, `minLength: 3`, `maxLength: 254`
- Extended `FastifyInstance.config` TypeScript augmentation with both fields

**app.ts changes:**
- Extended `redact.paths` with: `req.body.value`, `req.body.newMekBase64`, `*.ciphertext`, `*.dek`, `*.mek`
- Added MEK boot decorator: `Buffer.from(app.config.XCI_MASTER_KEY, 'base64')` with explicit `length !== 32` guard throwing with remediation hint
- `app.decorate('mek', mek)` inserted AFTER `fastifyEnv` registers, BEFORE routes
- Extended `declare module 'fastify'` with `mek: Buffer`

**error-handler.ts:**
- Added `instanceof TaskValidationError` branch before generic `XciServerError` branch
- Returns `{ code, message, requestId, errors: err.validationErrors }` (D-11 contract)

### Task 2: crypto/secrets.ts + unit tests (TDD)

**RED commit:** `1716d31` — 9 failing tests (module not found)

**GREEN commit:** `6fef9f9` — `crypto/secrets.ts` with 5 functions; 9/9 tests pass

**Function signatures implemented:**
```typescript
encryptSecret(dek: Buffer, plaintext: string, aad: string): { ciphertext: Buffer; iv: Buffer; tag: Buffer }
decryptSecret(dek: Buffer, ciphertext: Buffer, iv: Buffer, tag: Buffer, aad: string): string
wrapDek(mek: Buffer, dek: Buffer): { wrapped: Buffer; iv: Buffer; tag: Buffer }
unwrapDek(mek: Buffer, wrapped: Buffer, iv: Buffer, tag: Buffer): Buffer
getOrCreateOrgDek(db: PostgresJsDatabase<any>, orgId: string, mek: Buffer): Promise<Buffer>
```

**9 unit tests (all passing):**
1. `encryptSecret/decryptSecret round-trip returns original plaintext`
2. `two encryptSecret calls with same inputs produce different ivs and ciphertexts (SEC-02)`
3. `decryptSecret throws SecretDecryptError when auth tag is tampered`
4. `decryptSecret throws SecretDecryptError when iv is tampered`
5. `decryptSecret throws SecretDecryptError when aad differs (cross-org tampering — D-16)`
6. `decryptSecret throws SecretDecryptError when ciphertext is tampered`
7. `wrapDek/unwrapDek round-trip returns identical DEK buffer`
8. `two wrapDek calls with same inputs produce different wrapped outputs and ivs`
9. `error message contains no plaintext, tag, or iv fragment (SEC-03 / D-10)`

**Pitfall 1 compliance:** `setAuthTag` call appears on line 55 (decryptSecret) and line 87 (unwrapDek), both strictly BEFORE `decipher.update()` and `decipher.final()`.

### Task 3: errors.ts + 7 new subclasses + oneOfEachConcrete

**New error classes (8 total — PlatformAdminRequiredError added per D-24):**

| Class | Extends | HTTP Status | Code |
|-------|---------|-------------|------|
| `TaskValidationError` | `ValidationError` | 400 | `XCI_SRV_TASK_VALIDATION` |
| `TaskNotFoundError` | `NotFoundError` | 404 | `NF_TASK` |
| `TaskNameConflictError` | `ConflictError` | 409 | `CONFLICT_TASK_NAME` |
| `SecretNotFoundError` | `NotFoundError` | 404 | `NF_SECRET` |
| `SecretNameConflictError` | `ConflictError` | 409 | `CONFLICT_SECRET_NAME` |
| `SecretDecryptError` | `InternalError` | 500 | `INT_SECRET_DECRYPT` |
| `MekRotationError` | `InternalError` | 500 | `INT_MEK_ROTATION` |
| `PlatformAdminRequiredError` | `AuthzError` | 403 | `AUTHZ_PLATFORM_ADMIN_REQUIRED` |

**TaskValidationDetail interface:**
```typescript
export interface TaskValidationDetail {
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
}
```

`oneOfEachConcrete()` extended with 8 new instances; code-uniqueness test green (33 concrete classes, all unique codes).

## Env Schema Additions

| Field | Pattern | Validation |
|-------|---------|------------|
| `XCI_MASTER_KEY` | `^[A-Za-z0-9+/]{43}=$` | minLength/maxLength 44; runtime Buffer.length check in app.ts |
| `PLATFORM_ADMIN_EMAIL` | — | format: email; minLength 3, maxLength 254 |

## Redact Paths Added

```
req.body.value          — POST/PATCH /secrets body (D-20)
req.body.newMekBase64   — POST /admin/rotate-mek body
*.ciphertext            — any object with ciphertext field
*.dek                   — any object with dek field
*.mek                   — any object with mek field (catches accidental spread of XCI_MASTER_KEY)
```

## MEK Decorator Location

Inserted in `buildApp()` after `await app.register(errorHandlerPlugin)` and before `app.decorate('agentRegistry', ...)`. Exact single parse point in the entire codebase: `Buffer.from(app.config.XCI_MASTER_KEY, 'base64')`.

## Pitfall Compliance

- **Pitfall 1 (setAuthTag order):** Verified — `setAuthTag` precedes `update`/`final` in both `decryptSecret` and `unwrapDek`.
- **Pitfall 8 (MEK Buffer once):** Verified — `grep -rn "Buffer.from.*XCI_MASTER_KEY.*base64"` returns exactly 1 match (app.ts only).

## Test Results

| Suite | Count | Status |
|-------|-------|--------|
| `src/__tests__/errors.test.ts` | 27 | PASS |
| `src/crypto/__tests__/secrets.test.ts` | 9 | PASS |
| Full `test:unit` | 80 | PASS |
| `xci` BC-01 | 328 | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] PlatformAdminRequiredError added (8th class)**
- **Found during:** Task 3
- **Issue:** Plan listed 7 new error classes but D-24 and the PATTERNS.md `requirePlatformAdmin` middleware clearly requires a `PlatformAdminRequiredError`; omitting it would leave Plan 09-06 without the error class it needs
- **Fix:** Added `PlatformAdminRequiredError extends AuthzError` with code `AUTHZ_PLATFORM_ADMIN_REQUIRED` (403)
- **Files modified:** `packages/server/src/errors.ts`, `packages/server/src/__tests__/errors.test.ts`
- **Commit:** `53e191c`

**2. [Rule 1 - Bug] TypeScript noUncheckedIndexedAccess on Buffer index mutation**
- **Found during:** Task 2 typecheck
- **Issue:** `buf[0] ^= 0xff` produces TS2532 (possibly undefined) in test file
- **Fix:** Replaced with `buf.writeUInt8(buf.readUInt8(0) ^ 0xff, 0)` for all 4 occurrences
- **Files modified:** `packages/server/src/crypto/__tests__/secrets.test.ts`
- **Commit:** `6fef9f9`

**3. [Rule 1 - Bug] Biome noNonNullAssertion in secrets.ts and secrets.test.ts**
- **Found during:** Biome check post-implementation
- **Issue:** `rows[0]!` and `caught!.message` triggered lint errors
- **Fix:** Guard pattern `const existingRow = rows[0]; if (existingRow !== undefined)` + explicit throw guard in test
- **Files modified:** `packages/server/src/crypto/secrets.ts`, `packages/server/src/crypto/__tests__/secrets.test.ts`
- **Commit:** `978ae09`

## Known Stubs

None — this plan implements foundational crypto primitives and error taxonomy. No UI-facing data flows exist in this plan.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: information_disclosure | `packages/server/src/app.ts` | `app.decorate('mek', mek)` places the raw MEK Buffer on the Fastify instance; all plugins and route handlers can access `fastify.mek`. This is intentional by design (D-13) but means any plugin that logs `fastify` object state could expose the MEK. Mitigated by Pino redact `*.mek` path. |

## Self-Check: PASSED

All 7 key files found on disk. All 4 task commits verified in git log.
