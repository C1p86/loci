# Deferred Items — 260420-hcc

Items discovered during execution that are out of scope per `<scope_boundary>`.

## 1. e2e/smoke.spec.ts runs under vitest (pre-existing)

**File:** `packages/web/e2e/smoke.spec.ts`
**Found during:** Task C verification (pnpm --filter @xci/web test)
**Issue:** Vitest picks up `packages/web/e2e/smoke.spec.ts` but the file uses Playwright's `test.describe()` and tries to connect to `127.0.0.1:3000` (the full Docker stack), producing two kinds of failures in `pnpm --filter @xci/web test`:
  1. `Error: Playwright Test did not expect test.describe() to be called here.` when vitest transforms it.
  2. `ECONNREFUSED 127.0.0.1:3000` when the test actually tries to boot.
**Why pre-existing:** Completely independent of Task A/B/C changes — the file is a Playwright spec misrouted into the vitest suite and is environment-dependent (needs Docker smoke-stack per Phase 14 runbook).
**Deferred to:** Phase 13 or Phase 14 polish — add `exclude: ['e2e/**']` to `packages/web/vitest.config.ts` so Playwright specs only run under `pnpm exec playwright test`, not vitest.
**Proof it's unrelated:** `packages/web/src/__tests__/AgentsEmptyState.test.tsx` runs green in isolation via `vitest run src/__tests__/AgentsEmptyState.test.tsx` — 7/7 tests pass (6 original + 1 new Generate-another assertion introduced by Task C).
