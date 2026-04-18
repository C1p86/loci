---
phase: 09-task-definitions-secrets-management
plan: "03"
subsystem: server/repos
tags:
  - repos
  - encryption
  - audit-log
  - mek-rotation
  - biome-fence
dependency_graph:
  requires:
    - 09-01  # schema + migrations (tasks, secrets, orgDeks, secretAuditLog tables)
    - 09-02  # crypto/secrets.ts AES-256-GCM + MEK boot + error classes
  provides:
    - makeTasksRepo factory (forOrg)
    - makeSecretsRepo factory (forOrg) with envelope encryption
    - makeSecretAuditLogRepo factory (forOrg)
    - adminRepo.getOrgDek + adminRepo.rotateMek
    - Three two-org isolation test suites
    - Biome D-37/D-38 cross-package import fences
  affects:
    - All routes calling makeRepos (now require mek arg)
    - Phase 10 dispatch (resolveByName sole plaintext path)
    - Phase 09-06 rotate-mek endpoint (rotateMek admin method)
tech_stack:
  added:
    - makeTasksRepo / makeSecretsRepo / makeSecretAuditLogRepo factory pattern
    - AES-256-GCM envelope encryption embedded in secrets repo (D-18)
    - db.transaction for D-22 same-transaction audit writes
    - SELECT FOR UPDATE via Drizzle .for('update') for rotateMek
  patterns:
    - org-scoped repo factory (db, orgId) — D-01 spine
    - PG 23505 catch → domain-specific ConflictError
    - writeSecretAuditEntry standalone helper (works with db or tx handle)
    - TEST_MEK exported from db-harness for integration tests
key_files:
  created:
    - packages/server/src/repos/tasks.ts
    - packages/server/src/repos/secrets.ts
    - packages/server/src/repos/secret-audit-log.ts
    - packages/server/src/repos/__tests__/tasks.isolation.test.ts
    - packages/server/src/repos/__tests__/secrets.isolation.test.ts
    - packages/server/src/repos/__tests__/secret-audit-log.isolation.test.ts
  modified:
    - packages/server/src/crypto/tokens.ts  # added 'tsk' | 'sec' | 'sal' prefix union
    - packages/server/src/repos/for-org.ts  # mek param + tasks/secrets/secretAuditLog entries
    - packages/server/src/repos/index.ts  # makeRepos(db, mek) signature
    - packages/server/src/repos/admin.ts  # getOrgDek + rotateMek
    - packages/server/src/test-utils/db-harness.ts  # TEST_MEK export
    - biome.json  # D-37 + D-38 overrides
    - 21 route/plugin/ws call sites  # makeRepos(db, mek) two-arg update
decisions:
  - "writeSecretAuditEntry exported as standalone helper (not method on repo) so secrets.ts and rotation logic can call it inside their own transactions without cross-repo coupling"
  - "TEST_MEK placed at module-level in db-harness.ts (not in beforeAll) so it is available as a pure import without async dependency"
  - "makeForOrg signature changed to accept mek: Buffer alongside db — cleaner than currying and matches the existing admin-repo shape"
  - "Drizzle .for('update') confirmed available in drizzle-orm 0.45.2 (PgSelectWithout.for method)"
metrics:
  duration_minutes: 6
  completed_date: "2026-04-18"
  tasks_completed: 2
  files_changed: 41
---

# Phase 09 Plan 03: org-scoped repos (tasks/secrets/audit-log) + adminRepo MEK helpers + Biome fences Summary

Three new org-scoped repo factories with AES-256-GCM envelope encryption, same-transaction audit writes (D-22), adminRepo MEK rotation with SELECT FOR UPDATE + idempotency, and Biome cross-package import fences (D-37/D-38).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | tokens prefix union + tasks/secrets/audit-log repos + mek threading | 0b85772 | 34 files (3 new repos + for-org + index + tokens + 21 route call sites + db-harness) |
| 2 | adminRepo getOrgDek+rotateMek + 3 isolation tests + Biome D-37/D-38 fence | 6df9594 | 7 files |

## New Repo Factories

### makeTasksRepo(db, orgId)

- `list()` — SELECT id, name, description, labelRequirements, createdAt, updatedAt WHERE orgId ORDER BY createdAt DESC (yamlDefinition omitted — D-10 lean list)
- `getById(taskId)` — SELECT * WHERE orgId AND id; returns row | undefined
- `create({ name, description?, yamlDefinition, labelRequirements?, createdByUserId })` — generateId('tsk'); catches PG 23505 → TaskNameConflictError; returns `{ id }`
- `update(taskId, Partial<...>)` — UPDATE with updatedAt=now(); catches 23505; returns `{ rowCount }`
- `delete(taskId)` — DELETE; returns `{ rowCount }` (0 = not found, route throws TaskNotFoundError)

### makeSecretsRepo(db, orgId, mek)

- `list()` — METADATA ONLY: id, name, createdAt, updatedAt, lastUsedAt (never ciphertext/iv/tag/aad)
- `getById(secretId)` — METADATA ONLY; returns row | undefined
- `create({ name, value, createdByUserId })` — db.transaction: getOrCreateOrgDek → encryptSecret → insert secrets row → writeSecretAuditEntry(action='create'); catches 23505 → SecretNameConflictError; returns `{ id, name }`
- `update(secretId, { value, actorUserId })` — db.transaction: lookup existing name → getOrCreateOrgDek → encryptSecret (NEW iv per SEC-02) → UPDATE secrets → writeSecretAuditEntry(action='update')
- `delete(secretId, actorUserId)` — db.transaction: lookup name → DELETE → writeSecretAuditEntry(action='delete', secretId=null tombstone)
- `resolveByName(name, actorUserId)` — SOLE plaintext path: SELECT ciphertext+iv+authTag+aad → getOrCreateOrgDek → decryptSecret → db.transaction(UPDATE lastUsedAt + writeSecretAuditEntry(action='resolve')); throws SecretNotFoundError | SecretDecryptError

### makeSecretAuditLogRepo(db, orgId)

- `list({ limit?, offset? })` — SELECT * WHERE orgId ORDER BY createdAt DESC; limit clamped to max 1000 (D-23)

### writeSecretAuditEntry (standalone helper)

Exported from `secret-audit-log.ts` — accepts `PostgresJsDatabase<any>` (works with both db and tx handles) — used by secrets.ts inside all four transaction blocks.

## adminRepo Extensions

### getOrgDek(orgId, mek)

Thin wrapper over `getOrCreateOrgDek(db, orgId, mek)`. Makes cross-org DEK access visible at the adminRepo surface for Phase 10 dispatch and rotate-mek endpoint.

### rotateMek(oldMek, newMek)

```
db.transaction(async (tx) => {
  rows = tx.select().from(orgDeks).for('update')   // SELECT FOR UPDATE
  newVersion = rows[0].mekVersion + 1
  for each row:
    if row.mekVersion >= newVersion: skip           // D-28 idempotency
    dek = unwrapDek(oldMek, row.wrappedDek, ...)
    { wrapped, iv, tag } = wrapDek(newMek, dek)
    UPDATE orgDeks SET wrappedDek, wrapIv, wrapTag, mekVersion=newVersion
    rotated++
})
return { rotated, mekVersion: newVersion }
```

Throws `MekRotationError` on any transaction failure. No crypto material in error message.

## Isolation Tests

### tasks.isolation.test.ts (5 tests)

- list scoped to orgA never returns orgB task
- getById with orgB taskId in orgA repo returns undefined
- create with same name as orgB task succeeds (names unique per-org, not globally)
- update with different org's task id returns rowCount=0
- delete with different org's task id returns rowCount=0

### secrets.isolation.test.ts (7 tests)

- list scoped to orgA never returns orgB secret
- resolveByName returns org-specific plaintext (not the other org's plaintext)
- getById with orgB secretId in orgA repo returns undefined
- list and getById return metadata only — never ciphertext/iv/authTag/aad
- create writes secret row AND audit log entry in the same transaction (D-22)
- delete writes tombstone audit entry (secretId=null, secretName preserved) (D-22+D-21)
- update produces a different IV from pre-update stored IV (SEC-02 per-op IV)

### secret-audit-log.isolation.test.ts (4 tests)

- list scoped to orgA only returns orgA entries (never orgB entries)
- list returns entries newest-first (ORDER BY created_at DESC)
- pagination: list({limit:1, offset:0}) and list({limit:1, offset:1}) return disjoint sets
- limit clamped to 1000 — list({limit:10000}) returns at most 1000 rows (D-23)

All three files match the `*.isolation.test.ts` naming convention and are auto-discovered by the existing isolation-coverage meta-test.

## Biome Import Fence Changes

Two new override blocks appended to `biome.json`:

**Override 4 (D-37)** — `includes: ["packages/server/src/**/*.ts"]`
- `"xci"` blocked: "D-37: @xci/server must import from 'xci/dsl' only, never the CLI entry point."
- `"xci/agent"` blocked: "D-37: @xci/server must not import from the agent subpath. Only 'xci/dsl' is permitted."
- `"xci/dsl"` intentionally NOT listed (allowed)

**Override 5 (D-38)** — `includes: ["packages/xci/src/**/*.ts"]`
- `"@xci/server"` blocked: "D-38: packages/xci must never import from @xci/server. Reverse dependency is forbidden."

No existing code violated these rules at time of fence activation (`grep -rn "from 'xci'" packages/server/src` returns 0 results excluding xci/dsl; `grep -rn "from '@xci/server'" packages/xci/src` returns 0 results).

## MEK Threading Call Sites

`makeRepos(db, mek)` signature change required updates to 21 files:

- `packages/server/src/plugins/auth.ts`
- `packages/server/src/routes/agents/delete.ts`, `list.ts`, `patch.ts`, `revoke.ts`, `tokens.ts`
- `packages/server/src/routes/auth/login.ts`, `logout.ts`, `request-reset.ts`, `reset.ts`, `signup.ts`, `verify-email.ts`
- `packages/server/src/routes/invites/accept.ts`
- `packages/server/src/routes/orgs/invites.ts` (4 occurrences)
- `packages/server/src/ws/handler.ts` (3 occurrences), `heartbeat.ts`

All integration test files (13) updated to import `TEST_MEK` from `db-harness.ts` and pass it as the second argument.

## D-01 Spine Verification

`grep -E "^export" packages/server/src/repos/index.ts` shows only:
- `export function makeRepos`
- `export type Repos`
- `export type AdminRepo`
- `export type ForOrgFactory`

`makeTasksRepo`, `makeSecretsRepo`, `makeSecretAuditLogRepo` are NOT exported from repos/index.ts.

## Deviations from Plan

None — plan executed exactly as written.

- Drizzle `.for('update')` was available in drizzle-orm 0.45.2 (confirmed via grep of type definitions — no fallback to raw SQL needed).
- `biome-ignore lint/suspicious/noExplicitAny` comments required in secrets.ts and secret-audit-log.ts where `tx` must be cast to `PostgresJsDatabase<any>` (matches the existing pattern in admin.ts).

## Known Stubs

None — all factories are fully implemented. No hardcoded empty values or placeholder text.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries beyond those in the plan's threat model.

## Self-Check: PASSED

- packages/server/src/repos/tasks.ts — FOUND
- packages/server/src/repos/secrets.ts — FOUND
- packages/server/src/repos/secret-audit-log.ts — FOUND
- packages/server/src/repos/__tests__/tasks.isolation.test.ts — FOUND
- packages/server/src/repos/__tests__/secrets.isolation.test.ts — FOUND
- packages/server/src/repos/__tests__/secret-audit-log.isolation.test.ts — FOUND
- Task 1 commit 0b85772 — FOUND
- Task 2 commit 6df9594 — FOUND
