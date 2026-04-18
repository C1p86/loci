# Phase 9: Task Definitions & Secrets Management — Pattern Map

**Mapped:** 2026-04-18
**Files analyzed:** ~28 new files + 10 modified files across `packages/xci/src/dsl/`, `packages/server/src/` (schema, repos, routes, crypto, services, config), and root infrastructure (`biome.json`).
**Analogs found:** 22 files have near-exact analogs in Phase 7 (`repos/users.ts`, `repos/org-invites.ts`, `repos/admin.ts`, `routes/orgs/invites.ts`, `crypto/tokens.ts`, `errors.ts`). 5 files greenfield with RESEARCH-sourced patterns (crypto/secrets.ts, dsl/* re-export facade, dispatch-resolver, rotate-mek route, requirePlatformAdmin middleware). 3 files are extensions of Phase 8 modifications (tsup.config.ts, package.json, biome.json).
**Source of truth:** CONTEXT D-01..D-44 (locked), RESEARCH §FA-1..FA-15 (verified), Phase 7 PATTERNS.md (inheritance baseline), Phase 8 PATTERNS.md (multi-entry tsup + fence narrowing).

---

## Framing

Phase 9 is the **first legitimate cross-package code-sharing moment** in the monorepo. It does THREE things that each lean on a different analog source:

1. **DSL facade in `packages/xci/src/dsl/`** — a thin, re-exporting module exposed as a third tsup entry (`dist/dsl.mjs`) and subpath export (`xci/dsl`). The tsup multi-entry + subpath export pattern was established in **Phase 8** (cli + agent entries); Phase 9 simply adds a third entry of the same shape. The dsl code itself is a facade over existing battle-tested modules (`commands/normalize.ts`, `commands/validate.ts`, `resolver/interpolate.ts`) — NO duplicated logic (D-05). One NEW function only: `validateAliasRefs` (RESEARCH key finding — `validateGraph` detects cycles but NOT unknown refs per Pitfall 10).

2. **Server-side tasks + secrets subsystems under `packages/server/src/`** — nearly every file has an EXACT Phase 7 analog (forOrg scoped repos follow `repos/users.ts`; CRUD routes follow `routes/orgs/invites.ts`; error hierarchy extensions follow `errors.ts`; cross-org helpers follow `repos/admin.ts`; schema extensions follow `db/schema.ts` patterns including partial unique indexes, text PKs with prefixes, CASCADE FKs, `withTimezone: true` timestamps). The ONLY greenfield server module is `crypto/secrets.ts` (5 AES-256-GCM envelope-encryption functions) — pattern traces to Phase 7 `crypto/tokens.ts` *structurally* (zero-dep `node:crypto` module with narrow exported helpers), but the crypto specifics are new.

3. **The FIRST controlled cross-package import** (`@xci/server` → `xci/dsl`). Phase 6 D-39 fence + Phase 8 fence narrowing set the stage; Phase 9 opens the door via a subpath export AND adds TWO new Biome `noRestrictedImports` overrides (D-37 blocks `import 'xci'` and `import 'xci/agent'` from server; D-38 blocks `import '@xci/server'` from xci). The analog is the **existing Phase 8 fence narrowing** — same Biome override shape, same single-file-specifier approach.

**Critical read (RESEARCH Pitfall 10):** `validateGraph(commands)` in `packages/xci/src/commands/validate.ts` **intentionally does NOT validate unknown alias references** — it only detects cycles. D-12 step 4 ("all alias references resolve to defined commands") requires a NEW `validateAliasRefs(map: CommandMap)` function in `dsl/validate.ts` that scans `steps` / `group` / `for_each.run` arrays for names not in `commands.keys()`. This is the SINGLE new piece of logic introduced by the dsl facade.

**Critical read (RESEARCH Pitfall 11 / Open Q #11):** When `"exports"` is introduced in `packages/xci/package.json`, Node.js stops respecting the legacy package-root resolution. The `"."` entry MUST be included alongside `"./agent"` and `"./dsl"` — else any tooling that probes the package root fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The `"bin"` field is independent and still respected for the CLI binary.

**Architectural invariant (D-19 / D-20):** **NO endpoint ever returns a plaintext secret value.** Verify with a CI grep on `packages/server/src/routes/secrets/*.ts` that no response body includes `value` / `ciphertext` / `dek` / `mek`. The only code path that ever produces plaintext is `secretsRepo.resolveByName()` (used in dispatch, Phase 10) and `crypto/secrets.ts` internal functions — both kept server-internal.

---

## File Classification

### NEW files — xci DSL facade (`packages/xci/src/dsl/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/xci/src/dsl/index.ts` | barrel | — | `packages/server/src/repos/index.ts` (barrel that controls public API surface) | partial (barrel discipline only) |
| `packages/xci/src/dsl/parser.ts` | service (parse facade) | transform | `packages/xci/src/commands/index.ts` lines 26-66 (readCommandsFile → parse → normalize) | partial — lenient wrapper (returns `{commands, errors}`, never throws) per RESEARCH Open Q #7 |
| `packages/xci/src/dsl/validate.ts` | service (validation facade) | transform | `packages/xci/src/commands/validate.ts` (validateGraph, getAliasRefs) | partial (re-exports validateGraph + NEW validateAliasRefs — RESEARCH Pitfall 10) |
| `packages/xci/src/dsl/interpolate.ts` | service (re-export) | transform | `packages/xci/src/resolver/interpolate.ts` `interpolateArgvLenient` | exact (pure re-export, no logic) |
| `packages/xci/src/dsl/levenshtein.ts` | utility | transform | — | **greenfield — 30-line hand-rolled DP (RESEARCH §FA-8)** |
| `packages/xci/src/dsl/types.ts` | model (type-only barrel) | — | `packages/xci/src/types.ts` (type contracts file discipline) | partial (re-exports CommandMap, CommandDef, SequentialStep; declares NEW ParseError + ValidationError interfaces) |
| `packages/xci/src/dsl/__tests__/facade.test.ts` | test | — | `packages/xci/src/__tests__/errors.test.ts` (test-style + `.js` suffix imports) | partial — smoke tests that re-exports work (RESEARCH §FA-15) |

### NEW files — Server tasks subsystem (`packages/server/src/routes/tasks/`, `repos/tasks.ts`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/repos/tasks.ts` | service (repo, org-scoped) | CRUD | `packages/server/src/repos/users.ts` + `packages/server/src/repos/org-invites.ts` | **exact** — `makeTasksRepo(db, orgId)` factory, never exported from `repos/index.ts` (D-01 discipline) |
| `packages/server/src/repos/__tests__/tasks.isolation.test.ts` | test | CRUD | `packages/server/src/repos/__tests__/users.isolation.test.ts` | **exact** (two-org fixture, auto-discovery meta-test picks it up — D-31) |
| `packages/server/src/routes/tasks/index.ts` | barrel | — | `packages/server/src/routes/orgs/invites.ts` export pattern + `routes/agents/index.ts` barrel | exact (register each subroute) |
| `packages/server/src/routes/tasks/list.ts` | controller (GET) | request-response | `packages/server/src/routes/orgs/invites.ts` `invitesRoute` GET (lines 91-111) | **exact** (session + requireMember + forOrg().tasks.list) |
| `packages/server/src/routes/tasks/get.ts` | controller (GET by id) | request-response | same as list.ts | **exact** |
| `packages/server/src/routes/tasks/create.ts` | controller (POST) | request-response | `packages/server/src/routes/orgs/invites.ts` `invitesRoute` POST (lines 32-88) | **exact** — Owner/Member + CSRF + schema validation + TaskValidationError on save-time D-12 pipeline |
| `packages/server/src/routes/tasks/update.ts` | controller (PATCH) | request-response | `packages/server/src/routes/orgs/invites.ts` `membersRoute` PATCH (lines 157-209) | **exact** (same D-12 validation pipeline as create.ts) |
| `packages/server/src/routes/tasks/delete.ts` | controller (DELETE) | request-response | `packages/server/src/routes/orgs/invites.ts` DELETE (lines 114-152) | **exact** — Owner only + CSRF |
| `packages/server/src/routes/tasks/__tests__/*.integration.test.ts` | test (×5) | request-response | Phase 8 `routes/agents/__tests__/*.integration.test.ts` (fastify.inject pattern) | role-match |

### NEW files — Server secrets subsystem (`packages/server/src/routes/secrets/`, `repos/secrets.ts`, `repos/secret-audit-log.ts`, `crypto/secrets.ts`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/crypto/secrets.ts` | service (crypto primitives) | transform | `packages/server/src/crypto/tokens.ts` (zero-dep `node:crypto` module with narrow exports) | partial (structural shape only — crypto specifics are new; RESEARCH §FA-2, §FA-3) |
| `packages/server/src/crypto/__tests__/secrets.test.ts` | test | transform | `packages/server/src/crypto/__tests__/tokens.test.ts` (if exists; else Phase 7 style) | partial (vitest + `.js` imports); MUST cover IV uniqueness (SEC-02), AAD tamper (SEC-03), roundtrip (SEC-01) |
| `packages/server/src/repos/secrets.ts` | service (repo, org-scoped) | CRUD | `packages/server/src/repos/users.ts` + `packages/server/src/repos/org-invites.ts` (mutation + partial-unique-index-aware) | **exact** factory shape; encryption happens INSIDE this repo (via crypto/secrets.ts). `resolveByName()` is the ONLY method that returns plaintext (called only by dispatch in Phase 10) |
| `packages/server/src/repos/secret-audit-log.ts` | service (repo, org-scoped) | CRUD | `packages/server/src/repos/org-invites.ts` `listPending()` (time-scoped list with where + order + limit) | partial (simpler — append-only) |
| `packages/server/src/repos/__tests__/secrets.isolation.test.ts` | test | CRUD | `packages/server/src/repos/__tests__/users.isolation.test.ts` | **exact** |
| `packages/server/src/repos/__tests__/secret-audit-log.isolation.test.ts` | test | CRUD | same | **exact** |
| `packages/server/src/routes/secrets/index.ts` | barrel | — | `packages/server/src/routes/agents/index.ts` | **exact** |
| `packages/server/src/routes/secrets/list.ts` | controller (GET) | request-response | `packages/server/src/routes/orgs/invites.ts` `invitesRoute` GET | **exact** — any member (incl. Viewer) — **METADATA ONLY, NO plaintext value** |
| `packages/server/src/routes/secrets/create.ts` | controller (POST) | request-response | `packages/server/src/routes/orgs/invites.ts` `invitesRoute` POST | **exact** — Owner/Member + CSRF + 64KB size cap (planner) + audit-log in same tx (D-22) |
| `packages/server/src/routes/secrets/update.ts` | controller (PATCH) | request-response | same (but body only accepts `value`, name immutable per D-19 + Pitfall 3) | **exact** |
| `packages/server/src/routes/secrets/delete.ts` | controller (DELETE) | request-response | `packages/server/src/routes/orgs/invites.ts` DELETE | **exact** — Owner only + CSRF + audit-log tombstone (`secretId` nullable column) |
| `packages/server/src/routes/secrets/audit-log.ts` | controller (GET) | request-response | `packages/server/src/routes/orgs/invites.ts` `invitesRoute` GET (Owner-only listing) | **exact** (pagination: offset-based per RESEARCH Open Q #8; default 100, max 1000) |
| `packages/server/src/routes/secrets/__tests__/*.integration.test.ts` | test (×5) | request-response | Phase 8 routes/agents tests | role-match |

### NEW files — Admin + dispatch-resolver

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/plugins/require-platform-admin.ts` | middleware (guard) | request-response | `packages/server/src/routes/orgs/invites.ts` `requireOwnerAndOrgMatch` (lines 14-19) | partial (same "check req.user + throw XciServerError" shape; checks email match against `fastify.config.PLATFORM_ADMIN_EMAIL`) |
| `packages/server/src/routes/admin/index.ts` | barrel | — | `packages/server/src/routes/agents/index.ts` | **exact** |
| `packages/server/src/routes/admin/rotate-mek.ts` | controller (POST) | request-response | `packages/server/src/routes/orgs/invites.ts` POST shape; body-validation + CSRF + requireAuth + NEW requirePlatformAdmin preHandler | partial (route shape exact; rotation logic is greenfield — invokes `adminRepo.rotateMek(oldMek, newMek)`) |
| `packages/server/src/routes/admin/__tests__/rotate-mek.integration.test.ts` | test | request-response | Phase 8 routes/agents integration tests | role-match — D-26 acceptance test (rotate + decrypt all secrets + verify plaintext unchanged) |
| `packages/server/src/services/dispatch-resolver.ts` | service (pure fn) | transform | — | **greenfield — see RESEARCH §Code Examples / `resolveTaskParams` Pure Function** |
| `packages/server/src/services/__tests__/dispatch-resolver.test.ts` | test (unit) | transform | `packages/xci/src/resolver/__tests__/*.test.ts` (INT-02 test style) | partial (unit, no DB) |

### MODIFIED files — Server (extensions, NOT replacements)

| Modified File | Kind of Change | Reference Analog / Pattern |
|---------------|----------------|----------------------------|
| `packages/server/src/db/schema.ts` | Append 4 tables (tasks, secrets, org_deks, secret_audit_log) + 1 custom type (`bytea`) + 8 `$inferSelect`/`$inferInsert` type exports | Same file; mirror Phase 8 extension pattern (existing `agents`/`agentCredentials`/`registrationTokens` appended after `orgInvites`); RESEARCH §FA-4 for bytea customType |
| `packages/server/src/repos/for-org.ts` | Add 3 new factory calls (`tasks`, `secrets`, `secretAuditLog`) | Same file — mirror existing 9 factory entries (lines 19-27, Phase 8 state) |
| `packages/server/src/repos/admin.ts` | Add 2 cross-org helpers: `getOrgDek(orgId): Buffer` + `rotateMek(oldMek, newMek): {rotated, version}` | Same file — mirror `signupTx` transaction pattern (lines 60-77) for atomic rotation; `findValidRegistrationToken`-style cross-org read for `getOrgDek` |
| `packages/server/src/errors.ts` | Add 7 concrete subclasses (`TaskValidationError`, `TaskNotFoundError`, `TaskNameConflictError`, `SecretNotFoundError`, `SecretNameConflictError`, `SecretDecryptError`, `MekRotationError`) + `TaskValidationDetail` interface | Same file — mirror `InvalidCredentialsError` (discard sensitive args), `AgentFrameInvalidError` (short tag args only); RESEARCH §FA-13 |
| `packages/server/src/__tests__/errors.test.ts` | Extend `oneOfEachConcrete()` with 7 new subclasses; code-uniqueness test auto-catches duplicates | Same file (Phase 7/8 pattern — mirrors xci `errors.test.ts`) |
| `packages/server/src/plugins/error-handler.ts` | Add TaskValidationError special-case: when `instanceof TaskValidationError`, include `errors: err.validationErrors` in response body (D-11 contract) | Same file — extend existing XciServerError serialization |
| `packages/server/src/config/env.schema.ts` | Extend `required[]` with `XCI_MASTER_KEY`, `PLATFORM_ADMIN_EMAIL`; add two properties + extend module-augmentation declaration | Same file (existing `required` + `properties` structure, lines 2-28); RESEARCH §FA-9 |
| `packages/server/src/app.ts` | (1) Extend `redact.paths` with 4 new entries (RESEARCH §FA-12); (2) `app.decorate('mek', Buffer.from(app.config.XCI_MASTER_KEY, 'base64'))` AFTER fastifyEnv register (Pitfall 8) | Same file — extend `redact.paths` array (lines 36-49); mirror `app.decorate('agentRegistry', ...)` at line 102 for MEK decorator |
| `packages/server/src/routes/index.ts` | Register 3 new route groups: `/api/orgs/:orgId/tasks`, `/api/orgs/:orgId/secrets`, `/api/admin/*` | Same file — mirror Phase 8 `await fastify.register(registerAgentRoutes, {prefix:'/orgs'})` pattern |
| `packages/server/package.json` | Add `"xci": "workspace:*"` to `dependencies` | Same file — mirror existing workspace deps (if any); RESEARCH §FA-14 |
| `packages/server/drizzle/0002_tasks_secrets.sql` | NEW migration file — generated by `pnpm --filter @xci/server exec drizzle-kit generate --name tasks_secrets` | Phase 7 `0000_*` + Phase 8 `0001_agents_websocket.sql` generated the same way (D-36; RESEARCH Pitfall 9) |

### MODIFIED files — xci (DSL extraction)

| Modified File | Kind of Change | Reference Analog |
|---------------|----------------|------------------|
| `packages/xci/package.json` | Add `"exports"` map with 3 entries (`.`, `./agent`, `./dsl`) alongside existing `"bin"`; FIRST `exports` block in this package | Same file — **NEW field**. RESEARCH §FA-1 + Open Q #11 — `"."` entry required |
| `packages/xci/tsup.config.ts` | (1) Add third entry `dsl: 'src/dsl/index.ts'`; (2) Flip `dts: false` → `dts: true` (all 3 entries gain `.d.ts` files — needed for TS consumer in @xci/server) | Same file — mirror Phase 8 second-entry addition (line 7); RESEARCH §FA-11 |

### MODIFIED files — root infrastructure

| Modified File | Kind of Change | Reference Analog |
|---------------|----------------|------------------|
| `biome.json` | Add TWO new override blocks: (1) `packages/server/src/**` blocks `'xci'` + `'xci/agent'` import specifiers; (2) `packages/xci/src/**` blocks `'@xci/server'` | Existing first override (lines 48-69) — same `noRestrictedImports.paths` shape; RESEARCH §FA-10 |
| `.changeset/*.md` | Add a new changeset describing Phase 9 changes: `xci` feat (dsl subpath export), `@xci/server` feat (tasks + secrets + MEK rotation); fixed-versioning per Phase 6 D-11 | Existing changeset convention |

---

## Pattern Assignments

### `packages/xci/src/dsl/parser.ts` (service, transform — lenient wrapper)

**Analog:** `packages/xci/src/commands/index.ts` lines 26-66 (existing `readCommandsFile` parse → normalize pipeline).

**Copy pattern — yaml parse + normalize with error capture** (`packages/xci/src/commands/index.ts` lines 41-49):
```typescript
let parsed: unknown;
try {
  parsed = parse(raw);
} catch (err: unknown) {
  if (err instanceof YamlLibError) {
    throw new YamlParseError(filePath, err.linePos?.[0]?.line, err, raw);
  }
  throw err;
}
```

**Divergence for dsl/parser.ts** (RESEARCH §FA-7 + Open Q #7 — LENIENT, not strict):
```typescript
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { normalizeCommands } from '../commands/normalize.js';
import type { CommandMap } from '../types.js';
import type { ParseError } from './types.js';

export function parseYaml(text: string): { commands: CommandMap; errors: ParseError[] } {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (err) {
    const line = err instanceof YamlLibError ? err.linePos?.[0]?.line : undefined;
    return { commands: new Map(), errors: [{ line, message: String(err) }] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { commands: new Map(), errors: [{ message: 'YAML root must be a mapping' }] };
  }
  try {
    return { commands: normalizeCommands(raw as Record<string, unknown>, '<server-yaml>'), errors: [] };
  } catch (err) {
    return { commands: new Map(), errors: [{ message: String(err) }] };
  }
}
```

**Critical:** Must import `normalizeCommands` directly from `../commands/normalize.js`, NOT from `../commands/index.js` (Pitfall 4 — importing the full loader pulls in `resolveMachineConfigDir` and the whole config stack, bloating `dist/dsl.mjs`).

---

### `packages/xci/src/dsl/validate.ts` (service, transform — cycle + NEW unknown-ref check)

**Analog:** `packages/xci/src/commands/validate.ts` `validateGraph` (lines 45-98) + `getAliasRefs` (lines 16-28).

**Copy pattern — validateGraph re-export** (D-05 — no reimplementation):
```typescript
import { validateGraph } from '../commands/validate.js';
import { CircularAliasError, CommandSchemaError } from '../errors.js';
import type { CommandMap, CommandDef } from '../types.js';
import type { ValidationError } from './types.js';

export function validateCommandMap(map: CommandMap): { ok: boolean; errors: ValidationError[] } {
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

**NEW function — `validateAliasRefs`** (RESEARCH Pitfall 10 — `validateGraph` intentionally does NOT check unknown refs). Mirror the internal `getAliasRefs` logic from `commands/validate.ts` lines 16-28, but scan all entries to produce a list of unknown references:

```typescript
export function validateAliasRefs(map: CommandMap): ValidationError[] {
  const errors: ValidationError[] = [];
  const known = [...map.keys()];
  for (const [alias, def] of map.entries()) {
    const refs = collectExplicitRefs(def);        // scans steps / group / for_each.run
    for (const ref of refs) {
      if (!map.has(ref)) {
        const suggestion = suggest(ref, known);   // levenshtein.ts
        errors.push({
          message: `alias '${alias}' references unknown alias '${ref}'`,
          suggestion: suggestion[0] ? `did you mean '${suggestion[0]}'?` : undefined,
        });
      }
    }
  }
  return errors;
}

function collectExplicitRefs(def: CommandDef): readonly string[] {
  if (def.kind === 'sequential') return def.steps;
  if (def.kind === 'parallel') return def.group;
  if (def.kind === 'for_each' && def.run) return [def.run];
  return [];
}
```

Note: `collectExplicitRefs` must return ALL candidate names (before `map.has` filter) — this is the semantic difference from `getAliasRefs` in `commands/validate.ts` which filters to only resolvable names.

---

### `packages/xci/src/dsl/interpolate.ts` (service, pure re-export)

**Analog:** `packages/xci/src/resolver/interpolate.ts` `interpolateArgvLenient` (exported at line 318-340).

**Copy pattern — one-line re-export** (RESEARCH §FA-7):
```typescript
export { interpolateArgvLenient as resolvePlaceholders } from '../resolver/interpolate.js';
```

**Rationale (D-34):** Dispatch-time resolution is lenient — unknown `${VAR}` placeholders are left as-is so the agent can merge them with `.xci/secrets.yml` (SEC-06). The existing v1 INT-02 engine is battle-tested; do NOT reimplement.

---

### `packages/xci/src/dsl/types.ts` (model, type-only)

**Analog:** `packages/xci/src/types.ts` (lines 59-107, 113-131 — CommandDef, CommandMap, SequentialStep shapes).

**Copy pattern — re-export public types + declare NEW error shapes:**
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

**Critical:** `CommandMap` is `ReadonlyMap<string, CommandDef>` (types.ts line 103). The server imports this as a **value type** (not for execution) — type-safe since ReadonlyMap has no mutation API.

---

### `packages/xci/tsup.config.ts` (MODIFIED — third entry + dts:true)

**Analog (same file):** existing two-entry pattern from Phase 8 (line 7: `entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' }`).

**Two changes only:**

**Change 1 — Add `dsl` entry** (line 7):
```typescript
// BEFORE:
entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' },
// AFTER:
entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts', dsl: 'src/dsl/index.ts' },
```

**Change 2 — Flip `dts: false` → `dts: true`** (line 29): needed for TypeScript consumers in `@xci/server` to resolve `xci/dsl` types via the `"types"` condition in the exports map (RESEARCH §FA-1, §FA-11).

**KEEP unchanged** (explicit — the planner must not touch these):
- `external: ['ws', 'reconnecting-websocket']` (line 18) — Phase 6 D-16 ws fence still active
- `noExternal: [/^(?!ws$|reconnecting-websocket$).*/]` (line 17)
- `splitting: false` (line 32)
- `banner` with shebang (lines 34-39) — harmless on `dsl.mjs` (no one executes it directly)
- `esbuildOptions` external `./agent/index.js` (lines 23-27) — no effect on dsl entry (it doesn't import agent)

**Pitfall 4 verification after build:** `grep -c 'commander' packages/xci/dist/dsl.mjs` → should be `0` (dsl doesn't use commander). `wc -c packages/xci/dist/dsl.mjs` → should be < 100KB (only yaml + normalize/validate/interpolate bundled).

---

### `packages/xci/package.json` (MODIFIED — add `exports` map)

**Analog (same file):** current structure with `bin` + `files` + `scripts` + `dependencies` (lines 10-48). NO `exports` key currently.

**ADD:**
```json
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
  },
  ...existing fields...
}
```

**CRITICAL — the `"."` entry is MANDATORY** (RESEARCH Open Q #11 + Pitfall "CRITICAL"): when ANY `"exports"` key is present, Node.js uses ONLY the exports map for `require('xci')` / `import 'xci'`. Without `"."`, tools probing the package root fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The `"bin"` field is separate and still respected for the CLI binary — adding `"."` costs nothing.

**KEEP unchanged:** `bin`, `files`, `scripts`, `dependencies`, `size-limit` (Phase 6 D-15; `dsl.mjs` is NOT size-gated, only `cli.mjs`), `devDependencies`.

---

### `packages/server/src/db/schema.ts` (MODIFIED — 4 new tables + bytea customType)

**Analog (same file):** Phase 7/8 extensions — existing tables `orgs`, `users`, `agents`, `agentCredentials` demonstrate the patterns (text PK, FK with CASCADE, timestamps with `withTimezone: true`, partial unique indexes).

**NEW — bytea customType** (RESEARCH §FA-4 + Pitfall 5 — must wrap with `Buffer.from` for postgres-js compat):
```typescript
import { customType } from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() { return 'bytea'; },
  toDriver(value: Buffer): Buffer { return Buffer.from(value); },
  fromDriver(value: Buffer | Uint8Array): Buffer { return Buffer.from(value); },
});
```

**Schema — tasks table (D-07):**
```typescript
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),                          // xci_tsk_<rand>
    orgId: text('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    yamlDefinition: text('yaml_definition').notNull(),    // D-09 — raw text, parsed on demand
    labelRequirements: jsonb('label_requirements').$type<string[]>().notNull().default([]),
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tasks_org_name_unique').on(t.orgId, t.name)],
);
```

**Schema — org_deks table (D-14):** 1:1 with orgs, bytea columns for wrap material.

**Schema — secrets table (D-16):**
```typescript
export const secrets = pgTable(
  'secrets',
  {
    id: text('id').primaryKey(),                          // xci_sec_<rand>
    orgId: text('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    iv: bytea('iv').notNull(),
    authTag: bytea('auth_tag').notNull(),
    aad: text('aad').notNull(),                           // "<orgId>:<name>" — location binding (D-16)
    createdByUserId: text('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('secrets_org_name_unique').on(t.orgId, t.name)],
);
```

**Schema — secret_audit_log table (D-21):**
```typescript
export const secretAuditLog = pgTable(
  'secret_audit_log',
  {
    id: text('id').primaryKey(),                          // xci_sal_<rand>
    orgId: text('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
    secretId: text('secret_id'),                          // nullable — tombstone after delete
    secretName: text('secret_name').notNull(),            // denormalized — survives deletion
    action: text('action', { enum: ['create', 'update', 'rotate', 'delete', 'resolve'] }).notNull(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('secret_audit_log_org_created_idx').on(t.orgId, sql`created_at DESC`)],
);
```

**Migration generation (D-36):** `pnpm --filter @xci/server exec drizzle-kit generate --name tasks_secrets` (RESEARCH Pitfall 9 — the `--name` flag produces a clean `0002_tasks_secrets.sql` filename instead of a hash suffix).

**Inferred types** — append 8 new `$inferSelect`/`$inferInsert` exports (mirror existing lines 237-258).

---

### `packages/server/src/crypto/secrets.ts` (GREENFIELD service — 5 functions)

**Structural analog:** `packages/server/src/crypto/tokens.ts` (45 lines) — zero-dep `node:crypto` module with narrow exported helpers, tight file comment on discipline (`NEVER log the return value`), explicit type annotations.

**Module shape** (mirror tokens.ts discipline):
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { orgDeks } from '../db/schema.js';
import { SecretDecryptError } from '../errors.js';

// AAD constant for DEK-under-MEK wrap (D-16 — location binding applies to secret values only)
const DEK_WRAP_AAD = Buffer.from('dek-wrap', 'utf8');

export function encryptSecret(dek: Buffer, plaintext: string, aad: string): {
  ciphertext: Buffer; iv: Buffer; tag: Buffer;
} { /* ... */ }

export function decryptSecret(
  dek: Buffer, ciphertext: Buffer, iv: Buffer, tag: Buffer, aad: string
): string { /* ... */ }

export function wrapDek(mek: Buffer, dek: Buffer): { wrapped: Buffer; iv: Buffer; tag: Buffer } { /* ... */ }
export function unwrapDek(mek: Buffer, wrapped: Buffer, iv: Buffer, tag: Buffer): Buffer { /* ... */ }

export async function getOrCreateOrgDek(
  db: PostgresJsDatabase, orgId: string, mek: Buffer
): Promise<Buffer> { /* ... */ }
```

**Encrypt pattern — RESEARCH §FA-2 (VERIFIED live Node 22):**
```typescript
export function encryptSecret(dek: Buffer, plaintext: string, aad: string) {
  const iv = randomBytes(12);                              // SEC-02 — 12 bytes per NIST SP 800-38D; NEVER fixed
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));                 // D-16 — `${orgId}:${name}` binding
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();                         // 16 bytes (default GCM tag)
  return { ciphertext, iv, tag };
}
```

**Decrypt pattern — CRITICAL ORDER (RESEARCH Pitfall 1):**
```typescript
export function decryptSecret(dek, ciphertext, iv, tag, aad): string {
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);                                // MUST precede update/final (Pitfall 1)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretDecryptError();                        // SEC-03 — no leak of tag/iv/plaintext
  }
}
```

**Idempotent get-or-create DEK (D-15):**
```typescript
export async function getOrCreateOrgDek(db, orgId, mek): Promise<Buffer> {
  const rows = await db.select().from(orgDeks).where(eq(orgDeks.orgId, orgId)).limit(1);
  if (rows[0]) {
    return unwrapDek(mek, rows[0].wrappedDek, rows[0].wrapIv, rows[0].wrapTag);
  }
  const dek = randomBytes(32);
  const { wrapped, iv, tag } = wrapDek(mek, dek);
  await db.insert(orgDeks).values({
    orgId, wrappedDek: wrapped, wrapIv: iv, wrapTag: tag, mekVersion: 1,
  });
  return dek;
}
```

**Discipline mirror (tokens.ts comments → secrets.ts comments):**
- `// NEVER log the return value` header on each function returning plaintext or a key
- Constant `DEK_WRAP_AAD` defined once, reused — no magic strings
- All operations centralized; NO inline crypto in repos/routes/services

---

### `packages/server/src/repos/tasks.ts` (service, CRUD — org-scoped repo)

**Analog (exact):** `packages/server/src/repos/users.ts` (factory shape, lines 5-31) + `packages/server/src/repos/org-invites.ts` (mutation with `satisfies NewXxx`, lines 14-28, 66-78).

**Copy pattern — factory header** (`packages/server/src/repos/users.ts` lines 1-5):
```typescript
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { tasks, type NewTask } from '../db/schema.js';
import { generateId } from '../crypto/tokens.js';

export function makeTasksRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async list() { /* org-scoped select */ },
    async getById(taskId: string) { /* and(eq(tasks.orgId, orgId), eq(tasks.id, taskId)) */ },
    async create(params: {...}) { /* generateId('tsk') + satisfies NewTask + insert */ },
    async update(taskId: string, params: {...}) { /* where(and(eq(orgId), eq(id))) */ },
    async delete(taskId: string) { /* where(and(eq(orgId), eq(id))) */ },
  };
}

export type TasksRepo = ReturnType<typeof makeTasksRepo>;
```

**Copy pattern — mutation with satisfies** (org-invites.ts lines 14-28):
```typescript
async create(params: { name: string; description: string; yamlDefinition: string; labelRequirements: string[]; createdByUserId: string }) {
  const id = generateId('tsk');
  const payload = { id, orgId, ...params } satisfies NewTask;
  try {
    await db.insert(tasks).values(payload);
  } catch (err) {
    const pgCode = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === '23505') throw new TaskNameConflictError();    // Pitfall 7 — PG 23505 → 409 not 500
    throw new DatabaseError('tasks.create failed', err);
  }
  return { id };
},
```

**D-01 constraint:** `makeTasksRepo` is NEVER added to `packages/server/src/repos/index.ts`. Only `forOrg(orgId).tasks` (via extended `for-org.ts`) is reachable from routes.

**Token prefix:** Extend the `generateId` prefix union in `packages/server/src/crypto/tokens.ts` with `'tsk' | 'sec' | 'sal'` (task, secret, secret-audit-log).

---

### `packages/server/src/repos/secrets.ts` (service, CRUD — with encryption inside the repo)

**Analog (mostly exact):** `packages/server/src/repos/org-invites.ts` for the factory shape + conditional-WHERE mutation patterns. **Divergence:** encryption happens inside this repo via `crypto/secrets.ts`.

**Copy pattern — conditional-WHERE on delete** (`packages/server/src/repos/org-invites.ts` lines 66-78, `revoke` method).

**Method shape (greenfield combination, not a direct analog):**
```typescript
export function makeSecretsRepo(db: PostgresJsDatabase, orgId: string, mek: Buffer) {
  return {
    async list() {
      // METADATA ONLY — never ciphertext, never aad, never auth_tag
      return db.select({
        id: secrets.id, name: secrets.name,
        createdAt: secrets.createdAt, updatedAt: secrets.updatedAt, lastUsedAt: secrets.lastUsedAt,
      }).from(secrets).where(eq(secrets.orgId, orgId));
    },

    async create(params: { name: string; value: string; createdByUserId: string }) {
      return db.transaction(async (tx) => {
        const dek = await getOrCreateOrgDek(tx, orgId, mek);
        const aad = `${orgId}:${params.name}`;
        const { ciphertext, iv, tag } = encryptSecret(dek, params.value, aad);
        const id = generateId('sec');
        try {
          await tx.insert(secrets).values({
            id, orgId, name: params.name, ciphertext, iv, authTag: tag, aad,
            createdByUserId: params.createdByUserId,
          });
        } catch (err) {
          const pgCode = (err as {code?:string})?.code ?? (err as {cause?:{code?:string}})?.cause?.code;
          if (pgCode === '23505') throw new SecretNameConflictError();
          throw new DatabaseError('secrets.create failed', err);
        }
        await tx.insert(secretAuditLog).values({                // D-22 — same transaction
          id: generateId('sal'), orgId, secretId: id, secretName: params.name,
          action: 'create', actorUserId: params.createdByUserId,
        });
        return { id };
      });
    },

    async resolveByName(name: string, actorUserId: string | null): Promise<string> {
      // ONLY method that returns plaintext; used at dispatch in Phase 10. Writes audit entry.
      // ...
    },

    async update(...) { /* re-encrypt with new IV; audit entry 'update' */ },
    async delete(secretId: string, actorUserId: string) { /* cascade audit + set secretId=null on audit row */ },
  };
}
```

**Critical: the MEK is passed in at repo construction time.** `for-org.ts` reads `fastify.mek` (decorated at boot — see app.ts MEK decorator pattern) and passes it into `makeSecretsRepo(db, orgId, mek)`. Never re-parse `fastify.config.XCI_MASTER_KEY` inside the repo (Pitfall 8).

**D-20 pino redaction discipline:** `params.value` is transient — scope to as small a closure as possible; never log `params` directly (the app.ts `req.body.value` redaction is the safety net, this is defense-in-depth).

---

### `packages/server/src/repos/admin.ts` (MODIFIED — DEK/MEK helpers)

**Analog (same file):** `signupTx` (lines 48-89) for atomic multi-row transactions; `findInviteByToken` (lines 100-103) for cross-org lookup shape.

**NEW helper 1 — `getOrgDek`** (cross-org, used by dispatch and rotation):
```typescript
async getOrgDek(orgId: string, mek: Buffer): Promise<Buffer> {
  return getOrCreateOrgDek(db, orgId, mek);   // delegates to crypto/secrets.ts
},
```

**NEW helper 2 — `rotateMek`** (D-25 atomic single-transaction rotation; mirror `signupTx` transaction pattern):
```typescript
async rotateMek(oldMek: Buffer, newMek: Buffer): Promise<{ rotated: number; mekVersion: number }> {
  let rotated = 0;
  let newVersion = 0;
  try {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(orgDeks).for('update');    // FOR UPDATE lock
      const firstVersion = rows[0]?.mekVersion ?? 0;
      newVersion = firstVersion + 1;
      for (const row of rows) {
        if (row.mekVersion >= newVersion) continue;                  // D-28 idempotency
        const dek = unwrapDek(oldMek, row.wrappedDek, row.wrapIv, row.wrapTag);
        const { wrapped, iv, tag } = wrapDek(newMek, dek);
        await tx.update(orgDeks)
          .set({ wrappedDek: wrapped, wrapIv: iv, wrapTag: tag, mekVersion: newVersion, updatedAt: sql`now()` })
          .where(eq(orgDeks.orgId, row.orgId));
        rotated++;
      }
    });
  } catch (err) {
    throw new MekRotationError('rotateMek transaction failed', err);
  }
  return { rotated, mekVersion: newVersion };
},
```

**D-26 acceptance test:** integration test creates N secrets across 2 orgs, calls `rotateMek`, decrypts every secret with the new MEK, and asserts plaintext unchanged.

---

### `packages/server/src/routes/tasks/create.ts` (controller — Owner/Member + CSRF + D-12 validation)

**Analog (exact shape):** `packages/server/src/routes/orgs/invites.ts` `invitesRoute` POST (lines 32-88).

**Copy pattern — route options + JSON schema + body validation** (invites.ts lines 32-48):
```typescript
fastify.post<{ Params: { orgId: string }; Body: CreateTaskBody }>(
  '/:orgId/tasks',
  {
    onRequest: [fastify.csrfProtection],
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['name', 'yamlDefinition'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string', maxLength: 2000, default: '' },
          yamlDefinition: { type: 'string', minLength: 1, maxLength: 1048576 },   // 1MB cap
          labelRequirements: { type: 'array', items: { type: 'string' }, default: [] },
        },
      },
    },
  },
  async (req, reply) => { /* D-12 validation pipeline */ },
);
```

**Copy pattern — role guard helper (AUTHZ_ROLE_INSUFFICIENT)** — write a parallel `requireOwnerOrMemberAndOrgMatch` helper (Phase 8 pattern) that allows `role === 'owner' || role === 'member'` (not viewer). Reuse existing `SessionRequiredError`, `OrgMembershipRequiredError`, `RoleInsufficientError`.

**D-12 validation pipeline (save-time) inside the handler:**
```typescript
import { parseYaml, validateCommandMap, validateAliasRefs } from 'xci/dsl';

// 1. YAML parse + normalize
const { commands, errors: parseErrors } = parseYaml(req.body.yamlDefinition);
if (parseErrors.length > 0) {
  throw new TaskValidationError(parseErrors.map(e => ({ line: e.line, column: e.column, message: e.message })));
}
// 2. Structural (covered by parseYaml — normalize throws CommandSchemaError internally)
// 3. Cycle detection
const { ok, errors: cycleErrors } = validateCommandMap(commands);
if (!ok) {
  throw new TaskValidationError(cycleErrors.map(e => ({ message: e.message, suggestion: e.suggestion })));
}
// 4. Unknown alias refs (NEW — validateAliasRefs, NOT covered by validateGraph)
const refErrors = validateAliasRefs(commands);
if (refErrors.length > 0) {
  throw new TaskValidationError(refErrors.map(e => ({ message: e.message, suggestion: e.suggestion })));
}
// 5. Placeholder SYNTAX only (just check `${...}` pattern matches — actual resolution at dispatch)

const repos = makeRepos(fastify.db);
const created = await repos.forOrg(orgId).tasks.create({ ...req.body, createdByUserId: userId });
return reply.status(201).send({ id: created.id });
```

**Error response shape (D-11) via error-handler.ts extension:**
```json
{ "error": { "code": "XCI_SRV_TASK_VALIDATION", "message": "...", "errors": [ { "line": 5, "column": 12, "message": "...", "suggestion": "did you mean 'X'?" } ] } }
```

---

### `packages/server/src/routes/secrets/create.ts` (controller — audit log in same tx)

**Analog (exact shape):** `packages/server/src/routes/orgs/invites.ts` POST.

**Copy pattern — same structure as tasks/create.ts, but body schema differs:**
```typescript
schema: {
  body: {
    type: 'object',
    required: ['name', 'value'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[A-Z][A-Z0-9_]*$' },
      value: { type: 'string', minLength: 1, maxLength: 65536 },   // 64KB cap per RESEARCH Open Q #9
    },
  },
},
```

**Response discipline — NO plaintext in response body** (D-19 architectural invariant):
```typescript
// FORBIDDEN: return reply.send({ id, value: params.value, ... })
// REQUIRED:
return reply.status(201).send({ id: created.id, name: req.body.name, createdAt: new Date().toISOString() });
```

**CI grep verification** (planner acceptance criterion):
```bash
grep -rnE '\b(value|ciphertext|dek|mek)\b.*reply\.send' packages/server/src/routes/secrets/   # must be empty
```

---

### `packages/server/src/routes/admin/rotate-mek.ts` (controller + NEW requirePlatformAdmin guard)

**Analog (exact shape):** `packages/server/src/routes/orgs/invites.ts` POST shape (CSRF + requireAuth + schema).

**Divergence:** uses NEW `requirePlatformAdmin` preHandler (greenfield middleware).

**Middleware pattern — `requirePlatformAdmin`** (analog: `requireOwnerAndOrgMatch` helper in `routes/orgs/invites.ts` lines 14-19; RESEARCH §Code Examples):
```typescript
// packages/server/src/plugins/require-platform-admin.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { SessionRequiredError, RoleInsufficientError } from '../errors.js';

export async function requirePlatformAdmin(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!req.user) throw new SessionRequiredError();
  const adminEmail = req.server.config.PLATFORM_ADMIN_EMAIL.toLowerCase();
  if (req.user.email.toLowerCase() !== adminEmail) {
    throw new RoleInsufficientError('owner');   // reuse existing; no new error class needed
  }
}
```

**Route shape:**
```typescript
fastify.post<{ Body: { newMekBase64: string } }>(
  '/rotate-mek',
  {
    onRequest: [fastify.csrfProtection],
    preHandler: [fastify.requireAuth, requirePlatformAdmin],
    schema: {
      body: {
        type: 'object', required: ['newMekBase64'], additionalProperties: false,
        properties: { newMekBase64: { type: 'string', minLength: 44, maxLength: 44, pattern: '^[A-Za-z0-9+/]{43}=$' } },
      },
    },
  },
  async (req, reply) => {
    const newMek = Buffer.from(req.body.newMekBase64, 'base64');
    if (newMek.length !== 32) throw new MekRotationError('new MEK must decode to 32 bytes');
    const oldMek = fastify.mek;   // decorated at boot
    const result = await makeRepos(fastify.db).admin.rotateMek(oldMek, newMek);
    return reply.status(200).send(result);
  },
);
```

**Pino redaction (D-20 / RESEARCH §FA-12):** `req.body.newMekBase64` MUST be in `redact.paths` before this route ships.

---

### `packages/server/src/repos/__tests__/tasks.isolation.test.ts` (test, CRUD — two-org isolation)

**Analog (exact):** `packages/server/src/repos/__tests__/users.isolation.test.ts` (Phase 7 pattern). Auto-discovered by `isolation-coverage.isolation.test.ts` (D-31 — Phase 7 D-04 meta-test).

**Copy verbatim — only adjust imports and assertions:**
```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeTasksRepo } from '../tasks.js';

describe('tasks repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('list scoped to orgA never returns orgB task', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoB = makeTasksRepo(db, f.orgB.id);
    await repoB.create({ name: 't1', yamlDefinition: 'x:\n  cmd: true', labelRequirements: [], createdByUserId: f.orgB.ownerUser.id, description: '' });
    const repoA = makeTasksRepo(db, f.orgA.id);
    expect(await repoA.list()).toEqual([]);
  });
  // ...one it() per exported method: getById, create, update, delete
});
```

**Convention:** every function returned by `makeTasksRepo` must have at least one two-org test. The auto-discovery meta-test (`isolation-coverage.isolation.test.ts`) greps `export function make\w+Repo` and asserts every method name appears in the test file — the test breaks on regression automatically.

---

### `biome.json` (MODIFIED — 2 new override blocks for cross-package import fence)

**Analog (same file):** existing first override (lines 48-69) blocks `'ws'` + `'reconnecting-websocket'` in `packages/xci/src/cli.ts` — same `noRestrictedImports.paths` shape.

**ADD override 4 — server blocks xci root + xci/agent** (RESEARCH §FA-10):
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

**ADD override 5 — xci blocks @xci/server (D-38 reverse-import fence):**
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

**Pitfall 6 reminder:** Biome `noRestrictedImports` `paths` is EXACT string matching, NOT globs. List `'xci'` and `'xci/agent'` explicitly; `'xci/dsl'` is intentionally absent (allowed).

**Acceptance verification:**
- `biome check packages/server/src/routes/tasks/create.ts` does NOT fire on `import { parseYaml } from 'xci/dsl'`
- `biome check packages/server/src/crypto/secrets.ts` FIRES if someone writes `import 'xci'` or `import 'xci/agent'`
- `biome check packages/xci/src/dsl/parser.ts` FIRES on `import '@xci/server'` (not that anyone would try)

---

### `packages/server/src/app.ts` (MODIFIED — redact paths + MEK decorator)

**Analog (same file):** existing `redact.paths` array (lines 35-49) + existing `app.decorate('agentRegistry', ...)` pattern (line 102).

**Change 1 — Extend `redact.paths`** (RESEARCH §FA-12; D-20):
```typescript
redact: {
  paths: [
    // ... existing Phase 7/8 paths ...
    'req.body.value',                      // POST/PATCH /secrets — redact before any log
    'req.body.newMekBase64',               // POST /admin/rotate-mek
    '*.ciphertext',
    '*.dek',
    '*.mek',
  ],
  censor: '[REDACTED]',
},
```

**Change 2 — MEK decorator** (Pitfall 8 — parse once at boot, never re-parse per request). Mirror `app.decorate('agentRegistry', new Map())` at line 102, but for MEK:
```typescript
// After fastifyEnv registers (line 62) and BEFORE any route registers:
const mek = Buffer.from(app.config.XCI_MASTER_KEY, 'base64');
if (mek.length !== 32) throw new Error('XCI_MASTER_KEY must decode to exactly 32 bytes');
app.decorate('mek', mek);
```

**Module augmentation** (extend existing `declare module 'fastify'` block at line 118):
```typescript
declare module 'fastify' {
  interface FastifyInstance {
    emailTransport: EmailTransport;
    agentRegistry: Map<string, WebSocket>;
    mek: Buffer;                                       // NEW (Phase 9)
  }
}
```

---

## Shared Patterns

### A. Phase 7 D-01 forOrg discipline (INHERITED — secrets/tasks/audit-log extend it unchanged)

**Source:** `packages/server/src/repos/for-org.ts` (33 lines — Phase 8 state with 9 factories).

**Extend with 3 new factories** — in the return object:
```typescript
tasks: makeTasksRepo(db, orgId),
secrets: makeSecretsRepo(db, orgId, mek),          // NOTE: needs MEK passed through
secretAuditLog: makeSecretAuditLogRepo(db, orgId),
```

**NEW wrinkle:** `makeSecretsRepo` needs `mek: Buffer` as a third arg. Two plausible planner approaches:
1. Pass `mek` as a 2nd arg to `makeForOrg`: `makeForOrg(db, mek)(orgId)` — requires updating `makeRepos` in `repos/index.ts`
2. Read `fastify.mek` inside each route handler and pass it at the call site: `makeRepos(fastify.db, fastify.mek).forOrg(orgId).secrets.create(...)`

Planner picks. Approach 2 is less invasive (preserves repo signatures everywhere else).

**D-01 enforcement (unchanged):** `makeTasksRepo`, `makeSecretsRepo`, `makeSecretAuditLogRepo` are NEVER exported from `repos/index.ts`. Only `forOrg(orgId).tasks` / `.secrets` / `.secretAuditLog` are reachable from routes — Biome (the existing third override, lines 70-110) catches any direct import.

### B. Error contract discipline (INHERITED from Phase 7 D-08)

**Source:** `packages/server/src/errors.ts` (328 lines — abstract base + area bases + concrete subclasses + exhaustive `httpStatusFor`).

**Apply to Phase 9 — 7 new concrete subclasses** (RESEARCH §FA-13):
- `TaskValidationError extends ValidationError` — code `XCI_SRV_TASK_VALIDATION`; adds `public readonly validationErrors: TaskValidationDetail[]` field
- `TaskNotFoundError extends NotFoundError` — code `NF_TASK`
- `TaskNameConflictError extends ConflictError` — code `CONFLICT_TASK_NAME`
- `SecretNotFoundError extends NotFoundError` — code `NF_SECRET`
- `SecretNameConflictError extends ConflictError` — code `CONFLICT_SECRET_NAME`
- `SecretDecryptError extends InternalError` — code `INT_SECRET_DECRYPT`; NO args in constructor (D-10 discipline — never leak tag/iv/ciphertext)
- `MekRotationError extends InternalError` — code `INT_MEK_ROTATION`; accepts `cause`

**oneOfEachConcrete()** update: add one instance of each new subclass to `packages/server/src/__tests__/errors.test.ts`. Code-uniqueness test auto-catches duplicates.

**Error handler extension (D-11):** `packages/server/src/plugins/error-handler.ts` must add:
```typescript
if (err instanceof TaskValidationError) {
  return reply.status(400).send({
    error: { code: err.code, message: err.message, errors: err.validationErrors },
  });
}
```

### C. Secrets-never-logged discipline (INHERITED from Phase 7 D-10 + Phase 1 P02)

**Source:** `packages/server/src/app.ts` `redact.paths` (lines 36-49).

**Apply to Phase 9:**
1. Extend `redact.paths` per above (FA-12)
2. Error constructors never accept plaintext args — `SecretDecryptError` takes NO args; `MekRotationError` accepts a short `message` + `cause` but NEVER a key/IV/tag
3. CI grep on routes/secrets (planner acceptance criterion): `grep -rnE '\b(value|ciphertext|dek|mek)\b.*reply\.send' packages/server/src/routes/secrets/` → empty

### D. Per-route CSRF opt-in (INHERITED from Phase 7 D-34)

**Source:** `packages/server/src/routes/orgs/invites.ts` line 35: `onRequest: [fastify.csrfProtection]`.

**Apply to:** ALL mutating Phase 9 routes (POST/PATCH/DELETE) — tasks create/update/delete, secrets create/update/delete, admin rotate-mek. GET tasks list/get, GET secrets list, GET secret-audit-log do NOT need CSRF (reads).

### E. testcontainers + seedTwoOrgs fixture (INHERITED from Phase 7 D-20..22)

**Source:** `packages/server/src/test-utils/two-org-fixture.ts` + `db-harness.ts`.

**Apply to 3 new isolation tests** (`tasks.isolation.test.ts`, `secrets.isolation.test.ts`, `secret-audit-log.isolation.test.ts`):
- Inline-seed tasks/secrets per org in each test (mirror `org-invites.isolation.test.ts` style — DON'T extend seedTwoOrgs signature)
- Cross-org assertion shape: `it('<fn> scoped to orgA never returns orgB <entity>')`

### F. Auto-discovery meta-test enforces D-04 (INHERITED — NO code change required)

**Source:** `packages/server/src/repos/__tests__/isolation-coverage.isolation.test.ts` (Phase 7).

**Applies automatically** to `tasks.ts`, `secrets.ts`, `secret-audit-log.ts` once committed (scans `repos/` dir, excludes `index.ts`/`for-org.ts`/`admin.ts`; asserts every `makeXxxRepo` name has a `<name>.isolation.test.ts` peer). Planner acceptance criterion: committing the 3 new repo files WITHOUT the isolation tests must fail the integration suite loudly.

### G. Test conventions (INHERITED)

- Colocate in `<module-dir>/__tests__/`
- `.js` suffix on relative imports (`import { makeTasksRepo } from '../tasks.js'`)
- `*.test.ts` for unit (no DB); `*.isolation.test.ts` for two-org repo isolation (integration config); `*.integration.test.ts` for HTTP + DB

---

## Phase 6 Fence Relaxation Checklist (D-37 / D-38 — cross-package import)

Phase 8 narrowed the ws-fence to `cli.ts` only and extended the D-01 repo-restriction Biome rule with agent repos. **Phase 9 introduces the FIRST legitimate `@xci/server ← xci/dsl` cross-package import.** The planner MUST order the supporting changes such that every commit leaves CI green:

| # | File | Change | After-State Verification |
|---|------|--------|--------------------------|
| 1 | `packages/xci/src/dsl/` (NEW dir) | Add 6 files: `index.ts`, `parser.ts`, `validate.ts`, `interpolate.ts`, `levenshtein.ts`, `types.ts` | `ls packages/xci/src/dsl/*.ts` shows all 6; tests can import from `../dsl/index.js` |
| 2 | `packages/xci/tsup.config.ts` (line 7) | Add `dsl: 'src/dsl/index.ts'` to entry; flip `dts: false` → `dts: true` | `pnpm --filter xci build` emits `dist/dsl.mjs` + `dist/dsl.d.ts` + `dist/cli.d.ts` + `dist/agent.d.ts` |
| 3 | `packages/xci/package.json` | Add `"exports"` map with 3 entries including `"."` (CRITICAL per Open Q #11); do NOT touch `"bin"` | `node -e 'require("xci/dsl")'` works after build; `node -e 'require("xci")'` still resolves to the CLI binary |
| 4 | `packages/xci/src/dsl/__tests__/facade.test.ts` | Smoke tests per RESEARCH §FA-15 | `pnpm --filter xci test` passes; ~321 v1 tests still green (D-40) |
| 5 | `packages/xci/` size-limit verification (D-41) | `cli.mjs` cold-start still <300ms; `dsl.mjs` is opt-in | `hyperfine 'xci --version'` mean <300ms; `wc -c dist/dsl.mjs` < 100KB (Pitfall 4) |
| 6 | `packages/server/package.json` | Add `"xci": "workspace:*"` to `dependencies` | `pnpm install` succeeds; `pnpm --filter @xci/server list` shows `xci` |
| 7 | `biome.json` (APPEND override 4) | Block `'xci'` + `'xci/agent'` imports from `packages/server/src/**` | `biome check` FIRES on `import 'xci'` in server code; does NOT fire on `import 'xci/dsl'` |
| 8 | `biome.json` (APPEND override 5) | Block `'@xci/server'` imports from `packages/xci/src/**` | `biome check` FIRES if someone writes `import '@xci/server'` anywhere in xci |
| 9 | `packages/server/src/routes/tasks/create.ts` | FIRST import from `xci/dsl` — `import { parseYaml, validateCommandMap, validateAliasRefs } from 'xci/dsl'` | Typecheck succeeds; route handler runs validation pipeline |
| 10 | `.changeset/*.md` | Add changeset (feat) describing dsl subpath export + tasks/secrets subsystems | Fixed-versioning per Phase 6 D-11 |

**Acceptance gates (must all pass):**
- `pnpm --filter xci test` — all v1 tests green (BC-01, D-40)
- `pnpm --filter xci build` — emits `cli.mjs`, `agent.mjs`, `dsl.mjs` + all 3 `.d.ts`
- `hyperfine 'node packages/xci/dist/cli.mjs --version'` mean <300ms (D-41)
- `pnpm --filter @xci/server typecheck` — succeeds with `xci/dsl` resolved via subpath
- `pnpm --filter @xci/server test:integration` — tasks/secrets/audit-log CRUD + encryption roundtrip + MEK rotation all pass
- `pnpm biome check .` — no violations; new overrides fire on synthetic `import 'xci'` / `import '@xci/server'` tests

---

## Do NOT List (regressions the planner MUST encode as acceptance criteria)

Explicit anti-patterns — verify via tests, CI, or code review:

1. **Do NOT reimplement the YAML parser, cycle detector, or interpolator in `dsl/`.** D-05: the dsl module is a re-export facade over existing `commands/normalize.ts`, `commands/validate.ts`, `resolver/interpolate.ts`. The SOLE new logic is `validateAliasRefs` + `suggest` + `levenshtein` — everything else delegates (RESEARCH Pitfall 10).
2. **Do NOT import from `xci/dsl` via `../commands/index.js` (the full loader).** Pitfall 4 — `commands/index.ts` transitively imports `resolveMachineConfigDir` which pulls in the entire config stack. `dsl/parser.ts` must import `normalizeCommands` directly from `../commands/normalize.js`. Verify `dist/dsl.mjs` size < 100KB.
3. **Do NOT return plaintext secret value from ANY API endpoint.** D-19 architectural invariant. Verify with CI grep: `grep -rnE '\b(value|ciphertext|dek|mek)\b.*reply\.send' packages/server/src/routes/secrets/` → empty. `list`, `get`, and even `create` response bodies return only metadata (id, name, timestamps).
4. **Do NOT skip `setAAD` on encrypt/decrypt.** D-16 — `aad = ${orgId}:${name}` is the location-binding security control. Without it, a DB-level row move (secret copied to another org) would decrypt under the wrong DEK (RESEARCH §FA-3). The DEK-under-MEK wrap uses a constant AAD (`'dek-wrap'`) — different purpose.
5. **Do NOT reuse IVs.** SEC-02 + Pitfall 2 — reusing (key, IV) with AES-GCM catastrophically breaks both confidentiality and authenticity. `randomBytes(12)` on EVERY encrypt call. Unit test asserts `notDeepEqual(encrypt(k,'x').iv, encrypt(k,'x').iv)`.
6. **Do NOT call `setAuthTag` AFTER `update` or `final`.** Pitfall 1 + RESEARCH §FA-2 — Node throws "Attempting to finalize ciphertext before setting auth tag". Correct order: `createDecipheriv → setAAD → setAuthTag → update → final`.
7. **Do NOT import `xci` (root) or `xci/agent` from `@xci/server`.** D-37 + biome override 4. Only `xci/dsl` is permitted.
8. **Do NOT import anything from `@xci/server` into `packages/xci/`.** D-38 + biome override 5. Reverse dependency forbidden — would break the CLI cold-start budget and create circular workspace deps.
9. **Do NOT omit the `"."` entry in `packages/xci/package.json` exports map.** RESEARCH Open Q #11 — Node treats the exports map as exhaustive once any key is added; without `"."`, `require('xci')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
10. **Do NOT parse `XCI_MASTER_KEY` inside crypto helpers or per-request.** Pitfall 8 + RESEARCH §FA-9. Parse ONCE at boot via `app.decorate('mek', Buffer.from(...))` and pass `fastify.mek` to the repo factory. Never pass the 44-char base64 string to `createCipheriv` directly (`RangeError: Invalid key length`).
11. **Do NOT store binary data as text/base64.** RESEARCH §FA-4. Use Drizzle `customType` bytea (wrap `fromDriver` with `Buffer.from(value)` for Uint8Array safety per Pitfall 5).
12. **Do NOT rename secrets.** D-19 + Pitfall 3 — AAD is computed from `${orgId}:${name}` at encrypt time. Rename breaks decryption. PATCH body only accepts `value`. If future phases add rename, they must re-encrypt under new AAD.
13. **Do NOT write audit-log entries outside the mutation transaction.** D-22 — both `secrets.insert` and `secretAuditLog.insert` MUST be inside the same `db.transaction(async tx => {...})`. A FK failure on audit → entire secret creation rolls back.
14. **Do NOT allow concurrent MEK rotations.** D-25 — single Postgres transaction + `FOR UPDATE` lock on `org_deks`. The D-28 idempotency check (`row.mekVersion >= newVersion → continue`) covers retry after clean commit; the lock covers concurrent-call race.
15. **Do NOT export `makeTasksRepo` / `makeSecretsRepo` / `makeSecretAuditLogRepo` from `repos/index.ts`.** D-01 + Biome third override. The only exports from `index.ts` are `forOrg` and `admin`.
16. **Do NOT skip `validateAliasRefs`.** D-12 step 4 — `validateGraph` detects cycles but intentionally does NOT check unknown alias references (Pitfall 10). Calling only `validateCommandMap` (which wraps `validateGraph`) leaves unknown-alias errors undetected, breaking TASK-04.
17. **Do NOT bundle xci/cli code into `dist/dsl.mjs`.** Pitfall 4 + D-39. Verify: `grep -c 'commander' packages/xci/dist/dsl.mjs === 0`; `wc -c packages/xci/dist/dsl.mjs < 102400`.
18. **Do NOT break BC-01.** All ~321 Phase 1/8 xci tests must continue to pass unchanged. The dsl extraction is a pure facade; existing `commands/__tests__/` and `resolver/__tests__/` suites must stay green (D-40).
19. **Do NOT skip `dts: true`.** RESEARCH §FA-1 + §FA-11. The `@xci/server` TypeScript consumer resolves `xci/dsl` via the `"types"` condition pointing at `dist/dsl.d.ts`. Without declarations, `tsc -b` in server fails with "Could not find a declaration file for module 'xci/dsl'".
20. **Do NOT use `'xci/dsl'` as a regex or glob in biome.** Pitfall 6 — `noRestrictedImports.paths` is exact-string keys. Only `'xci'` and `'xci/agent'` are listed (both blocked); `'xci/dsl'` is absent (allowed by default).

---

## No Analog Found — GREENFIELD modules

These files have NO existing repo code to mirror; their patterns come entirely from RESEARCH.md:

| File | Source Section in RESEARCH.md |
|------|-------------------------------|
| `packages/server/src/crypto/secrets.ts` | §FA-2 (AES-GCM API), §FA-3 (envelope encryption) |
| `packages/xci/src/dsl/levenshtein.ts` | §FA-8 (30-line hand-rolled DP) |
| `packages/xci/src/dsl/parser.ts` (lenient wrapper shape) | §FA-7 + Open Q #7 |
| `packages/xci/src/dsl/validate.ts` `validateAliasRefs` | §FA-7 + Pitfall 10 |
| `packages/server/src/plugins/require-platform-admin.ts` | §Code Examples `requirePlatformAdmin` |
| `packages/server/src/routes/admin/rotate-mek.ts` | §FA-6 + D-24/D-25 |
| `packages/server/src/services/dispatch-resolver.ts` | §Code Examples `resolveTaskParams` |
| `packages/server/src/db/schema.ts` `bytea` customType | §FA-4 |

---

## Metadata

**Analog search scope:** `packages/xci/src/**`, `packages/server/src/**`, root-level config (`biome.json`, `tsup.config.ts`, package.json files), Phase 7 PATTERNS.md + Phase 8 PATTERNS.md (inheritance baseline).

**Files scanned:** 19 project files read — `packages/xci/package.json`, `packages/xci/tsup.config.ts`, `packages/xci/src/commands/index.ts`, `packages/xci/src/commands/validate.ts`, `packages/xci/src/commands/normalize.ts` (head), `packages/xci/src/resolver/interpolate.ts`, `packages/xci/src/types.ts`; `packages/server/src/repos/users.ts`, `packages/server/src/repos/org-invites.ts`, `packages/server/src/repos/admin.ts`, `packages/server/src/repos/for-org.ts`, `packages/server/src/repos/index.ts`, `packages/server/src/routes/orgs/invites.ts`, `packages/server/src/db/schema.ts`, `packages/server/src/errors.ts`, `packages/server/src/crypto/tokens.ts`, `packages/server/src/config/env.schema.ts`, `packages/server/src/app.ts`; `biome.json`. Plus CONTEXT.md (44 locked decisions), RESEARCH.md (1299 lines across §FA-1..FA-15 + Pitfalls 1-10 + Open Questions 1-11), Phase 7 PATTERNS.md (900 lines), Phase 8 PATTERNS.md (1039 lines).

**Inheritance chain:** Phase 1 error/test discipline → Phase 6 fence → Phase 7 server foundation (forOrg, adminRepo, XciServerError hierarchy, testcontainers, auto-discovery) → Phase 8 WS + fence narrowing → Phase 9 cross-package import via subpath export + crypto subsystem + task/secret subsystems.

**Pattern extraction date:** 2026-04-18

---

## PATTERN MAPPING COMPLETE
