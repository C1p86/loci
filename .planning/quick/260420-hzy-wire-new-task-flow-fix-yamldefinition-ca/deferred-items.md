# Deferred Items — 260420-hzy

Out-of-scope issues discovered during execution. NOT fixed in this quick task.

## 1. `packages/web/e2e/smoke.spec.ts` fails under `vitest run`

**Symptom:** `Test Files 1 failed | 12 passed (13)` — the failing file is `e2e/smoke.spec.ts`.

**Root cause:** The file is a Playwright E2E spec (`import { test } from '@playwright/test'`) but `packages/web/vitest.config.ts` has no `test.exclude` pattern, so Vitest picks up `e2e/*.spec.ts` and tries to run it. Playwright's `test.describe()` throws when invoked outside the Playwright runner.

**Confirmed pre-existing:** Reproduced on base HEAD `9f9e434` with this ticket's changes stashed — same failure, same 102 unit tests pass. Not caused by the `yaml_definition` → `yamlDefinition` rename nor by the Create Task flow.

**Secondary symptom (flaky):** Some vitest runs also show 2 failing DOM assertions (e.g. `AgentsEmptyState` multiple-button match). These are caused by a leftover dev server / earlier test pollution on port 3000 and clear up when run in isolation. Unrelated to this ticket.

**Fix plan (future):** Either
- Add `exclude: ['e2e/**']` to `vitest.config.ts`, OR
- Rename `e2e/*.spec.ts` to `e2e/*.e2e.ts` and narrow `include`.

Both are one-line changes; deferring so this ticket stays focused on the task-flow/rename scope.
