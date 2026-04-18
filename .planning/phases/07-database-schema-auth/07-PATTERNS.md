# Phase 7: Database Schema & Auth - Pattern Map

**Mapped:** 2026-04-18
**Files analyzed:** ~40 new files + 2 modified (`.github/workflows/ci.yml`, `packages/server/package.json`)
**Analogs found:** 7 files map to existing `packages/xci/` analogs / 33+ files are greenfield (no analog — new server pattern)
**Source of truth:** CONTEXT.md D-01..D-39 (locked), RESEARCH.md "Recommended Project Structure" + "Sequencing" sections (waves 0-9).

---

## Framing

Phase 7 introduces **the first real code in `packages/server/`** — a brand-new Fastify/Drizzle/Postgres package. The current stub (`packages/server/package.json` + `src/index.ts` echo-noops) gets **replaced wholesale**. Most files have NO direct analog in this repo because the server didn't exist before; the planner must propose patterns from RESEARCH.md rather than copy from `packages/xci/`.

The analogs that DO exist are all **package-skeleton / convention** patterns:
- `package.json` shape (scripts, type:module, engines)
- `tsconfig.json` (extends base)
- `vitest.config.ts` (shape + include globs)
- `errors.ts` (XciError hierarchy → XciServerError)
- `types.ts` (type-only contracts file)
- Test file conventions (colocated `__tests__/`, `.js` suffix imports, `oneOfEachConcrete()` factory style)
- Biome `noRestrictedImports` override in `biome.json`

**Divergences from xci the planner MUST NOT copy blindly** (called out in each section below):
1. **No tsup bundling.** Server uses `tsc --build` → per-file `.js` + `.d.ts` in `dist/`. Servers don't have cold-start pressure; bundling obscures stack traces (RESEARCH §Alternatives).
2. **No shebang banner, no `bin` field.** `server.ts` is an executable module but not a CLI — launched via `node dist/server.js` or `tsx src/server.ts` in dev.
3. **No size-limit config** on the server package (budget is a xci concern only, per Phase 6 D-15).
4. **Two vitest configs, not one** — unit vs integration split per D-24 (integration is Linux-only per D-23).
5. **No `external: ['ws', ...]` tsup config** — there's no tsup at all; the fence applies to `packages/xci/` only (Phase 6 D-16).

---

## File Classification

### New files — Package skeleton (Wave 0)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/package.json` | config | — | `packages/xci/package.json` | partial (scripts/engines/type match; build tool + bin diverge) |
| `packages/server/tsconfig.json` | config | — | `packages/xci/tsconfig.json` | role-match (extends base; add `outDir`+`noEmit:false`) |
| `packages/server/drizzle.config.ts` | config | — | — | no analog (new pattern from RESEARCH §"drizzle.config.ts") |
| `packages/server/vitest.unit.config.ts` | config (test) | — | `packages/xci/vitest.config.ts` | role-match (tighter `include`; no DB) |
| `packages/server/vitest.integration.config.ts` | config (test) | — | `packages/xci/vitest.config.ts` | partial (adds `globalSetup`/`globalTeardown`, `isolate:false`, longer timeout) |
| `packages/server/.env.example` | config (docs) | — | — | no analog |
| `packages/server/src/index.ts` (replace) | barrel | — | `packages/xci/src/cli.ts` (entry concept only) | no analog — delete/repurpose stub |

### New files — Database foundation (Wave 1)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/db/schema.ts` | model | — | — | no analog (Drizzle pg-core; pattern from RESEARCH §"Drizzle schema (pg-core) — AUTH tables") |
| `packages/server/src/db/relations.ts` | model | — | — | no analog (pattern from RESEARCH §"Drizzle relations") |
| `packages/server/src/db/migrator.ts` | service | file-I/O | — | no analog (pattern from RESEARCH §"Programmatic migrator at boot") |
| `packages/server/src/db/plugin.ts` | plugin | request-response | — | no analog (Fastify plugin pattern) |
| `packages/server/drizzle/0000_initial.sql` | migration | — | — | no analog (generated, committed) |
| `packages/server/drizzle/meta/*` | migration | — | — | no analog (generated, committed) |

### New files — Test harness (Wave 2)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/test-utils/db-harness.ts` | utility (test) | — | — | no analog (testcontainers pattern from RESEARCH §"testcontainers harness") |
| `packages/server/src/test-utils/two-org-fixture.ts` | utility (test) | CRUD | — | no analog (D-04 pattern from RESEARCH §"Two-org fixture") |
| `packages/server/src/test-utils/global-setup.ts` | utility (test) | — | — | no analog |
| `packages/server/src/test-utils/global-teardown.ts` | utility (test) | — | — | no analog |

### New files — Crypto primitives (Wave 3)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/crypto/tokens.ts` | utility | transform | — | no analog (pattern from RESEARCH §"Token generator") |
| `packages/server/src/crypto/password.ts` | utility | transform | — | no analog (pattern from RESEARCH §"@node-rs/argon2 password service") |
| `packages/server/src/crypto/__tests__/tokens.test.ts` | test | — | `packages/xci/src/__tests__/errors.test.ts` | partial (test style + `.js` imports only) |
| `packages/server/src/crypto/__tests__/password.test.ts` | test | — | `packages/xci/src/__tests__/errors.test.ts` | partial |

### New files — Scoped repos (Wave 4)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/repos/users.ts` | service (repo) | CRUD | — | no analog (pattern from RESEARCH §"Scoped repository wrapper" — `makeUsersRepo`) |
| `packages/server/src/repos/sessions.ts` | service (repo) | CRUD | — | no analog (same pattern as users.ts) |
| `packages/server/src/repos/email-verifications.ts` | service (repo) | CRUD | — | no analog |
| `packages/server/src/repos/password-resets.ts` | service (repo) | CRUD | — | no analog |
| `packages/server/src/repos/org-invites.ts` | service (repo) | CRUD | — | no analog |
| `packages/server/src/repos/org-plans.ts` | service (repo) | CRUD | — | no analog |
| `packages/server/src/repos/for-org.ts` | service (factory) | — | — | no analog (composition factory — D-01) |
| `packages/server/src/repos/admin.ts` | service (repo) | CRUD, batch | — | no analog (cross-org `signupTx`, counts — D-03) |
| `packages/server/src/repos/index.ts` | barrel | — | — | no analog (the ONLY exported file; D-01 gate) |
| `packages/server/src/repos/__tests__/<name>.isolation.test.ts` (×6+) | test | CRUD | — | no analog (D-04 two-org fixture — RESEARCH §"users.isolation.test.ts") |
| `packages/server/src/repos/__tests__/isolation-coverage.test.ts` | test (meta) | file-I/O | — | no analog (auto-discovery meta-test — RESEARCH §"Option A") |

### New files — Errors, email, env (Wave 5)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/errors.ts` | model | — | `packages/xci/src/errors.ts` | **exact structural match** (mirror hierarchy discipline for `XciServerError`) |
| `packages/server/src/__tests__/errors.test.ts` | test | — | `packages/xci/src/__tests__/errors.test.ts` | **exact** (mirror `oneOfEachConcrete()`, code-uniqueness, instanceof chain tests) |
| `packages/server/src/config/env.schema.ts` | config | — | — | no analog (JSON schema + module augmentation — RESEARCH §"@fastify/env JSON schema") |
| `packages/server/src/email/transport.ts` | service | event-driven | — | no analog (pattern from RESEARCH §"Nodemailer abstract transport") |
| `packages/server/src/email/templates/verify-email.ts` | template | transform | — | no analog (TS literal factory — RESEARCH §"verify-email.ts") |
| `packages/server/src/email/templates/password-reset.ts` | template | transform | — | same shape as verify-email |
| `packages/server/src/email/templates/invite.ts` | template | transform | — | same shape |
| `packages/server/src/email/templates/invite-revoked.ts` | template | transform | — | same shape |
| `packages/server/src/email/templates/owner-changed.ts` | template | transform | — | same shape |

### New files — App factory + plugins (Wave 6)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/app.ts` | config (factory) | — | — | no analog (RESEARCH §"Fastify v5 app factory") |
| `packages/server/src/server.ts` | entry | — | `packages/xci/src/cli.ts` (entry-point concept only) | role-match (both are entry points; one is CLI the other is HTTP listener — **do NOT copy shebang/banner/tsup** from xci) |
| `packages/server/src/plugins/auth.ts` | middleware | request-response | — | no analog (RESEARCH §"Auth plugin") |
| `packages/server/src/plugins/error-handler.ts` | middleware | request-response | — | no analog |
| `packages/server/src/plugins/__tests__/auth.test.ts` | test | request-response | — | no analog |

### New files — Routes (Wave 7)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/routes/auth/signup.ts` | controller | request-response | — | no analog (RESEARCH §"Per-route rate limit — signup") |
| `packages/server/src/routes/auth/login.ts` | controller | request-response | — | no analog (same pattern, different keyGenerator) |
| `packages/server/src/routes/auth/logout.ts` | controller | request-response | — | no analog |
| `packages/server/src/routes/auth/verify-email.ts` | controller | request-response | — | no analog |
| `packages/server/src/routes/auth/request-reset.ts` | controller | request-response | — | no analog |
| `packages/server/src/routes/auth/reset.ts` | controller | request-response | — | no analog |
| `packages/server/src/routes/orgs/invites.ts` | controller | CRUD | — | no analog |
| `packages/server/src/routes/invites/accept.ts` | controller | request-response | — | no analog |
| `packages/server/src/routes/index.ts` | barrel | — | — | no analog |
| `packages/server/src/routes/**/__tests__/*.integration.test.ts` | test | request-response | — | no analog (`fastify.inject()` pattern per D-24) |

### Modified files

| Modified File | Role | Change | Analog for change |
|---------------|------|--------|-------------------|
| `.github/workflows/ci.yml` | config (CI) | Add third job `integration-tests` (Linux-only, `needs: [build-test-lint]`) | Existing `fence-gates` job (lines 45-102) is the template: Linux-only, pnpm+node setup, then server-specific steps |
| `biome.json` (root) | config (lint) | Add a second override block for `packages/server/src/**` (see "Shared Patterns" below) | Existing `packages/xci/src/**` override (lines 47-68) — same shape, different paths |
| `turbo.json` | config (build) | Optionally add `test:integration` task; possibly adjust `test` deps for server | Existing task graph (lines 3-17) — planner decides |
| `.changeset/*.md` | changelog | First `@xci/server` changeset (feat, minor) | No analog yet (first server changeset in repo) |

---

## Pattern Assignments

### `packages/server/package.json` (config)

**Analog:** `packages/xci/package.json`

**What to mirror:**

- `type: "module"` (ESM-only)
- `engines.node: ">=20.5.0"` (matches Node floor; execa@9 also requires it but server doesn't use execa — it's the repo-wide floor per Phase 1 + CLAUDE.md)
- `scripts` shape: `build`, `lint`, `lint:fix`, `test`, `test:watch`, `typecheck` — **one-for-one mirror with renamed commands**
- `version: "0.0.0"` until first publish (Phase 14)

**Mirror excerpt** (`packages/xci/package.json` lines 2-20):
```json
{
  "name": "xci",
  "version": "0.0.0",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20.5.0" },
  "bin": { "xci": "./dist/cli.mjs" },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    ...
  },
  ...
}
```

**Divergences the planner MUST encode:**

1. **`name: "@xci/server"`** (scoped; see Phase 6 D-14 — scope already used).
2. **`private: false`** (flip from Phase 6 stub — CONTEXT D-30 in Phase 6, explicit in Phase 7 CONTEXT line 30).
3. **No `bin` field** — server is not a CLI.
4. **No `size-limit` field** — not applicable (Phase 6 D-15 is xci-specific).
5. **`main` / `exports` / `types`** point at `dist/server.js` / `dist/index.js` (planner refines based on what server exposes — mostly nothing external in Phase 7).
6. **Scripts divergence:**
   - `"build": "tsc -b"` (NOT tsup — RESEARCH §Alternatives; servers don't benefit from bundling)
   - `"dev": "tsx src/server.ts"` (dev-time runner, per RESEARCH §Stack `tsx@4.21.0`)
   - `"test:unit": "vitest run --config vitest.unit.config.ts"`
   - `"test:integration": "vitest run --config vitest.integration.config.ts"`
   - `"test": "pnpm test:unit && pnpm test:integration"` (full)
   - `"db:generate": "drizzle-kit generate"` (dev-only)
   - `"typecheck": "tsc -b --noEmit"`
7. **No `prepublishOnly`** in Phase 7 (first publish is Phase 14).
8. **Runtime `dependencies` (from RESEARCH §Installation):** `fastify@5.8.5`, `drizzle-orm@0.45.2`, `postgres@3.4.9`, `@node-rs/argon2@2.0.2`, `@fastify/env@6.0.0`, `@fastify/cookie@11.0.2`, `@fastify/csrf-protection@7.1.0`, `@fastify/rate-limit@10.3.0`, `@fastify/helmet@13.0.2`, `nodemailer@8.0.5`, `pino@10.3.1`, `fastify-plugin` (for auth plugin wrapping).
9. **`devDependencies`:** `drizzle-kit@0.31.10`, `@testcontainers/postgresql@11.14.0`, `@types/nodemailer@^7`, `tsx@4.21.0`, `pino-pretty@13.1.3`, `ts-morph@28.0.0` (only if Option B chosen over regex per RESEARCH §"Auto-discovery").

---

### `packages/server/tsconfig.json` (config)

**Analog:** `packages/xci/tsconfig.json` (5 lines)

**Mirror excerpt** (`packages/xci/tsconfig.json`):
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["dist", "node_modules"]
}
```

**Divergences:**

- **`include`** changes to `["src/**/*.ts", "drizzle.config.ts", "vitest.unit.config.ts", "vitest.integration.config.ts"]` — no tsup config.
- **Override `compilerOptions` to emit:**
  ```json
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "rootDir": "src"
  }
  ```
  Rationale: `tsconfig.base.json` sets `noEmit: true` (xci uses tsup so tsc is typecheck-only). Server uses `tsc -b` to emit `dist/**/*.js` + `.d.ts` — must override.

**Base config inheritance** (`tsconfig.base.json`) gives us for free:
- `module: "ESNext"`, `moduleResolution: "bundler"`, `target: "ES2022"`
- `verbatimModuleSyntax: true` — **forces `.js` suffix on relative imports** even in source (consistent with xci)
- `exactOptionalPropertyTypes: true` — **WARNING, Pitfall 8** in RESEARCH: Drizzle `$inferInsert` types need `satisfies` + conditional spread pattern; planner should add this as an acceptance criterion for all repo code.
- `noUncheckedIndexedAccess: true` — `rows[0]` is typed as `T | undefined`, forces `!` or explicit guards (see RESEARCH §"Auth plugin" `rows[0]!`).

---

### `packages/server/vitest.unit.config.ts` (config, test)

**Analog:** `packages/xci/vitest.config.ts` (20 lines)

**Mirror excerpt** (`packages/xci/vitest.config.ts`):
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    reporters: ['default'],
    pool: 'threads',
    isolate: true,
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/index.ts'],
    },
  },
});
```

**Divergences for unit config:**

- **`include`** must EXCLUDE integration/isolation tests — use narrower glob:
  ```typescript
  include: ['src/**/__tests__/**/*.test.ts'],
  exclude: ['node_modules', 'dist', 'src/**/*.integration.test.ts', 'src/**/*.isolation.test.ts'],
  ```
- Keep `isolate: true` (unit tests can parallelize freely — no shared DB).
- Coverage: same shape as xci.

---

### `packages/server/vitest.integration.config.ts` (config, test)

**Analog:** `packages/xci/vitest.config.ts` (partial — shape only)

**Source pattern** (RESEARCH §"testcontainers harness" lines 1073-1087):
```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts', 'src/**/__tests__/**/*.isolation.test.ts'],
    globalSetup: ['src/test-utils/global-setup.ts'],
    globalTeardown: ['src/test-utils/global-teardown.ts'],
    testTimeout: 30_000, // container boot ~10s first time
    pool: 'threads',
    isolate: false, // share the container across workers; resetDb() between tests
    sequence: { concurrent: false }, // sequential; testcontainer is shared state
  },
});
```

**Key divergences from xci vitest config:**

- `isolate: false` (xci has `isolate: true`)
- `sequence.concurrent: false` (sequential run — shared container state)
- `testTimeout: 30_000` (vs xci's 10_000 — container boot)
- `globalSetup` / `globalTeardown` arrays — **xci has neither**

---

### `packages/server/src/errors.ts` (XciServerError hierarchy — D-08)

**Analog:** `packages/xci/src/errors.ts` (243 lines) — **this is the closest structural match in the entire phase**

**What to mirror exactly:**

1. **`ExitCode` const object pattern** — even if server doesn't use exit codes the same way (it uses HTTP status codes), the **singleton const + derived type** pattern is the convention. Server equivalent:
   ```typescript
   export const HttpStatus = {
     BAD_REQUEST: 400,
     UNAUTHORIZED: 401,
     FORBIDDEN: 403,
     NOT_FOUND: 404,
     CONFLICT: 409,
     RATE_LIMITED: 429,
     INTERNAL: 500,
   } as const;
   ```

2. **Abstract base + category + concrete subclass hierarchy** (mirror xci `errors.ts` lines 34-70):

   ```typescript
   // mirror: packages/xci/src/errors.ts lines 34-48
   export abstract class XciError extends Error {
     public readonly code: string;
     public abstract readonly category: XciErrorCategory;
     public readonly suggestion?: string;

     constructor(message: string, options: XciErrorOptions) {
       super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
       this.name = new.target.name;
       this.code = options.code;
       if (options.suggestion !== undefined) {
         this.suggestion = options.suggestion;
       }
     }
   }
   ```

   Mirror to `XciServerError` with categories `'validation' | 'authn' | 'authz' | 'notfound' | 'conflict' | 'ratelimit' | 'internal'`.

3. **Area base classes** (mirror xci lines 50-70):
   ```typescript
   export abstract class ValidationError extends XciServerError { public readonly category = 'validation' as const; }
   export abstract class AuthnError extends XciServerError { public readonly category = 'authn' as const; }
   export abstract class AuthzError extends XciServerError { public readonly category = 'authz' as const; }
   // etc.
   ```

4. **Exhaustive switch mapping** (mirror xci lines 229-242): Same pattern, different range — `XciServerError.category → HttpStatus`. Adding a new category without updating the switch causes a TS compile error.

5. **Secrets-never-in-message discipline** — mirror `ShellInjectionError` exactly (lines 180-191):
   ```typescript
   export class ShellInjectionError extends ExecutorError {
     constructor(value: string) {
       super('Command contains shell metacharacters in an argument slot', {
         code: 'EXE_SHELL_INJECTION', ... });
       // NB: never include `value` in the message — it may be a secret.
       void value; // accepted for API compat, deliberately discarded
     }
   }
   ```
   Apply the same pattern to any server error that could carry password/token/email-verification-token data. Example sketch:
   ```typescript
   export class InvalidCredentialsError extends AuthnError {
     constructor() {
       super('Invalid email or password', { code: 'AUTHN_INVALID_CREDENTIALS' });
       // NB: do not accept or store email/password; caller discards.
     }
   }
   ```

**Stable code prefix convention** (mirror xci pattern from lines 91-92, 100-101, 138-139, etc.):
- Server codes: `VAL_*`, `AUTHN_*`, `AUTHZ_*`, `NF_*`, `CONFLICT_*`, `RATE_*`, `INT_*`.
- Every concrete subclass has a unique `code` string. Tested by `oneOfEachConcrete()`.

---

### `packages/server/src/__tests__/errors.test.ts`

**Analog:** `packages/xci/src/__tests__/errors.test.ts` (190+ lines)

**What to mirror exactly:**

1. **`oneOfEachConcrete()` factory function** (xci lines 29-43):
   ```typescript
   function oneOfEachConcrete(): readonly XciServerError[] {
     return [
       new ValidationSchemaError(...),
       new InvalidCredentialsError(),
       new SessionRequiredError(),
       new OrgMembershipRequiredError(...),
       // ... one instance of every concrete XciServerError subclass
     ];
   }
   ```

2. **Test suites** (exact mirror of xci lines 45-160):
   - `instanceof` chain tests (concrete → area base → XciServerError → Error)
   - `new.target.name` round-trip — every subclass's `.name` matches its constructor name
   - `Error.cause` propagation — every wrapping error accepts and propagates `cause`
   - **Code uniqueness test** (xci lines 140-144):
     ```typescript
     it('every concrete subclass has a unique `code` across the hierarchy', () => {
       const instances = oneOfEachConcrete();
       const codes = instances.map((e) => e.code);
       expect(new Set(codes).size).toBe(codes.length);
     });
     ```
   - Category → HTTP-status exhaustive mapping tests (mirror xci `ExitCode + exitCodeFor` suite at line 155).

**Why this is load-bearing:** The same uniqueness guarantee + exhaustive switch test catches drift in Phase 8+ when agent/task errors are added. Phase 1 P03 proved the pattern works; replicate it 1:1.

---

### `packages/server/src/types.ts` (if created)

**Analog:** `packages/xci/src/types.ts` (175 lines)

**What to mirror:** The **"type contracts file" discipline** — interfaces declared once, implementations match them. xci uses it for pipeline stages (`ConfigLoader`, `Resolver`, `Executor`). Server analog is narrower — most types live next to their Drizzle schema via `$inferSelect`/`$inferInsert` (RESEARCH §"Drizzle schema" lines 603-608):

```typescript
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
```

**Planner guidance:** Do NOT create a monolithic `types.ts` for the server. Put Drizzle-derived types next to schema (`src/db/schema.ts`), Fastify decoration types next to the auth plugin (module augmentation in `src/plugins/auth.ts`), and `BuildOpts` next to `buildApp` in `src/app.ts`. The xci `types.ts` pattern was necessary because those contracts predated their implementations; in the server, schema comes first so types come with it.

---

### `packages/server/src/db/schema.ts` (model — NO direct analog)

**Source pattern:** RESEARCH.md §"Drizzle schema (pg-core) — AUTH tables" (lines 492-609).

**Key conventions the planner must encode:**

1. **Import suffix convention:**
   ```typescript
   import { pgTable, text, timestamp, integer, boolean, uniqueIndex, index } from 'drizzle-orm/pg-core';
   import { sql } from 'drizzle-orm';
   ```
   (Package-root imports do NOT need `.js` suffix; relative imports DO — enforced by `verbatimModuleSyntax` + `moduleResolution: bundler`.)

2. **Every temporal column must use `withTimezone: true`** (RESEARCH Pitfall 2):
   ```typescript
   createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
   ```

3. **PK convention (D-25):** `text('id').primaryKey()` — NEVER `uuid(...)`; generated via `generateId('org' | 'usr' | ...)` from `src/crypto/tokens.ts`.

4. **Org-scoped FK convention (D-26):**
   ```typescript
   orgId: text('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
   ```

5. **Partial unique index for "at most one owner per org" (AUTH-08):**
   ```typescript
   uniqueIndex('org_members_one_owner_per_org').on(t.orgId).where(sql`role = 'owner'`),
   ```

6. **Case-insensitive email uniqueness:**
   ```typescript
   uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`),
   ```

7. **All 8 tables MUST be declared:** `orgs`, `users`, `org_members`, `org_plans`, `sessions`, `email_verifications`, `password_resets`, `org_invites` (RESEARCH lines 498-601).

8. **Inferred types exported at file bottom** (RESEARCH lines 603-608).

---

### `packages/server/src/repos/<table>.ts` (service — scoped repo — NO direct analog)

**Source pattern:** RESEARCH §"Scoped repository wrapper (D-01)" (lines 801-869).

**Canonical excerpt** (RESEARCH lines 804-833):
```typescript
// packages/server/src/repos/users.ts   (NOT exported from repos/index.ts)
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users, orgMembers } from '../db/schema.js';

export function makeUsersRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async findByEmail(email: string) {
      return db
        .select({ user: users })
        .from(users)
        .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
        .where(and(eq(orgMembers.orgId, orgId), eq(users.email, email.toLowerCase())))
        .limit(1);
    },
    async findById(userId: string) {
      return db
        .select({ user: users })
        .from(users)
        .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
        .where(and(eq(orgMembers.orgId, orgId), eq(users.id, userId)))
        .limit(1);
    },
  };
}

export type UsersRepo = ReturnType<typeof makeUsersRepo>;
```

**Enforcement rules (D-01/D-04) the planner MUST encode:**

1. **NOT exported from `repos/index.ts`.** Only `makeRepos()` is.
2. Every public repo file exports at least one `makeXxxRepo` function (regex in isolation-coverage meta-test matches `export function make\w+Repo`).
3. Every query MUST include `eq(tableOrJoin.org_id, orgId)` or join on a table that does.
4. Corresponding isolation test at `src/repos/__tests__/<name>.isolation.test.ts` exists and references every exported factory by name.

---

### `packages/server/src/repos/admin.ts` (service — D-03)

**Source:** CONTEXT D-03 + RESEARCH lines 275-278, "signupTx(...)" callouts.

**No analog** — deliberately friction-ful namespace. Planner notes:
- Name MUST be `adminRepo` (D-03, CONTEXT "Specifics" line 239: do NOT rename to `systemRepo`/`unscoped`).
- Core function: `signupTx({email, password})` — creates org + user + org_members + org_plans in one DB transaction.
- Separate module from org-scoped repos — visual contrast in code review.

---

### `packages/server/src/repos/__tests__/<name>.isolation.test.ts` (D-04)

**Source pattern:** RESEARCH §"Two-org fixture" (lines 982-1008).

**Canonical excerpt:**
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeUsersRepo } from '../users.js'; // allowed INSIDE __tests__

describe('users repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('findByEmail scoped to orgA never returns orgB user', async () => {
    const db = getTestDb();
    const fixture = await seedTwoOrgs(db);
    const repoA = makeUsersRepo(db, fixture.orgA.id);
    const result = await repoA.findByEmail(fixture.orgB.ownerUser.email);
    expect(result).toEqual([]);
  });
});
```

**Convention:**
- File naming: `<table>.isolation.test.ts` — matched by the integration vitest config `include`.
- Test name pattern: `'<function> scoped to orgA never returns orgB <entity>'` — forces author to seed Org B data and assert empty.
- Every function returned by `makeXxxRepo` must have at least one test against Org B data.
- Biome `noRestrictedImports` rule (see Shared Patterns) MUST whitelist `src/repos/__tests__/**` importing from `../<file>.js` — tests need internal access.

---

### `packages/server/src/repos/__tests__/isolation-coverage.test.ts` (meta-test)

**Source pattern:** RESEARCH §"Auto-discovery isolation test (D-04)" Option A (lines 881-919).

**Copy wholesale.** Planner should take the excerpt verbatim as the starting implementation. Only divergence: handle `.isolation.test.ts` naming plus possibly a `.test.ts` variant for pure unit tests.

---

### `packages/server/src/app.ts` (D-05 factory — NO analog)

**Source pattern:** RESEARCH §"Fastify v5 app factory" (lines 685-752).

**Canonical plugin chain (D-06 — locked order):**
```typescript
await app.register(fastifyEnv, { schema: envSchema, dotenv: false });
await app.register(dbPlugin, { databaseUrl: opts.databaseUrl });
await app.register(fastifyHelmet, { contentSecurityPolicy: false });
await app.register(fastifyCookie, { secret: app.config.SESSION_COOKIE_SECRET });
await app.register(fastifyCsrf, { cookieKey: '_csrf', cookieOpts: {...}, getToken: (req) => req.headers['x-csrf-token'] });
await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute', cache: 10_000 });
await app.register(authPlugin, { clock: opts.clock, randomBytes: opts.randomBytes });
await app.register(errorHandlerPlugin);
await app.register(registerRoutes, { prefix: '/api' });
```

**Convention:** `BuildOpts` accepts test injection (`dbPool`, `emailTransport`, `clock`, `crypto.randomBytes`). Production `server.ts` calls `buildApp()` with empty opts.

---

### `packages/server/src/server.ts` (entry point)

**"Analog" (but do NOT copy):** `packages/xci/src/cli.ts` — **only the entry-point concept matches; everything else diverges.**

**What NOT to copy from xci/cli.ts:**
- **Do NOT** add a shebang banner. xci uses tsup to inject `#!/usr/bin/env node` (see `packages/xci/tsup.config.ts` lines 25-29). Server is launched via `node dist/server.js`, not executed directly.
- **Do NOT** add a `createRequire` polyfill. That's a CJS-interop hack for commander in a bundled ESM output — server is `tsc`-compiled per-file, no polyfill needed.
- **Do NOT** add `__XCI_VERSION__` define substitution. Read version from `package.json` directly at runtime if needed, or skip (server version isn't surfaced in Phase 7).

**What server.ts DOES (RESEARCH §Sequencing Wave 6.4):**
```typescript
// pseudocode
import { buildApp } from './app.js';
import { argon2SelfTest } from './crypto/password.js';

const app = await buildApp();
await argon2SelfTest(app.log);  // Pitfall 3 warmup
await app.listen({ port: app.config.PORT, host: '0.0.0.0' });
```

---

### `.github/workflows/ci.yml` (modified)

**Analog:** Existing `fence-gates` job (lines 45-102) — same shape (Linux-only, pnpm+node setup, server-specific steps).

**What to mirror** (lines 50-66):
```yaml
runs-on: ubuntu-latest
steps:
  - name: Checkout
    uses: actions/checkout@v4
  - name: Setup pnpm
    uses: pnpm/action-setup@v4
  - name: Setup Node.js 22
    uses: actions/setup-node@v4
    with:
      node-version: 22
      cache: 'pnpm'
  - name: Install dependencies
    run: pnpm install --frozen-lockfile
```

**Additions** (RESEARCH §"CI Workflow Update" lines 1605-1634):
```yaml
integration-tests:
  needs: [build-test-lint]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: 'pnpm' }
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @xci/server build
    - run: pnpm --filter @xci/server test:integration
    - name: Upload vitest results (on failure)
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: vitest-integration-results
        path: packages/server/.vitest-output/
```

**Branch protection:** add `integration-tests` to required status checks (STATE.md update).

---

## Shared Patterns

### Biome `noRestrictedImports` for scoped-repo enforcement (D-01)

**Source:** Existing `biome.json` override for `packages/xci/src/**` (lines 46-68) — **exact same pattern, different paths.**

**Mirror excerpt** (`biome.json` lines 46-68):
```json
"overrides": [
  {
    "includes": ["packages/xci/src/**/*.ts"],
    "linter": {
      "rules": {
        "style": {
          "noRestrictedImports": {
            "level": "error",
            "options": {
              "paths": {
                "ws": { "message": "..." },
                "reconnecting-websocket": { "message": "..." }
              }
            }
          }
        }
      }
    }
  }
]
```

**Apply to:** all files in `packages/server/src/**` EXCEPT `packages/server/src/repos/**` (repos can import each other and schema) AND `packages/server/src/repos/__tests__/**` (tests need internal access).

**New override block to add (planner refines exact path syntax — RESEARCH Assumption A8 flags this is a MEDIUM-confidence pattern-matching question):**
```json
{
  "includes": ["packages/server/src/**/*.ts"],
  "excludes": ["packages/server/src/repos/**/*.ts"],
  "linter": {
    "rules": {
      "style": {
        "noRestrictedImports": {
          "level": "error",
          "options": {
            "patterns": [
              {
                "group": ["**/repos/users", "**/repos/sessions", "**/repos/email-verifications",
                         "**/repos/password-resets", "**/repos/org-invites", "**/repos/org-plans",
                         "**/repos/for-org", "**/repos/admin"],
                "message": "Org-scoped repos are only accessible via forOrg() from @xci/server/repos. See CONTEXT D-01. Cross-org ops use adminRepo from the same barrel."
              }
            ]
          }
        }
      }
    }
  }
}
```

**Fallback (RESEARCH Assumption A8):** If Biome pattern matching can't express "allow `./index.js`, block siblings", add a ~20-line `scripts/check-repo-imports.mjs` consumed by CI lint step. Planner decides during Wave 0.

---

### Error contract discipline (D-08)

**Source:** Phase 1 P03 `LociError` hierarchy — mirror wholesale to `XciServerError`.

- Every concrete subclass has a unique, stable `code` string (machine-readable).
- `suggestion` is optional human-readable text.
- `Error.cause` is standard ES2022 channel for wrapping.
- `oneOfEachConcrete()` test factory proves code uniqueness at every commit.
- Exhaustive switch on `category` in `httpStatusFor(err)` causes TS compile error when a category is added without updating the switch.

**Applied to:** `src/errors.ts`, every `src/plugins/*.ts`, every `src/routes/**/*.ts` (they throw `XciServerError` subclasses; error-handler plugin catches and serializes).

---

### Secrets-never-logged discipline (D-10)

**Source:** Phase 1 P02 `ShellInjectionError` pattern + xci tooling conventions.

**Applies to:** ALL code paths that touch passwords, session tokens, email-verification tokens, password-reset tokens, invite tokens.

**Enforcement mechanisms (layered):**

1. **pino `redact.paths`** config in `buildApp()` (RESEARCH §"Fastify v5 app factory" lines 713-722 + Pitfall 7):
   ```typescript
   redact: {
     paths: [
       'req.body.password', 'req.body.currentPassword', 'req.body.newPassword',
       'req.body.token', 'req.body.registrationToken',
       'req.headers.cookie', 'req.headers.authorization',
       'req.raw.headers.cookie', 'req.raw.headers.authorization',
       '*.password', '*.token',
     ],
     censor: '[REDACTED]',
   }
   ```

2. **Error constructors must discard sensitive args** (mirror `ShellInjectionError` `void value`):
   ```typescript
   export class InvalidCredentialsError extends AuthnError {
     constructor() {
       super('Invalid email or password', { code: 'AUTHN_INVALID_CREDENTIALS' });
       // No email/password accepted in constructor — deliberately.
     }
   }
   ```

3. **Test grep** (optional but recommended per Pitfall 7 "Warning signs"): CI step that greps test log artifacts for `xci_sid=`, `password=`, token-pattern regex — fails if redaction missed.

---

### Test file convention

**Source:** Phase 1 P03 — colocated `__tests__/` siblings to source, `.js` suffix imports (per `verbatimModuleSyntax` + `moduleResolution: bundler`).

**Examples from the codebase:**
- `packages/xci/src/__tests__/errors.test.ts` — top-level tests colocated with source
- `packages/xci/src/__tests__/cli.e2e.test.ts` — entry-point e2e tests
- `packages/xci/src/__tests__/types.test.ts` — type contract tests

**Applied to server:**
- `packages/server/src/crypto/__tests__/*.test.ts` — unit (no DB)
- `packages/server/src/repos/__tests__/*.isolation.test.ts` — integration (DB via testcontainers)
- `packages/server/src/routes/**/__tests__/*.integration.test.ts` — HTTP integration (`fastify.inject()`)
- `packages/server/src/plugins/__tests__/*.test.ts` — unit (mocks for DB)

**All test files MUST use `.js` suffix on relative imports** (mirror xci tests). Example from `packages/xci/src/__tests__/errors.test.ts` line 23:
```typescript
import { ... } from '../errors.js';
```

---

### Turbo task graph

**Source:** Existing `turbo.json` (already defines `build`, `test`, `lint`, `typecheck`; Phase 6 D-09).

**No changes required for Phase 7 Wave 0** — the server's new `build`/`test`/`lint`/`typecheck` scripts automatically get picked up by turbo when they replace the echo-noops.

**Optional additions** the planner should consider:
- `test:integration` as a new task dependent on `build` — runs only on Linux CI job. OR
- Simply rely on the existing `test` task and use `pnpm --filter @xci/server test:integration` directly in the Linux-only CI job (RESEARCH §Sequencing Wave 0.5 suggests either is acceptable).

**Do NOT** add `dev` / `clean` / `format` tasks — Phase 6 D-09 explicitly defers these.

---

## No Analog Found — Pattern Is From RESEARCH

These files have NO existing code in the repo to mirror; their patterns come entirely from RESEARCH.md code examples. Each is called out in the file classification tables above with "no analog."

| File | Reason | Source in RESEARCH.md |
|------|--------|----------------------|
| `src/db/schema.ts` | First Drizzle use in repo | §"Drizzle schema (pg-core)" |
| `src/db/relations.ts` | First Drizzle use | §"Drizzle relations" |
| `src/db/migrator.ts` | First Postgres use | §"Programmatic migrator at boot" |
| `src/db/plugin.ts` | First Fastify plugin | §"Fastify v5 app factory" (dbPlugin reference) |
| `drizzle.config.ts` | First drizzle-kit config | §"drizzle.config.ts (dev-only)" |
| `drizzle/*.sql` | Generated (committed) | `drizzle-kit generate` output |
| `src/app.ts` (buildApp factory) | First Fastify server | §"Fastify v5 app factory" |
| `src/server.ts` (HTTP entry) | First HTTP listener | §Sequencing Wave 6.4 |
| `src/config/env.schema.ts` | First @fastify/env use | §"@fastify/env JSON schema" |
| `src/crypto/password.ts` | First argon2 use | §"@node-rs/argon2 password service" |
| `src/crypto/tokens.ts` | First secure token generator | §"Token generator" |
| `src/email/transport.ts` | First nodemailer use | §"Nodemailer abstract transport" |
| `src/email/templates/*.ts` | First email templates | §"email/templates/verify-email.ts" |
| `src/plugins/auth.ts` | First Fastify auth plugin | §"Auth plugin" |
| `src/plugins/error-handler.ts` | First centralized error handler | Derived from D-08 + Fastify `setErrorHandler` docs |
| `src/repos/*.ts` | First scoped repository | §"Scoped repository wrapper (D-01)" |
| `src/repos/admin.ts` | First cross-org namespace | D-03 + §Sequencing Wave 4.3 |
| `src/repos/for-org.ts` | First repo composition factory | §"Scoped repository wrapper (D-01)" lines 836-852 |
| `src/repos/index.ts` | Barrel with enforcement semantics | §"Scoped repository wrapper (D-01)" lines 854-869 |
| `src/repos/__tests__/*.isolation.test.ts` | First two-org isolation test | §"Two-org fixture" |
| `src/repos/__tests__/isolation-coverage.test.ts` | First meta-test | §"Auto-discovery isolation test" Option A |
| `src/routes/**/*.ts` | First HTTP route handlers | §"Per-route rate limit" |
| `src/test-utils/db-harness.ts` | First testcontainers use | §"testcontainers harness" |
| `src/test-utils/two-org-fixture.ts` | First multi-org test seed | §"Two-org fixture" |
| `src/test-utils/global-setup.ts` / `global-teardown.ts` | First vitest globalSetup | §Sequencing Wave 2.3 |
| `.env.example` | First env template | RESEARCH §Recommended Project Structure |

---

## Warnings — Blindly Copying xci Patterns Would Be Wrong

### 1. Build tooling: `tsup` → `tsc -b`

**Source:** RESEARCH §Alternatives — "Servers don't benefit from bundling."

- xci uses tsup for CLI cold-start bundling (single `.mjs` file, shebang banner, `noExternal: [/.*/]`).
- Server uses `tsc --build` to emit per-file `.js` + `.d.ts` + source maps in `dist/`.
- Do NOT create `packages/server/tsup.config.ts`. Do NOT add a shebang. Do NOT bundle deps.

### 2. `bin` field: present in xci, absent in server

xci `package.json` line 8 declares `bin.xci: ./dist/cli.mjs`. The server is not installed as a command — it's a library + HTTP process launched by `node` or `tsx`. Omit `bin`.

### 3. size-limit: xci only

`packages/xci/package.json` lines 26-34 declare a `size-limit` config. This is the Phase 6 D-15 bundle-size fence for the CLI cold-start budget. Server has no cold-start budget — omit entirely.

### 4. `external: ['ws', 'reconnecting-websocket']`: xci only (Phase 6 D-16)

The `ws`/reconnecting-websocket fence applies to `packages/xci/src/**`. Server will eventually use `ws` via `@fastify/websocket` in Phase 8; **do not copy the fence to server** and **do not copy the grep CI gate** to the integration-tests job. Phase 7 doesn't touch WebSockets at all (D-39 + Phase 6 D-16 scope).

### 5. Single `vitest.config.ts`: xci only

xci has one config because all tests are unit/E2E against spawned processes. Server needs **two configs** — unit (no DB) and integration (testcontainers). Do NOT try to force both into a single config with filtering — the `globalSetup`/`isolate`/`sequence.concurrent` settings differ fundamentally.

### 6. `oneOfEachConcrete()` scope: mirror, but WITHOUT the v1 error classes

The server's `oneOfEachConcrete()` must NOT import any `XciError` subclass from `packages/xci/`. Per D-39, there are zero cross-package imports in Phase 7. Server defines its own parallel hierarchy in `packages/server/src/errors.ts`.

### 7. Test spawn pattern doesn't apply

`packages/xci/src/__tests__/cli.e2e.test.ts` spawns the built CLI binary via `process.execPath` (lines 19-29). The server's HTTP integration tests use `fastify.inject()` instead — no spawn, no binary. Do NOT copy the `spawnSync` pattern to server tests (D-24 "HTTP integration tests — `fastify.inject()`").

### 8. Root `biome.json` files.includes: MIGHT need update

`biome.json` line 9 currently lists `packages/**/src/**/*.ts`, `packages/**/tsup.config.ts`, `packages/**/vitest.config.ts`. Server uses `drizzle.config.ts`, `vitest.unit.config.ts`, `vitest.integration.config.ts` — the existing glob covers `vitest*.config.ts` via `vitest.config.ts` literal — **NO**, it's literal. Planner MUST expand to `packages/**/vitest*.config.ts` and add `packages/**/drizzle.config.ts`.

### 9. Phase 6 fence: `packages/xci/` is STILL UNTOUCHED (D-39)

Phase 7 plans must explicitly NOT:
- Import anything from `@xci/server` into `packages/xci/src/`
- Import anything from `xci` into `packages/server/src/` (D-39 — shared YAML parser is Phase 9)
- Modify `packages/xci/**` source, test, or config files
- Weaken any Phase 6 fence gate (bundle size, ws-exclusion grep, hyperfine)

---

## Metadata

**Analog search scope:** `packages/xci/**`, `.github/workflows/**`, root-level config files.
**Files scanned:** 13 project files read (package.json × 2, tsconfig × 2, vitest.config, tsup.config, biome.json, turbo.json, pnpm-workspace.yaml, errors.ts + test, types.ts, cli.e2e.test.ts, ci.yml) + CONTEXT.md + RESEARCH.md (1679 lines) + Phase 6 CONTEXT.md.
**Pattern extraction date:** 2026-04-18

---

## PATTERN MAPPING COMPLETE
