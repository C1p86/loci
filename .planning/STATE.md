---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Local CLI
status: executing
stopped_at: Completed 09-05-PLAN.md (Secret CRUD routes + audit-log + SEC-04 invariant guard)
last_updated: "2026-04-18T23:57:19.295Z"
last_activity: 2026-04-18
progress:
  total_phases: 9
  completed_phases: 8
  total_plans: 39
  completed_plans: 38
  percent: 97
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16)

**Core value:** Un alias → sempre lo stesso comando eseguito correttamente, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.
**Current focus:** Phase 9 — Task Definitions & Secrets Management

## Current Position

Phase: 9 (Task Definitions & Secrets Management) — EXECUTING
Plan: 6 of 6
Status: Ready to execute
Last activity: 2026-04-18

Progress (Phase 08): [██████████] 100%
Progress (v2.0 milestone): [███░░░░░░░] 33% (3/9 phases)

## Performance Metrics

**Velocity:**

- Total plans completed: 12 (v1.0) + 9 (Phase 07) = 21 total
- Average duration: —
- Total execution time: ~75 minutes (Phase 07 estimate)

**By Phase (v1.0 complete):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4 | - | - |
| 02 | 1 | - | - |
| 03 | 2 | - | - |
| 04 | 2 | - | - |
| 05 | 3 | - | - |

**By Phase (v2.0):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 06 | 6 | - | - |
| 07 | 9 | ~75m | ~8m |
| 08 | TBD | - | - |
| 09 | TBD | - | - |
| 10 | TBD | - | - |
| 11 | TBD | - | - |
| 12 | TBD | - | - |
| 13 | TBD | - | - |
| 14 | TBD | - | - |

**Recent Trend:**

- Last 5 plans: Phase 07 P05-P09 (server core, auth routes, org/invite routes, CI job, closeout)
- Trend: ~8 min/plan average in Phase 07

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
| Phase 07-database-schema-auth P01 | 15m | 3 tasks | 14 files |
| Phase 07 P02 | 10m | 3 tasks | 12 files |
| Phase 07-database-schema-auth P03 | 15m | 3 tasks | 16 files |
| Phase 07-database-schema-auth P04 | 7m | 3 tasks | 17 files |
| Phase 07 P05 | ~10m | 3 tasks | 10 files |
| Phase 07-database-schema-auth P06 | ~10m | 3 tasks | 19 files |
| Phase 07-database-schema-auth P07 | ~10m | 2 tasks | 10 files |
| Phase 07-database-schema-auth P08 | 5m | 1 tasks | 3 files |
| Phase 07-database-schema-auth P09 | ~10m | 2 tasks | 3 files |
| Phase 08 P01 | 20 | 2 tasks | 14 files |
| Phase 08-agent-registration-websocket-protocol P02 | 489 | 3 tasks | 12 files |
| Phase 08 P03 | 13 | 3 tasks | 26 files |
| Phase 08-agent-registration-websocket-protocol P04 | 12 | 3 tasks | 12 files |
| Phase 08 P05 | ~15 | 2 tasks | 4 files |
| Phase 09-task-definitions-secrets-management P01 | 784 | 3 tasks | 16 files |
| Phase 09-task-definitions-secrets-management P02 | 500 | 3 tasks | 7 files |
| Phase 09-task-definitions-secrets-management P03 | 6 | 2 tasks | 41 files |
| Phase 09-task-definitions-secrets-management P04 | 9 | 2 tasks | 12 files |
| Phase 09-task-definitions-secrets-management P05 | 12 | 2 tasks | 13 files |

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
- [Phase 07-06]: Login dummy argon2 verify equalizes timing between unknown-email and wrong-password paths (T-07-06-03 anti-enumeration)
- [Phase 07-06]: All 7 auth routes CSRF-exempt except logout — signup/login have no session yet (D-34 Pitfall 1); request-reset/reset/verify-email exempt for same reason
- [Phase 07-database-schema-auth]: null-guard pattern after requireOwnerAndOrgMatch: extract req.org?.id into locals then throw SessionRequiredError if falsy — satisfies biome noNonNullAssertion
- [Phase 07-database-schema-auth]: markInviteAccepted in adminRepo (not forOrg) — invitee is not yet a member of the org at acceptance time
- [Phase 07]: CI `integration-tests` job added — Linux-only, runs `pnpm --filter @xci/server test:integration` after `build-test-lint` matrix passes (D-23 rationale: Docker preinstalled on ubuntu-latest)
- [Phase 07]: packages/server/ `test` script = `pnpm test:unit` only; integration runs via dedicated `test:integration` script called explicitly by Linux CI job (prevents Windows/macOS matrix jobs from trying to spawn Docker)
- [Phase 07]: D-01 scoped repository wrapper is the architectural spine — `forOrg(orgId)` is the SOLE path to org-scoped tables; routes/plugins/app blocked from direct sibling imports via Biome `noRestrictedImports`
- [Phase 07]: D-04 auto-discovery meta-test (`isolation-coverage.isolation.test.ts`) walks src/repos/ at test time; CI red if a new makeXxxRepo factory lacks a matching `<name>.isolation.test.ts` referencing it by name
- [Phase 07]: D-06 Fastify plugin order is env → db → helmet → cookie → csrf → rate-limit → auth → error-handler → routes; `dependencies` field on each plugin enforces at register time; no autoload
- [Phase 07]: D-13 sliding session expiry is a single atomic SQL UPDATE with Pitfall 6 predicate (`revoked_at IS NULL AND expires_at > now() AND last_seen_at < now() - interval '1 hour'`) — no read-then-write race
- [Phase 07]: D-15 invites are email-pinned (case-insensitive) — anyone-with-link acceptance is REJECTED with AUTHZ_INVITE_EMAIL_MISMATCH; anyone-with-link is how SaaS gets owned
- [Phase 07]: D-31 Argon2id params m=19456/t=2/p=1 (OWASP 2024); argon2SelfTest runs in server.ts before listen() and warns if <100ms (weak) or >2000ms (will starve event loop)
- [Phase 07]: D-34 CSRF is per-route, NOT global (Pitfall 1); signup and login are CSRF-EXEMPT (no session yet) but rate-limited
- [Phase 07]: D-38 QUOTA entity persisted (org_plans 5/5/30 Free defaults via column defaults) but enforcement deferred to Phase 10 (agents) and Phase 11 (retention)
- [Phase 07]: @xci/server package.json private:false flip completed (Phase 6 D-12 commitment fulfilled); first publish remains Phase 14
- [Phase 07]: Drizzle migrations produced by `drizzle-kit generate` committed as single `drizzle/0000_volatile_mad_thinker.sql` (Pitfall 10); programmatic migrator at boot reads from drizzle/ per D-28
- [Phase 07]: packages/xci/ untouched throughout Phase 07 (D-39); v1 302-test suite still green; Phase 6 ws-exclusion + hyperfine gates still pass
- [Phase 08]: ws/rws kept external in tsup (D-01); agent.mjs is the separate bundle entry
- [Phase 08]: argv pre-scan before imports ensures zero cold-start cost for non-agent paths (D-02, D-29)
- [Phase 08]: Drizzle partial uniqueIndex enforces at-most-one active credential per agent at DB level (T-08-01-06)
- [Phase 08-agent-registration-websocket-protocol]: compareToken uses timingSafeEqual with byteLength pre-check (ATOK-06); returns false not throw on length mismatch
- [Phase 08-agent-registration-websocket-protocol]: agent_credentials partial unique index requires tx revoke-then-insert; adminRepo D-37 helpers are sole cross-org WS auth path
- [Phase 08-03]: WS route registered at /ws/agent outside /api prefix — no session cookie on upgrade; auth via first frame (D-13/ATOK-03)
- [Phase 08-03]: agentRegistry decorator placed BEFORE fastifyWebsocket plugin (Pitfall 8); Map<string, WebSocket> on FastifyInstance
- [Phase 08-03]: Hand-rolled parseAgentFrame — no zod; validates required fields per type (D-15)
- [Phase 08-agent-registration-websocket-protocol]: tsup esbuildOptions external for ./agent/index.js required to prevent Pitfall 6 (agent code inlining into cli.mjs); external:[] array alone does not match relative paths
- [Phase 08-agent-registration-websocket-protocol]: E2E test uses describe.runIf(canRun) where canRun = isLinux && distExists — never fails spuriously on non-Linux or when build missing
- [Phase 08]: Phase 6 ws-fence formally reversed in Plan 01 — CI grep gate removed, Biome narrowed to packages/xci/src/cli.ts, new agent module is legitimate user of ws + reconnecting-websocket
- [Phase 08]: Agent mode lazy-loaded via argv pre-scan + dynamic import('./agent/index.js'); tsup multi-entry produces dist/cli.mjs (no ws) + dist/agent.mjs (ws external)
- [Phase 08]: Cold-start gate <300ms preserved; new packages/xci/src/__tests__/cold-start.test.ts as unit-level guard alongside hyperfine CI gate
- [Phase 08]: Frame envelope hand-rolled in ws/frames.ts (no zod dep added); server frames.ts validates register/reconnect/goodbye only — dispatch/log_chunk/result reserved for Phase 10/11
- [Phase 08]: Open-then-handshake auth pattern (D-14) — WS upgrade is unauth, first frame within 5s carries token or credential; 4005 close on timeout
- [Phase 08]: crypto/tokens.ts centralized compareToken() with timingSafeEqual + length pre-check (Pitfall 3); ATOK-06 enforced by absence of === on token/credential variables (grep-verified)
- [Phase 08]: Credential storage uses env-paths(xci, {suffix:''}).config per OS — macOS picks ~/Library/Preferences/xci NOT ~/.config (RESEARCH Pitfall 5); --config-dir overrides
- [Phase 08]: Heartbeat server-driven at 25s interval + 10s pong timeout; last_seen_at updated on every pong + every incoming frame; D-12 state computed read-side (online = last_seen_at < 60s)
- [Phase 08]: agentRegistry Map<agentId, WebSocket> decorated BEFORE @fastify/websocket register (Pitfall 8); superseding pattern closes prior connection with code 4004
- [Phase 08]: 3 new org-scoped repos (agents, agent-credentials, registration-tokens) follow Phase 7 D-01 forOrg discipline; 3 new isolation tests; D-04 auto-discovery meta-test auto-picks up
- [Phase 08]: adminRepo gained 5 D-37 cross-org helpers (findValidRegistrationToken, consumeRegistrationToken, findActiveAgentCredential, registerNewAgent, issueAgentCredential); all token-comparing paths use hashToken + SQL eq or timingSafeEqual
- [Phase 08]: Single Drizzle migration 0001_agents_websocket.sql committed; partial unique index ON agent_credentials WHERE revoked_at IS NULL enforces at-most-one active cred per agent
- [Phase 08]: reconnecting-websocket on Node.js REQUIRES { WebSocket: WS } option (Pitfall 2); backoff 1.0-1.5s jittered → 30s cap with 1.5x growth
- [Phase 08]: All 5 REST routes use Phase 7 requireAuth + per-route CSRF (Owner/Member except DELETE which is Owner-only); token issue rate-limited 10/h per org+user (D-40)
- [Phase 08]: WS URL-token-rejection test (ATOK-03) explicit security regression guard — token in URL is IGNORED, server still requires first-frame handshake
- [Phase 08]: Graceful shutdown: SIGINT/SIGTERM → goodbye frame → 500ms flush → rws.close() → process.exit(0) (AGENT-08)
- [Phase 08]: E2E test (Linux-only, D-33) spawns real xci --agent process against real Fastify server via execa/spawn; credential file written + SIGTERM exit 0 verified
- [Phase 08]: Phase 7 server Biome ws-restriction (lines 70-91 of pre-Phase-8 biome.json) REMOVED — @fastify/websocket legitimately imports ws; third-override paths map EXTENDED with 3 new repo file entries
- [Phase 08]: 302 v1 xci tests still green (BC-02); hyperfine cold-start gate still green (BC-04); dist/cli.mjs contains zero ReconnectingWebSocket strings (BC-03 spirit preserved even without CI grep gate)
- [Phase 08]: reconnect_ack reconciliation returns [] stub (D-18) — Phase 10 populates with real task run reconciliation data
- [Phase 08]: QUOTA-03 (max_agents=5 registration gate) deferred to Phase 10 per roadmap — Phase 8 registration has no quota check
- [Phase 09]: tsup array-of-configs: dsl entry externalises yaml (22.9KB); cli+agent entry preserves Phase 6 noExternal bundling
- [Phase 09]: dts scoped to dsl entry only with noEmitOnError:false to avoid pre-existing tsc errors blocking declaration generation
- [Phase 09-task-definitions-secrets-management]: setAuthTag MUST precede decipher.update/final — verified by Node 22 (Pitfall 1)
- [Phase 09-task-definitions-secrets-management]: MEK parsed once at boot as Buffer(32); explicit length check throws with remediation hint (Pitfall 8)
- [Phase 09-task-definitions-secrets-management]: SecretDecryptError takes zero constructor args — prevents accidental crypto material logging
- [Phase 09-task-definitions-secrets-management]: writeSecretAuditEntry exported as standalone helper so secrets.ts and rotation logic can call it inside their own transactions without cross-repo coupling
- [Phase 09-task-definitions-secrets-management]: makeForOrg accepts mek: Buffer alongside db — cleaner than currying and matches the existing admin-repo shape; all 21 route call sites updated to makeRepos(db, mek)
- [Phase 09-task-definitions-secrets-management]: Drizzle .for('update') confirmed available in drizzle-orm 0.45.2 — no raw sql fallback needed for rotateMek SELECT FOR UPDATE
- [Phase 09-task-definitions-secrets-management]: validateTaskYaml exported from create.ts and imported by update.ts for D-12 deduplication; requireOwnerOrMemberAndOrgMatch exported from create.ts for Owner/Member guard
- [Phase 09-task-definitions-secrets-management]: SEC-04 enforced by AJV additionalProperties:false + explicit field selection in reply.send + grep CI gate + no-plaintext-leak integration test scanning 5 response bodies per CRUD cycle
- [Phase 09-task-definitions-secrets-management]: AJV maximum:1000 on audit-log limit returns 400 for limit>1000 (strict validation preferred over silent clamping)

### Pending Todos

- Branch protection on main: ensure `integration-tests` (Phase 07/08), `fence-gates` (Phase 06), and all 6 `build-test-lint` matrix checks are marked as required status checks before next PR merge. Once set, AUTH-10 SC-4 is gated at merge time.
- Repo Settings > Actions > General: enable "Allow GitHub Actions to create and approve pull requests" before Phase 14
- Add `NPM_TOKEN` repo secret (needed starting Phase 14 for first publish)
- Future: re-evaluate bundle-size baseline — consider dynamic-imports for TUI, slimmer execa alternative, or accept monorepo-era size
- Future (optional): quick task to clean up 68 pre-existing Biome style errors in packages/xci/src/ (useTemplate, useLiteralKeys, etc. — byte-identical to v1 tag)
- Future (Phase 11): session token hashing at rest (deferred per D-12) — hash sha256 the token before DB insert; compare in auth plugin
- Future (post-v2.0): haveibeenpwned password check (deferred per D-32) — add to signup/reset flows
- Future (Phase 10): populate reconnect_ack reconciliation[] with real task run state (currently returns [] stub per D-18)
- Future (Phase 10): implement quota enforcement at registration time (max_agents=5 Free plan) — QUOTA-03 assigned here but deferred to Phase 10 per roadmap
- Future (post-v2.0): multi-instance scaling via Redis pub/sub for agentRegistry (currently in-memory single-process only)
- Future (post-v2.0): agent audit log (register/revoke events) — paired with Phase 7 audit log deferral
- Future (Phase 11): WS log_chunk frame type (reserved in D-15); backpressure handling revisit at that time

### Blockers/Concerns

None

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-j2u | Rename CLI command from loci to xci | 2026-04-15 | 3f37119 | [260415-j2u-rename-cli-command-from-loci-to-xci](./quick/260415-j2u-rename-cli-command-from-loci-to-xci/) |
| 260415-jxl | Add CLI KEY=VALUE parameter overrides | 2026-04-15 | 5a1fa83 | [260415-jxl-add-cli-key-value-parameter-overrides](./quick/260415-jxl-add-cli-key-value-parameter-overrides/) |
| 260418-lav | Add home-dir fallback for XCI_MACHINE_CONFIGS + hard-error on invalid env path | 2026-04-18 | 70ab4c1 | [260418-lav-add-home-dir-fallback-for-xci-machine-co](./quick/260418-lav-add-home-dir-fallback-for-xci-machine-co/) |

## Session Continuity

Last session: 2026-04-18T23:57:19.244Z
Stopped at: Completed 09-05-PLAN.md (Secret CRUD routes + audit-log + SEC-04 invariant guard)
Resume file: None
