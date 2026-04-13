---
phase: 03-commands-resolver
plan: "02"
subsystem: resolver
tags: [resolver, interpolation, platform-overrides, env-vars, redaction, tdd]

requires:
  - phase: 03-01
    provides: "commandsLoader.load() returning validated CommandMap; tokenize() for inline command splitting"
  - phase: 02-config-system
    provides: "configLoader.load() returning ResolvedConfig with values, provenance, secretKeys"
provides:
  - "resolver.resolve(aliasName, commands, config) → ExecutionPlan (single/sequential/parallel)"
  - "interpolateArgv(argv, aliasName, values) — ${VAR} placeholder expansion with $${} escape"
  - "selectPlatformCmd(def, aliasName) — OS-aware command selection with D-14 runtime error"
  - "buildEnvVars(values) — dot-notation to UPPER_UNDERSCORE env var transform"
  - "redactSecrets(envVars, secretKeys) — secret masking for display output"
affects:
  - "Phase 4 (Executor & CLI) consumes ExecutionPlan from resolver.resolve()"
  - "Phase 4 uses buildEnvVars/redactSecrets for env injection and --verbose/--dry-run display"

tech-stack:
  added: []
  patterns:
    - "TDD (RED/GREEN/REFACTOR) for all modules"
    - "D-09 lookup-based alias detection: CommandMap.has(step) determines alias-ref vs inline"
    - "D-10 depth cap enforced at depth > 10 in resolveAlias(); chain array passed through recursion for error context"
    - "D-14 platform-only command: empty cmd[] accepted; runtime error when current OS has no match"
    - "INT-03 no-re-split: interpolation expands placeholders within tokens, never re-tokenizes"
    - "Secrets-safe errors: error constructors receive only key names and alias names, never config values (T-03-05/T-03-09)"

key-files:
  created:
    - src/resolver/platform.ts
    - src/resolver/envvars.ts
    - src/resolver/interpolate.ts
    - src/resolver/__tests__/resolver.test.ts
  modified:
    - src/resolver/index.ts

key-decisions:
  - "Sequential nested alias refs expand (flatten) inline: if a sequential step references another sequential alias, its sub-steps merge into the parent sequence"
  - "Parallel group entries must resolve to single commands; embedding sequential/parallel aliases in a parallel group throws CommandSchemaError"
  - "resolveToArgvArrays() helper handles the sequential/parallel flattening to keep resolveAlias() clean"
  - "noTemplateCurlyInString biome warnings in test file are intentional: test fixtures require literal ${...} strings to test interpolation"

patterns-established:
  - "Interpolation regex: /\\$\\$\\{[^}]+\\}|\\$\\{([^}]+)\\}/g — matches escape first, then placeholder; undefined capture group = escape sequence"
  - "Env var transform: dotKey.toUpperCase().replace(/\\./g, '_') — single-step dot-notation to UPPER_UNDERSCORE"
  - "Redaction: build Set of UPPER_UNDERSCORE forms from secretKeys dot-notation, then check envVars keys"

requirements-completed: [CMD-07, INT-01, INT-02, INT-03, INT-04, INT-05]

duration: ~4min
completed: 2026-04-13
---

# Phase 3 Plan 2: Resolver Implementation Summary

**Resolver that transforms alias + CommandMap + ResolvedConfig into an interpolated ExecutionPlan: ${VAR} expansion with $${} escape, OS-aware platform override selection, UPPER_UNDERSCORE env var building, and secrets redaction for display.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-13T10:41:42Z
- **Completed:** 2026-04-13T10:45:52Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `resolver.resolve()` produces correct ExecutionPlan for single, sequential, and parallel aliases with full placeholder interpolation
- Platform override selection with D-14 runtime error when current OS has no matching command
- `buildEnvVars` and `redactSecrets` exported for Phase 4's env injection and display redaction
- 38 tests passing across platform, envvars, interpolate, and resolver modules

## Task Commits

1. **Task 1 RED: Failing tests** - `76d906a` (test)
2. **Task 1 GREEN: platform.ts, envvars.ts, interpolate.ts** - `6a203c5` (feat)
3. **Task 2 GREEN: resolver/index.ts + full tests** - `bd5a6c0` (feat)

_Note: TDD tasks have RED commit (failing tests) + GREEN commit (implementation)._

## Files Created/Modified

- `src/resolver/platform.ts` — `currentOsKey()` + `selectPlatformCmd()` with D-14 error
- `src/resolver/envvars.ts` — `buildEnvVars()` dot-to-UPPER_UNDERSCORE + `redactSecrets()` masking
- `src/resolver/interpolate.ts` — `interpolateArgv()` with `${VAR}` expansion and `$${VAR}` escape
- `src/resolver/index.ts` — `resolver.resolve()` replacing NotImplementedError stub; re-exports buildEnvVars/redactSecrets
- `src/resolver/__tests__/resolver.test.ts` — 38 tests covering all modules and integration scenarios

## Decisions Made

- Sequential nested alias refs flatten inline (steps of a referenced sequential alias merge into parent) — simplest approach consistent with `ExecutionPlan.sequential.steps: readonly (readonly string[])[]` type
- Parallel group entries must resolve to single commands; non-single aliases in parallel groups throw `CommandSchemaError` with a clear message
- `resolveToArgvArrays()` internal helper handles the sequential/parallel flattening to keep `resolveAlias()` clean and readable

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Convention] Biome import order, formatting, and noNonNullAssertion fixes**
- **Found during:** Task 1 and Task 2 lint checks
- **Issue:** Biome flagged non-null assertion (`values[key]!`), import order in resolver.test.ts and index.ts, and formatting in envvars.ts. The `noTemplateCurlyInString` warnings in the test file are intentional (test fixtures require literal `${...}` strings) and cannot be suppressed without altering test semantics.
- **Fix:** Applied `npx biome check --write` for import sort + format. Replaced `values[key]!` with `String(values[key])` to avoid non-null assertion. Exit code 0 with 13 info-level warnings (expected, intentional).
- **Files modified:** `src/resolver/interpolate.ts`, `src/resolver/envvars.ts`, `src/resolver/index.ts`, `src/resolver/__tests__/resolver.test.ts`
- **Committed in:** bd5a6c0 (Task 2 commit after biome --write)

---

**Total deviations:** 1 auto-fixed (biome convention)
**Impact on plan:** Auto-fix necessary for lint compliance. No scope creep.

## Issues Encountered

None — all modules implemented and tests passed on first run after implementation.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All trust boundary mitigations from the plan's threat model are satisfied:

- **T-03-05 (Info Disclosure via interpolation errors):** `UndefinedPlaceholderError` receives only the key name and alias name — never the config value. Verified in test: error message contains "missing" and "test" but not the value.
- **T-03-06 (Info Disclosure via secrets in env):** `redactSecrets()` replaces secret env values with `***` using UPPER_UNDERSCORE-converted secretKeys. Verified by `redactSecrets` tests.
- **T-03-07 (Tampering via command injection):** `interpolateArgv()` expands within tokens, no re-splitting (INT-03). Phase 4 uses `shell:false` (EXE-01). Test confirms `${user}@${host}:/app` → single token `admin@srv:/app`.
- **T-03-08 (DoS via depth):** `resolveAlias()` throws `CommandSchemaError` at `depth > 10` with full chain. Verified by depth-cap test.
- **T-03-09 (Info Disclosure via error messages):** All `CommandSchemaError`/`UnknownAliasError` constructors receive only alias names and structural descriptions — never config values.

## Known Stubs

None. `src/resolver/index.ts` no longer contains `NotImplementedError`.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/resolver/platform.ts | FOUND |
| src/resolver/envvars.ts | FOUND |
| src/resolver/interpolate.ts | FOUND |
| src/resolver/index.ts (stub replaced) | FOUND |
| src/resolver/__tests__/resolver.test.ts | FOUND |
| Commit 76d906a (test: RED phase) | FOUND |
| Commit 6a203c5 (feat: platform/envvars/interpolate GREEN) | FOUND |
| Commit bd5a6c0 (feat: resolver index + full tests GREEN) | FOUND |
| npx vitest run src/resolver/__tests__/ — 38 tests pass | PASS |
| npx vitest run src/commands/__tests__/ — 42 tests pass (regression) | PASS |
| npx biome check src/resolver/ src/commands/ — exit 0, warnings only | PASS |
| npx tsup — dist/cli.mjs 126.41 KB build success | PASS |
| index.ts does NOT contain NotImplementedError | PASS |

## Next Phase Readiness

- Phase 4 (Executor & CLI) can consume `resolver.resolve()` directly — ExecutionPlan types are fully populated
- `buildEnvVars` and `redactSecrets` are re-exported from `src/resolver/index.ts` for Phase 4 convenience
- Remaining blocker: Phase 4 needs targeted research before planning (execa v9 AbortController/cancelSignal pattern for parallel kill-on-failure; commander v14 passThroughOptions interaction)

---
*Phase: 03-commands-resolver*
*Completed: 2026-04-13*
