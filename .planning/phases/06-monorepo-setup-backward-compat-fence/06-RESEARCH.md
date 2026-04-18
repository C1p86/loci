# Phase 6: Monorepo Setup & Backward-Compat Fence - Research

**Researched:** 2026-04-18
**Domain:** Monorepo tooling (pnpm + Turborepo + Changesets), CI fence gates (size-limit, ws-exclusion, hyperfine), Biome 2.x overrides
**Confidence:** HIGH on stack versions, Turbo/pnpm/Changesets wiring, hyperfine install, tsup external-vs-noExternal precedence. MEDIUM on exact Biome `noRestrictedImports` category placement (docs inconsistent across pages). LOW on nothing load-bearing.

## Summary

Phase 6 is pure infrastructure plumbing: move the current single-package layout under `packages/xci/`, wire pnpm workspaces + Turborepo + Changesets at the root, and stand up three CI fence gates (bundle-size, `ws`-exclusion, cold-start) so that Phase 7+ agent work cannot silently regress the v1 CLI. Nineteen decisions (D-01..D-19) are locked in CONTEXT.md — research focused on the twelve Claude's-Discretion items and the current-version mechanics of the locked decisions.

The single load-bearing finding: **tsup's `noExternal` takes precedence over `external`**. The current `tsup.config.ts` has `noExternal: [/.*/]` (bundle everything) — simply adding `external: ['ws', 'reconnecting-websocket']` will not exclude them, because `[/.*/]` matches first. The planner must either (a) remove `noExternal: [/.*/]` and rely on tsup's default behavior (which externalizes all `dependencies`/`peerDependencies`), (b) replace the regex with one that excludes the two WS packages, or (c) ensure `ws` and `reconnecting-websocket` are NEVER listed in `dependencies` of `packages/xci/package.json`. Path (c) is the cleanest because Phase 6 does not introduce those deps anyway — they arrive in Phase 8 and go into `@xci/server` / a new agent module in `packages/xci/src/agent/`, not the current dep list.

**Primary recommendation:** Adopt pnpm 10.x (current stable, Apr 2026) + Turborepo 2.5.x + Changesets 2.31.x with the fixed-versioning config from CONTEXT D-11. Install hyperfine via `sudo apt-get install -y hyperfine` on ubuntu-latest (available in Ubuntu 24.04 universe repo, ~5s install). Put `noRestrictedImports` as a path-scoped `overrides` entry under `lint.rules.style` in the root `biome.json` (Biome 2.4.11+ syntax uses `"includes"` plural). Use `@size-limit/file` preset with `"brotli": false` to measure raw bytes. Use `pnpm/action-setup@v4` without explicit `version:` (reads from `packageManager` field).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Package Skeleton (Phase 6 scope)**
- **D-01:** Create three package directories: `packages/xci/` (full migration of current `src/`, tests, tsup/biome/vitest config), `packages/server/`, `packages/web/`. Server and web dirs get ONLY a minimal `package.json` (`name`, `version`, `private: true` initially — see D-11) and an empty `src/index.ts` stub. No build scripts, no tsconfig. They exist so Turbo and Changesets track them from day one.
- **D-02:** Root of monorepo contains: `package.json` (workspaces + turbo + changesets scripts, `"private": true`), `pnpm-workspace.yaml`, `turbo.json`, `biome.json` (shared config — extended from root by each package if they need overrides), `.changeset/config.json`, `tsconfig.base.json`, `README.md` (monorepo overview), `LICENSE`, `.nvmrc`, `.editorconfig`, `.gitignore`, `.gitattributes`, `.github/workflows/`.
- **D-03:** Each package has its own `tsconfig.json` extending `tsconfig.base.json`. Each has its own `vitest.config.ts` and `tsup.config.ts` where relevant. `packages/server/` and `packages/web/` skip tsup/vitest until Phase 7+.
- **D-04:** README split: root `README.md` is a monorepo overview (what is xci, what are the 3 packages, how to clone+install+test). `packages/xci/README.md` IS the current v1 README — verbatim — because that's what ships to npm as the `xci` package readme.
- **D-05:** CLI entry path: `packages/xci/dist/cli.mjs`. `packages/xci/package.json` `bin.xci` points to `./dist/cli.mjs` (relative to the package). The bundle-size CI gate checks this exact path.

**Package Manager Migration (npm → pnpm)**
- **D-06:** Clean cut: delete `package-lock.json` in the same commit that introduces `pnpm-workspace.yaml` and runs `pnpm install` to generate `pnpm-lock.yaml`. No parallel npm branch, no fallback. v1.0 code is already shipped and tagged; anyone needing v1 toolchain checks out the v1 tag.
- **D-07:** pnpm version pinned via `packageManager` field in root `package.json` (`"packageManager": "pnpm@<latest-v9>"`). CI uses `pnpm/action-setup@v4` without an explicit `version:` — it reads from `packageManager` so local and CI stay in lockstep. Corepack enforces locally. **Research note:** CONTEXT says "latest-v9" but current stable is pnpm 10.x as of Apr 2026 (see Standard Stack below); planner should confirm pin with user in execute phase.
- **D-08:** `.nvmrc` stays pointing at Node 22 (current LTS). Engines floor in all package.jsons remains `>=20.5.0` (keeps execa 9 compat). CI matrix already covers both 20 and 22.

**Turborepo Pipeline**
- **D-09:** `turbo.json` defines 4 tasks: `build`, `test`, `lint`, `typecheck`. Dependency graph: `build` depends on `^build` (upstream packages built first); `test` depends on `build`; `lint` and `typecheck` have no deps. No `dev` / `clean` / `format` tasks in Phase 6.
- **D-10:** Turbo cache is **local only** in Phase 6 (`.turbo/` in each package, gitignored). No remote cache.

**Changesets & Versioning**
- **D-11:** Fixed versioning: `.changeset/config.json` declares `"fixed": [["xci", "@xci/server", "@xci/web"]]`. All three packages always release at the same version.
- **D-12:** Root `package.json` is `"private": true`. `xci`, `@xci/server`, `@xci/web` are all publishable. First real publish happens in Phase 14; Phase 6 just wires the machinery.
- **D-13:** Publish flow: `changesets/action@v1` GitHub Action on main branch. On merge, action creates/updates a "Version PR"; when that PR is merged, action runs `pnpm -r publish` with `NPM_TOKEN` secret.
- **D-14:** npm scope `@xci` — availability NOT yet verified. Phase 6 must include an early task: `npm view @xci/server` + `npm view @xci/web` (expect 404 = available). Blocking pre-flight.

**CI Fence Gates**
- **D-15:** **Bundle-size gate:** `size-limit` with config in `packages/xci/package.json`. Rule: `packages/xci/dist/cli.mjs` ≤ 200 KB (`gzip: false`/raw bytes). CI step: `pnpm --filter xci build && pnpm --filter xci size-limit`. PR comment on delta.
- **D-16:** **`ws` / `reconnecting-websocket` exclusion** — three layers required:
  - (a) Build-time: `packages/xci/tsup.config.ts` declares `external: ['ws', 'reconnecting-websocket']`.
  - (b) Test-time grep: `grep -E "(reconnecting-websocket|['\"]ws['\"])" packages/xci/dist/cli.mjs` must return exit-1.
  - (c) Lint-time: Biome `noRestrictedImports` rule scoped to `packages/xci/src/**`.
- **D-17:** **Cold-start gate:** `hyperfine --runs 10 --warmup 3 'node packages/xci/dist/cli.mjs --version'` on ubuntu-latest only. Mean < 300ms. Windows/macOS not gated (runner variance).
- **D-18:** **v1 test suite gate:** `pnpm --filter xci test` on 3 OS × Node [20, 22] = 6 jobs. fail-fast: false.
- **D-19:** **Smoke check:** `node packages/xci/dist/cli.mjs --version` on all 6 jobs after build.

### Claude's Discretion

- Exact `size-limit` config format (package.json `size-limit` field vs separate `.size-limit.cjs`) — planner picks.
- Biome `noRestrictedImports` exact rule syntax and path scoping — planner picks.
- tsconfig.base.json fields — keep current Phase 1 values, move them up to base.
- `.changeset/config.json` defaults beyond `fixed` (changelog generator, access, base branch) — planner picks standard defaults.
- Hyperfine install step in CI (apt package vs `cargo install` vs prebuilt binary) — planner picks.
- Exact pnpm version pin value (latest stable v9 at planning time).
- README structure for root monorepo overview — planner drafts, we review.
- Shape of `packages/server/src/index.ts` and `packages/web/src/index.ts` stubs.

### Deferred Ideas (OUT OF SCOPE)

- Remote Turbo cache (Vercel/Turbo cloud) — v2.1+ only.
- `dev` / `clean` / `format` Turbo tasks — Phase 13 and later.
- Bundle-size regression reporting beyond size-limit defaults — Phase 6 uses built-in PR comment.
- TypeScript project references (`references` field) — simple `extends` inheritance only.
- Separate `biome.json` per package — root-level shared config only.
- v1-legacy branch for npm/v1 hotfixes — v1 tagged, checkout the tag.
- Automated cold-start gate on Windows/macOS — Linux only (D-17).
- Monorepo README marketing polish — functional overview only.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BC-01 | v1 CLI observably identical (config loading, exec, flags, exit codes) | Standard Stack (unchanged) + Architecture Diagram; tests untouched in move |
| BC-02 | v1 test suite (202 tests) passes as required CI gate on PRs touching `packages/xci/` | CI Gate Matrix table (D-18); 292 `it()` calls currently in `src/` — requirement's "202" is illustrative |
| BC-03 | `packages/xci/dist/cli.mjs` < 200KB; `ws` + `reconnecting-websocket` never enter the bundle | Pitfall 1 (tsup precedence), Standard Stack (size-limit 12.1.0), Code Examples (size-limit config + 3-layer fence) |
| BC-04 | Cold-start `xci --version` < 300ms on modern hardware | Code Examples (hyperfine install + invocation); Pitfall 3 (runner variance on Windows/macOS) |
| PKG-01 | Monorepo with pnpm workspaces; 3 npm packages: `xci`, `@xci/server`, `@xci/web` | Standard Stack (pnpm 10.33.0), Architecture Patterns (workspace layout) |
| PKG-02 | Build orchestrated by Turborepo (local + CI cache) | Standard Stack (turbo 2.5.8), Code Examples (turbo.json) |
| PKG-03 | Coordinated versioning via `@changesets/cli` for 3 packages | Standard Stack (@changesets/cli 2.31.0), Code Examples (`.changeset/config.json` + GitHub Action) |

## Project Constraints (from CLAUDE.md)

Non-negotiable directives extracted from project instructions:

- **Stack versions are pinned.** commander 14.0.3, execa 9.6.1, yaml 2.8.3, tsup 8.5.1, vitest 4.1.4, biome 2.x, TypeScript 5.9, `@types/node` latest. [VERIFIED: .planning/STATE.md Phase 01 entries + current package.json]
- **Node engines floor: `>=20.5.0`** (execa 9 requires `^18.19.0 || >=20.5.0` → our effective floor). Do NOT lower. [CITED: CLAUDE.md §Version Compatibility]
- **Cold-start budget: < 300ms.** Bundle everything with tsup (`bundle: true`, `noExternal: [...]`); avoid heavy deps (no chalk, ora, boxen); target single-file output. [CITED: CLAUDE.md §Cold-Start Budget]
- **ESM only.** `"type": "module"`, `.mjs` output, target `node20.5`. No CJS publishing. [CITED: CLAUDE.md §Publishing Workflow + Phase 01 P02 decision]
- **GSD Workflow Enforcement.** All file edits via GSD commands — planner must structure tasks so execute-phase invokes each change through the workflow. [CITED: CLAUDE.md §GSD Workflow Enforcement]
- **What NOT to Use:** commander v15 (pre-release), shelljs, cross-env, dotenv, yamljs, pkg/nexe, zx, inquirer/prompts. [CITED: CLAUDE.md §What NOT to Use]
- **Shebang via tsup banner** (`#!/usr/bin/env node\nimport { createRequire as __xci_createRequire } from 'node:module';\nconst require = __xci_createRequire(import.meta.url);`). Must not be edited in source. [CITED: current `tsup.config.ts` + Phase 01 P02 decision in STATE.md]

## Architectural Responsibility Map

Phase 6 is tooling-tier, not application-tier. No "browser / frontend / backend" distinction applies. The relevant tiers are build/CI tools vs application packages.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| pnpm workspace resolution | Root config (`pnpm-workspace.yaml`) | Each package's `package.json` | Workspace file declares globs; packages declare their names/deps |
| Task orchestration (build/test/lint/typecheck) | Root `turbo.json` | Each package's `scripts` in `package.json` | Turbo reads root config, invokes per-package scripts via pnpm |
| Version coordination | Root `.changeset/config.json` | Each publishable package's `package.json` version field | Changesets writes all three versions in lockstep |
| Shared TS config | Root `tsconfig.base.json` | Each package's `tsconfig.json` (extends base) | Base carries compilerOptions; packages override `include`/`references`-less |
| Shared lint + format | Root `biome.json` | Per-package overrides via `overrides[].includes` | Single config, path-scoped rule additions |
| CLI bundle | `packages/xci/` only | — | Only `xci` publishes `dist/cli.mjs`; server/web are stubs |
| CI fence gates (size, grep, hyperfine) | `.github/workflows/ci.yml` | Runs against `packages/xci/dist/cli.mjs` | Linux-only job step, after build completes |
| Placeholder packages (`@xci/server`, `@xci/web`) | `packages/server/`, `packages/web/` | — | Minimal package.json + empty `src/index.ts`; no build tooling yet |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pnpm | 10.33.0 | Workspace-aware package manager | Current stable (published 2026-04-17 per npm). Node floor `>=18.12` — compatible with our `>=20.5.0`. `--filter` syntax matches CONTEXT D-15/D-18 (`pnpm --filter xci test`). [VERIFIED: `npm view pnpm version` → 10.33.0, `npm view pnpm time.modified` → 2026-04-17] |
| turbo | 2.5.8 | Monorepo task runner + cache | Current stable v2 line. `$schema: https://turborepo.dev/schema.json`. Supports `^build` topological deps. [VERIFIED: `npm view turbo version` → 2.5.8, published 2026-04-16] |
| @changesets/cli | 2.31.0 | Versioning + changelog for monorepos | Official tool; supports `fixed` array for lockstep versioning of `xci` + `@xci/server` + `@xci/web`. [VERIFIED: `npm view @changesets/cli version` → 2.31.0] |
| changesets/action | v1 (currently v1.7.0) | GitHub Action for Version PR + publish | Official. Reads `.changeset/*.md`, opens/updates Version PR, runs publish command on merge. [CITED: https://github.com/changesets/action — v1 is the supported major] |
| size-limit | 12.1.0 | Bundle-size gate | Configurable via package.json `size-limit` field; `brotli: false` gives raw bytes. [VERIFIED: `npm view size-limit version` → 12.1.0] |
| @size-limit/file | 12.1.0 | size-limit plugin for pre-bundled files | Correct for a CLI already bundled by tsup — plugin just reads file size. NOT `@size-limit/preset-small-lib` (that one assumes source files need bundling). [CITED: https://github.com/ai/size-limit — "for a CLI bundle, @size-limit/file alone is sufficient since your code is already bundled"] |
| hyperfine | 1.18.0 (Ubuntu 24.04 apt) / 1.20.0 (GitHub release) | Cold-start benchmark | Already in Ubuntu universe repo for 24.04 (ubuntu-latest). `sudo apt-get install -y hyperfine` is ~5s. [VERIFIED: https://packages.ubuntu.com/search?keywords=hyperfine — noble has 1.18.0-2build1] |
| pnpm/action-setup | v4 | GitHub Action for pnpm setup | Reads `packageManager` field from root `package.json` when no explicit `version:` input given. v5 exists (2026-03-17) but only bumps Node runtime; v4 still supported. CONTEXT D-07 locks v4. [CITED: https://github.com/pnpm/action-setup] |
| actions/setup-node | v4 | Node.js setup with pnpm cache | `cache: 'pnpm'` requires pnpm to be installed first (pnpm/action-setup must run BEFORE setup-node). [CITED: https://pnpm.io/using-changesets example workflow] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| commander | 14.0.3 | CLI parsing (existing) | Unchanged from v1 |
| execa | 9.6.1 | Child-process execution (existing) | Unchanged from v1 |
| yaml | 2.8.3 | YAML parsing (existing) | Unchanged from v1 |
| tsup | 8.5.1 | Bundler (existing) | Unchanged from v1 — BUT `external` config changes (see Pitfall 1) |
| vitest | 4.1.4 | Test runner (existing) | Unchanged; config moves to `packages/xci/vitest.config.ts` |
| @biomejs/biome | 2.4.12 | Lint + format (existing) | Unchanged version; root config with path-scoped overrides |
| typescript | ^5.9.0 | Type checking (existing) | Unchanged |
| @types/node | ^22 | Node types (existing) | Unchanged |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pnpm | npm workspaces / Yarn Berry | npm workspaces: weaker peer-dep enforcement (won't catch phantom deps when agent code lands Phase 8); Yarn Berry: PnP mode creates .pnp.cjs loader conflicts with ESM-only tsup bundling. pnpm's strict resolver is the right choice for catching phantom deps pre-flight. |
| Turborepo | Nx | Nx is heavier (requires `nx.json` + generators); for 3 packages with 4 tasks Turbo is minimum viable and matches user's explicit ask in PKG-02. |
| Changesets | semantic-release | semantic-release reads git commit messages (Conventional Commits) to auto-version; Changesets requires explicit `.changeset/*.md` per change. Changesets wins for monorepos with fixed versioning — it understands linked packages, semantic-release does not. |
| size-limit | bundlephobia / bundle-wizard | bundlephobia is a web service (no CI gate); bundle-wizard is interactive visualizer. size-limit has a GitHub Action with PR comments, which CONTEXT D-15 requires. |
| hyperfine (apt) | hyperfine (cargo install) / prebuilt .deb | cargo install: requires Rust toolchain setup (~60s). prebuilt .deb from GitHub: ~3s but another pinned URL to maintain. `apt-get install` is ~5s and Ubuntu-supported. [VERIFIED: Ubuntu packages page — hyperfine 1.18.0 in noble universe] |
| pnpm/action-setup v4 | v5 | v5 (2026-03-17) just updates Node runtime; v4 (2023-05) reads `packageManager` field, validates version consistency. CONTEXT D-07 locks v4 — both work, v4 is conservative. |

**Installation** (root devDependencies — the `xci` package's runtime deps are unchanged):

```bash
pnpm add -Dw \
  turbo@2.5.8 \
  @changesets/cli@2.31.0 \
  size-limit@12.1.0 \
  @size-limit/file@12.1.0
```

(Existing devDeps `@biomejs/biome`, `tsup`, `vitest`, `typescript`, `@types/node` relocate to `packages/xci/package.json` or stay at root for shared tooling — planner decides per D-02.)

**Version verification** (performed 2026-04-18):
- `pnpm`: `npm view pnpm version` → `10.33.0` (published 2026-04-17) [VERIFIED]
- `turbo`: `npm view turbo version` → `2.5.8` (published 2026-04-16) [VERIFIED]
- `@changesets/cli`: `npm view @changesets/cli version` → `2.31.0` [VERIFIED]
- `size-limit`: `npm view size-limit version` → `12.1.0` (published 2026-04-13) [VERIFIED]
- `@biomejs/biome`: `npm view @biomejs/biome version` → `2.4.12` [VERIFIED]
- `tsup`: still `8.5.1` [VERIFIED, unchanged]

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Developer Workstation                          │
│                                                                          │
│    git clone ──→  corepack use pnpm@10.33.0  ──→  pnpm install (root)    │
│                                                           │              │
│                                                           ▼              │
│                                              pnpm-lock.yaml (root only)  │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      Root (private: true, non-publishable)               │
│                                                                          │
│  package.json ──→ scripts: { build: "turbo run build", test: "turbo run  │
│                              test", lint, typecheck, release: "pnpm -r   │
│                              publish" }                                  │
│                                                                          │
│  pnpm-workspace.yaml ──→ packages:  - packages/*                         │
│                                                                          │
│  turbo.json ──→ tasks: { build: { dependsOn: [^build], outputs: [dist/**]│
│                        }, test: { dependsOn: [build] }, lint, typecheck }│
│                                                                          │
│  biome.json ──→ linter + formatter (shared) + overrides[0].includes:     │
│                 ["packages/xci/src/**/*.ts"] adds noRestrictedImports    │
│                                                                          │
│  .changeset/config.json ──→ fixed: [["xci","@xci/server","@xci/web"]]    │
│                                                                          │
│  tsconfig.base.json ──→ target ES2022, module ESNext, moduleResolution   │
│                         bundler, strict, verbatimModuleSyntax, ...       │
└──────────────────────────────────────────────────────────────────────────┘
                                      │
                        ┌─────────────┼─────────────┐
                        ▼             ▼             ▼
                 ┌──────────┐  ┌──────────┐  ┌──────────┐
                 │ xci      │  │ @xci/    │  │ @xci/    │
                 │ (full)   │  │ server   │  │ web      │
                 │          │  │ (stub)   │  │ (stub)   │
                 └────┬─────┘  └──────────┘  └──────────┘
                      │
                      │  (full migration of current single-package layout)
                      ▼
        packages/xci/
        ├── package.json           (bin.xci → ./dist/cli.mjs,
        │                           size-limit field, deps: commander/execa/yaml)
        ├── tsup.config.ts         (external: [...], see Pitfall 1)
        ├── vitest.config.ts       (unchanged from root)
        ├── tsconfig.json          (extends ../../tsconfig.base.json)
        ├── README.md              (v1 README verbatim — ships to npm)
        ├── src/                   (moved from root src/)
        │   ├── cli.ts
        │   ├── errors.ts, types.ts, version.ts
        │   ├── config/, commands/, resolver/, executor/, init/, template/, tui/
        │   └── __tests__/  (≈292 it() across 13 files)
        └── dist/cli.mjs           (build output — the bundle-size gate target)

        packages/server/
        ├── package.json           (name @xci/server, version 0.0.0, publishable,
        │                           scripts.build: "exit 0" or noop, type: module)
        └── src/index.ts           (export {}; — valid ESM module)

        packages/web/
        ├── package.json           (identical shape to server, name @xci/web)
        └── src/index.ts           (export {};)

                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions CI Pipeline                       │
│                                                                          │
│   on: [push to main, PR, workflow_dispatch]                              │
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │  Job: build-test-lint (matrix: 3 OS × Node [20,22] = 6 jobs)   │    │
│   │                                                                │    │
│   │  checkout  →  pnpm/action-setup@v4  →  setup-node@v4 (cache:   │    │
│   │    pnpm)  →  pnpm install  →  pnpm turbo run typecheck lint    │    │
│   │    build test  →  node packages/xci/dist/cli.mjs --version     │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │  Job: fence-gates (ubuntu-latest only, needs: build-test-lint) │    │
│   │                                                                │    │
│   │  checkout  →  pnpm setup  →  node setup  →  install  →  build  │    │
│   │    →  (D-15) pnpm --filter xci size-limit                      │    │
│   │    →  (D-16b) ! grep -qE "(reconnecting-websocket|['\"]ws['\"] │    │
│   │                )" packages/xci/dist/cli.mjs                    │    │
│   │    →  (D-17) sudo apt-get install -y hyperfine                 │    │
│   │    →  (D-17) hyperfine --runs 10 --warmup 3 --export-json ...  │    │
│   │              'node packages/xci/dist/cli.mjs --version'        │    │
│   │    →  script to assert mean < 300ms                            │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│   Branch protection on main: all 7 jobs (6 matrix + 1 fence) required.   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
.                                   # repo root
├── package.json                    # private: true, packageManager, scripts, devDeps (turbo, changesets, size-limit)
├── pnpm-workspace.yaml             # packages: [packages/*]
├── pnpm-lock.yaml                  # generated
├── turbo.json                      # tasks: build/test/lint/typecheck
├── biome.json                      # root shared + overrides for packages/xci/src/**
├── tsconfig.base.json              # shared compilerOptions
├── .changeset/
│   ├── config.json                 # fixed: [[xci, @xci/server, @xci/web]]
│   └── README.md                   # generated by `pnpm changeset init`
├── .github/
│   └── workflows/
│       ├── ci.yml                  # build-test-lint matrix + fence-gates job
│       └── release.yml             # changesets/action@v1 Version PR + publish
├── .gitignore                      # + node_modules, dist, .turbo, coverage, pnpm-store
├── .nvmrc                          # 22
├── .editorconfig
├── .gitattributes
├── LICENSE
├── README.md                       # monorepo overview (root)
├── CLAUDE.md                       # project instructions (unchanged)
├── .planning/                      # unchanged
├── .loci/                          # consumer artifact — stays at repo root
└── packages/
    ├── xci/
    │   ├── package.json            # bin.xci, size-limit field, deps, scripts
    │   ├── tsup.config.ts
    │   ├── vitest.config.ts
    │   ├── tsconfig.json           # extends ../../tsconfig.base.json
    │   ├── README.md               # v1 README verbatim — ships to npm
    │   ├── src/                    # moved wholesale from root src/
    │   └── dist/                   # generated by tsup
    ├── server/
    │   ├── package.json            # name: @xci/server, publishable
    │   └── src/index.ts            # export {};
    └── web/
        ├── package.json            # name: @xci/web, publishable
        └── src/index.ts            # export {};
```

### Pattern 1: pnpm Workspace Declaration

**What:** Root `pnpm-workspace.yaml` declares which directories pnpm treats as workspace packages. pnpm only looks at this file — not any package.json `workspaces` field.
**When to use:** Always, at Phase 6 root.
**Example:**
```yaml
# pnpm-workspace.yaml
# Source: https://pnpm.io/pnpm-workspace_yaml [CITED]
packages:
  - 'packages/*'
```

### Pattern 2: packageManager Field + corepack

**What:** Root `package.json` declares which pnpm version is authoritative. Local devs using corepack get that exact version; `pnpm/action-setup@v4` reads the same field in CI. Hash suffix is optional.
**When to use:** Once, in root `package.json`, committed to git.
**Example:**
```json
// Source: https://github.com/nodejs/corepack/blob/main/README.md [CITED]
{
  "packageManager": "pnpm@10.33.0"
}
```
(Planner may add `+sha256.<hash>` suffix for supply-chain integrity — optional per corepack spec; pin is already sufficient.)

### Pattern 3: turbo.json — 4 Tasks with Topological Ordering

**What:** `turbo.json` defines the four pipeline tasks and their dependency edges. `^build` means "build all upstream dependencies first" (topological). `$TURBO_DEFAULT$` sentinel restores Turbo's default input-hashing behavior when you need to add explicit exclusions.
**When to use:** Once, root-level, committed to git.
**Example:**
```jsonc
// Source: https://turborepo.dev/docs/reference/configuration [CITED]
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "dependsOn": []
    },
    "typecheck": {
      "dependsOn": []
    }
  }
}
```

**Dependency-order note (Success Criterion #4):** With `xci` having no internal workspace deps and `@xci/server` + `@xci/web` having no real code yet, topological order is flat — all three can build in parallel in Phase 6. Turbo logs each package's output with a package-name prefix; ordering is not strictly `xci → @xci/server → @xci/web` unless server/web explicitly declare `"dependencies": { "xci": "workspace:*" }` in their package.json (which they don't need to in Phase 6). The success criterion is satisfied if the command exits 0 and Turbo reports all 3 packages in its summary. Planner can future-proof by leaving `^build` in place; when Phase 9 TASK-02 wires `@xci/server` → `xci` as a workspace dep, ordering emerges automatically.

### Pattern 4: Changesets Fixed Versioning

**What:** `.changeset/config.json` with `fixed` array locks three packages to the same version number forever. When any one bumps, all three bump.
**When to use:** Once, committed; all future changesets automatically respect it.
**Example:**
```json
// Source: https://github.com/changesets/changesets/blob/main/docs/config-file-options.md [CITED]
{
  "$schema": "https://unpkg.com/@changesets/config@3/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [["xci", "@xci/server", "@xci/web"]],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

**`access` note:** Default is `"restricted"` (private). Scoped packages like `@xci/server` and `@xci/web` need `"access": "public"` to publish as public to npm. The unscoped `xci` package ignores this field. [CITED: https://pnpm.io/using-changesets — "For scoped packages like @xci/server, include the access flag"]

### Pattern 5: tsconfig.base.json Shared Config

**What:** Shared compiler options live in one file; each package's `tsconfig.json` extends it and only overrides `include`/`exclude`.
**When to use:** Once at root; inherited by `packages/xci/tsconfig.json` (server and web don't need tsconfigs in Phase 6 since D-03 defers them).
**Example:**
```jsonc
// Source: current tsconfig.json migrated to base (CLAUDE.md §Technology Stack)
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "types": ["node"]
  }
}

// packages/xci/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["dist", "node_modules"]
}
```

No `references` field (deferred per CONTEXT). `tsc --noEmit` on the root via turbo invokes each package's `typecheck` script which in turn runs `tsc --noEmit` in that package's directory.

### Pattern 6: Biome v2 Root Config + Path-Scoped Override

**What:** Root `biome.json` keeps today's shared rules; add an `overrides[]` entry that scopes `noRestrictedImports` to `packages/xci/src/**/*.ts` only. The field name is `includes` (plural) in Biome 2.4.11 schema — NOT `include`.
**When to use:** Once at root; no per-package `biome.json` in Phase 6 (deferred per CONTEXT).
**Example:**
```jsonc
// Source: https://biomejs.dev/reference/configuration/#overrides [CITED]
//         https://biomejs.dev/linter/rules/no-restricted-imports [CITED]
{
  "$schema": "https://biomejs.dev/schemas/2.4.12/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": {
    "includes": ["packages/**/src/**/*.ts", "packages/**/tsup.config.ts", "packages/**/vitest.config.ts"]
  },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "error" },
      "style": { "useImportType": "error", "noNonNullAssertion": "warn" },
      "correctness": { "noUnusedVariables": "error", "noUnusedImports": "error" }
    }
  },
  "javascript": {
    "formatter": { "quoteStyle": "single", "semicolons": "always", "trailingCommas": "all", "arrowParentheses": "always" }
  },
  "overrides": [
    {
      "includes": ["packages/xci/src/**/*.ts"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "ws": {
                    "message": "The xci CLI must not import 'ws'. Agent WebSocket lives in @xci/server or agent modules outside packages/xci/src. See Phase 6 CONTEXT D-16."
                  },
                  "reconnecting-websocket": {
                    "message": "The xci CLI must not import 'reconnecting-websocket'. Agent reconnect logic lives outside packages/xci/src. See Phase 6 CONTEXT D-16."
                  }
                }
              }
            }
          }
        }
      }
    }
  ]
}
```

**Rule category note:** `noRestrictedImports` lives under `lint.rules.style` in Biome 2.x [CITED: https://biomejs.dev/linter/rules/no-restricted-imports — "The rule is located in the `style` category, not nursery."]. The Context7-hosted docs snippet contradicts this and shows it under `correctness` in an overrides example — that snippet is outdated/wrong; the canonical docs page is authoritative.

**`patterns` vs `paths`:** `paths` blocks exact module specifiers (what we want: `'ws'`, `'reconnecting-websocket'`). `patterns` (since v2.2.0) uses gitignore-style matching for bulk groups. Phase 6 only needs `paths`.

### Pattern 7: tsup external (must NOT contradict noExternal)

See Pitfall 1 for the full analysis. The planner MUST remove `noExternal: [/.*/]` or adjust it so `ws` and `reconnecting-websocket` can actually be externalized. Since neither package is a declared dependency of `packages/xci/package.json` today (and must never be), the cleanest fix is:

```typescript
// Source: https://tsup.egoist.dev/ + tsup src/esbuild/external.ts [VERIFIED via source read]
// packages/xci/tsup.config.ts
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20.5',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  bundle: true,
  // Bundle everything EXCEPT explicit externals. The regex must not match 'ws' or
  // 'reconnecting-websocket'. See: Pitfall 1 — noExternal is evaluated BEFORE external.
  noExternal: [/^(?!ws$|reconnecting-websocket$).*/],
  external: ['ws', 'reconnecting-websocket'],
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  splitting: false,
  treeshake: true,
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __xci_createRequire } from 'node:module';\nconst require = __xci_createRequire(import.meta.url);",
  },
  define: {
    __XCI_VERSION__: JSON.stringify(pkg.version),
  },
  platform: 'node',
});
```

Alternative (simpler) — drop `noExternal` entirely; tsup's default is "bundle deps/peerDeps, externalize everything else":
```typescript
// ... no noExternal at all
external: ['ws', 'reconnecting-websocket'],
// tsup-default behavior: bundles packages/xci/package.json's "dependencies" (commander/execa/yaml),
// externalizes everything else. Since ws and reconnecting-websocket are NOT in dependencies,
// they'd be externalized by default even without the explicit external[] line.
// The explicit line stays for belt-and-suspenders + documentation intent.
```

The alternative is cleaner IF the planner verifies no `node:*` builtins leak when `noExternal` is removed (shouldn't — `platform: 'node'` externalizes builtins automatically). Planner must run a test build and verify `dist/cli.mjs` size is still ≈130 KB after the change; if it swells significantly, deps that rely on being bundled (currently all of commander/execa/yaml) are leaking.

### Anti-Patterns to Avoid

- **Adding `ws` to `packages/xci/package.json` `dependencies` or `devDependencies`** — even "just for types". Once it's a dep, tsup's default behavior stops externalizing it automatically; the grep gate might still catch it at build time, but the dep declaration itself is the anti-pattern the fence is built to prevent.
- **Writing a per-package `biome.json` in Phase 6** — deferred. All config lives at root with overrides.
- **Adding Turbo `inputs: [tsup.config.ts, tsconfig.json, ...]` entries manually** — `$TURBO_DEFAULT$` already hashes all tracked files in the package directory. Manual `inputs` opts out of default tracking and is a common source of "why didn't Turbo re-run?" bugs. [CITED: https://turborepo.dev/docs/reference/configuration — "specifying inputs opts out of all default inputs behavior"]
- **Using `pnpm publish` without `-r`** in the Changesets action `publish:` command — publishes only the package at CWD. Must be `pnpm publish -r --access=public` (or a `ci:publish` script that expands to it).
- **Committing `.turbo/` directories** — local cache, must be in root `.gitignore`.
- **Using Biome `overrides[].include` (singular)** — schema key is `includes` (plural) in 2.4.x. Biome will silently ignore unknown keys so the override won't fire.
- **Leaving `package-lock.json` in the same commit as `pnpm-lock.yaml`** — pnpm will warn; developers may still reach for npm out of habit. Clean-cut removal per D-06 is the policy.
- **Running hyperfine with < 10 runs or no warmup** — variance is too high on shared runners; `--runs 10 --warmup 3` is the minimum for a <300ms gate to be reliable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workspace package discovery | Custom globbing in root build script | `pnpm-workspace.yaml` | pnpm's native resolver handles nested workspaces, filters, and `workspace:*` protocol that a custom script would miss. |
| Task dependency graph + caching | Shell scripts that `cd` into each package | Turborepo `turbo.json` | Turbo's content-hash cache is far more precise than mtime-based shell logic; `^build` topological ordering is non-trivial to implement correctly. |
| Coordinated version bumps | Manually editing each package.json | Changesets `fixed` array | Changesets enforces the invariant "all three bump together"; a human-maintained script will drift. |
| Bundle-size CI gate | A custom `wc -c` check in ci.yml | `size-limit` | size-limit handles `gzip`/`brotli` toggles, PR-comment deltas vs base branch, and multi-file bundles out of the box. A shell check misses the comparison-to-base step that makes regressions visible in review. |
| Cold-start timing | `time node dist/cli.mjs` in shell | `hyperfine` | Hyperfine handles warmup runs (JIT settling), statistical outlier detection, and JSON export for assertion scripts. `time` gives you one noisy sample. |
| Import-path restriction | Pre-commit grep hook | Biome `noRestrictedImports` | Biome integrates with editor LSP (errors appear as you type), CI (standard `biome check` invocation), and the rest of the lint config (no duplicate tool to maintain). A grep hook fires only at commit time and misses editor-level feedback. |
| GitHub Action for publishing | Custom `pnpm publish` script with token env var | `changesets/action@v1` | The action owns the Version PR lifecycle, changelog generation, publish-on-merge atomicity, and npm dist-tag handling. Re-implementing any of this is wasted effort. |

**Key insight:** Phase 6 is defined entirely by tools that already do exactly what CONTEXT asks for. The only hand-rolled logic is the grep safety net in D-16b (deliberately simple — a regex on `dist/cli.mjs`) and the <300ms assertion script that parses hyperfine's JSON output. Everything else is configuration.

## Runtime State Inventory

Phase 6 is a rename/refactor/migration phase (moving `src/` under `packages/xci/src/` and converting npm→pnpm). Runtime state must be inventoried:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | None — loci is a local CLI with no persisted data store. `.loci/` config files stay where they are (consumer artifact, not part of xci's own source per CONTEXT `code_context`). | **None.** Verified by: file system inspection (`.loci/` stays at repo root, not moved). |
| **Live service config** | None — loci has no external service it reports to. CI runs entirely in GitHub Actions; no registered service name that would need renaming. | **None.** Verified by: no external service integration in v1.0. |
| **OS-registered state** | None — loci is installed via `npm i -g xci`, which places a symlink under npm's global prefix. That symlink is fully regenerated by a fresh `npm i -g xci` (or `pnpm add -g xci`) after publish. No OS task scheduler entries, no systemd units, no launchd plists. | **None.** Verified by: `loci init` (only writes to user project dir, not system); npm global install is self-contained. |
| **Secrets/env vars** | (a) `LOCI_MACHINE_CONFIG` env var — read by `src/config/`, used to locate machine-level config. Code edit: NONE (no rename planned). (b) `NPM_TOKEN` GitHub secret — new requirement for Changesets publish in Phase 6. (c) `GITHUB_TOKEN` — auto-provided by Actions, needed for changesets/action to open Version PR. | **Add:** `NPM_TOKEN` to repo secrets before the first Changesets action run (Phase 14, but the secret wiring is set up in Phase 6). **Confirm:** Actions permissions set to "read and write" for `contents` and `pull-requests` (changesets/action requires this to push the Version PR). No env var renames. |
| **Build artifacts / installed packages** | (a) `dist/cli.mjs` at current root — stale after move; path becomes `packages/xci/dist/cli.mjs`. (b) Any global npm install of `xci` from before the rename is already on `xci` (name unchanged per D-01 of Phase 5 and STATE.md quick task 260415-j2u). (c) `node_modules/` at current root — deleted and regenerated under pnpm's `node_modules/.pnpm` hoisting structure. (d) `package-lock.json` at root — DELETED per D-06, replaced by `pnpm-lock.yaml`. | **Code edit:** Update the smoke-check command in CI from `node dist/cli.mjs --version` to `node packages/xci/dist/cli.mjs --version`. **Verify:** Clean `dist/` and `node_modules/` before first `pnpm install` to avoid stale artifacts. **Don't fight pnpm's node_modules layout** — symlinks under `.pnpm/` are normal and required. |

**Canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?*

**Answer:** None that Phase 6 scope touches. The npm package name `xci` is unchanged (locked in Phase 5 D-01 and the current package.json). The binary command `xci` is unchanged. The `.loci/` config directory name is unchanged. No renames happen in Phase 6 — it is purely a layout reorganization plus tool migration. Post-migration, a user who had `npm i -g xci@1.x` installed still has a working binary; after `npm i -g xci@2.x` (Phase 14), they get the re-bundled CLI from the new path (`packages/xci/dist/cli.mjs`) transparently, because `package.json.bin.xci` still points at that path (relative to the published `xci` package, which is only the `packages/xci/` contents).

## Common Pitfalls

### Pitfall 1: tsup noExternal precedence swallows external

**What goes wrong:** Current `tsup.config.ts` has `noExternal: [/.*/]` (bundle everything). Adding `external: ['ws', 'reconnecting-websocket']` appears correct but does NOTHING — `noExternal` is checked FIRST in tsup's external plugin. If any code in the import graph imports `ws`, the `.*` regex matches it, and tsup bundles it in, defeating the entire D-16 fence.
**Why it happens:** tsup's `external.ts` plugin evaluates in this order: (1) tsconfig paths, (2) `noExternal` patterns (bundle normally), (3) `external` patterns (mark external), (4) node-modules fallback. `noExternal` returning early is by design — its purpose is to force-bundle packages that would otherwise be externalized by dep declaration. [VERIFIED: source read of `src/esbuild/external.ts` via raw.githubusercontent.com — "Respect explicit external/noExternal conditions" checked first; WebFetch summary of plugin]
**How to avoid:** Replace `noExternal: [/.*/]` with a regex that excludes the two WS packages (`[/^(?!ws$|reconnecting-websocket$).*/]`), OR drop `noExternal` entirely and rely on tsup's default (bundle `dependencies` + `peerDependencies`, externalize the rest). Since `ws` and `reconnecting-websocket` are NOT in `packages/xci/package.json` `dependencies` (and must never be — that's what the fence is for), either approach works. Keep the explicit `external: [...]` line for documentation intent even if it is redundant under the default.
**Warning signs:** `packages/xci/dist/cli.mjs` size jumps by ~70KB (size of `ws` + `reconnecting-websocket`) on any PR that touches the tsup config. The grep gate (D-16b) catches it — that's why the grep exists.

### Pitfall 2: Biome overrides using `include` instead of `includes`

**What goes wrong:** In Biome 2.4.x, `overrides[].include` is silently ignored — the schema expects `includes` (plural). The `noRestrictedImports` rule never fires on `packages/xci/src/**`; a developer can `import 'ws'` without a lint error.
**Why it happens:** Biome 1.x used `include` (singular); Biome 2.x migrated to `includes` (plural) to match the new global `files.includes` field. Docs-by-search are inconsistent — context7 snippets still show `include`, outdated blog posts reinforce the wrong key. Schema is authoritative: `https://biomejs.dev/schemas/2.4.11/schema.json` defines `OverridePattern.includes`. [VERIFIED: schema downloaded 2026-04-18]
**How to avoid:** Always use `"includes": [...]` in `overrides[]`. Validate with `pnpm biome check --config-path ./biome.json` against a file that should trigger the rule (e.g., a temporary `packages/xci/src/__probe.ts` with `import 'ws'`). If it doesn't error, your override key is wrong or your glob doesn't match.
**Warning signs:** `biome check .` in CI passes even when a test file imports `ws`. The grep gate (D-16b) also catches it — again, the three-layer fence is the whole point.

### Pitfall 3: Hyperfine variance on shared runners

**What goes wrong:** `hyperfine --runs 10 --warmup 3 'node packages/xci/dist/cli.mjs --version'` reports mean=287ms with max=420ms on one run, then mean=310ms on another — flaking the gate.
**Why it happens:** GitHub-hosted ubuntu-latest runners share physical hardware with other tenants; noisy-neighbor IO bursts distort a 300ms-budgeted measurement. 10 runs is the minimum for a tight budget; warmup 3 lets Node's JIT settle (first run of an ESM module ~80ms slower on cold cache).
**How to avoid:** The gate asserts on `mean` (not max). Variance on a 6-core Linux runner is typically 5-10% — so headroom is about 270ms mean target for a 300ms threshold to be reliably green. If the current 126.41 KB bundle consistently measures 200ms±20ms, the gate is safe. If it measures 275ms±25ms, the gate will flake — in that case, investigate the build (is tsup outputting multiple files? is `createRequire` shim expensive?) before raising the threshold. Do NOT raise the 300ms threshold — it's a product requirement.
**Warning signs:** Intermittent fence-gate red with no source change; hyperfine JSON showing `mean < 300ms` but `max > 350ms`. Capture the JSON artifact in CI for post-mortem.

### Pitfall 4: `changesets/action` needs specific workflow permissions

**What goes wrong:** First run of the release workflow fails with `permission denied` — the action can't push the Version PR or create the release.
**Why it happens:** GitHub Actions default permissions (repo settings) may be `contents: read` only. `changesets/action@v1` needs `contents: write` (to commit Version PR branch) AND `pull-requests: write` (to open the PR). Also, `GITHUB_TOKEN` env var must be passed explicitly — the action doesn't pick it up from the runner context alone.
**How to avoid:** Add `permissions: { contents: write, pull-requests: write }` at the workflow (or job) level. In repo settings → Actions → General → Workflow permissions, select "Read and write permissions" AND check "Allow GitHub Actions to create and approve pull requests" (separate toggle). Both env vars required: `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` AND `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}`.
**Warning signs:** On first push to main after merging Phase 6, the release workflow runs but never opens a Version PR (no changeset files yet is expected). When the first changeset lands, check that the PR appears. If not, inspect workflow logs for `GraphQL: Resource not accessible by integration` — that's the permissions error.

### Pitfall 5: `pnpm/action-setup` ordering with setup-node cache

**What goes wrong:** `cache: 'pnpm'` on `actions/setup-node@v4` fails with "pnpm not found" if setup-node runs before pnpm/action-setup.
**Why it happens:** setup-node's pnpm cache feature shells out to `pnpm store path` — if pnpm isn't installed yet, the step errors. Order matters: pnpm FIRST, then setup-node.
**How to avoid:** Always in this order in every workflow:
```yaml
- uses: actions/checkout@v4
- uses: pnpm/action-setup@v4        # installs pnpm from packageManager field
- uses: actions/setup-node@v4       # reads pnpm store path, sets up cache
  with:
    node-version: ${{ matrix.node }}
    cache: 'pnpm'
- run: pnpm install
```
**Warning signs:** CI logs show `Error: Unable to locate executable file: pnpm` in the setup-node step.

### Pitfall 6: Turbo caching test task with no outputs

**What goes wrong:** `turbo run test` caches the test task based on input hash. On a second run with unchanged source, turbo reports `>>> FULL TURBO (X/Y cached)` and skips actual test execution — fine for normal dev, but in CI you may want to ensure tests actually re-run.
**Why it happens:** Turbo's cache is content-addressed on declared `inputs` (defaults to all tracked files in the package dir). If nothing changed, nothing runs. This is the feature, not the bug.
**How to avoid:** In Phase 6, the cache is local only (`.turbo/` per package, gitignored), so CI never has a cache hit — every CI run starts cold. No action needed for Phase 6. If the planner later adds remote cache (deferred), set `"cache": false` on the `test` task only if truly needed; usually the cache-hit behavior is desired (fast re-runs).
**Warning signs:** Developer locally runs `turbo test`, sees FULL TURBO, thinks tests are broken. Teach team: `turbo test --force` bypasses cache.

### Pitfall 7: `pnpm -r publish` double-publishes or skips private

**What goes wrong:** `pnpm -r publish` iterates over ALL workspace packages, including root (even though `private: true`). Root is skipped automatically because of `private: true`, but if a dev accidentally omits `private: true` from root, publishing fails with "cannot publish over existing version" or worse, publishes an empty root package. Also, `@xci/server` and `@xci/web` in Phase 6 are publishable but have `src/index.ts` = `export {};` — they'd publish as empty packages.
**Why it happens:** pnpm respects `private: true` at package level. Changesets Version PR only bumps versions of packages that have a changeset; the `-r publish` command then publishes only packages whose local version exceeds the registry version.
**How to avoid:** Root `package.json` MUST have `"private": true` (D-12). For Phase 6, the first Changesets Version PR that goes through is NOT expected until Phase 14 — so in Phase 6 the release workflow exists but does nothing. If a planner or user accidentally runs `pnpm changeset` + merges a Version PR in Phase 6, `@xci/server@0.0.1` and `@xci/web@0.0.1` would publish as empty packages. **Mitigation:** keep `@xci/server` and `@xci/web` at `"version": "0.0.0-placeholder"` or add them to `.changeset/config.json` `ignore` array until Phase 14. Alternative: set `"private": true` on both stub packages in Phase 6, remove it in Phase 14. CONTEXT D-12's caveat acknowledges this — planner should pick ONE mitigation and document it.
**Warning signs:** `npm view @xci/server` shows a published empty package before Phase 14. That's a mistake — yank it if found.

### Pitfall 8: `changesets/action` version input vs publish input semantics

**What goes wrong:** Putting `pnpm changeset version` in the `publish:` input causes the action to try to publish BEFORE versions are bumped — npm rejects because versions match registry.
**Why it happens:** `version:` runs during the Version PR creation phase (optional; defaults to `changeset version`). `publish:` runs AFTER the Version PR is merged (required for publishing). They are different lifecycle hooks. [CITED: https://github.com/changesets/action — "`version:` handles changelog and version bumping, while `publish:` handles the actual package distribution step."]
**How to avoid:** In the action YAML:
```yaml
- uses: changesets/action@v1
  with:
    version: pnpm changeset version          # optional; default is fine
    publish: pnpm release                    # custom script: 'pnpm publish -r --access=public'
```
And `ci:publish` or `release` script in root `package.json`:
```json
{ "scripts": { "release": "pnpm publish -r --access=public" } }
```
**Warning signs:** Version PR merges cleanly but the publish step errors with "cannot publish over existing version 2.0.0".

## Code Examples

Verified patterns from official sources.

### Root `package.json` — Shape

```jsonc
// Source: composite of pnpm/changesets/turbo docs [CITED]
{
  "name": "xci-monorepo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.0",
  "engines": { "node": ">=20.5.0" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "format": "biome format --write .",
    "changeset": "changeset",
    "version": "changeset version",
    "release": "pnpm -r publish --access=public"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.12",
    "@changesets/cli": "2.31.0",
    "@size-limit/file": "12.1.0",
    "@types/node": "^22",
    "size-limit": "12.1.0",
    "tsup": "8.5.1",
    "turbo": "2.5.8",
    "typescript": "^5.9.0",
    "vitest": "4.1.4"
  }
}
```

### `packages/xci/package.json` — Shape

```jsonc
// Source: current root package.json, relocated with size-limit field added per D-15
{
  "name": "xci",
  "version": "0.0.0",
  "description": "Local CI — cross-platform command alias runner with layered YAML config",
  "type": "module",
  "license": "MIT",
  "engines": { "node": ">=20.5.0" },
  "bin": { "xci": "./dist/cli.mjs" },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsup",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "smoke": "node dist/cli.mjs --version",
    "size-limit": "size-limit",
    "prepublishOnly": "pnpm build"
  },
  "dependencies": {
    "commander": "14.0.3",
    "execa": "9.6.1",
    "yaml": "2.8.3"
  },
  "size-limit": [
    {
      "name": "cli bundle",
      "path": "dist/cli.mjs",
      "limit": "200 KB",
      "gzip": false,
      "brotli": false
    }
  ]
}
```

**Note on `size-limit` field:** package.json field is the idiomatic location for a single-package config (vs separate `.size-limit.cjs`). Both `gzip: false` and `brotli: false` must be set explicitly — `gzip: false` alone still falls back to brotli on some size-limit versions. `@size-limit/file` is auto-selected when `path` is a pre-built file; no explicit plugin list needed. [CITED: https://github.com/ai/size-limit — CLI bundle config pattern]

### `packages/server/package.json` and `packages/web/package.json` — Stubs

```jsonc
// Source: CONTEXT D-01 + Turborepo internal-package minimum [CITED: https://turborepo.dev/docs/crafting-your-repository/creating-an-internal-package]
// packages/server/package.json
{
  "name": "@xci/server",
  "version": "0.0.0",
  "private": true,                         // see Pitfall 7 — temporarily private in Phase 6
  "type": "module",
  "scripts": {
    "build": "echo '@xci/server Phase 6 stub — build is a noop'",
    "test": "echo '@xci/server Phase 6 stub — no tests yet'",
    "lint": "echo '@xci/server Phase 6 stub — no lint yet'",
    "typecheck": "echo '@xci/server Phase 6 stub — no typecheck yet'"
  }
}

// packages/server/src/index.ts
// Phase 6 placeholder — real implementation lands in Phase 9+.
export {};
```

Identical shape for `@xci/web` with `name: "@xci/web"`.

**Planner choice:** CONTEXT D-12 says stubs are "technically publishable" but in Phase 6 they should not publish. Two options:
1. `"private": true` in Phase 6; remove it in Phase 14 when real code lands. (Recommended — prevents accidental empty publish.)
2. Keep `"private": false` and add both to `.changeset/config.json` `"ignore"` array until Phase 14.

Option 1 is simpler and matches the "nothing publishes in Phase 6" intent. Document the flip in Phase 14.

### `pnpm-workspace.yaml`

```yaml
# Source: https://pnpm.io/pnpm-workspace_yaml [CITED]
packages:
  - 'packages/*'
```

### `turbo.json`

```jsonc
// Source: https://turborepo.dev/docs/reference/configuration [CITED]
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "dependsOn": []
    },
    "typecheck": {
      "dependsOn": []
    }
  }
}
```

### `.changeset/config.json`

```json
// Source: https://github.com/changesets/changesets/blob/main/docs/config-file-options.md [CITED]
{
  "$schema": "https://unpkg.com/@changesets/config@3/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [["xci", "@xci/server", "@xci/web"]],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### GitHub Actions — `ci.yml` (rewritten)

```yaml
# Source: composite of https://pnpm.io/using-changesets + turbo docs + hyperfine Ubuntu availability [CITED]
name: CI

on:
  push: { branches: [main] }
  pull_request: { types: [opened, synchronize, reopened, ready_for_review] }
  workflow_dispatch:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-test-lint:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4        # reads packageManager field — no version: input

      - name: Setup Node.js ${{ matrix.node }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck + Lint + Build + Test (turbo pipeline)
        run: pnpm turbo run typecheck lint build test

      - name: Smoke check — xci --version
        run: node packages/xci/dist/cli.mjs --version

  fence-gates:
    # Runs in parallel with build-test-lint — it's also Linux + Node 22 so it redoes build locally.
    # Alternative: 'needs: build-test-lint' to run sequentially, but parallel catches issues faster.
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build xci
        run: pnpm --filter xci build

      - name: Bundle-size gate (D-15)
        run: pnpm --filter xci size-limit

      - name: WS-exclusion grep gate (D-16b)
        run: |
          if grep -E "(reconnecting-websocket|['\"]ws['\"])" packages/xci/dist/cli.mjs; then
            echo "::error::Found ws/reconnecting-websocket in dist/cli.mjs — fence broken!"
            exit 1
          fi

      - name: Install hyperfine
        run: sudo apt-get update && sudo apt-get install -y hyperfine

      - name: Cold-start gate (D-17) — xci --version < 300ms
        run: |
          hyperfine --runs 10 --warmup 3 \
            --export-json hyperfine.json \
            'node packages/xci/dist/cli.mjs --version'
          node -e "
            const r = require('./hyperfine.json');
            const meanMs = r.results[0].mean * 1000;
            console.log('Mean cold-start:', meanMs.toFixed(1) + 'ms');
            if (meanMs >= 300) {
              console.error('FAIL: mean ' + meanMs.toFixed(1) + 'ms >= 300ms budget');
              process.exit(1);
            }
            console.log('PASS: under 300ms budget');
          "

      - name: Upload hyperfine JSON artifact (for post-mortem)
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: hyperfine-results
          path: hyperfine.json
```

**CI Job DAG (planner note):** CONTEXT's "matrix-build → matrix-test → linux-fence-gates → smoke" ordering can be flattened in Phase 6 — with Turbo, `typecheck lint build test` runs in ONE step per matrix job. The `smoke` check is a post-build node invocation also in the same job. Fence gates run as a separate job (parallel to the matrix) on ubuntu-latest only. Branch protection marks BOTH jobs (6 matrix runs + 1 fence job = 7 required checks) as required for merge.

**Alternative:** If the planner wants to avoid double-building on Linux, use `matrix.include` to extend the ubuntu-latest + Node 22 matrix job with an `if:` condition for the fence steps. Downside: harder to read, single point of failure. Recommended: keep them as separate jobs (the ~40s redundant build on Linux is acceptable for clarity).

### GitHub Actions — `release.yml` (new)

```yaml
# Source: https://github.com/changesets/action README + pnpm/using-changesets [CITED]
name: Release

on:
  push: { branches: [main] }

concurrency: ${{ github.workflow }}-${{ github.ref }}

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0         # changesets needs full history for changelog

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build (required before publish)
        run: pnpm turbo run build

      - name: Create Release Pull Request or Publish
        uses: changesets/action@v1
        with:
          version: pnpm changeset version
          publish: pnpm release     # defined in root package.json: 'pnpm -r publish --access=public'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### `.gitignore` additions

```gitignore
# Existing
node_modules/
coverage/
*.log
.DS_Store
.vscode/
.idea/
# Project-specific
.loci/secrets.yml
.loci/local.yml

# Phase 6 additions
dist/                  # each package's dist (was just `dist` at root before)
.turbo/                # Turbo local cache per package
packages/*/dist/
packages/*/.turbo/
packages/*/coverage/
pnpm-store/            # if pnpm store isn't at default global location
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| npm workspaces | pnpm workspaces | Standardized in JS ecosystem ~2023; strict dep isolation now table stakes | Catches phantom deps (important for Phase 8 when agent code lands and deps get messy) |
| Lerna / Rush | Turborepo | Turbo v2 (2024) added type-aware task graph + SQLite cache; Lerna in maintenance mode since 2022 | Lower config overhead, faster hot builds, first-class pnpm integration |
| semantic-release | Changesets (for monorepos) | Vercel adoption ~2022, now de-facto for fixed/linked versioning | Explicit changeset files survive git rewrites and amend operations better than commit-message parsing |
| bundlesize (2018) | size-limit | size-limit adds PR-comment deltas, JS assertion API, multi-entry support | Bundlesize unmaintained since 2020; size-limit is active (v12.1.0 released Apr 2026) |
| Biome v1 `overrides[].include` | Biome v2 `overrides[].includes` (plural) | Biome 2.0 release (June 2025) | Breaking config change — see Pitfall 2 |
| eslint + prettier (per-package configs) | Single-file Biome (root only) | Biome v2 matured with type-aware lint | 127+ npm packages → 1 Rust binary; 20-25x format speed |

**Deprecated/outdated:**
- **Lerna** — maintained but not actively developed. Don't adopt new; existing Lerna repos should migrate to Turbo/Nx.
- **`npm publish` + Conventional Commits + semantic-release** — still valid for single-package repos, but heavyweight for our 3-package monorepo with fixed versioning.
- **Biome `overrides.include` (singular)** — works in 1.x, ignored in 2.x.
- **`pnpm/action-setup@v2` with explicit `version: 8`** — still works but v4+ with packageManager field is the idiomatic choice.

## Assumptions Log

> Every claim in this research was either verified against a live source (npm, schema files, source code read) or cited with a URL. The following items carry residual uncertainty worth flagging.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pnpm 10.33.0 is the right version to pin for Phase 6 (CONTEXT D-07 says "latest v9" but v10 is current stable). | Standard Stack | Low — if the user wants v9, pin `pnpm@9.15.x` instead; v9 is still maintained. The exact major doesn't affect the workflow shape. Planner must confirm with user. |
| A2 | `@xci/server` and `@xci/web` should be `"private": true` in Phase 6 to prevent accidental empty publish (Pitfall 7 recommendation). Context D-12's caveat acknowledges the gap but doesn't prescribe. | Pitfall 7, stub package.json | Medium — if the user prefers option 2 (`.changeset/config.json` `ignore` array), the stubs need `private: false` from day one. Planner should surface this choice. |
| A3 | The 292 test `it()` calls I counted correspond to the "202 tests" stated in BC-02. The requirement number likely dates from earlier measurements. | Phase Requirements table | Low — BC-02's intent is "v1 test suite passes green", not a literal count. Planner should not hard-code 202 as a gate. |
| A4 | tsup's default behavior (no `noExternal` set) externalizes only `dependencies` + `peerDependencies`, so `ws` is NOT bundled as long as it's not declared. | Pattern 7, Pitfall 1 | Low — verified via tsup source read + docs; but if `packages/xci/package.json` accidentally adds `ws` as a dep, this assumption flips. Grep gate (D-16b) catches it. |
| A5 | Apt's `hyperfine` package on ubuntu-latest (currently Ubuntu 24.04 Noble) is 1.18.0 — older than the latest 1.20.0 but feature-compatible for our use (--runs, --warmup, --export-json all present in 1.12+). | Standard Stack, CI workflow | Negligible — hyperfine's CLI is very stable; 1.12+ has everything we need. |
| A6 | Changesets `access: "public"` at the config level correctly applies to scoped packages `@xci/server` / `@xci/web` and is a no-op for the unscoped `xci` package. | .changeset/config.json | Low — confirmed by pnpm docs; planner can also add `--access=public` to the `pnpm -r publish` command as belt-and-suspenders. |

**If any assumption proves wrong during execution:** the 3-layer fence (tsup external + grep + Biome rule) catches the most dangerous failure modes (ws leaks into bundle). Version pin mistakes surface as CI failures before merge. No assumption is load-bearing enough to block the plan.

## Open Questions (RESOLVED)

Both items below were resolved with the user during the plan-phase workflow on 2026-04-18. Resolutions are locked in CONTEXT.md.

1. **pnpm major version: 9.x or 10.x?** — **RESOLVED: 10.33.0** per CONTEXT.md D-07 (amended 2026-04-18). v10 has been stable since Jan 2025; `packageManager: "pnpm@10.33.0"` is pinned in root `package.json` per Plan 06-02.
2. **Stub packages `private: true` or `ignore: [...]`?** — **RESOLVED: `private: true`** per CONTEXT.md D-12 (amended 2026-04-18). `@xci/server` and `@xci/web` are `private: true` in Phase 6 and flip to `private: false` when they get real code (Phase 9 for server, Phase 13 for web).

## Environment Availability

> External tool/runtime dependencies for Phase 6.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js ≥20.5.0 | All packages | ✓ (CI matrix: 20 + 22; local: .nvmrc → 22) | 22 (LTS) | — |
| pnpm 10.33.x | Root + workspace | ✓ (via corepack locally; via pnpm/action-setup@v4 in CI) | 10.33.0 | npm workspaces (would require full redesign — not a fallback, a different plan) |
| Turborepo 2.5.x | Root devDep | ✓ (npm available) | 2.5.8 | Hand-rolled shell orchestration (explicitly rejected in Don't-Hand-Roll) |
| @changesets/cli 2.31.x | Root devDep | ✓ | 2.31.0 | Manual version bumping (anti-pattern) |
| size-limit 12.1.x + @size-limit/file | xci devDep | ✓ | 12.1.0 | Custom `wc -c` in CI (loses PR-comment feature) |
| hyperfine | CI fence-gates job | ✓ (apt on ubuntu-latest) | 1.18.0-2build1 (Ubuntu 24.04 noble) | Manual `time node ...` loop (much noisier, not recommended) |
| Rust toolchain | Not required | n/a | — | (Only needed if we fall back to `cargo install hyperfine`, which we won't) |
| NPM_TOKEN secret | release workflow (changesets/action) | ✗ (must be added to repo secrets before Phase 14 runs publish) | — | N/A — Phase 6 workflow runs without it but publish step would fail if triggered |
| GITHUB_TOKEN | release workflow | ✓ (auto-provided by Actions) | — | — |
| Ubuntu 24.04 ubuntu-latest runner | CI | ✓ (GitHub default) | 24.04 Noble | Would need Ubuntu 22.04 apt fallback for hyperfine (1.12.0 also works) |

**Missing dependencies with no fallback:**
- `NPM_TOKEN` must be added to GitHub repo secrets before Phase 14 needs it. Phase 6 can proceed without (release workflow runs but the publish step is never reached — no changesets yet). Planner should add a task "Document NPM_TOKEN setup requirement in README" as a reminder.

**Missing dependencies with fallback:**
- None — all tools are available.

## Sources

### Primary (HIGH confidence)

- [pnpm 10.33.0 version — npm registry](https://www.npmjs.com/package/pnpm) — verified via `npm view pnpm version` on 2026-04-18
- [turbo 2.5.8 version — npm registry](https://www.npmjs.com/package/turbo) — verified via `npm view turbo version` on 2026-04-18
- [@changesets/cli 2.31.0 — npm registry](https://www.npmjs.com/package/@changesets/cli) — verified via `npm view` on 2026-04-18
- [size-limit 12.1.0 — npm registry](https://www.npmjs.com/package/size-limit) — verified via `npm view` on 2026-04-18
- [Biome 2.4.11 JSON schema — raw file](https://biomejs.dev/schemas/2.4.11/schema.json) — downloaded and inspected; confirms `overrides[].includes` (plural) key and `OverridePattern` definition
- [tsup external plugin source](https://raw.githubusercontent.com/egoist/tsup/main/src/esbuild/external.ts) — source read via WebFetch; confirms `noExternal` evaluated before `external`
- [Turborepo configuration reference](https://turborepo.dev/docs/reference/configuration) — `$schema`, `tasks`, `dependsOn: ["^build"]`, `$TURBO_DEFAULT$` sentinel
- [pnpm workspace config](https://pnpm.io/pnpm-workspace_yaml) — `packages: [...]` shape
- [pnpm filtering](https://pnpm.io/filtering) — `pnpm --filter <name>` and `pnpm --filter "@scope/*"` semantics
- [pnpm using Changesets](https://pnpm.io/using-changesets) — full Changesets workflow YAML for pnpm monorepo
- [Changesets config options](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md) — fixed, access, baseBranch defaults
- [changesets/action README](https://github.com/changesets/action) — version: vs publish: input semantics, required permissions
- [pnpm/action-setup](https://github.com/pnpm/action-setup) — v4 reads packageManager field, v5 available but optional
- [Node.js Corepack README](https://github.com/nodejs/corepack#readme) — packageManager field format, hash optional
- [Biome noRestrictedImports rule docs](https://biomejs.dev/linter/rules/no-restricted-imports) — category = style, `patterns` available since v2.2.0
- [Biome overrides reference](https://biomejs.dev/reference/configuration/#overrides) — `includes` (plural) confirmed
- [Ubuntu packages — hyperfine](https://packages.ubuntu.com/search?keywords=hyperfine) — 1.18.0 in Noble universe, 1.12.0 in Jammy universe
- [size-limit GitHub README](https://github.com/ai/size-limit) — `@size-limit/file` for pre-bundled CLIs, `brotli: false` for raw bytes
- [andresz1/size-limit-action README](https://github.com/andresz1/size-limit-action) — PR comment action, `pull-requests: write` permission
- [hyperfine releases](https://github.com/sharkdp/hyperfine/releases) — latest 1.20.0, installation methods
- [Current `.planning/phases/06-monorepo-setup-backward-compat-fence/06-CONTEXT.md`](../06-CONTEXT.md) — D-01 through D-19 locked decisions
- [Current `.planning/STATE.md`](../../STATE.md) — Phase 01-05 accumulated decisions, stack lock, tsup baseline 126.41 KB
- [Current `.planning/REQUIREMENTS.md`](../../REQUIREMENTS.md) — BC-01..04, PKG-01..03, plus v1.0 preserved set
- [Current `CLAUDE.md`](../../../CLAUDE.md) — Technology Stack, Cold-Start Budget, Version Compatibility

### Secondary (MEDIUM confidence)

- [Complete Monorepo Guide: pnpm + Changesets (2025)](https://jsdev.space/complete-monorepo-guide/) — cross-verified patterns match official docs
- [pnpm/changesets tutorial playground](https://github.com/lund0n/pnpm-changesets-tutorial) — real-world workflow matches what pnpm.io publishes

### Tertiary (LOW confidence)

- Context7 Biome docs snippet showing `noRestrictedImports` under `correctness` in an overrides example — **contradicted by official Biome docs** (rule is under `style`). Treated as outdated — the canonical docs page wins.

## Metadata

**Confidence breakdown:**
- **Standard Stack (versions, tool choices):** HIGH — all versions verified against npm registry on 2026-04-18; no training-data guesses.
- **Architecture patterns (turbo.json, pnpm-workspace.yaml, .changeset/config.json):** HIGH — shapes taken directly from official docs and cross-verified with pnpm.io's recommended workflow.
- **Pitfalls:** HIGH for Pitfall 1 (tsup precedence — verified via source read) and Pitfall 2 (Biome `includes` — verified against schema file). MEDIUM for Pitfall 3 (hyperfine variance — based on GH runner behavior reports, not direct measurement on this repo).
- **Code examples:** HIGH — composite of verified doc patterns; planner should still test end-to-end.
- **Runtime State Inventory:** HIGH — loci has no external state surface; comprehensive inventory trivial and verified.

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (30 days) — stack versions may bump patch/minor but shape is stable. Re-verify versions only if planning slips past mid-May.
