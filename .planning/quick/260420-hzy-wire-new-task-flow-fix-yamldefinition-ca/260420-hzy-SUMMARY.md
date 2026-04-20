---
phase: 260420-hzy
plan: 01
subsystem: ui
tags: [react, react-router, tanstack-query, ajv, monaco, vite]

# Dependency graph
requires:
  - phase: 13-web-dashboard-spa
    provides: TaskEditor + useTasks + MonacoYamlEditor patterns reused for Create flow
  - phase: 09-task-definitions-secrets-management
    provides: Server AJV CreateTaskBody schema (yamlDefinition camelCase, additionalProperties:false)
provides:
  - Create Task flow (POST /api/orgs/:orgId/tasks) wired from the TasksList "New Task" button
  - useCreateTask() mutation hook (sibling of useUpdateTask)
  - TaskCreate route at /tasks/new with Monaco editor + inline validation markers
  - Fix for silent task-edit drop (TaskEditor.PATCH now uses camelCase yamlDefinition so AJV accepts it)
affects: [web-dashboard, task-crud, future-task-flow-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Wire contract drift guard — web client field names must match server AJV schema exactly (additionalProperties:false silently strips unknown keys)
    - Static routes registered BEFORE parameter routes in React Router (tasks/new before tasks/:id/edit)
    - Create-flow simpler than Edit — no diff dialog, no initial fetch, default YAML scaffold

key-files:
  created:
    - packages/web/src/routes/tasks/TaskCreate.tsx
  modified:
    - packages/web/src/lib/types.ts
    - packages/web/src/routes/tasks/TaskEditor.tsx
    - packages/web/src/routes/tasks/TaskTrigger.tsx
    - packages/web/src/hooks/useRuns.ts
    - packages/web/src/hooks/useTasks.ts
    - packages/web/src/routes/index.tsx
    - packages/web/src/routes/tasks/TasksList.tsx

key-decisions:
  - "TaskCreate mirrors TaskEditor's error-code string ('TASK_VALIDATION_FAILED') for behavioural consistency even though the server actually emits 'XCI_SRV_TASK_VALIDATION'; both will be fixed in a future cleanup."
  - "No shadcn <Textarea> component exists in the repo; kept the inlined textarea (same utility classes as <Input>) per plan direction rather than creating a new ui/textarea.tsx."
  - "Static-segment ordering is load-bearing: tasks/new must sit above tasks/:id/edit in createBrowserRouter so the param matcher doesn't greedily consume 'new' as an id."

patterns-established:
  - "Server wire contract is the source of truth — when AJV uses additionalProperties:false, the web client's request body keys must match exactly. Snake_case vs camelCase drift becomes a silent-drop bug."
  - "TasksList 'New Task' button pattern: RoleGate wraps Link wraps Button — outer RoleGate preserves Viewer disabled-with-tooltip semantics (D-11 from Phase 13)."

requirements-completed:
  - QUICK-260420-hzy

# Metrics
duration: ~20 min
completed: 2026-04-20
---

# Quick Task 260420-hzy: Wire New Task flow + fix yamlDefinition camelCase drift

**Web dashboard now supports task creation; task YAML edits now persist (closes silent-drop bug from AJV additionalProperties:false).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-20T13:07:00Z (approx — execution began after file reads)
- **Completed:** 2026-04-20T13:27:41Z
- **Tasks:** 3 (A: rename commit, B: create flow commit, C: verification sweep — no commit)
- **Files modified:** 7 (1 created, 6 edited)

## Accomplishments

- Renamed `TaskDetail.yaml_definition` → `yamlDefinition` and updated all 7 call sites (types.ts, TaskEditor.tsx ×4, TaskTrigger.tsx ×2, useRuns.ts ×1). Zero occurrences of `yaml_definition` remain under `packages/web/src/`.
- Added `useCreateTask()` mutation hook in `useTasks.ts` (POST-based sibling of `useUpdateTask`); imports `apiPost` alongside existing helpers and invalidates the tasks list cache on success.
- Built `TaskCreate.tsx` at `/tasks/new` — Monaco YAML editor seeded with a default template, name + description inputs, RoleGate-wrapped Create button, inline validation markers mirroring TaskEditor. On success it navigates to `/tasks/:id/edit`.
- Registered the route in `routes/index.tsx` strictly BEFORE `/tasks/:id/edit` so the static segment wins over the `:id` param.
- Turned the `TasksList` "New Task" button into a real `<Link to="/tasks/new">` while keeping the outer RoleGate so Viewers still see the D-11 disabled+tooltip treatment.
- Closed the silent-drop save bug: PATCH body now sends `yamlDefinition: value` which matches the server AJV schema (`additionalProperties:false`) — edits actually persist instead of being silently stripped and returning 200.

## Task Commits

Each task was committed atomically on branch `main`:

1. **Task A: rename yaml_definition → yamlDefinition** — `7a54bcc` (fix)
   - `fix(web): align task yamlDefinition key with server camelCase`
   - Files: `packages/web/src/lib/types.ts`, `packages/web/src/routes/tasks/TaskEditor.tsx`, `packages/web/src/routes/tasks/TaskTrigger.tsx`, `packages/web/src/hooks/useRuns.ts`
2. **Task B: Create Task flow** — `ba692ce` (feat)
   - `feat(web): add Create Task flow (POST /tasks) wired to New Task button`
   - Files: `packages/web/src/hooks/useTasks.ts`, `packages/web/src/routes/tasks/TaskCreate.tsx` (new), `packages/web/src/routes/index.tsx`, `packages/web/src/routes/tasks/TasksList.tsx`
3. **Task C: Final verification sweep** — no commit (gate-only).

_(Final metadata/SUMMARY commit is handled by the orchestrator after this file is written.)_

## Files Created/Modified

- **Created:** `packages/web/src/routes/tasks/TaskCreate.tsx` — new route component, 147 lines.
- **Modified (Task A):**
  - `packages/web/src/lib/types.ts` — `TaskDetail.yaml_definition` → `yamlDefinition`.
  - `packages/web/src/routes/tasks/TaskEditor.tsx` — 4 call sites renamed (setValue, PATCH body, dirty check, diff editor original).
  - `packages/web/src/routes/tasks/TaskTrigger.tsx` — 2 sites renamed (docstring comment + extractPlaceholders call).
  - `packages/web/src/hooks/useRuns.ts` — `RunDetail.task.yaml_definition` → `yamlDefinition`.
- **Modified (Task B):**
  - `packages/web/src/hooks/useTasks.ts` — imported `apiPost`; appended `useCreateTask()` hook.
  - `packages/web/src/routes/index.tsx` — imported `TaskCreate`; added `{ path: 'tasks/new', element: <TaskCreate /> }` above `tasks/:id/edit`.
  - `packages/web/src/routes/tasks/TasksList.tsx` — wrapped "New Task" Button in `<Link to="/tasks/new">` inside the existing RoleGate.

## Decisions Made

- Mirrored TaskEditor's pre-existing `code === 'TASK_VALIDATION_FAILED'` check in TaskCreate even though the actual server code is `XCI_SRV_TASK_VALIDATION`. The plan explicitly scoped this pre-existing web-side bug out — a future cleanup will fix both components at once.
- Kept the inline textarea in TaskCreate (same utility classes as `<Input>`) — no `ui/textarea.tsx` exists in the repo and creating one was out of scope.
- Left the stray `packages/web/tsconfig.tsbuildinfo` pre-existing modification (from a prior local build) out of both commits — unrelated to this ticket and would have polluted the diff.

## Deviations from Plan

None — plan executed exactly as written. All task actions, file edits, commit messages, and verification steps match the plan. No Rule 1/2/3/4 auto-fixes or checkpoints triggered.

## Issues Encountered

**Pre-existing test-harness issue (NOT fixed, documented in `deferred-items.md`):**

- `packages/web/e2e/smoke.spec.ts` is a Playwright E2E spec that Vitest picks up because `vitest.config.ts` has no `exclude` pattern. Running `pnpm --filter @xci/web test` reports `1 failed | 12 passed` test files even on base HEAD `9f9e434` with this ticket's changes stashed — reproduced both before and after our edits, with identical 102/102 unit-test pass counts. Out of scope per the deviation-rules scope boundary. A future one-line fix is to add `exclude: ['e2e/**']` to `vitest.config.ts`.
- Secondary flake: two `AgentsEmptyState` DOM queries intermittently fail during concurrent runs (earlier test run leaves leftover DOM in happy-dom pool). In isolation the file passes 7/7. Also pre-existing and unrelated.

## Verification (Task C)

All 8 gate steps passed:

| # | Gate | Result |
| - | ---- | ------ |
| 1 | `pnpm --filter @xci/web typecheck` | PASS (exit 0) |
| 2 | `pnpm --filter @xci/web test` (unit tests) | 102/102 unit tests pass. `e2e/smoke.spec.ts` fails pre-existingly — documented above; confirmed same behavior on base HEAD. |
| 3 | `pnpm --filter @xci/web build` | PASS; `dist/index-BS3azHuP.js` 576.60 kB / 178.51 kB gzip, Monaco chunk 23.66 kB / 8.29 kB gzip. |
| 4 | `grep -rn "yaml_definition" packages/web/src/` | 0 matches. |
| 5 | Tailwind tokens regression guard (260420-hcc) | `packages/web/dist/assets/index-CsWaAt3t.css` contains 7 occurrences of `bg-background\|text-foreground\|border-border` (≥ 3 required). |
| 6 | Agent bundle regression guard (260420-ezf) | `packages/xci/dist/cli.mjs` present, 1 occurrence of `'./agent.mjs'` (≥ 1 required). |
| 7 | Route-order guard | `tasks/new` on line 37, `tasks/:id/edit` on line 38 of `routes/index.tsx` — static wins over param. |
| 8 | Two-commits-clean guard | HEAD = `ba692ce` (feat), HEAD~1 = `7a54bcc` (fix). Only untracked `.planning/` + pre-existing `tsbuildinfo` modification remain in the working tree. |

## Self-Check: PASSED

File existence:
- `packages/web/src/routes/tasks/TaskCreate.tsx` — FOUND
- `packages/web/src/routes/index.tsx` contains `tasks/new` entry above `tasks/:id/edit` — VERIFIED (lines 37 and 38)
- `packages/web/src/hooks/useTasks.ts` exports `useCreateTask` and imports `apiPost` — VERIFIED
- `packages/web/src/routes/tasks/TasksList.tsx` wraps `<Link to="/tasks/new">` inside RoleGate — VERIFIED

Commit existence:
- `7a54bcc` — FOUND (`git log --oneline` row 2)
- `ba692ce` — FOUND (`git log --oneline` row 1 / HEAD)

Grep fence:
- `grep -rn "yaml_definition" packages/web/src/` — 0 matches (VERIFIED)

## User Setup Required

None — no external service configuration changed. The server endpoint this code posts to already existed (Phase 09 `POST /api/orgs/:orgId/tasks`). No DB migration, no env var, no secret.

## Next Phase Readiness

- The last missing CRUD operation on tasks (Create) is now live in the web UI.
- The silent-drop edit bug is closed — users who previously hit "Confirm save" and saw "success" without persistence will now have their edits actually land.
- Two residual cleanup candidates surfaced but NOT addressed (out of scope):
  1. Web-side error code mismatch (`TASK_VALIDATION_FAILED` vs server's `XCI_SRV_TASK_VALIDATION`) — inline Monaco markers don't render today because no `ApiError` actually matches; this is a separate pre-existing bug documented in the plan's `<error_code_note>`.
  2. Vitest picking up Playwright E2E spec — see `deferred-items.md`.

---
*Quick task: 260420-hzy-wire-new-task-flow-fix-yamldefinition-ca*
*Completed: 2026-04-20*
