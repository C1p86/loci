# Phase 6: Monorepo Setup & Backward-Compat Fence - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers four things, in this order:

1. **Monorepo restructure** — move current root code to `packages/xci/`, create empty-but-tracked `packages/server/` and `packages/web/` as private placeholders with minimal `package.json`.
2. **pnpm + Turborepo + Changesets wiring** — clean-cut migration from npm to pnpm, Turbo pipeline for build/test/lint/typecheck, Changesets in fixed-versioning mode with GitHub Action publish flow.
3. **CI fence gates activated** — bundle-size (<200KB via size-limit), `ws`/`reconnecting-websocket` exclusion (3 layers: tsup external + grep + Biome rule), cold-start (<300ms via hyperfine on Linux), all as required checks on every PR to `main`.
4. **v1 test suite (202 tests) passes green** inside `packages/xci/` with no regressions; `xci --version` smoke-checks on all OSes.

This phase does NOT deliver:
- Any agent-mode code (`--agent` flag, WebSocket, reconnecting-websocket usage — explicitly fenced out)
- Any `@xci/server` or `@xci/web` application code (just placeholder dirs)
- Docker, Postgres, auth, or anything else downstream in v2.0

**Hard fence rule:** no task in Phase 6 may import `ws` or `reconnecting-websocket` anywhere in `packages/xci/src/`. The CI gates must be GREEN before Phase 7 begins.

</domain>

<decisions>
## Implementation Decisions

### Package Skeleton (Phase 6 scope)
- **D-01:** Create three package directories: `packages/xci/` (full migration of current `src/`, tests, tsup/biome/vitest config), `packages/server/`, `packages/web/`. Server and web dirs get ONLY a minimal `package.json` (`name`, `version`, `private: true` initially — see D-11) and an empty `src/index.ts` stub. No build scripts, no tsconfig. They exist so Turbo and Changesets track them from day one.
- **D-02:** Root of monorepo contains: `package.json` (workspaces + turbo + changesets scripts, `"private": true`), `pnpm-workspace.yaml`, `turbo.json`, `biome.json` (shared config — extended from root by each package if they need overrides), `.changeset/config.json`, `tsconfig.base.json`, `README.md` (monorepo overview), `LICENSE`, `.nvmrc`, `.editorconfig`, `.gitignore`, `.gitattributes`, `.github/workflows/`.
- **D-03:** Each package has its own `tsconfig.json` extending `tsconfig.base.json`. Each has its own `vitest.config.ts` and `tsup.config.ts` where relevant. `packages/server/` and `packages/web/` skip tsup/vitest until Phase 7+.
- **D-04:** README split: root `README.md` is a monorepo overview (what is xci, what are the 3 packages, how to clone+install+test). `packages/xci/README.md` IS the current v1 README — verbatim — because that's what ships to npm as the `xci` package readme.
- **D-05:** CLI entry path: `packages/xci/dist/cli.mjs`. `packages/xci/package.json` `bin.xci` points to `./dist/cli.mjs` (relative to the package). The bundle-size CI gate checks this exact path.

### Package Manager Migration (npm → pnpm)
- **D-06:** Clean cut: delete `package-lock.json` in the same commit that introduces `pnpm-workspace.yaml` and runs `pnpm install` to generate `pnpm-lock.yaml`. No parallel npm branch, no fallback. v1.0 code is already shipped and tagged; anyone needing v1 toolchain checks out the v1 tag.
- **D-07:** pnpm version pinned via `packageManager` field in root `package.json` (`"packageManager": "pnpm@<latest-v9>"`). CI uses `pnpm/action-setup@v4` without an explicit `version:` — it reads from `packageManager` so local and CI stay in lockstep. Corepack enforces locally.
- **D-08:** `.nvmrc` stays pointing at Node 22 (current LTS). Engines floor in all package.jsons remains `>=20.5.0` (keeps execa 9 compat; matches CLAUDE.md §Technology Stack). CI matrix already covers both 20 and 22.

### Turborepo Pipeline
- **D-09:** `turbo.json` defines 4 tasks: `build`, `test`, `lint`, `typecheck`. Dependency graph: `build` depends on `^build` (upstream packages built first); `test` depends on `build` (tests may need built artifacts); `lint` and `typecheck` have no deps. No `dev` / `clean` / `format` tasks in Phase 6 — added later as needed.
- **D-10:** Turbo cache is **local only** in Phase 6 (`.turbo/` in each package, gitignored). No remote cache (Vercel/Turbo cloud) set up. Can be added in a later phase when build times justify it.

### Changesets & Versioning
- **D-11:** Fixed versioning: `.changeset/config.json` declares `"fixed": [["xci", "@xci/server", "@xci/web"]]`. All three packages always release at the same version (e.g., `2.0.0` → `2.0.1` → `2.1.0`). Narrative for users: "xci@2.0.0 is compatible with @xci/server@2.0.0, always".
- **D-12:** Root `package.json` is `"private": true`. `xci`, `@xci/server`, `@xci/web` are all publishable (not private). **Caveat (D-11 vs D-12):** In Phase 6, `@xci/server` and `@xci/web` have empty `src/index.ts` stubs — they are technically publishable but nothing is called from them yet. First real publish happens in Phase 14; Phase 6 just wires the machinery.
- **D-13:** Publish flow: `changesets/action@v1` GitHub Action on main branch. On merge, action creates/updates a "Version PR" with the pending bumps; when that PR is merged, action runs `pnpm -r publish` with `NPM_TOKEN` secret. Manual local publish is explicitly NOT the flow.
- **D-14:** npm scope `@xci` — availability NOT yet verified. Phase 6 must include an early task: `npm view @xci/server` + `npm view @xci/web` (expect 404 = available). If taken, fallback to `@xcihq` or similar — treat as a blocking pre-flight. Planner: add a `verify-npm-scope` task before any `@xci/*` package is committed with that name.

### CI Fence Gates (the hard stop before Phase 7)

All gates are **required status checks** on every PR targeting `main`. No path filtering on the required-check declaration — every PR runs them. Branch protection on `main` enforces "all required checks must pass before merge".

- **D-15:** **Bundle-size gate**: `size-limit` with config in `packages/xci/package.json`. Rule: `packages/xci/dist/cli.mjs` ≤ 200 KB (gzip: false — we measure the raw ESM bundle because that's what Node reads at cold-start). CI step: `pnpm --filter xci build && pnpm --filter xci size-limit`. Comments on PRs with delta vs base branch (size-limit handles this via its action).
- **D-16:** **`ws` / `reconnecting-websocket` exclusion** — belt-and-suspenders, all three layers required:
  - **(a) Build-time:** `packages/xci/tsup.config.ts` declares `external: ['ws', 'reconnecting-websocket']` on the CLI entry. If anything in the import graph references them, tsup leaves them as runtime requires — which would crash cold-start, making regressions loud.
  - **(b) Test-time grep:** CI step after build: `grep -E "(reconnecting-websocket|['\"]ws['\"])" packages/xci/dist/cli.mjs` must return non-zero exit (no matches). Catches the case where tsup's `external` config is accidentally removed.
  - **(c) Lint-time:** Biome `noRestrictedImports` rule in `packages/xci/biome.json` (or inherited from root with path scope) blocks `import … from 'ws'` and `import … from 'reconnecting-websocket'` inside `packages/xci/src/**`. First line of defense — fails before the dev even pushes.
- **D-17:** **Cold-start gate**: `hyperfine --runs 10 --warmup 3 'node packages/xci/dist/cli.mjs --version'` on Linux runner (ubuntu-latest) only. Mean must be < 300ms. Windows/macOS skip this gate (variance on shared runners is too high to gate on). The requirement (BC-04) applies to all OSes but the *automated gate* is Linux-only; the others are manually verified per-release via hyperfine locally.
- **D-18:** **v1 test suite gate**: `pnpm --filter xci test` runs all 202 v1 tests. Matrix: 3 OS (ubuntu, windows, macos) × Node [20, 22] = 6 jobs. fail-fast: false (as today). Every one of the 6 must pass for merge.
- **D-19:** **Smoke check**: `node packages/xci/dist/cli.mjs --version` on all 6 matrix jobs after build. Same as today, just new path.

### Claude's Discretion
- Exact `size-limit` config format (package.json `size-limit` field vs separate `.size-limit.cjs`) — planner picks.
- Biome `noRestrictedImports` exact rule syntax and path scoping — planner picks.
- tsconfig.base.json fields (`strict`, `moduleResolution`, etc.) — keep current Phase 1 values, move them up to base.
- `.changeset/config.json` defaults beyond `fixed` (changelog generator, access, base branch) — planner picks standard defaults.
- Hyperfine install step in CI (apt package vs `cargo install` vs prebuilt binary) — planner picks.
- Exact pnpm version pin value (latest stable v9 at planning time).
- README structure for root monorepo overview — planner drafts, we review.
- Shape of `packages/server/src/index.ts` and `packages/web/src/index.ts` stubs (e.g., a single `export {};` line so they are valid ESM modules).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Backward Compatibility (BC-01 through BC-04) — fence success criteria
- `.planning/REQUIREMENTS.md` §Packaging & Distribution (PKG-01, PKG-02, PKG-03) — pnpm + Turborepo + Changesets scope for Phase 6
- `.planning/REQUIREMENTS.md` §v1.0 Validated Requirements — FND-01..06, CFG-01..10, CMD-01..09, INT-01..05, EXE-01..07, CLI-01..09, INIT-01..06, DOC-01..05 must all still pass unchanged

### Roadmap
- `.planning/ROADMAP.md` §Phase 6 — goal, depends-on, 5 success criteria (`pnpm --filter xci test` green, bundle <200KB, ws-exclusion, `turbo run build` ordering, cold-start <300ms)
- `.planning/ROADMAP.md` §Phase 6 Canonical refs — v2.0 Roadmap decisions relevant here: (a) `ws` and `reconnecting-websocket` are external[] in cli.ts tsup entry; (b) bundle-size CI gate fails at >200KB

### Project Instructions
- `CLAUDE.md` §Technology Stack — stack versions locked (TypeScript 5.9, commander 14.0.3, execa 9.6.1, yaml 2.8.3, tsup 8.5.1, vitest 4.1.4, biome 2.x), Node engines floor `>=20.5.0`
- `CLAUDE.md` §Cold-Start Budget — <300ms cold start, bundle everything with tsup, measure with hyperfine
- `CLAUDE.md` §Version Compatibility — confirms execa 9.6.1 floor of `^18.19.0 || >=20.5.0`
- `CLAUDE.md` §GSD Workflow Enforcement — all file changes via GSD commands

### Prior Phase Context (decisions that carry forward)
- `.planning/phases/01-foundation/01-CONTEXT.md` — FND-01..06 acceptance; Node floor, CI matrix shape
- `.planning/phases/05-init-distribution/05-CONTEXT.md` §D-01 — npm package name is `xci` (binary command stays `loci`… note: updated to `xci` in quick-260415-j2u, see .planning/STATE.md commit `3f37119`). `@xci/server` and `@xci/web` are the other two.
- `.planning/STATE.md` — accumulated decisions (stack lock, tsup bundle 126.41 KB baseline, CI matrix, ESM-only strategy, @xci scope for new packages per v2.0 roadmap)

### Current State Files (must be migrated, not re-derived)
- `package.json` — current single-package config; splits into root + `packages/xci/package.json` + `packages/server/package.json` + `packages/web/package.json`
- `tsup.config.ts` — moves to `packages/xci/tsup.config.ts`; add `external: ['ws', 'reconnecting-websocket']` to entry options
- `biome.json` — becomes the root `biome.json`; add `noRestrictedImports` rule with path scope for `packages/xci/src/**`
- `vitest.config.ts` — moves to `packages/xci/vitest.config.ts`
- `tsconfig.json` — current config splits into `tsconfig.base.json` (root, shared) + `packages/xci/tsconfig.json` (extends base, package-specific includes)
- `.github/workflows/ci.yml` — must be rewritten to: install pnpm, `pnpm install`, run `pnpm turbo run typecheck lint build test` across matrix, then run fence gates (size-limit, grep, hyperfine) on Linux-only job, then smoke check on all 6
- `src/` — moves wholesale to `packages/xci/src/`
- `.loci/` directory in root — keep where it is (it's a consumer artifact of xci, not part of xci's own source)
- `TestProject/` — evaluate; likely moves to `packages/xci/TestProject/` or stays as repo-level integration target

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (carry through the migration unchanged)
- `src/cli.ts` — commander v14 entry point, shebang comes from tsup banner not source
- `src/errors.ts` — LociError hierarchy (11 concrete subclasses, Phase 1 P03 established)
- `src/config/`, `src/commands/`, `src/resolver/`, `src/executor/`, `src/init/`, `src/template/`, `src/tui/`, `src/version.ts`, `src/types.ts` — all module dirs move as-is
- `src/__tests__/` — E2E tests using `process.execPath` (Phase 1 P03 pattern); imports use `.js` suffix per ESM/verbatimModuleSyntax
- `dist/cli.mjs` — built output; target 126.41 KB (v1 baseline per STATE.md) — current observed 775 KB suggests a dev/unminified build, planner should verify fresh build

### Established Patterns (respected by Phase 6)
- ESM-only, bundled single-file CLI via tsup with `noExternal: [/.*/]` — Phase 6 changes this ONLY for `ws` and `reconnecting-websocket` (added to `external` list). `noExternal: [/.*/]` stays in effect for everything else.
- Shebang injected via tsup banner as literal line 1, with `createRequire` polyfill (Phase 1 P02 decision)
- Test files use `.js` suffix imports (`moduleResolution: bundler` + `verbatimModuleSyntax`)
- Feature-folder stubs that throw `NotImplementedError` are NOT imported by cli.ts (tree-shaking discipline) — Phase 6 keeps this rule for server/web stubs: the `xci` package must not import from `@xci/server` or `@xci/web`
- CI concurrency.group cancels stacked runs on same ref — preserve in new CI config

### Integration Points (where new wiring connects)
- Root `package.json` "scripts" → Turbo commands (`pnpm build` runs `turbo run build`, etc.)
- GitHub Actions workflow → pnpm setup action → Turbo orchestration → fence gate jobs
- Changesets action → npm publish (new — not present in v1 CI)
- size-limit config block → package.json of `xci` (new — not present in v1 CI)

### Creative Options / Constraints the Architecture Enables
- With Turbo's `^build` dependency, we can have `@xci/server` depend on `xci` (for the shared YAML parser — Phase 9 TASK-02) with zero additional wiring. Phase 6's Turbo config enables this for free.
- pnpm's strict peer dependency resolution will catch any accidental phantom dep leak when we start adding agent code in Phase 8. Worth noting but not exercised in Phase 6.

</code_context>

<specifics>
## Specific Ideas

- **Bundle-size number is the line in the sand**: 200 KB is from the roadmap (current bundle 126.41 KB per STATE.md; ~74 KB headroom). The `ws` library is ~60 KB and `reconnecting-websocket` is ~10 KB — if either leaked in, they'd eat most of the headroom. That's why the exclusion is fenced at 3 layers, not one.
- **Hyperfine on Linux only** — the roadmap success criterion says "verified under 300ms on Linux CI". We mirror that literally. Windows and macOS cold-start performance is a release-engineering concern, not a per-PR gate.
- **No agent code, no exceptions** — if the planner is tempted to pre-scaffold `src/agent/` in `packages/xci/` in Phase 6, that's out of scope. Agent-mode code starts in Phase 8 (ATOK / AGENT requirements). Phase 6 only ensures the fence is up.
- **The 775 KB observed dist**: likely a dev build or pre-bundled artifact from recent quick tasks. Planner must start from `rm -rf dist && pnpm --filter xci build` to verify the real baseline before setting size-limit threshold. If 200 KB is accidentally too tight for current code, we confirm with a fresh build first — we do NOT raise the number.

</specifics>

<deferred>
## Deferred Ideas

- **Remote Turbo cache (Vercel/Turbo cloud)** — deferred; local cache sufficient until build times justify it. Revisit in v2.1+ if monorepo grows.
- **`dev` / `clean` / `format` Turbo tasks** — deferred to Phase 13 (web dashboard dev) and whenever the need arises.
- **Bundle-size regression reporting beyond size-limit defaults** — deferred; size-limit's built-in PR comment is enough for Phase 6.
- **TypeScript project references (`references` field in tsconfigs)** — deferred; use simple `tsconfig.base.json` inheritance for now. Revisit if incremental build performance becomes a pain point.
- **Separate `biome.json` per package** — deferred; root-level shared config is sufficient. Packages can extend later if they need per-package rule overrides.
- **v1-legacy branch for npm/v1 hotfixes** — deferred; v1 is tagged, anyone needing v1 toolchain checks out the tag.
- **Automated cold-start gate on Windows/macOS** — deferred; Linux-only in Phase 6 (per D-17), full cross-OS gating revisited later.
- **Monorepo README marketing polish** — deferred; functional overview only in Phase 6, copy polish later.

</deferred>

---

*Phase: 06-monorepo-setup-backward-compat-fence*
*Context gathered: 2026-04-18*
