---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Local CLI
status: executing
stopped_at: Phase 6 context gathered
last_updated: "2026-04-18T15:58:56.858Z"
last_activity: 2026-04-18 -- Phase 06 execution started
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 19
  completed_plans: 13
  percent: 68
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16)

**Core value:** Un alias → sempre lo stesso comando eseguito correttamente, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.
**Current focus:** Phase 06 — Monorepo Setup & Backward-Compat Fence

## Current Position

Phase: 06 (Monorepo Setup & Backward-Compat Fence) — EXECUTING
Plan: 1 of 6
Status: Executing Phase 06
Last activity: 2026-04-18 -- Phase 06 execution started

Progress: [░░░░░░░░░░] 0%

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

### Pending Todos

None yet.

### Blockers/Concerns

None

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-j2u | Rename CLI command from loci to xci | 2026-04-15 | 3f37119 | [260415-j2u-rename-cli-command-from-loci-to-xci](./quick/260415-j2u-rename-cli-command-from-loci-to-xci/) |
| 260415-jxl | Add CLI KEY=VALUE parameter overrides | 2026-04-15 | 5a1fa83 | [260415-jxl-add-cli-key-value-parameter-overrides](./quick/260415-jxl-add-cli-key-value-parameter-overrides/) |
| 260418-lav | Add home-dir fallback for XCI_MACHINE_CONFIGS + hard-error on invalid env path | 2026-04-18 | 70ab4c1 | [260418-lav-add-home-dir-fallback-for-xci-machine-co](./quick/260418-lav-add-home-dir-fallback-for-xci-machine-co/) |

## Session Continuity

Last session: 2026-04-18T13:32:11.459Z
Stopped at: Phase 6 context gathered
Resume file: .planning/phases/06-monorepo-setup-backward-compat-fence/06-CONTEXT.md
