---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Local CLI
status: executing
stopped_at: Completed 07-05-PLAN.md
last_updated: "2026-04-18T19:09:23.815Z"
last_activity: 2026-04-18
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 28
  completed_plans: 24
  percent: 86
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16)

**Core value:** Un alias → sempre lo stesso comando eseguito correttamente, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.
**Current focus:** Phase 7 — Database Schema & Auth

## Current Position

Phase: 7 (Database Schema & Auth) — EXECUTING
Plan: 6 of 9
Status: Ready to execute
Last activity: 2026-04-18

Progress (Phase 06): [██████████] 100%
Progress (v2.0 milestone): [█░░░░░░░░░] 11% (1/9 phases)

## Performance Metrics

**Velocity:**

- Total plans completed: 12 (v1.0)
- Average duration: —
- Total execution time: 0 hours (v2.0)

**By Phase (v1.0 complete):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4 | - | - |
| 02 | 1 | - | - |
| 03 | 2 | - | - |
| 04 | 2 | - | - |
| 05 | 3 | - | - |

**By Phase (v2.0 — not started):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 06 | TBD | - | - |
| 07 | TBD | - | - |
| 08 | TBD | - | - |
| 09 | TBD | - | - |
| 10 | TBD | - | - |
| 11 | TBD | - | - |
| 12 | TBD | - | - |
| 13 | TBD | - | - |
| 14 | TBD | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 4m | 3 tasks | 16 files |
| Phase 01 P02 | 5m | 3 tasks | 9 files |
| Phase 01-foundation P03 | 4m | 2 tasks | 3 files |
| Phase 01-foundation P04 | 2m | 1 tasks | 1 files |
| Phase 02-config-system P01 | 6m | 3 tasks | 2 files |
| Phase 03 P01 | 3m | 2 tasks | 6 files |
| Phase 03 P02 | 4m | 2 tasks | 5 files |
| Phase 04-executor-cli P01 | 20m | 2 tasks | 13 files |
| Phase 04-executor-cli P02 | 5m | 2 tasks | 2 files |
| Phase 04-executor-cli P03 | 2m | 2 tasks | 2 files |
| Phase 05-init-distribution P01 | 3m | 2 tasks | 4 files |
| Phase 05-init-distribution P02 | 1m | 1 tasks | 1 files |
| Phase 05-init-distribution P03 | 1m | 1 tasks | 2 files |
| Phase 05-init-distribution P03 | 1 | 2 tasks | 2 files |
| Phase 07-database-schema-auth P01 | 15 | 3 tasks | 14 files |
| Phase 07 P02 | 10 | 3 tasks | 12 files |
| Phase 07-database-schema-auth P03 | 15m | 3 tasks | 16 files |
| Phase 07-database-schema-auth P04 | 7m | 3 tasks | 17 files |
| Phase 07 P05 | 573 | 3 tasks | 10 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Stack locked: TypeScript 5.x, commander.js v14 (not v15), `yaml` 2.x (not js-yaml), execa 9.x, tsup, vitest, biome
- Phase 4 flagged for targeted research before planning: execa v9 AbortController/cancelSignal pattern for parallel kill-on-failure; commander v14 passThroughOptions + dynamic registration edge cases
- [Phase 01]: TypeScript locked to ^5.9.0 (resolved 5.9.3); RESEARCH.md's ^6.0.2 overridden per CLAUDE.md §Technology Stack
- [Phase 01]: Runtime deps exact-pinned (commander=14.0.3, execa=9.6.1, yaml=2.8.3) for cold-start budget reproducibility
- [Phase 01]: [Phase 01 P02]: tsup banner extended with createRequire polyfill — bundling CJS commander into ESM needs a working require() at runtime; shebang stays on line 1
- [Phase 01]: [Phase 01 P02]: ShellInjectionError discards its value parameter (void value) — secrets-safe error precedent for Phases 2-5
- [Phase 01]: [Phase 01 P02]: Feature-folder stubs throw NotImplementedError and are NOT imported by cli.ts — tree-shaking keeps stub strings out of dist/cli.mjs (126.41 KB stable)
- [Phase 01-foundation]: [Phase 01 P03]: Tests import from '../errors.js' / '../types.js' with .js suffix (moduleResolution: bundler + verbatimModuleSyntax requires it)
- [Phase 01-foundation]: [Phase 01 P03]: E2E tests use process.execPath (not 'node') — avoids Windows PATH shadowing; spawnSync with encoding utf8 keeps Windows from deadlocking
- [Phase 01-foundation]: [Phase 01 P03]: oneOfEachConcrete() factory in errors.test.ts is the single source of truth for the 11 concrete LociError subclasses — prevents code-uniqueness drift as Phase 2+ adds/modifies classes
- [Phase 01-foundation]: [Phase 01 P04]: CI matrix locked to 3 OSes × Node [20, 22] = 6 jobs; fail-fast disabled; no hyperfine gate in Phase 1 (deferred to Phase 5 per D-11); concurrency.group cancels stacked runs on same ref
- [Phase 02-config-system]: secretKeys uses final-provenance semantics: keys overridden by local are not tagged as secret, preventing false redaction
- [Phase 02-config-system]: Dot-key collision (quoted 'a.b' key vs nested a.b path) throws YamlParseError rather than silently allowing last-writer-wins
- [Phase 03]: D-09 lookup-based alias detection: only step/group entries matching CommandMap keys are graph edges; unknown entries are inline commands (no UnknownAliasError at load time for non-alias steps)
- [Phase 03]: Depth cap (D-10) enforced at depth > 10 in DFS with CommandSchemaError showing full expansion chain
- [Phase 03]: Sequential nested alias refs expand inline: sub-steps merge into parent sequence; parallel group entries must resolve to single commands
- [Phase 04-executor-cli]: reject:false + result.failed detection for ENOENT SpawnError (avoids double-throw path)
- [Phase 04-executor-cli]: failMode fast abort fires in per-promise .then() callback, not after allSettled, to kill remaining processes promptly
- [Phase 04-executor-cli]: ExecutorOptions interface (cwd+env) added to Executor.run contract for clean CLI wiring in Plan 02
- [Phase 04-executor-cli]: enablePositionalOptions() on root commander program is mandatory for passThroughOptions() to work on sub-commands (commander v14 pitfall)
- [Phase 04-executor-cli]: Pass-through test uses script file not 'node -e' to avoid Node v22 treating '--foo' as its own option
- [Phase 04-executor-cli]: configureOutput writeErr noop to suppress commander stderr double-output with exitOverride
- [Phase 05-init-distribution]: registerInitCommand called before findLociRoot; postAction hook enables exit-0 from no-.loci/ dirs
- [Phase 05-init-distribution]: README uses npm package name 'xci' per D-01; binary command documented as 'xci'; badges included for CI workflow and npm xci package
- [Phase 05-init-distribution]: Package name set to 'xci' per D-01 (npm name loci is taken); bin command stays loci; LICENSE added to package.json files array
- [Phase 05-init-distribution]: Package name set to 'xci' per D-01 (npm name 'loci' is taken); bin command stays 'loci'
- [Phase 05-init-distribution]: LICENSE explicitly in package.json files array for unambiguous tarball inclusion
- [v2.0 Roadmap]: 9 phases (06–14), 99 requirements, all mapped with no orphans
- [v2.0 Roadmap]: Phase 06 is a hard backward-compat fence — no agent code written until CI gates are active (BC-02, BC-03 enforced)
- [v2.0 Roadmap]: `ws` and `reconnecting-websocket` are external[] in cli.ts tsup entry; bundle-size CI gate fails at >200KB
- [v2.0 Roadmap]: Docker base must be node:22-slim (not Alpine) — @node-rs/argon2 prebuilt binaries require glibc
- [v2.0 Roadmap]: Agent token transmitted in WS frame body only, never in connection URL (proxy log safety)
- [v2.0 Roadmap]: QUOTA-01/02/07 assigned to Phase 07 (schema + entity definitions); QUOTA-03/04/05/06 assigned to Phase 10 (enforcement at dispatch/registration)
- [v2.0 Roadmap]: TASK-05 (UI editor) assigned to Phase 09 alongside server-side task API; UI wiring completed in Phase 13
- [Phase 06]: D-07 amended pnpm pinned to 10.33.0 (was placeholder "latest-v9" — v10 GA since Jan 2025)
- [Phase 06]: D-12 amended: @xci/server and @xci/web stubs are `private: true` in Phase 6, flip to false when real code lands (Phase 9 server, Phase 13 web)
- [Phase 06]: SC-2 bundle-size (200KB) gate DEFERRED — fresh rebuild 760KB; threshold was based on v1 Phase 1 baseline (126KB), pre-dates P2-P5 additions. CI size-limit step NOT wired; ws-fence 3 layers (tsup external + Biome + CI grep) still active. Future cycle should re-evaluate the threshold.
- [Phase 06]: D-15 size-limit CI step omitted per user decision; other fence gates (ws-exclusion grep D-16b, hyperfine D-17, matrix tests D-18, smoke D-19) all active in ci.yml
- [Phase 06]: D-06 clean-cut atomic: package-lock.json deleted + pnpm-lock.yaml generated in the same commit (ce47c53)
- [Phase 06]: Pitfall 1 handled — tsup `noExternal` regex changed to `/^(?!ws$|reconnecting-websocket$).*/` (not `[/.*/]`) so `external` takes effect
- [Phase 06]: Pitfall 2 handled — Biome `overrides[].includes` (PLURAL) key used, scoped to `packages/xci/src/**`
- [Phase 06]: release.yml has job-scoped `permissions: { contents: write, pull-requests: write }` per plan-checker recommendation
- [Phase 07-database-schema-auth]: Build tool is tsc -b (not tsup) for @xci/server — servers have no cold-start pressure
- [Phase 07-database-schema-auth]: passWithNoTests:true in both vitest configs so zero-test bootstrap exits 0
- [Phase 07]: drizzle-kit generates randomly-named SQL migration (0000_volatile_mad_thinker.sql) — prefix ordering is what matters for migrator, not human-readable suffix
- [Phase 07]: sessions.activeOrgId uses ON DELETE SET NULL per D-18 — org deletion does not cascade-destroy sessions
- [Phase 07]: resetDb() uses dynamic information_schema enumeration to avoid hardcoded table list drift (Pitfall 5)
- [Phase 07-database-schema-auth]: Algorithm.Argon2id ambient const enum replaced with literal 2 (verbatimModuleSyntax incompatibility)
- [Phase 07-database-schema-auth]: forOrg(orgId) is the sole entry point into org-scoped repos (D-01) — enforced structurally via repos/index.ts barrel + Biome noRestrictedImports
- [Phase 07-database-schema-auth]: adminRepo cross-org namespace has no orgId param — deliberate friction point (D-03); signupTx creates org+user+member+plan atomically in 4-table transaction
- [Phase 07-database-schema-auth]: D-04 meta-test walks repos/*.ts and fails CI if any makeXxxRepo export lacks a matching isolation.test.ts — drift detection by design
- [Phase 07]: Auth plugin uses direct Drizzle query for session lookup (not adminRepo.findActiveSessionByToken) to include isNull+gt predicates at DB time — avoids time-of-check race on revocation
- [Phase 07]: Sliding expiry uses raw sql template (not Drizzle .set()) to express LEAST(now()+14d, created_at+30d) in a single atomic UPDATE with 4 Pitfall 6 predicates
- [Phase 07]: CSRF registered globally but NOT hooked globally (Pitfall 1); routes opt-in via onRequest: [fastify.csrfProtection] in Plans 06/07

### Pending Todos

- Branch protection on main: mark `build-test` (6 matrix jobs) + `fence-gates` as required status checks before first PR merge
- Repo Settings > Actions > General: enable "Allow GitHub Actions to create and approve pull requests" before Phase 14
- Add `NPM_TOKEN` repo secret (needed starting Phase 14 for first publish)
- Future: re-evaluate bundle-size baseline — consider dynamic-imports for TUI, slimmer execa alternative, or accept monorepo-era size
- Future (optional): quick task to clean up 68 pre-existing Biome style errors in packages/xci/src/ (useTemplate, useLiteralKeys, etc. — byte-identical to v1 tag)

### Blockers/Concerns

None

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-j2u | Rename CLI command from loci to xci | 2026-04-15 | 3f37119 | [260415-j2u-rename-cli-command-from-loci-to-xci](./quick/260415-j2u-rename-cli-command-from-loci-to-xci/) |
| 260415-jxl | Add CLI KEY=VALUE parameter overrides | 2026-04-15 | 5a1fa83 | [260415-jxl-add-cli-key-value-parameter-overrides](./quick/260415-jxl-add-cli-key-value-parameter-overrides/) |
| 260418-lav | Add home-dir fallback for XCI_MACHINE_CONFIGS + hard-error on invalid env path | 2026-04-18 | 70ab4c1 | [260418-lav-add-home-dir-fallback-for-xci-machine-co](./quick/260418-lav-add-home-dir-fallback-for-xci-machine-co/) |

## Session Continuity

Last session: 2026-04-18T19:09:23.776Z
Stopped at: Completed 07-05-PLAN.md
Resume file: None
