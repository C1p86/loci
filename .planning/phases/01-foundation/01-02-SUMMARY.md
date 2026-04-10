---
phase: 01-foundation
plan: 02
subsystem: cli
tags:
  - errors
  - types
  - commander
  - tsup-build
  - esm
  - createRequire
requirements:
  - FND-02
  - FND-04
dependency_graph:
  requires:
    - phase: 01-foundation
      plan: 01
      provides: "Package manifest, tsconfig, tsup/vitest/biome configs, D-05 feature-folder skeleton"
  provides:
    - "Full LociError hierarchy (D-01, D-03) — 11 concrete subclasses, 5 area bases, LociError abstract"
    - "ExitCode const + exitCodeFor mapping (D-02, stable ranges 10/20/30/40/50)"
    - "Pipeline type contracts (ConfigLoader, CommandsLoader, Resolver, Executor) for Phases 2-4"
    - "Commander CLI program with --version, --help, empty-state hint, LociError→exit mapping"
    - "Build-time __LOCI_VERSION__ constant wired via esbuild define (D-14)"
    - "Feature-folder stubs throwing NotImplementedError — landing spots for Phases 2-5"
    - "tsup banner createRequire polyfill — enables ESM bundle to consume CJS deps (commander)"
  affects:
    - Plan 03 (imports errors + types + main for tests; spawns dist/cli.mjs for E2E)
    - Plan 04 (CI runs build + smoke on all three OSes)
    - Phase 2 (replaces src/config/index.ts body; imports error classes)
    - Phase 3 (replaces src/commands/index.ts and src/resolver/index.ts bodies)
    - Phase 4 (replaces src/executor/index.ts body; throws ShellInjectionError/SpawnError)
    - Phase 5 (publishes dist/cli.mjs via bin field)
tech_stack:
  added: []
  patterns:
    - "ES2022 Error.cause via super(message, { cause }) — no custom .inner/.wrapped fields"
    - "abstract base + abstract area + concrete subclass — TypeScript blocks direct instantiation of bases"
    - "category as `readonly` on base + `as const` on each area — discriminated-union narrowing for exhaustive exitCodeFor switch"
    - "ShellInjectionError discards value arg — secrets-safe-by-construction precedent for Phase 4+"
    - "readonly / Readonly<> everywhere in types.ts — catches mutation at compile time"
    - ".exitOverride() + explicit whitelist of commander.helpDisplayed/commander.version — exit-code hygiene"
    - "parseAsync (not parse) — future-proof for Phase 2+ async handlers"
    - "import type for interface imports in stubs — respects verbatimModuleSyntax: true"
    - "cli.ts does NOT import feature stubs — tree-shaking keeps NotImplementedError messages out of bundle"
    - "createRequire polyfill in tsup banner — enables ESM bundles to consume CJS deps with internal require()"
key_files:
  created:
    - src/errors.ts
    - src/types.ts
    - src/version.ts
    - src/cli.ts
    - src/config/index.ts
    - src/commands/index.ts
    - src/resolver/index.ts
    - src/executor/index.ts
  modified:
    - tsup.config.ts
  deleted:
    - src/.gitkeep
    - src/config/.gitkeep
    - src/commands/.gitkeep
    - src/resolver/.gitkeep
    - src/executor/.gitkeep
decisions:
  - "tsup banner must include createRequire polyfill alongside shebang — commander is CJS and the default esbuild __require shim throws 'Dynamic require of events is not supported' at runtime when bundled into ESM"
  - "export { buildProgram, CliError, main } in alphabetical order — biome's organize-imports assist rule sorts re-export lists"
  - "ShellInjectionError deliberately discards its value parameter (void value) — sets the Phase 4+ secrets-safe error precedent"
metrics:
  duration: "~5m"
  completed_date: "2026-04-10"
  tasks: 3
  files_created: 8
  files_modified: 1
  commits: 3
  bundle_size_bytes: 129446
  bundle_size_kb: 126.41
---

# Phase 1 Plan 2: CLI Wiring & Error Hierarchy Summary

**One-liner:** Full LociError hierarchy (11 concrete subclasses, 5 area bases, ExitCode mapping) + pipeline type contracts + commander CLI with build-time version constant, bundled to a single 126 KB ESM file with a working shebang and createRequire polyfill so the bundled CJS commander runtime actually boots.

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-10T15:33:09Z
- **Completed:** 2026-04-10T15:37:55Z
- **Tasks:** 3
- **Files created:** 8
- **Files modified:** 1
- **Files deleted:** 5 (.gitkeep placeholders)

## Accomplishments

- Full LociError hierarchy declared in Phase 1 per D-03 "declare once, throw from Phases 2-5". 11 concrete subclasses: YamlParseError, ConfigReadError, SecretsTrackedError, CircularAliasError, UnknownAliasError, CommandSchemaError, UndefinedPlaceholderError, ShellInjectionError, SpawnError, UnknownFlagError, NotImplementedError. 5 area bases (ConfigError, CommandError, InterpolationError, ExecutorError, CliError) plus abstract LociError root. ExitCode const + exitCodeFor exhaustive-switch mapping honors the D-02 stable ranges (SUCCESS=0, CONFIG=10, COMMAND=20, INTERPOLATION=30, EXECUTOR=40, CLI=50).
- Pipeline type contracts (src/types.ts): ConfigLoader, CommandsLoader, Resolver, Executor interfaces; ResolvedConfig with readonly values/provenance/secretKeys; CommandDef discriminated union (single/sequential/parallel) with readonly arrays encoding "shell:false always, argv only" at the type level; ExecutionPlan union.
- Commander CLI wired (src/cli.ts) with .exitOverride(), parseAsync, LociError→exit mapping, commander.helpDisplayed/commander.version whitelist as exit 0, empty-state hint per D-15, and re-exports of main/buildProgram/CliError for Plan 03 unit tests.
- Build-time LOCI_VERSION constant (src/version.ts) backed by esbuild define replacing __LOCI_VERSION__ — zero fs reads at startup, honors FND-03 cold-start strategy and D-14.
- Feature-folder stubs (src/{config,commands,resolver,executor}/index.ts) each typed against its interface via `import type` and throwing NotImplementedError with a phase-tagged component name. cli.ts does not import these, so tree-shaking keeps the stub strings out of dist/cli.mjs (verified).
- tsup bundle produces dist/cli.mjs at 126.41 KB with a working shebang at byte 0 and a createRequire polyfill on lines 2-3 so commander's internal CJS `require('events')` resolves at runtime.

## Task Commits

1. **Task 1: LociError hierarchy + pipeline type contracts** — `e4efc28` (feat)
2. **Task 2: src/version.ts + src/cli.ts + tsup createRequire fix** — `d4e52c7` (feat)
3. **Task 3: Feature-folder stubs throwing NotImplementedError** — `20d5af2` (feat)

## Files Created/Modified

- `src/errors.ts` (224 lines) — Full LociError hierarchy, ExitCode const, exitCodeFor mapping
- `src/types.ts` (95 lines) — Pipeline interfaces + CommandDef/ExecutionPlan discriminated unions
- `src/version.ts` (9 lines) — declare const __LOCI_VERSION__ + LOCI_VERSION export
- `src/cli.ts` (74 lines) — commander wiring, exitOverride, error→exit mapping, main/buildProgram re-exports
- `src/config/index.ts` — Phase 2 ConfigLoader stub
- `src/commands/index.ts` — Phase 3 CommandsLoader stub
- `src/resolver/index.ts` — Phase 3 Resolver stub
- `src/executor/index.ts` — Phase 4 Executor stub
- `tsup.config.ts` (modified) — banner expanded to shebang + createRequire polyfill (fix for CJS-in-ESM dynamic require)

## CLI Output Samples (from actual dist/cli.mjs runs)

**`node dist/cli.mjs --version`**
```
0.0.0
```
exit=0

**`node dist/cli.mjs --help`**
```
Usage: loci [options]

Local CI — cross-platform command alias runner

Options:
  -V, --version  output the current loci version
  -h, --help     display help for command
```
exit=0

**`node dist/cli.mjs`** (no args)
```
Usage: loci [options]

Local CI — cross-platform command alias runner

Options:
  -V, --version  output the current loci version
  -h, --help     display help for command

(no aliases defined yet — .loci/commands.yml will be loaded once Phase 2+ ships)
```
exit=0

**`node dist/cli.mjs --bogus`**
```
error: unknown option '--bogus'

Usage: loci [options]
...
error [CLI_UNKNOWN_FLAG]: Unknown flag: error: unknown option '--bogus'
  suggestion: Run `loci --help` for available flags
```
exit=50 (D-02 CliError range)

## Bundle Introspection

- **Size:** 126.41 KB (129,446 bytes)
- **First 19 bytes:** `#!/usr/bin/env node` (literal, byte 0)
- **Line 2:** `import { createRequire } from 'node:module';` (polyfill)
- **`__LOCI_VERSION__` literal count:** 0 (esbuild define replaced it)
- **`0.0.0` literal count:** 1 (the inlined version)
- **Stub strings in bundle:** 0 for "ConfigLoader (Phase 2)", "CommandsLoader (Phase 3)", "Resolver (Phase 3)", "Executor (Phase 4)" — tree-shaking confirmed

## Decisions Made

1. **tsup banner combines shebang + createRequire polyfill.** Bundling commander (CJS) into a single ESM .mjs makes esbuild emit a `__require` shim that throws "Dynamic require of 'events' is not supported" at runtime unless a working `require` exists. The canonical fix is `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);` in the banner. The shebang stays on line 1 (Unix exec() only reads the first line for interpreter lookup); the polyfill is on lines 2-3. Verified: shebang is at byte 0 after the build, and all four smoke invocations boot without the dynamic-require error.

2. **Biome organize-imports sorts re-export lists alphabetically.** The canonical RESEARCH.md snippet has two separate `export { main, buildProgram };` and `export { CliError };` statements. Biome's assist/source/organizeImports merges these into `export { buildProgram, CliError, main };`. The re-export semantics are identical; the merged form is the biome-approved canonical form.

3. **ShellInjectionError discards its value parameter** (via `void value`) rather than embedding it in the message. This sets the Phase 4+ precedent: error constructors accept the offending value for API compatibility but never leak it through `.message` or `.toString()`. Threat register T-02-01 honored by construction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Formatting] Biome reformatted src/errors.ts line-width**

- **Found during:** Task 1 end-of-task lint
- **Issue:** Biome formatter's `lineWidth: 100` collapsed the multi-line `LociErrorCategory` union and the `YamlParseError` super() call into single-line forms that still fit within 100 columns. RESEARCH.md's canonical snippet used the expanded form. Biome check failed with "Formatter would have printed the following content".
- **Fix:** Ran `npx @biomejs/biome check --write src/errors.ts src/types.ts`. Biome auto-fixed the format; semantics unchanged; all grep-based acceptance criteria (e.g. `"export class YamlParseError"`, `"CONFIG_ERROR: 10"`) still match.
- **Files modified:** src/errors.ts
- **Verification:** `npm run typecheck && npm run lint` both exit 0; Task 1 verify block "ALL VERIFY PASS".
- **Committed in:** e4efc28 (Task 1 commit)

**2. [Rule 1 - Formatting] Biome organize-imports merged re-exports in src/cli.ts**

- **Found during:** Task 2 end-of-task lint
- **Issue:** Biome's `assist/source/organizeImports` rejected two separate `export { main, buildProgram };` and `export { CliError };` statements as "imports and exports are not sorted".
- **Fix:** Ran `npx @biomejs/biome check --write src/cli.ts`. Biome merged the two export statements into a single `export { buildProgram, CliError, main };` in alphabetical order.
- **Files modified:** src/cli.ts
- **Verification:** Task 2 verify block grep for `export { buildProgram, CliError, main }` matches; re-export semantics identical.
- **Committed in:** d4e52c7 (Task 2 commit)

**3. [Rule 3 - Blocking] tsup bundle crashed at runtime due to CJS-in-ESM dynamic require**

- **Found during:** Task 2 end-of-task smoke run of `node dist/cli.mjs --version`
- **Issue:** The built `dist/cli.mjs` crashed on every invocation with `Error: Dynamic require of "events" is not supported` at line 12 of the bundle. Root cause: commander is CJS; tsup/esbuild bundles it into an ESM output by emitting a `__require` shim that falls back to `throw Error('Dynamic require...')` when no global `require` is available. In a pure ESM runtime there is no `require`, so commander's `require('events')` detonates at module-evaluation time. This is a documented esbuild/tsup gotcha (https://github.com/evanw/esbuild/issues/1921) and blocked all four acceptance smoke tests.
- **Fix:** Extended `tsup.config.ts` banner from `{ js: '#!/usr/bin/env node' }` to a multi-line string that keeps the shebang on line 1 and adds `import { createRequire as __loci_createRequire } from 'node:module';` + `const require = __loci_createRequire(import.meta.url);` on lines 2-3. esbuild's `__require` shim then sees a real `require` at runtime and delegates to it. Verified: shebang still at byte 0, bundle size 126.41 KB (stable), all four smoke tests pass with correct exit codes.
- **Files modified:** tsup.config.ts
- **Verification:** `head -c 19 dist/cli.mjs` = `#!/usr/bin/env node`; `node dist/cli.mjs --version` → `0.0.0` exit 0; `--help` → Usage banner exit 0; no args → empty-state hint exit 0; `--bogus` → exit 50.
- **Committed in:** d4e52c7 (Task 2 commit, folded in with src/cli.ts + src/version.ts)

---

**Total deviations:** 3 auto-fixed (2 biome formatter/organize, 1 blocking CJS-in-ESM dynamic require).
**Impact on plan:** Deviations 1 and 2 are purely cosmetic (biome formatter normalized the RESEARCH.md snippets without changing semantics). Deviation 3 is a mandatory correctness fix — without it the bundle cannot even boot, so Plan 03 tests and Plan 04 CI smoke would have all failed. The fix is minimal (two-line banner change in tsup.config.ts) and does not break the shebang contract.

## Issues Encountered

The CJS-in-ESM dynamic-require issue (deviation 3) is genuinely worth calling out because it will affect every future plan that adds CJS-only runtime deps. The banner polyfill now catches it globally, so Plan 02+ authors don't need to worry — any CJS dep tsup bundles will work through the same `__require` → `createRequire(import.meta.url)` path.

## Threat Register Disposition

All Phase 1 Plan 2 `mitigate` entries honored:

- **T-02-01** Information Disclosure (error messages leaking secrets): `ShellInjectionError` constructor discards `value` via `void value` and embeds only the static message "Command contains shell metacharacters in an argument slot". Acceptance criterion "secrets-safe by construction" verified by code review.
- **T-02-02** Spoofing (commander errors leaking to wrong exit codes): `exitOverride()` + explicit whitelist of `commander.helpDisplayed`/`commander.version` as exit 0; all other `commander.*` codes map to `UnknownFlagError` → exit 50. Verified by `--bogus` smoke test returning exit 50 and `--version`/`--help` returning exit 0.
- **T-02-04** Denial of Service (unhandled exception): `main(process.argv).then(process.exit, (err) => ...)` catches top-level rejections and prints `fatal: <msg>` with exit 1. No unhandled rejection path.
- **T-02-07** Tampering (tree-shaking failure): Verified by `grep` on dist/cli.mjs for the four stub strings ("ConfigLoader (Phase 2)", "CommandsLoader (Phase 3)", "Resolver (Phase 3)", "Executor (Phase 4)") — all return 0 occurrences. Bundle size stable at 126.41 KB after adding the stubs in Task 3.

`accept` entries (T-02-03 build-time version constant, T-02-05 shell injection prep-only, T-02-06 stub phase roadmap disclosure) remain accepted and stay out of scope.

## Authentication Gates

None. This plan only touches local files, runs `npm run build` locally, and spawns the local `dist/cli.mjs`.

## Downstream Enablement

- **Plan 03** can now `import { main, buildProgram } from '../cli.js'` for unit tests, `import { LociError, ExitCode, exitCodeFor, ... } from '../errors.js'` for error-class tests, and spawn `dist/cli.mjs` for subprocess E2E tests against the four invocations already verified here.
- **Plan 04 CI** can run `npm ci → typecheck → lint → build → test → smoke` end-to-end on ubuntu-latest, macos-latest, and windows-latest. The createRequire polyfill in the banner means Windows/macOS/Linux will all boot the bundle identically.
- **Phase 2** replaces the body of `src/config/index.ts#load` — no file creation, no import wiring changes. The `ConfigLoader` interface, `ResolvedConfig` shape, `YamlParseError`, `ConfigReadError`, and `SecretsTrackedError` are all ready to be thrown.
- **Phase 3** replaces the bodies of `src/commands/index.ts#load` and `src/resolver/index.ts#resolve`. `CommandMap`, `CommandDef` union, `ExecutionPlan` union, `CircularAliasError`, `UnknownAliasError`, `CommandSchemaError`, and `UndefinedPlaceholderError` are ready.
- **Phase 4** replaces the body of `src/executor/index.ts#run`. `ExecutionPlan`, `ExecutionResult`, `ShellInjectionError` (with the secrets-safe constructor), and `SpawnError` are ready.

## Known Stubs

The feature-folder index files (`src/config/index.ts`, `src/commands/index.ts`, `src/resolver/index.ts`, `src/executor/index.ts`) are **intentional typed landing spots per D-06**. Each throws `NotImplementedError` with a phase-tagged component name. They are not wired into `cli.ts` (verified by tree-shaking — stub strings do not appear in dist/cli.mjs), so no end-user path can reach them in Phase 1. Phase 2 replaces `src/config/index.ts#load`; Phase 3 replaces `src/commands/index.ts#load` and `src/resolver/index.ts#resolve`; Phase 4 replaces `src/executor/index.ts#run`. This is documented in PLAN.md and is the D-06 architectural intent — not a gap.

No other stubs. `src/errors.ts`, `src/types.ts`, `src/version.ts`, and `src/cli.ts` are all fully populated.

## Self-Check: PASSED

All claimed artifacts verified on disk:

- src/errors.ts, src/types.ts, src/version.ts, src/cli.ts — FOUND
- src/config/index.ts, src/commands/index.ts, src/resolver/index.ts, src/executor/index.ts — FOUND
- tsup.config.ts — MODIFIED (banner now multi-line with createRequire polyfill)
- src/.gitkeep, src/config/.gitkeep, src/commands/.gitkeep, src/resolver/.gitkeep, src/executor/.gitkeep — REMOVED
- dist/cli.mjs — FOUND (126.41 KB, 129446 bytes)

All claimed commits verified in git log:

- e4efc28 feat(01-02): add LociError hierarchy and pipeline type contracts — FOUND
- d4e52c7 feat(01-02): wire commander CLI and build-time version constant — FOUND
- 20d5af2 feat(01-02): add feature-folder stubs throwing NotImplementedError — FOUND

Gate results reproduced at self-check time:

- `npm run typecheck` → exit 0
- `npm run lint` → exit 0
- `npm run build` → exit 0, dist/cli.mjs 126.41 KB
- `head -c 19 dist/cli.mjs` → `#!/usr/bin/env node`
- `grep -c __LOCI_VERSION__ dist/cli.mjs` → 0
- `grep -c "0.0.0" dist/cli.mjs` → 1
- `node dist/cli.mjs --version` → `0.0.0` exit 0
- `node dist/cli.mjs --help` → "Usage: loci" banner exit 0
- `node dist/cli.mjs` (no args) → empty-state hint exit 0
- `node dist/cli.mjs --bogus` → exit 50
- `ls src/` → cli.ts, errors.ts, types.ts, version.ts + commands/ config/ executor/ resolver/ __tests__/ (no .gitkeep in the four feature folders)

---
*Phase: 01-foundation*
*Completed: 2026-04-10*
