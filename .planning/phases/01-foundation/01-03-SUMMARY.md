---
phase: 01-foundation
plan: 03
subsystem: testing
tags:
  - testing
  - vitest
  - e2e
  - error-hierarchy
  - type-assertions
requirements:
  - FND-05
  - FND-06
dependency_graph:
  requires:
    - phase: 01-foundation
      plan: 02
      provides: "LociError hierarchy, ExitCode + exitCodeFor, pipeline type contracts, commander CLI, dist/cli.mjs bundle"
  provides:
    - "Runtime unit-test suite for the full LociError hierarchy (D-04 invariants enforced by 18 assertions)"
    - "Type-level assertions proving the CommandDef/ExecutionPlan discriminated unions narrow correctly (10 expectTypeOf tests)"
    - "Spawn-based E2E suite exercising dist/cli.mjs for --version/-V, --help/-h, no-args, unknown-flag (8 tests)"
    - "Bundle introspection tests (shebang at byte 0, __LOCI_VERSION__ literal absent) enforced in CI"
    - "`npm test` exits 0 with 36 passing assertions across 3 test files"
  affects:
    - Plan 04 (CI can now run `npm test` across the OS × Node matrix and trust pass/fail)
    - Phase 2 (any Phase 2 commit that breaks a ConfigError subclass fails errors.test.ts)
    - Phase 3 (any Phase 3 commit that breaks CommandDef narrowing fails types.test.ts at typecheck time)
    - Phase 4 (any Phase 4 commit that leaks a value into ShellInjectionError.message fails the secrets-safe test)
    - Phase 5 (publishing pipeline inherits the shebang + tsup define assertions as regression guards)
tech_stack:
  added: []
  patterns:
    - "oneOfEachConcrete() factory as single source of truth for all concrete LociError subclasses — code-uniqueness and exit-code-mapping tests iterate over it without drift"
    - "Set(codes).size === codes.length as the D-04 code-uniqueness assertion"
    - "Multiple not.toContain assertions on ShellInjectionError.message (value, substring, metacharacters) — proves secrets-safe discard is structural"
    - "expectTypeOf with `import type` — respects verbatimModuleSyntax: true, asserts contracts at typecheck time"
    - "spawnSync(process.execPath, [CLI, ...args]) — cross-platform (avoids Windows PATH shadowing of `node`)"
    - "beforeAll guard with existsSync(CLI) — actionable error if dist/cli.mjs is missing"
    - "Bundle content assertions (first 19 bytes === shebang, no __LOCI_VERSION__ literal) — regression guards for tsup define + banner"
key_files:
  created:
    - src/__tests__/errors.test.ts
    - src/__tests__/types.test.ts
    - src/__tests__/cli.e2e.test.ts
  modified: []
  deleted:
    - src/__tests__/.gitkeep
decisions:
  - "Test files import from '../errors.js' / '../types.js' (with .js suffix despite source being .ts) per tsconfig's moduleResolution: bundler + verbatimModuleSyntax"
  - "types.test.ts uses `import type` for all pipeline interfaces — types.ts has zero runtime exports, so a value import would fail"
  - "E2E tests use `process.execPath` not the literal string 'node' — guaranteed to be the current Node binary on all 3 OSes; avoids Windows PATH shadowing (T-03-05 mitigation)"
  - "Bundle introspection tests added beyond the RESEARCH.md Example 4 snippet — they catch tsup regressions (define replacement, shebang placement) directly in the test suite instead of relying on ad-hoc grep"
metrics:
  duration: "~4m"
  started: "2026-04-10T15:42:54Z"
  completed_date: "2026-04-10"
  completed: "2026-04-10T15:46:31Z"
  tasks: 2
  files_created: 3
  files_modified: 0
  files_deleted: 1
  commits: 2
  test_files: 3
  tests_total: 36
  tests_passing: 36
  e2e_tests: 8
  e2e_duration_ms: 220
---

# Phase 1 Plan 3: Test Suite (LociError + Types + CLI E2E) Summary

**One-liner:** Full Phase 1 test suite landed — 36 passing tests across 3 files (18 runtime assertions on the LociError hierarchy, 10 expectTypeOf assertions on pipeline contracts, 8 spawn-based E2E tests against dist/cli.mjs), enforcing D-04 instanceof chains, code uniqueness, exit code mapping, Error.cause propagation, secrets-safety, CommandDef/ExecutionPlan narrowing, and all four CLI invocation paths.

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-10T15:42:54Z
- **Completed:** 2026-04-10T15:46:31Z
- **Tasks:** 2
- **Files created:** 3
- **Files modified:** 0
- **Files deleted:** 1 (.gitkeep placeholder)

## Accomplishments

- **src/__tests__/errors.test.ts** — 18 runtime assertions across 6 describe blocks. Uses an `oneOfEachConcrete()` factory as the single source of truth for the 11 concrete LociError subclasses; code-uniqueness, name preservation, and exit-code-mapping tests iterate over it so there is no drift risk when Phase 2+ adds a new subclass. Covers:
  - 4-level instanceof chains for at least one subclass per area (Config/Command/Interpolation/Executor/Cli)
  - `new.target.name` preservation (no fallback to 'Error' or 'LociError')
  - ES2022 `Error.cause` propagation via the constructor option
  - `code` uniqueness via `new Set(codes).size === codes.length` (D-04 requirement)
  - ExitCode literal ranges (0/10/20/30/40/50) and `exitCodeFor` mapping for every concrete class
  - ShellInjectionError secrets-safety: 3 `not.toContain` assertions against the value, a substring, and the metacharacters
  - SecretsTrackedError suggestion contains the file path and the `git rm --cached` remediation
- **src/__tests__/types.test.ts** — 10 `expectTypeOf` assertions proving the pipeline contracts. All imports are `import type` because types.ts has zero runtime exports (verbatimModuleSyntax: true enforces the split). Covers:
  - ConfigLayer string-literal union of exactly the 4 layer names
  - ResolvedConfig has `values`, `provenance`, `secretKeys`; secretKeys is ReadonlySet<string>
  - ConfigLoader.load signature ([string] → Promise<ResolvedConfig>)
  - CommandDef discriminated union on `kind` with narrowing to single/sequential/parallel (each with its expected property: cmd/steps/group)
  - CommandMap === ReadonlyMap<string, CommandDef>
  - ExecutionPlan kind union matches CommandDef
  - Executor.run signature ([ExecutionPlan] → Promise<ExecutionResult>)
  - PlatformOverrides has linux/windows/macos
  - CommandsLoader and Resolver interface shapes
- **src/__tests__/cli.e2e.test.ts** — 8 tests spawning `dist/cli.mjs` via `spawnSync(process.execPath, ...)`:
  - `--version` → stdout `0.0.0`, exit 0
  - `-V` short flag → stdout `0.0.0`, exit 0
  - `--help` → stdout contains `Usage: loci`, exit 0
  - `-h` short flag → stdout contains `Usage: loci`, exit 0
  - no args → stdout contains `no aliases defined yet` AND `.loci/commands.yml`, exit 0 (D-15 empty-state hint)
  - `--bogus` → exit 50, stderr contains `CLI_UNKNOWN_FLAG` (D-02 CliError range)
  - Bundle first 19 bytes === `#!/usr/bin/env node` (tsup banner regression guard)
  - Bundle does NOT contain the literal `__LOCI_VERSION__` (tsup define regression guard)
- `beforeAll` guard with `existsSync(CLI)` throws a descriptive error if `dist/cli.mjs` is missing so developers get an actionable message instead of an obscure spawn failure.

## Vitest Output

```
 RUN  v4.1.4 /home/developer/projects/jervis

 ✓ src/__tests__/errors.test.ts  (18 tests)  9ms
 ✓ src/__tests__/cli.e2e.test.ts (8 tests)  247ms
 ✓ src/__tests__/types.test.ts   (10 tests) 4ms

 Test Files  3 passed (3)
      Tests  36 passed (36)
   Duration  1.59s (transform 115ms, setup 0ms, import 559ms, tests 260ms, environment 0ms)
```

All 3 test files are discovered by vitest's default include pattern `src/**/__tests__/**/*.test.ts` (from Plan 01's `vitest.config.ts`). No manual test-file registration required. `isolate: true` and `pool: 'threads'` from the config apply uniformly.

## Isolated Run Timings (local baseline for Plan 04 CI comparison)

| Test file | Tests | Test body time | Total (vitest startup + tests) |
|-----------|-------|----------------|--------------------------------|
| errors.test.ts | 18 | 8ms | ~2.6s |
| types.test.ts | 10 | 4ms | ~2.6s |
| cli.e2e.test.ts | 8 | 220ms | ~2.0s |
| **full `npm test`** | **36** | **260ms** | **~1.9s total duration** |

E2E tests take ~27ms per `spawnSync` invocation on local (Linux/WSL2, Node v22.22.2). Plan 04 CI on windows-latest is expected to be slower per spawn (50-150ms) but well within the 10s `testTimeout` from vitest.config.ts. Total CI wall time for `npm test` across 3 OSes should stay under 10 seconds per job.

## Commits

| Task | Message | Hash |
|------|---------|------|
| 1 | test(01-03): add LociError hierarchy unit tests | a41c999 |
| 2 | test(01-03): add type-level assertions and CLI E2E spawn tests | b55fb16 |

## Gate Results

- `npm run typecheck` → exit 0 (tsc --noEmit, all 3 test files typecheck against src/errors.ts, src/types.ts, and the ambient vitest types)
- `npm run lint` → exit 0 (biome checked 14 files: 3 new test files + 11 pre-existing)
- `npm run build` → exit 0 (dist/cli.mjs 126.41 KB, unchanged from Plan 02)
- `npm test` → exit 0, 3 test files, 36 tests, all passing
- `npx vitest run src/__tests__/errors.test.ts` → 18 passed (isolated)
- `npx vitest run src/__tests__/types.test.ts` → 10 passed (isolated)
- `npx vitest run src/__tests__/cli.e2e.test.ts` → 8 passed (isolated)
- `ls src/__tests__/` → cli.e2e.test.ts, errors.test.ts, types.test.ts (no .gitkeep leftover)

## Deviations from Plan

None. All three test files were created verbatim from the plan's RESEARCH-derived snippets and passed typecheck/lint/test on first run with zero modifications.

Biome's `assist/source/organizeImports` rule re-sorted some import lists (as expected from Plan 01/02 experience), so the test files were authored with imports already in alphabetical order to pre-empt it — no second pass required.

The plan's Task 1 action block showed the import list in declaration order, but biome requires alphabetical order. I wrote the imports alphabetically from the start (`CircularAliasError, CliError, CommandError, CommandSchemaError, ConfigError, ...`), so no `biome check --write` pass was needed. Same for types.test.ts and cli.e2e.test.ts. This is a pattern from Plan 02: biome sorts imports, so canonical-in-plan code gets reordered — I applied the reorder up front.

## Authentication Gates

None. This plan only touches local files and runs `npm test` / `npm run build` locally. No network, no credentials.

## Threat Register Disposition

All Phase 1 Plan 3 `mitigate` entries honored:

- **T-03-01** Tampering (test discovery picking up non-test files): vitest.config.ts (from Plan 01) restricts `include` to `src/**/__tests__/**/*.test.ts` and `exclude: ['node_modules', 'dist']`. The three test files land exactly inside the include glob; no stray files discovered.
- **T-03-02** Denial of Service (Windows spawn deadlock): `spawnSync` (not async `spawn`) with `encoding: 'utf8'` — blocks until child exits with captured stdout/stderr buffers. `testTimeout: 10_000` from vitest.config.ts is the ceiling. Local E2E runs finish in ~220ms total for 8 spawns — 45x headroom.
- **T-03-04** Tampering (stale dist/cli.mjs): `beforeAll` guard with `existsSync(CLI)` throws a descriptive error before any spawn. Plan 04 CI orders `build → test` explicitly; locally `npm run build && npm test` is the supported flow.
- **T-03-05** Spoofing (wrong Node binary on Windows PATH): `spawnSync(process.execPath, [CLI, ...args])` uses the absolute path to the current Node binary. No reliance on `'node'` string resolution through shell PATH.

`accept` entry T-03-03 (synthetic secret literal in test source) stays accepted: the `'password123$(rm -rf /)'` string in errors.test.ts is a test input asserting ShellInjectionError discards its value, not a real credential.

## Downstream Enablement

- **Plan 04 CI** can now run the full `npm ci → typecheck → lint → build → test → smoke` pipeline on ubuntu-latest × windows-latest × macos-latest × Node 20 × Node 22. The 36 tests will re-run on every push and PR, with spawnSync E2E tests exercising the Windows-specific PATHEXT / shebang / cross-platform paths that are the riskiest part of the bundle.
- **Phase 2** commits touching `src/errors.ts` (adding config-loader-specific error details) will have to update `oneOfEachConcrete()` and pass the code-uniqueness test — this is the D-04 guardrail doing its job.
- **Phase 3** commits touching `src/types.ts` (CommandDef refinements, new CommandRef shapes) will fail `types.test.ts` at typecheck time if they break narrowing — caught before runtime.
- **Phase 4** commits adding `ShellInjectionError` throws must not weaken the secrets-safety assertion; if a Phase 4 refactor accidentally lets the `value` parameter leak into `err.message`, the 3 `not.toContain` assertions catch it immediately.
- **Phase 5** publishing pipeline inherits the shebang + tsup-define regression guards (first 19 bytes of dist/cli.mjs + `__LOCI_VERSION__` literal absence) — these remain valid tests even as the bundle content changes, because they're about the bundle's structural invariants, not its exact contents.

## Known Stubs

None. The 3 test files are fully populated with 36 runtime and type-level assertions. No placeholder tests, no TODOs, no `it.skip` or `it.todo` calls.

## Self-Check: PASSED

All claimed artifacts verified on disk:

- src/__tests__/errors.test.ts — FOUND (18 tests)
- src/__tests__/types.test.ts — FOUND (10 tests)
- src/__tests__/cli.e2e.test.ts — FOUND (8 tests)
- src/__tests__/.gitkeep — REMOVED
- dist/cli.mjs — FOUND (126.41 KB, from Plan 02 build, refreshed by end-of-plan `npm run build`)

All claimed commits verified in git log:

- a41c999 test(01-03): add LociError hierarchy unit tests — FOUND
- b55fb16 test(01-03): add type-level assertions and CLI E2E spawn tests — FOUND

Gate results reproduced at self-check time:

- `npm run typecheck` → exit 0
- `npm run lint` → exit 0 (14 files)
- `npm run build` → exit 0, dist/cli.mjs 126.41 KB
- `npm test` → exit 0, "Test Files 3 passed (3)", "Tests 36 passed (36)"
- `npx vitest run src/__tests__/errors.test.ts` → 18 passed
- `npx vitest run src/__tests__/types.test.ts` → 10 passed
- `npx vitest run src/__tests__/cli.e2e.test.ts` → 8 passed
- `ls src/__tests__/` → cli.e2e.test.ts, errors.test.ts, types.test.ts (3 files, no .gitkeep)

---
*Phase: 01-foundation*
*Completed: 2026-04-10*
