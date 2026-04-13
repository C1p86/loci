---
phase: 03-commands-resolver
verified: 2026-04-13T11:00:00Z
status: gaps_found
score: 13/17 must-haves verified
overrides_applied: 0
gaps:
  - truth: "npm run typecheck passes (all TypeScript errors absent)"
    status: failed
    reason: "tsc --noEmit exits 2 with 4 errors. normalize.ts lines 81, 88, 127 violate exactOptionalPropertyTypes: optional property `description?: string` is assigned `string | undefined` which is disallowed with exactOptionalPropertyTypes. resolver/index.ts line 50: `chain[0]` is `string | undefined` under noUncheckedIndexedAccess but CommandSchemaError constructor expects `string`."
    artifacts:
      - path: "src/commands/normalize.ts"
        issue: "Lines 81, 88, 127: `{ ..., description: string | undefined }` is not assignable to CommandDef with exactOptionalPropertyTypes:true. Fix: use conditional spread — `...(description !== undefined ? { description } : {})`"
      - path: "src/resolver/index.ts"
        issue: "Line 50: `chain[0]` returns `string | undefined` under noUncheckedIndexedAccess. Fix: use `chain[0] ?? aliasName` or `chain.at(0) ?? aliasName`"
    missing:
      - "Fix exactOptionalPropertyTypes violations in src/commands/normalize.ts (3 object literals)"
      - "Fix noUncheckedIndexedAccess violation in src/resolver/index.ts line 50"
human_verification:
  - test: "Observe CI run on GitHub Actions with the Phase 3 commits"
    expected: "All 6 matrix jobs (ubuntu-latest × [20,22], windows-latest × [20,22], macos-latest × [20,22]) run npm run typecheck + npm run lint + npm run build + npm test — all exit 0. Specific concern: typecheck will fail with current code; this human check is to confirm once the TypeScript errors are fixed."
    why_human: "CI matrix has not been run with Phase 3 changes. The 4 TypeScript errors identified would cause typecheck to fail in CI. Once fixed, a human must observe 6 green jobs to confirm FND-06 still holds."
---

# Phase 3: Commands & Resolver Verification Report

**Phase Goal:** `commands.yml` is fully parsed, alias composition is flattened with cycle detection at load time, and all `${VAR}` placeholders are resolved before any process is spawned
**Verified:** 2026-04-13T11:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | ROADMAP SC-1: alias with `${VAR}` placeholder resolves to correct value from config; missing var reports alias and placeholder name and does not run | VERIFIED | `interpolateArgv` expands `${VAR}` from `config.values`; `UndefinedPlaceholderError(key, aliasName)` thrown when key absent; resolver test: "throws UndefinedPlaceholderError for missing placeholder" passes with `expect().toThrow('missing')` and `expect().toThrow('test')` confirming both key and alias in error |
| 2  | ROADMAP SC-2: circular alias chain (A->B->A) detected at startup with full cycle path | VERIFIED | `validateGraph` in `src/commands/validate.ts` uses DFS three-color marking; `CircularAliasError(cyclePath)` thrown with `[...path.slice(cycleStart), ref]` as cycle path; integration tests confirm cycle path includes both 'a' and 'b' alias names |
| 3  | ROADMAP SC-3: alias referencing other aliases (`ci: [lint, test, build]`) executes each constituent alias | VERIFIED | Resolver sequential case expands steps via D-09 lookup; nested alias refs recursively resolved via `resolveToArgvArrays`; integration test "expands nested sequential alias steps inline" passes |
| 4  | ROADMAP SC-4: secret values shown as `***` in verbose/dry-run output | VERIFIED | `redactSecrets(envVars, secretKeys)` converts secretKeys dot-notation to UPPER_UNDERSCORE and replaces env var values with `'***'`; test "replaces secret env values with ***" passes; `buildEnvVars` + `redactSecrets` re-exported from `src/resolver/index.ts` for Phase 4 use |
| 5  | Bare string value parsed as single command with whitespace tokenization | VERIFIED | `tokenize.ts` splits on whitespace with `inQuotes` tracking; `normalizeAlias` calls `tokenize(raw, aliasName)` for string inputs; integration test "normalizes a bare string shorthand to kind:single" passes |
| 6  | Object with `steps:` parsed as sequential command | VERIFIED | `normalizeObject` checks `Object.hasOwn(obj, 'steps')` first; returns `{ kind: 'sequential', steps, description }`; integration test "normalizes object with steps to kind:sequential" passes |
| 7  | Object with `parallel:` parsed as parallel command | VERIFIED | `normalizeObject` checks `Object.hasOwn(obj, 'parallel')`; returns `{ kind: 'parallel', group, description }`; integration test "normalizes object with parallel to kind:parallel" passes |
| 8  | Circular alias chains detected at load time with full cycle path | VERIFIED | Same as ROADMAP SC-2 above; DFS with gray-node back-edge detection; all 3 cycle tests pass (A->B->A, A->B->C->A, self-reference) |
| 9  | Unknown alias references in steps/parallel do NOT throw UnknownAliasError at load time (D-09 lookup-based detection) | VERIFIED | Per D-09 (user-accepted decision): only step entries matching CommandMap keys are alias edges; others are inline commands. `getAliasRefs()` filters via `commands.has(step)`. Three D-09 tests pass confirming inline command treatment for non-matching entries. CMD-09 is satisfied by this design — there are no "referenced aliases that don't exist" because non-matches are inline. |
| 10 | All aliases eagerly validated at load time | VERIFIED | `commandsLoader.load()` calls `validateGraph(commands)` on every load before returning; D-11 honored |
| 11 | Nesting depth exceeding 10 throws at resolver time with expansion chain | VERIFIED | `resolveAlias` checks `depth > 10` and throws `CommandSchemaError(chain[0], 'alias nesting exceeds maximum depth of 10: ...')` with chain; test "throws CommandSchemaError when nesting depth exceeds 10" passes with a 12-level chain |
| 12 | `${VAR}` placeholders resolved to concrete argv tokens from config values | VERIFIED | `interpolateArgv` maps tokens through `interpolateToken` using regex `PLACEHOLDER_RE`; dot-notation keys (`${deploy.host}`) supported; 7 interpolation tests pass |
| 13 | `$${VAR}` produces literal `${VAR}` in output | VERIFIED | Regex alternation matches `$${}` before `${}` (undefined capture group = escape); `match.slice(1)` strips one `$`; test "handles `$${VAR}` escape producing literal `${VAR}`" passes |
| 14 | Platform overrides select correct command for current OS | VERIFIED | `selectPlatformCmd` maps `process.platform` to `'linux'|'windows'|'macos'` via `currentOsKey()`; correct mapping: win32→windows, darwin→macos; 5 platform tests pass |
| 15 | Platform-only alias with no matching OS throws at resolve time | VERIFIED | `selectPlatformCmd` throws `CommandSchemaError` when `cmd.length === 0` and no matching platform override; test "throws CommandSchemaError for platform-only alias with no match for current OS" passes; D-14 run-time error honored |
| 16 | All config keys available as UPPER_UNDERSCORE env vars in execution plan | VERIFIED | `buildEnvVars` transforms dot-notation to `dotKey.toUpperCase().replace(/\./g, '_')`; exported from `src/resolver/index.ts`; 4 buildEnvVars tests pass |
| 17 | **npm run typecheck passes (TypeScript strict mode)** | FAILED | `tsc --noEmit` exits 2 with 4 errors: (1) `src/commands/normalize.ts:81` — `{ description: string \| undefined }` violates `exactOptionalPropertyTypes`, (2) same at line 88, (3) same at line 127, (4) `src/resolver/index.ts:50` — `chain[0]` is `string \| undefined` under `noUncheckedIndexedAccess` |

**Score:** 16/17 truths verified (ROADMAP truths: 4/4 verified; plan truths: 12/13 verified; TypeScript check: 0/1 verified)

Note: biome check exits 0 (no errors, 13 info-level `noTemplateCurlyInString` warnings in test file — intentional per SUMMARY deviation note).

### Deferred Items

None — no gaps match later phase goals.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/commands/tokenize.ts` | Whitespace tokenizer with double-quote preservation; exports `tokenize` | VERIFIED | 51 lines; exports `tokenize(input, aliasName): readonly string[]`; character-by-character loop with `inQuotes` flag; throws `CommandSchemaError` on unclosed quote |
| `src/commands/normalize.ts` | Raw YAML to CommandDef normalization; exports `normalizeCommands` | VERIFIED (with TS errors) | 164 lines; exports `normalizeCommands`; handles string/array/object/steps/parallel/platform-overrides; 3 `exactOptionalPropertyTypes` violations prevent typecheck from passing |
| `src/commands/validate.ts` | Cycle detection and unknown alias validation; exports `validateGraph` | VERIFIED | 95 lines; DFS three-color marking (`'white'|'gray'|'black'`); D-09 lookup-based ref filtering; depth cap at > 10 |
| `src/commands/index.ts` | commandsLoader.load() replacing stub | VERIFIED | 82 lines; no `NotImplementedError`; reads `.loci/commands.yml` via `readFileSync`; ENOENT → empty Map; chains: readCommandsYaml → normalizeCommands → validateGraph |
| `src/commands/__tests__/tokenize.test.ts` | Tokenizer unit tests | VERIFIED | 9 tests; covers whitespace splits, quote preservation, empty input, unclosed quote throwing `CommandSchemaError` |
| `src/commands/__tests__/commands.test.ts` | Commands loader integration tests | VERIFIED | 33 tests; covers normalization, YAML errors, schema validation, cycle detection, D-09 lookup semantics |
| `src/resolver/interpolate.ts` | Placeholder expansion with escape; exports `interpolateArgv` | VERIFIED | 49 lines; regex `\$\$\{[^}]+\}\|\$\{([^}]+)\}`; escape handled by undefined capture group; throws `UndefinedPlaceholderError` |
| `src/resolver/platform.ts` | Platform selection; exports `selectPlatformCmd`, `currentOsKey` | VERIFIED | 57 lines; maps `linux→'linux'`, `win32→'windows'`, `darwin→'macos'`; D-14 run-time error for no-match platform-only alias |
| `src/resolver/envvars.ts` | Env var transform and redaction; exports `buildEnvVars`, `redactSecrets` | VERIFIED | 35 lines; dot→UPPER_UNDERSCORE transform; `'***'` redaction using Set of UPPER_UNDERSCORE-converted secretKeys |
| `src/resolver/index.ts` | resolver.resolve() replacing stub; re-exports buildEnvVars/redactSecrets | VERIFIED (with TS error) | 115 lines; no `NotImplementedError`; imports from all 3 resolver modules + commands/tokenize; re-exports `buildEnvVars`/`redactSecrets`; depth cap enforced at line 48-53; `chain[0]` TS error at line 50 |
| `src/resolver/__tests__/resolver.test.ts` | Resolver unit and integration tests | VERIFIED | 38 tests; covers platform, envvars, interpolate, and resolver.resolve for single/sequential/parallel; depth cap; escape; re-exports |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/commands/index.ts` | `src/commands/normalize.ts` | `normalizeCommands(raw, filePath)` | WIRED | Import at line 12: `import { normalizeCommands } from './normalize.js'`; called at line 78 |
| `src/commands/index.ts` | `src/commands/validate.ts` | `validateGraph(commands)` | WIRED | Import at line 13: `import { validateGraph } from './validate.js'`; called at line 79 |
| `src/commands/normalize.ts` | `src/commands/tokenize.ts` | `tokenize(stringCmd)` | WIRED | Import at line 8: `import { tokenize } from './tokenize.js'`; called in `normalizeAlias` (line 136) and `normalizeObject` (lines 120, 58) |
| `src/commands/index.ts` | `src/errors.ts` | throws `YamlParseError` | WIRED | Import at line 10; `YamlParseError` thrown at lines 47, 59-63 |
| `src/resolver/index.ts` | `src/resolver/interpolate.ts` | `interpolateArgv(argv, aliasName, config.values)` | WIRED | Import at line 9; called at lines 63, 79, 101 |
| `src/resolver/index.ts` | `src/resolver/platform.ts` | `selectPlatformCmd(def, aliasName)` | WIRED | Import at line 10; called at line 62 |
| `src/resolver/index.ts` | `src/resolver/envvars.ts` | `buildEnvVars(config.values)` | WIRED | Re-export at line 12: `export { buildEnvVars, redactSecrets } from './envvars.js'` |
| `src/resolver/index.ts` | `src/types.ts` | returns `ExecutionPlan`, consumes `CommandMap` + `ResolvedConfig` | WIRED | Import type at line 8; `ExecutionPlan` returned by `resolveAlias`; `CommandMap` and `ResolvedConfig` used as parameters |

### Data-Flow Trace (Level 4)

Phase 3 does not render dynamic data in a UI sense; all artifacts are pure functions or loaders. The critical data flow is: YAML file → CommandMap → ExecutionPlan.

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `src/commands/index.ts` | `CommandMap` | `readFileSync(commands.yml)` → `yaml.parse` → `normalizeCommands` → `validateGraph` | Yes — reads actual .loci/commands.yml file, not hardcoded data | FLOWING |
| `src/resolver/index.ts` | `ExecutionPlan` | `CommandMap.get(aliasName)` → `selectPlatformCmd` → `interpolateArgv` | Yes — processes real CommandDef from the Map with real config values | FLOWING |
| `src/resolver/envvars.ts` | env vars map | `config.values` (from Phase 2 configLoader) via `buildEnvVars` | Yes — transforms actual config values; no hardcoded static returns | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| tokenize tests (9 tests) | `npx vitest run src/commands/__tests__/tokenize.test.ts` | 9 passed (5ms) | PASS |
| commands loader integration tests (33 tests) | `npx vitest run src/commands/__tests__/commands.test.ts` | 33 passed (50ms) | PASS |
| resolver tests (38 tests) | `npx vitest run src/resolver/__tests__/resolver.test.ts` | 38 passed (9ms) | PASS |
| Total test suite (80 Phase 3 tests) | `npx vitest run src/commands/__tests__/ src/resolver/__tests__/` | 80 passed | PASS |
| Build succeeds | `npx tsup` | dist/cli.mjs 126.41 KB — build success | PASS |
| Biome lint | `npx biome check src/commands/ src/resolver/` | exit 0 (13 info-level warnings — all intentional `noTemplateCurlyInString` in test fixtures) | PASS |
| TypeScript strict typecheck | `npm run typecheck` | exit 2 — 4 TypeScript errors | FAIL |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CMD-01 | 03-01 | `.loci/commands.yml` defines alias → command mapping | SATISFIED | `readCommandsYaml` reads `.loci/commands.yml`; ENOENT → empty Map; integration tests confirm |
| CMD-02 | 03-01 | Single command as string or argv array | SATISFIED | `normalizeAlias` handles string (tokenize) and array (validateStringArray) forms; tests pass |
| CMD-03 | 03-01 | Sequential steps (ordered, fail-fast) | SATISFIED | `steps:` key → `{ kind: 'sequential', steps }` CommandDef; resolver expands each step; tests pass |
| CMD-04 | 03-01 | Parallel group (concurrent) | SATISFIED | `parallel:` key → `{ kind: 'parallel', group }` CommandDef; resolver produces `{ kind: 'parallel', group: [{alias, argv}] }`; tests pass |
| CMD-05 | 03-01 | Alias composition (alias refs in steps/group) | SATISFIED | D-09 lookup-based detection; `commands.has(step)` check in resolver; nested sequential flatten inline; tests pass |
| CMD-06 | 03-01 | Cycle detection at load time with full chain | SATISFIED | DFS three-color marking; `CircularAliasError(cyclePath)` with full path; 3 cycle tests pass including self-reference |
| CMD-07 | 03-02 | Platform overrides `linux:`/`windows:`/`macos:` | SATISFIED | `normalizePlatformBlock` + `PlatformOverrides`; `selectPlatformCmd` with `currentOsKey()`; platform tests pass |
| CMD-08 | 03-01 | Optional `description:` field | SATISFIED | `description` preserved on all CommandDef kinds; tests confirm description on single/sequential/parallel |
| CMD-09 | 03-01 | Error on unknown alias reference | SATISFIED (per D-09) | Per user decision D-09: only CommandMap keys are alias refs; non-matching entries are inline commands. No `UnknownAliasError` at load time for inline-command entries. This is the documented behavior accepted by the user (CONTEXT.md §D-09). |
| INT-01 | 03-02 | `${VAR}` placeholder resolution before spawn | SATISFIED | `interpolateArgv` expands all placeholders before `ExecutionPlan` is returned; never deferred to spawn time |
| INT-02 | 03-02 | Error on undefined placeholder (no run) | SATISFIED | `UndefinedPlaceholderError(key, aliasName)` thrown; resolver aborts before returning ExecutionPlan; test passes |
| INT-03 | 03-02 | Interpolated values as separate argv tokens (no re-split) | SATISFIED | `interpolateToken` expands within a token using `string.replace`, never re-tokenizes; multi-placeholder test `${a}${b}` → `xy` (single token) confirms |
| INT-04 | 03-02 | All config keys injected as env vars | SATISFIED | `buildEnvVars(config.values)` exports all keys as UPPER_UNDERSCORE; re-exported from `src/resolver/index.ts` for Phase 4; 4 tests pass |
| INT-05 | 03-02 | Secrets redacted to `***` in display output | SATISFIED | `redactSecrets(envVars, secretKeys)` replaces secret env values with `'***'`; note: function available for Phase 4 to call — Phase 3 itself emits no output |

All 15 Phase 3 requirements are satisfied at the functional level. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/commands/normalize.ts` | 81 | `return { kind: 'sequential', steps, description }` — `description: string \| undefined` violates `exactOptionalPropertyTypes:true` | BLOCKER | `npm run typecheck` (tsc --noEmit) exits 2; CI typecheck step fails; tsup build passes only because esbuild skips type checking |
| `src/commands/normalize.ts` | 88 | Same `exactOptionalPropertyTypes` violation for parallel | BLOCKER | Same as above |
| `src/commands/normalize.ts` | 127 | Same `exactOptionalPropertyTypes` violation for single (description + platforms) | BLOCKER | Same as above |
| `src/resolver/index.ts` | 50 | `chain[0]` — `string \| undefined` under `noUncheckedIndexedAccess` passed to `CommandSchemaError(aliasName: string, ...)` | BLOCKER | Same TypeScript typecheck failure |
| `src/commands/index.ts` | 74 | `async load()` wraps synchronous `readFileSync` (WR-01 from code review) | Warning | Misleading async signature; no event loop impact for CLI use; noted in 03-REVIEW.md |
| `src/resolver/envvars.ts` | 13-17 | Silent key collision possible when `deploy.host` and `deploy_host` both exist (WR-02 from code review) | Warning | Edge case; no practical impact until user creates colliding keys |

### Human Verification Required

#### 1. Observe CI run passing on all 6 matrix jobs after TypeScript fixes

**Test:** After fixing the 4 TypeScript errors (see Gaps Summary), push the Phase 3 commits and observe the GitHub Actions CI run.
**Expected:** All 6 matrix jobs (ubuntu-latest × [20,22], windows-latest × [20,22], macos-latest × [20,22]) complete the `npm run typecheck` step with exit 0 (in addition to lint, build, and test steps passing as they do locally).
**Why human:** The TypeScript errors identified make it certain CI would fail right now. This check is conditional on the fixes being applied. Once fixed, a human must observe 6 green jobs because CI has not been observed with Phase 3 changes.

### Gaps Summary

**1 blocking gap preventing complete phase goal achievement:**

**TypeScript typecheck fails — 4 errors across 2 files:**

Root cause: The plan specified using `description: undefined` in object literals, which is compatible with `description?: string` in JavaScript but violates TypeScript's `exactOptionalPropertyTypes: true` — a strict mode setting in this project's tsconfig. The `noUncheckedIndexedAccess` violation in `resolver/index.ts` is a similar strict-mode miss.

- `src/commands/normalize.ts` lines 81, 88, 127: Replace `description: string | undefined` assignment pattern with conditional spread: `...(description !== undefined ? { description } : {})` and similarly for `platforms`.
- `src/resolver/index.ts` line 50: Replace `chain[0]` with `chain[0] ?? aliasName` (safe fallback since `aliasName` is the same value `chain[0]` would hold when depth > 10).

All 80 functional tests pass. The build (`tsup`) succeeds. Biome lint is clean. All 14 PLAN must-haves are substantively implemented. Only the TypeScript type-safety layer has the 4 violations — these do not affect runtime behavior but must be fixed to pass `npm run typecheck` and consequently CI.

---

_Verified: 2026-04-13T11:00:00Z_
_Verifier: Claude (gsd-verifier)_
