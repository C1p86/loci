---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Completed 04-executor-cli-02-PLAN.md
last_updated: "2026-04-14T17:03:46.032Z"
last_activity: 2026-04-14
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 9
  completed_plans: 9
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-10)

**Core value:** Un alias → sempre lo stesso comando eseguito correttamente, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.
**Current focus:** Phase 04 — executor-cli

## Current Position

Phase: 04 (executor-cli) — EXECUTING
Plan: 2 of 2
Status: Phase complete — ready for verification
Last activity: 2026-04-14

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 7
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4 | - | - |
| 02 | 1 | - | - |
| 03 | 2 | - | - |

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

### Pending Todos

None yet.

### Blockers/Concerns

- npm package name `loci` availability unverified — run `npm info loci` before starting Phase 5
- Phase 4 (Executor & CLI) needs targeted research before planning: execa v9 parallel abort pattern and commander v14 passThroughOptions interaction

## Session Continuity

Last session: 2026-04-14T17:03:46.003Z
Stopped at: Completed 04-executor-cli-02-PLAN.md
Resume file: None
