---
phase: 06-monorepo-setup-backward-compat-fence
plan: 02
subsystem: monorepo-restructure
tags: [monorepo, pnpm, packages, tsconfig-split, stubs, file-layout]
requires:
  - "06-01 npm scope @xci verified AVAILABLE"
  - "v1 xci codebase intact at root (src/, tsup.config.ts, vitest.config.ts, tsconfig.json, README.md, TestProject/)"
provides:
  - "packages/xci/ with full v1 codebase migrated byte-identically"
  - "packages/server/ + packages/web/ as private stubs with @xci/* names"
  - "Root package.json as private workspace manifest (pnpm@10.33.0 pinned)"
  - "tsconfig.base.json with shared compilerOptions"
  - "Root README.md as monorepo overview"
  - ".gitignore extended for per-package dist/, .turbo/, coverage/"
affects:
  - "Root package.json converted from single package to workspace manifest"
  - "Root README.md replaced (v1 content now at packages/xci/README.md)"
  - "Old root src/, TestProject/, tsup.config.ts, vitest.config.ts, tsconfig.json removed"
tech-stack:
  added:
    - "turbo@2.5.8 (devDep, root)"
    - "@changesets/cli@2.31.0 (devDep, root)"
    - "size-limit@12.1.0 (devDep, root)"
    - "@size-limit/file@12.1.0 (devDep, root)"
  patterns:
    - "pnpm workspaces layout (packages/* not yet activated — pnpm-workspace.yaml arrives in Plan 06-03)"
    - "tsconfig extends pattern: packages/xci/tsconfig.json extends ../../tsconfig.base.json"
    - "Private stub packages pattern (export {}; ESM module + noop scripts for turbo tasks)"
  bumped:
    - "@biomejs/biome 2.4.11 -> 2.4.12 (RESEARCH.md Standard Stack)"
key-files:
  created:
    - "packages/xci/package.json"
    - "packages/xci/tsconfig.json"
    - "packages/xci/tsup.config.ts (copy)"
    - "packages/xci/vitest.config.ts (copy)"
    - "packages/xci/README.md (copy)"
    - "packages/xci/LICENSE (copy)"
    - "packages/xci/src/** (54 files, byte-identical copy)"
    - "packages/xci/TestProject/** (7 files)"
    - "packages/server/package.json"
    - "packages/server/src/index.ts"
    - "packages/web/package.json"
    - "packages/web/src/index.ts"
    - "tsconfig.base.json"
  modified:
    - "package.json (root — replaced with monorepo manifest)"
    - "README.md (root — replaced with monorepo overview)"
    - ".gitignore (appended Phase 6 monorepo additions)"
  deleted:
    - "src/ (14 subdirs, moved to packages/xci/src/)"
    - "TestProject/ (moved to packages/xci/TestProject/)"
    - "tsup.config.ts (moved to packages/xci/tsup.config.ts)"
    - "vitest.config.ts (moved to packages/xci/vitest.config.ts)"
    - "tsconfig.json (compilerOptions lifted to tsconfig.base.json; include/exclude moved to packages/xci/tsconfig.json)"
decisions:
  - "Preserved pre-existing .gitignore entries verbatim (.xci/secrets.yml, .xci/local.yml, .claude/worktrees/) — do NOT overwrite with plan's stale .loci/ paths (project already migrated per STATE.md commit 3f37119)"
  - "Root dist/cli.mjs (v1 build artifact, tracked) NOT removed — plan explicitly defers ('will be deleted naturally; the build output no longer targets root after Plan 03')"
  - "package-lock.json preserved at root — deletion is Plan 06-03's responsibility per D-06 clean-cut"
  - "tsup.config.ts unchanged — ws-fence (external: ['ws', 'reconnecting-websocket']) deferred to Plan 06-04"
  - "biome.json unchanged at root — noRestrictedImports rule deferred to Plan 06-04"
metrics:
  duration: "4m48s"
  completed: "2026-04-18T16:13:10Z"
  tasks_completed: 4
  files_created: 70
  files_modified: 3
  files_deleted: 52
  commits: 4
---

# Phase 6 Plan 02: Monorepo Restructure (Mechanical Move) Summary

Mechanical restructure of the repo from a single-package layout to a three-package monorepo skeleton. Moved v1 xci codebase under `packages/xci/` byte-identically, created `packages/server/` + `packages/web/` as private stubs, split the root tsconfig into base + per-package, and replaced the root README with a monorepo overview. File layout is now monorepo-shaped; pnpm/turbo/changesets tooling activation is Plan 06-03's job.

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| 1 | Migrate v1 xci codebase into packages/xci/ with unchanged content | `9c78efe` |
| 2 | Create root workspace package.json + tsconfig.base.json + monorepo README | `4afc2dd` |
| 3 | Create @xci/server and @xci/web stub packages | `a79f8fe` |
| 4 | Remove old root-level files + update .gitignore | `0b70c64` |

## Byte-Identity Confirmations (BC-01 contract)

All of the following `diff` commands returned empty output before Task 4 deleted the originals (verified during Task 1 Step 1.10):

```
diff -r src packages/xci/src             # empty
diff tsup.config.ts packages/xci/tsup.config.ts           # empty
diff vitest.config.ts packages/xci/vitest.config.ts       # empty
diff README.md packages/xci/README.md                     # empty
diff -r TestProject packages/xci/TestProject              # empty
```

- `packages/xci/tsup.config.ts` banner preserved byte-for-byte:
  `#!/usr/bin/env node\nimport { createRequire as __xci_createRequire } from 'node:module';\nconst require = __xci_createRequire(import.meta.url);`
- `packages/xci/src/**` contains the same 54 files as v1 `src/**` — all `.js` suffix imports, all `export {};`-style ESM, `src/__tests__/` structure intact.
- `packages/xci/tsup.config.ts` still has `noExternal: [/.*/]` (ws-fence changes arrive in Plan 06-04; NOT this plan).

## Packages Created

| Package | Path | name | private | Notes |
|---------|------|------|---------|-------|
| xci | `packages/xci/` | `xci` | false (publishable) | Full v1 migration: src/, TestProject/, tsup.config.ts, vitest.config.ts, tsconfig.json (extends), package.json (with size-limit 200 KB config), README.md, LICENSE |
| server | `packages/server/` | `@xci/server` | **true** (D-12 amended) | `package.json` with noop scripts for build/test/lint/typecheck; `src/index.ts` = `export {};` |
| web | `packages/web/` | `@xci/web` | **true** (D-12 amended) | Same shape as server |

`packages/xci/package.json` declares NO cross-deps on `@xci/server` or `@xci/web` (Shared Pattern 6 tree-shaking discipline).

## Files Deleted From Root

| Path | Reason | New home |
|------|--------|----------|
| `src/` (14 subdirs, 54 files) | Migrated to packages/xci/ | `packages/xci/src/` |
| `TestProject/` | Migrated with xci | `packages/xci/TestProject/` |
| `tsup.config.ts` | Build config is per-package | `packages/xci/tsup.config.ts` |
| `vitest.config.ts` | Test config is per-package | `packages/xci/vitest.config.ts` |
| `tsconfig.json` | Split | `tsconfig.base.json` (compilerOptions) + `packages/xci/tsconfig.json` (extends/include/exclude) |

Preserved at root (per plan + CONTEXT §canonical_refs):
- `LICENSE` (repo-level license visibility; also copied to `packages/xci/LICENSE`)
- `biome.json` (stays at root; modified in Plan 06-04)
- `.github/workflows/ci.yml` (rewritten in Plan 06-05)
- `.nvmrc`, `.editorconfig`, `.gitattributes`
- `.xci/` directory (consumer artifact)
- `package-lock.json` (deletion is Plan 06-03's responsibility per D-06 clean-cut)
- `dist/cli.mjs` (v1 build artifact; naturally superseded by Plan 06-03 build output)

## Root Manifest Shape (what is now in `package.json`)

```jsonc
{
  "name": "xci-monorepo",
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

Biome bumped 2.4.11 → 2.4.12 (RESEARCH.md Standard Stack). New devDeps (turbo, @changesets/cli, size-limit, @size-limit/file) pinned exact per supply-chain mitigation T-06-08.

## tsconfig Split

`tsconfig.base.json` (new, root) holds the full `compilerOptions` block (verbatimModuleSyntax, moduleResolution:bundler, strict, noUncheckedIndexedAccess, etc. — 18 options). No `include`/`exclude`/`references` keys.

`packages/xci/tsconfig.json` keeps only `extends` + `include` + `exclude`:

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["dist", "node_modules"]
}
```

## .gitignore Update

Preserved the existing 10 entries (including `.xci/secrets.yml`, `.xci/local.yml` — not `.loci/` as the plan expected; the project already migrated loci→xci per STATE.md commit 3f37119, which is why I did not overwrite with the plan's stale path spec). Appended:

```gitignore
# Phase 6 monorepo additions
dist/
.turbo/
packages/*/dist/
packages/*/.turbo/
packages/*/coverage/
```

## Deviations from Plan

### Deviation 1 [Rule 3 - state mismatch] Preserved `.xci/` paths in .gitignore instead of plan's `.loci/` paths

- **Found during:** Task 4 Step 4.2
- **Issue:** The plan specified appending additions to a `.gitignore` whose expected content used `.loci/secrets.yml` / `.loci/local.yml`. The actual worktree `.gitignore` uses `.xci/secrets.yml` / `.xci/local.yml` (the project was migrated loci→xci in commit `3f37119` — STATE.md confirms), and additionally contains `.claude/worktrees/` which the plan's expected baseline did not show.
- **Fix:** Preserved the current live `.gitignore` content verbatim and only appended the Phase 6 monorepo additions as specified. Did NOT overwrite `.xci` with `.loci`.
- **Files modified:** `.gitignore`
- **Commit:** `0b70c64`
- **Rule:** Rule 3 (blocking state mismatch between plan expectation and reality — use reality).

### Deviation 2 [Rule 3 - Deferred by plan] Root `dist/cli.mjs` left tracked

- **Found during:** Task 4 Step 4.1
- **Issue:** Root `dist/cli.mjs` is tracked (v1 build output). The Phase 6 `.gitignore` now includes `dist/`, but that doesn't un-track files already in git.
- **Fix:** Left unchanged. The plan explicitly states this file "will be deleted naturally; the build output no longer targets root after Plan 03". Not my task to act on.
- **Files modified:** none
- **Rule:** Rule 3 (blocking → defer per plan's explicit guidance).

## Known Stubs

`packages/server/src/index.ts` and `packages/web/src/index.ts` are intentional stubs (single `export {};` line each). Per D-01 / D-12, real code lands in:
- `@xci/server`: Phase 9+
- `@xci/web`: Phase 13+

Both packages have `"private": true` so they will NOT be published empty in Phase 6 (T-06-07 mitigation).

## Deferred Issues (Out-of-Scope, Pre-existing)

### v1 typecheck warnings (pre-existing, NOT caused by migration)

Running `tsc --noEmit -p packages/xci/tsconfig.json` surfaces multiple strict-mode errors (TS2345, TS18048, TS2339, TS2532, TS2379, TS2322, TS2375, TS2769). Verified identical behavior against the pristine v1 source at commit `418fb60` using the v1 toolchain — these are pre-existing type-strictness warnings in v1 source (cli.ts, config/index.ts, executor/capture.ts, etc.) that v1 never cleaned up. They are NOT caused by the migration (BC-01 byte-identity contract holds).

**Not my task to fix.** Logged here for visibility; if Phase 6 requires green typecheck for BC-02, it should be addressed in a v1-cleanup plan outside Phase 6 scope.

## Threat Flags

No new security-relevant surface introduced. All file moves are mechanical. Stubs are `private: true` per the threat register mitigation for T-06-07.

## Next Steps

**Plan 06-03** wires the monorepo tooling on top of this skeleton:
- Create `pnpm-workspace.yaml`
- Create `turbo.json` (4 tasks: build, test, lint, typecheck)
- Create `.changeset/config.json` with fixed-versioning `[["xci", "@xci/server", "@xci/web"]]`
- Delete `package-lock.json` atomically with `pnpm install` → generates `pnpm-lock.yaml`
- Verify `pnpm turbo run build test lint typecheck` works across all 3 packages

**Plan 06-04** applies the hard fence:
- `packages/xci/tsup.config.ts` external/noExternal ws-fence
- `biome.json` adds `noRestrictedImports` override for `packages/xci/src/**` blocking `ws` and `reconnecting-websocket`

## Self-Check: PASSED

Commit hashes verified present in git log:
- `9c78efe` FOUND
- `4afc2dd` FOUND
- `a79f8fe` FOUND
- `0b70c64` FOUND

Files verified via orchestrator acceptance checks (all 13 checks passed):
- `packages/xci/src/` FOUND
- `packages/server/package.json` + `private:true` + `name:@xci/server` FOUND
- `packages/web/package.json` + `private:true` + `name:@xci/web` FOUND
- `package.json` contains `packageManager pnpm@10.33.0` FOUND
- `tsconfig.base.json` FOUND
- `packages/xci/tsconfig.json` contains `extends: ../../tsconfig.base.json` FOUND
- `packages/xci/tsup.config.ts` FOUND (no ws-fence yet — correct)
- `packages/xci/vitest.config.ts` FOUND
- `packages/xci/package.json` contains `name:xci` + bin xci FOUND
- Old `src/cli.ts` MISSING (correctly deleted)
- `biome.json` exists without `noRestrictedImports` (correctly unchanged)
- `package-lock.json` STILL PRESENT at root (correct — Plan 06-03's job)
