---
phase: 09-task-definitions-secrets-management
plan: "01"
subsystem: xci-dsl + server-schema
tags: [dsl, schema, migration, subpath-export, bytea, workspace-dep]
dependency_graph:
  requires: []
  provides:
    - xci/dsl subpath (parseYaml, validateCommandMap, validateAliasRefs, resolvePlaceholders, suggest)
    - packages/server/src/db/schema.ts (tasks, secrets, org_deks, secret_audit_log + bytea customType)
    - packages/server/drizzle/0002_tasks_secrets.sql (migration BLOCKING gate cleared)
  affects:
    - packages/xci/tsup.config.ts (3rd entry + scoped dts)
    - packages/xci/package.json (exports map)
    - packages/server/package.json (workspace dep)
    - packages/xci/src/resolver/interpolate.ts (type-safety fixes in transitive chain)
tech_stack:
  added: []
  patterns:
    - tsup array-of-configs for per-entry externalization
    - Drizzle customType for bytea (Buffer ↔ Uint8Array guard)
    - pnpm workspace:* cross-package dependency
    - TDD RED/GREEN/REFACTOR for DSL facade
key_files:
  created:
    - packages/xci/src/dsl/index.ts
    - packages/xci/src/dsl/parser.ts
    - packages/xci/src/dsl/validate.ts
    - packages/xci/src/dsl/interpolate.ts
    - packages/xci/src/dsl/levenshtein.ts
    - packages/xci/src/dsl/types.ts
    - packages/xci/src/dsl/__tests__/facade.test.ts
    - packages/server/drizzle/0002_tasks_secrets.sql
    - packages/server/drizzle/meta/0002_snapshot.json
  modified:
    - packages/xci/tsup.config.ts
    - packages/xci/package.json
    - packages/server/package.json
    - packages/server/src/db/schema.ts
    - packages/server/drizzle/meta/_journal.json
    - packages/xci/src/resolver/interpolate.ts
    - pnpm-lock.yaml
decisions:
  - "tsup array-of-configs: dsl entry has yaml external (22.9KB); cli+agent entry preserves Phase 6 noExternal bundling"
  - "dts scoped to dsl entry only with noEmitOnError:false to avoid pre-existing tsc errors in cli.ts/tui/ blocking declaration generation"
  - "levenshtein.ts uses 2D number[][] DP with ! assertions; noNonNullAssertion warnings accepted per plan (15 warnings, 0 errors)"
metrics:
  duration_seconds: 784
  completed_date: "2026-04-18T23:00:34Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
  files_modified: 7
---

# Phase 9 Plan 01: DSL Facade + Schema Migration Summary

DSL subpath facade extracted from `packages/xci/src/dsl/` re-exporting existing engines (yaml + normalizeCommands + validateGraph + interpolateArgvLenient) as `xci/dsl`; 4 new Drizzle tables (tasks, secrets, org_deks, secret_audit_log) with bytea customType added to `@xci/server`; migration `0002_tasks_secrets.sql` generated and committed; BLOCKING gate cleared for all downstream plans.

## Tasks Executed

### Task 1: DSL facade source — 5 files under packages/xci/src/dsl/ (TDD)
- **RED:** `facade.test.ts` written and committed; 7 tests fail (module not found)
- **GREEN:** 6 source files created; all 7 tests pass
- **Files:** `dsl/types.ts`, `dsl/parser.ts`, `dsl/validate.ts`, `dsl/interpolate.ts`, `dsl/levenshtein.ts`, `dsl/index.ts`, `dsl/__tests__/facade.test.ts`
- **Public API:** `parseYaml`, `validateCommandMap`, `validateAliasRefs` (NEW — validateGraph only does cycles), `resolvePlaceholders`, `suggest`
- **Commits:** 57f44ce (RED), 722f832 (GREEN)

### Task 2: tsup 3rd entry + package.json exports map + workspace dep in server
- **tsup.config.ts** refactored to array-of-configs: cli+agent (Phase 6 fence preserved) + dsl (yaml external, clean:false)
- **dist/dsl.mjs:** 22.9 KB (well under 100KB limit); 0 commander occurrences
- **dist/dsl.d.ts:** 3.80 KB generated via scoped `dts: { entry: { dsl: ... } }`
- **exports map:** `"."` + `"./agent"` + `"./dsl"` (mandatory root entry per RESEARCH Open Q #11)
- **pnpm-lock.yaml:** updated; `xci@link:../xci` symlink confirmed in server
- **Commit:** 2eb03ac

### Task 3: [BLOCKING] Drizzle schema + 0002 migration (TDD)
- **schema.ts:** `customType` import added; `bytea` customType declared (Buffer.from guard per Pitfall 5)
- **4 new tables:** `tasks` (yaml_definition text, label_requirements jsonb), `org_deks` (3 bytea columns), `secrets` (3 bytea + aad text), `secret_audit_log` (nullable secret_id, 5-value action enum)
- **8 new type exports:** Task/NewTask, OrgDek/NewOrgDek, Secret/NewSecret, SecretAuditLogEntry/NewSecretAuditLogEntry
- **Migration:** `0002_tasks_secrets.sql` — 4 CREATE TABLE, 6 bytea columns, 7 FKs (5 CASCADE + 2 SET NULL), 3 indexes (2 UNIQUE + 1 non-unique)
- **BLOCKING gate:** `pnpm --filter @xci/server exec tsc --noEmit` exits 0
- **Commits:** fadc704 (schema + migration), 8f48443 (biome formatting)

## Build Outputs

| File | Size | Notes |
|------|------|-------|
| dist/cli.mjs | 769.83 KB | Phase 6 fence preserved (yaml/commander bundled) |
| dist/agent.mjs | 11.98 KB | Phase 8 entry unchanged |
| dist/dsl.mjs | 22.9 KB | yaml external; no commander; under 100KB |
| dist/dsl.d.ts | 3.80 KB | TypeScript declarations for server consumer |

## Test Results

- xci test suite: **328 tests, 18 files — all passing** (BC-01 / D-40 preserved)
- dsl facade tests: **7/7 passing**
- server typecheck: **0 errors**

## Cumulative Verification

```
import 'xci/dsl' from @xci/server → parseYaml,resolvePlaceholders,suggest,validateAliasRefs,validateCommandMap ✓
dsl.mjs size: 22918 bytes < 102400 ✓
commander count in dsl.mjs: 0 ✓
4 CREATE TABLE in 0002_tasks_secrets.sql ✓
6 bytea columns in migration ✓
no commands/index import in dsl/ ✓
no @xci/server import in dsl/ ✓
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] tsup dts:true causes build failure from pre-existing type errors**
- **Found during:** Task 2
- **Issue:** Setting `dts: true` globally caused tsup's DTS worker to run tsc across all entries, surfacing pre-existing errors in cli.ts, agent/, tui/ (from earlier phases). The dsl entry's transitive chain through `resolver/interpolate.ts` also had 4 pre-existing type errors (noUncheckedIndexedAccess + String.replace callback return type).
- **Fix:** (a) Refactored tsup.config.ts to array-of-configs — dsl entry separate with `dts: { entry: { dsl: ... }, compilerOptions: { noEmitOnError: false } }`. (b) Fixed 4 pre-existing type errors in `interpolate.ts`: added `jsonStr !== undefined` guard before JSON.parse, added `?? match` to 3 String.replace callbacks returning `string | undefined`.
- **Files modified:** `packages/xci/tsup.config.ts`, `packages/xci/src/resolver/interpolate.ts`
- **Commits:** 2eb03ac

**2. [Rule 3 - Blocking Issue] dsl.mjs 283KB exceeds 100KB must-have**
- **Found during:** Task 2, first build attempt
- **Issue:** With `noExternal: [/.*/]` regex from Phase 6, the yaml library (265KB) was bundled into dsl.mjs. The cli entry needs this for cold-start performance, but the dsl entry does not.
- **Fix:** Split tsup config into array-of-configs. dsl entry uses `external: ['yaml']` — yaml is a declared runtime dep of xci, available at consumer's node_modules via pnpm hoisting. cli+agent entries keep Phase 6 noExternal bundling unchanged.
- **Result:** dsl.mjs = 22.9KB (was 283KB)
- **Files modified:** `packages/xci/tsup.config.ts`
- **Commit:** 2eb03ac

**3. [Rule 1 - Bug] biome import organization violations in new dsl files**
- **Found during:** Post-task biome check
- **Issue:** `dsl/index.ts`, `dsl/parser.ts`, `dsl/validate.ts` had unsorted imports; `schema.ts` had minor formatting differences.
- **Fix:** `pnpm biome check --write` auto-fixed all 4 files.
- **Files modified:** `packages/xci/src/dsl/index.ts`, `packages/xci/src/dsl/parser.ts`, `packages/xci/src/dsl/validate.ts`, `packages/server/src/db/schema.ts`
- **Commit:** 8f48443

### Known Non-Issues (warnings only)

- `levenshtein.ts`: 10 `noNonNullAssertion` warnings for DP array indexing — acknowledged in plan ("if warning escalates, refactor to flat Int32Array"). Counted as warnings, not errors.
- `facade.test.ts`: 3 `noTemplateCurlyInString` warnings for `'${NAME}'` string literals in test assertions — intentional (testing YAML placeholder literal strings). Not errors.

## Known Stubs

None — all schema fields are definitive (no placeholders). DSL functions are fully implemented re-exports. No mock data flowing to any consumer.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| No new threats | — | All surfaces covered by plan's threat model (T-09-01-01 through T-09-01-07 mitigated) |

## Self-Check: PASSED

- `packages/xci/src/dsl/index.ts` — FOUND
- `packages/xci/src/dsl/parser.ts` — FOUND
- `packages/xci/src/dsl/validate.ts` — FOUND
- `packages/xci/src/dsl/interpolate.ts` — FOUND
- `packages/xci/src/dsl/levenshtein.ts` — FOUND
- `packages/xci/src/dsl/types.ts` — FOUND
- `packages/xci/src/dsl/__tests__/facade.test.ts` — FOUND
- `packages/xci/dist/dsl.mjs` — FOUND (22.9KB)
- `packages/xci/dist/dsl.d.ts` — FOUND
- `packages/server/drizzle/0002_tasks_secrets.sql` — FOUND
- Commits 57f44ce, 722f832, 2eb03ac, fadc704, 8f48443 — VERIFIED
