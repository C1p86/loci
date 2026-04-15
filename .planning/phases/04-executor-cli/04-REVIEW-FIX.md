---
phase: 04-executor-cli
fixed_at: 2026-04-14T00:00:00Z
review_path: .planning/phases/04-executor-cli/04-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 04: Code Review Fix Report

**Fixed at:** 2026-04-14
**Source review:** .planning/phases/04-executor-cli/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 Critical, 5 Warnings)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: `printDryRun` parameter name and comment contradict the actual usage

**Files modified:** `src/executor/output.ts`
**Commit:** d5ea822
**Applied fix:** Renamed the `secretKeys` parameter to `secretValues` in the `printDryRun` function signature and all uses within the function body. Replaced the misleading JSDoc comment with a clear `@param secretValues` doc-comment explaining it holds actual secret values (from `buildSecretValues(config)`), not config key names (`config.secretKeys`). The `_options` style was not required here — the parameter is used, just renamed for clarity.

---

### WR-01: `runSingle` catch guard uses `constructor.name` instead of `instanceof`

**Files modified:** `src/executor/single.ts`
**Commit:** 4a88261
**Applied fix:** Replaced `err instanceof Error && err.constructor.name === 'SpawnError'` with `err instanceof SpawnError`. `SpawnError` was already imported from `'../errors.js'`, so no import change was needed. The fix is safer across bundled ESM module boundaries and handles minification correctly.

---

### WR-02: `parallel.ts` SIGINT handler not removed when `wasInterrupted` path is taken

**Files modified:** `src/executor/parallel.ts`
**Commit:** c6f515e
**Applied fix:** Wrapped `await Promise.allSettled(rawPromises)` in a `try/finally` block so `process.off('SIGINT', sigintHandler)` is called unconditionally — regardless of whether `allSettled` throws, resolves normally, or the `wasInterrupted` path is taken. `settled` was pre-declared as `let` outside the `try` block so it remains in scope for subsequent logic.

---

### WR-03: `appendExtraArgs` mutates a `readonly` sequential step incorrectly

**Files modified:** `src/cli.ts`
**Commit:** 886d330
**Applied fix:** Replaced the mutable-array mutation pattern (`const newSteps = [...plan.steps]; newSteps[lastIdx] = [...(plan.steps[lastIdx] as readonly string[]), ...extra]`) with `plan.steps.map((s, i) => i === lastIdx ? [...s, ...extra] : s)`. This removes the unsafe `as readonly string[]` cast, lets the type system verify the narrowing, and produces the same runtime result via an immutable map.

---

### WR-04: `runParallel` uses `exitCode: 0` for canceled children — dead `summaryResults` array

**Files modified:** `src/executor/parallel.ts`
**Commit:** e2eeff3
**Applied fix:** Removed the `summaryResults` array declaration (`new Array(group.length).fill(null)`) and the per-result assignment (`summaryResults[index] = ...`) inside the `.then()` handler. Also removed the now-unused `index` parameter from the `.map(({ alias, argv }, index) => ...)` callback. The `finalResults` array (built from `Promise.allSettled`) already captures all result data and is what gets passed to `printParallelSummary`.

---

### WR-05: `cli.ts` `--list` option registered but never explicitly handled

**Files modified:** `src/cli.ts`
**Commit:** 36bd3fd
**Applied fix:** Renamed the action callback parameter from `options` to `_options` (signals intentional non-use), removed the `void options` suppression line, and added two clarifying comments explaining that both `loci` (no args) and `loci --list` route to the same alias list output via Commander's default action dispatch. The behavior is unchanged; the intent is now self-documenting.

---

_Fixed: 2026-04-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
