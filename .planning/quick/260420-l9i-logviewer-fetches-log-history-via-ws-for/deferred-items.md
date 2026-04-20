## Deferred Items — out-of-scope findings during 260420-l9i

### 1. Vitest picks up Playwright E2E spec (pre-existing)

**File:** `packages/web/vitest.config.ts`
**Issue:** `packages/web/e2e/smoke.spec.ts` is a Playwright test file that Vitest tries to execute because `vitest.config.ts` has no `test.exclude` pattern for `e2e/**`. Vitest fails to load it with `test.describe() called outside test runner` + an unrelated ECONNREFUSED to `127.0.0.1:3000` during import-time evaluation.
**Pre-existing:** Present since 6a59886 (13-06 CI + Playwright spec). Base HEAD 5cd4d0e exhibits the same failure.
**Impact:** `pnpm --filter @xci/web test` reports 1 failed test **file** (not test — the file contains 0 executable Vitest tests) while all 102 actual unit/component tests pass.
**Fix (future plan):** Add `exclude: ['e2e/**', 'node_modules/**', 'dist/**']` to the `test` block in `packages/web/vitest.config.ts`.
**Out-of-scope because:** Unrelated to LogViewer WS-gate change; is a project-wide vitest configuration issue.

### 2. Plan's CSS regression check uses `grep -c` (line count) vs. occurrence count

**File:** `.planning/quick/260420-l9i-logviewer-fetches-log-history-via-ws-for/260420-l9i-PLAN.md` (Task 2 verify line 178)
**Issue:** The plan's automated verify is `grep -cE "..." dist/...css | awk '{if ($1 < 3) exit 1}'`. `grep -c` counts **lines with matches**, but Vite minifies CSS into a single line, so the count is 1 regardless of how many class occurrences are present. The semantic intent (>= 3 occurrences) is satisfied — actual occurrence count via `grep -oE ... | wc -l` is 7 — but the literal spec as written fails.
**Impact:** None on this plan's success (semantic regression is intact). Future plans copying this pattern should use `grep -o ... | wc -l` instead.
**Out-of-scope because:** Observation/spec-suggestion only; nothing to fix in code.
