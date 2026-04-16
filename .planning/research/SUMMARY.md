# Project Research Summary

**Project:** loci (npm: `xci`)
**Milestone:** v2.0 — Remote CI — Agents + Web Dashboard
**Researched:** 2026-04-16
**Confidence:** HIGH (stack + architecture), MEDIUM (xci-specific feature defaults)

## Executive Summary

xci v2.0 transforms a local command-runner CLI into a distributed CI system: agents connect to a SaaS server via persistent WebSocket, tasks are defined and dispatched from a web dashboard, and the v1 CLI remains entirely unchanged for non-agent invocations. The architecture mirrors established patterns from Buildkite, GitHub Actions, and CircleCI — TOFU agent registration, label-based dispatch, envelope-encrypted org secrets, plugin-based triggers. The monorepo splits into three packages: `xci` (CLI + agent mode), `@xci/server` (Fastify + Postgres backend), and `@xci/web` (React + Vite SPA), built and versioned with pnpm workspaces + Turborepo.

Recommended approach: a strict dependency-ordered phase sequence — monorepo scaffolding first, then DB schema + auth foundation (everything keys off `orgId`), then agent registration + WebSocket infrastructure, then task definitions + dispatch, then log streaming + secrets, then plugins + frontend, then Docker packaging. The v1 CLI cold-start budget (< 300ms) and the 202-test suite must remain green throughout. The biggest non-functional requirement is that `ws` must never enter the v1 `cli.mjs` bundle; enforced by a CI bundle-size check added in Phase A before any agent code exists.

The highest-risk pitfall is **multi-tenant data leakage** from a missing `org_id` filter in a single repository function — invisible in tests without a multi-org fixture, silent at runtime, irreversible once exposed. Both this and the in-memory dispatch queue (lost on restart, reconciled from DB at startup) must be addressed by design, not left as afterthoughts.

## Stack Additions (v2.0 only — v1 frozen)

| Layer | Key Technology | Version | Critical Constraint |
|-------|---------------|---------|---------------------|
| Monorepo | pnpm + Turborepo | 10.x / 2.9.6 | — |
| Backend | Fastify 5 + plugin suite | 5.8.5 | Node >=20 required |
| ORM | Drizzle ORM + `postgres` driver | 0.45.2 / 3.4.9 | `drizzle-kit` is devDep only |
| Auth | `@node-rs/argon2` (Argon2id) | 2.0.2 | Prebuilt glibc binaries |
| Encryption | `node:crypto` AES-256-GCM | stdlib | No external library |
| Frontend | React 19 + Vite 8.x + Tailwind 4 | 19.2.5 / 8.0.8 / 4.2.2 | Vite 8 (not 7) |
| Components | shadcn/ui via CLI | — | Source copied, not a package dep |
| Agent WS | `ws` + `reconnecting-websocket` | 8.20.0 / 4.4.0 | agent-entry only, never in cli.mjs |
| Docker | `node:22-slim` | — | Alpine breaks argon2 prebuilt binaries |
| Sessions | Opaque token in DB | — | JWT not used — must be revocable |

## Feature Table-Stakes vs Differentiators vs Defers

All 10 feature categories have mandatory table-stakes items in v2.0. No category is optional.

**High-value differentiators (build if capacity allows):** agent drain mode, log timestamps + raw download, viewer role (read-only), personal access tokens, registration token separate from agent credential, secret expiration with warnings, dead-letter queue for webhooks, manual trigger with param override UI, build-status badge SVG endpoint.

**Explicit defers to v2.1+:** matrix runs, cross-machine artifact passing, global log search, SSO/OIDC, 2FA, GitHub App (webhook is sufficient), agent auto-scaling, dashboard analytics, Slack/PagerDuty integrations, Stripe/paid plans.

**Anti-features (never build):** auto-update of agent binary, dynamic plugin installation from npm at runtime, trigger fan-out (one webhook → N tasks), org-wide shared agent token, secret values visible in UI, global task-priority integer queue.

## Architectural Integration Points

- **Monorepo layout is additive**: existing `src/` moves to `packages/xci/src/` verbatim. 202 tests run with `pnpm --filter xci test` as a required CI check — the backward-compat fence.
- **Three tsup entries**: `src/cli.ts` (v1, unchanged), `src/agent.ts` (new, bundles ws), library exports for `@xci/server`. `ws` is `external[]` for the CLI entry.
- **Agent mode is a dynamic-import guard at the top of main()**: three lines in cli.ts check `--agent` and dynamic-import the agent module. Cold-start of normal CLI unaffected.
- **Secret dispatch**: server decrypts org secrets (envelope: MEK → DEK → plaintext), sends plaintext in `DispatchPayload.params` over TLS-protected WS. Agent merges with local `.xci/secrets.yml` (server params win). Pino serializers strip `params` from all log output.
- **Multi-tenancy is a repository-layer concern**: every tenanted query goes through an `orgId`-parameterized repository factory. A shared test fixture with two orgs exercises every repo function; any missing `org_id` filter is caught at Phase C.
- **WS protocol**: frame-type discriminated union (`handshake`, `heartbeat`, `dispatch`, `log_chunk`, `result`, `error`, `goodbye`), 25s ping / 10s pong timeout, sequence numbers per task run for ordering, task-state reconciliation on reconnect.
- **Plugin interface**: 3-method contract `verify(req) → parse(req) → mapToTask(event)`. Bundled at build time — no dynamic runtime install. In v2.0: GitHub webhook (HMAC SHA-256), Perforce (`change-commit` trigger posting JSON).
- **In-memory dispatch queue**: non-durable by design; on boot, server re-queues all `TaskRun` rows in `queued` or `dispatched` state whose agent no longer holds the session.

## Suggested Phases (dependency DAG)

| Phase | Name | Depends On | Can Parallel With |
|-------|------|------------|-------------------|
| A | Monorepo Setup + v1 regression gates | — | — |
| B | Database Schema + migrations | A | — |
| C | Auth + Org Model + multi-tenant isolation | A, B | — |
| D | Agent Registration + WS Protocol | A, B, C | E, I, K |
| E | Task Definitions + YAML DSL (shared w/ xci) | A, B, C | D, I, K |
| F | Dispatch Pipeline + TaskRun State Machine | A, B, C, D, E, I | K |
| G | Log Streaming + Persistence + Fanout | A, B, D, F | H |
| H | Plugin System + GitHub + Perforce | A, B, C, E, F | G |
| I | Secrets Management + Envelope Encryption | A, B, C | D, E |
| J | Web Dashboard SPA | C, D, E, G | G, H |
| K | Billing Stub + Quota Enforcement | A, B, C | D, E, I |
| L | Docker + Publishing + Release Pipeline | all | — |

## Watch Out For — 8 things a planner must know

1. **v1 CLI bundle is a hard constraint.** `ws` must never enter `cli.mjs`. Add the CI bundle-size check (fail >200KB) and tsup `external` config in Phase A, before any agent code.
2. **`orgId` is the entire security model.** Every tenanted query must include `AND org_id = ${orgId}`. Multi-org isolation test in Phase C, extended with every new entity.
3. **Drizzle migrations in production use the programmatic migrator**, not `drizzle-kit`. `drizzle-kit` is devDep only.
4. **Docker base image is `node:22-slim`, not Alpine.** `@node-rs/argon2` prebuilt binaries require glibc.
5. **Agent token goes in the WS frame body, never in the URL.** URL params appear in proxy access logs.
6. **HMAC comparisons must use `crypto.timingSafeEqual()`.** `===` is a timing attack.
7. **Log redaction must cover base64-encoded secret variants.** Extend redaction with `Buffer.from(value).toString('base64')` for each secret value.
8. **In-memory dispatch queue is intentionally non-durable.** Tasks queued at crash are re-queued from DB at startup. Document and test startup reconciliation; don't treat it as a bug.

## Highest-Risk Pitfalls (owner phase)

| Pitfall | Prevention | Owner |
|---------|------------|-------|
| Missing `org_id` filter on a single query | Multi-org integration fixture + repo factory | C |
| `ws` bundled into cli.mjs via indirect import | `external` + Biome import-restrict + bundle-size CI | A |
| HMAC `===` instead of `timingSafeEqual` | Static check + code-review checklist | H |
| NAT half-open connection | 25s ping / 10s pong in first version of ws-agent | D |
| IV reuse in AES-GCM envelope | Unit test `notDeepEqual` on consecutive encryptions | I |
| Secret leak via pino-http logging request body | Custom pino serializer scrubbing `params` | D/F |
| Drizzle migrator bundled in prod image | Separate init step, verified in smoke test | L |
| Webhook payload with tokens persisted raw | Scrub known sensitive header/body fields before store | H |

## Research Flags

- **Phase D (Agent WS Protocol)**: brief `/gsd-research-phase` spike recommended on Buildkite agent OSS source for reconnection / state reconciliation edge cases.
- **Phase H (Plugin System)**: confirm current GitHub webhook `push`/`pull_request` payload schema and Perforce `p4 triggers` `change-commit` hook format at planning time.
- **Standard patterns (skip research-phase)**: A, B, C, E (YAML DSL reuses v1), I (AES-256-GCM envelope), L.

## Unresolved — needs requirement decision

| Item | Options |
|------|---------|
| Log retention default (Free plan) | ARCHITECTURE.md says 7 days; FEATURES.md says 30 days — product call |
| Free-plan quota numbers | `maxAgents: 3`, `logRetentionDays: ?`, `maxConcurrentTasks: 5` suggested by Buildkite reference — needs confirmation |
| `task_runs.definitionSnapshot` column | Prose in ARCHITECTURE.md; absent from schema — decide before Phase F |
| GitHub plugin task-matching strategy | Naming convention (event type → task name) vs explicit config per plugin install |

## Confidence Assessment

| Area | Confidence |
|------|------------|
| Stack (versions, compat) | HIGH (verified npm 2026-04-16) |
| Features patterns (from Buildkite/GHA/CircleCI docs) | HIGH |
| Features xci-specific values (quota, retention) | MEDIUM (product decision) |
| Architecture (data model, WS protocol, dispatch) | HIGH |
| Pitfalls (general patterns) | HIGH |
| Pitfalls (v1-integration specifics) | MEDIUM |

**Overall: HIGH**

---
*Sources: `.planning/research/STACK.md`, `.planning/research/FEATURES.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`.*
