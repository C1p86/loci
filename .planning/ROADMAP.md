# Roadmap: loci

## Overview

loci is built as a strict pipeline: Foundation -> Config -> Commands/Resolver -> Executor/CLI -> Polish. Each phase delivers a self-contained, testable capability. Security contracts (secrets redaction, git-tracked secrets warning) are locked into Phase 2 before any other phase can accidentally log config values. Cross-platform CI comes online in Phase 1 so every subsequent phase is Windows-verified from day one.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

---

### v1.0 — Local CLI (phases 01–05, complete)

- [x] **Phase 1: Foundation** - Project scaffold, shared types, error hierarchy, CI matrix on Windows/Linux/macOS
- [x] **Phase 2: Config System** - 4-layer YAML loader with deterministic merge, secrets redaction contract, gitignore safety check (completed 2026-04-13)
- [x] **Phase 3: Commands & Resolver** - commands.yml parser, alias composition with cycle detection, `${VAR}` interpolation (completed 2026-04-14)
- [x] **Phase 4: Executor & CLI** - cross-platform command execution, parallel groups, full commander.js frontend wired end-to-end (completed 2026-04-14)
- [x] **Phase 5: Init & Distribution** - `loci init` scaffolding, README, npm publish (completed 2026-04-15)

---

### v2.0 — Remote CI: Agents + Web Dashboard (phases 06–14)

- [x] **Phase 6: Monorepo Setup & Backward-Compat Fence** - pnpm workspaces, Turborepo, Changesets; CI ws-fence + cold-start gate + v1 regression suite active. Bundle-size gate deferred (baseline 760KB vs 200KB target — to revisit).
- [x] **Phase 7: Database Schema & Auth** - Drizzle schema, migrations, signup/login/sessions/password-reset, org model, multi-tenant isolation, quota entities
- [x] **Phase 8: Agent Registration & WebSocket Protocol** - TOFU agent registration, persistent WS with heartbeat/reconnect, agent lifecycle (online/offline/drain/reconcile/shutdown), registration tokens
- [x] **Phase 9: Task Definitions & Secrets Management** - server-side YAML DSL (shared parser with xci), CRUD API, YAML validation; org-level envelope encryption, secrets CRUD, dispatch-time resolution
- [x] **Phase 10: Dispatch Pipeline & Quota Enforcement** - label-match dispatcher, in-memory queue with DB reconciliation, TaskRun state machine, timeout/cancel/orphan, per-org quota enforcement
- [x] **Phase 11: Log Streaming & Persistence** - agent log_chunk streaming, in-memory RunBuffer, Postgres persistence, UI WebSocket fanout, retention cleanup
- [ ] **Phase 12: Plugin System & Webhooks** - TriggerPlugin interface, GitHub + Perforce plugins, Dead Letter Queue, idempotency, DLQ UI
- [ ] **Phase 13: Web Dashboard SPA** - React 19 + Vite 8 + Tailwind 4 SPA: auth, agents, tasks, log viewer, run history, org settings, plugin settings, build-status badge endpoint
- [ ] **Phase 14: Docker & Publishing** - multi-stage Docker image, docker-compose dev stack, CI smoke-test, npm publish pipeline, Changesets release flow

## Phase Details

### Phase 1: Foundation
**Goal**: The project skeleton exists: runnable binary, typed error hierarchy, CI passing on all three platforms
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06
**Success Criteria** (what must be TRUE):
  1. `npm i -g .` installs a `loci` binary that runs on Windows 10+, Linux, and macOS without modification
  2. `loci --version` exits in under 300ms cold on a modern laptop
  3. `npm test` and `npm run lint` pass on a fresh clone with no manual setup
  4. GitHub Actions CI runs build + test + lint on a Windows / Linux / macOS matrix and all checks are green
**Plans**: 4 plans
- [x] 01-01-PLAN.md — Repository scaffolding (package.json, tsconfig, tsup/vitest/biome configs, hygiene files, D-05 directory skeleton)
- [x] 01-02-PLAN.md — Core source (errors.ts full LociError hierarchy, types.ts pipeline contracts, version.ts, cli.ts commander wiring, feature stubs)
- [x] 01-03-PLAN.md — Test suite (errors.test.ts instanceof/code-uniqueness/exit-code-mapping, types.test.ts expectTypeOf, cli.e2e.test.ts spawn smoke)
- [x] 01-04-PLAN.md — GitHub Actions CI matrix (ubuntu/windows/macos x Node 20/22, build->test->lint->smoke)

### Phase 2: Config System
**Goal**: The 4-layer YAML config merges correctly, secrets are tagged for redaction from this moment forward, and safety guards (git tracking warning, YAML error messages) are in place
**Depends on**: Phase 1
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-06, CFG-07, CFG-08, CFG-09, CFG-10
**Success Criteria** (what must be TRUE):
  1. A key defined in machine config is overridden by project config, which is overridden by secrets, which is overridden by local — the merged value is always the last-defined one
  2. If `secrets.yml` is accidentally committed to git, loci prints a visible warning before running (does not block)
  3. Running `loci` in a directory with a malformed YAML file shows the filename and line number of the parse error, then exits non-zero
  4. Missing config files do not cause a crash — loci runs with whatever files are present
  5. `yes`, `no`, `on`, `off`, and `0123` in YAML files are treated as strings, not booleans or octals
**Plans**: 1 plan
- [x] 02-01-PLAN.md — Config loader implementation (readLayer, flattenToStrings, mergeLayers, git secrets check) + comprehensive test suite

### Phase 3: Commands & Resolver
**Goal**: `commands.yml` is fully parsed, alias composition is flattened with cycle detection at load time, and all `${VAR}` placeholders are resolved before any process is spawned
**Depends on**: Phase 2
**Requirements**: CMD-01, CMD-02, CMD-03, CMD-04, CMD-05, CMD-06, CMD-07, CMD-08, CMD-09, INT-01, INT-02, INT-03, INT-04, INT-05
**Success Criteria** (what must be TRUE):
  1. An alias referencing `${DEPLOY_HOST}` (defined in any config layer) resolves to the correct value before the command runs; if the variable is missing, loci prints which alias and which placeholder is undefined and exits without running anything
  2. A circular alias chain (`A -> B -> A`) is detected at startup and reported with the full cycle path — the command never runs
  3. An alias that references another alias (`ci: [lint, test, build]`) executes each constituent alias correctly
  4. Values from `secrets.yml` injected as env vars do not appear in any verbose or debug output — they show as `***` or are omitted
**Plans**: 2 plans
- [x] 03-01-PLAN.md — Commands loader (YAML parser, tokenizer, normalizer, DFS cycle detection, eager validation)
- [x] 03-02-PLAN.md — Resolver (platform selection, ${VAR} interpolation, env var builder, secrets redaction utility)

### Phase 4: Executor & CLI
**Goal**: Users can run any defined alias end-to-end: single commands, sequential chains, and parallel groups execute correctly cross-platform; the full commander.js interface (`--list`, `--dry-run`, `--verbose`, pass-through args) is wired and working
**Depends on**: Phase 3
**Requirements**: EXE-01, EXE-02, EXE-03, EXE-04, EXE-05, EXE-06, EXE-07, CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08, CLI-09
**Success Criteria** (what must be TRUE):
  1. `loci <alias>` runs the command, streams stdout/stderr in real time, and exits with the same exit code as the child process (or the first failing step in a chain)
  2. `loci <alias> --dry-run` prints the fully-resolved command (or chain/group) with secrets replaced by `***`, without executing anything
  3. Running a parallel group shows each command's output prefixed by its alias name; if one command fails, all remaining commands are killed and loci exits non-zero
  4. Pressing Ctrl+C during execution kills the child process and exits cleanly — no orphaned processes remain
  5. `loci --list` (or `loci` with no arguments) shows all available aliases with their descriptions
  6. `loci <alias> -- --some-flag value` passes `--some-flag value` through to the underlying command without loci interpreting the flags
**Plans**: 2 plans
- [x] 04-01-PLAN.md — Executor engine (types/failMode extension, output formatting, single/sequential/parallel execution with AbortController cancellation)
- [x] 04-02-PLAN.md — CLI frontend (commander.js dynamic alias registration, walk-up discovery, --list/--dry-run/--verbose/pass-through, E2E tests)

### Phase 5: Init & Distribution
**Goal**: `loci init` scaffolds a new project, documentation is complete, and the package is ready for npm publication under the name `xci`
**Depends on**: Phase 4
**Requirements**: INIT-01, INIT-02, INIT-03, INIT-04, INIT-05, INIT-06, DOC-01, DOC-02, DOC-03, DOC-04, DOC-05
**Success Criteria** (what must be TRUE):
  1. Running `loci init` in a project directory creates `.loci/config.yml`, `.loci/commands.yml`, `.loci/secrets.yml.example`, and `.loci/local.yml.example`, and adds the real secrets/local files to `.gitignore` — subsequent runs skip existing files and print what was skipped
  2. A developer following only the README quickstart can install loci, run `loci init`, define one alias, and execute it successfully with no other guidance
  3. `npm i -g xci` installs the published package and `loci --version` works immediately
**Plans**: 3 plans
- [x] 05-01-PLAN.md — Init command (src/init/ module with templates + scaffolding logic, CLI wiring, unit + E2E tests)
- [x] 05-02-PLAN.md — README documentation (quickstart, config reference, commands reference, platform overrides, shell:false)
- [x] 05-03-PLAN.md — LICENSE + npm publication prep (MIT license, package.json name to xci, publish dry-run, final checkpoint)

---

### Phase 6: Monorepo Setup & Backward-Compat Fence
**Goal**: The monorepo is restructured with pnpm workspaces + Turborepo, v1 tests pass green in the new layout, and the CI bundle-size gate plus `ws`-exclusion check are active before any agent-mode code is written
**Depends on**: Phase 5 (v1.0 complete)
**Requirements**: BC-01, BC-02, BC-03, BC-04, PKG-01, PKG-02, PKG-03
**Success Criteria** (what must be TRUE):
  1. `pnpm --filter xci test` runs all 202 v1 tests green in the new monorepo layout; this check is a required CI gate on every PR touching `packages/xci/`
  2. `dist/cli.mjs` is confirmed to be under 200KB (currently ~130KB) and a CI step fails the build if it exceeds that threshold
  3. A Biome lint rule or tsup `external` config prevents `ws` and `reconnecting-websocket` from entering `dist/cli.mjs`; bundle-size CI catches any regression
  4. `pnpm turbo run build` completes with all three packages building in correct dependency order (xci first, then @xci/server, then @xci/web)
  5. `xci --version` cold-start is verified under 300ms on Linux CI after the monorepo restructure
**Plans**: 6 plans
- [ ] 06-01-PLAN.md — Pre-flight: verify npm scope @xci is available for @xci/server and @xci/web (blocking per D-14)
- [ ] 06-02-PLAN.md — Monorepo restructure: migrate src/ to packages/xci/, create server+web stubs, split tsconfig, swap root README, update .gitignore
- [ ] 06-03-PLAN.md — pnpm workspace + Turborepo + Changesets wiring + clean-cut package-lock.json deletion
- [ ] 06-04-PLAN.md — 3-layer ws-exclusion fence: tsup external (Pitfall 1 fix) + Biome noRestrictedImports override (Pitfall 2 fix, `includes` plural)
- [ ] 06-05-PLAN.md — CI workflows: rewrite ci.yml with pnpm+turbo+fence-gates (size/grep/hyperfine), create release.yml with changesets/action@v1
- [ ] 06-06-PLAN.md — End-to-end verification: fresh build + v1 test suite + all 5 ROADMAP success criteria green, human-verify checkpoint before Phase 7

### Phase 7: Database Schema & Auth
**Goal**: Users can sign up, log in, and belong to an org; the full multi-tenant isolation layer is in place with a two-org test fixture that catches any missing `org_id` filter
**Depends on**: Phase 6
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09, AUTH-10, AUTH-11, AUTH-12, QUOTA-01, QUOTA-02, QUOTA-07
**Success Criteria** (what must be TRUE):
  1. A new user can sign up with email + password, receive a verification email, verify their account, and log in — the session cookie is httpOnly, secure, sameSite=strict, and persists across page reloads
  2. A logged-out user cannot access any authenticated API endpoint; a session is irreversibly invalidated on logout
  3. Owner can invite a member by email; the invite link expires after 7 days; the invited user joins the correct org with the correct role
  4. A repository function queried without `org_id` scope is unreachable by design — the two-org integration fixture verifies that org A's data never appears in org B's responses across all repo functions
  5. Password reset flow sends a single-use link that expires in 1 hour and cannot be reused
**Plans**: 9 plans
- [x] 07-01-PLAN.md — Server package bootstrap: real package.json (private:false), tsconfig, drizzle.config, vitest unit+integration configs, biome overrides, .env.example, first changeset
- [x] 07-02-PLAN.md — Database foundation: Drizzle schema (8 tables) + relations + programmatic migrator + db plugin + testcontainers harness + two-org fixture + generated SQL migration
- [x] 07-03-PLAN.md — XciServerError hierarchy (mirror v1 LociError) + crypto primitives (Argon2id + tokens) + @fastify/env JSON schema + email transport (log/stub/smtp) + 5 templates
- [x] 07-04-PLAN.md — Scoped repos (6 files + forOrg + adminRepo + index barrel) + D-04 two-org isolation tests per repo + auto-discovery meta-test
- [x] 07-05-PLAN.md — buildApp factory (D-06 plugin chain: env→db→helmet→cookie→csrf→rate-limit→auth→error-handler→routes) + auth plugin (session + sliding expiry) + error-handler + server.ts entry
- [x] 07-06-PLAN.md — Auth HTTP routes: signup + verify-email + login (xci_sid httpOnly+secure+sameSite=strict) + logout (CSRF-protected, AUTH-12) + request-reset + reset (AUTH-04 single-use 1h) + csrf token
- [x] 07-07-PLAN.md — Org & invite routes: create/list/revoke invite (owner-only, 7d expiry), role change (owner-immutable), invite acceptance with email-pinning D-15
- [x] 07-08-PLAN.md — CI integration-tests Linux-only job (needs build-test-lint) + branch-protection checkpoint
- [ ] 07-09-PLAN.md — Phase closeout: packages/server/README.md + STATE.md update + traceability matrix (15 reqs → tests) + human-verify checkpoint on green CI
**UI hint**: yes

### Phase 8: Agent Registration & WebSocket Protocol
**Goal**: An agent can register with a one-time token, maintain a persistent WS connection with heartbeat/reconnect, and the server accurately tracks online/offline/draining/reconciled state
**Depends on**: Phase 7
**Requirements**: ATOK-01, ATOK-02, ATOK-03, ATOK-04, ATOK-05, ATOK-06, AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, AGENT-06, AGENT-07, AGENT-08
**Success Criteria** (what must be TRUE):
  1. Running `xci --agent <url> --token <reg-token>` registers the agent, stores the permanent credential locally, and brings the agent online; subsequent restarts reconnect without re-registering
  2. A revoked agent credential is rejected within one reconnect cycle — the WS closes with reason "revoked" and the agent exits non-zero
  3. After a network partition (simulated disconnect), the agent reconnects with exponential backoff and the server reconciles any in-flight task state declared in the handshake
  4. An agent in drain mode receives no new dispatches; current tasks complete to their natural end state before the agent stops
  5. Graceful shutdown (SIGTERM) sends a `goodbye` frame, waits for in-flight tasks to complete, and exits 0 with no orphaned task runs in the DB
**Plans**: 5 plans
- [x] 08-01-PLAN.md — Phase 6 fence reversal + schema foundation (tsup multi-entry + xci deps + biome narrow + CI grep removal + 3 Drizzle tables + 0001 migration + agent stub)
- [x] 08-02-PLAN.md — Server data layer (crypto compareToken/hashToken + 5 new error subclasses + 3 org-scoped repos + adminRepo D-37 helpers + isolation tests)
- [x] 08-03-PLAN.md — Server WS endpoint + 5 REST routes (handshake + heartbeat + registry + frames + agents routes with CSRF/rate-limit + integration tests)
- [x] 08-04-PLAN.md — xci agent daemon (AgentClient + credential load/save with TOFU + labels + SIGINT/SIGTERM shutdown + cold-start test + Linux E2E)
- [x] 08-05-PLAN.md — Phase closeout (READMEs + STATE.md + traceability matrix + human-verify checkpoint)

### Phase 9: Task Definitions & Secrets Management
**Goal**: Org admins can define tasks using the same YAML DSL as v1 (validated by the shared parser), and org-level secrets are stored with envelope encryption and resolved at dispatch time without ever appearing in logs
**Depends on**: Phase 7
**Requirements**: TASK-01, TASK-02, TASK-03, TASK-04, TASK-05, TASK-06, SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07, SEC-08
**Success Criteria** (what must be TRUE):
  1. A task saved with valid YAML is accepted; a task with invalid YAML or a cyclic alias composition is rejected at save time with the exact error line and a human-readable suggestion
  2. A secret created by an Owner/Member can be referenced as `${SECRET_NAME}` in a task; its plaintext value is never returned by any API endpoint or written to any log — only metadata (name, created_at) is visible
  3. Two consecutive encrypt calls for the same secret value produce different IVs and different ciphertexts, and decryption of either produces the original value
  4. An agent-local `.xci/secrets.yml` value for the same key wins over an org-level secret at dispatch time — the correct merged value reaches the subprocess
  5. The MEK-rotation endpoint re-wraps all org DEKs under the new MEK without changing any plaintext secret values; all secrets remain decryptable after rotation
**Plans**: 6 plans
- [x] 09-01-PLAN.md — DSL subpath facade (xci/dsl) + cross-package workspace dep + Drizzle schema for 4 tables + [BLOCKING] 0002 migration
- [x] 09-02-PLAN.md — Server env (XCI_MASTER_KEY + PLATFORM_ADMIN_EMAIL) + crypto/secrets.ts (AES-256-GCM) + 7 new error classes + Pino redaction + MEK decorator
- [x] 09-03-PLAN.md — forOrg repos (tasks, secrets, secret-audit-log) + adminRepo getOrgDek/rotateMek + Biome D-37/D-38 cross-package fence + isolation tests
- [x] 09-04-PLAN.md — Task CRUD routes + 4-step D-12 validation pipeline (parse, structure, cycle, unknown-alias with suggest) + integration tests
- [x] 09-05-PLAN.md — Secret CRUD routes + secret-audit-log endpoint + SEC-04 no-plaintext invariant guard (grep + runtime test)
- [x] 09-06-PLAN.md — rotate-mek admin endpoint (SEC-08, D-26 + D-28 verified) + dispatch-resolver service (TASK-06) + Phase closeout
**UI hint**: yes

### Phase 10: Dispatch Pipeline & Quota Enforcement
**Goal**: Tasks can be manually triggered from the API, dispatched to the correct agent via label matching, and run through the full state machine to completion; per-org quota limits are enforced at registration and dispatch time
**Depends on**: Phase 8, Phase 9
**Requirements**: DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, DISP-06, DISP-07, DISP-08, DISP-09, QUOTA-03, QUOTA-04, QUOTA-05, QUOTA-06
**Success Criteria** (what must be TRUE):
  1. A manually triggered task runs on an online agent whose labels satisfy the task's `label_requirements`; if no eligible agent exists, the run remains queued and is dispatched when a matching agent comes online
  2. A task run transitions correctly through queued → dispatched → running → succeeded/failed; exit code from the agent subprocess is the final exit code recorded on the TaskRun
  3. A timed-out task sends a `cancel` frame to the agent, the agent kills the subprocess, and the run is marked `timed_out`; startup reconciliation re-queues all orphaned runs from a previous server crash
  4. An org on the Free plan cannot register more than 5 agents — the 6th registration is rejected with a user-visible quota error
  5. A run dispatched with param overrides from the UI uses the overridden values without altering the task definition
**Plans**: 5 plans
- [x] 10-01-PLAN.md — task_runs schema + Drizzle migration 0003 [BLOCKING] + makeTaskRunsRepo with atomic CAS + adminRepo count/reconciliation helpers + isolation tests
- [x] 10-02-PLAN.md — Frame protocol (state/result/log_chunk parsers) + WS handler routing + frame-spoofing guard + QUOTA-03 registration gate (close code 4006) + timeout-manager stub
- [x] 10-03-PLAN.md — Dispatcher service (DispatchQueue + 250ms tick + JSONB label-match selector) + timeout-manager full impl + boot + reconnect reconciliation (activates Phase 8 D-18)
- [x] 10-04-PLAN.md — REST routes (POST /runs trigger + /cancel + GET list/get/usage) + DISP-09 param override resolution + QUOTA-04/05/06 + Pino redaction
- [x] 10-05-PLAN.md — Agent dispatch/cancel handlers + runner.ts (execa spawn + log_chunk streaming + SIGTERM/SIGKILL) + SEC-06 agent-local merge + E2E test + Phase closeout

### Phase 11: Log Streaming & Persistence
**Goal**: Log chunks streamed by an agent are persisted to Postgres and broadcast in real time to subscribed UI clients, with ordered replay on reconnect and a daily retention cleanup job
**Depends on**: Phase 10
**Requirements**: LOG-01, LOG-02, LOG-03, LOG-04, LOG-05, LOG-06, LOG-07, LOG-08
**Success Criteria** (what must be TRUE):
  1. A UI client subscribing to a running task's log stream receives chunks in sequence-number order with no duplicates, even after a WS reconnect mid-run
  2. Log chunks are persisted to Postgres; after the run completes, a client can replay the full log in order by fetching from the DB
  3. A slow UI subscriber does not block or delay log streaming to the agent or persistence to Postgres
  4. Org secret values (and their base64-encoded variants) are replaced by `***` in persisted log chunks before they reach the DB
  5. A user can download the full log of any completed run as a `.log` plaintext file via an authenticated, org-scoped endpoint
**Plans**: 4 plans
- [x] 11-01-PLAN.md — log_chunks schema + migration 0004 [BLOCKING] + logChunks repo + adminRepo runRetentionCleanup + isolation test
- [x] 11-02-PLAN.md — redaction-table + log-batcher + log-fanout services; handleLogChunkFrame rewire (redact/batch/fanout); trigger.ts seeds runRedactionTables
- [x] 11-03-PLAN.md — WS subscribe endpoint /ws/orgs/:orgId/runs/:runId/logs (sinceSeq catch-up) + GET logs.log download + log-retention service on onReady + integration tests
- [x] 11-04-PLAN.md — Agent-side redactLine + 8KB chunk split in runner.ts; E2E test; Phase closeout (READMEs + STATE + REQUIREMENTS traceability + human-verify)

### Phase 12: Plugin System & Webhooks
**Goal**: Incoming GitHub and Perforce webhooks are verified, parsed, and mapped to task runs; unprocessed events land in a Dead Letter Queue visible in the UI with manual retry
**Depends on**: Phase 10
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05, PLUG-06, PLUG-07, PLUG-08
**Success Criteria** (what must be TRUE):
  1. A GitHub `push` event with a valid HMAC-SHA256 signature is verified, parsed, matched to a task, and dispatches a run; an event with an invalid signature returns 401 and lands in the DLQ
  2. A Perforce `change-commit` trigger posting JSON to the Perforce endpoint triggers a matched task run; `xci agent-emit-perforce-trigger` emits a working `.sh`/`.bat` script that does not require Node on the Perforce machine
  3. A duplicate webhook delivery (same `X-GitHub-Delivery` ID) is ignored with a warning log and does not create a second task run
  4. DLQ entries are visible in the UI with their failure reason; a manual retry from the UI re-processes the event through the full verify → parse → mapToTask pipeline
  5. No Authorization, X-Hub-Signature, or X-GitHub-Token header values appear in the persisted DLQ payload
**Plans**: 5 plans
- [ ] 12-01-PLAN.md — Schema + 0005 migration [BLOCKING] + 3 new org-scoped repos (webhook-tokens w/ envelope encryption, webhook-deliveries, dlq-entries) + adminRepo cross-org helpers + isolation tests
- [ ] 12-02-PLAN.md — TriggerPlugin interface + GitHub (HMAC-SHA256) & Perforce (X-Xci-Token) plugins + registry + glob helper + contract test harness + 6 new error classes
- [ ] 12-03-PLAN.md — Webhook routes (/hooks/:plugin/:orgToken) + shared handler (verify→dedup→parse→mapToTask→dispatch→DLQ) + rawBody capture + scrub + rate-limit + SC-5 integration test
- [ ] 12-04-PLAN.md — Webhook-token CRUD routes + DLQ list + DLQ retry (skips verify per D-20) + tasks trigger_configs validation on save + integration tests
- [ ] 12-05-PLAN.md — xci CLI agent-emit-perforce-trigger (Node-free sh/bat/ps1 emit) + Perforce E2E integration test + READMEs + STATE/REQUIREMENTS/ROADMAP traceability + human-verify checkpoint
**UI hint**: yes

### Phase 13: Web Dashboard SPA
**Goal**: A logged-in user can manage agents, define tasks, trigger runs, watch live logs, browse history, manage org members, configure plugins, and see build-status badges — with role-based access enforced throughout
**Depends on**: Phase 7, Phase 8, Phase 9, Phase 10, Phase 11
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05, UI-06, UI-07, UI-08, UI-09, UI-10, UI-11, BADGE-01, BADGE-02, BADGE-03, BADGE-04
**Success Criteria** (what must be TRUE):
  1. A Viewer-role user sees the same pages as a Member but all mutation controls (save, trigger, drain, invite) are visibly disabled with a tooltip — they are never simply hidden
  2. A first-run user with no agents sees an empty state with the exact `xci --agent ... --token ...` command pre-populated with a copiable one-time registration token
  3. The live log view displays chunks in real time with autoscroll; autoscroll pauses on user scroll-up and resumes when scrolled to the bottom; the WS connection indicator accurately reflects connected / reconnecting / disconnected states
  4. The task YAML editor surfaces validation errors (invalid YAML, cycle detected) inline with file line and a suggestion, without navigating away from the editor
  5. The build-status badge endpoint returns a valid SVG for a task with toggle ON; returns an "unknown" SVG (not 404) for tasks with toggle OFF or non-existent org/task slugs
**Plans**: TBD
**UI hint**: yes

### Phase 14: Docker & Publishing
**Goal**: The server + web SPA ships as a single Docker image that boots cleanly, runs migrations on startup, passes a smoke test, and all three npm packages are published via Changesets
**Depends on**: Phase 6, Phase 7, Phase 8, Phase 9, Phase 10, Phase 11, Phase 12, Phase 13
**Requirements**: PKG-04, PKG-05, PKG-06, PKG-07, PKG-08
**Success Criteria** (what must be TRUE):
  1. `docker compose up` in the repo starts the server (node:22-slim, non-root), Postgres, and a mailhog SMTP relay; the server healthcheck passes within 30 seconds
  2. Server applies Drizzle migrations at boot using the programmatic migrator; `drizzle-kit` binary is not present in the production image
  3. The CI smoke-test pipeline pulls the published image, runs migrations, and completes a signup → agent registration → task trigger → run → log fetch end-to-end flow before tagging the release
  4. `npx changeset publish` successfully publishes `xci`, `@xci/server`, and `@xci/web` to npm with coordinated versions; `npm i -g xci@latest` installs the updated CLI
**Plans**: TBD

## Progress

**Execution Order (v1.0):**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

**Execution Order (v2.0):**
06 → 07 → 08 (needs 07) → 09 (needs 07, parallel with 08) → 10 (needs 08+09) → 11 (needs 10) → 12 (needs 10) → 13 (needs 07+08+09+10+11) → 14 (needs all)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete | 2026-04-13 |
| 2. Config System | 1/1 | Complete | 2026-04-13 |
| 3. Commands & Resolver | 2/2 | Complete | 2026-04-14 |
| 4. Executor & CLI | 2/2 | Complete | 2026-04-14 |
| 5. Init & Distribution | 3/3 | Complete | 2026-04-15 |
| 6. Monorepo Setup & Backward-Compat Fence | 0/? | Not started | - |
| 7. Database Schema & Auth | 9/9 | Complete | 2026-04-18 |
| 8. Agent Registration & WebSocket Protocol | 5/5 | Complete | 2026-04-18 |
| 9. Task Definitions & Secrets Management | 6/6 | Complete | 2026-04-19 |
| 10. Dispatch Pipeline & Quota Enforcement | 6/5 | Complete   | 2026-04-19 |
| 11. Log Streaming & Persistence | 4/4 | Complete | 2026-04-19 |
| 12. Plugin System & Webhooks | 0/? | Not started | - |
| 13. Web Dashboard SPA | 0/? | Not started | - |
| 14. Docker & Publishing | 0/? | Not started | - |
