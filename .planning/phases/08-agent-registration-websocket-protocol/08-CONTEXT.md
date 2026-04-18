# Phase 8: Agent Registration & WebSocket Protocol - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Mode:** auto-selected (user requested autonomous chain to milestone end)

<domain>
## Phase Boundary

Phase 8 delivers BOTH sides of the agent ↔ server protocol:

**Server side (`@xci/server`):**
- Drizzle schema for `agents`, `agent_credentials`, `registration_tokens` tables (org-scoped, follow Phase 7 D-01 forOrg pattern)
- REST routes: registration token issuance (Owner/Member), agent listing (org members), agent credential revoke (Owner/Member), drain mode toggle, hostname rename
- WebSocket endpoint at `/ws/agent` (Fastify v5 + `@fastify/websocket`)
- Auth handshake protocol — token NEVER in URL (ATOK-03), passed in first WS frame
- Connection registry (in-memory `Map<agentId, WS>`) with lifecycle tracking
- Heartbeat: server-driven `ping` every 25s, `pong` timeout 10s; offline detection via `last_seen_at < now() - 60s`
- Reconciliation framework on reconnect — Phase 8 lays the API; Phase 10 exercises it with real dispatched runs
- Drain mode: API + state propagation to connected agent

**xci CLI side (`packages/xci/src/agent/`):**
- New top-level `--agent <url>` and `--token <reg-token>` flags
- Daemon mode: connects to server via WebSocket using `reconnecting-websocket`
- Sends handshake with labels (os, arch, node_version, hostname + custom `--label key=value`)
- Persists permanent credential after TOFU registration (XDG-compliant location)
- Reconnect with exponential backoff (1s..30s + jitter) per AGENT-02
- Graceful shutdown on SIGINT/SIGTERM: `goodbye` frame + clean exit per AGENT-08
- Lazy-loaded — does NOT regress the cold-start gate (300ms hyperfine)

**Phase 6 fence reversal (THE planned moment):**
- `ws@8.x` and `reconnecting-websocket@4.x` added to `packages/xci/package.json` dependencies
- Phase 6 D-16(b) grep gate REMOVED from CI workflow (no longer applicable — agent mode legitimately uses `ws`)
- Phase 6 D-16(c) Biome `noRestrictedImports` rule scope NARROWED to forbid only top-level static imports of `ws`/`reconnecting-websocket` from `cli.ts` — the agent module is allowed
- Cold-start preserved via dynamic `await import('./agent/index.js')` only when `--agent` is in argv
- v1 test suite (302 tests) still passes — backward compat fence (BC-01..04) still applies

This phase does NOT deliver:
- Task dispatch / dispatch frame implementation — Phase 10
- Quota enforcement (max_agents=5) at registration time — Phase 10 (per QUOTA-03 phase mapping; Phase 8 implements registration WITHOUT the gate; Phase 10 adds it)
- Log streaming frames — Phase 11
- Agent UI dashboard — Phase 13
- Any `dispatch` / `cancel` / `log_chunk` / `result` frame handlers (Phase 10/11 own these — Phase 8 reserves the type names in the envelope spec)

**Hard scope rule:** every requirement implemented here is one of ATOK-01..06 or AGENT-01..08. The frame protocol envelope is DEFINED in Phase 8 with placeholder types for Phase 10/11; only the lifecycle/auth/heartbeat frames are IMPLEMENTED.

</domain>

<decisions>
## Implementation Decisions

### Phase 6 ws-fence Reversal (the architectural moment)

- **D-01:** **Lift the fence cleanly, in this phase.** The fence existed to prevent regression during Phase 6 monorepo work; Phase 8 is the planned reversal. Concrete changes:
  - `packages/xci/package.json`: add `"ws": "^8.18.0"` and `"reconnecting-websocket": "^4.4.0"` to `dependencies`
  - `packages/xci/tsup.config.ts`: KEEP `ws` and `reconnecting-websocket` in `external` array (Phase 6 D-16(a) stays — they remain runtime requires; this preserves bundle-size posture for the non-agent code path)
  - `.github/workflows/ci.yml`: REMOVE the grep step that asserts `dist/cli.mjs` does NOT contain `ws`/`reconnecting-websocket` strings. With dynamic import, the strings appear in the bundle as `await import('ws')` runtime references, which is correct and expected.
  - `biome.json`: NARROW the `noRestrictedImports` rule scope from `packages/xci/src/**` to `packages/xci/src/cli.ts` only. The agent module (`packages/xci/src/agent/**`) is explicitly allowed to import `ws` and `reconnecting-websocket` synchronously.

- **D-02:** **Lazy load the agent module.** In `cli.ts`, detect `--agent` in `process.argv` BEFORE Commander parses (literal string scan). If present, `await import('./agent/index.js')` and hand off; agent module's first line then imports `ws` + `reconnecting-websocket` (now allowed by narrowed Biome rule). The non-agent code path NEVER touches the agent module — preserves <300ms cold start (Phase 6 D-17 hyperfine gate stays green).

- **D-03:** **Bundle-size gate (Phase 6 SC-2 deferred) stays deferred.** `xci --version` cold start unchanged; bundle size MAY grow modestly when ws is imported by the agent path, but tsup's `external` config means ws/reconnecting-websocket are NOT bundled into `dist/cli.mjs` — they're resolved from `node_modules` at runtime. So bundle size delta should be near zero for the cli entry; only the agent module itself adds size.

### CLI Surface (xci agent mode)

- **D-04:** **Top-level flags, not a subcommand.** Per ATOK-02 wording (`xci --agent <url> --token <T>`), this is a flag-driven mode. Commander v14 supports `--agent <url>` as a global option; when present, the program enters daemon mode (skip alias lookup, skip `--list`, skip everything else).
- **D-05:** **Flags supported:**
  - `--agent <url>` (required for agent mode) — server WS URL, e.g., `wss://xci.example.com/ws/agent`
  - `--token <reg-token>` (required for first-time registration; OPTIONAL on subsequent runs if credential file exists)
  - `--label key=value` (repeatable) — custom labels appended to the auto-detected ones (os, arch, node_version, hostname)
  - `--hostname <name>` (optional) — override auto-detected hostname locally; the server-side soft override (AGENT-04) is set via UI/API, not this flag
  - `--config-dir <path>` (optional) — override XDG default for credential storage; defaults to `~/.config/xci/`
- **D-06:** **Conflict handling:** if `--agent` is set but argv ALSO contains an alias (e.g., `xci --agent wss://… build`), exit non-zero with `LociError(AgentModeArgsError)` — agent mode is daemon-only.

### Credential Storage (xci side)

- **D-07:** **XDG-compliant location, NOT CWD.** Default credential path: `~/.config/xci/agent.json` on Linux/macOS; `%APPDATA%/xci/agent.json` on Windows. Override via `--config-dir <path>`. Per-machine, not per-project (an agent is a daemon, not a project artifact).
- **D-08:** **`agent.json` shape:**
  ```json
  {
    "version": 1,
    "server_url": "wss://xci.example.com/ws/agent",
    "agent_id": "xci_agt_01h...",
    "credential": "<base64url-256bit>",
    "registered_at": "2026-04-18T..."
  }
  ```
  File mode `0600` on POSIX; ACL-restricted on Windows. Validation: parse JSON; reject if `version != 1`.
- **D-09:** **TOFU rule:** if `agent.json` exists AND `--token` is also passed, exit with explicit error: "Agent already registered. To re-register, delete `<path>` and retry." Prevents silent overwrite of permanent credentials.

### Server Side: Schema

- **D-10:** **Three new tables**, all org-scoped (Phase 7 forOrg pattern):
  - `agents`: `id (text PK xci_agt_*)`, `org_id (FK orgs ON DELETE CASCADE)`, `hostname (text)`, `labels (jsonb)`, `state (text default 'offline')`, `last_seen_at (timestamptz nullable)`, `registered_at (timestamptz)`, `created_at`, `updated_at`. Index on `(org_id, state)`.
  - `agent_credentials`: `id (text PK)`, `agent_id (FK agents ON DELETE CASCADE)`, `org_id (FK orgs ON DELETE CASCADE)`, `credential_hash (text)` (sha256 of opaque token, NEVER the plaintext), `created_at`, `revoked_at (nullable)`. Index on `(org_id, agent_id) WHERE revoked_at IS NULL`. Only ONE active credential per agent (partial unique index).
  - `registration_tokens`: `id (text PK)`, `org_id (FK)`, `token_hash (text)`, `created_by_user_id (FK users)`, `created_at`, `expires_at (default now() + 24h)`, `consumed_at (nullable)`. Single-use per ATOK-01.
- **D-11:** **All token comparisons via `crypto.timingSafeEqual()`** (ATOK-06). Centralize in a `compareToken(provided, expected)` helper in `packages/server/src/crypto/tokens.ts` (mirror Phase 7 pattern).
- **D-12:** **State enum:** `'online' | 'offline' | 'draining'`. `online` is COMPUTED at read time (`state = 'online' AND last_seen_at > now() - 60s`); the column stores the desired/admin-set state. A periodic job is NOT needed for offline detection — read-side computation suffices.

### Server Side: WebSocket Endpoint

- **D-13:** **`@fastify/websocket@11.x`** (latest compatible with Fastify 5.x). Endpoint: `GET /ws/agent` (HTTP upgrade). NO authentication on the HTTP upgrade — tokens NEVER in URL (ATOK-03).
- **D-14:** **Open-then-handshake auth flow:**
  1. WS opens unauthenticated. Server sets a 5s timeout for the first frame.
  2. Agent sends `{type: 'register', token: '<reg-token>', labels: {...}}` (first time) OR `{type: 'reconnect', credential: '<perm-cred>', running_runs: [...]}` (subsequent).
  3. Server validates; on success sends `{type: 'register_ack', agent_id, credential}` (first time) or `{type: 'reconnect_ack', reconciliation: [...]}`.
  4. Server adds the WS to its `Map<agentId, WebSocket>` registry, marks `agents.state='online'`, `last_seen_at=now()`.
  5. Heartbeat begins.
- **D-15:** **Frame envelope schema (DEFINED in Phase 8, not all IMPLEMENTED):**
  ```ts
  type AgentFrame =
    | { type: 'register'; token: string; labels: Record<string,string> }       // P8 — agent → server
    | { type: 'reconnect'; credential: string; running_runs: RunState[] }      // P8 — agent → server
    | { type: 'goodbye'; running_runs: RunState[] }                            // P8 — agent → server
    | { type: 'state'; state: 'draining' | 'online' }                          // P8 — server → agent
    | { type: 'register_ack'; agent_id: string; credential: string }           // P8 — server → agent
    | { type: 'reconnect_ack'; reconciliation: ReconcileEntry[] }              // P8 — server → agent
    | { type: 'error'; code: string; message: string; close: boolean }         // P8 — server → agent
    | { type: 'dispatch'; run_id: string; ... }                                 // P10 — RESERVED, not implemented
    | { type: 'cancel'; run_id: string }                                        // P10 — RESERVED
    | { type: 'log_chunk'; run_id: string; seq: number; data: string }          // P11 — RESERVED
    | { type: 'result'; run_id: string; exit_code: number; ... };               // P10 — RESERVED
  ```
  All frames JSON-encoded text (not binary). Schema validated server-side via zod (or hand-rolled — planner picks; lean toward hand-rolled to avoid adding zod just for this).
- **D-16:** **Heartbeat:** server uses standard WS `ping` (`ws.ping()`) every 25s. Agent's `ws` library auto-replies with `pong`. Server tracks `last_seen_at = max(now() at message receive, now() at pong)`. Pong timeout 10s → close WS with reason `heartbeat_timeout`, mark `agents.state='offline'`.
- **D-17:** **Connection registry:** `Map<agentId, WebSocketWrapper>` on the buildApp instance, decorated as `fastify.agentRegistry`. Per-process; in-memory. Single-instance assumption (multi-instance scaling deferred). On WS close (any reason), remove from registry, set `state='offline'`.
- **D-18:** **Reconnection ack `reconciliation`:** array of `{run_id, action: 'continue' | 'abandon'}`. For each `running_runs[]` entry from the agent: if DB shows the run is still active, continue; if DB shows completed/cancelled, abandon. Phase 10 will exercise the dispatch/result side; Phase 8 just plumbs the framework with a stub that always returns `[]` (no real runs to reconcile yet).

### Server Side: Routes

- **D-19:** **REST routes (Phase 8 scope):**
  - `POST /api/orgs/:orgId/agent-tokens` — Owner/Member only + CSRF; creates a new registration token, returns `{token, expiresAt}` (token shown ONCE — server stores hash). Rate limit 10/h per org.
  - `GET /api/orgs/:orgId/agents` — any org member; returns `[{id, hostname, labels, state, last_seen_at, registered_at}]`. Computes `state` per D-12.
  - `PATCH /api/orgs/:orgId/agents/:agentId` — Owner/Member + CSRF; mutable fields: `hostname` (AGENT-04 soft override), `state` (toggle to/from `draining` per AGENT-06).
  - `POST /api/orgs/:orgId/agents/:agentId/revoke` — Owner/Member + CSRF; sets `agent_credentials.revoked_at = now()` and force-closes WS if currently connected. ATOK-04.
  - `DELETE /api/orgs/:orgId/agents/:agentId` — Owner only + CSRF; hard-delete (CASCADE removes credentials). Use sparingly.
- **D-20:** **No public agent listing — every route requires session.** No badge/public endpoint here (BADGE is Phase 13).

### Reconciliation Strategy (AGENT-07)

- **D-21:** **Server is authoritative on COMPLETED runs.** If an agent reports a `run_id` as still running but the DB shows it `succeeded`/`failed`/`cancelled`/`timed_out`, server sends `reconciliation: [{run_id, action: 'abandon'}]`. Agent kills the local subprocess on receipt.
- **D-22:** **Agent is authoritative on STATE OF DISPATCH.** If DB shows `dispatched` but agent reports `running`, server promotes DB to `running`. (Phase 10 fully implements this; Phase 8 just defines the API surface with no actual run rows yet.)
- **D-23:** **Unknown run_ids from agent → abandon.** Run was created and cancelled while agent was disconnected; agent has no record on server.

### Drain Mode (AGENT-06)

- **D-24:** **Drain set via PATCH route (D-19).** When `state` flips to `draining`, server sends `{type: 'state', state: 'draining'}` frame to the connected WS (if present). Agent records this; subsequent dispatch attempts (Phase 10) skip draining agents.
- **D-25:** **Drain → online transition** also valid via the same PATCH (admin can un-drain).
- **D-26:** **Phase 8 does NOT implement "wait for in-flight to finish" logic in the agent** — there are no in-flight runs to wait for (Phase 10 introduces them). Agent just stores the state and respects it on shutdown.

### Graceful Shutdown (AGENT-08)

- **D-27:** **Agent SIGINT/SIGTERM handler:**
  - Send `{type: 'goodbye', running_runs: []}` (empty array in Phase 8 since no runs yet).
  - Wait up to 5s for server `ack` (or just for socket flush).
  - Close WS with code 1000 (normal closure).
  - Process.exit(0).
- **D-28:** **Server on `goodbye`:** mark `state='offline'`, remove from registry. Don't wait — it's a clean exit.

### Cold-Start Preservation

- **D-29:** **Hyperfine gate stays green.** Verify by running `hyperfine 'node packages/xci/dist/cli.mjs --version'` in CI integration job — must remain <300ms mean. The argv-string check for `--agent` runs BEFORE any heavy imports; if not present, no agent code is loaded. Test this explicitly in a smoke test.
- **D-30:** **`--help` and `--version` paths must NOT trigger agent module load.** Commander parses these before our argv scan; safe.

### Testing Strategy

- **D-31:** **In-process WS pair** for most server tests. Use `@fastify/websocket` with `fastify.inject` is NOT supported for WS — instead, start the app on an ephemeral port via `app.listen({port: 0})`, get the assigned port, connect a `ws` client to it, exercise the handshake. Tests live in `packages/server/src/routes/agent/__tests__/*.integration.test.ts` and run in the existing testcontainers setup (Phase 7 D-20).
- **D-32:** **Agent-side tests use a mock server.** A small Fastify+@fastify/websocket harness in `packages/xci/src/agent/__tests__/test-server.ts` accepts connections, asserts handshake content, replies with scripted frames. Tests live in `packages/xci/src/agent/__tests__/*.test.ts`. These are unit-ish (no Docker) — run on the full 3×2 matrix.
- **D-33:** **End-to-end test (one):** spawn `xci --agent ws://localhost:<port> --token <t>` as a child process via `execa`, against a real Fastify+WS server running in the test process. Verify: connection happens, registration succeeds, credential file is written to a temp dir (use `--config-dir <tmp>`), agent can be killed cleanly. ONE such test, in `packages/server/src/__tests__/agent-e2e.integration.test.ts`. Linux-only (D-23 from Phase 7).

### Schema & Migrations

- **D-34:** **Single new migration file** `packages/server/drizzle/0001_agents.sql` produced by `pnpm --filter @xci/server exec drizzle-kit generate`. Contains all 3 new tables + indexes + FKs. Committed.
- **D-35:** **Drizzle schema files** added to `packages/server/src/db/schema.ts` (extend the existing file with new table definitions); relations updated in `packages/server/src/db/relations.ts`.

### Repos (Phase 7 forOrg pattern extended)

- **D-36:** **Three new org-scoped repos:**
  - `packages/server/src/repos/agents.ts` — `makeAgentsRepo(db, orgId)`: list, getById, create, updateState, updateHostname, recordHeartbeat (sets `last_seen_at = NOW()`), softDelete
  - `packages/server/src/repos/agent-credentials.ts` — `makeAgentCredentialsRepo(db, orgId)`: createForAgent (stores hash), revoke, findActiveByHash (cross-org variant in adminRepo for connection lookup since session doesn't exist yet during WS open)
  - `packages/server/src/repos/registration-tokens.ts` — `makeRegistrationTokensRepo(db, orgId)`: create, listActive, revoke; consume (cross-org) lives in adminRepo
- **D-37:** **adminRepo additions:**
  - `findValidRegistrationToken(token)` — cross-org lookup for the WS handshake (server doesn't know the org until token is validated)
  - `consumeRegistrationToken(tokenId)` — atomic: marks consumed_at, returns the org_id
  - `findActiveAgentCredential(credentialPlaintext)` — cross-org lookup for `reconnect` frames; uses `crypto.timingSafeEqual` against the stored hash
  - `registerNewAgent({orgId, hostname, labels})` + `issueAgentCredential(agentId)` — atomic transaction creating agent row + first credential
- **D-38:** **Two-org isolation tests** for the 3 new repos (Phase 7 D-04 contract). The `isolation-coverage.isolation.test.ts` meta-test will automatically detect them and require coverage.

### CSRF & Rate Limit Updates

- **D-39:** **CSRF on all agent management routes.** Already covered by Phase 7's per-route opt-in pattern. Apply `csrfProtection: true` to all PATCH/POST/DELETE in D-19.
- **D-40:** **Rate limits:**
  - `POST /api/orgs/:orgId/agent-tokens` — 10/h per org+user
  - WS `register` frame validation — server tracks attempts per IP, max 30/min (mitigates token brute-force)
  - WS `reconnect` frame validation — same 30/min per IP

### Email (NOT in Phase 8 scope)

- **D-41:** No new email templates in Phase 8. No notifications for agent registration/revoke (Phase 13 adds UI notifications).

### Backward Compat

- **D-42:** **v1 fence preserved.** `pnpm --filter xci test` (302 tests) must pass after every plan. xci CLI must still work for non-agent operations identically (no behavior change to alias execution paths). Cold-start <300ms preserved (D-29).
- **D-43:** **Phase 6 size-limit gate stays deferred (per Phase 6 closure).** Bundle size delta from D-01 should be NEAR ZERO for `dist/cli.mjs` (ws + reconnecting-websocket are external + lazy-loaded), but agent module itself adds size. We'll measure and document; not a hard gate this phase.

### Claude's Discretion (planner picks)

- Exact directory layout under `packages/xci/src/agent/` — suggested: `index.ts` (entry), `client.ts` (WS wrapper around reconnecting-websocket), `state.ts` (running runs map, drain state), `credential.ts` (load/save XDG file), `labels.ts` (auto-detect + merge custom), `__tests__/`.
- Exact directory layout under `packages/server/src/routes/agents/` — suggested: `tokens.ts`, `list.ts`, `patch.ts`, `revoke.ts`, `delete.ts`, `index.ts` (registers all under `/orgs/:orgId/agent…`).
- Exact wave order for plan splits.
- Whether to use zod for frame validation or hand-rolled (lean hand-rolled for minimal deps; planner decides).
- Whether to add `xci agent --status` subcommand for debugging (NICE-TO-HAVE; planner can defer).

### Folded Todos

None — `gsd-tools todo match-phase 8` should be checked.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Agent Authentication (ATOK-01..06) — token lifecycle, TOFU, timing-safe compares
- `.planning/REQUIREMENTS.md` §Agent Lifecycle (AGENT-01..08) — heartbeat, reconnect, labels, state, drain, reconciliation, shutdown
- `.planning/REQUIREMENTS.md` §Backward Compatibility (BC-01..04) — v1 test suite + observable identity preserved

### Roadmap
- `.planning/ROADMAP.md` §Phase 8 — goal, depends-on (Phase 7), 5 SCs
- `.planning/ROADMAP.md` §v2.0 Roadmap decisions — `ws` and `reconnecting-websocket` are external[] in cli.ts tsup entry (D-01 confirms this stays); agent token in WS frame body never URL (D-13/D-14)

### Project Vision
- `.planning/PROJECT.md` §Current Milestone v2.0 — Agent layer goals; `xci --agent <url> --token <T>` CLI surface
- `.planning/STATE.md` §Decisions — Phase 6 fence rationale + Phase 7 server architecture inherited here

### Project Instructions
- `CLAUDE.md` §Technology Stack — Node `>=20.5.0`, ESM-only, Biome rules; `ws` and `reconnecting-websocket` library guidance
- `CLAUDE.md` §Cold-Start Budget — <300ms; D-29 preserves this via lazy load

### Prior Phase Context (decisions that carry forward)
- `.planning/phases/06-monorepo-setup-backward-compat-fence/06-CONTEXT.md` D-16 — fence layers; D-01 of THIS phase formally lifts (b) and narrows (c)
- `.planning/phases/06-monorepo-setup-backward-compat-fence/06-CONTEXT.md` D-17 — hyperfine gate stays; D-29 here preserves it
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` D-01 — `forOrg(orgId)` scoped wrapper; new agents/credentials/tokens repos follow this
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` D-03 — `adminRepo` namespace; D-37 here adds cross-org agent helpers
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` D-04 — auto-discovery isolation meta-test; D-38 here adds 3 new repo coverage
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` D-06 — Fastify plugin order; `@fastify/websocket` registers AFTER auth plugin
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` D-08 — `XciServerError` hierarchy; new errors `AgentTokenInvalidError`, `AgentRevokedError`, `AgentRegistrationLimitError` (deferred to Phase 10), `RegistrationTokenExpiredError`
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` D-31..33 — crypto patterns (Argon2 N/A here, but tokens.ts pattern is reused for agent credentials)

### External Specs
- `ws` (https://github.com/websockets/ws) v8.x — server + client API; ping/pong, close codes
- `reconnecting-websocket` v4.x — exponential backoff config, lifecycle events
- `@fastify/websocket` v11.x — plugin API for Fastify v5; routes, connection lifecycle, ping/pong forwarding
- WebSocket Close Codes (RFC 6455 §7.4) — 1000 (normal), 1001 (going away), 1011 (server error); custom 4xxx for app-specific reasons (e.g., 4001=revoked, 4002=token_invalid)
- Node `crypto.timingSafeEqual()` — required by ATOK-06 for all token comparisons

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 7 Patterns Inherited
- **`forOrg(db, orgId)` scoped repo wrapper** (Phase 7 D-01) — agents/agent-credentials/registration-tokens repos extend this exact pattern
- **`adminRepo` namespace** (Phase 7 D-03) — cross-org agent operations (token validation, credential lookup) live here
- **Auto-discovery isolation meta-test** (Phase 7 D-04) — automatically picks up new `*.isolation.test.ts` files for the 3 new repos
- **Fastify plugin order** (Phase 7 D-06 updated) — `@fastify/websocket` registers AFTER auth plugin, BEFORE routes; ensures HTTP routes still get auth wiring
- **`XciServerError` hierarchy** (Phase 7 D-08) — new error subclasses follow the same code-uniqueness + httpStatusFor pattern
- **Per-route CSRF opt-in** (Phase 7 D-34) — agent management routes opt in; WS routes are exempt (auth via handshake, not session cookie)
- **testcontainers + two-org fixture** (Phase 7 D-20..22) — agent registration tests reuse seedTwoOrgs() helper

### `packages/xci/` Reusable Assets
- **`packages/xci/src/cli.ts`** — Commander v14 entry point. The `--agent` argv pre-scan + lazy import lives here. Also where existing alias resolution happens; that path stays untouched.
- **`packages/xci/src/errors.ts`** — `LociError` hierarchy. Add `AgentModeArgsError`, `AgentRegistrationFailedError`, `AgentCredentialReadError`, `AgentCredentialWriteError`. Same `oneOfEachConcrete()` test pattern (Phase 1 P03).
- **`packages/xci/src/types.ts`** — pipeline contracts; agent module gets its own `agent/types.ts` (frame envelope, agent state)
- **`execa@9.x`** — already in dependencies (used for shell commands in v1); reused for child-process E2E test (D-33)
- **No existing `ws` or `reconnecting-websocket` usage** — these are NEW deps in Phase 8 (D-01)

### `packages/server/` Reusable Assets (post-Phase-7)
- **`buildApp(opts)`** (Phase 7 D-05) — extends to register `@fastify/websocket` plugin and the WS handler
- **`makeRepos(db)`** (Phase 7 repos/index.ts) — extends to include `agents`, `agentCredentials`, `registrationTokens` factories under `forOrg`
- **`adminRepo`** (Phase 7) — extends with D-37 helpers
- **`fastify.requireAuth` decorator** (Phase 7 D-09) — applied to all REST agent routes; NOT to WS endpoint (auth via frame)

### Phase 6 Fence (state at start of Phase 8)
- **tsup `external: ['ws', 'reconnecting-websocket']`** — STAYS (D-01)
- **CI grep gate** — REMOVED in this phase (D-01)
- **Biome `noRestrictedImports` rule** — NARROWED to `cli.ts` only (D-01)
- **Hyperfine cold-start gate** — STAYS; verified green by D-29 smoke test
- **Bundle-size gate (deferred)** — STAYS deferred (D-43)

### Integration Points
- `packages/xci/src/cli.ts` — argv pre-scan + lazy import (D-02)
- `packages/server/src/app.ts` — register `@fastify/websocket` plugin
- `packages/server/src/routes/index.ts` — mount agent routes under `/api/orgs/:orgId/agent…` and `/api/orgs/:orgId/agent-tokens`
- `packages/server/src/db/schema.ts` — extend with 3 new tables
- `packages/server/src/db/relations.ts` — add agent → org, agent → credentials, etc.
- `packages/server/src/repos/index.ts` — extend `makeRepos` and `adminRepo`

### Creative Options the Architecture Enables
- The frame envelope (D-15) is forward-compatible — Phase 10 adds `dispatch`/`cancel`/`result`, Phase 11 adds `log_chunk`. Phase 8's discriminated union pattern just gets new variants.
- The `forOrg` repo pattern means an agent can NEVER appear in another org's listing by accident (Phase 7 SC-4 still applies).
- `adminRepo.findActiveAgentCredential` (D-37) is the ONLY entry point that bypasses org-scope at WS open — clearly named, easy to audit.
- The lazy-load pattern (D-02) is reusable: future "modes" (e.g., a webhook receiver process for self-hosted plugins) can ride the same pattern.

</code_context>

<specifics>
## Specific Ideas

- **The Phase 6 fence reversal must be ATOMIC with the agent feature.** Don't lift the fence in a separate "infra" plan and then add the agent code later — the fence existed because there was no legitimate user. Lifting it without adding the user creates a window where regressions can land. Plan 01 in Phase 8 should be: lift fence + scaffold agent module skeleton (empty entry that just connects/disconnects to a stub server) — proves the wiring before committing.

- **Lazy import is non-negotiable.** Every other approach (eager import, conditional bundling) breaks the cold-start gate. The `cli.ts` argv pre-scan is 3 lines. Don't over-engineer it.

- **Token never in URL — verify in tests.** Add a server test that opens WS with a token in the URL and confirms it's REJECTED (or simply ignored). ATOK-03 is a security requirement and a regression here would be silent.

- **`crypto.timingSafeEqual` usage is mechanical but easy to forget.** Centralize in a helper (`compareTokens`) and use it everywhere. Add a Biome rule (or grep CI step) that catches `===` comparisons of variables named `token`/`credential`/`hash`.

- **Reconnection backoff jitter** — `reconnecting-websocket` doesn't add jitter by default; we add it via `reconnectionDelayGrowFactor: 1.5` and a small random offset (10-30% of the computed delay) to prevent thundering-herd reconnects after a server restart.

- **Heartbeat at 25s** is intentional: keeps connections alive through most NAT/firewall timeouts (typically 30-60s). Server-driven (server pings, agent pongs) puts load on the server but means agents can detect a dead server faster.

- **In-memory `Map<agentId, WS>` is fine for single-instance.** Document explicitly that horizontal scaling requires a Redis pub/sub layer or sticky session — out of scope for v2.0.

- **Cold-start verification IS A TEST, not just an aspiration.** Add `packages/xci/src/__tests__/cold-start.test.ts` that uses `child_process.spawnSync` to time `node dist/cli.mjs --version` and asserts <300ms. Run on Linux CI. (Hyperfine gate stays as the primary signal; this is a unit-level smoke.)

- **The `--agent` argv pre-scan in cli.ts must come BEFORE `process.argv = […]` rewrites that other argv parsers might do.** Keep it as the very first lines after imports.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-instance server with sticky-session WS** — out of scope for v2.0; in-memory registry suffices.
- **Redis-backed WS connection registry** — same; deferred until horizontal scaling forces it.
- **Agent-side metrics endpoint (Prometheus exporter)** — deferred to v2.1+.
- **Agent self-update / auto-upgrade on credential rotation** — out of scope; manual `xci` upgrade only.
- **Quota enforcement at registration (max_agents=5)** — Phase 10 owns QUOTA-03 per roadmap; Phase 8 implements registration WITHOUT the gate.
- **WebSocket compression (permessage-deflate)** — deferred; default WS perf is sufficient for handshake/heartbeat (Phase 11 may revisit when log streaming starts).
- **Mutual TLS (mTLS) for agent connections** — deferred; bearer credential in handshake is sufficient with TLS terminator.
- **Agent labels via env vars (in addition to --label flag)** — nice-to-have, defer.
- **`xci agent --status` debugging subcommand** — defer to a later quick task.
- **Owner role transfer / agent ownership transfer between users** — out of scope (Phase 13 candidate).
- **Audit log of agent register/revoke actions** — same as Phase 7 deferred audit log.
- **WS frame schema validation via zod (vs hand-rolled)** — leaning hand-rolled to minimize deps; revisit if frame complexity grows.
- **End-to-end load testing with N agents** — out of scope; manual smoke at most.

### Reviewed Todos (not folded)
None — todo-match-phase returned 0 in Phase 7; same expected here.

</deferred>

---

*Phase: 08-agent-registration-websocket-protocol*
*Context gathered: 2026-04-18*
*Mode: auto-selected (user requested autonomous chain to milestone end)*
