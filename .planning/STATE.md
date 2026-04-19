---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: — Remote CI
status: Phase 12 complete — ready for Phase 13
stopped_at: Completed Phase 12 — all 5 plans, plugin system + webhooks + DLQ + Perforce emitter
last_updated: "2026-04-18T00:00:00.000Z"
last_activity: 2026-04-18
progress:
  total_phases: 14
  completed_phases: 12
  total_plans: 58
  completed_plans: 58
  percent: 86
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-16)

**Core value:** Un alias → sempre lo stesso comando eseguito correttamente, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.
**Current focus:** Phase 12 — Plugin System & Webhooks

## Current Position

Phase: 13 (Web Dashboard SPA) — NEXT
Plan: 1 of TBD
Next: Phase 13 — Web Dashboard SPA
Last activity: 2026-04-18

Progress (Phase 12): [██████████] 100% (5/5 plans)
Progress (v2.0 milestone): [███████░░░] 86% (7/9 phases complete: 06, 07, 08, 09, 10, 11, 12)

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
| 12 | 5 | - | - |
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
| Phase 10-dispatch-pipeline-quota-enforcement P01 | 35 | 3 tasks | 12 files |
| Phase 10-dispatch-pipeline-quota-enforcement P02 | 866s | 3 tasks | 7 files |
| Phase 10-dispatch-pipeline-quota-enforcement P03 | 90 | 3 tasks | 12 files |
| Phase 10-dispatch-pipeline-quota-enforcement P04 | 738 | 2 tasks | 13 files |
| Phase 10-dispatch-pipeline-quota-enforcement P05 | ~30m | 3 tasks | 8 files |
| Phase 10 P05 | 30m | 3 tasks | 9 files |
| Phase 11-log-streaming-persistence P01 | 30 | 2 tasks | 9 files |
| Phase 11-log-streaming-persistence P02 | 608 | 3 tasks | 10 files |
| Phase 11-log-streaming-persistence P03 | 45m | 2 tasks | 9 files |
| Phase 11-log-streaming-persistence P04 | ~20m | 2 tasks | 4 files |
| Phase 12-plugin-system-webhooks P01 | 15 | 3 tasks | 15 files |
| Phase 12-plugin-system-webhooks P02 | 9 | 3 tasks | 10 files |
| Phase 12-plugin-system-webhooks P03 | 35 | 3 tasks | 8 files |
| Phase 12-plugin-system-webhooks P04 | 922 | 2 tasks | 17 files |
| Phase 12-plugin-system-webhooks P05 | — | 5 tasks | 9 files |

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
- [Phase 09]: DSL is a re-export facade; NO behavior change in packages/xci/ — v1 302-test suite still green (D-05 / BC-01 / D-40)
- [Phase 09]: AAD for secrets = `${orgId}:${name}`; for DEK wrap = 'dek-wrap' constant (D-16) — binds ciphertext to location, prevents cross-org decryption
- [Phase 09]: Every encrypt call uses randomBytes(12) IV; audit log written in same transaction as mutation (D-22) — failure to log fails the action
- [Phase 09]: MEK parsed once via `app.decorate('mek', Buffer.from(...,'base64'))` at boot; length check throws with remediation hint (Pitfall 8)
- [Phase 09]: No plaintext secret endpoint ever exists — SEC-04 architectural invariant enforced by AJV additionalProperties:false + grep CI gate
- [Phase 09]: requirePlatformAdmin middleware compares req.user.email to PLATFORM_ADMIN_EMAIL env var (case-insensitive) — throws PlatformAdminRequiredError (D-24)
- [Phase 09]: MEK rotation is single db.transaction + FOR UPDATE + mek_version idempotency guard (D-25/D-28); repeating with same newMekBase64 returns rotated=0
- [Phase 09]: Cross-package fence: @xci/server imports only xci/dsl; xci never imports @xci/server (D-37/D-38) — Biome noRestrictedImports enforces both directions
- [Phase 09]: dsl.mjs bundle externalises yaml (22.9KB); commander NOT present in dsl entry (Pitfall 4 / D-39)
- [Phase 09]: resolveTaskParams is a pure function (no DB, no logger) — Phase 10 dispatcher calls it at dispatch time with decrypted orgSecrets dict (D-33)
- [Phase 10-dispatch-pipeline-quota-enforcement]: CAS update returns undefined on miss — repos do not throw; service/handler layer decides the appropriate error
- [Phase 10-dispatch-pipeline-quota-enforcement]: orgId included in every CAS WHERE clause for task_runs (T-10-01-03 frame spoofing guard)
- [Phase 10-dispatch-pipeline-quota-enforcement]: findRunsForReconciliation() has no orgId param — adminRepo cross-tenant by design (D-03/D-30 boot scan)
- [Phase 10-dispatch-pipeline-quota-enforcement]: QUOTA-03 gate placed after consumeRegistrationToken — prevents quota-state probing via token reuse
- [Phase 10-dispatch-pipeline-quota-enforcement]: timeout-manager.ts stub pattern: handler.ts imports cleanly in Plan 10-02, Plan 10-03 replaces with real implementation
- [Phase 10-dispatch-pipeline-quota-enforcement]: Store orgId in timer Map entry so handleRunTimeout calls forOrg() without cross-org SELECT
- [Phase 10-dispatch-pipeline-quota-enforcement]: DispatchQueue.getEntries() returns immutable snapshot to prevent FIFO corruption during mid-loop dequeue
- [Phase 10-dispatch-pipeline-quota-enforcement]: reconciler uses run.taskSnapshot (not fresh task.getById) for D-01 reproducibility; paramOverrides used as params pending Plan 10-05 dispatch-resolver wiring
- [Phase 10-dispatch-pipeline-quota-enforcement]: Resolve params at trigger time (not dispatch tick): snapshot stores resolved YAML, secrets captured at trigger time for reproducibility
- [Phase 10-dispatch-pipeline-quota-enforcement]: Cancel for dispatched/running: annotate cancelled_by_user_id + 30s fallback timer (not immediate CAS) per D-25; queued cancel is immediate
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: runner.ts is standalone (does NOT import from executor/single.ts) — avoids pulling ANSI/log-file code into agent bundle; kill logic ~20 lines inline with source comment
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: cancelled flag on RunHandle set BEFORE proc.kill; onExit receives cancelled=true — single result-frame sender, no race with handleCancel
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: loadLocalSecrets() called on every dispatch (no cache) — secrets file rotation picked up without agent restart (SEC-06 freshness)
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: Phase 10 supports SINGLE-COMMAND task dispatch only; sequence/parallel deferred to future phase pending Phase 11 log_chunk storage maturity
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: parseYamlToArgv: string→tokenize, JSON/YAML array→direct argv, object→AGENT_UNSUPPORTED_TASK error frame (not result frame)
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: state.runningRuns Map populated before onExit fires (set after spawnTask returns) — no window where cancel arrives before run is tracked
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: reconnect frame now sends real running_runs from state.runningRuns Map (Phase 8 D-18 stub now ACTIVE); goodbye frame same
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: reconnect_ack abandon entries: agent calls handle.cancel() for each reconciliation.action==='abandon' entry from server (D-24)
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: --max-concurrent flag parses to int; NaN or <1 throws AgentModeArgsError at startup (not silent default)
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: SEC-06 test uses process.cwd()/.xci/secrets.yml (not tmpDir) since agent loads from process.cwd(); cleanup in finally block
- [Phase 10-dispatch-pipeline-quota-enforcement P05]: E2E dispatch test is Linux+Docker CI-deferred; describe.runIf(isLinux && existsSync(xciDistAgent)); no testcontainers in dev environment
- [Phase 11-log-streaming-persistence]: No org_id FK on log_chunks — scoping via INNER JOIN to task_runs keeps the table lean at high row counts (D-01)
- [Phase 11-log-streaming-persistence]: adminRepo.runRetentionCleanup uses CTE subquery for LIMIT because PostgreSQL does not support LIMIT on DELETE directly (D-19)
- [Phase 11-log-streaming-persistence]: Longest-first redaction ordering (D-06) prevents partial replacements when a short secret value is a prefix of a longer one
- [Phase 11-log-streaming-persistence]: LogBatcher timer NOT reset on subsequent enqueues to same run — original 200ms budget is the guarantee (D-10)
- [Phase 11-log-streaming-persistence]: Subscriber pump is synchronous inline loop (not async) for simplicity and testability; gap frame emitted per overflow event (D-13)
- [Phase 11-log-streaming-persistence]: WS route registered at root level (not under /api prefix) — matches agent WS pattern; cookie auth works because authPlugin fires on HTTP upgrade
- [Phase 11-log-streaming-persistence]: reply.hijack() chosen for download streaming per D-15; raw.writeHead called manually after hijack
- [Phase 11-log-streaming-persistence]: LOG_RETENTION_INTERVAL_MS default 86400000 (24h); setInterval unref'd; onReady immediate boot pass (D-20)
- [Phase 11-log-streaming-persistence P04]: Agent-side redactLine applies .xci/secrets.yml values (≥4 chars, longest-first) per chunk BEFORE onChunk fires — defense-in-depth complementing server-side org-secret redaction (D-08/D-24)
- [Phase 11-log-streaming-persistence P04]: splitChunk iterates code points (for..of) to avoid splitting multi-byte UTF-8 sequences; 8KB cap leaves 8x headroom under the 65536 WS maxPayload (D-03/D-24)
- [Phase 11-log-streaming-persistence P04]: redactionValues passed as sorted copy at spawnTask setup time (not per-chunk) — O(n log n) once vs O(n*m) per chunk where m=secrets count
- [Phase 11-log-streaming-persistence P04]: E2E log-streaming test is Linux+Docker gated (describe.runIf) matching existing Phase 10 E2E pattern; covers SC-1 (seq contiguity), SC-2 (DB persistence), SC-3 (slow-subscriber gap), SC-4 (redaction end-to-end), SC-5 (download endpoint)
- [Phase 12-plugin-system-webhooks]: Used raw sql template for dlq-entries cursor pagination OR condition — Drizzle or() return type is SQL|undefined which TypeScript rejects in conditions array
- [Phase 12-plugin-system-webhooks]: admin.webhooks integration test uses raw db.execute SQL for old-timestamp inserts since Drizzle insert does not expose receivedAt override for testing cleanup behavior
- [Phase 12-plugin-system-webhooks]: TriggerPlugin interface canonical in plugins-trigger/types.ts; schema.ts imports+re-exports for backward compat
- [Phase 12-plugin-system-webhooks]: Perforce verify ignores pluginSecret: token identity delegated to Plan 12-03 route layer; plugin enforces header presence only (D-13)
- [Phase 12-plugin-system-webhooks]: matchGlob uses .+ (one-or-more) for * expansion so acme/* requires at least 1 char after slash (D-10)
- [Phase 12-plugin-system-webhooks]: rawBody captured inside encapsulated registerHookRoutes scope — HMAC verify works for /hooks, /api routes unaffected
- [Phase 12-plugin-system-webhooks]: DLQ writes are best-effort (writeDlq catches insert errors) — DLQ failure must not convert a 401 into a 500
- [Phase 12-plugin-system-webhooks]: triggerSource='webhook' added to task-runs create(); default 'manual' preserves backward compat
- [Phase 12-plugin-system-webhooks]: list.ts uses sql<boolean> IS NOT NULL projection for hasPluginSecret — avoids DEK decryption in list path
- [Phase 12-plugin-system-webhooks]: DLQ retry skips verify (D-20); WARN log 'dlq_retry_skipping_signature_verify' on every invocation
- [Phase 12]: TriggerPlugin interface is 3 methods (verify/parse/mapToTask) — bundled at build time, no dynamic load (PLUG-02 anti-feature)
- [Phase 12]: GitHub plugin uses HMAC-SHA256 via compareToken timingSafeEqual; X-Hub-Signature-256 header; plugin_secret encrypted with Phase 9 org DEK (D-08/D-28)
- [Phase 12]: Perforce plugin uses X-Xci-Token header (no HMAC — Perforce trigger can't do HMAC in shell); plugin_secret column NULL for Perforce (D-13)
- [Phase 12]: Webhook routes mounted at /hooks/* (NO /api prefix) — external machine senders, no session, no CSRF; rate-limit 60/min/IP per D-07
- [Phase 12]: Idempotency via webhook_deliveries (plugin, delivery_id) unique index + onConflictDoNothing; duplicate → 200 'duplicate' + WARN log, no second dispatch
- [Phase 12]: DLQ scrub list D-25: Authorization, X-Hub-Signature, X-Hub-Signature-256, X-GitHub-Token, X-Xci-Token, Cookie, Set-Cookie (case-insensitive); body passes through unchanged per D-26
- [Phase 12]: DLQ retry SKIPS signature verify (D-20) — admin action, logged 'dlq_retry_skipping_signature_verify'
- [Phase 12]: xci `agent-emit-perforce-trigger` is the ONE xci change outside agent/ — lazy-loaded, cold-start <300ms preserved (BC-04)
- [Phase 12]: Generated Perforce scripts (sh/bat/ps1) are Node-free — use curl / Invoke-WebRequest; token inline + chmod 700 admin responsibility documented
- [Phase 12]: tasks.trigger_configs is JSONB array of GitHubTriggerConfig | PerforceTriggerConfig union; validated on save via validateTriggerConfigs; no naming convention (D-17/D-18)
- [Phase 12]: Webhook-triggered task_runs have trigger_source='webhook', triggered_by_user_id=NULL (D-30); dispatch-resolver params = orgSecrets + mapToTask output

### Pending Todos

- Branch protection on main: ensure `integration-tests` (Phase 07/08), `fence-gates` (Phase 06), and all 6 `build-test-lint` matrix checks are marked as required status checks before next PR merge. Once set, AUTH-10 SC-4 is gated at merge time.
- Repo Settings > Actions > General: enable "Allow GitHub Actions to create and approve pull requests" before Phase 14
- Add `NPM_TOKEN` repo secret (needed starting Phase 14 for first publish)
- Future: re-evaluate bundle-size baseline — consider dynamic-imports for TUI, slimmer execa alternative, or accept monorepo-era size
- Future (optional): quick task to clean up 68 pre-existing Biome style errors in packages/xci/src/ (useTemplate, useLiteralKeys, etc. — byte-identical to v1 tag)
- Future (Phase 11): session token hashing at rest (deferred per D-12) — hash sha256 the token before DB insert; compare in auth plugin
- Future (post-v2.0): haveibeenpwned password check (deferred per D-32) — add to signup/reset flows
- [DONE Phase 10]: reconnect_ack reconciliation[] now populated with real task run state (D-18 ACTIVE)
- [DONE Phase 10]: QUOTA-03 registration gate implemented (max_agents=5 Free plan, close 4006)
- Future (post-v2.0): multi-instance scaling via Redis pub/sub for agentRegistry (currently in-memory single-process only)
- Future (post-v2.0): agent audit log (register/revoke events) — paired with Phase 7 audit log deferral
- Future (Phase 11): WS log_chunk frame type (reserved in D-15); backpressure handling revisit at that time

- [DONE Phase 11]: log_chunk persistence + server-side storage — log_chunks table, LogBatcher, forOrg.logChunks.insertBatch all active
- [DONE Phase 11]: LOG-06 pre-persist redaction — server-side runRedactionTables (org secrets, 4 variants, longest-first) + agent-side redactLine (.xci/secrets.yml values)
- Deferred (future phase): sequence/parallel task dispatch on agent — Phase 10 supports single-command only; multi-step dispatch needs further design

### Blockers/Concerns

None

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260415-j2u | Rename CLI command from loci to xci | 2026-04-15 | 3f37119 | [260415-j2u-rename-cli-command-from-loci-to-xci](./quick/260415-j2u-rename-cli-command-from-loci-to-xci/) |
| 260415-jxl | Add CLI KEY=VALUE parameter overrides | 2026-04-15 | 5a1fa83 | [260415-jxl-add-cli-key-value-parameter-overrides](./quick/260415-jxl-add-cli-key-value-parameter-overrides/) |
| 260418-lav | Add home-dir fallback for XCI_MACHINE_CONFIGS + hard-error on invalid env path | 2026-04-18 | 70ab4c1 | [260418-lav-add-home-dir-fallback-for-xci-machine-co](./quick/260418-lav-add-home-dir-fallback-for-xci-machine-co/) |

## Session Continuity

Last session: 2026-04-18T00:00:00.000Z
Stopped at: Completed Phase 12 — all 5 plans, plugins + webhooks + DLQ + Perforce emitter
Phase 12 closed: 5 plans complete, 8 requirement IDs traced (PLUG-01..08), 5/5 SC covered, integration tests green (Linux-only E2E gated per Phase 10/11 pattern), v1 302-test + hyperfine + ws-fence regressions all pass
Resume: Phase 13 — Web Dashboard SPA (needs Phase 7+8+9+10+11 complete — SATISFIED; Phase 12 consumed by UI for plugin settings + DLQ views)
