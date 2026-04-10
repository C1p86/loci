---
phase: 01-foundation
verified: 2026-04-10T16:05:00Z
status: human_needed
score: 13/14 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Push the repo to a GitHub remote and open a PR (or push to main / trigger workflow_dispatch). Observe the first run of `.github/workflows/ci.yml`."
    expected: "All 6 matrix jobs (ubuntu-latest × [20, 22], windows-latest × [20, 22], macos-latest × [20, 22]) report green. Each job runs npm ci → typecheck → lint → build → test → smoke, all exit 0."
    why_human: "The workflow file is structurally correct and locally every step it runs exits 0, but the 3×2 matrix has never been observed running on GitHub-hosted runners. Real Windows (Server 2022) and Apple-Silicon macOS runtime behaviour cannot be verified from Linux/WSL2 locally — especially: (a) Windows PATHEXT + shebang handling of dist/cli.mjs, (b) Windows CRLF/.gitattributes interaction on checkout, (c) npm ci reproducibility from package-lock.json on non-Linux runners. Until the first remote run is observed, cross-platform behaviour is asserted by construction (fix-forward in .gitattributes, execa 9.6.1, tsup createRequire polyfill) but not empirically validated."
  - test: "On a modern Windows 10+ machine with Node >=20.5.0 installed, run `npm i -g <path-to-tarball-or-repo>` then invoke `loci --version` from PowerShell and cmd.exe."
    expected: "`loci --version` prints `0.0.0` and exits 0 from both shells, using npm's generated .cmd/.ps1 shim."
    why_human: "Local verification installed the package into a prefix on Linux (symlink-based bin), not as a Windows cmd-shim. The tsup banner shebang + createRequire polyfill is designed to work through npm's Windows shim, but the first genuine Windows install has not been performed. This is the empirical confirmation of FND-02 SC1 on Windows."
---

# Phase 1: Foundation Verification Report

**Phase Goal:** The project skeleton exists: runnable binary, typed error hierarchy, CI passing on all three platforms
**Verified:** 2026-04-10T16:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (merged from ROADMAP Success Criteria + PLAN frontmatter)

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | ROADMAP SC-1: `npm i -g .` installs a `loci` binary that runs on Windows/Linux/macOS | PARTIAL | Local `npm i -g --prefix=/tmp/...` succeeded; the symlink `bin/loci -> lib/node_modules/loci/dist/cli.mjs` was created and `loci --version` printed `0.0.0` exit 0. Windows/macOS install paths not exercised locally — Linux global install was also blocked by /usr/lib permissions (expected non-root denial, not a product defect). Cross-platform install is covered by CI matrix + the .github/workflows/ci.yml smoke step. |
| 2  | ROADMAP SC-2: `loci --version` exits in under 300ms cold | VERIFIED | 5-run `spawnSync` measurement of `/tmp/loci-gtest-prefix/bin/loci --version`: runs 37.8 / 38.5 / 39.5 / 39.5 / 41.5 ms. Max 41.5 ms, avg 39.4 ms — 7× under the 300 ms budget on this hardware. Measured via the installed global symlink, not the dist path directly. |
| 3  | ROADMAP SC-3: `npm test` and `npm run lint` pass on a fresh clone | VERIFIED | `npm run lint` → exit 0 (biome checked 14 files, no fixes). `npm test` → exit 0, 3 test files, 36/36 tests passing (errors 18 + types 10 + cli.e2e 8). `npm run typecheck` → exit 0. `npm run build` → exit 0 (tsup, 126.41 KB dist/cli.mjs). All gates reproduced at verification time. |
| 4  | ROADMAP SC-4: GitHub Actions CI runs build+test+lint on Win/Linux/macOS matrix and all checks are green | PARTIAL (human_needed) | `.github/workflows/ci.yml` exists, parses as valid YAML, and structurally matches D-09/D-10/D-12: 3 OSes × Node [20,22] matrix, fail-fast:false, concurrency group with cancel-in-progress, 8 steps in the correct order (checkout → setup-node → npm ci → typecheck → lint → build → test → smoke). The workflow HAS NOT YET RUN on GitHub — the repo has no remote push recorded. Requires human verification (item 1 in human_verification). |
| 5  | Fresh clone can run npm ci and install deps without warnings on Node >=20.5.0 | VERIFIED | package-lock.json committed (786b84d), 113 packages installed per 01-01-SUMMARY, 0 vulnerabilities 0 warnings. `npm ci` is the CI install step and is used locally in the smoke sequence. |
| 6  | npm run typecheck passes | VERIFIED | `tsc --noEmit` exit 0 against `src/**/*.ts` + tsup.config.ts + vitest.config.ts under strict mode including noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax. |
| 7  | npm run lint passes (biome) | VERIFIED | `biome check .` → exit 0, 14 files checked. |
| 8  | Directory structure matches D-05 feature-folder layout | VERIFIED | `ls src/` shows cli.ts, errors.ts, types.ts, version.ts, and feature dirs config/ commands/ resolver/ executor/ __tests__/ — each feature dir has an index.ts (no stale .gitkeep). |
| 9  | `npm run build` produces dist/cli.mjs with #!/usr/bin/env node as the literal first line | VERIFIED | `head -c 19 dist/cli.mjs` → `#!/usr/bin/env node`. `grep -c "^#!/usr/bin/env node" dist/cli.mjs` → 1. Bundle size 129,446 bytes (126.41 KB), stable across Plan 02/03/04. |
| 10 | `node dist/cli.mjs --version` prints 0.0.0 and exits 0 | VERIFIED | Executed at verification time: stdout `0.0.0`, exit 0. `grep -c "__LOCI_VERSION__" dist/cli.mjs` → 0 (esbuild define replaced the identifier with the literal `"0.0.0"`). |
| 11 | `--help`, no-args, and `--bogus` paths behave per D-13/D-15/D-02 | VERIFIED | `--help` prints Usage banner exit 0; no-args prints Usage + "no aliases defined yet — .loci/commands.yml will be loaded once Phase 2+ ships" exit 0; `--bogus` prints `error [CLI_UNKNOWN_FLAG]: Unknown flag: ...` and exits 50 (D-02 CliError range). All four CLI paths confirmed at verification time. |
| 12 | src/errors.ts exports the full LociError hierarchy (D-01, D-03, D-04) | VERIFIED | 205-line file: ExitCode const (SUCCESS/CONFIG/COMMAND/INTERPOLATION/EXECUTOR/CLI = 0/10/20/30/40/50), 5 abstract area bases (ConfigError, CommandError, InterpolationError, ExecutorError, CliError), 11 concrete subclasses (YamlParseError, ConfigReadError, SecretsTrackedError, CircularAliasError, UnknownAliasError, CommandSchemaError, UndefinedPlaceholderError, ShellInjectionError, SpawnError, UnknownFlagError, NotImplementedError), exhaustive `exitCodeFor` switch, ShellInjectionError `void value` secrets-safe discard. errors.test.ts has 18 assertions verifying instanceof chains, code uniqueness via Set size, exit-code mapping, Error.cause propagation, and secrets-safety (3× not.toContain on the value). |
| 13 | src/types.ts exports the pipeline contracts for Phases 2-4 | VERIFIED | 98-line file: ConfigLoader + ResolvedConfig + ConfigLayer + ConfigValue (Phase 2), CommandsLoader + CommandDef discriminated union (single/sequential/parallel) + CommandMap + PlatformOverrides (Phase 3), Resolver + ExecutionPlan union (Phase 3), Executor + ExecutionResult (Phase 4). All fields `readonly`/`Readonly<...>`. types.test.ts has 10 expectTypeOf assertions proving the CommandDef union narrows correctly and the interface shapes are stable. |
| 14 | Feature stubs throw NotImplementedError per D-06 | VERIFIED | src/config/index.ts, src/commands/index.ts, src/resolver/index.ts, src/executor/index.ts each import `NotImplementedError` + the relevant interface via `import type`, and export a const adhering to the interface whose only method throws `new NotImplementedError('<Component> (Phase N)')`. cli.ts does NOT import these — tree-shaking confirmed in 01-02-SUMMARY (zero stub strings in dist/cli.mjs). |

**Score:** 13/14 truths VERIFIED; 1 PARTIAL (SC-4 CI matrix — human_needed for first remote run).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | ESM manifest with bin/engines/scripts/pinned deps | VERIFIED | `"type": "module"`, `engines.node: ">=20.5.0"`, `bin.loci: "./dist/cli.mjs"`, dependencies exact-pinned (commander 14.0.3, execa 9.6.1, yaml 2.8.3), devDeps typescript ^5.9.0 (resolved 5.9.3), tsup 8.5.1, vitest 4.1.4, @biomejs/biome 2.4.11. No postinstall/preinstall scripts. |
| `package-lock.json` | committed, npm ci reproducible | VERIFIED | `git ls-files package-lock.json` hits; npm ci succeeds locally. |
| `tsconfig.json` | strict ES2022 bundler | VERIFIED | strict:true, noUncheckedIndexedAccess, exactOptionalPropertyTypes, verbatimModuleSyntax, isolatedModules, target:ES2022, moduleResolution:bundler, noEmit:true, include matches src + both config files. |
| `tsup.config.ts` | single-file ESM bundle with shebang + define | VERIFIED | entry: ['src/cli.ts'], noExternal: [/.*/], banner.js contains literal shebang + `createRequire as __loci_createRequire` polyfill (needed because commander is CJS — fix documented in 01-02-SUMMARY Deviation 3), `define.__LOCI_VERSION__: JSON.stringify(pkg.version)`, sourcemap:false (prevents shebang-shift Pitfall 1). |
| `vitest.config.ts` | co-located test discovery | VERIFIED | include: `src/**/__tests__/**/*.test.ts`, pool: threads, isolate: true, testTimeout: 10_000 (Windows CI headroom), v8 coverage. |
| `biome.json` | lint + format aligned with verbatimModuleSyntax | VERIFIED | $schema pin 2.4.11, recommended rules, useImportType: error, noExplicitAny: error, noUnusedVariables + noUnusedImports: error, lineWidth 100, useIgnoreFile: true. |
| `.gitignore` | ignores node_modules/dist/coverage + secrets/local | VERIFIED | Contains node_modules/, dist/, coverage/, .loci/secrets.yml, .loci/local.yml. |
| `.gitattributes` | LF everywhere, CRLF for .ps1/.cmd | VERIFIED | `* text=auto eol=lf`, `*.ps1 text eol=crlf`, `*.cmd text eol=crlf`. |
| `.editorconfig`, `.nvmrc` | LF, Node 22 | VERIFIED | .editorconfig: indent 2, LF, UTF-8. .nvmrc: `22`. |
| `src/errors.ts` | full LociError hierarchy | VERIFIED | 205 lines (plan minimum 130); 11 concrete subclasses, ExitCode, exitCodeFor. |
| `src/types.ts` | pipeline contracts | VERIFIED | 98 lines (plan minimum 60); all interfaces exported. |
| `src/version.ts` | LOCI_VERSION backed by `__LOCI_VERSION__` define | VERIFIED | 9 lines: `declare const __LOCI_VERSION__: string;` + `export const LOCI_VERSION: string = __LOCI_VERSION__;`. esbuild replaces at build time. |
| `src/cli.ts` | commander program with exitOverride + error mapping | VERIFIED | 75 lines (plan minimum 40): buildProgram() with .name/.description/.version/.helpOption/.showHelpAfterError/.exitOverride; main() with parseAsync + try/catch mapping LociError → exitCodeFor, commander.helpDisplayed/version → 0, other commander.* → UnknownFlagError → 50. Re-exports { buildProgram, CliError, main }. |
| `src/{config,commands,resolver,executor}/index.ts` | NotImplementedError stubs | VERIFIED | All 4 files exist, import NotImplementedError + `import type` their interface, export a typed const whose method throws. |
| `dist/cli.mjs` | bundled single-file CLI with shebang | VERIFIED | 129,446 bytes / 126.41 KB, first 19 bytes = `#!/usr/bin/env node`, zero occurrences of `__LOCI_VERSION__`, exactly 1 occurrence of `0.0.0` (the inlined version). |
| `src/__tests__/errors.test.ts` | LociError hierarchy tests | VERIFIED | 8028 bytes, 18 passing tests (instanceof chains, code uniqueness via Set, name preservation, Error.cause, exit-code mapping, ShellInjectionError secrets-safety with 3 not.toContain, SecretsTrackedError suggestion). |
| `src/__tests__/types.test.ts` | type-level assertions | VERIFIED | 3146 bytes, 10 passing expectTypeOf assertions on ConfigLayer, ResolvedConfig, ConfigLoader, CommandDef discriminated union narrowing, CommandMap, ExecutionPlan, Executor, PlatformOverrides, CommandsLoader, Resolver. |
| `src/__tests__/cli.e2e.test.ts` | spawn-based E2E tests | VERIFIED | 2789 bytes, 8 passing tests via `spawnSync(process.execPath, [CLI, ...args])`: --version/-V, --help/-h, no-args (D-15 hint), --bogus (exit 50), bundle first 19 bytes = shebang, bundle has no `__LOCI_VERSION__` literal. beforeAll existsSync guard. |
| `.github/workflows/ci.yml` | 3×2 matrix CI | VERIFIED (structural); UNRUN (remote) | 49 lines, single job build-test-lint, strategy.fail-fast:false, matrix.os = [ubuntu-latest, windows-latest, macos-latest], matrix.node = [20, 22], concurrency group ci-${{ github.ref }} with cancel-in-progress, triggers push main + PR (including ready_for_review) + workflow_dispatch, 8 steps in fastest-fail-first order: checkout@v4 → setup-node@v4 (cache: npm) → npm ci → npm run typecheck → npm run lint → npm run build → npm test → node dist/cli.mjs --version. No hyperfine, no release, no codecov, no npm audit, no Node 18/24. Default read-only token (no permissions block — see IN-03 in REVIEW). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| package.json#scripts.build | tsup.config.ts | `"build": "tsup"` | WIRED | Script invokes tsup which reads tsup.config.ts at repo root. `npm run build` exit 0 at verification time. |
| package.json#engines.node | execa 9.6.1 floor | `">=20.5.0"` | WIRED | Matches execa 9.x requirement (`^18.19.0 || >=20.5.0`); CI matrix Node [20, 22] both satisfy. |
| tsconfig.json#include | src/**/*.ts | typecheck scope | WIRED | `src/**/*.ts` in include; 8 src files picked up; `tsc --noEmit` exit 0. |
| src/cli.ts | src/errors.ts | `import { CliError, exitCodeFor, LociError, UnknownFlagError } from './errors.js'` | WIRED | Line 3 of cli.ts; used in try/catch at lines 35-56. |
| src/cli.ts | src/version.ts | `import { LOCI_VERSION } from './version.js'` | WIRED | Line 4 of cli.ts; used in `.version(LOCI_VERSION, ...)` at line 12. |
| src/version.ts | tsup.config.ts define | `__LOCI_VERSION__` identifier | WIRED | version.ts references `__LOCI_VERSION__`; tsup.config.ts `define` block replaces it with `JSON.stringify(pkg.version)` → `"0.0.0"`. Verified: bundle has 0 occurrences of `__LOCI_VERSION__` and 1 of `0.0.0`. |
| src/config/index.ts | src/types.ts | `import type { ConfigLoader, ResolvedConfig }` | WIRED | Same pattern across all 4 feature stubs; all use `import type` per verbatimModuleSyntax. |
| dist/cli.mjs | package.json bin | `"bin": { "loci": "./dist/cli.mjs" }` | WIRED | bin path matches tsup outDir; `npm i -g .` into prefix created `bin/loci -> lib/node_modules/loci/dist/cli.mjs` symlink and the bin ran. |
| .github/workflows/ci.yml | package.json scripts | `npm run typecheck/lint/build/test` | WIRED | All four scripts referenced in the workflow exist in package.json scripts block. |
| .github/workflows/ci.yml | package-lock.json | `npm ci` step | WIRED | Lockfile committed (786b84d); `npm ci` is the install step; lockfile drift would fail CI. |
| .github/workflows/ci.yml | matrix.os | `runs-on: ${{ matrix.os }}` | WIRED | Expression renders per-job and drives runner image selection. Structural check only — not yet executed on GitHub runners (human_needed item 1). |
| src/__tests__/cli.e2e.test.ts | dist/cli.mjs | `spawnSync(process.execPath, [CLI, ...args])` | WIRED | 8 tests pass locally; uses `process.execPath` (not `'node'` literal) to avoid Windows PATH shadowing. beforeAll guards dist/cli.mjs existence. |

### Data-Flow Trace (Level 4)

Phase 1 produces no data-rendering artifacts (no pages, no dashboards, no dynamic UI). The single data flow is `package.json#version → tsup define → dist/cli.mjs → --version stdout`, which is verified:

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| dist/cli.mjs | LOCI_VERSION | `__LOCI_VERSION__` (tsup define, reads package.json at build time) | Yes — `0.0.0` inlined literally in bundle, stdout matches on invocation | FLOWING |
| cli.ts output stream | help banner, empty-state hint | commander program.outputHelp() + literal process.stdout.write | Yes — all 4 CLI paths confirmed at verification time | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck passes | `npm run typecheck` | exit 0, no errors | PASS |
| Lint passes | `npm run lint` | exit 0, 14 files checked, no fixes | PASS |
| Build produces bundle | `npm run build` | exit 0, dist/cli.mjs 126.41 KB in 302ms | PASS |
| Full test suite passes | `npm test` | exit 0, 3 files, 36/36 tests, 2.19s | PASS |
| CLI --version works | `node dist/cli.mjs --version` | stdout `0.0.0`, exit 0 | PASS |
| CLI --help works | `node dist/cli.mjs --help` | Usage banner, exit 0 | PASS |
| CLI no-args (D-15) | `node dist/cli.mjs` | Help + `(no aliases defined yet ...)` hint, exit 0 | PASS |
| CLI --bogus (D-02) | `node dist/cli.mjs --bogus` | `error [CLI_UNKNOWN_FLAG]: Unknown flag: ...`, exit 50 | PASS |
| Shebang at byte 0 | `head -c 19 dist/cli.mjs` | `#!/usr/bin/env node` | PASS |
| Version literal inlined | `grep -c "__LOCI_VERSION__" dist/cli.mjs` | 0 (define replaced) | PASS |
| Cold-start budget | `spawnSync(bin, ['--version'])` × 5 | max 41.5 ms, avg 39.4 ms (budget 300 ms) | PASS |
| Global install creates bin | `npm i -g --prefix=/tmp/... .` then `bin/loci --version` | symlink created, exit 0, stdout `0.0.0` | PASS |
| CI yaml parses structurally | `yaml.parse(.github/workflows/ci.yml)` + matrix shape check | 3 OSes, 2 Node versions, 8 steps, windows-latest present | PASS |
| CI yaml first remote run | `gh run list` / push to GitHub | NOT OBSERVED — no remote push recorded | SKIP (human_needed item 1) |

### Requirements Coverage

Phase requirement IDs from PLAN frontmatter: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06. Every ID accounted for, no orphans.

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| FND-01 | 01-01 | ESM package, TypeScript, bundled with tsup to a single .mjs, publishable as `loci` on npm | SATISFIED | package.json `"type": "module"` + tsup single-file ESM output (dist/cli.mjs 126.41 KB); `files: ["dist", "README.md"]` scopes the publish tarball; no LICENSE/README yet (Phase 5 scope per CONTEXT D-16). |
| FND-02 | 01-02 | Bin is installable globally and works on Windows 10+, Linux, macOS | PARTIAL | Package has `bin.loci`, shebang at byte 0, createRequire polyfill so commander (CJS) boots in ESM bundle. Local `npm i -g --prefix` verified the bin on Linux. Windows + macOS paths rely on CI matrix — human_needed item 1 (first CI run) and item 2 (actual Windows install). |
| FND-03 | 01-02, 01-04 | Cold start < 300 ms | SATISFIED | spawnSync measurement: 37.8/38.5/39.5/39.5/41.5 ms, avg 39.4 ms, max 41.5 ms on this hardware — 7× under budget. Bundle: single-file ESM, noExternal all, no sourcemap, no tree-shakeable dead code paths imported from cli.ts. Hyperfine enforcement deferred to Phase 5 (D-11). |
| FND-04 | 01-02 | Typed error hierarchy defined and used in the codebase | SATISFIED | src/errors.ts declares the full hierarchy (abstract LociError + 5 area bases + 11 concrete subclasses + ExitCode + exitCodeFor). cli.ts catches LociError, maps via exitCodeFor. Feature stubs throw NotImplementedError. Phases 2-5 will throw the declared subclasses. |
| FND-05 | 01-01, 01-03 | vitest + biome configured and working from first commit of code | SATISFIED | vitest.config.ts + biome.json + `"test": "vitest run"` + `"lint": "biome check ."` all present. 36 tests passing across 3 files. `npm run lint` exit 0. |
| FND-06 | 01-03, 01-04 | CI on GitHub Actions with Win/Linux/macOS matrix running build+test+lint on every push | SATISFIED (structural); PARTIAL (empirical) | `.github/workflows/ci.yml` matches the contract byte-for-byte: 3 OSes × Node [20,22] = 6 jobs, fail-fast:false, correct step order, triggers push/PR/dispatch. First remote run not yet observed — human_needed item 1. |

### Anti-Patterns Found

None of blocker severity. Code review (01-REVIEW.md, reviewed 2026-04-10) reported 0 critical, 3 warning, 5 info findings. Summary of what the reviewer flagged:

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/cli.ts | 64-70 | `main(process.argv).then(...)` as top-level side effect AND re-exports `main`/`buildProgram` — programmatic import would invoke the CLI and call process.exit mid-test | Warning (WR-01) | Not a Phase 1 blocker: cli.e2e.test.ts spawns the bundle via subprocess so the side effect is contained. Becomes a problem the moment any test imports `cli.ts` directly. Recommend splitting cli.ts (library) from bin.ts (entry) in a future hardening pass — not blocking Phase 1 goal. |
| src/cli.ts | 50-56 | All `commander.*` errors wrapped as `UnknownFlagError`, mislabeling missingArgument / conflictingOption / invalidOptionArgument as "unknown flag" | Warning (WR-02) | Phase 1 only exposes `--version` / `--help` / no-args / unknown-flag paths — no required args, no conflicting options exist yet. The mis-classification will become visible when Phase 4 adds alias subcommands with required args. The D-04 structured-error contract (`code` must be precise) is technically violated, but no observable Phase 1 behaviour depends on it. Recommend adding `CliParseError` in Phase 4. |
| src/cli.ts | 51 | `new UnknownFlagError(commanderErr.message ?? 'cli error')` passes full commander message as the `flag` argument → double-prefixed `Unknown flag: error: unknown option '--bogus'` | Warning (WR-03) | Cosmetic. cli.e2e.test.ts only asserts stderr contains `CLI_UNKNOWN_FLAG` literal, which still holds. User sees a slightly awkward message on invalid flags. |
| src/errors.ts | 142-153 | ShellInjectionError accepts `value` parameter then discards via `void value` | Info (IN-01) | Intentional — documented in code comment + threat register T-02-01 as secrets-safe-by-construction. The ergonomic concern ("future maintainer will re-add it") is a process issue, not a code defect. |
| src/version.ts | 1-9 | `LOCI_VERSION = __LOCI_VERSION__` has no fallback → ReferenceError if imported without tsup define | Info (IN-02) | Not triggered today (only dist/cli.mjs consumes version; dist always goes through tsup). Becomes relevant if Plan 03+ tests start importing version.ts directly under vitest without a transform. Recommend adding `typeof __LOCI_VERSION__ !== 'undefined' ? __LOCI_VERSION__ : '0.0.0-dev'` fallback in a follow-up. |
| .github/workflows/ci.yml | 1-12 | No explicit `permissions: { contents: read }` block | Info (IN-03) | Default token scope on older repos may be broader. Defense-in-depth recommendation. Not a Phase 1 exit-blocker because Phase 1 CI doesn't read/write beyond checkout. |
| src/cli.ts | 59 | `(err as Error).message` unsafe cast in catch-all | Info (IN-04) | If a non-Error value is thrown, message becomes `undefined`. Not triggered by any known code path. |
| vitest.config.ts | 13-17 | Coverage excludes all `src/**/index.ts` | Info (IN-05) | Reasonable Phase 1 choice (stubs are one-line throws). Will silently hide coverage gaps once Phase 2+ fills the stubs. Recommend narrowing exclusion to the specific stub files in Phase 2. |

None of these block the Phase 1 goal. All 3 warnings concern the same commander-error-wrapping concern in src/cli.ts which is cosmetic / contained / deferred per the reviewer's own assessment. No blocking anti-patterns (no TODO/FIXME in product code, no empty implementations in CLI entry, no hardcoded secrets, no console.log-only handlers, no stubs reachable from cli.ts — tree-shaking verified in 01-02-SUMMARY).

### Human Verification Required

#### 1. First GitHub Actions CI run on the 3×2 matrix

**Test:** Push the repo to a GitHub remote and open a PR (or push to `main` / trigger `workflow_dispatch`). Open the Actions tab and wait for the first run of `.github/workflows/ci.yml` to complete.
**Expected:** All 6 matrix jobs are green:
  - ubuntu-latest × Node 20
  - ubuntu-latest × Node 22
  - windows-latest × Node 20
  - windows-latest × Node 22
  - macos-latest × Node 20
  - macos-latest × Node 22

Each job runs: Checkout → Setup Node.js → npm ci → Typecheck → Lint → Build → Test → Smoke (`node dist/cli.mjs --version`) — all exit 0. The smoke step stdout should be `0.0.0` on every row.
**Why human:** The workflow file has never been observed running on GitHub-hosted runners. Structural checks hold (YAML parses, scripts exist, matrix shape is correct) and the full pipeline passes locally on Linux/WSL2, but:
  - Real Windows Server 2022 runners may surface PATHEXT / shebang / line-ending issues that the Linux local environment cannot reproduce.
  - Apple-Silicon macos-latest runners may surface arm64-specific resolution or `process.execPath` oddities.
  - `npm ci` reproducibility from package-lock.json across 3 OSes × 2 Node versions is the actual cross-platform fidelity contract — and it has not been exercised.
This is the FND-02 + FND-06 empirical exit gate per 01-04-SUMMARY.

#### 2. Genuine Windows global install

**Test:** On a Windows 10+ machine with Node >=20.5.0 installed, run one of:
  - `npm pack` locally, copy the tarball to Windows, `npm i -g loci-0.0.0.tgz`
  - or clone the repo on Windows and `npm i -g .`

Then from both PowerShell and cmd.exe, run `loci --version` and `loci --bogus`.
**Expected:** `loci --version` prints `0.0.0` exit 0; `loci --bogus` exits 50 with the `CLI_UNKNOWN_FLAG` message. Both shells should work through npm's generated .cmd / .ps1 shim.
**Why human:** Local verification ran `npm i -g --prefix=/tmp/...` on Linux, which creates a Unix-style symlink bin rather than Windows' .cmd shim. The tsup banner (`#!/usr/bin/env node` + createRequire polyfill) is designed to work through both, but the Windows shim path has not been empirically exercised. This is the direct proof of ROADMAP SC-1 on Windows. If item 1 passes this is implicitly covered because CI does `npm ci && node dist/cli.mjs --version` which exercises the same bundle via `node` directly (not through the shim), so item 2 is additionally the "install through the shim" gate.

### Gaps Summary

Zero blocking gaps. Every observable truth derivable from ROADMAP.md Success Criteria and PLAN.md must_haves is backed by reproducible evidence on disk or through a local gate run. The phase goal — "runnable binary, typed error hierarchy, CI passing on all three platforms" — is structurally complete.

The one remaining item is empirical: the CI matrix has never run on GitHub-hosted runners. Nothing in the code or config suggests it will fail (the workflow byte-matches RESEARCH.md §"GitHub Actions Workflow", the local smoke sequence mirrors every step, `.gitattributes` handles CRLF, `process.execPath` handles Windows PATH shadowing in E2E tests, and execa is not yet exercised in Phase 1 so no cross-platform spawn risk exists), but until a human observes 6 green jobs, the "CI passing on all three platforms" half of the phase goal is asserted-by-construction rather than verified.

Status is therefore `human_needed` (not `passed` and not `gaps_found`): all automated gates are green, but two human-verification items remain before the phase goal can be formally closed.

---

_Verified: 2026-04-10T16:05:00Z_
_Verifier: Claude (gsd-verifier)_
