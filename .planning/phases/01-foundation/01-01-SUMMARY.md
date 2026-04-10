---
phase: 01-foundation
plan: 01
subsystem: scaffolding
tags:
  - scaffolding
  - typescript
  - tsup
  - vitest
  - biome
requirements:
  - FND-01
  - FND-05
dependency_graph:
  requires: []
  provides:
    - ESM package manifest with pinned runtime deps
    - Strict TypeScript ES2022 bundler config
    - tsup single-file ESM bundle config with shebang and __LOCI_VERSION__ define
    - vitest co-located test runner config
    - biome lint + format config aligned with verbatimModuleSyntax
    - Repository hygiene files (.gitignore, .gitattributes, .editorconfig, .nvmrc)
    - D-05 feature-folder skeleton (src/{config,commands,resolver,executor,__tests__}/)
  affects:
    - All downstream plans depend on this scaffold
tech_stack:
  added:
    - commander@14.0.3 (runtime)
    - execa@9.6.1 (runtime)
    - yaml@2.8.3 (runtime)
    - "@biomejs/biome@2.4.11 (dev)"
    - "@types/node@22.19.17 (dev)"
    - tsup@8.5.1 (dev)
    - typescript@5.9.3 (dev, ^5.9.0)
    - vitest@4.1.4 (dev)
  patterns:
    - Exact-pin runtime deps (no caret) for cold-start budget reproducibility
    - Feature-folder layout with co-located __tests__
    - Single-file ESM bundle via tsup noExternal all
key_files:
  created:
    - package.json
    - package-lock.json
    - tsconfig.json
    - tsup.config.ts
    - vitest.config.ts
    - biome.json
    - .gitignore
    - .gitattributes
    - .editorconfig
    - .nvmrc
    - src/.gitkeep
    - src/config/.gitkeep
    - src/commands/.gitkeep
    - src/resolver/.gitkeep
    - src/executor/.gitkeep
    - src/__tests__/.gitkeep
  modified: []
decisions:
  - Lock TypeScript to ^5.9.0 per CLAUDE.md §Technology Stack (orchestrator-locked override of RESEARCH.md ^6.0.2)
  - Resolved TypeScript version is 5.9.3 (latest 5.x at install time), compatible with yaml 2.8.3's min TS 5.9
  - No LICENSE/repository/homepage fields in package.json yet — Phase 5 scope
  - Rule 1 auto-fix applied to tsup.config.ts import ordering to satisfy biome's assist/source/organizeImports
metrics:
  duration: "~4m"
  completed_date: "2026-04-10"
  tasks: 3
  files_created: 16
  commits: 3
---

# Phase 1 Plan 1: Scaffold loci Repository Summary

**One-liner:** Cross-platform loci CLI scaffolded from zero with ESM package manifest, strict TypeScript ES2022 config, tsup single-file bundler, vitest + biome configured, and the D-05 feature-folder layout in place — fresh repo passes `npm run lint` and `npm run typecheck` vacuously.

## What Was Built

Task 1 created the package manifest and typecheck config. `package.json` pins runtime deps exactly (commander 14.0.3, execa 9.6.1, yaml 2.8.3), declares `"type": "module"`, sets `engines.node: ">=20.5.0"` (execa 9.x floor), and exposes `bin.loci` pointing at `./dist/cli.mjs`. `tsconfig.json` enables strict mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, and targets ES2022 with `moduleResolution: bundler`. `npm install` was run to generate `package-lock.json` (required for CI `npm ci` in Plan 04).

Task 2 created the toolchain configs. `tsup.config.ts` produces a single-file ESM `.mjs` bundle via `noExternal: [/.*/]`, injects the literal shebang via `banner.js`, reads `package.json` at config-load time (no import-attribute churn), and defines `__LOCI_VERSION__` via `JSON.stringify(pkg.version)` — the mandatory esbuild-define semantics. `sourcemap: false` prevents the Pitfall 1 shebang-shift. `vitest.config.ts` discovers tests at `src/**/__tests__/**/*.test.ts` (D-08 co-located layout), runs in node environment, allows 10s test timeout for Windows CI, and uses v8 coverage. `biome.json` targets schema 2.4.11, enables `useIgnoreFile: true`, and enforces `useImportType: error` to align with tsconfig's `verbatimModuleSyntax: true`.

Task 3 created the hygiene files and the D-05 directory skeleton. `.gitignore` ignores `node_modules/`, `dist/`, `coverage/`, `.loci/secrets.yml`, and `.loci/local.yml`. `.gitattributes` enforces `eol=lf` globally with `eol=crlf` for `.ps1`/`.cmd` — this is critical for Windows contributors because otherwise git checkout would rewrite `src/**/*.ts` to CRLF and biome would flag every file. `.editorconfig` locks 2-space indent and LF line endings. `.nvmrc` pins Node 22 (current Active LTS, D-09 primary). Six `.gitkeep` placeholders establish the feature-folder skeleton under `src/`: `config/`, `commands/`, `resolver/`, `executor/`, and `__tests__/`.

## Exact Resolved Versions (from package-lock.json)

| Package | Requested | Resolved |
|---------|-----------|----------|
| commander | 14.0.3 (exact) | 14.0.3 |
| execa | 9.6.1 (exact) | 9.6.1 |
| yaml | 2.8.3 (exact) | 2.8.3 |
| @biomejs/biome | 2.4.11 (exact) | 2.4.11 |
| tsup | 8.5.1 (exact) | 8.5.1 |
| vitest | 4.1.4 (exact) | 4.1.4 |
| typescript | ^5.9.0 | 5.9.3 |
| @types/node | ^22 | 22.19.17 |

Node runtime at install: v22.22.2. Total installed: 113 packages, 0 vulnerabilities, 0 warnings.

## TypeScript 6 vs 5 Drift

None observed. The orchestrator-locked decision to pin TypeScript to `^5.9.0` (CLAUDE.md §Technology Stack) resolved cleanly to 5.9.3, which satisfies yaml 2.8.3's minimum TS 5.9 requirement. `npm run typecheck` passed with zero errors against the two config files in `tsconfig.include` (`tsup.config.ts`, `vitest.config.ts`). The `include` pattern matches zero `src/**/*.ts` files vacuously — Plan 02 will populate `src/cli.ts`, `src/errors.ts`, etc., and typecheck will then exercise the strict rules non-vacuously.

## Gate Results

- `npm install` → 113 packages added, 0 vulnerabilities, 0 warnings (Node v22.22.2)
- `npm run lint` → exit 0 (biome checked 3 files: tsup.config.ts, vitest.config.ts, biome.json)
- `npm run typecheck` → exit 0 (tsc --noEmit, two config files typecheck cleanly)
- `git ls-files | grep package-lock.json` → hit (lockfile committed per RESEARCH Pitfall 6)
- `git status` → clean after Task 3 commit (no untracked node_modules, dist, or .loci/* leaks)

## Commits

| Task | Message | Hash |
|------|---------|------|
| 1 | chore(01-01): scaffold package.json, tsconfig.json, and lockfile | 786b84d |
| 2 | chore(01-01): scaffold tsup, vitest, and biome configs | b73fa02 |
| 3 | chore(01-01): add hygiene files and D-05 directory skeleton | 42ad6ca |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] tsup.config.ts import order rejected by biome**

- **Found during:** Task 3 end-of-plan `npm run lint` smoke
- **Issue:** biome's `assist/source/organizeImports` assist rule (enabled via `recommended: true`) treats import ordering as an error and required `node:fs` (builtin) to appear before `tsup` (third-party). The RESEARCH.md canonical snippet placed `tsup` first.
- **Fix:** Swapped the two import lines in `tsup.config.ts`. No semantic change — only the textual order of the import statements was modified. All verification from Task 2 still holds (`noExternal`, shebang banner, `__LOCI_VERSION__` define, `sourcemap: false` all unchanged).
- **Files modified:** tsup.config.ts
- **Commit:** 42ad6ca (folded into Task 3 commit because the fix was discovered during Task 3's smoke run and the order-only change is trivially reviewable)

No other deviations. RESEARCH.md snippets for `tsconfig.json`, `vitest.config.ts`, `biome.json`, `.gitignore`, `.gitattributes`, and `.editorconfig` were written verbatim.

## Authentication Gates

None. This plan only touches local files and `npm install` from the public registry.

## Threat Register Disposition

All `mitigate` entries honored:

- **T-01-01** Supply chain pinning: commander, execa, yaml pinned to exact versions (no caret); package-lock.json committed.
- **T-01-02** No postinstall/preinstall/prepare scripts in package.json — only `prepublishOnly` which runs on maintainer machines.
- **T-01-03** `files: ["dist", "README.md"]` excludes everything else from the published tarball. Phase 5 will verify with `npm pack --dry-run`.
- **T-01-05** `tsup.config.ts` uses literal-string `banner.js: '#!/usr/bin/env node'` — no interpolation. Will be verified at Plan 02 build time.

`accept` entries (T-01-04 build-time version injection, T-01-06 error-handling hygiene) stay out of scope for this plan.

## Downstream Enablement

- **Plan 02** can now create `src/cli.ts`, `src/errors.ts`, `src/types.ts`, `src/version.ts`, and feature `index.ts` stubs; can run `npm run build` and `npm run typecheck`.
- **Plan 03** can add `src/**/__tests__/*.test.ts` and run `npm test`.
- **Plan 04** CI can run `npm ci → typecheck → lint → build → test → smoke` end-to-end.

## Self-Check: PASSED

All claimed artifacts verified on disk:

- package.json, package-lock.json, tsconfig.json, tsup.config.ts, vitest.config.ts, biome.json — FOUND
- .gitignore, .gitattributes, .editorconfig, .nvmrc — FOUND
- src/.gitkeep, src/config/.gitkeep, src/commands/.gitkeep, src/resolver/.gitkeep, src/executor/.gitkeep, src/__tests__/.gitkeep — FOUND

All claimed commits verified in git log:

- 786b84d chore(01-01): scaffold package.json, tsconfig.json, and lockfile — FOUND
- b73fa02 chore(01-01): scaffold tsup, vitest, and biome configs — FOUND
- 42ad6ca chore(01-01): add hygiene files and D-05 directory skeleton — FOUND

Gate results reproduced at self-check time:

- `npm run lint` → exit 0
- `npm run typecheck` → exit 0

No stubs in scope — the plan deliberately ships no `src/*.ts` source. The empty `.gitkeep` files are documented placeholders to be replaced in Plan 02, not runtime stubs.
