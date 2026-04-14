---
phase: 04-executor-cli
reviewed: 2026-04-14T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - src/__tests__/cli.e2e.test.ts
  - src/__tests__/types.test.ts
  - src/cli.ts
  - src/commands/normalize.ts
  - src/executor/__tests__/output.test.ts
  - src/executor/__tests__/parallel.test.ts
  - src/executor/__tests__/sequential.test.ts
  - src/executor/__tests__/single.test.ts
  - src/executor/output.ts
  - src/executor/parallel.ts
  - src/executor/sequential.ts
  - src/executor/single.ts
  - src/resolver/__tests__/resolver.test.ts
  - src/resolver/index.ts
  - src/types.ts
findings:
  critical: 1
  warning: 5
  info: 6
  total: 12
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-04-14
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

This phase introduces the executor layer (single, sequential, parallel runners), CLI wiring, resolver, command normalizer, and shared types. The architecture is sound: types are well-defined discriminated unions, the executor dispatches cleanly, and the output module is cleanly separated. Test coverage is broad.

Two problem areas stand out:

1. **Security — secret values leaking through argv in dry-run output.** `buildSecretValues` is defined in `output.ts` and is also exported from `executor/index.ts`, but `printDryRun`'s second parameter is documented (via comment) as accepting secret *values*, not secret *keys* — yet the type signature is `ReadonlySet<string>` in both cases. In `cli.ts` the call is `printDryRun(plan, secretValues)` which is correct, but the internal `output.ts` comment on `printDryRun` says "For dry-run we treat secretKeys as secret values" — a misleading comment that obscures the contract and could cause a future caller to pass secret *keys* (config key names) instead of actual values, which would not redact anything.

2. **Logic — `runSingle` catch block catches its own re-thrown `SpawnError`.** The `instanceof` check in the catch uses `err.constructor.name === 'SpawnError'` instead of `err instanceof SpawnError`. In a bundled ESM context where the class is defined once this works, but is fragile (e.g. across module boundaries or if the class is minified/renamed). The intent of the guard is correct but the mechanism is unsafe.

---

## Critical Issues

### CR-01: `printDryRun` parameter name and comment contradict the actual usage

**File:** `src/executor/output.ts:132-135`

**Issue:** The function `printDryRun(plan, secretKeys)` is declared with parameter name `secretKeys` and its JSDoc says "the caller should pass `buildSecretValues(config)` result as `secretKeys` parameter" — but `buildSecretValues` returns *actual secret values*, not key names. The parameter name `secretKeys` conflicts with `ResolvedConfig.secretKeys` (which holds config key names like `"api.token"`). If a future caller passes `config.secretKeys` (key names) instead of `buildSecretValues(config)` (actual values), `redactArgv` will never match any argv token and secrets will be logged in plain text.

The caller in `cli.ts` is currently correct (`printDryRun(plan, secretValues)` where `secretValues = buildSecretValues(config)`), but the declaration in `output.ts` is actively misleading — the param is named `secretKeys` in the signature, yet the body uses it as a set of secret *values* to compare against argv tokens.

**Fix:** Rename the parameter and update the JSDoc to remove the ambiguity:

```typescript
// output.ts line 132
export function printDryRun(plan: ExecutionPlan, secretValues: ReadonlySet<string>): void {
  // secretValues: the actual string values of secrets (from buildSecretValues(config)),
  // NOT the config key names (config.secretKeys). Tokens matching these values are
  // replaced with *** in dry-run output.
  const prefix = dimPrefix('dry-run');
  // ... rest unchanged, replace `secretKeys` with `secretValues` inside the function body
```

Also update the test in `output.test.ts` line 153 and 162 which already pass `new Set()` and `new Set(['supersecret'])` correctly — only the internal naming needs to change.

---

## Warnings

### WR-01: `runSingle` catch guard uses `constructor.name` instead of `instanceof`

**File:** `src/executor/single.ts:38`

**Issue:** The guard `err.constructor.name === 'SpawnError'` is used to avoid double-wrapping a `SpawnError`. String-based constructor name checks break if the class is minified, renamed, or if two different module instances of `SpawnError` exist (the check would still pass accidentally). The correct guard is `err instanceof SpawnError`, which is already imported from `'../errors.js'`.

```typescript
// Current (fragile)
if (err instanceof Error && err.constructor.name === 'SpawnError') throw err;

// Fix
if (err instanceof SpawnError) throw err;
```

### WR-02: `parallel.ts` SIGINT handler not removed when `wasInterrupted` path is taken

**File:** `src/executor/parallel.ts:74-82`

**Issue:** `process.off('SIGINT', sigintHandler)` is called at line 74, but this is only reached after `Promise.allSettled(rawPromises)` resolves. When `wasInterrupted` is true the handler removal happens correctly (it runs before the early return). However, if `Promise.allSettled` itself throws (which is not expected but possible in theory), the `sigintHandler` would remain registered permanently, accumulating across multiple calls and eventually causing a MaxListenersExceededWarning. More concretely: registering a raw `process.on('SIGINT')` in a library function that may be called multiple times (e.g. in test suites that run multiple `runParallel` calls) is already a common source of listener leaks. The tests use `vi.spyOn(process.stderr, 'write')` but do not remove the SIGINT listeners, causing accumulation across test cases in `parallel.test.ts`.

**Fix:** Use a `try/finally` block to guarantee cleanup:

```typescript
process.on('SIGINT', sigintHandler);
try {
  const settled = await Promise.allSettled(rawPromises);
  // ... rest of logic
  return { exitCode: firstFailCode };
} finally {
  process.off('SIGINT', sigintHandler);
}
```

### WR-03: `appendExtraArgs` mutates a `readonly` sequential step incorrectly

**File:** `src/cli.ts:91-94`

**Issue:** For the `sequential` case, `newSteps[lastIdx]` is assigned `[...(plan.steps[lastIdx] as readonly string[]), ...extra]`. The cast `as readonly string[]` is needed because `plan.steps[lastIdx]` is `readonly string[]`, but the real issue is that `newSteps` is typed as `string[][]` (mutable), yet `plan.steps` is `readonly (readonly string[])[]`. The spread creates a new array, which is correct. However, the TypeScript compiler would accept assigning `(readonly string[])[]` to the type of `newSteps` without the cast — the result array element is implicitly widened. This is not a runtime bug, but it means the `as readonly string[]` cast is hiding a deeper type narrowing issue. More importantly: if `plan.steps[lastIdx]` is `undefined` (which the `plan.steps.length === 0` guard only protects against when `length` is 0, not when `lastIdx` is somehow out of range), the spread `[...undefined]` would throw at runtime. With the guard in place this cannot happen, but the guard condition at line 89 reads `if (plan.steps.length === 0) return plan` — if length is zero, lastIdx would be -1 and `plan.steps[-1]` is `undefined`, which would indeed spread-throw. The guard correctly exits before that, so it is safe. However the explicit cast on line 92 should be removed to let the type system verify the narrowing:

```typescript
case 'sequential': {
  if (plan.steps.length === 0) return plan;
  const lastIdx = plan.steps.length - 1;
  const newSteps = plan.steps.map((s, i) =>
    i === lastIdx ? [...s, ...extra] : s
  );
  return { ...plan, steps: newSteps };
}
```

### WR-04: `runParallel` uses `exitCode: 0` for canceled children in the "fast" path

**File:** `src/executor/parallel.ts:57-59`

**Issue:** When a child is canceled (aborted via `AbortController`), `summaryResults[index]` is set with `exitCode: 0`. This means that if two commands fail simultaneously in `failMode: 'fast'` — command A finishes with exit 5 (triggering abort), and command B was already running when the abort fires — command B's exit code is recorded as 0 with `canceled: true`. This is the intended UX (canceled = not failed). However, the final `firstFailCode` selection in the `for` loop at lines 85-105 ignores `canceled: true` results correctly. The problem is that `summaryResults` (populated in the `then` handler) is separate from `finalResults` (populated from `settled`). The `summaryResults` array is never actually used after population — it is assigned but never read. `finalResults` is the one used for `printParallelSummary`. This dead code is harmless but confusing; `summaryResults` can be removed entirely.

**Fix:** Remove the `summaryResults` array (lines 41, 59) since `finalResults` (built from `settled`) already captures the same information and is what gets passed to `printParallelSummary`.

### WR-05: `cli.ts` D-20 / D-21: `--list` option registered but never explicitly handled

**File:** `src/cli.ts:187, 270-273`

**Issue:** The `--list` flag is registered via `program.option('-l, --list', ...)` at line 187, but the `program.action` callback at line 270 receives `options: { list?: boolean }` and then writes `void options` with a comment saying "either no args or --list → same output." This means `loci --list` and `loci` (no args) both trigger the same `printAliasList` output, which matches the test. However, commander's default behavior is that if no subcommand is matched and no action is registered, it falls through. The `void options` suppresses the lint warning but also silently discards the `list` boolean. If a future maintainer adds a distinct `--list` path and does not notice the `void options` pattern, they will spend time debugging why the flag seems to have no effect.

**Fix:** Make the intent explicit and remove the `void options` smell:

```typescript
program.action((_options: { list?: boolean }) => {
  // Both `loci` (no args) and `loci --list` show the alias list.
  // Commander routes here when no subcommand is matched.
  printAliasList(commands);
});
```

---

## Info

### IN-01: `output.ts` — `buildSecretValues` should live in `resolver/envvars.ts` not `output.ts`

**File:** `src/executor/output.ts:106-115`

**Issue:** `buildSecretValues` derives actual secret values from a `ResolvedConfig`, which is a resolver/config concern. Placing it in `output.ts` creates a dependency from the output formatting module on `ResolvedConfig` (a types contract). It is also exported through `executor/index.ts` and used in `cli.ts`. This cross-cutting placement makes the dependency graph harder to follow.

**Suggestion:** Move `buildSecretValues` to `src/resolver/envvars.ts` alongside `buildEnvVars` and `redactSecrets`, and re-export it from `resolver/index.ts`.

### IN-02: `normalize.ts` — `_filePath` parameter is unused

**File:** `src/commands/normalize.ts:75`

**Issue:** `normalizeObject` accepts `_filePath: string` which is never used inside the function body. The underscore prefix indicates intentional suppression of the unused-variable warning, but the parameter serves no purpose and should be removed if it is not needed for a future use case.

**Suggestion:** Remove the parameter from `normalizeObject` and update its single call site in `normalizeAlias`.

### IN-03: `cli.ts` — verbose trace config file list hardcodes three paths

**File:** `src/cli.ts:141-148`

**Issue:** The array `configFiles` is built by hard-coding three `.loci/` paths (`config.yml`, `secrets.yml`, `local.yml`). If a new config file layer is added in the future (e.g. `defaults.yml`), it must be manually added here. The config loading layer (`configLoader`) already knows which files it reads.

**Suggestion:** Have `configLoader.load` return the list of config file paths it attempted, or extract the path-building logic into a shared constant so the verbose trace and the loader stay in sync.

### IN-04: `parallel.test.ts` — `longRunning` timeout test is timing-sensitive

**File:** `src/executor/__tests__/parallel.test.ts:29-39`

**Issue:** The "aborts remaining commands when one fails" test asserts `elapsed < 8000`. On a heavily loaded CI machine this might be flaky. The test timeout is 12000ms, giving 4 seconds of slack. This is acceptable but worth noting; the test could be tightened by using a smaller sleep duration (e.g. 5000ms) in `longRunning` to give more margin.

**Suggestion:** Change `longRunning`'s `setTimeout(() => {}, 10000)` to `setTimeout(() => {}, 5000)` and assert `elapsed < 4000` for a more reliable margin.

### IN-05: `single.test.ts` — `/tmp` hardcoded as cwd for the cwd-propagation test

**File:** `src/executor/__tests__/single.test.ts:43`

**Issue:** The test hardcodes `const tmpDir = '/tmp'` which does not exist on Windows. Since the project targets Windows/Linux/macOS, this test will fail on Windows CI.

**Suggestion:** Use `import { tmpdir } from 'node:os'` and `const tmpDir = tmpdir()` to get the platform-appropriate temp directory.

### IN-06: `cli.e2e.test.ts` — `--version` test asserts exact version string `'0.0.0'`

**File:** `src/cli.e2e.test.ts:109`

**Issue:** `expect(stdout.trim()).toBe('0.0.0')` will fail the moment the version is bumped in `package.json` (assuming tsup's `define` replaces `__LOCI_VERSION__` with the real version). The preceding assertion `expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)` is robust; the exact string assertion adds fragility.

**Suggestion:** Remove the `toBe('0.0.0')` assertion and rely solely on the semver regex match. Alternatively, import the version from `package.json` in the test and compare against that.

---

_Reviewed: 2026-04-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
