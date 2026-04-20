# Deferred Items (out-of-scope during 260420-ggj execution)

## 1. Pre-existing cold-start test assertion is stale after 260420-ezf

**File:** `packages/xci/src/__tests__/cold-start.test.ts` lines 34-41

**Current assertion:**
```ts
expect(content).toMatch(/import\(['"]\.\/agent\/index\.js['"]\)/);
```

**Actual runtime contract (set by prior quick task 260420-ezf):** the tsup `onSuccess`
hook in `tsup.config.ts` rewrites `'./agent/index.js'` → `'./agent.mjs'` in the bundled
`dist/cli.mjs`. Orchestrator's explicit gate is
`grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs >= 1` — that regex is authoritative.

**Suggested fix (future quick task):** update cold-start.test.ts line 38 from
`\.\/agent\/index\.js` → `\.\/agent\.mjs` so the test matches the post-build artifact
the build tooling is actually producing.

**Why deferred:** this is a pre-existing test failure unrelated to 260420-ggj's scope
(URL normalization + WS logging). The failure was present on the base commit
(`bdf3598`) before any edits in this plan. Touching cold-start.test.ts here would
mix concerns and violate GSD scope-boundary rule.

## 2. Playwright `e2e/smoke.spec.ts` picked up by vitest runner

**File:** `packages/web/e2e/smoke.spec.ts`

**Symptom:** `pnpm --filter @xci/web test` reports "1 failed suite" because vitest
imports `e2e/smoke.spec.ts`, which calls `test.describe()` from `@playwright/test`
and throws: *"Playwright Test did not expect test.describe() to be called here"*.

**Actual test counts unaffected:** 101 vitest tests still pass. The suite-level
failure is purely the e2e file being discovered by vitest's glob.

**Suggested fix (future quick task):** narrow vitest's `test.include` or add
`test.exclude: ['e2e/**']` to `packages/web/vitest.config.ts` so the Playwright
file is not imported by the vitest runner.

**Why deferred:** verified pre-existing at base commit `bdf3598` with the exact same
output; out of scope for 260420-ggj.

## 3. Pre-existing xci typecheck errors (103 total)

`pnpm --filter xci typecheck` reports 103 errors at base commit `bdf3598`
(largely in `src/tui/dashboard.ts`, `src/tui/picker.ts`, `src/cli.ts`,
`src/executor/**`, `src/resolver/**`, `src/template/**`, and `tsup.config.ts`).
The post-260420-ggj count is also 103 — zero delta. Pre-existing TS hygiene debt,
out of scope for this plan.
