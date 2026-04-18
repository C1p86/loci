---
phase: 06-monorepo-setup-backward-compat-fence
plan: 03
subsystem: monorepo-tooling
tags: [pnpm, turborepo, changesets, workspace, lockfile, clean-cut]
requires:
  - "Plan 06-02 monorepo skeleton (packages/xci, @xci/server, @xci/web)"
  - "Root package.json with packageManager: pnpm@10.33.0 (set by Plan 06-02)"
provides:
  - "pnpm workspace declaration (packages/*) -- root pnpm-workspace.yaml"
  - "Turborepo 2.5.8 pipeline config (4 tasks: build, test, lint, typecheck)"
  - "Changesets 2.31.0 fixed-versioning config (xci + @xci/server + @xci/web locked together)"
  - "Single root pnpm-lock.yaml (npm package-lock.json removed per D-06 clean-cut)"
  - "Root biome.json scoped to packages/** paths"
affects:
  - "Plan 06-04 (tsup fence): needs turbo.json tasks defined + pnpm workspaces for --filter xci"
  - "Plan 06-05 (CI gates): needs pnpm + turbo orchestration wired"
  - "Plan 06-06 (Changesets release workflow): needs .changeset/config.json in place"
tech-stack:
  added:
    - "turborepo@2.5.8 (task runner, local cache only per D-10)"
    - "@changesets/cli@2.31.0 (versioning/publish in fixed mode per D-11)"
    - "pnpm-lock.yaml (lockfileVersion 9.0)"
  patterns:
    - "pnpm workspaces via pnpm-workspace.yaml packages: [packages/*]"
    - "turbo.json v2 shape: tasks key (NOT v1 pipeline key)"
    - "Changesets fixed-versioning: 2D array [[pkg1, pkg2, pkg3]]"
    - "Clean-cut migration: delete npm lockfile + generate pnpm lockfile in same commit (D-06)"
key-files:
  created:
    - pnpm-workspace.yaml
    - turbo.json
    - .changeset/config.json
    - .changeset/README.md
    - pnpm-lock.yaml
  modified:
    - biome.json (files.includes paths scoped to packages/**)
  deleted:
    - package-lock.json (npm artifact, obsolete per D-06 clean-cut)
    - dist/cli.mjs (stale root build output, new location is packages/xci/dist/)
decisions:
  - "Used corepack-activated pnpm 10.33.0 (matches packageManager field); installed to $HOME/.local/bin (corepack --install-directory) since system /usr/bin requires root"
  - "Clean-cut commit (D-06): package-lock.json deleted AND pnpm-lock.yaml added in the SAME commit -- no intermediate broken state"
  - "turbo.json has NO inputs field anywhere (avoids RESEARCH.md §Anti-Patterns pitfall: manual inputs opts out of default tracking)"
  - "turbo.json has NO cache field (defaults to true for all tasks; local cache only per D-10)"
  - "Changesets ignore: [] left empty -- @xci/server and @xci/web stubs rely on their package.json private: true flag to prevent empty publishes (Pitfall 7 option 1)"
  - "biome.json paths updated to packages/**/src/**/*.ts etc. but noRestrictedImports rule NOT added -- that fence layer lands in Plan 06-04"
metrics:
  duration: "3m 16s"
  completed: "2026-04-18T16:20:48Z"
  tasks_completed: 3
  commits: 3
  files_created: 5
  files_modified: 1
  files_deleted: 2
  lockfile_lines: 2745
  packages_resolved: 210
---

# Phase 6 Plan 3: Monorepo Tooling Wiring (pnpm + Turborepo + Changesets) Summary

Wired the monorepo tooling layer on top of the skeleton from Plan 06-02: pnpm workspace declaration, Turborepo 2.5.8 pipeline with 4 tasks, Changesets fixed-versioning config, and atomic clean-cut migration from npm to pnpm (D-06). The repo now supports `pnpm turbo run build|test|lint|typecheck` across all three packages, with correct topological dependency ordering (`^build`) and same-package `test-after-build` edges.

## What Shipped

### Task 1: Monorepo tooling config files (commit `71b171e`)

Created four new config files at repo root:

- **`pnpm-workspace.yaml`** — 2 lines: `packages: ['packages/*']`. pnpm discovers all three workspace packages (`xci`, `@xci/server`, `@xci/web`) via this single glob.
- **`turbo.json`** — v2 schema (`tasks:` key, NOT v1 `pipeline:`). Declares 4 tasks:
  - `build`: `dependsOn: ["^build"]`, `outputs: ["dist/**"]` (topological ordering prepares for Phase 9 when `@xci/server` will declare `xci` as a workspace dep)
  - `test`: `dependsOn: ["build"]`, `outputs: ["coverage/**"]` (same-package ordering; E2E tests need `dist/cli.mjs`)
  - `lint`: `dependsOn: []` (parallel)
  - `typecheck`: `dependsOn: []` (parallel)
  - No `inputs` field anywhere (default input tracking per RESEARCH.md Anti-Pattern note)
  - No `cache` field (defaults to `true` per task; local cache only per D-10)
- **`.changeset/config.json`** — Fixed-versioning locks all three packages:
  - `"fixed": [["xci", "@xci/server", "@xci/web"]]` (2D array shape per RESEARCH.md §Pattern 4)
  - `"access": "public"` (belt-and-suspenders for scoped packages, release script also passes `--access=public`)
  - `"baseBranch": "main"`, `"commit": false`, `"changelog": "@changesets/cli/changelog"`, `"ignore": []`
- **`.changeset/README.md`** — Workflow documentation covering `pnpm changeset`, the Version PR flow, and the Phase 6 caveat that `@xci/server` and `@xci/web` are `private: true` stubs (flip to `false` in Phase 9/13 respectively, same commit as real code per D-12).

### Task 2: Clean-cut npm -> pnpm migration (commit `ce47c53`)

Executed D-06 atomically in a single commit:

- Deleted `package-lock.json` (npm artifact, no longer used)
- Generated `pnpm-lock.yaml` via `pnpm install`
  - **210 packages resolved**, 216 downloaded on cold cache
  - Lockfile: 2745 lines, `lockfileVersion: '9.0'`
  - All 4 workspace projects visible in importers section (root + `packages/xci` + `packages/server` + `packages/web`)
  - Install completed in 14.2s cold
- Verified `pnpm install --frozen-lockfile` (CI parity) passes: "Already up to date" in 1.2s
- Verified `pnpm --version` prints `10.33.0` (matches `packageManager` field via corepack)

**No intermediate broken state:** both lockfile changes staged and committed in the same `git commit` so the tree never existed in a state where neither lockfile was present.

### Task 3: Turbo dry-run verification (part of commit `ce47c53` — verification only)

All 4 task dry-runs pass:

| Task      | Exit | Packages seen                      | Notes                                    |
| --------- | ---- | ---------------------------------- | ---------------------------------------- |
| build     | 0    | `xci`, `@xci/server`, `@xci/web`   | No topological edges yet (stubs have no deps) |
| test      | 0    | Same + `build` listed as dependent | `xci#test` -> `[xci#build]` verified in JSON |
| lint      | 0    | All 3                              | Parallel                                 |
| typecheck | 0    | All 3                              | Parallel                                 |

JSON confirmation: `pnpm turbo run test --dry-run=json` shows `xci#test` has `dependencies: ["xci#build"]` — the `dependsOn: ["build"]` edge resolves correctly.

### Housekeeping cleanup (commit `086e4b4`)

- Removed stale tracked `dist/cli.mjs` (776KB dev build from pre-restructure era). New output path is `packages/xci/dist/cli.mjs` (gitignored via `dist/` rule in `.gitignore`, set up in Plan 06-02).
- Updated root `biome.json` `files.includes` paths:
  - Before: `["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"]` (v1 paths, no longer match anything at root)
  - After: `["packages/**/src/**/*.ts", "packages/**/tsup.config.ts", "packages/**/vitest.config.ts"]`
  - Linter rules **unchanged** — `noRestrictedImports` fence (D-16c) lands in Plan 06-04.

## Acceptance Criteria Verification

All plan success criteria met:

- [x] `pnpm-workspace.yaml` contains `packages: ['packages/*']`
- [x] `turbo.json` has 4 tasks with correct `dependsOn` edges (build: `^build`, test: `build`, lint: `[]`, typecheck: `[]`)
- [x] `.changeset/config.json` has `"fixed": [["xci", "@xci/server", "@xci/web"]]`
- [x] `pnpm-lock.yaml` exists; `package-lock.json` is absent
- [x] `pnpm install --frozen-lockfile` exits 0 with "Already up to date"
- [x] `pnpm --version` outputs `10.33.0`
- [x] `pnpm turbo run build --dry-run` exits 0 and the task graph includes all 3 packages
- [x] `pnpm turbo run test --dry-run=json` shows `xci#test` depending on `xci#build`

## Environment Notes

- **pnpm install location:** The system-provided corepack could not symlink into `/usr/bin/pnpm` without root privileges. Workaround: `corepack enable --install-directory $HOME/.local/bin` — pnpm 10.33.0 activated via user-local PATH. CI runs with `pnpm/action-setup@v4` (Plan 06-05) so no local-PATH dependency in the CI pipeline itself.
- **Ignored build scripts warning:** pnpm 10.33.0 flagged `esbuild@0.27.7` as having build scripts that were skipped. This is pnpm's default safety behavior (approve-builds opt-in). Not blocking — esbuild works fine without postinstall in our tsup workflow. Plan 06-04 or 06-05 may want to address via `pnpm approve-builds` or `onlyBuiltDependencies` in `pnpm-workspace.yaml` if esbuild binary resolution issues surface.

## Deviations from Plan

### Rule 2 / Rule 3 — Housekeeping cleanup (additive to plan scope)

The plan's constraints explicitly called for removing stale `dist/cli.mjs` (tracked pre-restructure) and scoping `biome.json` paths to packages — these were not in the numbered task list (Tasks 1-3) but listed as constraints. I executed them as a separate housekeeping commit (`086e4b4`) to keep the Task 1/2 commits minimal and focused.

- **Found during:** Task 3 post-verification review of plan constraints
- **Issue:** (a) `dist/cli.mjs` was tracked in git despite `.gitignore` containing `dist/` — stale from pre-Plan-06-02 era; (b) `biome.json` `files.includes` still referenced v1-only paths that match nothing after the monorepo restructure.
- **Fix:** `git rm dist/cli.mjs` + update `biome.json` paths to `packages/**/...`; no linter rule changes (noRestrictedImports deferred to Plan 06-04 per constraint).
- **Files modified:** `biome.json`, `dist/cli.mjs` (deleted)
- **Commit:** `086e4b4`

No other deviations. The three numbered tasks executed exactly as written.

## Threat Model Mitigations (from plan `<threat_model>`)

- **T-06-11 (supply-chain, mitigate):** devDeps pinned in root package.json; `pnpm install --frozen-lockfile` verified in Task 2 Step 2.6 -- no drift.
- **T-06-12 (pnpm version drift, mitigate):** `packageManager: pnpm@10.33.0` honored locally via corepack; Task 2 Step 2.1 asserted `pnpm --version` output.
- **T-06-13 (workspace discovery, mitigate):** `pnpm -r list` shows all 4 workspace projects; Task 2 Step 2.4 verified.
- **T-06-14 (clean-cut, mitigate):** `test ! -f package-lock.json` asserted; atomic single-commit migration.
- **T-06-15 (accidental stub publish, mitigate):** `packages/server/package.json` and `packages/web/package.json` both have `"private": true` (verified during initial reads). Changesets `ignore: []` is left empty because the private-flag already prevents publish per Pitfall 7 option 1.
- **T-06-16 (elevation of privilege, accept):** Phase 14 concern, documented in `.changeset/README.md`.

## Commits

| Task  | Commit    | Message                                                                                          |
| ----- | --------- | ------------------------------------------------------------------------------------------------ |
| 1     | `71b171e` | `feat(06-03): add pnpm-workspace.yaml, turbo.json, and Changesets config`                        |
| 2     | `ce47c53` | `feat(06-03): clean-cut npm -> pnpm migration (delete package-lock.json, add pnpm-lock.yaml)` |
| chore | `086e4b4` | `chore(06-03): remove stale root dist/ and scope root biome.json to packages/`                   |

## Next Plan

**06-04:** Apply the ws-exclusion fence to `packages/xci/tsup.config.ts` (`external: ['ws', 'reconnecting-websocket']`) and add the Biome `noRestrictedImports` override targeting `packages/xci/src/**`. Also wires the post-build grep gate (D-16b) and the size-limit script invocation. This plan's Turbo config is what lets `pnpm --filter xci build` work in Plan 06-04.

## Self-Check: PASSED

All files created and all commits verified.

- `pnpm-workspace.yaml`: FOUND
- `turbo.json`: FOUND
- `.changeset/config.json`: FOUND
- `.changeset/README.md`: FOUND
- `pnpm-lock.yaml`: FOUND
- `package-lock.json`: ABSENT (as expected per D-06)
- `dist/cli.mjs`: ABSENT (as expected)
- Commit `71b171e`: FOUND
- Commit `ce47c53`: FOUND
- Commit `086e4b4`: FOUND
