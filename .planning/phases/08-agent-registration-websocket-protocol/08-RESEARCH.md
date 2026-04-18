# Phase 8: Agent Registration & WebSocket Protocol — Research

**Researched:** 2026-04-18
**Domain:** WebSocket agent protocol, Fastify v5 WS plugin, credential storage, Drizzle schema extension, Phase 6 fence reversal
**Confidence:** HIGH (all library versions verified against npm registry; API patterns verified via Context7 + official READMEs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All 43 decisions D-01 through D-43 in `.planning/phases/08-agent-registration-websocket-protocol/08-CONTEXT.md` are **LOCKED**. Research does not re-litigate them. Key load-bearing locks:

- **D-01** — Phase 6 ws-fence reversal: add `ws@^8.18.0` + `reconnecting-websocket@^4.4.0` to xci deps; keep tsup `external` for both; REMOVE CI grep gate; NARROW Biome rule to `cli.ts` only.
- **D-02** — Lazy-load agent module: argv pre-scan `process.argv.includes('--agent')` BEFORE Commander, then `await import('./agent/index.js')`.
- **D-03** — Bundle-size gate (SC-2) stays deferred; `dist/cli.mjs` delta near-zero (ws/rws are external + lazy).
- **D-04** — `--agent <url>` as a top-level flag, NOT a subcommand. Commander v14 global option.
- **D-05..06** — Flags: `--agent`, `--token`, `--label key=value` (repeatable), `--hostname`, `--config-dir`. Conflict: `--agent` + alias → non-zero.
- **D-07** — Credential path: `~/.config/xci/agent.json` Linux/macOS (XDG); `%APPDATA%/xci/agent.json` Windows.
- **D-08** — `agent.json` shape: `{version:1, server_url, agent_id, credential, registered_at}`. Mode `0600` on POSIX.
- **D-09** — TOFU: if `agent.json` exists AND `--token` passed → error.
- **D-10** — Three new DB tables: `agents`, `agent_credentials`, `registration_tokens`; all org-scoped.
- **D-11** — All token comparisons via `crypto.timingSafeEqual()`, centralized in `packages/server/src/crypto/tokens.ts`.
- **D-12** — State enum `online|offline|draining`; `online` is read-time computed (last_seen_at < 60s).
- **D-13** — `@fastify/websocket@11.x` for Fastify v5. Endpoint `GET /ws/agent`. NO auth on HTTP upgrade.
- **D-14** — Open-then-handshake: 5s timeout, `register`/`reconnect` frames, `register_ack`/`reconnect_ack`.
- **D-15** — Frame envelope as discriminated union in `agent/types.ts`; P10/P11 types RESERVED not implemented.
- **D-16** — Heartbeat: server `ping` every 25s; pong timeout 10s → close 4003; last_seen_at updated on every incoming frame.
- **D-17** — Connection registry: `Map<agentId, WebSocketWrapper>` decorated as `fastify.agentRegistry`. In-process only.
- **D-18** — Reconnect ack `reconciliation: []` (stub; Phase 10 exercises).
- **D-19..20** — REST routes: 5 routes all requiring session. Agent-listing never public.
- **D-21..23** — Reconciliation: server authoritative on completed, agent authoritative on state of dispatch.
- **D-24..26** — Drain via PATCH; `state` frame to agent; no wait-for-in-flight in Phase 8.
- **D-27..28** — Graceful shutdown: `goodbye` frame, 5s flush, WS close(1000), exit(0).
- **D-29..30** — Cold-start gate stays; `--help`/`--version` paths skip agent load.
- **D-31..33** — Testing: in-process WS pair on ephemeral port; mock server in xci; one E2E test Linux-only.
- **D-34..35** — Single migration `0001_agents.sql`; schema in `schema.ts`, relations in `relations.ts`.
- **D-36..38** — Three new repos extending forOrg; adminRepo additions; two-org isolation tests.
- **D-39..40** — CSRF on all agent REST routes; rate limits on token issue + WS register/reconnect frames.
- **D-41** — No new email templates.
- **D-42** — v1 302-test suite preserved; BC-01..04 still applies.
- **D-43** — Bundle-size gate stays deferred.

### Claude's Discretion

- Exact directory layout under `packages/xci/src/agent/` (suggested: `index.ts`, `client.ts`, `state.ts`, `credential.ts`, `labels.ts`, `__tests__/`).
- Exact directory layout under `packages/server/src/routes/agents/` (suggested: `tokens.ts`, `list.ts`, `patch.ts`, `revoke.ts`, `delete.ts`, `index.ts`).
- Exact wave order for plan splits.
- Whether to use zod for frame validation or hand-rolled (lean hand-rolled per D-15 note).
- Whether to add `xci agent --status` subcommand (defer per deferred list).

### Deferred Ideas (OUT OF SCOPE)

- Multi-instance WS registry (Redis pub/sub, sticky session)
- WS compression (permessage-deflate)
- mTLS for agent connections
- Agent labels via env vars
- `xci agent --status` subcommand
- Quota enforcement at registration (QUOTA-03 → Phase 10)
- Task dispatch frames (Phase 10)
- Log streaming frames (Phase 11)
- Agent UI dashboard (Phase 13)
- Audit log of agent register/revoke
- Load testing
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ATOK-01 | Owner/Member generates registration token, single-use 24h | `registration_tokens` schema (§Schema); `generateToken()` reuse from Phase 7 |
| ATOK-02 | `xci --agent <url> --token <T>` handshake; server issues permanent credential | argv pre-scan + lazy import (§Argv Pre-scan); frame protocol (§WS Protocol) |
| ATOK-03 | Token in WS frame body, never URL | Open-then-handshake pattern (§WS Protocol); test verifying no-token-in-URL (§Testing) |
| ATOK-04 | Revoke credential, closes WS immediately | `revoke` REST route + agentRegistry close (§REST Routes) |
| ATOK-05 | Server verifies credential on every reconnect; closes if revoked | `reconnect` frame handler + `compareToken()` (§Token Comparison) |
| ATOK-06 | All token comparisons via `crypto.timingSafeEqual()` | Centralized `compareToken` helper (§Token Comparison) |
| AGENT-01 | Persistent WS + 25s keepalive ping, 10s pong timeout | ws ping/pong heartbeat pattern (§Heartbeat); @fastify/websocket server-side |
| AGENT-02 | Auto-reconnect exponential backoff 1s..30s + jitter | `reconnecting-websocket` options (§reconnecting-websocket) |
| AGENT-03 | Labels: os, arch, node_version, hostname + custom `--label` | `labels.ts` module, `os.hostname()`, `process.arch`, `process.version` |
| AGENT-04 | Hostname soft-override via PATCH route on server side | `agents.hostname` column; PATCH handler (§REST Routes) |
| AGENT-05 | UI shows online/offline/draining state (read-time computation) | `state` column + `last_seen_at < 60s` read computation (§Schema) |
| AGENT-06 | Drain mode via PATCH, `{type:'state', state:'draining'}` frame | `state` frame (§WS Protocol); PATCH route handler |
| AGENT-07 | Task-state reconciliation on reconnect (stub in Phase 8) | `reconnect_ack` with empty `reconciliation: []` (§WS Protocol) |
| AGENT-08 | Graceful shutdown: goodbye frame, flush, WS close(1000), exit(0) | SIGINT/SIGTERM handler (§Graceful Shutdown); WS close codes (§Close Codes) |
| BC-01 | xci without --agent identical to v1 | argv pre-scan early exit; no Commander changes for alias path |
| BC-02 | v1 302-test suite passes unchanged | No changes to existing test files; lazy import means no load regression |
| BC-03 | cli.mjs stays under 200KB; ws/rws not in cli.mjs | tsup `external` preserved; dynamic import (§Lazy Load) |
| BC-04 | Cold-start < 300ms | argv pre-scan is 3 lines before any import; agent module only loaded when `--agent` present |
</phase_requirements>

---

## Summary

Phase 8 is a dual-codebase phase: it extends `packages/xci/` with a lazy-loaded agent daemon and extends `packages/server/` with a WebSocket endpoint, 3 new Drizzle tables, 3 new org-scoped repos, 5 new REST routes, and a connection registry. The single most important architectural moment is the Phase 6 fence reversal: the CI grep gate is removed and the Biome `noRestrictedImports` rule is narrowed from `packages/xci/src/**` to `packages/xci/src/cli.ts` only, atomically with the agent module being added as a legitimate user of `ws` and `reconnecting-websocket`.

The `@fastify/websocket@11.2.0` plugin uses `ws@8.x` internally and exposes the raw `ws.WebSocket` socket object directly to route handlers — `socket.ping()`, `socket.close()`, and `socket.on('pong')` work without any wrapping. The `injectWS` utility introduced in recent versions supports in-process testing without a real network listener, but D-31 prefers an ephemeral-port pattern for full integration coverage. The `reconnecting-websocket@4.4.0` library already adds ~30% jitter to `minReconnectionDelay` by default (`1000 + Math.random() * 4000`); the CONTEXT.md jitter goal is satisfied by the library's defaults plus tuning `reconnectionDelayGrowFactor`.

The critical macOS gotcha: `env-paths@4.0.0` maps `.config` on macOS to `~/Library/Preferences/<name>-nodejs`, not `~/.config/<name>`. D-07 in CONTEXT.md says "~/.config/xci/ on Linux/macOS" which is technically inaccurate for macOS; the planner must decide whether to use `env-paths` as-is (correct cross-platform behavior) or hardcode `~/.config/xci/` (Linux semantics applied to macOS). Research recommends using `env-paths` as-is and documenting the macOS path difference.

**Primary recommendation:** Add `@fastify/websocket@11.2.0` to `@xci/server` dependencies; add `ws@8.20.0`, `reconnecting-websocket@4.4.0`, and `env-paths@4.0.0` to `xci` dependencies. Follow the exact fence reversal in D-01 before any agent code lands. Use `injectWS` for WS unit tests; use the ephemeral-port pattern for integration tests that need the full auth pipeline.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WS upgrade acceptance | API / Backend (@fastify/websocket) | — | HTTP upgrade is server-controlled; no client-side equivalent |
| Handshake auth (register/reconnect frames) | API / Backend (WS handler) | — | Token validation must be server-side; first-frame timeout enforced there |
| Agent credential issuance | API / Backend (adminRepo transaction) | — | Credential must be hashed before persistence; plaintext returned once to agent |
| Connection registry | API / Backend (in-memory Map, fastify.agentRegistry) | — | Per-process; horizontal scaling explicitly deferred |
| Heartbeat (ping/pong) | API / Backend (server sends ping) | Agent CLI (auto-pong from ws library) | Server-driven puts detection latency on server side — acceptable at Phase 8 scale |
| Credential persistence (agent side) | Agent CLI / Filesystem | — | Per-machine daemon config; never in project CWD |
| Reconnection backoff | Agent CLI (reconnecting-websocket) | — | Client-side responsibility; server is passive on reconnect |
| Drain state propagation | API / Backend (PATCH → state frame) | Agent CLI (stores state, respects it on dispatch) | Server owns the state decision; agent implements the behavior |
| Registration token issuance | API / Backend (REST POST) | — | Org-scoped, session-authenticated; agent never participates |
| Cold-start budget enforcement | Agent CLI build (tsup external) | CI (hyperfine gate) | argv pre-scan + external modules = zero overhead on non-agent paths |

---

## Library Versions Table

All versions confirmed via `npm view <pkg> version` on 2026-04-18. [VERIFIED: npm registry]

| Library | Version | ESM | Node Min | Peer / Notes |
|---------|---------|-----|----------|--------------|
| `@fastify/websocket` | **11.2.0** | CJS+ESM | (none declared; Fastify v5 requires Node >=20) | Depends on `ws@^8.16.0`, `duplexify@^4.1.3`, `fastify-plugin@^5.0.0`. TypeScript types built in; also need `@types/ws` (dev). Server package only. |
| `ws` | **8.20.0** | ESM wrapper (`wrapper.mjs` exports `{WebSocket, WebSocketServer, createWebSocketStream, OPEN, …}`) + CJS fallback | >=10.0.0 | ESM: `import { WebSocket, WebSocketServer } from 'ws'`. Used by xci agent AND transitively by @fastify/websocket. |
| `reconnecting-websocket` | **4.4.0** | CJS (no ESM export) | (none declared; works Node >=10) | Zero runtime dependencies. Requires `WebSocket: WS` option when used in Node.js (not a browser). Main: `dist/reconnecting-websocket-cjs.js`. Default delay jitter built-in: `minReconnectionDelay = 1000 + Math.random() * 4000`. |
| `env-paths` | **4.0.0** | ESM only (`"type": "module"`) | >=20 | Zero dependencies. macOS `config` path is `~/Library/Preferences/<name>-nodejs`, NOT `~/.config` — see §env-paths note below. |
| `@types/ws` | **8.18.1** | — | dev-dep | Required for TypeScript when using `ws` in `@xci/server` (for type annotations of the raw socket in WS route handlers). |

**Installation commands:**

```bash
# packages/xci — new deps (agent module)
pnpm --filter xci add ws@8.20.0 reconnecting-websocket@4.4.0 env-paths@4.0.0

# packages/server — new dep (WS plugin)
pnpm --filter @xci/server add @fastify/websocket@11.2.0

# packages/server — dev dep (TypeScript types for ws)
pnpm --filter @xci/server add -D @types/ws@8.18.1
```

---

## Focus Area: ws v8.x Library API

[VERIFIED: Context7 /websockets/ws + official README]

### Server-side (used indirectly via @fastify/websocket)

`@fastify/websocket` passes the raw `ws.WebSocket` socket object to route handlers. All `ws` APIs apply directly:

```typescript
// Route handler receives raw ws.WebSocket as first arg
fastify.get('/ws/agent', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
  // Receive text frames
  socket.on('message', (data: Buffer | string) => {
    const text = data.toString('utf8');
    const frame = JSON.parse(text) as AgentFrame;
  });

  // Send text frames
  socket.send(JSON.stringify({ type: 'register_ack', agent_id: '...', credential: '...' }));

  // Ping (server-driven heartbeat)
  socket.ping();                       // fires 'pong' event on client
  socket.on('pong', () => {            // called when agent's ws library auto-responds
    agent.lastPongAt = Date.now();
  });

  // Track last-seen on every incoming frame
  socket.on('message', () => {
    agent.lastSeenAt = new Date();
  });

  // Close with code + reason
  socket.close(1000, 'normal');
  socket.close(4001, 'revoked');       // 4xxx = app-defined
  socket.terminate();                  // immediate, no close handshake
});
```

### Close Codes (RFC 6455 §7.4)

[CITED: https://datatracker.ietf.org/doc/html/rfc6455#section-7.4]

| Code | Meaning | Phase 8 Usage |
|------|---------|---------------|
| 1000 | Normal closure | Agent graceful shutdown (D-27) |
| 1001 | Going away | Server shutdown (preClose hook) |
| 1008 | Policy violation | (generic; prefer 4xxx for app reasons) |
| 1011 | Server error | Unhandled exception during handshake |
| 4001 | `revoked` (app-defined) | ATOK-04/05: credential revoked |
| 4002 | `token_invalid` (app-defined) | Invalid or expired registration token |
| 4003 | `heartbeat_timeout` (app-defined) | No pong within 10s after ping (D-16) |
| 4004 | `superseded` (app-defined) | Duplicate agent connection (D-17 registry logic) |
| 4005 | `handshake_timeout` (app-defined) | No first frame within 5s (D-14) |

### ESM Import Pattern

```typescript
// For @xci/server (full TypeScript, tsc build)
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';

// For packages/xci/src/agent/ (ESM, bundled via tsup with ws in external)
import WS from 'ws';  // default import works with ESM wrapper.mjs
// OR
import { WebSocket } from 'ws';  // named imports also work
```

### Backpressure Note

`socket.send()` is asynchronous but does not block. For the heartbeat + handshake message volume at Phase 8 scale (< 10 frames per session per minute), backpressure is not a concern. Phase 11 (log streaming) will need to revisit this.

---

## Focus Area: reconnecting-websocket v4.x

[VERIFIED: npm view reconnecting-websocket readme 2026-04-18]

### Node.js Usage Pattern (Browser-first library)

`reconnecting-websocket` defaults to the browser's `globalThis.WebSocket`. On Node.js, the `ws` library must be passed as the `WebSocket` constructor option:

```typescript
import ReconnectingWebSocket from 'reconnecting-websocket';
import WS from 'ws';

const rws = new ReconnectingWebSocket(url, [], {
  WebSocket: WS,                          // REQUIRED on Node.js
  minReconnectionDelay: 1000,             // 1s minimum (AGENT-02)
  maxReconnectionDelay: 30_000,           // 30s cap (AGENT-02)
  reconnectionDelayGrowFactor: 1.5,       // D-01 note: library default is 1.3; tune to 1.5 for slower ramp
  connectionTimeout: 5000,                // 5s connect attempt timeout
  maxRetries: Infinity,                   // reconnect forever (daemon mode)
  startClosed: false,                     // connect immediately on construction
});
```

**Default jitter:** `minReconnectionDelay` defaults to `1000 + Math.random() * 4000` — the library already adds jitter out of the box. If you set `minReconnectionDelay: 1000` explicitly (as D-01 suggests), you lose the built-in jitter. To add jitter back:

```typescript
// Option A: Use a function URL provider with jitter in the delay logic (not native)
// Option B: Accept library default (1000 + rand*4000 first reconnect, then growth)
// Recommended: set minReconnectionDelay to 1000 + Math.random()*500 to keep short but jittered
minReconnectionDelay: 1000 + Math.random() * 500,  // 1.0–1.5s first reconnect
maxReconnectionDelay: 30_000,
```

### Lifecycle Events

```typescript
rws.addEventListener('open', () => {
  // Connected — send handshake frame
  rws.send(JSON.stringify({ type: 'register', token: regToken, labels }));
});

rws.addEventListener('message', (event: MessageEvent<string>) => {
  const frame = JSON.parse(event.data) as ServerFrame;
  // handle register_ack, reconnect_ack, state, error
});

rws.addEventListener('close', (event: CloseEvent) => {
  // code 1000 + wasClean=true → graceful; reconnect-websocket will NOT reconnect
  // code 4001 (revoked) → need to detect and call rws.close() to stop retry
  if (event.code === 4001) {
    rws.close();  // stop reconnecting
    process.exit(1);
  }
});

rws.addEventListener('error', (event: ErrorEvent) => {
  // connection refused, etc. — reconnecting-websocket handles retry automatically
});
```

### Disable Reconnect on Clean Shutdown

```typescript
// On SIGINT/SIGTERM: send goodbye, then close cleanly
rws.close();   // closes without triggering reconnect (uses code 1000 internally)
```

### TypeScript Import Note

`reconnecting-websocket` ships CJS only (`dist/reconnecting-websocket-cjs.js`). In an ESM file bundled by tsup, the default import works:

```typescript
import ReconnectingWebSocket from 'reconnecting-websocket';
// tsup handles the CJS interop; at runtime ws external is resolved from node_modules
```

---

## Focus Area: @fastify/websocket v11.2.0

[VERIFIED: Context7 /fastify/fastify-websocket + official README 2026-04-18]

### Plugin Registration (Position in Plugin Chain)

Per D-06 of Phase 7 CONTEXT.md (plugin order) and the `@fastify/websocket` README: **the plugin must be registered before routes that use it**. For Phase 8, it registers after the auth plugin, before route registration:

```typescript
// In buildApp() — extend D-06 order:
// ... existing Phase 7 plugins ...
await app.register(authPlugin, ...);
await app.register(errorHandlerPlugin);

// Phase 8 addition: register AFTER auth plugin, BEFORE routes
await app.register(fastifyWebsocket, {
  options: { maxPayload: 65536 },    // 64KB max frame — sufficient for handshake frames
  preClose: async function () {
    // Graceful shutdown: send 1001 to all connected agents
    for (const client of this.websocketServer.clients) {
      client.close(1001, 'Server shutting down');
    }
  },
});

await app.register(registerRoutes, { prefix: '/api' });
// WS route at /ws/agent is registered inside registerRoutes (NOT under /api prefix)
```

### WS Route Definition

```typescript
// packages/server/src/routes/agents/ws-handler.ts
import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import fp from 'fastify-plugin';

// Registered WITHOUT the /api prefix (WS endpoint is /ws/agent, not /api/ws/agent)
const wsAgentPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ws/agent', { websocket: true }, (socket: WebSocket, request) => {
    // Auth via first frame — NOT via request.session (no session cookie on WS upgrade)
    // request.user/org/session are null here (auth plugin's onRequest ran but found no cookie)
    handleAgentConnection(fastify, socket, request);
  });
};

export default fp(wsAgentPlugin);
```

**Critical:** The auth plugin's `onRequest` hook still runs before the WS upgrade completes. If no session cookie is present (which is normal for agent connections), `request.session` is null — and that's expected. The WS handler does NOT call `requireAuth`; authentication happens via the first frame.

### Connection Object API

The `socket` parameter is the raw `ws.WebSocket` instance. The previous `@fastify/websocket` v7-v10 API had a `connection.socket` wrapper — **in v11, the socket is passed directly as the first parameter**. All ws APIs apply:

```typescript
// v11 API (current):
fastify.get('/path', { websocket: true }, (socket: WebSocket, request) => {
  socket.send('text');       // send text frame
  socket.ping();             // send ping
  socket.on('pong', cb);     // pong handler
  socket.close(code, reason);
});
```

### injectWS for Unit Testing

`@fastify/websocket` decorates the Fastify instance with `injectWS(path, upgradeContext?)`:

```typescript
// In vitest integration test (no real network listener)
await app.ready();
const ws = await app.injectWS('/ws/agent');

const ackPromise = new Promise<ServerFrame>((resolve) => {
  ws.on('message', (data) => resolve(JSON.parse(data.toString())));
});

ws.send(JSON.stringify({ type: 'register', token: validRegToken, labels: {} }));

const ack = await ackPromise;
expect(ack.type).toBe('register_ack');

ws.terminate();
```

**Note from D-31:** For tests that need the full auth pipeline (e.g., to verify that existing sessions don't interfere, or that rate-limit counters work), use the ephemeral-port pattern with `app.listen({ port: 0 })`:

```typescript
await app.listen({ port: 0, host: '127.0.0.1' });
const port = (app.server.address() as AddressInfo).port;
const ws = new WS(`ws://127.0.0.1:${port}/ws/agent`);
// ... test ...
await app.close();
ws.terminate();
```

### Authentication Bypass Pattern

The WS route at `/ws/agent` bypasses `requireAuth` by NOT adding it as a `preHandler`. Auth happens via first frame. This is the same encapsulation pattern used by the Phase 7 auth-token-verification endpoints that don't require session:

```typescript
// DO NOT add requireAuth to the WS route
fastify.get('/ws/agent', { websocket: true }, (socket, request) => {
  // request.session is null (correct — WS agent has no cookie)
  // Auth via handshake below
});
```

The Phase 7 Biome `noRestrictedImports` override for `packages/server/src/routes/**` blocks direct repo imports but does NOT affect WS-specific auth patterns.

---

## Focus Area: Cross-Platform Credential Storage (env-paths)

[VERIFIED: npm view env-paths readme 2026-04-18]

### env-paths API

```typescript
import envPaths from 'env-paths';

const paths = envPaths('xci', { suffix: '' }); // suffix: '' disables "-nodejs" suffix
paths.config;
// Linux:   ~/.config/xci   (or $XDG_CONFIG_HOME/xci)
// macOS:   ~/Library/Preferences/xci
// Windows: %APPDATA%\xci\Config   (e.g., C:\Users\user\AppData\Roaming\xci\Config)
```

### macOS Discrepancy vs D-07

**D-07 says:** "~/.config/xci/agent.json on Linux/macOS"
**env-paths says:** macOS → `~/Library/Preferences/xci` (NOT `~/.config`)

The planner must choose between:
1. **Use env-paths as-is** — correct per macOS XDG convention; path differs from D-07 wording. Document the difference in `xci --help`.
2. **Hardcode `~/.config/xci/`** — matches D-07 literally but ignores macOS native conventions.

**Research recommendation:** Use `env-paths` with `suffix: ''` and accept that macOS users get `~/Library/Preferences/xci/agent.json`. This is what D-07 *meant* even if the wording says "~/.config". The `--config-dir` override (D-05) gives power users a way out.

### File Write Pattern (0600 permissions)

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join } from 'node:path';
import envPaths from 'env-paths';

async function saveCredential(credential: AgentCredential, configDir?: string): Promise<void> {
  const dir = configDir ?? envPaths('xci', { suffix: '' }).config;
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, 'agent.json');
  const content = JSON.stringify(credential, null, 2);

  // mode: 0o600 = read+write owner only (POSIX). On Windows, this has no effect —
  // Windows ACLs are set by the OS default for user profile directories.
  await writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });
}
```

**Windows note:** `fs.writeFile` `mode` option sets POSIX permissions and is silently ignored on Windows. Windows `%APPDATA%` directories are already ACL-restricted to the current user by default. No additional Windows-specific code needed for Phase 8.

---

## Focus Area: crypto.timingSafeEqual Usage

[ASSUMED: Node.js built-in behavior — standard well-documented API]

### Centralized compareToken Helper

Extend `packages/server/src/crypto/tokens.ts` (currently contains `generateToken()` and `generateId()`):

```typescript
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';

/**
 * Timing-safe token comparison. Both arguments must be the same byte length.
 * Compares UTF-8 encoded strings as buffers.
 * ATOK-06: all token comparisons MUST use this function — never ===.
 *
 * @throws TypeError if a or b have different byte lengths
 */
export function compareToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.byteLength !== b.byteLength) return false;  // length leak is acceptable — attacker knows expected length
  return timingSafeEqual(a, b);
}

/**
 * One-way sha256 hash for at-rest storage of agent credentials and registration tokens.
 * Input: plaintext base64url token string. Output: hex digest.
 * NEVER hash with salt — comparison is by exact match (tokens have 256-bit entropy).
 */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

// compareToken used for registration tokens (compare provided vs hashToken(stored))
// Pattern: compareToken(hashToken(provided), storedHash)
```

**IMPORTANT:** `timingSafeEqual` requires both buffers to be the same length and throws if they are not. The safe pattern is: return false if lengths differ (this is acceptable — the attacker knows the expected token length because all tokens are `randomBytes(32)` = 43 base64url chars). Then call `timingSafeEqual` only when lengths match.

**For agent credentials:** agent sends plaintext credential in `reconnect` frame → server calls `hashToken(provided)` → compares with stored `credential_hash` using `compareToken(hashToken(provided), storedHash)`.

---

## Focus Area: Drizzle Schema for Phase 8

[VERIFIED: Context7 /drizzle-team/drizzle-orm-docs 2026-04-18]

### Three New Tables (extend `packages/server/src/db/schema.ts`)

```typescript
import { jsonb, uniqueIndex, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const agents = pgTable(
  'agents',
  {
    id: text('id').primaryKey(),                              // xci_agt_<rand>
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    labels: jsonb('labels')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    state: text('state', { enum: ['online', 'offline', 'draining'] })
      .notNull()
      .default('offline'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_org_state_idx').on(t.orgId, t.state),
  ],
);

export const agentCredentials = pgTable(
  'agent_credentials',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    credentialHash: text('credential_hash').notNull(),        // sha256(plaintext), never plaintext
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    // Partial unique index: only ONE active credential per agent at a time
    uniqueIndex('agent_credentials_one_active_per_agent')
      .on(t.agentId)
      .where(sql`revoked_at IS NULL`),
    index('agent_credentials_org_agent_idx').on(t.orgId, t.agentId),
  ],
);

export const registrationTokens = pgTable(
  'registration_tokens',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),                  // sha256 of plaintext
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    index('registration_tokens_org_idx').on(t.orgId),
    // Active tokens hot-path index
    index('registration_tokens_active_idx')
      .on(t.orgId)
      .where(sql`consumed_at IS NULL AND expires_at > now()`),
  ],
);
```

**jsonb default note:** Drizzle `jsonb().default({})` emits `DEFAULT '{}'::jsonb` in SQL — this is correct for an empty JSONB object. [VERIFIED: Context7 drizzle jsonb example]

**Partial unique index note:** Drizzle's `uniqueIndex().on(...).where(sql`...`)` syntax is confirmed to work for partial indexes in PostgreSQL. The generated SQL is `CREATE UNIQUE INDEX ... WHERE revoked_at IS NULL`. [VERIFIED: Context7 drizzle index where clause]

### Migration Command

```bash
# Generate migration with descriptive name
pnpm --filter @xci/server db:generate --name agents_websocket
# Produces: packages/server/drizzle/0001_agents_websocket.sql
# Updates:  packages/server/drizzle/meta/_journal.json
```

The `--name` flag for `drizzle-kit generate` is confirmed. [VERIFIED: Context7 drizzle-kit generate --name]

---

## Focus Area: @fastify/websocket Auth Pattern + Plugin Order

### Updated Plugin Order in buildApp()

```typescript
// D-06 order extended for Phase 8:
await app.register(fastifyEnv, ...);
await app.register(dbPlugin, ...);
await app.register(fastifyHelmet, ...);
await app.register(fastifyCookie, ...);
await app.register(fastifyCsrf, ...);
await app.register(fastifyRateLimit, ...);
app.decorate('emailTransport', ...);
await app.register(authPlugin, ...);
await app.register(errorHandlerPlugin);
// Phase 8 NEW: websocket plugin AFTER auth, BEFORE routes
await app.register(fastifyWebsocket, { options: { maxPayload: 65536 } });
await app.register(registerRoutes, { prefix: '/api' });
// WS route registered inside registerRoutes WITHOUT /api prefix
```

### Connection Registry Decoration

```typescript
// In app.ts type augmentation:
declare module 'fastify' {
  interface FastifyInstance {
    emailTransport: EmailTransport;
    agentRegistry: Map<string, WebSocket>;   // Phase 8 addition
  }
}

// In buildApp():
app.decorate('agentRegistry', new Map<string, WebSocket>());
```

---

## Focus Area: WS Handshake Protocol

[ASSUMED: Protocol design per CONTEXT.md D-14..D-18; no external spec to verify]

### Server-Side Handler Pseudocode

```typescript
function handleAgentConnection(fastify: FastifyInstance, socket: WebSocket, request: FastifyRequest) {
  let authenticated = false;
  let agentId: string | null = null;

  // D-14: 5-second first-frame timeout
  const handshakeTimer = setTimeout(() => {
    if (!authenticated) {
      socket.close(4005, 'handshake_timeout');
    }
  }, 5000);

  // Track last-seen on every incoming frame (D-16)
  socket.on('message', async (data) => {
    const frame = parseAgentFrame(data.toString('utf8'));

    if (!authenticated) {
      clearTimeout(handshakeTimer);
      await handleHandshake(fastify, socket, request, frame);
      return;
    }

    // After auth — handle lifecycle frames (goodbye, etc.)
    await handleLifecycleFrame(fastify, socket, agentId!, frame);
  });

  // D-17: cleanup on close
  socket.on('close', async () => {
    if (agentId) {
      fastify.agentRegistry.delete(agentId);
      await setAgentOffline(fastify.db, agentId);
    }
  });

  socket.on('error', (err) => {
    fastify.log.error({ err }, 'agent ws error');
  });
}
```

### Heartbeat Implementation (server-side)

Based on the ws heartbeat pattern [VERIFIED: Context7 /websockets/ws]:

```typescript
// Heartbeat state stored per-connection (not on wss.clients — @fastify/websocket doesn't
// expose wss directly; track via agentRegistry)
interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  lastPongAt: number;
  pingTimer: NodeJS.Timeout;
  pongTimer: NodeJS.Timeout | null;
}

function startHeartbeat(conn: AgentConnection, db: PostgresJsDatabase): void {
  conn.pingTimer = setInterval(async () => {
    if (conn.ws.readyState !== WebSocket.OPEN) return;

    conn.pongTimer = setTimeout(() => {
      conn.ws.close(4003, 'heartbeat_timeout');
    }, 10_000); // 10s pong timeout (D-16)

    conn.ws.ping();
  }, 25_000); // 25s interval (D-16)

  conn.ws.on('pong', async () => {
    if (conn.pongTimer) clearTimeout(conn.pongTimer);
    conn.lastPongAt = Date.now();
    // Update last_seen_at in DB on every pong
    await repos.agents.recordHeartbeat(conn.agentId);
  });
}

// Cleanup on close
function stopHeartbeat(conn: AgentConnection): void {
  clearInterval(conn.pingTimer);
  if (conn.pongTimer) clearTimeout(conn.pongTimer);
}
```

### Duplicate Agent Connection (D-17)

```typescript
// When a new connection authenticates as agentId X:
const existingConn = fastify.agentRegistry.get(agentId);
if (existingConn) {
  // Close old connection with 4004 (superseded), then register new one
  existingConn.close(4004, 'superseded');
  fastify.agentRegistry.delete(agentId);
}
fastify.agentRegistry.set(agentId, socket);
```

---

## Focus Area: Argv Pre-Scan in cli.ts

[ASSUMED: pattern design; no external spec]

### Insertion Point in cli.ts

Looking at the existing `main()` function in `packages/xci/src/cli.ts`, the `--get-completions` early exit at line 708 is the model to follow. The `--agent` pre-scan goes FIRST, before even `--get-completions`:

```typescript
// In main(argv: readonly string[]) — at the very top, BEFORE any other checks:
async function main(argv: readonly string[]): Promise<number> {
  // D-02: argv pre-scan for agent mode — MUST be first, before Commander touches anything
  // --help and --version: Commander handles these; they do NOT reach this code path
  // because they'd need --agent to be present, which they wouldn't be
  if (argv.includes('--agent')) {
    // D-06: if an alias also appears, exit with error
    const nonFlagArgs = argv.slice(2).filter(a => !a.startsWith('-'));
    if (nonFlagArgs.length > 0) {
      process.stderr.write(
        'error [AGENT_MODE_ARGS]: --agent mode is daemon-only. ' +
        'Remove the alias argument or do not use --agent.\n'
      );
      return 60;  // new exit code for agent errors
    }

    const { runAgent } = await import('./agent/index.js');
    return runAgent(argv.slice(2));
    // Note: process.exit() is called inside runAgent on SIGINT/SIGTERM;
    // the return value is the exit code for normal completion.
  }

  // Existing early exit for completions
  if (argv[2] === '--get-completions') { ... }
  // ... rest of main unchanged
}
```

**Edge case: `xci --agent` with no URL value.** The agent module's `index.ts` parses its own argv and should emit a clear error: "Missing required flag --agent <url>". This is caught inside `runAgent`, not here.

**`--help` and `--version` exemption:** These never trigger the `--agent` branch because Commander handles `--help`/`--version` via `.exitOverride()` and never reaches `--agent` logic. However: `xci --agent --help` WOULD enter agent mode and the agent module would need to handle `--help` gracefully. Planner decision: the agent module should detect `--help` in its own argv parsing and print usage.

---

## Focus Area: Lazy Import in tsup-Bundled ESM

[ASSUMED: tsup/esbuild behavior; verified via tsup.config.ts file contents]

### Current tsup Config (packages/xci/tsup.config.ts)

```typescript
external: ['ws', 'reconnecting-websocket'],
noExternal: [/^(?!ws$|reconnecting-websocket$).*/],
splitting: false,
```

### Separate Entry Recommendation (Agent Module)

With `splitting: false` (current), a dynamic `await import('./agent/index.js')` inside the bundled `cli.mjs` would either:
- (A) Bundle `agent/index.ts` into `cli.mjs` (if tsup resolves the dynamic import statically) — this violates the cold-start goal because `ws` and `reconnecting-websocket` code paths load.
- (B) Leave `agent/index.js` as an external runtime import — which would require `dist/agent.mjs` to exist separately.

**The correct approach (recommended by CONTEXT.md D-03):** Add `packages/xci/src/agent/index.ts` as a SECOND tsup entry. This produces `dist/agent.mjs` as a separate file. The dynamic `import('./agent/index.js')` in `cli.mjs` then becomes a Node.js runtime dynamic import of the separate file — not bundled into `cli.mjs`:

```typescript
// packages/xci/tsup.config.ts update:
export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    agent: 'src/agent/index.ts',   // NEW: separate entry
  },
  // ... rest unchanged
  splitting: false,  // stays false; entries are independent bundles
});
```

`dist/cli.mjs` grows by 0 bytes (ws/rws are external; agent code is in separate entry).
`dist/agent.mjs` is a new file (~20-50KB estimated) that loads only when `--agent` is in argv.

**Runtime import path:** In the built output, `await import('./agent/index.js')` resolves to `dist/agent.mjs` via the `.mjs` → `.js` extension aliasing in tsup's `outExtension`. This requires the dynamic import to use the `.js` suffix (which it would, per `verbatimModuleSyntax: true` in tsconfig).

**Verification:** After build, `dist/cli.mjs` should NOT contain the strings `reconnecting-websocket` or `ws` except as the `external` runtime reference comments that tsup emits (not code). The existing CI grep gate checks for `['"](ws)['"']` — the gate will pass because the dynamic import string `'./agent/index.js'` doesn't match the grep pattern.

---

## Focus Area: Repos Pattern for Three New Tables

### Pattern (Following Phase 7 forOrg)

```typescript
// packages/server/src/repos/agents.ts
export function makeAgentsRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async list(): Promise<Agent[]> { ... },
    async getById(id: string): Promise<Agent | null> { ... },
    async create(params: { hostname: string; labels: Record<string,string> }): Promise<Agent> { ... },
    async updateState(id: string, state: 'online' | 'offline' | 'draining'): Promise<void> { ... },
    async updateHostname(id: string, hostname: string): Promise<void> { ... },
    async recordHeartbeat(id: string): Promise<void> {
      // Sets last_seen_at = NOW() + updatedAt = NOW()
    },
    async softDeleteCredentials(id: string): Promise<void> { ... }, // not hard delete, per D-37
  };
}

// packages/server/src/repos/agent-credentials.ts
export function makeAgentCredentialsRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async createForAgent(agentId: string, credentialHash: string): Promise<AgentCredential> { ... },
    async revokeForAgent(agentId: string): Promise<void> {
      // Sets revoked_at = NOW() on the active credential
    },
    async findActiveByAgentId(agentId: string): Promise<AgentCredential | null> { ... },
  };
}

// packages/server/src/repos/registration-tokens.ts
export function makeRegistrationTokensRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async create(createdByUserId: string): Promise<{ id: string; tokenPlaintext: string; expiresAt: Date }> {
      // generates token, stores hash, returns plaintext ONCE
    },
    async listActive(): Promise<RegistrationToken[]> { ... },
    async revoke(id: string): Promise<void> { ... },
  };
}
```

### AdminRepo Additions (D-37)

```typescript
// In packages/server/src/repos/admin.ts — extend makeAdminRepo():
findValidRegistrationToken(tokenPlaintext: string): Promise<{ id: string; orgId: string } | null>
  // sha256(tokenPlaintext), compare with stored tokenHash (timingSafeEqual);
  // filter: consumed_at IS NULL AND expires_at > now()

consumeRegistrationToken(tokenId: string): Promise<string>
  // atomic: sets consumed_at = now(), returns orgId

findActiveAgentCredential(credentialPlaintext: string): Promise<{ agentId: string; orgId: string } | null>
  // sha256(credentialPlaintext), compare with credential_hash; filter: revoked_at IS NULL

registerNewAgent(params: { orgId: string; hostname: string; labels: Record<string,string> }): Promise<{ agentId: string; credentialPlaintext: string }>
  // transaction: insert agent row + insert agent_credentials row; return credential plaintext ONCE

issueAgentCredential(agentId: string, orgId: string): Promise<string>
  // generate new credential, revoke old (if any), store new hash, return plaintext
```

### forOrg Extension in repos/index.ts

```typescript
// Extend makeForOrg() return:
agents: makeAgentsRepo(db, orgId),
agentCredentials: makeAgentCredentialsRepo(db, orgId),
registrationTokens: makeRegistrationTokensRepo(db, orgId),
```

---

## Focus Area: REST Routes

### Route Registration (packages/server/src/routes/agents/index.ts)

```typescript
// Mounted at /api (from registerRoutes prefix) + /orgs/:orgId prefix:
// POST   /api/orgs/:orgId/agent-tokens          → tokens.ts
// GET    /api/orgs/:orgId/agents                → list.ts
// PATCH  /api/orgs/:orgId/agents/:agentId       → patch.ts
// POST   /api/orgs/:orgId/agents/:agentId/revoke → revoke.ts
// DELETE /api/orgs/:orgId/agents/:agentId       → delete.ts
```

All 5 routes use `preHandler: [fastify.requireAuth]` (Phase 7 pattern). CSRF protection applied per Phase 7 D-34 (POST/PATCH/DELETE). No WS auth on REST routes.

### Computed `state` for GET /agents

Per D-12: `state` column stores `offline`/`draining`. The read-side `online` is computed:

```typescript
// In list handler:
const agentsWithComputedState = agents.map(agent => ({
  ...agent,
  state: agent.state === 'draining'
    ? 'draining'
    : (agent.lastSeenAt && Date.now() - agent.lastSeenAt.getTime() < 60_000)
      ? 'online'
      : 'offline',
}));
```

---

## Focus Area: Graceful Shutdown (AGENT-08)

```typescript
// In packages/xci/src/agent/index.ts:
async function handleShutdown(rws: ReconnectingWebSocket): Promise<void> {
  // 1. Stop reconnecting — disable future reconnect attempts
  rws.close();  // sets internal flag; subsequent close events won't trigger reconnect

  // 2. Send goodbye frame (if still connected)
  if (rws.readyState === WebSocket.OPEN) {
    rws.send(JSON.stringify({ type: 'goodbye', running_runs: [] }));

    // 3. Wait up to 5s for socket to flush (no explicit ack needed per D-27)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      rws.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  }

  process.exit(0);
}

// Register SIGINT and SIGTERM
process.once('SIGINT', () => handleShutdown(rws));
process.once('SIGTERM', () => handleShutdown(rws));
```

---

## Focus Area: Testing Infrastructure

### Server-Side WS Tests (D-31)

For integration tests that need the full Fastify plugin chain (auth plugin ran → agentRegistry decorated → WS handler active):

```typescript
// packages/server/src/routes/agents/__tests__/ws-handshake.integration.test.ts
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { buildApp } from '../../../app.js';

describe('agent WS handshake', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let port: number;
  let ws: WebSocket;

  beforeAll(async () => {
    app = await buildApp({ databaseUrl: testDbUrl, logLevel: 'warn' });
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    ws?.terminate();
    await app.close();
  });

  it('registers agent with valid token', async () => {
    const regToken = await createRegistrationToken(app.db, testOrg.id, testUser.id);
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent`);
    const ack = await new Promise<ServerFrame>((resolve, reject) => {
      ws.once('open', () => ws.send(JSON.stringify({
        type: 'register', token: regToken, labels: { os: 'linux' }
      })));
      ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      ws.once('error', reject);
    });
    expect(ack.type).toBe('register_ack');
  });

  it('rejects token in URL query param (ATOK-03)', async () => {
    const regToken = 'fake-token';
    ws = new WebSocket(`ws://127.0.0.1:${port}/ws/agent?token=${regToken}`);
    const closeEvent = await new Promise<{ code: number }>((resolve) => {
      ws.once('open', () => ws.send(JSON.stringify({ type: 'reconnect', credential: 'x', running_runs: [] })));
      ws.once('close', (code) => resolve({ code }));
    });
    // Server should not have authenticated via URL; should close with 4002
    expect([4002, 4005]).toContain(closeEvent.code);
  });
});
```

### Agent-Side Mock Server (D-32)

```typescript
// packages/xci/src/agent/__tests__/test-server.ts
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';

export async function createTestServer(handler: (socket: WebSocket, frames: string[]) => void) {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);

  app.get('/ws/agent', { websocket: true }, (socket) => {
    const frames: string[] = [];
    socket.on('message', (data) => {
      frames.push(data.toString());
      handler(socket, frames);
    });
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;
  return { app, port };
}
```

### E2E Test (D-33)

```typescript
// packages/server/src/__tests__/agent-e2e.integration.test.ts
import { execa } from 'execa';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('full agent registration flow', async () => {
  const configDir = await mkdtemp(join(tmpdir(), 'xci-e2e-'));
  try {
    const regToken = await createRegistrationToken(app.db, testOrg.id, testUser.id);

    // Spawn xci --agent with temp config dir
    const proc = execa(
      'node',
      [join(xciDistDir, 'cli.mjs'), '--agent', `ws://127.0.0.1:${port}/ws/agent`,
       '--token', regToken, '--config-dir', configDir],
      { timeout: 10_000 }
    );

    // Wait for credential file to appear (poll or use process output)
    await waitForFile(join(configDir, 'agent.json'), 5000);

    const cred = JSON.parse(await readFile(join(configDir, 'agent.json'), 'utf8'));
    expect(cred.version).toBe(1);
    expect(cred.agent_id).toMatch(/^xci_agt_/);

    proc.kill('SIGTERM');
    await proc;
  } finally {
    await rm(configDir, { recursive: true });
  }
}, 15_000);
```

---

## Phase 6 Fence Reversal Checklist

Every file that changes to lift D-16 (from Phase 6) in Phase 8:

| File | Change | Direction |
|------|--------|-----------|
| `packages/xci/package.json` | Add `"ws": "8.20.0"` and `"reconnecting-websocket": "4.4.0"` and `"env-paths": "4.0.0"` to `dependencies` | ADD |
| `packages/xci/tsup.config.ts` | Add `agent: 'src/agent/index.ts'` to `entry`; keep `external: ['ws', 'reconnecting-websocket']` unchanged; keep `noExternal` regex unchanged | MODIFY entry only |
| `.github/workflows/ci.yml` | Remove the entire `WS-exclusion grep gate (D-16b)` step (lines 71-76 in current file). The `fence-gates` job continues to run for the cold-start gate (D-17). | REMOVE step |
| `biome.json` | Change the first `overrides.includes` from `"packages/xci/src/**/*.ts"` to `"packages/xci/src/cli.ts"` for the `ws`/`reconnecting-websocket` restriction. Add a new override that REMOVES the restriction for `packages/xci/src/agent/**/*.ts` (or simply, the narrowed includes means agent/ is no longer restricted). Also remove the `packages/server/src/**` ws restriction block (Phase 7 added it as a temporary guard). | MODIFY both overrides |

**Biome change detail:**

```json
// BEFORE (current biome.json, first override):
{ "includes": ["packages/xci/src/**/*.ts"], ... ws/rws restricted ... }

// AFTER (narrowed to cli.ts only):
{ "includes": ["packages/xci/src/cli.ts"], ... ws/rws restricted from cli.ts direct import ... }
// agent/index.ts and all files under agent/ are NOT in the includes → restriction doesn't apply
```

The `packages/server/src/**` override for ws/reconnecting-websocket should also be REMOVED — Phase 8 legitimately adds `@fastify/websocket` which imports `ws` transitively. The Biome rule there was a temporary guard; the `noRestrictedImports` for server-side repo direct imports (the third override block in biome.json) is unrelated and must be preserved.

---

## Common Pitfalls

### Pitfall 1: @fastify/websocket v11 Socket API Change
**What goes wrong:** Code written for `@fastify/websocket` v7-v10 used `connection.socket` to access the raw WebSocket. In v11, the route handler signature changed to `(socket: WebSocket, request)` — `socket` IS the raw WebSocket directly.
**Why it happens:** API breaking change in v11; old tutorials/stack overflow answers still show the wrapper pattern.
**How to avoid:** Type the handler as `(socket: WebSocket, request: FastifyRequest)` immediately. If you see `socket.socket` in any code, it's wrong.
**Warning signs:** TypeScript error "Property 'socket' does not exist on type 'WebSocket'".

### Pitfall 2: reconnecting-websocket Requires WebSocket Constructor on Node.js
**What goes wrong:** `new ReconnectingWebSocket(url, [], {})` throws "WebSocket is not defined" or tries to use `globalThis.WebSocket` (undefined in Node.js).
**Why it happens:** Library defaults to browser's built-in WebSocket.
**How to avoid:** Always pass `{ WebSocket: WS }` in options. This is mandatory for Node.js usage.
**Warning signs:** `ReferenceError: WebSocket is not defined` on first connection attempt.

### Pitfall 3: timingSafeEqual Throws on Unequal Lengths
**What goes wrong:** `timingSafeEqual(a, b)` throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` if buffers are different lengths.
**Why it happens:** The API requires equal-length buffers for the comparison to be constant-time.
**How to avoid:** Always check `a.byteLength !== b.byteLength` and return false before calling `timingSafeEqual`. See the `compareToken` helper above.
**Warning signs:** Unhandled exception crashing the WS handler mid-connection.

### Pitfall 4: WS Tests — Message Handlers Must Register Synchronously
**What goes wrong:** If `socket.on('message', ...)` is registered inside an `await` (e.g., after looking up DB), messages arriving during the await are silently dropped.
**Why it happens:** `@fastify/websocket` README explicitly warns about this.
**How to avoid:** Register all `socket.on('message', ...)` handlers at the top of the route handler synchronously. Store a Promise for async work; make the message handler itself async.
**Warning signs:** Intermittent test failures where `register_ack` never arrives.

### Pitfall 5: macOS env-paths Config Path Differs from D-07 Wording
**What goes wrong:** On macOS, `env-paths('xci', {suffix:''}).config` returns `~/Library/Preferences/xci`, not `~/.config/xci`. Documentation or tests hardcoding `~/.config` will fail on macOS.
**Why it happens:** env-paths follows macOS conventions correctly.
**How to avoid:** Use `env-paths` as-is; test on macOS (or use `--config-dir` in E2E tests). Document the OS-specific paths in xci --help output.
**Warning signs:** E2E test on macOS fails to find `agent.json` at expected path.

### Pitfall 6: tsup splitting:false with Dynamic Import
**What goes wrong:** With `splitting: false`, tsup may inline the dynamically-imported agent module into `cli.mjs` if it statically analyzes the import path.
**Why it happens:** esbuild (the tsup backend) performs static import analysis.
**How to avoid:** Use a SEPARATE tsup entry for the agent module (`entry: { cli: ..., agent: ... }`). The dynamic import in cli.ts then remains a runtime Node.js module load, not a bundled dependency.
**Warning signs:** `dist/` only contains `cli.mjs` (no `agent.mjs`); bundle size increases; ws strings appear in `cli.mjs`.

### Pitfall 7: Biome noRestrictedImports Includes Array Is Literal Match
**What goes wrong:** Narrowing the Biome override `includes` from `packages/xci/src/**/*.ts` to `packages/xci/src/cli.ts` leaves agent module unrestricted — which is the goal. But if there's a typo in the includes glob, the restriction silently stops applying everywhere.
**Why it happens:** Biome `includes` is a glob; `cli.ts` is a file path.
**How to avoid:** After the change, run `biome check packages/xci/src/cli.ts` to verify the rule fires, then run `biome check packages/xci/src/agent/client.ts` to verify it does NOT fire.
**Warning signs:** `biome check` passes on a file that imports `ws` directly in `cli.ts` (restriction not applying).

### Pitfall 8: fastify.agentRegistry Must Be Decorated BEFORE @fastify/websocket Registers Routes
**What goes wrong:** `fastify.agentRegistry` throws "FST_ERR_DEC_ALREADY_PRESENT" if decorated after the WS route tries to access it, or "FST_ERR_DEC_MISSING" if WS handler runs before decoration.
**Why it happens:** Fastify decorator lifecycle.
**How to avoid:** `app.decorate('agentRegistry', new Map())` in `buildApp()` BEFORE `app.register(fastifyWebsocket, ...)`.
**Warning signs:** Fastify boot error or undefined access on first WS connection.

---

## Recommended File Structure

### packages/xci/src/agent/ (new directory)

```
packages/xci/src/agent/
├── index.ts          # runAgent(argv) entry: parse flags, load credential, connect
├── client.ts         # ReconnectingWebSocket wrapper: connect, send, lifecycle events, heartbeat tracking
├── credential.ts     # load/save agent.json via env-paths; TOFU validation
├── labels.ts         # auto-detect os/arch/node_version/hostname; merge --label flags
├── state.ts          # AgentState: running_runs (stub in P8), drain state
├── types.ts          # AgentFrame discriminated union (D-15); RunState stub
└── __tests__/
    ├── test-server.ts          # Mock Fastify+WS server for agent-side tests
    ├── credential.test.ts      # Unit: load/save credential file, TOFU check
    ├── labels.test.ts          # Unit: auto-detect labels, merge custom
    └── client.integration.test.ts  # Agent connects to mock server; register_ack; graceful shutdown
```

### packages/server/src/ additions

```
packages/server/src/
├── ws/
│   ├── handler.ts              # handleAgentConnection: handshake, heartbeat, lifecycle
│   ├── heartbeat.ts            # startHeartbeat / stopHeartbeat helpers
│   ├── registry.ts             # AgentConnection type; registry helpers (get/set/delete)
│   └── frames.ts               # parseAgentFrame: hand-rolled JSON parse + type narrowing
├── routes/
│   ├── agents/
│   │   ├── tokens.ts           # POST /orgs/:orgId/agent-tokens
│   │   ├── list.ts             # GET  /orgs/:orgId/agents
│   │   ├── patch.ts            # PATCH /orgs/:orgId/agents/:agentId
│   │   ├── revoke.ts           # POST /orgs/:orgId/agents/:agentId/revoke
│   │   ├── delete.ts           # DELETE /orgs/:orgId/agents/:agentId
│   │   └── index.ts            # register all 5 routes + WS route at /ws/agent
│   └── index.ts                # extend to import agentRoutes
├── repos/
│   ├── agents.ts               # makeAgentsRepo(db, orgId)
│   ├── agent-credentials.ts    # makeAgentCredentialsRepo(db, orgId)
│   ├── registration-tokens.ts  # makeRegistrationTokensRepo(db, orgId)
│   ├── for-org.ts              # extend with 3 new factories
│   ├── admin.ts                # extend with D-37 cross-org helpers
│   └── index.ts                # re-export (auto-discovered by isolation meta-test)
├── db/
│   ├── schema.ts               # extend with agents, agentCredentials, registrationTokens
│   └── relations.ts            # add agent → org, agent → credentials FK relations
├── crypto/
│   └── tokens.ts               # extend: add hashToken(), compareToken()
└── errors.ts                   # extend: add AgentTokenInvalidError, AgentRevokedError,
                                #          RegistrationTokenExpiredError
```

---

## Sequencing: Task Dependencies

The planner MUST order tasks so that:

1. **Fence reversal first** (D-01): Lift CI grep gate + narrow Biome rule + add package.json deps. This is the prerequisite for ANY agent module code to land without Biome errors.

2. **Agent module skeleton second**: Scaffold `packages/xci/src/agent/` with stub `runAgent()` that just connects and disconnects. Proves the lazy-load wiring works before any real logic.

3. **Server schema + migration third**: Add 3 new tables, run `drizzle-kit generate`, commit migration. No app code yet.

4. **Server repos fourth**: `makeAgentsRepo`, `makeAgentCredentialsRepo`, `makeRegistrationTokensRepo`, adminRepo extensions. Isolation tests for all three.

5. **Server WS handler fifth**: `buildApp()` extended with `@fastify/websocket` + agentRegistry decoration + WS route + handshake handler.

6. **REST routes sixth**: 5 REST endpoints. CSRF + requireAuth wiring.

7. **Agent module complete seventh**: Full `client.ts`, `credential.ts`, `labels.ts`, SIGINT/SIGTERM handler. Real handshake protocol.

8. **Integration + E2E tests eighth**: Server-side integration tests (ephemeral port), agent-side mock server tests, one E2E test.

9. **Cold-start verification last**: Run hyperfine + smoke test to confirm <300ms gate still passes.

**The atomic fence lift (step 1) MUST precede agent code (step 2).** They can be in the same Wave/plan if the planner wants atomicity.

---

## Open Questions for the Planner (RESOLVED — see plan-checker dimension 11 spot-check)

> All 6 questions below were resolved during planning per the gsd-plan-checker verification:
> 1. RESOLVED: env-paths-as-is (Plan 04 Task 1 uses `envPaths('xci', { suffix: '' }).config`)
> 2. RESOLVED: 5 plans (Plans 08-01..08-05)
> 3. RESOLVED: hand-rolled frame validation (D-15; Plan 03 Task 2 `parseAgentFrame` switch on type)
> 4. RESOLVED: `generateId` prefix union extended with `'agt' | 'crd' | 'rtk'` (Plan 02 Task 1)
> 5. RESOLVED: tsup multi-entry `{cli, agent}` (Plan 01 Sub-step B)
> 6. RESOLVED: biome.json server ws override removed (Plan 01 Sub-step G)


1. **macOS credential path**: Use `env-paths` as-is (macOS gets `~/Library/Preferences/xci/agent.json`) or hardcode `~/.config/xci/` (matches D-07 wording)? Research recommends env-paths; planner decides.

2. **Wave/plan count**: 9 steps above could map to 3 plans (fence+schema+repos, WS handler+REST, agent complete+tests) or more granularly. Given Phase 7's ~8 min/plan average, 3-4 plans seem appropriate.

3. **Hand-rolled frame validation vs zod**: D-15 says "lean hand-rolled". The frame type is small (7 implemented types). A simple `switch (frame.type)` with type narrowing suffices for Phase 8. Zod would cost an extra dependency. Recommendation: hand-rolled.

4. **generateId prefix for new types**: D-25 defines `generateId(prefix)` with a fixed union. Phase 8 needs prefixes `agt` (agent), `crd` (credential), `rtk` (registration token). The `generateId` signature must be extended to include these new prefixes.

5. **tsup multi-entry with dynamic import**: The `entry: { cli: ..., agent: ... }` change works correctly for the two-output scenario. Confirm that `packages/xci/package.json` `files` array includes both `dist/cli.mjs` and `dist/agent.mjs` (currently `"dist"` glob covers both — no change needed).

6. **biome.json server noRestrictedImports for ws**: The current `packages/server/src/**` override in `biome.json` blocks `ws` and `reconnecting-websocket` with "Phase 7 does not use WS" message. This override must be REMOVED in Phase 8 — `@fastify/websocket` is now a legitimate dep. The repo-path restrictions (third override block) must be preserved.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `reconnecting-websocket` does NOT reconnect after `rws.close()` is called explicitly | Graceful Shutdown | Agent keeps reconnecting after SIGTERM; must use `startClosed: true` pattern or different stop mechanism |
| A2 | `timingSafeEqual` with different-length buffers throws (not returns false) | Token Comparison | compareToken helper may silently fail without the length pre-check |
| A3 | `env-paths@4.0.0` ESM-only means `await import('env-paths')` works in the tsup-bundled agent module | env-paths | Dynamic import may fail if tsup can't resolve ESM-only package; may need to add to `external` list |
| A4 | Protocol design (open-then-handshake, frame types, close codes) is internal — no external WS protocol authority | WS Protocol | If the planner changes protocol details, no library constraint prevents it |
| A5 | `@fastify/websocket` v11 passes raw `ws.WebSocket` (not a wrapper object) as first handler arg | Focus Area §3 | Handler code accessing `socket.ping()` directly would break if it's wrapped |

**A3 critical action:** `env-paths` is ESM-only and the agent module is also ESM (bundled by tsup). However, since `ws` is already in `external`, and `env-paths` is small, the planner should consider whether to also put `env-paths` in `external` (to avoid bundling it into `agent.mjs`) or bundle it (it has no native deps — bundling is fine). Recommendation: bundle it (no dep of deps; pure JS; adds ~2KB).

---

## Sources

### Primary (HIGH confidence)
- `npm view @fastify/websocket version` + README (via `npm view`) — 11.2.0 confirmed, socket API, injectWS, hooks
- `npm view ws version` + Context7 `/websockets/ws` — 8.20.0 confirmed, ping/pong heartbeat, close codes
- `npm view reconnecting-websocket readme` — 4.4.0 confirmed, Node.js WebSocket option, options API, jitter defaults
- `npm view env-paths readme` — 4.0.0 confirmed, macOS `~/Library/Preferences`, XDG Linux, Windows `%APPDATA%`
- `npm view @types/ws version` — 8.18.1 confirmed
- Context7 `/drizzle-team/drizzle-orm-docs` — jsonb column, partial uniqueIndex with where(), index on multiple columns
- Context7 `/drizzle-team/drizzle-orm-docs` — drizzle-kit generate --name flag
- Existing `packages/server/src/app.ts` — Fastify v5 plugin order; buildApp() pattern
- Existing `packages/server/src/db/schema.ts` — Drizzle schema conventions; partial unique index precedent (orgMembers owner)
- Existing `packages/server/src/repos/admin.ts` — adminRepo pattern
- Existing `packages/server/src/crypto/tokens.ts` — generateToken/generateId; extension point for hashToken/compareToken
- Existing `biome.json` — exact override structure; both ws-restriction blocks to change
- Existing `.github/workflows/ci.yml` — grep gate step lines; fence-gates job structure

### Secondary (MEDIUM confidence)
- Context7 `/fastify/fastify-websocket` — authentication hooks, plugin registration order, injectWS testing

### Tertiary (LOW confidence / ASSUMED)
- Protocol design (D-14..D-18 handshake flow, frame types, close codes 4001-4005) — derived from CONTEXT.md, no external spec
- `reconnecting-websocket` behavior on explicit `rws.close()` — [ASSUMED A1]
- tsup multi-entry dynamic import behavior — [ASSUMED; recommended based on tsup docs knowledge]

---

## Metadata

**Confidence breakdown:**
- Library versions: HIGH — all verified via `npm view` 2026-04-18
- @fastify/websocket API: HIGH — verified via Context7 + official README
- ws heartbeat API: HIGH — verified via Context7
- reconnecting-websocket Node.js adapter: HIGH — verified via npm README
- env-paths macOS path: HIGH — verified via npm README
- Drizzle jsonb + partial unique index: HIGH — verified via Context7
- Protocol design: MEDIUM — from CONTEXT.md decisions (locked by user); not an external spec
- Lazy import / tsup multi-entry: MEDIUM — based on documented tsup behavior

**Research date:** 2026-04-18
**Valid until:** 2026-05-18 (stable libraries; versions may have patch releases)
