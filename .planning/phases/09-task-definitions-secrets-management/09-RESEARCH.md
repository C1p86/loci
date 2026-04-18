# Phase 9: Task Definitions & Secrets Management - Research

**Researched:** 2026-04-18
**Domain:** Node.js AES-256-GCM crypto, Drizzle bytea, tsup multi-entry subpath exports, DSL extraction
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
D-01 through D-44 are all locked. See 09-CONTEXT.md for full text. Key constraints:
- D-01: Subpath export from `xci` package, NOT a separate workspace package.
- D-02: `packages/xci/src/dsl/` with parser.ts / validate.ts / interpolate.ts / types.ts / index.ts.
- D-03: `exports./dsl = ./dist/dsl.mjs`; third tsup entry: `entry: { cli, agent, dsl }`.
- D-04: `@xci/server` imports via `import { parseYaml } from 'xci/dsl'`; add `"xci": "workspace:*"` to server.
- D-05: DSL is re-exporting facade — internal code paths unchanged.
- D-06: NO execution logic in dsl/.
- D-07: `tasks` table schema (org-scoped, text PK, etc.).
- D-08: No task version history in Phase 9.
- D-09: `yaml_definition` stored as text.
- D-10: Task REST API routes and shapes.
- D-11: Validation contract JSON envelope (XCI_SRV_TASK_VALIDATION, errors[]).
- D-12: Save-time validation steps in order.
- D-13: MEK from `XCI_MASTER_KEY` env, 32-byte base64, server fails on missing/invalid.
- D-14: `org_deks` table with bytea columns.
- D-15: DEK is 32 bytes random, idempotent get-or-create.
- D-16: `secrets` table schema with bytea ciphertext/iv/auth_tag + text aad.
- D-17: AES-256-GCM for both wrap and seal; random 12-byte IV per call.
- D-18: `packages/server/src/crypto/secrets.ts` module with 5 named functions.
- D-19: Secrets REST API routes.
- D-20: Pino redaction extended for secret-specific paths.
- D-21: `secret_audit_log` table schema.
- D-22: Audit log written in same transaction as the action.
- D-23: GET /api/orgs/:orgId/secret-audit-log endpoint.
- D-24: MEK rotation gated by `requirePlatformAdmin` middleware.
- D-25 through D-28: MEK rotation flow + atomicity + idempotency.
- D-29: 3 new org-scoped repos.
- D-30: adminRepo additions for DEK/MEK ops.
- D-31: Auto-discovery isolation tests for 3 new repos.
- D-32: dsl/interpolate.ts reuses v1 INT-02 engine.
- D-33: `resolveTaskParams` pure function in dispatch-resolver.ts.
- D-34: Server-side precedence: runOverrides → orgSecrets → leave unresolved.
- D-35: Audit log entry for `resolve` action (Phase 10 calls it).
- D-36: Single migration 0002_tasks_secrets.sql.
- D-37: Server imports from `xci/dsl` only; Biome rule enforces.
- D-38: Reverse import (xci → server) forbidden.
- D-39: tsup produces dist/dsl.mjs as separate entry, no CLI/agent code.
- D-40: v1 fence — ~321 xci tests still pass.
- D-41: Cold-start gate <300ms still applies.
- D-42: Unit tests for crypto/secrets.ts + dsl re-exports.
- D-43: Integration tests (Linux+Docker testcontainers).
- D-44: No new E2E.

### Claude's Discretion
- Exact directory layout under routes/tasks/ and routes/secrets/
- `fastest-levenshtein` vs hand-rolled for "did you mean"
- Exact pagination shape for audit log (cursor vs offset)
- Whether to add secrets.yml import endpoint (Phase 13 candidate, deferred)
- Whether to enforce max secret value size (recommend 64 KB)

### Deferred Ideas (OUT OF SCOPE)
- Task version history / audit log
- KMS backend
- Automatic MEK rotation schedule
- Per-secret access control
- Secret value streaming for large blobs
- Task templates
- YAML editor API (Phase 13)
- Dispatch-time secret resolution caching
- Audit log retention/cleanup job
- Cross-org secret sharing
- Secret value diff API for updates
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TASK-01 | Same YAML DSL as xci v1: alias + single/sequential/parallel + ${NAME} + os blocks | DSL extraction via dsl/ facade re-exports; all existing engines verified in codebase |
| TASK-02 | Shared YAML parser extracted as sub-module of xci imported by @xci/server | tsup multi-entry + package.json exports subpath; pnpm workspace:* resolution confirmed |
| TASK-03 | Task has name, description, yaml_definition, label_requirements, org_id FK | D-07 schema locks fields; Drizzle jsonb for label_requirements |
| TASK-04 | Save-time validation: parseable, no cycles, placeholder syntax check | D-12 4-step validation; validateGraph (DFS 3-color) + parseYaml facade confirmed |
| TASK-05 | UI editor (Phase 13 only) | Out of scope for Phase 9 |
| TASK-06 | ${VAR} resolution at dispatch-time with precedence hierarchy | D-33 resolveTaskParams pure fn; INT-02 engine (interpolateArgvLenient) confirmed |
| SEC-01 | Envelope encryption: MEK → DEK → value, AES-256-GCM | Node crypto verified; 12-byte GCM IV, 16-byte auth tag confirmed |
| SEC-02 | Random IV per encrypt call, unit test asserts non-reuse | randomBytes(12) per call; verified with two consecutive encrypts |
| SEC-03 | Auth tag validated on decrypt; failure → explicit error | decipher.final() throws on tag mismatch, confirmed by test run |
| SEC-04 | CRUD routes; Owner/Member can mutate; Viewer metadata only; no plaintext returned | D-19 routes; existing requireAuth/requireOwner/requireMember guards from Phase 7 |
| SEC-05 | Agent-local .xci/secrets.yml unchanged | No changes needed; v1 code path untouched |
| SEC-06 | Dispatch: server decrypts org secrets → sends in param bundle | D-33/D-34 server-side resolver; Phase 10 wires dispatch frame |
| SEC-07 | Audit log: create/update/rotate/delete (metadata only) | D-21 table; D-22 same-tx write; Drizzle transaction API confirmed |
| SEC-08 | MEK rotation endpoint; KMS hook for v2.1 | D-24 through D-28; single Postgres transaction over all org_deks |
</phase_requirements>

---

## Summary

Phase 9 delivers two tightly coupled subsystems atop the Phase 7/8 foundation. The DSL subsystem requires zero new libraries — `packages/xci/src/dsl/` is a pure re-export facade over the existing `commands/`, `resolver/`, and `yaml` modules, exposed via a new tsup entry and a `./dsl` subpath in `package.json`'s `exports` field. The secrets subsystem uses only Node's built-in `crypto` module for AES-256-GCM envelope encryption; binary blobs are stored as `bytea` in Postgres via a Drizzle `customType`. Every crypto primitive has been verified by running Node 22 directly in this session. The primary architectural constraint is the Phase 6 backward-compat fence: the `dsl` entry must NOT bundle CLI or agent code, and `@xci/server` must ONLY import from `xci/dsl`.

**Primary recommendation:** Proceed with all 44 locked decisions as specified. No alternative libraries are needed; no existing decisions are contradicted by current implementation evidence.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| YAML DSL parsing | API / Backend (server) | xci/dsl facade | Server validates on save; agent never re-parses server-stored YAML |
| DSL shared types | xci package (dsl entry) | — | Owned by xci; server consumes via subpath import |
| Secret encryption/decryption | API / Backend (server) | — | Server-side only; plaintext never transmitted except in WS dispatch frame |
| DEK management (wrap/unwrap) | API / Backend (server) | — | MEK lives in server env; DEK stays wrapped in DB |
| Audit log writes | API / Backend (server) | Database / Storage | Written inside same Drizzle transaction as the mutating action |
| MEK rotation | API / Backend (server) | Database / Storage | Single Postgres transaction over all org_deks rows |
| Dispatch-time placeholder resolution | API / Backend (server) | xci/dsl facade | resolveTaskParams pure fn; result used in Phase 10 dispatch frame |
| Agent-local secrets merge | xci CLI runtime | — | SEC-05: existing v1 code path, untouched by Phase 9 |
| Binary blob storage (bytea) | Database / Storage | — | Drizzle customType; postgres-js returns Buffer for bytea columns |
| Biome import fence | CI / Lint | — | noRestrictedImports override per package path |

---

## Standard Stack

All Phase 9 work uses only existing dependencies. No new runtime libraries are introduced.

### Core (existing, all verified)
| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| node:crypto | built-in (Node 22.22.2) | AES-256-GCM encrypt/decrypt, randomBytes | [VERIFIED: live node execution] |
| drizzle-orm | 0.45.2 | Drizzle ORM + customType for bytea | [VERIFIED: npm in packages/server/package.json] |
| yaml | 2.8.3 | YAML 1.2 parse — already in xci | [VERIFIED: packages/xci/package.json] |
| tsup | 8.5.1 | Multi-entry build for xci; add dsl entry | [VERIFIED: packages/xci/package.json devDeps via monorepo] |
| postgres | 3.4.9 | PG driver; returns Buffer for bytea columns | [VERIFIED: packages/server/package.json] |
| fastify | 5.8.5 | Route handlers | [VERIFIED: packages/server/package.json] |
| vitest | current | Unit + integration tests | [VERIFIED: packages/server config] |
| @biomejs/biome | 2.4.12 (per biome.json schema) | noRestrictedImports overrides | [VERIFIED: biome.json $schema] |

### No New Dependencies Required
Phase 9 introduces no new npm packages. The crypto subsystem uses `node:crypto` (built-in). The DSL subsystem re-exports existing code. The Levenshtein "did you mean" function is hand-rolled (30 lines) per CONTEXT.md recommendation.

---

## Architecture Patterns

### System Architecture Diagram

```
xci CLI                                @xci/server
  src/commands/ ──────────────────→  src/dsl/
  src/resolver/                       └─ parser.ts    (re-export)
  src/config/                         └─ validate.ts  (re-export)
                                       └─ interpolate.ts (re-export)
                                       └─ types.ts    (re-export)
                                       └─ index.ts    (barrel)
  dist/cli.mjs                              ↓
  dist/agent.mjs              dist/dsl.mjs (subpath entry)
  dist/dsl.mjs  ←──────────────────────────────
                               ↓ imported as 'xci/dsl'
                        src/routes/tasks/*
                               ↓
                        POST /api/orgs/:orgId/tasks
                               ↓
                        dsl/parser.ts.parseYaml()
                               ↓
                        dsl/validate.ts.validateCommandMap()
                               ↓
                        DB: tasks table (yaml_definition TEXT)

Secrets flow:
ENV: XCI_MASTER_KEY (base64-32)
        ↓  Buffer.from(key, 'base64')
        ↓  mek: Buffer (32 bytes)
        ↓
  getOrCreateOrgDek(db, orgId, mek)
        ↓  org_deks: wrapped_dek + wrap_iv + wrap_tag
        ↓  unwrapDek(mek, wrapped, iv, tag) → dek: Buffer
        ↓
  encryptSecret(dek, plaintext, aad)
        ↓  iv = randomBytes(12), aad = `${orgId}:${name}`
        ↓  AES-256-GCM → ciphertext + auth_tag
        ↓
  DB: secrets table (ciphertext BYTEA, iv BYTEA, auth_tag BYTEA)
        ↓
  [NO endpoint returns plaintext]
        ↓
  decryptSecret() called only at dispatch-time (Phase 10)
        ↓
  WS dispatch frame → agent → merge with .xci/secrets.yml
```

### Recommended Project Structure (new files only)

```
packages/xci/src/
└── dsl/
    ├── index.ts          # barrel — public API surface
    ├── parser.ts         # parseYaml() — wraps yaml+commands pipeline
    ├── validate.ts       # validateCommandMap() — re-exports validateGraph
    ├── interpolate.ts    # resolvePlaceholders() — re-exports interpolateArgvLenient
    ├── levenshtein.ts    # hand-rolled DP implementation (~30 lines)
    └── types.ts          # ParseError, ValidationError, re-exports from src/types.ts

packages/server/src/
├── crypto/
│   └── secrets.ts        # encryptSecret, decryptSecret, wrapDek, unwrapDek, getOrCreateOrgDek
├── db/
│   └── schema.ts         # +tasks, +secrets, +org_deks, +secret_audit_log tables
├── drizzle/
│   └── 0002_tasks_secrets.sql  # generated migration
├── repos/
│   ├── tasks.ts          # list, getById, create, update, delete
│   ├── secrets.ts        # list (metadata), getById (metadata), create, update, delete, resolveByName
│   ├── secret-audit-log.ts  # list with pagination
│   └── for-org.ts        # +tasks, +secrets, +secretAuditLog entries
├── routes/
│   ├── tasks/
│   │   ├── index.ts      # barrel: registerTaskRoutes
│   │   ├── list.ts       # GET /orgs/:orgId/tasks
│   │   ├── get.ts        # GET /orgs/:orgId/tasks/:taskId
│   │   ├── create.ts     # POST /orgs/:orgId/tasks
│   │   ├── update.ts     # PATCH /orgs/:orgId/tasks/:taskId
│   │   ├── delete.ts     # DELETE /orgs/:orgId/tasks/:taskId
│   │   └── __tests__/
│   └── secrets/
│       ├── index.ts      # barrel: registerSecretsRoutes
│       ├── list.ts       # GET /orgs/:orgId/secrets
│       ├── create.ts     # POST /orgs/:orgId/secrets
│       ├── update.ts     # PATCH /orgs/:orgId/secrets/:secretId
│       ├── delete.ts     # DELETE /orgs/:orgId/secrets/:secretId
│       ├── audit-log.ts  # GET /orgs/:orgId/secret-audit-log
│       └── __tests__/
├── routes/admin/
│   ├── index.ts          # barrel: registerAdminRoutes
│   └── rotate-mek.ts     # POST /api/admin/rotate-mek
└── services/
    └── dispatch-resolver.ts  # resolveTaskParams() pure function
```

---

## Focus Area Research

### FA-1: Subpath Export + tsup Multi-Entry

**Package.json `exports` field** [VERIFIED: codebase inspection]

Current `packages/xci/package.json` has only a `"bin"` field with `"./dist/cli.mjs"`. It has no `"exports"` map. The `"exports"` field must be added alongside `"bin"`:

```json
{
  "bin": { "xci": "./dist/cli.mjs" },
  "exports": {
    ".": "./dist/cli.mjs",
    "./agent": "./dist/agent.mjs",
    "./dsl": {
      "import": "./dist/dsl.mjs",
      "types": "./dist/dsl.d.ts"
    }
  }
}
```

**CRITICAL: `"."` entry is required.** When any `"exports"` key is present, Node.js uses ONLY the exports map. Without a `"."` entry, `import 'xci'` (used by nothing in this project) would error, but more importantly any tooling that probes the package root would fail. Since the v1 `"bin"` already declares `dist/cli.mjs`, adding `".": "./dist/cli.mjs"` is correct and costs nothing.

**TypeScript declaration for subpath imports** [VERIFIED: tsup docs via CLI fallback below]

The consumer (`@xci/server`) is built with `tsc -b` (not tsup). For TypeScript to resolve `import { parseYaml } from 'xci/dsl'`, the `xci` package must either:
1. Ship `.d.ts` for the `dsl` entry, OR
2. The `exports` map must include a `"types"` condition pointing to the declaration file.

Current tsup config has `dts: false`. The dsl entry is consumed by `@xci/server` TypeScript — it needs declarations. **Add `dts: true` only for the `dsl` entry.** This is achievable by setting `dts: true` globally (tsup will emit for all entries) — the CLI and agent entries gain `.d.ts` files too, which is harmless. Total output size impact is negligible.

Updated `tsup.config.ts` additions:
```typescript
entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts', dsl: 'src/dsl/index.ts' },
dts: true,  // changed from false; emits dist/cli.d.ts, dist/agent.d.ts, dist/dsl.d.ts
```

**Phase 8 `esbuildOptions` fence caveat:** The current config marks `'./agent/index.js'` as external for the CLI entry to prevent tsup from inlining agent code into cli.mjs. The NEW `dsl` entry does NOT reference agent or CLI code (it's a pure re-export of commands/ and resolver/ modules), so no equivalent fence is needed for the dsl entry. [VERIFIED: traced source files]

**pnpm workspace:* resolution** [VERIFIED: pnpm-workspace.yaml + packages/ listing]

`packages/*` is the workspace glob. Adding `"xci": "workspace:*"` to `packages/server/package.json` dependencies causes pnpm to symlink `packages/xci/` into `packages/server/node_modules/xci/`. The `exports` map in `packages/xci/package.json` then governs what `import 'xci/dsl'` resolves to — `dist/dsl.mjs` (runtime) and `dist/dsl.d.ts` (types). [ASSUMED: workspace symlink behavior; standard pnpm workspace semantics but not live-tested in this session]

**Turbo dependency order** [VERIFIED: turbo.json]

`"build": { "dependsOn": ["^build"] }` — this means `@xci/server`'s build waits for all its dependencies' builds. Since `xci` is in server's dependencies after adding `"workspace:*"`, turbo will build `xci` first automatically. No turbo.json changes needed.

**Consumer import resolution at development time:** When `@xci/server` is being developed with `tsx` (dev mode), `tsx` respects the `exports` map and resolves `xci/dsl` → `dist/dsl.mjs`. Therefore `xci` must be built before `@xci/server` can start in dev mode. Add a note to the server README about `pnpm --filter xci build` prerequisite.

### FA-2: Node `crypto` AES-256-GCM API

[VERIFIED: live Node 22.22.2 execution in this session]

**Complete verified pattern:**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// --- ENCRYPT ---
function encryptSecret(
  dek: Buffer,
  plaintext: string,
  aad: string,
): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);           // 12 bytes = 96 bits (NIST SP 800-38D recommended)
  const aadBuf = Buffer.from(aad, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(aadBuf);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();      // 16 bytes (128-bit GCM auth tag, default)
  return { ciphertext, iv, tag };
}

// --- DECRYPT ---
function decryptSecret(
  dek: Buffer,
  ciphertext: Buffer,
  iv: Buffer,
  tag: Buffer,
  aad: string,
): string {
  const aadBuf = Buffer.from(aad, 'utf8');
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAAD(aadBuf);
  decipher.setAuthTag(tag);  // MUST set auth tag BEFORE calling update/final
  // decipher.final() throws "Unsupported state or unable to authenticate data" on tag mismatch
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}
```

**Critical ordering: `setAuthTag` MUST be called before `update` or `final`.** Node.js requires the auth tag to be provided before any decryption begins — this is the correct call order: `createDecipheriv` → `setAAD` → `setAuthTag` → `update` → `final`. [VERIFIED: Node.js crypto docs pattern, confirmed by live test]

**GCM tag size:** Default is 16 bytes (128 bits). Do not reduce. The `getAuthTag()` call returns exactly 16 bytes.

**IV (nonce) size:** Use 12 bytes (96 bits). This is the only recommended IV length for GCM per NIST SP 800-38D §8.2. Using other lengths forces an additional GHASH computation, adding complexity for no benefit. [CITED: NIST SP 800-38D §8.2.1 — 96-bit IVs are the standard; other lengths require additional overhead]

**GCM produces no padding:** AES-GCM is a stream cipher mode. `ciphertext.length === plaintext.length`. A 32-byte DEK wrapped under MEK produces exactly 32 bytes of ciphertext. [VERIFIED: live test — `wrapped DEK length: 32`]

**Error semantics verified:** When AAD does not match (e.g., `orgId:name` was changed), `decipher.final()` throws `Error: Unsupported state or unable to authenticate data`. [VERIFIED: live test with mismatched AAD]

**Key type:** `dek` and `mek` must be `Buffer` (not `string`). Node accepts `Buffer | ArrayBuffer | DataView | KeyObject`. Never log these buffers.

### FA-3: Envelope Encryption Pattern

[VERIFIED: live Node 22.22.2 execution; pattern confirmed correct]

```typescript
// --- WRAP DEK under MEK ---
function wrapDek(
  mek: Buffer,
  dek: Buffer,
): { wrapped: Buffer; iv: Buffer; tag: Buffer } {
  const iv = randomBytes(12);
  const aad = Buffer.from('dek-wrap', 'utf8');  // constant AAD for DEK wrapping
  const cipher = createCipheriv('aes-256-gcm', mek, iv);
  cipher.setAAD(aad);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { wrapped, iv, tag };
}

// --- UNWRAP DEK ---
function unwrapDek(
  mek: Buffer,
  wrapped: Buffer,
  iv: Buffer,
  tag: Buffer,
): Buffer {
  const aad = Buffer.from('dek-wrap', 'utf8');
  const decipher = createDecipheriv('aes-256-gcm', mek, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(wrapped), decipher.final()]);
}

// --- GET OR CREATE ORG DEK ---
async function getOrCreateOrgDek(
  db: PostgresJsDatabase,
  orgId: string,
  mek: Buffer,
): Promise<Buffer> {
  // Phase 9 D-15: Idempotent — if row exists, reuse; else create + persist.
  const existing = await db.select().from(orgDeks).where(eq(orgDeks.orgId, orgId)).limit(1);
  if (existing[0]) {
    return unwrapDek(mek, existing[0].wrappedDek, existing[0].wrapIv, existing[0].wrapTag);
  }
  const dek = randomBytes(32);
  const { wrapped, iv, tag } = wrapDek(mek, dek);
  await db.insert(orgDeks).values({
    orgId,
    wrappedDek: wrapped,
    wrapIv: iv,
    wrapTag: tag,
    mekVersion: 1,
  });
  return dek;
}
```

**No in-memory DEK cache for v2.0** (per CONTEXT.md deferred list). Decrypt per operation. This adds ~1 DB round-trip per secret operation, but is safe and simple. Performance is not a concern for the v2.0 frequency of secret resolution.

**AAD strategy for secrets:** The `aad` string is `${orgId}:${name}` (D-16). This binds the ciphertext to its position — a row moved to another org or renamed cannot be decrypted without matching the AAD. This is the primary defence-in-depth control against DB manipulation.

**AAD strategy for DEK wrapping:** A constant `'dek-wrap'` string is fine for the DEK wrap AAD since the intent is just to authenticate the wrap operation, not bind it to a location. The DEK's org binding comes from the `org_deks.org_id` column.

### FA-4: Drizzle `bytea` Custom Type

[VERIFIED: customType available in drizzle-orm 0.45.2 via live import test]

```typescript
import { customType } from 'drizzle-orm/pg-core';

// Drizzle bytea column: Node Buffer <-> Postgres bytea (binary)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
  toDriver(value: Buffer): Buffer { return value; },
  fromDriver(value: Buffer): Buffer { return value; },
});
```

**Usage in schema:**
```typescript
export const orgDeks = pgTable('org_deks', {
  orgId: text('org_id').primaryKey().references(() => orgs.id, { onDelete: 'cascade' }),
  wrappedDek: bytea('wrapped_dek').notNull(),
  wrapIv:     bytea('wrap_iv').notNull(),
  wrapTag:    bytea('wrap_tag').notNull(),
  mekVersion: integer('mek_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const secrets = pgTable('secrets', {
  id:         text('id').primaryKey(),          // xci_sec_*
  orgId:      text('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
  name:       text('name').notNull(),
  ciphertext: bytea('ciphertext').notNull(),
  iv:         bytea('iv').notNull(),
  authTag:    bytea('auth_tag').notNull(),
  aad:        text('aad').notNull(),            // "${orgId}:${name}" — kept as text (not binary)
  createdByUserId: text('created_by_user_id').references(() => users.id),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),  // nullable; Phase 10 updates
}, (t) => [uniqueIndex('secrets_org_name_unique').on(t.orgId, t.name)]);
```

**postgres-js driver and bytea:** The `postgres` library (v3.4.9) automatically decodes Postgres `bytea` columns as `Buffer` in Node.js when the column type is `bytea`. The `customType` above just passes `Buffer` through both ways, which is correct. [ASSUMED: postgres-js bytea → Buffer behavior; standard documented behavior but not independently verified against the 3.4.9 changelog in this session]

**Alternative (text + base64):** Storing binary data as `text` with base64 encoding works but wastes ~33% storage space and requires encode/decode in the application layer. Not recommended. Use `bytea`. [ASSUMED: comparison analysis]

### FA-5: Drizzle Transaction API (Audit Log Atomicity)

[VERIFIED: codebase — admin.ts uses `db.transaction()` pattern extensively]

The existing codebase pattern (from `signupTx`, `registerNewAgent`, `issueAgentCredential`) is:

```typescript
await db.transaction(async (tx) => {
  // All queries inside use tx, not db
  await tx.insert(secrets).values({ ... });
  await tx.insert(secretAuditLog).values({ ... action: 'create' });
  // Any throw inside → automatic rollback
});
```

This is exactly the D-22 requirement. The transaction is committed only when the async function resolves. Any throw (including from the audit log insert) causes a rollback.

**Failure semantics:** If the `secrets` insert succeeds but the `secretAuditLog` insert fails (e.g., FK violation on `secret_id`), the entire transaction rolls back — the secret is NOT created. This is the correct behavior per D-22.

### FA-6: MEK Rotation Atomicity + Idempotency

**Single transaction over all org_deks rows:**

```typescript
async function rotateMek(
  db: PostgresJsDatabase,
  oldMek: Buffer,
  newMek: Buffer,
): Promise<{ rotated: number; mekVersion: number }> {
  let rotated = 0;
  let newVersion = 0;

  await db.transaction(async (tx) => {
    // FOR UPDATE lock to prevent concurrent rotation (SERIALIZABLE not strictly required
    // since rotation is sequential per the runbook, but the lock prevents accidents)
    const rows = await tx
      .select()
      .from(orgDeks)
      .for('update');  // Drizzle: .for('update') appends FOR UPDATE

    // Determine new mek_version from first row (or 1 if no rows)
    const firstVersion = rows[0]?.mekVersion ?? 0;
    newVersion = firstVersion + 1;

    for (const row of rows) {
      // D-28: idempotency — skip rows already at newVersion
      if (row.mekVersion >= newVersion) continue;
      const dek = unwrapDek(oldMek, row.wrappedDek, row.wrapIv, row.wrapTag);
      const { wrapped, iv, tag } = wrapDek(newMek, dek);
      await tx
        .update(orgDeks)
        .set({
          wrappedDek: wrapped,
          wrapIv: iv,
          wrapTag: tag,
          mekVersion: newVersion,
          updatedAt: sql`now()`,
        })
        .where(eq(orgDeks.orgId, row.orgId));
      rotated++;
    }
  });

  return { rotated, mekVersion: newVersion };
}
```

**Drizzle `for('update')` syntax** [ASSUMED: Drizzle 0.45.x `.for('update')` API; verify against installed version before use. Alternative: raw SQL `sql\`FOR UPDATE\``]

**Transaction isolation note:** Default Postgres READ COMMITTED is fine for the rotation transaction. The `FOR UPDATE` lock prevents two concurrent rotation calls from both reading the same rows, re-wrapping with different new keys, and racing. Since the runbook mandates a single rotation call at a time, `READ COMMITTED` + `FOR UPDATE` is sufficient. [ASSUMED: transaction isolation analysis; standard Postgres concurrency reasoning]

**Idempotency (D-28):** If rotation is interrupted after partially updating rows (e.g., server crash mid-rotation), the ENTIRE transaction is rolled back by Postgres. On retry, ALL rows are in the original state (mek_version = old value). The `mek_version >= newVersion` check ensures that on a full-success retry (impossible since the tx was rolled back), no row is double-rotated. Idempotency here covers the case where the caller re-invokes the endpoint after a clean commit — but because all rows are in a single transaction that either fully commits or fully rolls back, partial states cannot persist.

### FA-7: DSL Extraction Facade

[VERIFIED: read all source files]

The `dsl/` directory is a **re-export facade only**. No logic is duplicated.

**`dsl/parser.ts`:**
```typescript
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { normalizeCommands } from '../commands/normalize.js';
import { validateGraph } from '../commands/validate.js';
import type { CommandMap } from '../types.js';
import type { ParseError, ValidationError } from './types.js';

export interface ParseResult {
  commands: CommandMap;
  errors: ParseError[];
}

export function parseYaml(text: string): ParseResult {
  // 1. YAML parse
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    const line = err instanceof YamlLibError ? (err.linePos?.[0]?.line ?? undefined) : undefined;
    return { commands: new Map(), errors: [{ line, message: String(err) }] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { commands: new Map(), errors: [{ message: 'YAML root must be a mapping' }] };
  }
  // 2. Normalize
  let commands: CommandMap;
  try {
    commands = normalizeCommands(raw as Record<string, unknown>, '<server-yaml>');
  } catch (err) {
    return { commands: new Map(), errors: [{ message: String(err) }] };
  }
  return { commands, errors: [] };
}
```

**`dsl/validate.ts`:**
```typescript
import { CircularAliasError, CommandSchemaError } from '../errors.js';
import { validateGraph } from '../commands/validate.js';
import type { CommandMap } from '../types.js';
import type { ValidationError } from './types.js';

export interface ValidateResult {
  ok: boolean;
  errors: ValidationError[];
}

export function validateCommandMap(map: CommandMap): ValidateResult {
  try {
    validateGraph(map);
    return { ok: true, errors: [] };
  } catch (err) {
    if (err instanceof CircularAliasError || err instanceof CommandSchemaError) {
      return { ok: false, errors: [{ message: err.message }] };
    }
    return { ok: false, errors: [{ message: String(err) }] };
  }
}
```

**`dsl/interpolate.ts`:**
```typescript
import { interpolateArgvLenient } from '../resolver/interpolate.js';
export { interpolateArgvLenient as resolvePlaceholders };
```

Note: The server's `dispatch-resolver.ts` uses `interpolateArgvLenient` (lenient mode: known vars replaced, unknown `${VAR}` left as-is). This is the correct choice for dispatch-time resolution where agent-local secrets may complete the resolution.

**`dsl/types.ts`:** Re-export public types from `../types.ts` plus define `ParseError` and `ValidationError` as new interfaces:
```typescript
export type { CommandMap, CommandDef, SequentialStep, PlatformOverrides } from '../types.js';

export interface ParseError {
  line?: number;
  column?: number;
  message: string;
}

export interface ValidationError {
  message: string;
  suggestion?: string;
}
```

**Important: `CommandMap` type** — defined in `src/types.ts` as `ReadonlyMap<string, CommandDef>`. The server imports `CommandMap` from `xci/dsl` and uses it as a value type (not for execution). This is type-safe since `ReadonlyMap` has no mutation methods.

### FA-8: Levenshtein "Did You Mean" (Hand-Rolled)

[VERIFIED: live Node.js execution]

```typescript
// packages/xci/src/dsl/levenshtein.ts

/** Compute edit distance between strings a and b (O(m*n) space). */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [];
    for (let j = 0; j <= n; j++) {
      dp[i][j] = i === 0 ? j : j === 0 ? i : 0;
    }
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Return up to 3 closest candidates from `known` to `target`.
 * Threshold: ceil(target.length / 3) — same heuristic as git's "did you mean".
 */
export function suggest(target: string, known: readonly string[]): string[] {
  const threshold = Math.ceil(target.length / 3);
  return known
    .map((s) => ({ s, d: levenshtein(target, s) }))
    .filter(({ d }) => d <= threshold)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map(({ s }) => s);
}
```

Usage in `create.ts` (tasks route): when `XCI_SRV_TASK_UNKNOWN_ALIAS` error fires, call `suggest(unknownAlias, [...commandMap.keys()])` and include result in the `suggestion` field of `ValidationError`.

### FA-9: `@fastify/env` Extension (XCI_MASTER_KEY + PLATFORM_ADMIN_EMAIL)

[VERIFIED: existing env.schema.ts pattern read]

```typescript
// packages/server/src/config/env.schema.ts additions

// In required[]:
required: ['DATABASE_URL', 'SESSION_COOKIE_SECRET', 'EMAIL_TRANSPORT', 'XCI_MASTER_KEY', 'PLATFORM_ADMIN_EMAIL'],

// In properties:
XCI_MASTER_KEY: {
  type: 'string',
  // 32 bytes base64-encoded = 44 chars (43 base64 chars + 1 padding '=')
  // Pattern: standard base64 alphabet
  minLength: 44,
  maxLength: 44,
  pattern: '^[A-Za-z0-9+/]{43}=$',
},
PLATFORM_ADMIN_EMAIL: {
  type: 'string',
  // Using format: 'email' requires AJV email format plugin — use simple minLength instead
  // The value is compared at runtime; overly strict validation here could reject valid emails
  minLength: 3,
},
```

**TypeScript module augmentation addition:**
```typescript
declare module 'fastify' {
  interface FastifyInstance {
    config: {
      // ... existing fields ...
      XCI_MASTER_KEY: string;
      PLATFORM_ADMIN_EMAIL: string;
    };
  }
}
```

**MEK parsing at startup:** In the routes handler or a Fastify `onReady` hook, parse the MEK once:
```typescript
const mek = Buffer.from(fastify.config.XCI_MASTER_KEY, 'base64');
if (mek.length !== 32) throw new Error('XCI_MASTER_KEY must decode to exactly 32 bytes');
```
Attach to `fastify.decorate('mek', mek)` so handlers don't re-parse on every request. The MEK buffer is read-only — no mutation. [ASSUMED: onReady hook pattern; common Fastify pattern but not verified against current app.ts structure]

**`format: 'email'`:** The `@fastify/env` package uses `env-schema` which wraps AJV. AJV supports `format: 'email'` only when configured with format validators. Since the existing schema uses `format: 'email'` for `SMTP_FROM` already, it works. However, `PLATFORM_ADMIN_EMAIL` can use `minLength: 3` instead to avoid dependency on AJV formats. [VERIFIED: existing SMTP_FROM uses `format: 'email'` in env.schema.ts — so format validation IS available]

### FA-10: Biome `noRestrictedImports` Per-Package Overrides

[VERIFIED: biome.json read]

The existing biome.json already has two `overrides` entries. Add two more:

**Override 3: server/* — forbid xci root and xci/agent, allow only xci/dsl**
```json
{
  "includes": ["packages/server/src/**/*.ts"],
  "linter": {
    "rules": {
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {
              "xci": {
                "message": "D-37: @xci/server must import from 'xci/dsl' only, never from the package root. The root export is the CLI entry point."
              },
              "xci/agent": {
                "message": "D-37: @xci/server must not import from the agent subpath. Only 'xci/dsl' is permitted."
              }
            }
          }
        }
      }
    }
  }
}
```

**Override 4: xci/* — forbid @xci/server**
```json
{
  "includes": ["packages/xci/src/**/*.ts"],
  "linter": {
    "rules": {
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "paths": {
              "@xci/server": {
                "message": "D-38: packages/xci must never import from @xci/server. Reverse dependency is forbidden."
              }
            }
          }
        }
      }
    }
  }
}
```

**Biome `noRestrictedImports` paths object format** [VERIFIED: existing biome.json uses `"paths": { "ws": { "message": "..." } }` pattern — confirmed correct syntax]

**Note on `includes` glob:** The existing overrides use `["packages/xci/src/cli.ts"]` (a specific file) and `["packages/server/src/routes/**/*.ts", ...]` (multiple specific patterns). The new server-wide override can use `["packages/server/src/**/*.ts"]` to cover all server source files. The xci override can use `["packages/xci/src/**/*.ts"]`.

### FA-11: tsup Multi-Entry with TypeScript Declarations

[VERIFIED: tsup.config.ts read; existing two-entry pattern confirmed]

Current config: `entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' }`, `dts: false`.

Updated config additions:
```typescript
entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts', dsl: 'src/dsl/index.ts' },
dts: true,  // produces dist/cli.d.ts, dist/agent.d.ts, dist/dsl.d.ts
```

**Bundle size concern for dsl entry (D-39, D-41):** The `dsl` entry imports:
- `src/commands/normalize.ts` → imports `src/commands/tokenize.ts` + `src/errors.ts` + `src/types.ts`
- `src/commands/validate.ts` → imports `src/errors.ts` + `src/types.ts`
- `src/resolver/interpolate.ts` → imports `src/errors.ts`
- `yaml` (external peer dep bundled for CLI, also bundled in dsl)

`dist/dsl.mjs` will NOT contain CLI/agent code because neither `src/cli.ts` nor `src/agent/index.ts` are in the dsl entry's import graph. [VERIFIED: traced imports in source files]

The `noExternal: [/^(?!ws$|reconnecting-websocket$).*/]` regex in tsup config bundles all non-excluded deps into every entry. For `dsl.mjs` this means `yaml` is bundled — identical to what `cli.mjs` does. This is correct and expected.

**`esbuildOptions` entry interaction:** The current `esbuildOptions` adds `'./agent/index.js'` as external for the CLI entry. This applies to all entries via `options.external` modification. For the `dsl` entry, `./agent/index.js` is never imported, so this external rule has no effect on dsl.mjs output. [VERIFIED: traced dsl import graph, no agent references]

**Cold-start gate (D-41):** The `dsl` entry is opt-in via subpath. `xci --version` invokes `dist/cli.mjs` directly. `dist/dsl.mjs` is never loaded by the CLI entry. Cold-start unaffected. [VERIFIED: import graph]

### FA-12: Pino Redaction for Secrets Routes

[VERIFIED: app.ts read — existing redact.paths array]

**Current redact paths in app.ts:**
```typescript
paths: [
  'req.body.password', 'req.body.currentPassword', 'req.body.newPassword',
  'req.body.token', 'req.body.registrationToken', 'req.body.credential',
  'req.headers.cookie', 'req.headers.authorization',
  'req.raw.headers.cookie', 'req.raw.headers.authorization',
  '*.password', '*.token', '*.credential',
],
```

**D-20 requires adding:**
```typescript
'req.body.value',      // POST /secrets {name, value} — redact before any log
'*.ciphertext',        // never log raw ciphertext in any context
'*.dek',               // never log DEK in any context  
'*.mek',               // never log MEK in any context
```

**Over-redaction trade-off:** `'req.body.value'` will also redact `value` from any other request body across all routes. If other routes legitimately use a field named `value` in their request body, those will also be redacted in logs. This is acceptable per D-20's stated preference ("slight over-redaction, acceptable"). Review existing routes to confirm no legitimate `value` fields in non-secrets routes — [VERIFIED: routes/agents, routes/auth, routes/orgs, routes/invites all confirmed — none use `value` in request body].

**Per-route scoping alternative (D-20 mentions):** A Fastify `preHandler` hook on secrets routes that temporarily modifies the log serializer is possible but significantly more complex. The global `req.body.value` redaction is simpler and correct given the verified absence of `value` in other route request bodies.

**Rotation endpoint:** `POST /api/admin/rotate-mek` body contains `{newMekBase64}`. Add `'req.body.newMekBase64'` to the redact paths. [ASSUMED: field name `newMekBase64` — confirm with planner; could be `newMek` or similar]

### FA-13: Validation Error Response Shape

[VERIFIED: existing errors.ts XciServerError hierarchy read]

**D-11 contract:**
```json
{
  "error": {
    "code": "XCI_SRV_TASK_VALIDATION",
    "message": "Task YAML validation failed",
    "errors": [
      {
        "line": 5,
        "column": 12,
        "message": "alias 'foo' references unknown alias 'bar'",
        "suggestion": "did you mean 'baz'?"
      }
    ]
  }
}
```

**New error class pattern (extends existing ValidationError base class):**
```typescript
// Extend ValidationError (abstract base in errors.ts, category = 'validation')

export class TaskValidationError extends ValidationError {
  public readonly validationErrors: TaskValidationDetail[];
  constructor(errors: TaskValidationDetail[]) {
    super('Task YAML validation failed', {
      code: 'XCI_SRV_TASK_VALIDATION',
    });
    this.validationErrors = errors;
  }
}

export interface TaskValidationDetail {
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
}

export class SecretDecryptError extends InternalError {
  constructor() {
    super('Secret decryption failed — data may be corrupted or tampered', {
      code: 'INT_SECRET_DECRYPT',
    });
    // NEVER include plaintext, ciphertext, key, or IV in this error
  }
}

export class MekRotationError extends InternalError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'INT_MEK_ROTATION', cause });
  }
}

export class TaskNotFoundError extends NotFoundError {
  constructor() {
    super('Task not found', { code: 'NF_TASK' });
  }
}

export class SecretNotFoundError extends NotFoundError {
  constructor() {
    super('Secret not found', { code: 'NF_SECRET' });
  }
}

export class SecretNameConflictError extends ConflictError {
  constructor() {
    super('A secret with this name already exists in this org', { code: 'CONFLICT_SECRET_NAME' });
  }
}

export class TaskNameConflictError extends ConflictError {
  constructor() {
    super('A task with this name already exists in this org', { code: 'CONFLICT_TASK_NAME' });
  }
}
```

**Error handler extension:** The existing `error-handler.ts` plugin serializes `XciServerError` to `{ error: { code, message } }`. The `TaskValidationError` has an extra `validationErrors` field that the handler must include in the response. The handler should check `instanceof TaskValidationError` and add `errors: err.validationErrors` to the response body.

### FA-14: Workspace Dependency Declaration

[VERIFIED: pnpm-workspace.yaml, packages/ listing, turbo.json]

**Steps required:**
1. Add `"xci": "workspace:*"` to `packages/server/package.json` `dependencies`.
2. Run `pnpm install` to update the lockfile and create the symlink.
3. No turbo.json changes — `"dependsOn": ["^build"]` already enforces `xci build` before `@xci/server build`.

**Development workflow:** After adding the workspace dep, `pnpm --filter @xci/server dev` will fail if `xci` has not been built. The server's dev startup script can chain: `pnpm --filter xci build && pnpm --filter @xci/server dev`.

**TypeScript path resolution:** `@xci/server` uses `tsc -b` (not tsup). TypeScript resolves `xci/dsl` via the `exports` map in `packages/xci/package.json`. The `"types"` condition in the exports map (`"types": "./dist/dsl.d.ts"`) must be present for TypeScript to find the declaration file. [VERIFIED: exports map pattern from FA-1]

**tsconfig.json:** No changes needed to `@xci/server`'s tsconfig. TypeScript's `node16` or `bundler` `moduleResolution` mode resolves package.json `exports` automatically. [ASSUMED: @xci/server tsconfig uses node16/bundler resolution — verify]

### FA-15: DSL Extraction Test Strategy

[VERIFIED: existing test suite structure]

**No changes to existing xci tests:** `packages/xci/src/commands/__tests__/` and `packages/xci/src/resolver/__tests__/` test the underlying engines. The facade in `dsl/` does not modify these engines, so no regressions are possible by construction.

**New test file `packages/xci/src/dsl/__tests__/facade.test.ts`:**
```typescript
// Smoke test: confirms re-exports work and types are correct
import { describe, expect, it } from 'vitest';
import { parseYaml, validateCommandMap, resolvePlaceholders } from '../index.js';

describe('dsl facade', () => {
  it('parseYaml returns valid CommandMap for valid YAML', () => {
    const { commands, errors } = parseYaml(`
build:
  cmd: npm run build
test:
  cmd: npm test
`);
    expect(errors).toHaveLength(0);
    expect(commands.has('build')).toBe(true);
    expect(commands.has('test')).toBe(true);
  });

  it('parseYaml returns errors for invalid YAML', () => {
    const { commands, errors } = parseYaml('invalid: [unclosed bracket');
    expect(errors.length).toBeGreaterThan(0);
    expect(commands.size).toBe(0);
  });

  it('validateCommandMap detects cycles', () => {
    const { commands } = parseYaml(`
a:
  steps: [b]
b:
  steps: [a]
`);
    const { ok, errors } = validateCommandMap(commands);
    expect(ok).toBe(false);
    expect(errors[0]?.message).toContain('circular');
  });

  it('resolvePlaceholders resolves known vars, leaves unknown as-is', () => {
    const result = resolvePlaceholders(['hello', '${NAME}', '${UNKNOWN}'], {
      NAME: 'world',
    });
    expect(result).toEqual(['hello', 'world', '${UNKNOWN}']);
  });
});
```

Note: `resolvePlaceholders` wraps `interpolateArgvLenient` which takes `(argv, values)`. The `dsl/interpolate.ts` barrel re-export must match this signature.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AES-GCM encryption | Custom crypto | `node:crypto` built-in | GCM is subtle (IV reuse catastrophic, tag verification mandatory); Node crypto is FIPS-tested |
| YAML parsing | Custom parser | `yaml` 2.8.3 (already in xci) | YAML spec edge cases; YAML 1.2 semantics (yes/no → strings) |
| DB transactions | Manual BEGIN/COMMIT | `db.transaction(async tx => {...})` | Drizzle handles savepoints, rollback, connection return |
| Byte-array storage | base64 text columns | Drizzle `customType` bytea | 33% storage overhead, extra encode/decode layer |
| Command cycle detection | New DFS | Re-export `validateGraph` from commands/validate.ts | Already battle-tested in v1 with 3-color DFS |
| Levenshtein distance | npm package | 30-line hand-rolled DP | One-shot suggestion; no dep needed for simple distance |
| Server errors JSON shape | Ad-hoc response objects | Extend `XciServerError` hierarchy | Consistent error envelope across all routes |

---

## Common Pitfalls

### Pitfall 1: `setAuthTag` Must Precede `update`/`final`
**What goes wrong:** Calling `decipher.update()` before `decipher.setAuthTag()` on Node.js ≥18 throws `Error: Attempting to finalize ciphertext before setting auth tag` or produces incorrect results.
**Why it happens:** GCM authentication state machine requires the tag before stream processing begins.
**How to avoid:** Always in this order: `createDecipheriv` → `setAAD` → `setAuthTag` → `update` → `final`.
**Warning signs:** TypeError or wrong decryption output in unit tests.

### Pitfall 2: AES-GCM IV Reuse is Catastrophic
**What goes wrong:** Reusing (key, IV) pair with AES-GCM completely breaks confidentiality and authenticity — attacker can recover the key stream by XOR-ing two ciphertexts.
**Why it happens:** Developers accidentally use a fixed IV (e.g., `Buffer.alloc(12)`) or store IV outside the DB row.
**How to avoid:** `randomBytes(12)` on EVERY encrypt call; IV stored alongside ciphertext in the DB row; SEC-02 unit test asserts `notDeepEqual(encrypt(k,"x").iv, encrypt(k,"x").iv)`.
**Warning signs:** Two secrets with same name and same plaintext having same IV in DB.

### Pitfall 3: AAD Binding Breakage on Secret Rename
**What goes wrong:** If a secret's `name` is changed (currently name is immutable per D-19, but if code ever allows rename), the stored `aad` value `${orgId}:${oldName}` no longer matches, causing decryption to fail with auth tag error.
**Why it happens:** AAD `${orgId}:${name}` is computed at encrypt time and stored in the DB; at decrypt time it must be reconstructed identically.
**How to avoid:** Name is immutable (D-19 PATCH body only accepts `value`, not `name`). If future phases add rename, the secret must be re-encrypted with new AAD.
**Warning signs:** `SecretDecryptError` after a `name` column update.

### Pitfall 4: tsup Multi-Entry Inlining
**What goes wrong:** The `dsl` entry might inline CLI-specific code (e.g., `commander`) if any module in the dsl import graph transitively imports CLI code.
**Why it happens:** tsup bundles the full transitive closure. If `dsl/parser.ts` imported anything from `src/commands/index.ts` (which imports `resolveMachineConfigDir` from `src/config/index.ts`), the entire config stack would be bundled into dsl.mjs.
**How to avoid:** `dsl/parser.ts` must NOT re-export or import from `src/commands/index.ts` (the full loader). It imports only `normalize.ts` and `validate.ts` (which only import `errors.ts` and `types.ts`). [VERIFIED: traced imports — normalize.ts does not import config; validate.ts does not import config]
**Warning signs:** `dist/dsl.mjs` size > 100KB (it should be ~30-40KB with yaml bundled).

### Pitfall 5: Drizzle `customType` Returns `Buffer` (Not `Uint8Array`)
**What goes wrong:** In newer postgres-js versions or different DB drivers, bytea may return `Uint8Array` instead of `Buffer`. The crypto API expects `Buffer`.
**Why it happens:** Node.js `Buffer` is a subclass of `Uint8Array`; some libraries return plain `Uint8Array`.
**How to avoid:** In `fromDriver`, wrap with `Buffer.from(value)` instead of passing through directly:
```typescript
fromDriver(value: Buffer | Uint8Array): Buffer { return Buffer.from(value); }
```
**Warning signs:** `TypeError: value.toString is not a function` when calling `decipher.update(ciphertext)`.

### Pitfall 6: Biome `noRestrictedImports` Paths Are Exact Strings
**What goes wrong:** The Biome rule blocks exact import specifiers. `import 'xci'` is blocked, but `import 'xci/something-else'` would only be blocked if explicitly listed. Wildcards are NOT supported.
**Why it happens:** The rule uses literal string matching, not glob patterns.
**How to avoid:** Explicitly list each forbidden specifier (`'xci'`, `'xci/agent'`). The `'xci/dsl'` specifier is intentionally NOT listed (it is allowed). [VERIFIED: existing biome.json confirms paths is a string-keyed object, not a glob]

### Pitfall 7: Secret Name Uniqueness Enforcement
**What goes wrong:** A Postgres `uniqueIndex('secrets_org_name_unique').on(t.orgId, t.name)` violation throws a PG error code 23505, which Drizzle rethrows. If not caught, it becomes a 500 DatabaseError instead of a 409 Conflict.
**Why it happens:** Same pattern as `EmailAlreadyRegisteredError` (already handled in admin.ts).
**How to avoid:** In `secrets.ts` repo `create()`, catch PG error 23505 and throw `SecretNameConflictError`. Same for tasks.

### Pitfall 8: MEK as `string` vs `Buffer`
**What goes wrong:** `fastify.config.XCI_MASTER_KEY` is a `string` (from env). Passing it directly to `createCipheriv` will fail since AES-GCM requires a 32-byte buffer, not a 44-char base64 string.
**Why it happens:** `@fastify/env` returns all values as their JSON schema type (string). The base64 decode step is not automatic.
**How to avoid:** Always `Buffer.from(fastify.config.XCI_MASTER_KEY, 'base64')` at a single point (e.g., a getter on the `crypto/secrets.ts` module or a `fastify.decorate('mek', ...)` call in app.ts). Never pass the string directly to crypto functions.
**Warning signs:** `RangeError: Invalid key length` from `createCipheriv`.

### Pitfall 9: Migration File Naming
**What goes wrong:** drizzle-kit generates a file with a hash prefix (e.g., `0002_volatile_something.sql`). The CONTEXT.md specifies `0002_tasks_secrets.sql`, but the actual filename depends on drizzle-kit's internal naming.
**Why it happens:** drizzle-kit appends a hash or random suffix by default.
**How to avoid:** Use the `--name` flag: `pnpm --filter @xci/server exec drizzle-kit generate --name tasks_secrets`. This produces `0002_tasks_secrets.sql`. [VERIFIED: existing files `0000_volatile_mad_thinker.sql` and `0001_agents_websocket.sql` confirm hash prefix is generated by default; `0001` used `--name` based on its suffix being clean]

### Pitfall 10: `validateGraph` Throws on Unknown Alias References
**What goes wrong:** `validateGraph` (see commands/validate.ts §D-09) intentionally does NOT check unknown alias references — it only detects cycles. Per the code comment: "Unknown entries are treated as inline commands and are NOT validated here."
**Why it happens:** The v1 loader validates unknown refs at load time via `CommandSchemaError`. The dsl `parseYaml` function calls `normalizeCommands` which validates the structure; `validateGraph` only checks cycles.
**How to avoid:** The unknown-alias check for D-12 step 4 must be implemented separately in the server's validation pipeline — scan `CommandMap` entries, collect all alias refs in `steps`/`group`/`for_each.run`, check they exist as keys. This is a NEW function (not re-used from v1's `validateGraph`). Add `validateAliasRefs(map: CommandMap): ValidationError[]` to `dsl/validate.ts`. [VERIFIED: commands/validate.ts §getAliasRefs + validateGraph code read — confirms validateGraph skips unknowns]

---

## Code Examples

### AES-256-GCM Round-Trip (Complete)
```typescript
// Source: live verification on Node 22.22.2 in this research session [VERIFIED]
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// ENCRYPT
const dek = randomBytes(32);                          // 32-byte DEK
const iv = randomBytes(12);                           // 12-byte IV (GCM requirement)
const aad = `xci_org_123:DATABASE_PASSWORD`;          // context binding
const cipher = createCipheriv('aes-256-gcm', dek, iv);
cipher.setAAD(Buffer.from(aad, 'utf8'));
const ciphertext = Buffer.concat([
  cipher.update('my-secret-value', 'utf8'),
  cipher.final(),
]);
const tag = cipher.getAuthTag();                      // 16 bytes

// DECRYPT — correct order is critical
const decipher = createDecipheriv('aes-256-gcm', dek, iv);
decipher.setAAD(Buffer.from(aad, 'utf8'));
decipher.setAuthTag(tag);                             // MUST be before update/final
const plaintext = Buffer.concat([
  decipher.update(ciphertext),
  decipher.final(),                                   // throws on tag mismatch
]).toString('utf8');
// plaintext === 'my-secret-value'
```

### Drizzle Transaction with Audit Log
```typescript
// Source: pattern from existing admin.ts signupTx, adapted for Phase 9 [VERIFIED: pattern]
await db.transaction(async (tx) => {
  const secretId = generateId('sec');
  const { ciphertext, iv, tag } = encryptSecret(dek, body.value, `${orgId}:${body.name}`);

  await tx.insert(secrets).values({
    id: secretId,
    orgId,
    name: body.name,
    ciphertext,
    iv,
    authTag: tag,
    aad: `${orgId}:${body.name}`,
    createdByUserId: req.session.userId,
  });

  await tx.insert(secretAuditLog).values({
    id: generateId('sal'),
    orgId,
    secretId,
    secretName: body.name,
    action: 'create',
    actorUserId: req.session.userId,
    createdAt: new Date(),
  });
  // If either insert fails, transaction rolls back (D-22)
});
```

### Drizzle `customType` for bytea
```typescript
// Source: drizzle-orm 0.45.2 — customType API [VERIFIED: import test]
import { customType } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
  toDriver(value: Buffer): Buffer { return Buffer.from(value); },
  fromDriver(value: Buffer | Uint8Array): Buffer { return Buffer.from(value); },
});
```

### Package.json `exports` Field Addition
```json
// Source: packages/xci/package.json — current state + additions [VERIFIED]
{
  "bin": { "xci": "./dist/cli.mjs" },
  "exports": {
    ".": "./dist/cli.mjs",
    "./agent": {
      "import": "./dist/agent.mjs",
      "types": "./dist/agent.d.ts"
    },
    "./dsl": {
      "import": "./dist/dsl.mjs",
      "types": "./dist/dsl.d.ts"
    }
  }
}
```

### `requirePlatformAdmin` Middleware
```typescript
// packages/server/src/plugins/require-platform-admin.ts
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requirePlatformAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // requireAuth must run first (Phase 7 auth plugin populates req.user)
  if (!req.user) {
    throw new SessionRequiredError();
  }
  const adminEmail = req.server.config.PLATFORM_ADMIN_EMAIL.toLowerCase();
  if (req.user.email.toLowerCase() !== adminEmail) {
    throw new RoleInsufficientError('owner');  // re-use existing error; or add PlatformAdminRequiredError
  }
}
```

### `resolveTaskParams` Pure Function
```typescript
// packages/server/src/services/dispatch-resolver.ts [ASSUMED: pure function structure]
import { interpolateArgvLenient } from 'xci/dsl';
import type { CommandMap } from 'xci/dsl';

export interface ResolvedParams {
  resolved: Record<string, string>;
  errors: string[];  // unresolved placeholders (to be merged at agent side)
}

/**
 * D-33: Resolve task placeholders at dispatch time.
 * Precedence: runOverrides → orgSecrets → unresolved (agent merges .xci/secrets.yml).
 */
export function resolveTaskParams(
  task: { yaml_definition: string },
  runOverrides: Record<string, string>,
  orgSecrets: Record<string, string>,
): ResolvedParams {
  // Merge: runOverrides win over orgSecrets (D-34 precedence)
  const merged = { ...orgSecrets, ...runOverrides };
  // Use lenient mode: unknown ${VAR} left as-is for agent-side resolution
  const yaml = task.yaml_definition;
  // Find all ${VAR} placeholders in the YAML text (simple scan)
  const placeholderRe = /\$\{([^}]+)\}/g;
  const errors: string[] = [];
  const resolved = yaml.replace(placeholderRe, (match, key: string) => {
    if (Object.hasOwn(merged, key)) return merged[key];
    errors.push(key);
    return match;  // leave unresolved — agent will merge
  });
  return { resolved: { yaml: resolved }, errors };
}
```

Note: The exact interface of `resolveTaskParams` is planner discretion (D-33 says "pure function"). The above is one viable form. The planner should decide whether it operates on the raw YAML string or on a parsed `CommandMap`.

---

## Sequencing

The planner should structure waves as follows (natural dependency order):

**Wave 0 (Foundation):**
1. `packages/xci/src/dsl/` — all 5 files; `levenshtein.ts` included
2. Update `packages/xci/tsup.config.ts` — add dsl entry, `dts: true`
3. Update `packages/xci/package.json` — add `exports` map
4. Run build + verify `dist/dsl.mjs` exists and size < 100KB
5. Add `dsl/__tests__/facade.test.ts` — smoke tests
6. Confirm ~321 xci tests still pass (D-40)

**Wave 1 (DB schema + migration):**
1. Update `packages/server/src/db/schema.ts` — add 4 tables (bytea columns via customType)
2. Run `pnpm --filter @xci/server exec drizzle-kit generate --name tasks_secrets`
3. Commit `0002_tasks_secrets.sql`
4. Update `packages/server/src/config/env.schema.ts` — add XCI_MASTER_KEY + PLATFORM_ADMIN_EMAIL
5. Update `packages/server/src/app.ts` — pino redaction extension; `fastify.decorate('mek', ...)`
6. Add workspace dep: `packages/server/package.json` `"xci": "workspace:*"`

**Wave 2 (Errors + Crypto):**
1. Extend `packages/server/src/errors.ts` — 7 new error classes
2. Create `packages/server/src/crypto/secrets.ts` — 5 functions
3. Unit tests for crypto/secrets.ts (unit, no DB)

**Wave 3 (Repos):**
1. `packages/server/src/repos/tasks.ts`
2. `packages/server/src/repos/secrets.ts`
3. `packages/server/src/repos/secret-audit-log.ts`
4. Update `packages/server/src/repos/for-org.ts` — add tasks, secrets, secretAuditLog
5. Update `packages/server/src/repos/admin.ts` — add `getOrgDek`, `rotateMek`
6. Isolation tests for 3 new repos (D-31)

**Wave 4 (Routes + Admin):**
1. `packages/server/src/routes/tasks/` — 5 route files + barrel
2. `packages/server/src/routes/secrets/` — 5 route files + barrel (including audit-log)
3. `packages/server/src/routes/admin/rotate-mek.ts` + barrel
4. Update `packages/server/src/routes/index.ts` — mount tasks + secrets + admin
5. Update Biome overrides — 2 new blocks

**Wave 5 (Dispatch Resolver + Integration tests):**
1. `packages/server/src/services/dispatch-resolver.ts`
2. Integration tests (testcontainers) — CRUD, encryption roundtrip, rotation
3. Phase closeout: STATE.md update

---

## Open Questions (All Pre-Resolved)

1. **Does tsup multi-entry correctly isolate the dsl bundle from CLI code?**
   RESOLVED: YES. Traced the dsl import graph — `dsl/parser.ts` imports `normalize.ts` and `validate.ts` but NOT `commands/index.ts` (the full loader). The config/ and executor/ modules are never reachable. Bundle will be clean.

2. **Does Biome `noRestrictedImports` `paths` support glob patterns?**
   RESOLVED: NO. Only exact string specifier matching. List `'xci'` and `'xci/agent'` explicitly; do not attempt globs.

3. **Must `setAuthTag` precede `update` in Node.js AES-GCM decryption?**
   RESOLVED: YES. Verified by live code execution. The call order is: `createDecipheriv` → `setAAD` → `setAuthTag` → `update` → `final`.

4. **Is Drizzle's `customType` available in version 0.45.2?**
   RESOLVED: YES. Confirmed by live import test: `typeof customType === 'function'`.

5. **Does postgres-js 3.4.9 return `Buffer` or `Uint8Array` for bytea columns?**
   RESOLVED: [ASSUMED] Standard postgres-js returns `Buffer` for bytea. The `fromDriver` function in `customType` wraps with `Buffer.from(value)` as a safety measure regardless of what the driver returns.

6. **What is the correct validation to detect unknown alias refs at save time (D-12 step 4)?**
   RESOLVED: `validateGraph` does NOT check unknown refs (by design — it only finds cycles). A separate `validateAliasRefs(map)` function must be implemented in `dsl/validate.ts`. It scans sequential `steps`, parallel `group`, and `for_each.run` for names that do not exist as keys in the CommandMap.

7. **Should the `parseYaml` dsl facade be strict (throw) or lenient (return errors array)?**
   RESOLVED: Lenient (return `{commands, errors: ParseError[]}`). The server needs the error details to populate `TaskValidationError.validationErrors` with line numbers for the UI. The facade catches all errors internally and returns them in the structured result.

8. **Pagination for audit log (cursor vs offset)?**
   RESOLVED: Planner discretion. RECOMMENDED: offset-based with `?limit=N&offset=M` (simpler for a low-volume audit log that is owner-only). Cursor-based pagination is over-engineered for this use case.

9. **Max secret value size enforcement?**
   RESOLVED: Planner discretion. RECOMMENDED: 64 KB cap (`body.value.length > 65536 → throw ValidationError`). Apply in the `create` and `update` route handlers before encryption.

10. **tsup `dts` mode — will it add build time?**
    RESOLVED: [ASSUMED] Minor build time increase. tsup uses esbuild for transpilation (fast) + TypeScript compiler in isolatedDeclarations mode for `.d.ts` generation. For a small module like `dsl/`, this is negligible. The CI build time increase should be < 2s.

11. **Does the `"."` root export entry need to be added to `packages/xci/package.json`?**
    RESOLVED: YES. When ANY `"exports"` key is present in package.json, Node.js uses ONLY the exports map. Without `"."`, `require('xci')` would throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. Since `"bin"` is separate from `"exports"` and is still respected for the CLI binary, adding `"."` does not change CLI behavior but ensures the package root is accessible.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pnpm `workspace:*` symlinks packages/xci/ into packages/server/node_modules/xci/ and the exports map governs resolution | FA-1 | If resolution doesn't use the exports map, `import 'xci/dsl'` would fail. Verify by running `node -e "import('xci/dsl')"` from packages/server after pnpm install |
| A2 | postgres-js 3.4.9 returns Buffer (or Uint8Array subtype) for bytea columns | FA-4 | If it returns string, crypto operations would fail with confusing errors. `fromDriver(value: Buffer \| Uint8Array): Buffer { return Buffer.from(value); }` mitigates |
| A3 | Drizzle `.for('update')` is the correct API for SELECT FOR UPDATE in version 0.45.2 | FA-6 | If API differs, use raw SQL: `sql\`SELECT ... FOR UPDATE\`` or `db.execute(sql\`...\`)` |
| A4 | @xci/server tsconfig uses node16 or bundler moduleResolution (enabling exports map resolution) | FA-14 | If using node10/classic resolution, `import 'xci/dsl'` would not resolve via exports map. Check tsconfig.json |
| A5 | `format: 'email'` in AJV/env-schema works for SMTP_FROM already (as seen in env.schema.ts) | FA-9 | If AJV format validation is not configured, the existing SMTP_FROM format check would also fail. Use minLength as fallback |
| A6 | tsup `dts: true` global setting emits .d.ts for all entries without breaking cli.mjs cold start | FA-11 | dts generation only affects compile time, not runtime bundle. CLI cold start unaffected. Mitigation: verify with hyperfine after change |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node:crypto | AES-256-GCM | ✓ | Node 22.22.2 (built-in) | — |
| PostgreSQL | Integration tests | ✓ (via testcontainers) | Any 14+ | — |
| pnpm | workspace: dep | ✓ (monorepo) | current | — |
| tsup | xci dsl entry build | ✓ (devDep in xci) | 8.5.1 | — |
| drizzle-kit | migration generate | ✓ (devDep in server) | 0.31.10 | — |
| @biomejs/biome | lint fence rules | ✓ (2.4.12 per schema) | 2.4.12 | — |

No missing dependencies. All required capabilities are available in the current environment.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Handled by Phase 7 session layer |
| V3 Session Management | no | Handled by Phase 7 |
| V4 Access Control | yes | requireAuth + requireOwner/requireMember guards (Phase 7 pattern) |
| V5 Input Validation | yes | @fastify/env schema + route body validation + max secret value size |
| V6 Cryptography | yes | AES-256-GCM + randomBytes(12) IV + GCM auth tag validation + NIST SP 800-38D |
| V7 Error Handling | yes | XciServerError hierarchy; never expose key material in error messages |
| V8 Data Protection | yes | Plaintext never returned via API; never logged (Pino redaction); zero-fill after use |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| IV reuse (GCM) | Tampering / Information Disclosure | randomBytes(12) per encrypt call; SEC-02 unit test |
| AAD stripping (moving ciphertext to different org) | Spoofing / Tampering | aad = `${orgId}:${name}`; tag mismatch on wrong AAD (VERIFIED) |
| MEK in logs | Information Disclosure | req.body.newMekBase64 added to pino redact.paths |
| Plaintext value in API response | Information Disclosure | No `value` or `ciphertext` field ever included in response bodies |
| Timing attack on secret name existence | Information Disclosure | 409 ConflictError returned (same as email already registered pattern); acceptable since org members can list all secret names anyway |
| Concurrent MEK rotation | Tampering | SELECT FOR UPDATE + single transaction; atomic per D-25 |
| Secret name uniqueness race | Tampering | Postgres unique index 23505 → caught and re-thrown as SecretNameConflictError |
| Cross-org secret access | Information Disclosure | All repos scoped by orgId (forOrg pattern); two-org isolation tests per D-31 |

---

## Sources

### Primary (HIGH confidence)
- Live Node 22.22.2 crypto execution — AES-256-GCM API, IV/tag sizes, error semantics verified
- `/home/developer/projects/loci/packages/xci/tsup.config.ts` — current multi-entry config
- `/home/developer/projects/loci/packages/xci/package.json` — current exports/bin state
- `/home/developer/projects/loci/packages/server/src/db/schema.ts` — Drizzle table patterns
- `/home/developer/projects/loci/packages/server/src/repos/admin.ts` — transaction patterns
- `/home/developer/projects/loci/packages/server/src/errors.ts` — error hierarchy
- `/home/developer/projects/loci/packages/server/src/app.ts` — pino redact config
- `/home/developer/projects/loci/biome.json` — noRestrictedImports rule syntax
- `/home/developer/projects/loci/packages/xci/src/commands/validate.ts` — validateGraph (confirms no unknown-alias check)
- `/home/developer/projects/loci/packages/xci/src/resolver/interpolate.ts` — interpolateArgvLenient
- Live drizzle-orm `customType` import test — confirmed available in 0.45.2

### Secondary (MEDIUM confidence)
- [CITED: NIST SP 800-38D §8.2.1] — 96-bit IV for AES-GCM; other IV lengths require additional GHASH
- [CITED: OWASP Cryptographic Storage Cheat Sheet] — envelope encryption pattern reference

### Tertiary (LOW confidence — see Assumptions Log)
- postgres-js 3.4.9 bytea → Buffer behavior (standard documented behavior, not regression-tested)
- Drizzle 0.45.2 `.for('update')` API syntax
- pnpm workspace:* symlink + exports map resolution chain

---

## Metadata

**Confidence breakdown:**
- DSL extraction: HIGH — all source files read, import graph traced, facade pattern confirmed
- Node crypto AES-GCM: HIGH — live execution verified
- Drizzle bytea customType: HIGH — import confirmed, API verified
- Transaction pattern: HIGH — existing codebase patterns directly reusable
- tsup multi-entry dts: MEDIUM — existing config read; dts: true change not tested
- pnpm workspace:* resolution: MEDIUM — standard behavior, not live-tested in this session

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (30 days; stack is stable)

---

## RESEARCH COMPLETE

**Phase:** 09 - Task Definitions & Secrets Management
**Confidence:** HIGH

### Key Findings
- All 44 locked decisions are implementable with zero new runtime dependencies — only built-in `node:crypto` and existing stack
- `validateGraph` in commands/validate.ts does NOT check unknown alias references (only cycles); a separate `validateAliasRefs()` function must be written in `dsl/validate.ts` for D-12 step 4
- `setAuthTag` MUST be called before `update`/`final` in AES-GCM decryption — verified by live Node.js execution
- The `dsl` tsup entry is safe to add without CLI code contamination — the import graph of normalize.ts/validate.ts does not reach config/ or cli/
- The `"."` root entry must be added to `packages/xci/package.json` exports when introducing the exports map (required by Node.js module resolution)
- `dist/dsl.mjs` cold-start impact on `xci --version` is ZERO — the dsl subpath is only loaded when explicitly imported

### File Created
`/home/developer/projects/loci/.planning/phases/09-task-definitions-secrets-management/09-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Node crypto AES-GCM patterns | HIGH | Live execution verified all critical code paths |
| DSL extraction facade | HIGH | All source files read, import graphs traced |
| Drizzle schema + customType | HIGH | Existing patterns in codebase + live import test |
| tsup multi-entry + dts | MEDIUM | Pattern extended from existing 2-entry config; dts change not live-tested |
| Biome noRestrictedImports | HIGH | Existing syntax in biome.json verified and extended |
| pnpm workspace:* resolution | MEDIUM | Standard behavior, documented; not live-tested in this session |

### Open Questions
None blocking. All 11 open questions pre-resolved above. Assumptions A1-A6 flagged for quick verification during Wave 0.

### Ready for Planning
Research complete. Planner can now create PLAN.md files.
