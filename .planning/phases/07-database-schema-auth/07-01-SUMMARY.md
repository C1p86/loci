---
phase: 07-database-schema-auth
plan: "01"
subsystem: "@xci/server bootstrap"
tags: [server, fastify, drizzle, typescript, vitest, biome, changeset]
dependency_graph:
  requires: [06-monorepo-setup-backward-compat-fence]
  provides: [packages/server/package.json, packages/server/tsconfig.json, packages/server/drizzle.config.ts, packages/server/vitest.unit.config.ts, packages/server/vitest.integration.config.ts, packages/server/.env.example, biome.json overrides, .changeset/07-server-bootstrap.md]
  affects: [biome.json, pnpm-lock.yaml]
tech_stack:
  added:
    - fastify@5.8.5
    - drizzle-orm@0.45.2
    - postgres@3.4.9
    - "@node-rs/argon2@2.0.2"
    - "@fastify/env@6.0.0"
    - "@fastify/cookie@11.0.2"
    - "@fastify/csrf-protection@7.1.0"
    - "@fastify/rate-limit@10.3.0"
    - "@fastify/helmet@13.0.2"
    - fastify-plugin@5.0.1
    - nodemailer@8.0.5
    - pino@10.3.1
    - drizzle-kit@0.31.10 (dev)
    - "@testcontainers/postgresql@11.14.0" (dev)
    - "@types/nodemailer@7.0.11" (dev)
    - tsx@4.21.0 (dev)
    - pino-pretty@13.1.3 (dev)
  patterns:
    - tsc-b-emit: tsc --build for per-file JS+dts emit (no tsup bundling for server)
    - two-vitest-configs: unit (isolate:true, passWithNoTests) + integration (isolate:false, globalSetup/Teardown)
    - biome-overrides: three override blocks — xci ws-fence (existing), server ws-fence (Phase 8 gate), server D-01 repo-import enforcement
key_files:
  created:
    - packages/server/package.json
    - packages/server/tsconfig.json
    - packages/server/drizzle.config.ts
    - packages/server/vitest.unit.config.ts
    - packages/server/vitest.integration.config.ts
    - packages/server/.env.example
    - packages/server/.gitignore
    - packages/server/src/test-utils/global-setup.ts
    - packages/server/src/test-utils/global-teardown.ts
    - .changeset/07-server-bootstrap.md
  modified:
    - biome.json (files.includes widened + 2 new overrides)
    - packages/server/src/index.ts (Phase 6 placeholder → Phase 7 barrel comment)
    - pnpm-lock.yaml (regenerated with 17 server packages)
decisions:
  - "Build tool is tsc -b (not tsup) — servers have no cold-start pressure, per-file emit preserves stack traces"
  - "passWithNoTests:true added to both vitest configs so zero-test bootstrap exits 0"
  - "rootDir:src with include limited to src/**/*.ts only — drizzle/vitest configs excluded from tsc include to avoid rootDir conflict; biome lints them via files.includes glob"
  - "drizzle.config.ts uses process.env.DATABASE_URL literal key (biome useLiteralKeys fix)"
  - "tsconfig.tsbuildinfo added to .gitignore (tsc -b build artifact)"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-18"
  tasks_completed: 3
  tasks_total: 3
  files_created: 10
  files_modified: 4
---

# Phase 7 Plan 01: Server Bootstrap Summary

Bootstrap the `@xci/server` package: replaced the Phase 6 echo-noop stub with a real package.json (`private: false`), tsconfig, two vitest configs (`passWithNoTests:true`), drizzle-kit config, .env.example, biome override updates, and installed all 17 Phase 7 runtime + dev dependencies at exact versions.

## What Was Built

### packages/server/package.json
Real manifest replacing the Phase 6 echo-noop stub:
- `private: false` (Phase 6 D-12 commitment, enables Changesets fixed-versioning)
- `name: "@xci/server"`, `type: "module"`, `engines: { node: ">=20.5.0" }`
- `main: ./dist/index.js`, `types: ./dist/index.d.ts`, `files: [dist, drizzle]`
- Scripts: `build` (tsc -b), `dev` (tsx), `lint`, `lint:fix`, `test:unit`, `test:integration`, `test`, `test:watch`, `typecheck`, `db:generate`
- 12 runtime deps + 5 dev deps at exact pinned versions

### Installed Dependencies (17 packages)

**Runtime:**
| Package | Version |
|---------|---------|
| fastify | 5.8.5 |
| drizzle-orm | 0.45.2 |
| postgres | 3.4.9 |
| @node-rs/argon2 | 2.0.2 |
| @fastify/env | 6.0.0 |
| @fastify/cookie | 11.0.2 |
| @fastify/csrf-protection | 7.1.0 |
| @fastify/rate-limit | 10.3.0 |
| @fastify/helmet | 13.0.2 |
| fastify-plugin | 5.0.1 |
| nodemailer | 8.0.5 |
| pino | 10.3.1 |

**Dev:**
| Package | Version |
|---------|---------|
| drizzle-kit | 0.31.10 |
| @testcontainers/postgresql | 11.14.0 |
| @types/nodemailer | 7.0.11 |
| tsx | 4.21.0 |
| pino-pretty | 13.1.3 |

### Config Files Created

- **tsconfig.json**: extends `../../tsconfig.base.json`, overrides `noEmit: false`, `outDir: dist`, `rootDir: src`, declaration+sourceMap enabled. Include limited to `src/**/*.ts` only (config files excluded to avoid rootDir conflict).
- **drizzle.config.ts**: postgresql dialect, `src/db/schema.ts` → `drizzle/`, `process.env.DATABASE_URL` fallback.
- **vitest.unit.config.ts**: `isolate: true`, `passWithNoTests: true`, excludes `*.integration.test.ts` and `*.isolation.test.ts`.
- **vitest.integration.config.ts**: `isolate: false`, `sequence.concurrent: false`, `globalSetup`/`globalTeardown` paths, 30s timeout, `passWithNoTests: true`.
- **.env.example**: documents `DATABASE_URL`, `SESSION_COOKIE_SECRET`, `EMAIL_TRANSPORT`, `PORT`, `LOG_LEVEL`, `SMTP_*`.
- **src/test-utils/global-setup.ts** + **global-teardown.ts**: temporary empty stubs (Plan 02 replaces with testcontainers wiring).

### biome.json Changes

1. **`files.includes` widened**: `packages/**/vitest.config.ts` → `packages/**/vitest*.config.ts` + added `packages/**/drizzle.config.ts`
2. **New server-general override** (`packages/server/src/**`): blocks `ws` and `reconnecting-websocket` imports (Phase 8 gate)
3. **New server-routes/plugins/app override**: D-01 enforcement — blocks direct imports of individual repo files (`./repos/users.js`, `../repos/sessions.js`, etc.); only `repos/index.js` exports are allowed

### Changeset

`.changeset/07-server-bootstrap.md` — bumps `@xci/server`, `xci`, and `@xci/web` at `minor` level (Phase 6 D-11 fixed versioning group).

## Toolchain Smoke Output (7 commands, all exit 0)

```
1. pnpm --filter @xci/server typecheck  → EXIT 0 (tsc -b --noEmit, no errors)
2. pnpm --filter @xci/server build      → EXIT 0 (dist/index.js + .d.ts emitted)
3. pnpm --filter @xci/server lint       → EXIT 0 (6 files checked, no errors)
4. pnpm --filter @xci/server test:unit  → EXIT 0 (no test files, passWithNoTests)
5. pnpm --filter @xci/server test:integration → EXIT 0 (no test files, passWithNoTests)
6. pnpm --filter xci test               → EXIT 0 (302 tests passed — D-39 fence intact)
7. pnpm --filter xci build              → EXIT 0 (dist/cli.mjs 769 KB — D-39 fence intact)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fix: rootDir/include conflict in tsconfig.json**
- **Found during:** Task 3 typecheck smoke run
- **Issue:** `tsconfig.json` had `rootDir: "src"` but `include` listed `drizzle.config.ts`, `vitest.unit.config.ts`, `vitest.integration.config.ts` (all outside `src/`). tsc error TS6059: "File is not under rootDir".
- **Fix:** Removed the three config files from `include` in `tsconfig.json`. They are dev-only configs linted by biome via `files.includes` glob — they do not need tsc compilation.
- **Files modified:** `packages/server/tsconfig.json`
- **Commit:** included in task 3 commit `5b6a5df`

**2. [Rule 1 - Bug] Fix: drizzle.config.ts computed key lint info**
- **Found during:** Task 3 lint smoke run
- **Issue:** `process.env['DATABASE_URL']` flagged by biome `useLiteralKeys` (info-level).
- **Fix:** Changed to `process.env.DATABASE_URL` literal property access.
- **Files modified:** `packages/server/drizzle.config.ts`
- **Commit:** included in task 3 commit `5b6a5df`

**3. [Rule 2 - Missing Critical Functionality] Add passWithNoTests:true to both vitest configs**
- **Found during:** Task 3 test:unit smoke run
- **Issue:** Vitest exits with code 1 when no test files are found. Plan requires "exits 0 (zero tests, vitest discovers no files)" but the plan did not specify `passWithNoTests`.
- **Fix:** Added `passWithNoTests: true` to both `vitest.unit.config.ts` and `vitest.integration.config.ts`.
- **Files modified:** `packages/server/vitest.unit.config.ts`, `packages/server/vitest.integration.config.ts`
- **Commit:** included in task 3 commit `5b6a5df`

**4. [Rule 2 - Missing Critical Functionality] Add tsconfig.tsbuildinfo to .gitignore**
- **Found during:** Post-task 3 git status check
- **Issue:** `tsc -b` emits `tsconfig.tsbuildinfo` (build cache) which appeared as untracked.
- **Fix:** Added `tsconfig.tsbuildinfo` to `packages/server/.gitignore`.
- **Files modified:** `packages/server/.gitignore`
- **Commit:** `b50c830`

**5. [Out of scope — logged] Pre-existing xci lint + typecheck failures**
- **Found during:** Task 3 D-39 fence check
- **Issue:** `pnpm --filter xci typecheck` and `pnpm --filter xci lint` were already failing before Plan 07-01 (confirmed by git stash verification). 68 biome errors and numerous TS errors in `packages/xci/src/`.
- **Action:** NOT fixed (D-39 fence — zero changes to `packages/xci/`). Logged to deferred-items.
- **D-39 fence confirmed intact:** `pnpm --filter xci test` (302 passed) and `pnpm --filter xci build` both exit 0.

## Known Stubs

- `packages/server/src/test-utils/global-setup.ts`: empty async function stub. Plan 02 replaces with testcontainers Postgres container startup.
- `packages/server/src/test-utils/global-teardown.ts`: empty async function stub. Plan 02 replaces with container teardown.
- `packages/server/src/index.ts`: placeholder barrel comment with `export {}`. Future waves add real exports (buildApp, errors, repos).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced in this plan. This is toolchain bootstrap only — no runtime code written.

## Self-Check: PASSED

Files created/exist:
- packages/server/package.json: FOUND
- packages/server/tsconfig.json: FOUND
- packages/server/drizzle.config.ts: FOUND
- packages/server/vitest.unit.config.ts: FOUND
- packages/server/vitest.integration.config.ts: FOUND
- packages/server/.env.example: FOUND
- packages/server/.gitignore: FOUND
- packages/server/src/test-utils/global-setup.ts: FOUND
- packages/server/src/test-utils/global-teardown.ts: FOUND
- .changeset/07-server-bootstrap.md: FOUND

Commits:
- 12caa1d: feat(07-01): bootstrap @xci/server package manifest + install all deps
- 00413d5: feat(07-01): add server tsconfig, vitest configs, drizzle config, env template + biome overrides
- 5b6a5df: feat(07-01): replace server index stub, add changeset, smoke-verify toolchain
- b50c830: chore(07-01): add tsconfig.tsbuildinfo to server .gitignore
