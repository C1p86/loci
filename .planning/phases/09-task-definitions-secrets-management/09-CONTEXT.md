# Phase 9: Task Definitions & Secrets Management - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** auto-selected (user requested autonomous chain to milestone end)

<domain>
## Phase Boundary

Phase 9 delivers TWO related subsystems:

**(A) Server-side task definitions (TASK-01..06)**
- Drizzle schema for `tasks` table (org-scoped, includes `name`, `description`, `yaml_definition`, `label_requirements`, `org_id`)
- Shared YAML DSL parser/validator extracted from `packages/xci/` and exposed for `@xci/server` to import — same semantics as v1 (alias, single/sequential/parallel, `${VAR}`, OS-specific blocks)
- REST CRUD: list / create / update / delete tasks, scoped per org
- Save-time validation: YAML parseable, cyclic alias composition rejected, alias references resolved
- Dispatch-time placeholder resolution stub (full dispatch is Phase 10)
- UI editor (TASK-05) is Phase 13 — server-side only validates and stores

**(B) Server-side secrets management (SEC-01..08)**
- Drizzle schema for `org_deks` (one wrapped DEK per org) + `secrets` (org-scoped, encrypted values + IV + auth tag) + `secret_audit_log` (action history, metadata only)
- Envelope encryption: MEK from `XCI_MASTER_KEY` env (32-byte base64); per-org DEK wrapped under MEK; secret values encrypted under DEK using AES-256-GCM with random IV per call
- REST CRUD: Owner/Member can create/update/delete; Viewer can list metadata only; NO endpoint ever returns plaintext value
- Auth tag validation on decrypt — corruption/tampering → explicit error, no partial read
- MEK rotation endpoint: re-wraps all org DEKs under new MEK without changing any plaintext value (DEK stays the same plaintext, only its wrapping changes)
- Audit log (org-scoped, metadata only) for create/update/rotate/delete

**Cross-cutting:** Phase 9 introduces the FIRST shared-code dependency between `packages/xci/` and `packages/server/` (Phase 6 D-39 fence partially relaxes here for the YAML parser; the agent already imports `ws` so the fence is conceptually lifted — this just adds a controlled cross-package dependency).

This phase does NOT deliver:
- Dispatch logic (Phase 10) — Phase 9 stores tasks and resolves placeholders, but dispatching to agents is Phase 10
- Agent-side secret merging — Phase 8/10 owns the agent-side `.xci/secrets.yml` precedence (SEC-05 already implemented in v1; Phase 10 wires it through dispatch)
- UI editor (Phase 13) — Phase 9 exposes the validate-on-save API; Phase 13 surfaces inline errors
- Quota enforcement on tasks/secrets (none defined in QUOTA scope) — quotas apply to agents/concurrent tasks only
- Plugin trigger ingest (Phase 12)
- KMS integration (SEC-08 says "gancio per KMS in v2.1") — Phase 9 builds the rotation hook; KMS backend is post-v2.0

**Hard scope rule:** every requirement implemented here is one of TASK-01..06 or SEC-01..08.

</domain>

<decisions>
## Implementation Decisions

### Shared YAML DSL Parser (TASK-02)

- **D-01:** **Subpath export from `xci` package**, NOT a separate workspace package. The roadmap text says "estratto in sub-module di `xci` importato da `@xci/server`" — keep it inside xci. Rationale: avoids a 4th workspace package, keeps Changesets fixed-versioning trivial, and the parser is small + tightly coupled to xci semantics.
- **D-02:** **New directory `packages/xci/src/dsl/`** with focused exports:
  - `parser.ts` — `parseYaml(text: string): { commands: CommandMap, errors: ParseError[] }`. Wraps existing yaml + commands tokenize/normalize/validate logic.
  - `validate.ts` — `validateCommandMap(map: CommandMap): { ok: boolean, errors: ValidationError[] }`. Cycle detection (CMD-06 engine), alias resolution check.
  - `interpolate.ts` — `resolvePlaceholders(text: string, vars: Record<string,string>): { resolved: string, missing: string[] }`. Reuses INT-02 engine.
  - `types.ts` — exported types: `CommandMap`, `Command`, `SequentialStep`, `ParallelGroup`, `ParseError`, `ValidationError`.
  - `index.ts` — barrel re-exporting public API.
- **D-03:** **Package.json subpath export.** `packages/xci/package.json`:
  ```json
  "exports": {
    ".": "./dist/cli.mjs",
    "./agent": "./dist/agent.mjs",
    "./dsl": "./dist/dsl.mjs"
  }
  ```
  And add a third tsup entry: `entry: { cli, agent, dsl }`.
- **D-04:** **`@xci/server` imports via `import { parseYaml } from 'xci/dsl'`.** Add `"xci": "workspace:*"` to `packages/server/package.json` dependencies. This is the FIRST cross-package import; document it as the legitimate sharing boundary.
- **D-05:** **xci internal code continues to use the existing `src/commands/` and `src/resolver/` modules unchanged** — `dsl/` is a re-exporting facade that delegates to them. NO behavior change to v1 CLI; v1 test suite still passes (BC-01).
- **D-06:** **DSL parser ONLY** — no execution logic in `dsl/`. The executor (run subprocess, kill on fail, etc.) stays inside xci's `executor/` module and is NEVER imported by the server (server delegates to agents for execution).

### Task Entity Schema

- **D-07:** **`tasks` table** (org-scoped, follows Phase 7 D-01 forOrg pattern):
  - `id text PK` (xci_tsk_*)
  - `org_id text FK orgs ON DELETE CASCADE`
  - `name text NOT NULL` (unique within org via partial unique index)
  - `description text DEFAULT ''`
  - `yaml_definition text NOT NULL` (the raw YAML; validated on save, parsed at dispatch)
  - `label_requirements jsonb DEFAULT '[]'` (array of `"key=value"` strings)
  - `created_by_user_id text FK users` (audit)
  - `created_at`, `updated_at`
  - Index: `(org_id, name)` unique
- **D-08:** **No "task version" history in Phase 9.** Updates overwrite (`updated_at` timestamps the change). Audit log for tasks deferred (audit log scope is secrets-only per SEC-07).
- **D-09:** **`yaml_definition` stored as text** (not parsed JSON) — preserves comments + whitespace + user formatting. Parsing happens on-demand at validation, dispatch, or display.

### Task REST API

- **D-10:** **Routes** (`packages/server/src/routes/tasks/`):
  - GET `/api/orgs/:orgId/tasks` — any member; returns `[{id, name, description, label_requirements, created_at, updated_at}]` (NOT yaml_definition — kept lean for list view)
  - GET `/api/orgs/:orgId/tasks/:taskId` — any member; returns full task including yaml_definition
  - POST `/api/orgs/:orgId/tasks` — Owner/Member + CSRF; body `{name, description, yaml_definition, label_requirements}`. Validates YAML at save (D-12). Rejects on parse/cycle/unknown-alias errors with `ValidationError {line, message, suggestion}`.
  - PATCH `/api/orgs/:orgId/tasks/:taskId` — Owner/Member + CSRF; same validation as POST.
  - DELETE `/api/orgs/:orgId/tasks/:taskId` — Owner only + CSRF.
- **D-11:** **Validation contract returned on POST/PATCH error:**
  ```json
  { "error": { "code": "XCI_SRV_TASK_VALIDATION", "message": "...", "errors": [{"line": 5, "column": 12, "message": "alias 'foo' references unknown alias 'bar'", "suggestion": "did you mean 'baz'?"}] } }
  ```
- **D-12:** **Save-time validation steps (in order):**
  1. YAML parses without syntax errors → else `XCI_SRV_TASK_YAML_PARSE`
  2. CommandMap validates structurally (each entry single|sequential|parallel) → else `XCI_SRV_TASK_STRUCTURE`
  3. No cyclic alias composition (CMD-06 engine via dsl/validate.ts) → else `XCI_SRV_TASK_CYCLE`
  4. All alias references resolve to defined commands → else `XCI_SRV_TASK_UNKNOWN_ALIAS` with suggestion (Levenshtein distance)
  5. Placeholder resolution NOT validated at save (placeholders may legitimately reference dispatch-time params); only the syntax `${NAME}` is checked

### Secrets — Envelope Encryption (SEC-01..03)

- **D-13:** **MEK source: `XCI_MASTER_KEY` env var.** 32 bytes base64-encoded (44 chars). Server fails to boot if missing or wrong length. The env schema (Phase 7 D-07) is extended.
- **D-14:** **Per-org DEK in `org_deks` table:**
  - `org_id text PK` (1:1 with orgs)
  - `wrapped_dek bytea NOT NULL` (DEK encrypted under MEK using AES-256-GCM)
  - `wrap_iv bytea NOT NULL` (IV used to wrap DEK)
  - `wrap_tag bytea NOT NULL` (auth tag from MEK wrap)
  - `mek_version int NOT NULL DEFAULT 1` (incremented on rotation)
  - `created_at`, `updated_at`
- **D-15:** **DEK is 32 bytes random** (`crypto.randomBytes(32)`), generated when first secret is created for that org. Idempotent: if `org_deks` row exists, reuse; else create.
- **D-16:** **`secrets` table** (org-scoped):
  - `id text PK` (xci_sec_*)
  - `org_id text FK orgs ON DELETE CASCADE`
  - `name text NOT NULL` (unique within org)
  - `ciphertext bytea NOT NULL` (value encrypted under DEK)
  - `iv bytea NOT NULL` (random per encrypt — SEC-02)
  - `auth_tag bytea NOT NULL` (AES-GCM tag — SEC-03)
  - `aad text NOT NULL` (additional authenticated data: `<orgId>:<name>` — binds ciphertext to its location; rotation ACID)
  - `created_by_user_id text FK users`
  - `created_at`, `updated_at`, `last_used_at` (nullable; updated when value resolved at dispatch)
  - Index: `(org_id, name)` unique
- **D-17:** **AES-256-GCM** for both wrap (MEK→DEK) and seal (DEK→value). Use Node's `crypto.createCipheriv('aes-256-gcm', key, iv)` + `cipher.setAAD(aad)`. Random 12-byte IV per call (SEC-02 — verified by unit test asserting two encrypts produce different IVs and ciphertexts).
- **D-18:** **`packages/server/src/crypto/secrets.ts`** new module:
  - `encryptSecret(dek: Buffer, plaintext: string, aad: string): {ciphertext, iv, tag}`
  - `decryptSecret(dek: Buffer, ciphertext: Buffer, iv: Buffer, tag: Buffer, aad: string): string` — throws `SecretDecryptError` on tag mismatch (SEC-03)
  - `wrapDek(mek: Buffer, dek: Buffer): {wrapped, iv, tag}`
  - `unwrapDek(mek: Buffer, wrapped: Buffer, iv: Buffer, tag: Buffer): Buffer`
  - `getOrCreateOrgDek(db, orgId, mek): Buffer` — atomic get-or-create
  - All operations centralized; never inline crypto.

### Secrets REST API (SEC-04)

- **D-19:** **Routes** (`packages/server/src/routes/secrets/`):
  - GET `/api/orgs/:orgId/secrets` — any member (incl. Viewer); returns `[{id, name, created_at, updated_at, last_used_at}]` — METADATA ONLY. Never plaintext.
  - POST `/api/orgs/:orgId/secrets` — Owner/Member + CSRF; body `{name, value}`. Server: get-or-create org DEK, encrypt value, store ciphertext+iv+tag+aad, write `secret_audit_log` entry, return `{id, name, created_at}`. Plaintext value DISCARDED after encryption (zero-fill the buffer).
  - PATCH `/api/orgs/:orgId/secrets/:secretId` — Owner/Member + CSRF; body `{value}` (name immutable). Re-encrypt with new IV. Audit log entry.
  - DELETE `/api/orgs/:orgId/secrets/:secretId` — Owner only + CSRF. Audit log entry.
  - There is NO endpoint that returns the plaintext value to the client. Period. Unique architectural invariant.
- **D-20:** **Pino redaction extended** in app.ts: `req.body.value`, `*.value` (when path includes `/api/orgs/*/secrets`), `*.ciphertext`, `*.dek`, `*.mek`. Use scoped redact for value (only on secrets routes — other routes legitimately use `value`).

### Secret Audit Log (SEC-07)

- **D-21:** **`secret_audit_log` table** (org-scoped):
  - `id text PK`
  - `org_id text FK orgs ON DELETE CASCADE`
  - `secret_id text NULLABLE` (null only after secret is deleted; for tombstone history)
  - `secret_name text NOT NULL` (denormalized so audit survives secret deletion)
  - `action text NOT NULL` (enum: 'create', 'update', 'rotate', 'delete', 'resolve' — last is dispatch-time read; logged in Phase 10)
  - `actor_user_id text FK users NULLABLE` (null for system actions like dispatch-time resolve)
  - `created_at timestamptz`
  - Index: `(org_id, created_at DESC)`
- **D-22:** **Audit log written in same transaction as the action** — atomic. Failure to log fails the action.
- **D-23:** **GET endpoint for audit log:** `GET /api/orgs/:orgId/secret-audit-log?limit=N&since=ISO` — Owner only. Returns last N entries (default 100, max 1000). Phase 13 builds UI consumer.

### MEK Rotation (SEC-08)

- **D-24:** **Endpoint:** `POST /api/admin/rotate-mek` — gated by a special "platform admin" check. Phase 9 implements the gate as `requirePlatformAdmin` middleware that checks `req.user.email === process.env.PLATFORM_ADMIN_EMAIL` (single-user platform admin via env). Per-org admins CANNOT rotate MEK.
- **D-25:** **Rotation flow:**
  1. Body: `{newMekBase64}` (32-byte base64).
  2. Server validates new MEK is 32 bytes.
  3. For each row in `org_deks`:
     - Unwrap DEK with OLD MEK
     - Re-wrap with NEW MEK (new IV)
     - UPDATE row with new wrapped_dek/wrap_iv/wrap_tag, increment mek_version
  4. ALL DEKs re-wrapped within a single Postgres transaction — atomic.
  5. After commit, server logs (NO secret values) the rotation; returns `{rotated: N, mekVersion: V}`.
  6. The OLD MEK env var must be replaced AFTER successful rotation; runbook documented in server README.
- **D-26:** **Plaintext secret values UNCHANGED** by rotation — only the DEK wrapping changes. Verified by integration test: rotate, then decrypt every secret and verify plaintext matches pre-rotation.
- **D-27:** **NO automatic rotation schedule in Phase 9** — manual via the endpoint. v2.1 may add KMS auto-rotation.
- **D-28:** **Rotation idempotency:** if interrupted mid-rotation, on retry, only DEKs not yet rotated (mek_version < new_version) are processed. Track via mek_version column.

### Repos (forOrg + adminRepo extensions)

- **D-29:** **3 new org-scoped repos:**
  - `packages/server/src/repos/tasks.ts` — list, getById, create, update, delete
  - `packages/server/src/repos/secrets.ts` — list (metadata), getById (metadata), create (encrypt internally), update (re-encrypt), delete; `resolveByName(name)` returns plaintext (used at dispatch — Phase 10) + writes audit log entry
  - `packages/server/src/repos/secret-audit-log.ts` — list with pagination
- **D-30:** **adminRepo additions:**
  - `getOrgDek(orgId): Buffer` — unwraps DEK using current MEK; cross-org lookup needed by dispatch (Phase 10) and rotation (D-25)
  - `rotateMek(oldMek, newMek): {rotated, version}` — implements D-25 atomic rotation
- **D-31:** **Auto-discovery isolation tests:** 3 new repos covered per Phase 7 D-04 contract.

### Dispatch-time Placeholder Resolution (TASK-06)

- **D-32:** **`dsl/interpolate.ts` reuses v1 INT-02 engine** — same precedence semantics, same error messages.
- **D-33:** **Phase 9 implements `resolveTaskParams(task, runOverrides, orgSecrets)` as a pure function** in `packages/server/src/services/dispatch-resolver.ts`. Returns `{resolved: Record<string,string>, errors: string[]}`. Phase 10 wires this into dispatch.
- **D-34:** **Precedence at server side: runOverrides → orgSecrets → leave unresolved (placeholder reaches agent which merges with `.xci/secrets.yml` per SEC-06).** The "agent-local wins on collision" semantic is enforced at AGENT side (existing v1 code path in xci); server doesn't try to merge agent-local.
- **D-35:** **Audit log entry for `resolve` action** written each time a secret is resolved at dispatch. Phase 9 implements the helper; Phase 10 invokes it from the dispatcher.

### Schema Migration

- **D-36:** **Single new migration file** `packages/server/drizzle/0002_tasks_secrets.sql` produced by `pnpm --filter @xci/server exec drizzle-kit generate --name tasks_secrets`. Contains 4 new tables (tasks, secrets, org_deks, secret_audit_log), indexes, FKs. Committed. [BLOCKING] gate.

### Cross-Package Import Convention

- **D-37:** **`@xci/server` imports from `xci/dsl` only.** No imports from `xci` (root) or `xci/agent`. Document this in PATTERNS.md and add a Biome `noRestrictedImports` rule scoped to `packages/server/src/**` blocking `import 'xci'` and `import 'xci/agent'` (only `xci/dsl` allowed).
- **D-38:** **Reverse import is FORBIDDEN.** `packages/xci/` MUST NOT import from `@xci/server`. Biome rule scoped to `packages/xci/src/**` blocks `@xci/server`.
- **D-39:** **Subpath export build:** tsup in xci must produce `dist/dsl.mjs` as a separate entry. Verify the bundle does NOT include CLI/agent code (lean — just parser + validator + interpolator).

### Backward Compat

- **D-40:** **v1 fence:** `pnpm --filter xci test` (302 + Phase 8 additions = ~321 tests) still passes. The dsl extraction is a re-export facade — internal xci code paths unchanged.
- **D-41:** **Cold-start gate (<300ms)** still applies to `xci --version`. The `dsl` entry is opt-in via subpath; non-dsl xci paths don't load it.

### Testing Strategy

- **D-42:** **Unit tests** for crypto/secrets.ts (encrypt/decrypt roundtrip, IV uniqueness, AAD validation, tag tampering rejection), dsl re-exports (sanity that the facade works).
- **D-43:** **Integration tests** (Linux+Docker testcontainers, deferred to CI):
  - Tasks CRUD with two-org isolation
  - Secrets CRUD with two-org isolation
  - Secret encrypt/decrypt roundtrip via the actual route flow (POST then resolveByName)
  - MEK rotation: create N secrets, rotate, decrypt all, verify plaintext unchanged
  - Audit log: create/update/delete writes corresponding entries
  - Cross-org: secret with same name in two orgs has different ciphertexts (different IVs even if same plaintext)
  - Cycle detection at task save: cyclic YAML rejected with line number
- **D-44:** **No new E2E** — Phase 9 is API + crypto. Phase 10 will test full dispatch flow.

### Claude's Discretion (planner picks)

- Exact directory layout under `packages/server/src/routes/tasks/` and `routes/secrets/` (planner refines)
- Exact `levenshtein` library or hand-rolled for "did you mean" suggestion (D-12 step 4) — `fastest-levenshtein` is a small dep, but hand-rolled is fine for one-shot suggestions
- Exact pagination shape for audit log endpoint (cursor vs offset)
- Whether to add a `secrets.yml` import endpoint (Phase 13 candidate; deferred for now)
- Whether to enforce a max secret value size (recommend 64 KB cap to prevent abuse — planner picks)

</decisions>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` §Task Definitions (TASK-01..06) — DSL parity with v1, shared parser, save-time validation, dispatch-time resolution
- `.planning/REQUIREMENTS.md` §Secrets Management (SEC-01..08) — envelope encryption, IV-per-call, AES-256-GCM, AAD, audit log, MEK rotation
- `.planning/REQUIREMENTS.md` §Backward Compatibility (BC-01..04)

### Roadmap
- `.planning/ROADMAP.md` §Phase 9 — 5 success criteria

### Project Vision
- `.planning/PROJECT.md` §Current Milestone v2.0 — Secrets hybrid model (org-level encrypted on server + agent-local in `.xci/secrets.yml`)

### Project Instructions
- `CLAUDE.md` §Technology Stack — Node `>=20.5.0`, ESM, biome 2.x

### Prior Phase Context
- `.planning/phases/06-monorepo-setup-backward-compat-fence/06-CONTEXT.md` D-39 — fence rationale; D-04 here introduces the controlled cross-package import via subpath export
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` — forOrg/adminRepo/CSRF/error patterns inherited
- `.planning/phases/08-agent-registration-websocket-protocol/08-CONTEXT.md` D-01 — Phase 6 fence narrowed to cli.ts only; Phase 9's xci/dsl entry is the natural extension of the multi-entry pattern from Phase 8

### v1 Code (DSL extraction sources)
- `packages/xci/src/commands/` (tokenize, normalize, validate) — source of CMD-06 cycle detection
- `packages/xci/src/resolver/interpolate.ts` — source of INT-02 placeholder resolution
- `packages/xci/src/config/` — YAML parsing patterns

### External Specs
- Node `crypto.createCipheriv('aes-256-gcm', key, iv)` + `setAAD` — primary encryption API
- NIST SP 800-38D — GCM mode IV recommendations (96-bit IV from CSPRNG; never reuse)
- OWASP Cryptographic Storage Cheat Sheet — envelope encryption pattern reference

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 7/8 Patterns Inherited
- `forOrg` scoped repos (Phase 7 D-01) — tasks/secrets/audit-log all follow this
- `adminRepo` namespace (Phase 7 D-03) — DEK/MEK ops are cross-org system actions
- Auto-discovery isolation meta-test (Phase 7 D-04) — picks up new isolation tests automatically
- Per-route CSRF + requireAuth + requireOwner/Member guards (Phase 7 D-09, D-34)
- XciServerError hierarchy (Phase 7 D-08) — extend with `TaskValidationError`, `TaskCycleError`, `SecretDecryptError`, `MekRotationError`
- Pino redaction (Phase 7 D-10) — extend with secret-specific paths (D-20)
- Schema conventions (Phase 7 D-25..28) — text PKs with prefix, ON DELETE CASCADE, no soft-deletes, drizzle-kit generate
- env-schema (Phase 7 D-07) — extend with `XCI_MASTER_KEY` (required, base64 32-byte) and `PLATFORM_ADMIN_EMAIL` (required for D-24 rotate gate)

### Phase 6 Fence Status
- `packages/xci/` may now legitimately depend on `ws` (Phase 8) and is about to expose a public DSL subpath (Phase 9 D-03)
- `packages/server/` may now legitimately import `xci/dsl` (D-04)
- Reverse import (xci → server) STILL forbidden (D-38)

### `packages/xci/` Reusable Assets (DSL extraction)
- `src/commands/tokenize.ts` + `normalize.ts` + `validate.ts` — full v1 DSL parser pipeline; `dsl/parser.ts` re-exports
- `src/commands/__tests__/` — extensive test coverage; reused as-is (no test changes in xci/)
- `src/resolver/interpolate.ts` — placeholder resolution; `dsl/interpolate.ts` re-exports
- `src/resolver/params.ts` — param merging logic (precedence layers); reusable for D-33 dispatch resolver

### Integration Points
- `packages/xci/package.json` — add `exports./dsl` subpath
- `packages/xci/tsup.config.ts` — add `dsl: 'src/dsl/index.ts'` to entry map
- `packages/xci/src/dsl/` — NEW: re-export facade
- `packages/server/package.json` — add `"xci": "workspace:*"` dep
- `packages/server/src/db/schema.ts` — extend with 4 new tables
- `packages/server/src/repos/index.ts` — extend `makeRepos`
- `packages/server/src/repos/admin.ts` — extend with DEK/MEK helpers
- `packages/server/src/routes/index.ts` — mount tasks + secrets + audit-log routes
- `packages/server/src/config/env.schema.ts` — add XCI_MASTER_KEY + PLATFORM_ADMIN_EMAIL
- `packages/server/src/app.ts` — extend pino redaction with secret-specific paths

### Creative Options
- The `dsl/` extraction sets the precedent for future shared modules (e.g., a `xci/types` subpath if Phase 13 web SPA needs shared TypeScript types).
- The `secret_audit_log` table is the foundation for a more general `audit_log` table later (post-v2.0); Phase 9 keeps it secret-scoped.
- AAD-binding (D-16) means a secret's ciphertext can NEVER be decrypted in a different org's context even if the DEK leaks — defense-in-depth.

</code_context>

<specifics>
## Specific Ideas

- **Subpath export over separate package** — keeps Changesets fixed-versioning trivial. Adding a `@xci/parser` package would require updating `.changeset/config.json` `fixed` array AND coordinating versions on every release. Subpath is one config line.

- **AAD binding for secrets (D-16)** is the load-bearing security control. Without it, a malicious admin with DB access could move a secret row to a different org and decrypt it under the wrong DEK. With AAD = `<orgId>:<name>`, even with the right DEK the auth tag fails when the location changes.

- **MEK rotation must be ATOMIC** (single Postgres transaction over all DEKs) — partial rotation creates a window where some orgs have new-MEK-wrapped DEKs and others still have old. Atomicity guarantees we either fully rotate or roll back.

- **The `value` field on secrets routes is NEVER returned by the API.** This is the architectural invariant — verify with a CI grep on routes/secrets/*.ts that no response includes `value` or `ciphertext` or `dek`.

- **Dispatch-time secret resolution is logged via audit log** (D-35) — gives auditability of "which user ran which task with which secret values". Phase 10 wires the call site.

- **Cycle detection (CMD-06) is already battle-tested in v1** — the dsl extraction must NOT reimplement; it just re-exports. Re-running the full v1 commands/__tests__/ suite after extraction confirms no regression.

- **`process.env.XCI_MASTER_KEY` rotation runbook** must explain: (1) generate new key, (2) deploy server with BOTH old and new keys (transition env vars `XCI_MASTER_KEY_OLD`, `XCI_MASTER_KEY_NEW`), (3) call rotate endpoint, (4) deploy server with only new key set as `XCI_MASTER_KEY`. Phase 9 documents this; Phase 14 deployment guide repeats.

- **Levenshtein "did you mean" suggestion** for unknown alias (D-12 step 4) is a small UX win — if user types `${DATABASEURL}` instead of `${DATABASE_URL}`, suggest the close match. Hand-roll a 30-line Levenshtein in dsl; no dep.

</specifics>

<deferred>
## Deferred Ideas

- **Task version history / audit log** — deferred (audit log scope is secrets-only per SEC-07)
- **KMS integration backend (AWS KMS, GCP KMS, Vault)** — Phase 9 builds the rotation hook; KMS adapter is post-v2.0 (per SEC-08 wording)
- **Automatic MEK rotation schedule** — manual only in v2.0
- **Per-secret access control (which users can use which secrets)** — out of scope; org-scoped only
- **Secret value streaming for large blobs** — secrets capped at 64 KB; large data lives in object storage (out of scope)
- **Task templates / built-in tasks library** — out of scope
- **YAML editor in API (server-side syntax highlighting hints)** — Phase 13 owns the UI; Phase 9 returns structured ValidationErrors that the UI can decorate
- **Dispatch-time secret resolution caching** — recompute per dispatch; caching adds invalidation complexity (deferred)
- **Audit log retention/cleanup job** — defer (logs grow slowly; revisit if retention becomes an issue)
- **Cross-org secret sharing** — out of scope; org isolation is non-negotiable
- **Secret value diff API for updates (audit "what changed")** — out of scope (would require storing previous ciphertext)

### Reviewed Todos (not folded)
None — todo-match-phase returns 0 for project per pattern.

</deferred>

---

*Phase: 09-task-definitions-secrets-management*
*Context gathered: 2026-04-18*
*Mode: auto-selected (user requested autonomous chain to milestone end)*
