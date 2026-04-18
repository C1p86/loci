---
phase: 09-task-definitions-secrets-management
plan: "04"
subsystem: server/routes/tasks
tags:
  - routes
  - crud
  - validation
  - xci-dsl
  - csrf
  - integration-tests
dependency_graph:
  requires:
    - 09-01  # xci/dsl facade (parseYaml, validateCommandMap, validateAliasRefs)
    - 09-02  # TaskValidationError + TaskNotFoundError + error-handler branch
    - 09-03  # makeTasksRepo forOrg factory + biome D-37/D-38 fences
  provides:
    - GET    /api/orgs/:orgId/tasks          (any member, no yamlDefinition)
    - GET    /api/orgs/:orgId/tasks/:taskId  (any member, full row)
    - POST   /api/orgs/:orgId/tasks          (Owner/Member + CSRF, D-12 pipeline)
    - PATCH  /api/orgs/:orgId/tasks/:taskId  (Owner/Member + CSRF, D-12 pipeline)
    - DELETE /api/orgs/:orgId/tasks/:taskId  (Owner only + CSRF)
    - 5 integration test files under routes/tasks/__tests__/
  affects:
    - routes/index.ts (registerTaskRoutes mounted under /orgs)
    - Phase 10 dispatch (task routes are the authoring API dispatch will consume)
tech_stack:
  added:
    - First legitimate cross-package import: 'xci/dsl' from packages/server/src/ (D-37 fence allows it)
    - validateTaskYaml() shared helper exported from create.ts, imported by update.ts (deduplication)
    - requireOwnerOrMemberAndOrgMatch() exported from create.ts (Owner/Member guard for tasks)
  patterns:
    - D-12 4-step validation short-circuits on first failure (parse → structure → cycle/alias)
    - exactOptionalPropertyTypes: build conditional patch object with if-guards (not object spread)
    - Integration tests use buildApp + fastify.inject + makeSession helper (Phase 8 pattern)
    - biome-ignore lint/style/noNonNullAssertion on array[0] after length assertion in tests
key_files:
  created:
    - packages/server/src/routes/tasks/index.ts
    - packages/server/src/routes/tasks/list.ts
    - packages/server/src/routes/tasks/get.ts
    - packages/server/src/routes/tasks/create.ts
    - packages/server/src/routes/tasks/update.ts
    - packages/server/src/routes/tasks/delete.ts
    - packages/server/src/routes/tasks/__tests__/create.integration.test.ts
    - packages/server/src/routes/tasks/__tests__/list.integration.test.ts
    - packages/server/src/routes/tasks/__tests__/update.integration.test.ts
    - packages/server/src/routes/tasks/__tests__/delete.integration.test.ts
    - packages/server/src/routes/tasks/__tests__/validation.integration.test.ts
  modified:
    - packages/server/src/routes/index.ts  # registerTaskRoutes mounted under /orgs prefix
decisions:
  - "validateTaskYaml() exported from create.ts and imported by update.ts — avoids a separate util file while still deduplicating the 4-step pipeline"
  - "requireOwnerOrMemberAndOrgMatch() exported from create.ts — reused by update.ts; delete.ts inlines its own requireOwnerAndOrgMatch (owner-only variant)"
  - "Integration tests check body.code / body.errors at top level (not body.error.code) — matches actual error-handler serialisation shape"
metrics:
  duration_minutes: 9
  completed_date: "2026-04-18"
  tasks_completed: 2
  files_changed: 12
---

# Phase 09 Plan 04: Task CRUD routes + D-12 validation pipeline + integration tests Summary

5 Task CRUD routes under /api/orgs/:orgId/tasks with the D-12 4-step save-time validation pipeline consuming xci/dsl (first cross-package import from server), plus 5 integration test files covering happy paths and all D-12 failure modes.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Task CRUD routes (5 handlers + barrel) + mount in routes/index.ts | 83312f9 | 7 files (6 new route files + routes/index.ts) |
| 2 | Integration tests for Task CRUD + validation edge cases (5 files) | b773488 | 5 files |

## Route Endpoints and Role Permissions

| Method | Path | Roles Permitted | CSRF | Notes |
|--------|------|-----------------|------|-------|
| GET | /api/orgs/:orgId/tasks | Owner, Member, Viewer | No | Returns metadata only — no yamlDefinition (D-10) |
| GET | /api/orgs/:orgId/tasks/:taskId | Owner, Member, Viewer | No | Returns full row including yamlDefinition |
| POST | /api/orgs/:orgId/tasks | Owner, Member | Yes | D-12 4-step validation; 201 + {id} |
| PATCH | /api/orgs/:orgId/tasks/:taskId | Owner, Member | Yes | D-12 4-step validation when yamlDefinition present |
| DELETE | /api/orgs/:orgId/tasks/:taskId | Owner only | Yes | 204; 404 if not found |

## D-12 4-Step Validation Pipeline

`validateTaskYaml(yaml: string): void` (in `create.ts`, imported by `update.ts`):

1. **Parse** — `parseYaml(yaml)`: errors → `TaskValidationError` with `{line?, column?, message}`
2. **Structure** — `validateCommandMap(commands)`: `!ok` → `TaskValidationError` with `{message, suggestion?}`
3. **Cycle + Unknown alias** — `validateAliasRefs(commands)`: errors → `TaskValidationError` with `{message, suggestion?}` (Levenshtein "did you mean" from dsl layer)

Steps short-circuit on first failure — a parse error stops further checks.

## Cross-Package Import (First)

`create.ts` line 5:
```ts
import { parseYaml, validateAliasRefs, validateCommandMap } from 'xci/dsl';
```

This is the first legitimate `import 'xci/dsl'` from `packages/server/src/**`. Biome override 4 (D-37, plan 09-03) allows it; `biome check packages/server/src/routes/tasks/` exits 0.

## Integration Test Coverage

| File | Tests | Failure modes covered |
|------|-------|-----------------------|
| create.integration.test.ts | 7 | 201 (owner), 201 (member), 403 (viewer), 401 (no session), 409 (duplicate name), cross-org uniqueness, 403 (no CSRF) |
| list.integration.test.ts | 4 | Org scoping (no orgB leakage), no yamlDefinition in list payload, viewer read, 401 no session |
| update.integration.test.ts | 4 | 200 + DB verified, 400 invalid YAML with errors[], 404 stranger-org taskId, 403 viewer |
| delete.integration.test.ts | 4 | 204 + subsequent 404, 403 member, 404 non-existent, 403 no CSRF |
| validation.integration.test.ts | 5 | Parse error (XCI_SRV_TASK_VALIDATION), cyclic (/circular/i), unknown alias (suggestion 'lint'), 1MB AJV cut-off (VAL_SCHEMA), valid multi-step YAML saved |

**Total integration tests added:** 24 across 5 files.

## Deviations from Plan

### Auto-resolved Type Issues

**1. [Rule 1 - Bug] exactOptionalPropertyTypes strict checking on patch object**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `update.ts` was spreading `req.body` fields (including `undefined`) into the `Partial<>` param, which `exactOptionalPropertyTypes: true` rejects
- **Fix:** Built explicit conditional patch object with `if (field !== undefined) patch.field = value` guards
- **Commit:** 83312f9

**2. [Rule 1 - Bug] exactOptionalPropertyTypes on TaskValidationDetail construction**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `{ line: e.line }` where `e.line` is `number | undefined` not assignable to `number` (optional prop)
- **Fix:** Conditional construction: `const d: TaskValidationDetail = { message }; if (e.line !== undefined) d.line = e.line;`
- **Commit:** 83312f9

**3. [Rule 1 - Bug] Array index type narrowing in integration tests**
- **Found during:** Task 2 (tsc --noEmit)
- **Issue:** `tasks[0].name` inferred as `{ name: string } | undefined` under strict array indexing
- **Fix:** Added `// biome-ignore lint/style/noNonNullAssertion` with non-null assertion `tasks[0]!` after explicit length check
- **Commit:** b773488

## Known Stubs

None — all routes are fully wired to the forOrg repo factory with real DB calls. No hardcoded empty values or placeholder text.

## Threat Flags

None — all network endpoints in this plan are covered by the plan's threat model (T-09-04-01 through T-09-04-09). No new surfaces introduced.

## Self-Check: PASSED

- packages/server/src/routes/tasks/index.ts — FOUND
- packages/server/src/routes/tasks/list.ts — FOUND
- packages/server/src/routes/tasks/get.ts — FOUND
- packages/server/src/routes/tasks/create.ts — FOUND
- packages/server/src/routes/tasks/update.ts — FOUND
- packages/server/src/routes/tasks/delete.ts — FOUND
- packages/server/src/routes/tasks/__tests__/create.integration.test.ts — FOUND
- packages/server/src/routes/tasks/__tests__/list.integration.test.ts — FOUND
- packages/server/src/routes/tasks/__tests__/update.integration.test.ts — FOUND
- packages/server/src/routes/tasks/__tests__/delete.integration.test.ts — FOUND
- packages/server/src/routes/tasks/__tests__/validation.integration.test.ts — FOUND
- Task 1 commit 83312f9 — FOUND
- Task 2 commit b773488 — FOUND
