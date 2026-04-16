# Pitfalls Research — xci v2.0: Remote CI (Agents + Web Dashboard)

**Domain:** Distributed CI platform — adding agent-based remote execution, SaaS server, and web dashboard to an existing local CLI tool
**Researched:** 2026-04-16
**Confidence:** HIGH (patterns verified against production CI systems: Buildkite OSS agent, GHA runner source, Drone, Concourse; MEDIUM for xci-specific integration risks)
**Scope:** Pitfalls specific to ADDING these features onto an existing v1 CLI. Generic distributed-systems advice omitted unless directly triggered by this architecture.

---

## HIGHEST-RISK PITFALL

**Multi-tenant data leakage via missing org filter on a single query** (see Pitfall 14). This is the highest-risk pitfall because: it is invisible in tests if no multi-org fixture exists, it does not crash or error — it silently returns wrong data, and the impact is a full tenancy breach. Every other pitfall is recoverable; a data leak to the wrong org can never be un-leaked.

---

## EASY-TO-MISS DURING CODE REVIEW (flagged throughout)

Three pitfalls that are structurally invisible in normal review:

1. **Pitfall 3** — `ws` bundled into `cli.ts` via an indirect import chain. No error is thrown; bundle just gets 15% larger and cold-start increases. Easy to miss because tsup does not warn on this.
2. **Pitfall 14** — Org filter missing in a repo function added quickly in a later phase when the pattern is established but not enforced by a lint rule.
3. **Pitfall 23** — HMAC compared with `===` instead of `timingSafeEqual`. Functionally identical in tests; exploitable only via remote timing attack.

---

## Critical Pitfalls

### Pitfall 1: v1 CLI Bundle Regression via Indirect ws Import

**What goes wrong:**
A new import is added to `src/cli.ts` (or to a module already imported by it) that directly or transitively requires `ws` or `reconnecting-websocket`. tsup bundles them silently. The CLI bundle grows from ~120KB to ~280KB. Cold-start increases from ~180ms to ~420ms. The v1 202 tests still pass because they don't measure bundle size. Regression is invisible until measured.

**Why it happens:**
The most likely trigger: a developer adds a utility function to `src/types.ts` that imports a WS type for IntelliSense convenience — `import type { WebSocket } from 'ws'`. TypeScript strips `import type` at compile time so the type import is harmless in `.ts` source, but tsup (which uses esbuild) does not strip all `import type` constructs correctly in every version. A second trigger: `src/agent.ts` re-exports a shared constant that `src/cli.ts` also imports, causing tsup to bundle agent.ts's entire dependency graph into the CLI entry.

**How to avoid:**
- The tsup `external: ['ws', 'reconnecting-websocket']` directive in the CLI entry config is mandatory. Add it **before** `src/agent.ts` exists, not after.
- Add a `size-check` step to the turbo pipeline that runs after build: `du -sh packages/xci/dist/cli.mjs | awk '{if ($1+0 > 200) exit 1}'`. Fail the build if CLI bundle exceeds 200KB.
- In the turbo CI pipeline, add a cold-start measurement: `hyperfine --warmup 3 'node packages/xci/dist/cli.mjs --version'` and fail if median exceeds 300ms.
- Never import from `src/agent.ts` within `src/cli.ts` statically. The dynamic import guard (`await import('./agent.mjs')`) is the ONLY bridge.

**Warning signs:**
`du -sh dist/cli.mjs` returns > 150KB. Cold-start benchmark degrades between PRs. TypeScript module graph shows `agent.ts` reachable from `cli.ts` via a shared module.

**Phase to address:** Phase A (monorepo setup) — add the size check CI step before any v2.0 code is written. This protects v1 from the moment the monorepo is created.

---

### Pitfall 2: v1 Test Suite Broken by Monorepo Root Config Leakage

**What goes wrong:**
The monorepo root `package.json` adds `"type": "module"` or changes the `"exports"` field in a way that affects module resolution for `packages/xci/`. Alternatively, `biome.json` at the root applies a lint rule that changes formatting in `packages/xci/src/`, causing the pre-commit hook to reformat files and break the `vitest` snapshot tests. The 202 v1 tests fail after Phase A with no change to their logic.

**Why it happens:**
pnpm workspaces inherit certain root-level configs. The root `package.json`'s `"type": "module"` declaration applies to the root only, but the workspace resolution algorithm means that `packages/xci/` MUST declare its own `"type": "module"` to be authoritative. If the workspace package.json is missing this field, Node.js may inherit the root type in some resolution edge cases.

The more common failure: `vitest.config.ts` at the root runs all workspace tests unless scoped. Running `vitest run` from the monorepo root picks up test files from `packages/@xci/server/` that have different environment requirements, causing `packages/xci/` tests to run in an incompatible context.

**How to avoid:**
- `packages/xci/package.json` must explicitly declare `"type": "module"` — do not rely on root inheritance.
- The turbo `test` pipeline scopes tests per-package. The root-level `pnpm test` must map to `pnpm turbo run test`, not `vitest run` (which would pick up all test files).
- Each package has its own `vitest.config.ts` with an explicit `include` glob scoped to that package's `src/` directory.
- Add the following to `turbo.json` test task: `"dependsOn": ["build"]` and verify that `pnpm --filter xci test` green-gates Phase A.
- CI job: `pnpm --filter xci test` must be a required check on all PRs.

**Warning signs:**
`vitest run` from root shows more than 202 tests. Test output mentions `@xci/server` test files. Any v1 snapshot test shows unexpected ANSI differences.

**Phase to address:** Phase A (monorepo setup). Add the CI scoped test gate immediately.

---

### Pitfall 3: ws Bundled into CLI Entry via Shared Type Export (EASY TO MISS IN REVIEW)

**What goes wrong:**
A developer creates `packages/xci/src/ws-types.ts` to share WS frame type definitions between `cli.ts` and `agent.ts`. This file imports `import { WebSocket } from 'ws'` for a type annotation (not just `import type`). When `cli.ts` imports from `ws-types.ts`, tsup pulls `ws` into the CLI bundle because the tsup `external` list only covers top-level package names, not transitive imports from workspace-local files.

Result: `cli.mjs` bundle contains the full `ws` library (~50KB). Cold-start rises. The ARCHITECTURE.md already warns to define `WsFrame` types in `@xci/server/src/types.ts`, not in `packages/xci/` — this pitfall happens when that decision is reversed under time pressure.

**Why it happens:**
It seems ergonomic to co-locate shared types near the code that uses them. Developers who are new to the codebase don't realize the bundle boundary constraint. The tsup build succeeds silently.

**How to avoid:**
- Biome lint rule: add `"noRestrictedImports"` (or equivalent) to `packages/xci/biome.json` forbidding `import ... from 'ws'` in any file under `src/` except `src/agent.ts`. This creates a compile-time barrier.
- WS frame type definitions live exclusively in `packages/@xci/server/src/types.ts` and are imported by `packages/xci/src/agent.ts` via the workspace dep. They are never imported from `packages/xci/src/cli.ts`.
- The bundle size CI check (Pitfall 1) catches this if it slips through.

**Warning signs:**
`grep -r "from 'ws'" packages/xci/src/ | grep -v agent.ts` returns any result. Bundle size check fails.

**Phase to address:** Phase A (monorepo setup) — add the biome import restriction to `packages/xci/biome.json` before agent mode exists.

---

### Pitfall 4: Top-Level await in Agent Entry Pulls Async Init into CLI Cold-Start

**What goes wrong:**
`src/agent.ts` uses top-level `await` to do async initialization (e.g., `const config = await configLoader.load(process.cwd())`). Even though `src/cli.ts` only imports `agent.ts` via a dynamic `import()`, esbuild evaluates the module graph at bundle time. If the dynamic import path is not properly tree-shaken, the top-level await may be included in the CLI bundle's initialization sequence, causing Node.js to wait for the async init before the CLI becomes responsive.

A subtler variant: `src/agent.ts` imports `@xci/server/src/types.ts` (workspace dep). During development, vitest resolves this as a TypeScript source file that itself imports Fastify types. tsup does NOT tree-shake vitest module resolution — so in the test suite, the agent import path may drag in Fastify's type definitions, causing memory overhead.

**How to avoid:**
- `src/agent.ts` must NOT use top-level await. All async init must be inside the `runAgent()` function.
- The tsup agent entry is a fully separate build config array element (as specified in ARCHITECTURE.md §9). No shared top-level module state between `cli.ts` and `agent.ts`.
- In `packages/xci/vitest.config.ts`, add `resolve.alias` to mock `@xci/server` as an empty stub: `{ '@xci/server': path.resolve(__dirname, '__mocks__/@xci/server.ts') }`. This prevents server dependencies from loading during v1 tests.

**Warning signs:**
`time node dist/cli.mjs --version` shows >50ms overhead not present before agent.ts was added. vitest memory usage spikes after Phase D when server deps are added.

**Phase to address:** Phase D (agent WebSocket protocol) — enforce the no-top-level-await rule in agent.ts from the first commit.

---

### Pitfall 5: Exit Code Regression from Agent Mode Error Handling

**What goes wrong:**
The agent mode error path in `src/cli.ts` catches an exception and calls `process.exit(1)` directly instead of returning a non-zero code to `main()`. The v1 `main()` function returns a numeric exit code to the outer `.then(code => process.exit(code))` chain. If the agent path bypasses this and calls `process.exit()` directly with a different code (e.g., 130 for SIGINT), the exit code propagation tests for v1 may fail because `process.exit()` is stubbed in the test suite.

A related variant: the dynamic import guard in `src/cli.ts` is placed inside a try/catch that swallows the exit code from `runAgent()`. If `runAgent()` resolves with exit code 2 but the catch block returns 1, v1 tests that check exit codes for YAML errors (which also return 2) would pass, but a subtle behavior regression is introduced.

**How to avoid:**
- `runAgent()` must return `Promise<number>` (not `void`). The CLI dynamic import guard uses `return await runAgent()` to propagate the exit code into `main()`'s return value.
- The outer `process.exit()` call at the bottom of `cli.ts` is the ONLY place exit codes are applied. No `process.exit()` calls inside `runAgent()`.
- Add a v1 regression test: `xci nonexistent-alias` must still exit with code 50 after Phase D.

**Warning signs:**
`echo $?` after `xci nonexistent-alias` returns something other than 50 after agent mode is added.

**Phase to address:** Phase D (agent WebSocket protocol) — add exit code contract test before implementing agent mode.

---

### Pitfall 6: Silent Half-Open WebSocket Connections via NAT Timeout

**What goes wrong:**
An agent connects to the server from behind a corporate NAT or AWS VPC. After 5 minutes of idle (no log_chunks, no dispatch), the NAT table entry expires. The TCP connection is silently dropped at the network layer. Both the agent's `ws` client and the server's `@fastify/websocket` connection show `readyState === OPEN` because neither end has sent or received anything to detect the drop. The server's heartbeat check fires, sends a `server:heartbeat_ack`, but the frame sits in the kernel send buffer and is never delivered. The agent appears `online` in the UI indefinitely. New tasks dispatched to this agent are sent into a dead socket — they are marked `dispatched` in the DB but never acknowledged.

**Why it happens:**
TCP RST packets are unreliable across NAT. The application layer has no indication of the broken TCP connection unless it actively probes. The `ws` library's built-in ping/pong mechanism uses WebSocket-level pings, not TCP keepalives. If neither side sends data, the ping schedule is the only protection — and if the ping interval is longer than the NAT timeout, the connection is already dead before the first ping fires.

**How to avoid:**
- Server-side: configure `@fastify/websocket` with `options: { clientTracking: false }` and manage pings manually. Send a WebSocket-level ping every **25 seconds** (well under any reasonable NAT timeout). If no pong is received within 10 seconds, close the connection and mark the agent `offline`.
  ```typescript
  // routes/ws-agent.ts — after handshake_ack
  const pingInterval = setInterval(() => {
    if (connection.readyState === WebSocket.OPEN) {
      connection.ping();
    }
  }, 25_000);
  const pingTimeout = setTimeout(() => {
    connection.terminate(); // hard close, not graceful
  }, 35_000); // 25s ping + 10s response window
  connection.on('pong', () => {
    clearTimeout(pingTimeout);
    // reset timeout for next ping cycle
  });
  connection.on('close', () => clearInterval(pingInterval));
  ```
- Agent-side: use `reconnecting-websocket` with `pingInterval: 20_000` in the ws adapter options. This ensures the agent also probes the connection independently.
- OS-level TCP keepalive: set `SO_KEEPALIVE` on the socket with a 60s interval. In Node.js: `socket.setKeepAlive(true, 60_000)`. This catches NAT drops even if the application-level ping fails.
- Do NOT rely solely on the application-level `agent:heartbeat` frame (every 30s) for liveness — this only fires when the connection is already believed to be alive. Combine both: WebSocket ping frames + application heartbeat.

**Warning signs:**
Agents show `online` in the UI but tasks dispatched to them stay `dispatched` forever. Adding `tcpdump` on the agent host shows no traffic after N minutes despite the `online` status.

**Phase to address:** Phase D (agent WebSocket protocol). The ping/pong mechanism must be in the first version of `ws-agent.ts`.

---

### Pitfall 7: Reconnection Storm After Server Restart

**What goes wrong:**
The server restarts (deploy, crash, OOM). All connected agents simultaneously receive a TCP RST or close frame. All agents invoke their `reconnecting-websocket` reconnection timer at the same moment (t=0). With the default `minReconnectionDelay: 1000ms`, all 50 agents attempt to reconnect within the same 1-second window. The server, which just started up, is still running its database migration (`drizzle migrate`) and is not yet accepting traffic. All 50 reconnect attempts fail. All agents retry in 1.5x backoff increments — still closely synchronized. The server gets hammered with bursts of 50 simultaneous WebSocket upgrades every N seconds until it stabilizes.

A worse variant: the server starts successfully but the in-memory `DispatchQueue` is empty (it's rebuilt from DB on startup — see ARCHITECTURE.md anti-patterns). During the reconnection window, the queue rebuild is not yet complete. Agents that reconnect with `currentTaskRunId` set receive incorrect reconciliation responses because the queue state is inconsistent.

**How to avoid:**
- Add jitter to `reconnecting-websocket` config: `minReconnectionDelay: 1000 + Math.random() * 4000` (1–5s random offset). This spreads the reconnection storm across a 4-second window instead of concentrating it at t=0.
- Server startup sequence: DB migration → queue reconciliation (`SELECT queued task_runs`) → **then** open the `/ws/agent` route. Use Fastify's `ready()` hook: register the WS route only after `fastify.ready()` resolves with the DB migration complete.
  ```typescript
  // index.ts
  await fastify.ready(); // waits for all plugins (including db migration) to complete
  await fastify.listen({ port: 3000, host: '0.0.0.0' });
  ```
- The `/health` endpoint returns 200 only after the queue reconciliation is complete. Use this as the Docker HEALTHCHECK and as the load balancer readiness probe.

**Warning signs:**
Server logs show 50+ concurrent WebSocket upgrade requests in a 1-second window after a restart. Some agents reconnect but then receive `task_cancelled` for tasks that were not actually cancelled.

**Phase to address:** Phase D (agent WebSocket protocol) for jitter; Phase B (database + schema) for the startup sequencing requirement.

---

### Pitfall 8: JSON Frame Size Without Fragmentation Causing Silent Message Drop

**What goes wrong:**
An agent spawns a command that emits a large burst of stdout — e.g., `docker build` with verbose output produces 500 lines in 100ms. The agent batches these into `log_chunk` frames. The batching logic (flush every 100ms or 4KB) produces a frame with `data: "...8KB of text..."`. The `ws` library sends this as a single WebSocket frame. The server receives the frame, but because the underlying TCP segment is larger than the MTU (1500 bytes), it arrives fragmented. If the server's WS handler has a `maxPayload` limit (default: 100MB in `ws`, but some reverse proxies set it to 16KB), the message is silently dropped or the connection is terminated with code 1009 (message too large).

More common in practice: nginx or Caddy terminates TLS and acts as a WebSocket proxy with a default `proxy_read_timeout` of 60 seconds. A log-streaming task running for > 60 seconds with no WS traffic during a quiet phase of the build triggers a proxy timeout and closes the connection.

**How to avoid:**
- Hard cap individual `log_chunk` data fields at **64KB** (not 4KB). The 4KB flush threshold is for latency; the 64KB cap is for safety. Enforce at the agent's batching layer: split any chunk exceeding 64KB into multiple sequential frames.
- Set `maxPayload: 10 * 1024 * 1024` (10MB) in the `@fastify/websocket` options to allow for bursts while still having a safety cap.
- For reverse proxy timeout: heartbeat frames every 25 seconds (Pitfall 6 mitigation) keep the connection alive during quiet build phases. Document the required nginx config: `proxy_read_timeout 86400s; proxy_send_timeout 86400s;`.
- The `agent:heartbeat` frame doubles as a keepalive for proxy timeouts.

**Warning signs:**
Log viewer shows a run in `running` state but no new log lines for > 60 seconds, then the run transitions to `orphaned`. Nginx/Caddy access logs show the WebSocket connection closing with reason 499 (client closed request) or 504.

**Phase to address:** Phase G (log streaming) — enforce the 64KB cap in the agent log emitter and document reverse proxy config requirements.

---

### Pitfall 9: Message Ordering Assumptions Broken by Async Persist

**What goes wrong:**
The server's log streaming path is: receive `log_chunk` → append to in-memory `RunBuffer` → **also** fanout immediately to browser WS clients. The `persist.ts` module flushes the buffer to Postgres every 5 seconds. A browser client connects to watch a live run. The server sends: (1) existing chunks from Postgres (ordered by seq), then (2) live chunks from fanout. But between steps 1 and 2, there is a window where buffered-but-not-yet-persisted chunks are served from the fanout. If the browser reconnects during this window, step 1 returns only persisted chunks (seq 0–47), and step 2 starts from the current fanout position (seq 52). Chunks seq 48–51 are in the buffer, not yet persisted. The browser displays a gap.

**Why it happens:**
The ARCHITECTURE.md correctly describes the persist-then-fanout pattern but notes that persist happens asynchronously. The gap is a race between the flush schedule and the browser reconnect.

**How to avoid:**
- On browser subscribe, serve the **in-memory buffer** first, then switch to fanout — do not read from Postgres first. Reading from Postgres is only needed for cold-replay (run already finished, buffer flushed). Add a flag to `RunBuffer`: `isActive`. If `isActive === true`, serve from buffer directly. If `isActive === false` (run terminal), serve from Postgres.
- Buffer flush to Postgres must use `ON CONFLICT (run_id, seq) DO NOTHING` (already in the schema) so that double-flushed chunks are idempotent.
- On run completion, the server must flush the remaining buffer to Postgres BEFORE sending the `log:finished` frame to browser clients. Sequence: `agent:result` received → flush buffer → persist all remaining chunks → send `log:finished` to browser.

**Warning signs:**
Log viewer shows gaps in sequential output that appear only on page refresh. The `log_chunks` table shows a jump in seq numbers (e.g., 48→52) for runs that are complete.

**Phase to address:** Phase G (log streaming) — the buffer/fanout ordering must be designed correctly from the start. A retrospective fix requires changing the subscribe protocol.

---

### Pitfall 10: Log Backpressure Ignored — One Slow Browser Blocks Agent Stream

**What goes wrong:**
The server's `fanout.ts` sends `log:chunk` to every subscribed browser WebSocket client using `conn.send(JSON.stringify(frame))`. If one browser client is on a slow connection (mobile hotspot, 50ms RTT), its WS send buffer fills up. `conn.send()` is synchronous in terms of queuing (it adds to the kernel buffer), but when the kernel buffer is full, `conn.send()` blocks the event loop in the WS handler callback. This blocks processing of all subsequent WS messages from the agent — including `agent:heartbeat` frames. The agent's heartbeat check fires, receives no `server:heartbeat_ack`, and eventually reconnects. The running task's log stream is interrupted for all browser clients.

**Why it happens:**
The `ws.send()` function does not automatically handle backpressure. It uses `ws.bufferedAmount` to detect a full buffer, but does not yield. A single slow subscriber poisons the shared event loop path.

**How to avoid:**
- Check `conn.bufferedAmount` before sending: if > 512KB, skip this frame for this subscriber (the subscriber is too slow to keep up with live output). Optionally close the slow subscriber's connection after 3 skipped frames.
  ```typescript
  // logs/fanout.ts
  for (const conn of subscribers) {
    if (conn.bufferedAmount > 512_000) {
      // Subscriber is lagging — skip this frame
      conn._lagCount = (conn._lagCount ?? 0) + 1;
      if (conn._lagCount > 3) conn.close(1001, 'lag_timeout');
      continue;
    }
    conn._lagCount = 0;
    conn.send(JSON.stringify(frame));
  }
  ```
- Fanout must be wrapped in `setImmediate()` to yield the event loop between frames: `for (const conn of subscribers) { setImmediate(() => conn.send(...)); }`. This prevents the fanout loop from blocking the WS message processing callback.
- Cap browser subscribers per run: max 10 simultaneous log viewers per task run (configurable). Returns 429 if exceeded.

**Warning signs:**
Log streaming works fine with 1 browser but drops frames or disconnects when multiple browsers watch the same run. Agent shows reconnect events correlated with slow-client connections.

**Phase to address:** Phase G (log streaming).

---

### Pitfall 11: Retention Cleanup Racing with Active Log Stream

**What goes wrong:**
The retention job runs every 6 hours: `DELETE FROM log_chunks WHERE org_id = $1 AND received_at < now() - INTERVAL '30 days'`. However, a long-running task that started 30 days and 1 minute ago is still streaming log chunks. The DELETE statement runs with no transaction isolation guarantee against the INSERT from the fanout persist path. On some Postgres configurations (default `READ COMMITTED` isolation), the DELETE can delete rows that were just INSERTed by a concurrent flush — specifically, rows where `received_at` is exactly at the boundary.

More likely: the retention job is configured to delete runs older than `N` days, but a task run that was queued N days ago and is currently running has a `queued_at` outside the window. The cleanup job deletes its `task_runs` row (due to a missing `status != 'running'` filter), causing the run to become orphaned in the middle of execution.

**How to avoid:**
- Retention `DELETE` on `task_runs` must always include `status IN ('succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned')`. Never delete `queued`, `dispatched`, or `running` runs.
- Retention `DELETE` on `log_chunks` uses `run_id NOT IN (SELECT id FROM task_runs WHERE status IN ('running', 'dispatched'))` as an additional guard.
- The retention job must acquire a Postgres advisory lock before running: `SELECT pg_try_advisory_lock(hashtext('retention_job'))`. This prevents two cleanup runs from executing simultaneously if the server restarts.

**Warning signs:**
Running tasks disappear from the UI mid-execution with no error. `log_chunks` rows for active runs are missing after the retention job fires.

**Phase to address:** Phase G (log streaming) — add the status filter to the retention query from the first implementation.

---

### Pitfall 12: Master Encryption Key in Docker ENV Visible via docker inspect

**What goes wrong:**
`XCI_MASTER_KEY` is passed to the container as a `-e XCI_MASTER_KEY=abc123...` flag or as `environment:` in docker-compose.yml. Anyone with access to the Docker daemon (or the docker-compose.yml checked into git) can run `docker inspect <container>` and see the environment variable in plain text. On a shared CI server, this means any user who can run Docker commands can exfiltrate the master key — and therefore decrypt all org secrets.

**Why it happens:**
Environment variables for Docker containers are the path-of-least-resistance for passing secrets. The docker-compose.yml often ends up committed to git, or the `-e` flags appear in shell history.

**How to avoid:**
- In production: use Docker secrets (`--secret` flag with `docker run` or `secrets:` in Compose v3.1+). The secret is mounted at `/run/secrets/XCI_MASTER_KEY` and is NOT visible via `docker inspect`.
  ```dockerfile
  # Dockerfile
  RUN --mount=type=secret,id=xci_master_key \
    export XCI_MASTER_KEY=$(cat /run/secrets/xci_master_key) && ...
  ```
  At runtime: `docker run --secret xci_master_key=...`
- Alternative: use a dedicated secrets manager (Vault, AWS Secrets Manager, GCP Secret Manager) and have the entrypoint script fetch the key at startup, never placing it in the image or environment.
- Never add `XCI_MASTER_KEY` to `.env` files or `docker-compose.yml` in the repository. Add `*.env` and `docker-compose.override.yml` to `.gitignore`.
- In the server's startup validation (`config.ts`), log a WARNING if `XCI_MASTER_KEY` is detected in `process.env` (as opposed to being read from a mounted secret path): "WARNING: XCI_MASTER_KEY loaded from environment variable — this may be visible via docker inspect. Consider using Docker secrets."

**Warning signs:**
`docker inspect <container> | jq '.[].Config.Env'` shows `XCI_MASTER_KEY=...`. The `.env` file appears in git history.

**Phase to address:** Phase I (secrets management) — document Docker secrets usage from the first deployment docs. Also Phase L (Docker + publishing).

---

### Pitfall 13: Envelope Encryption IV Reuse Breaking AES-GCM Security

**What goes wrong:**
The code generates a new DEK for each org and a new IV for each secret encryption call using `crypto.randomBytes(12)`. A developer changes the encryption helper to cache the IV as a module-level constant for "performance" reasons:
```typescript
// WRONG — do not do this
const SHARED_IV = crypto.randomBytes(12); // module-level constant
export function encryptSecret(dek: Buffer, plaintext: string): EncryptedBlob {
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, SHARED_IV); // IV reused!
  ...
}
```
With the same IV and same key, AES-GCM's security guarantee is broken. An attacker who can observe two ciphertexts encrypted with the same key+IV can XOR them to cancel the keystream and recover plaintext.

A less obvious variant: the IV is stored as a fixed value in the Drizzle migration seed file for testing purposes (`iv: Buffer.from('000000000000', 'hex')`). If this migration is accidentally applied to production (the migration seed path runs on `NODE_ENV !== 'test'`), all org DEKs are encrypted with IV=0.

**How to avoid:**
- Generate `crypto.randomBytes(12)` inside the encrypt function, never outside. The IV is stored alongside the ciphertext (as already specified in the schema: `dek_iv`, `iv` columns). This is correct and must not be changed.
- Add a unit test: `assert.notDeepEqual(encryptSecret(dek, 'x').iv, encryptSecret(dek, 'x').iv)` — two calls must produce different IVs.
- The Drizzle migration seed for tests must NOT hardcode IVs. Test fixtures must call `encryptSecret()` the same as production code. The IV is only predictable in tests by mocking `crypto.randomBytes`.
- Add a linting rule (biome regex lint or a custom vitest integration test): forbid any file in `packages/@xci/server/src/` from using a fixed-length `Buffer.alloc(12)` or `Buffer.from('0'.repeat(24), 'hex')`.

**Warning signs:**
Code review finds `randomBytes` called once at module level. Two `org_secrets` rows for the same org have the same `iv` value (query: `SELECT iv, count(*) FROM org_secrets GROUP BY iv HAVING count(*) > 1`).

**Phase to address:** Phase I (secrets management) — the encryption helper must be reviewed and tested before any secrets are stored in production.

---

### Pitfall 14: Missing org_id Filter on a Single Query (HIGHEST RISK / EASY TO MISS IN REVIEW)

**What goes wrong:**
Every repository function correctly takes `orgId` as a parameter and embeds it in the query. Except one function added in Phase H under time pressure: `webhookEventsRepo.list()` — which lists all webhook events to show in the admin settings UI. The developer assumes the route handler's `request.session.orgId` is already filtering the result, but the repo function's implementation omits the `WHERE org_id = ${orgId}` clause because it was copy-pasted from a utility function that queries `plugin_configs` (a non-tenanted helper written early in Phase H). Org A's admin can now see Org B's webhook events, including payloads containing repository names, author names, and commit hashes.

**Why it happens:**
The repo pattern `makeTasksRepo(db, orgId)` is enforced in most paths, but some utility repos (for lookup tables like `orgs`, `plans`) legitimately don't filter by `orgId`. When a developer writes a new repo function in a hurry, they may copy from a utility repo and forget to add the tenant filter. TypeScript does not catch this — the function signature accepts `orgId` but the implementation ignores it.

**How to avoid:**
- Biome custom lint rule (or vitest integration test): every function in `packages/@xci/server/src/repos/` that accepts an `orgId` parameter must reference `orgId` in a SQL template literal. This can be enforced as a test:
  ```typescript
  // repos/__tests__/tenant-filter.test.ts
  import { readFileSync, readdirSync } from 'node:fs';
  test('all repo functions with orgId param use orgId in SQL', () => {
    for (const file of readdirSync('src/repos')) {
      const src = readFileSync(`src/repos/${file}`, 'utf8');
      const fnsWithOrgId = [...src.matchAll(/\(.*orgId.*\).*=>/g)];
      for (const fn of fnsWithOrgId) {
        // crude check: if function body exists in same source, orgId appears in sql``
        expect(src).toMatch(/org_id.*=.*orgId|orgId.*org_id/);
      }
    }
  });
  ```
- Required: a multi-org integration test fixture. The test creates two orgs, inserts data into both, and verifies that every API endpoint accessed as Org A returns ONLY Org A's data. This must be written in Phase C and expanded with each new entity added in subsequent phases.
- Code review checklist item: "Does this new repo function include an `AND org_id = ${orgId}` clause?"

**Warning signs:**
No multi-org test fixture exists. A new repo function is added without a corresponding multi-org isolation test. API response for one org contains IDs that don't exist in that org's DB rows.

**Phase to address:** Phase C (auth + session) — write the multi-org integration test fixture. Update it in every subsequent phase that adds a new entity. Phase K (billing/org management) — add the final cross-org isolation test covering all entities.

---

### Pitfall 15: Log Subscription Cross-Org Leak

**What goes wrong:**
The browser WebSocket log subscription endpoint is `GET /ws/logs/:runId`. The server verifies the session, then looks up the `task_run` by `runId` alone (no `org_id` filter):
```typescript
// WRONG
const run = await db.queryOne`SELECT * FROM task_runs WHERE id = ${runId}`;
```
If Org A's user knows Org B's task run ID (a UUID, but enumerable if the UI exposes them), they can subscribe to Org B's live log stream.

**Why it happens:**
The WS upgrade path uses a route parameter (`runId`) to identify the resource. Developers who correctly filter REST endpoints sometimes forget to apply the same filter to WS upgrade handlers, because WS handlers look structurally different from route handlers and are not always reviewed with the same security lens.

**How to avoid:**
- ALL lookups in WS handlers must include `AND org_id = ${orgId}` extracted from the session:
  ```typescript
  const run = await db.queryOne`
    SELECT * FROM task_runs
    WHERE id = ${runId} AND org_id = ${session.orgId}`;
  if (!run) { connection.close(1008, 'not_found'); return; }
  ```
- The multi-org integration test (Pitfall 14) must also test the WS log subscription path.
- Add to the Phase D code review checklist: "Does the WS handler verify org ownership of the requested resource?"

**Warning signs:**
The WS log subscription handler doesn't call `makeTaskRunsRepo(db, session.orgId)` — it queries directly. Any WS handler that reads `runId` from the URL without an org filter.

**Phase to address:** Phase G (log streaming) — add the org filter from the first version of `ws-log.ts`.

---

### Pitfall 16: Agent Token in WebSocket URL Query String Logged by Proxy

**What goes wrong:**
During development, a developer changes the handshake protocol to pass the agent token in the WS URL for convenience: `ws://server:3000/ws/agent?token=<agentToken>`. This URL is logged in full by nginx's `access_log`, Caddy's structured JSON logger, CloudFlare Workers logs, and AWS ALB access logs. The agent token is now in plain text in every log aggregation system (Datadog, Splunk, CloudWatch). Anyone with log access can extract and use the token.

The correct protocol (token in the first `agent:handshake` frame body over the encrypted WS connection) is specified in ARCHITECTURE.md but may be shortcut during early prototyping.

**How to avoid:**
- The WS upgrade URL is always parameterless: `ws://server:3000/ws/agent`. No token in the URL, ever.
- The token is sent in the first `agent:handshake` frame after the WebSocket handshake is complete. At this point, the connection is upgraded to WS (TLS-encrypted in prod) and the frame payload is opaque to proxies.
- Add to the Phase D integration test: verify that the `agent:handshake` frame is the carrier for the token, and that no test ever passes the token as a URL query parameter.
- Add a startup warning in the agent: if `process.env.XCI_AGENT_TOKEN` is set AND contains a `?` character (URL encoding), emit a warning about token-in-URL.

**Warning signs:**
nginx/Caddy access logs contain the string `token=` in a `/ws/agent` URL. The WS upgrade route definition includes `:token` as a URL parameter.

**Phase to address:** Phase D (agent WebSocket protocol) — this must be correct from the first implementation.

---

### Pitfall 17: Agent Long-Lived Token Without Server-Side Expiry or Revocation Check on Reconnect

**What goes wrong:**
The `agent_tokens` table stores a `revoked_at` field. The server checks `revoked_at IS NULL` only during the initial `POST /api/agents/register` handshake. On reconnect, the server only verifies the token hash (for speed), without re-checking `revoked_at`. An operator revokes an agent token from the UI. The agent reconnects immediately. The server accepts the reconnect because the cached validation skips the revocation check. The agent continues running tasks for the compromised agent.

**Why it happens:**
Token validation on reconnect is optimized for speed in the hot path. The developer adds a fast hash-lookup query but forgets to include the `AND revoked_at IS NULL` condition.

**How to avoid:**
- Every `agent:handshake` frame — whether initial registration or reconnect — runs the full token validation query:
  ```typescript
  const tokenRow = await db.queryOne`
    SELECT at.*, a.org_id, a.id as agent_id
    FROM agent_tokens at
    JOIN agents a ON a.id = at.agent_id
    WHERE at.token_hash = ${tokenHash}
      AND at.revoked_at IS NULL`;  // THIS LINE IS NON-NEGOTIABLE
  ```
- Write a test: revoke a token via the API, then simulate a reconnect handshake — the server must return `server:handshake_reject` with `reason: 'token_revoked'`.
- The `agent_tokens.revoked_at` index must exist: `INDEX(token_hash, revoked_at)` — the combined index makes the revocation check zero-cost.

**Warning signs:**
The token validation query in the reconnect path is shorter than the registration path (missing `revoked_at` check). No test exercises the revoke-then-reconnect flow.

**Phase to address:** Phase D (agent WebSocket protocol) — write the revoke-then-reconnect test as part of Phase D's acceptance criteria.

---

### Pitfall 18: HMAC Signature Compared with String Equality (Timing Attack — EASY TO MISS IN REVIEW)

**What goes wrong:**
The GitHub webhook `verify()` function computes the expected HMAC and compares to the header value:
```typescript
// WRONG — timing attack
const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
return headers['x-hub-signature-256'] === expected;
```
String equality in JavaScript short-circuits: it returns `false` as soon as the first different character is found. An attacker can exploit the time difference between a comparison that fails at character 1 vs. character 63 to reconstruct the correct HMAC byte-by-byte via millions of requests. This is a known attack against webhook verification.

**Why it happens:**
Developers reaching for `===` is the default habit. The `timingSafeEqual` function from `node:crypto` is not widely known. This is functionally identical to the vulnerable version in all tests.

**How to avoid:**
- Always use `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` for any token or HMAC comparison.
- The ARCHITECTURE.md correctly shows this pattern. Add a Biome lint rule (or a vitest static analysis test) that detects `===` comparisons where one operand is a string starting with `sha256=` or named `signature`, `hmac`, or `token_hash`:
  ```typescript
  // static-analysis.test.ts
  test('no timing-unsafe comparisons for security-sensitive values', () => {
    const src = readFileSync('src/triggers/github/index.ts', 'utf8');
    expect(src).not.toMatch(/signature.*===|===.*signature/);
  });
  ```
- Buffer length mismatch before `timingSafeEqual` throws — pre-check lengths and return false early (this does not leak timing info about the content):
  ```typescript
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
  ```

**Warning signs:**
`grep -r '=== ' packages/@xci/server/src/triggers/` finds comparisons involving signature strings. Code review of `verify()` method shows `===` operator.

**Phase to address:** Phase H (plugin system + webhooks) — must be correct in the initial GitHub plugin implementation.

---

### Pitfall 19: Secrets Logged via Pino Request Body Serializer

**What goes wrong:**
Pino's default request serializer includes the request body. A `POST /api/secrets` request body contains `{ name: "DEPLOY_TOKEN", value: "sk_live_abc123..." }`. Pino logs the full request object, which includes `body.value`. The plaintext secret value is now in the structured log stream (CloudWatch, Datadog, etc.). The pino custom serializer specified in ARCHITECTURE.md strips `params`, `value`, etc. from log *objects*, but the HTTP request body is logged separately via `pino-http` — which uses its own serializer that is not covered by the field-level stripping.

A second vector: the `server:dispatch` WS frame contains `params: { DEPLOY_TOKEN: "sk_live_abc123..." }`. A developer adds a debug log line: `fastify.log.debug({ frame }, 'dispatching task')`. The entire frame, including plaintext secret params, is logged.

**How to avoid:**
- Configure `pino-http` to explicitly suppress the request body: `{ serializers: { req: (req) => ({ method: req.method, url: req.url, userAgent: req.headers['user-agent'] }) } }`. Never include `req.body` in the pino-http request serializer.
- Fastify route handlers that process secret values must use explicit log calls with only safe fields: `request.log.info({ secretName: body.name }, 'secret created')` — never `request.log.info({ body }, ...)`.
- WS dispatch frames must NEVER be logged in their entirety. Log only: `{ taskRunId, agentId, aliasName }` — not the `params` object.
- Write a vitest integration test: `POST /api/secrets` with a known value, then scan the captured pino log output (via pino's `transport` stream in test mode) and assert the value does NOT appear in any log line.

**Warning signs:**
`pino-http` config shows `serializers: { req: pino.stdSerializers.req }` (default — includes body). Any `fastify.log.info({ frame, ... })` in dispatch code. Any `fastify.log.info({ body, ... })` in route handlers.

**Phase to address:** Phase C (auth + session, first route handlers) — configure pino serializers correctly from the first route. Phase I (secrets) — add the integration test.

---

### Pitfall 20: Webhook Event Raw Payload Stored with Plaintext Tokens

**What goes wrong:**
The `webhook_events` table stores `raw_payload: jsonb` — the full webhook request body from GitHub. Some GitHub webhook payloads include installation tokens, OAuth tokens (in `x-oauth-scopes` or in custom delivery payloads for GitHub Apps), or Perforce changelist user passwords in custom trigger scripts. These are stored in plain text in the DB, visible to anyone with DB access and included in DB backups.

A more common variant: the `plugin_configs` table stores the webhook shared secret (used for HMAC verification) in `config: jsonb` without encryption. The comment in ARCHITECTURE.md says "NOTE: webhook secrets in config are stored encrypted via org DEK" — but if this encryption step is missed during Phase H implementation, the webhook secret lives in plain text in `plugin_configs.config`.

**How to avoid:**
- `plugin_configs.config` MUST be encrypted before storage using the same org DEK envelope pattern as `org_secrets`. The route handler calls `encryptPluginConfig(config, orgDek)` before INSERT and `decryptPluginConfig(row, orgDek)` before use. Add this to Phase H acceptance criteria.
- `webhook_events.raw_payload` must be sanitized before storage: strip any field named `token`, `secret`, `password`, `authorization` from the parsed JSON before the INSERT. A shallow-key sanitizer is sufficient for v2.0:
  ```typescript
  const STRIP_KEYS = new Set(['token', 'secret', 'password', 'authorization', 'access_token']);
  function sanitizePayload(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) return obj;
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([k]) => !STRIP_KEYS.has(k.toLowerCase()))
        .map(([k, v]) => [k, sanitizePayload(v)])
    );
  }
  ```

**Warning signs:**
`plugin_configs` rows show `{ "webhookSecret": "abc123..." }` in plain text. `webhook_events` rows contain `installation.access_token` in the payload.

**Phase to address:** Phase H (plugin system + webhooks). Add the plugin config encryption to Phase H acceptance criteria.

---

### Pitfall 21: Base64-Encoded Secret Bypassing Log Redaction

**What goes wrong:**
The server's log redactor (applied before storing `log_chunks`) scans for exact matches of org secret values. A command in the task definition is:
```yaml
cmd: docker login -u user -p ${DEPLOY_TOKEN}
```
Docker often echoes the credentials during login. The exact string `sk_live_abc123...` is redacted. However, some tools (notably Docker and Kubernetes) accept credentials as base64-encoded values. If the user has a secret `DOCKER_CONFIG_JSON={"auths":{"registry":{"auth":"dXNlcjpzazEyMw=="}}}`, the base64-encoded value `dXNlcjpzazEyMw==` is not recognized by the redactor as a secret, even though it encodes `user:sk123`.

This is a known gap in all CI systems (cited in FEATURES.md sources: Drone CI log masking feature request).

**How to avoid:**
- For each secret value, add BOTH the raw value AND its base64-encoded variant to the redaction set:
  ```typescript
  function buildRedactionSet(secrets: Record<string, string>): Set<string> {
    const set = new Set<string>();
    for (const value of Object.values(secrets)) {
      if (value.length >= 4) { // avoid redacting very short values that cause false positives
        set.add(value);
        set.add(Buffer.from(value).toString('base64'));
        set.add(Buffer.from(value).toString('base64url'));
      }
    }
    return set;
  }
  ```
- Document the limitation: secrets embedded in JSON structures that are then base64-encoded at a higher level (double-encoding) are not caught. Users should keep secrets out of JSON blobs when possible.
- The redaction scan must be applied BEFORE storing log chunks, not at display time. Storing redacted chunks ensures historical logs don't leak secrets even after the secret is rotated.

**Warning signs:**
Task output contains strings that are the base64 encoding of known secret values. Log chunks in DB contain base64-encoded credential strings.

**Phase to address:** Phase G (log streaming) + Phase I (secrets management) — the redaction function must be implemented in Phase G and extended in Phase I when secrets are available.

---

### Pitfall 22: Postgres Connection Pool Exhaustion Under Agent WebSocket Load

**What goes wrong:**
The `@xci/server` uses a `postgres` (porsager) connection pool with a default of 10 connections. In v2.0 with 50 agents connected, each agent's WS handler processes messages concurrently. When 50 agents each send a `log_chunk` simultaneously, each message handler tries to acquire a DB connection to call `persist.ts`. With 50 concurrent requests and a pool of 10, 40 requests queue. Each queued request holds an open WS connection callback, which holds the event loop. If the pool queue timeout is not set, requests wait indefinitely. Under sustained load (a build that outputs 100 lines/second across 50 agents), the pool is permanently saturated.

**Why it happens:**
The default `postgres` pool size is appropriate for REST APIs with short-lived requests, not for long-lived WS connections that generate continuous DB writes.

**How to avoid:**
- The `log_chunks` persist path should NOT acquire a DB connection per chunk. Instead, the `RunBuffer` batches chunks and flushes every 100 chunks or 5 seconds. This means 50 agents × 1 flush/5s = 10 DB writes/second — within pool capacity.
- Configure the pool with explicit options: `postgres({ host, user, password, database, max: 20, idle_timeout: 20, connect_timeout: 10 })`. The `connect_timeout: 10` means pool acquisition fails after 10 seconds with an error rather than hanging indefinitely.
- Set a Postgres-level `statement_timeout`: `SET statement_timeout = '30s'` on connection acquisition. This prevents a single slow query from holding a connection forever.
- Monitor: add a metric or log line that reports pool utilization: `fastify.db.connections.active / fastify.db.connections.max`. Alert at 80%.

**Warning signs:**
Server logs show `acquire connection timeout` from the postgres driver. Task runs show `dispatched` but never transition to `running`. Pool utilization metric stays at 100%.

**Phase to address:** Phase B (database + schema) — configure pool size and timeouts from the start. Phase G (log streaming) — ensure the batch-persist pattern is used.

---

### Pitfall 23: Drizzle Migration Run in Production Image with drizzle-kit (Wrong Tool)

**What goes wrong:**
The `drizzle-kit migrate` command is designed as a development tool. It connects to the DB, diffs the TypeScript schema, and applies migrations. In the production Docker image, a developer adds `drizzle-kit` as a production dependency and runs it in the entrypoint script. This pulls `drizzle-kit`'s 80MB+ dependency tree (including TypeScript compiler, esbuild, various CLI tools) into the production image, increasing image size from ~450MB to ~600MB. More critically: `drizzle-kit migrate` re-generates migration SQL on the fly from the TypeScript schema — meaning it can apply unintended schema changes if the TypeScript source included in the image doesn't exactly match the migration files.

**Why it happens:**
The distinction between `drizzle-kit` (dev tool) and the Drizzle ORM's programmatic migrator (production use) is not obvious from the documentation.

**How to avoid:**
- Use the programmatic Drizzle migrator in production: `import { migrate } from 'drizzle-orm/postgres-js/migrator'`. This runs the pre-generated SQL files from the `migrations/` directory — no TypeScript schema required at runtime.
  ```typescript
  // packages/@xci/server/src/db/migrate.ts
  import { migrate } from 'drizzle-orm/postgres-js/migrator';
  import { drizzle } from 'drizzle-orm/postgres-js';
  import postgres from 'postgres';
  import { join } from 'node:path';
  export async function runMigrations(): Promise<void> {
    const sql = postgres(process.env.DATABASE_URL!);
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: join(import.meta.dirname, 'migrations') });
    await sql.end();
  }
  ```
- `drizzle-kit` is a **devDependency only**. The `pnpm install --prod --frozen-lockfile --filter=@xci/server` command in the Docker runtime stage will not install it.
- The `migrations/` directory (containing generated SQL files) is copied into the Docker image as a static asset — not regenerated at runtime.
- Add to Phase B acceptance criteria: "Verify `docker run --rm xci-server node -e "require('./dist/db/migrate.js')"` succeeds without `drizzle-kit` installed."

**Warning signs:**
`drizzle-kit` appears in `@xci/server/package.json` `"dependencies"` rather than `"devDependencies"`. The Docker image size exceeds 600MB. The production entrypoint runs `drizzle-kit migrate` instead of the programmatic migrator.

**Phase to address:** Phase B (database + schema) and Phase L (Docker + publishing).

---

### Pitfall 24: Quota Check Executed After the Expensive Operation

**What goes wrong:**
The task dispatch flow is: (1) receive dispatch request → (2) create a `task_run` row with `status=queued` → (3) check quota: if `running_task_count >= maxConcurrentTasks`, leave in queue. This is correct for the concurrency quota. However, the agent registration quota is checked after the agent is added to the `agents` table:
```typescript
// WRONG order
await agentsRepo.insert(newAgent);  // agent now exists in DB
const count = await agentsRepo.countByOrg(orgId);
if (count > plan.maxAgents) {
  return reply.code(403).send({ error: 'quota_exceeded' });
  // But the agent was already inserted! Now it exists but the response was 403.
}
```
The agent row is inserted but the client receives a 403. On retry, the client creates a second agent row. The org now has 2 orphaned agent rows.

**Why it happens:**
"Check and act" patterns are easier to write than "check then conditionally act" patterns, especially when the developer wants to return a meaningful error with the count.

**How to avoid:**
- Quota checks must ALWAYS precede the resource creation:
  ```typescript
  const count = await agentsRepo.countOnlineByOrg(orgId);
  if (count >= plan.maxAgents) return reply.code(403).send({ error: 'quota_exceeded', current: count, max: plan.maxAgents });
  await agentsRepo.insert(newAgent);
  ```
- For the concurrent task quota: count `running` tasks BEFORE inserting the `task_run` row. If over quota, return 429 (or queue and return 202) — but do NOT insert and then delete.
- Use a Postgres-level constraint as a safety net: a trigger or check constraint that counts org agent rows before INSERT. This is belt-and-suspenders for the application-level check.
- Write a test: with quota=3, attempt to register 4 agents concurrently. Assert exactly 3 succeed and 1 gets 403 with no orphaned rows.

**Warning signs:**
`agents` table has rows where `status='offline'` and `registered_at` is very recent but no corresponding session token was ever issued (orphaned registration attempts).

**Phase to address:** Phase D (agent registration) and Phase K (billing/quota).

---

### Pitfall 25: No E2E Test Covering the Full trigger → dispatch → log → UI Path

**What goes wrong:**
Each component is unit-tested in isolation. The GitHub webhook plugin is tested. The dispatcher is tested. The log streaming is tested. The UI log viewer is tested with mocked WebSocket. But no test exercises the full chain: POST webhook → plugin verify → mapToTask → task_run inserted → dispatcher fires → WS dispatch frame → agent receives → runs command → streams logs → server stores chunks → browser WS subscriber receives chunks. Integration gaps exist at every boundary. v2.0 ships and the first real webhook trigger fails because the `mapToTask` result shape mismatches the dispatcher's expected input shape — a contract error that unit tests on each side would never catch.

**Why it happens:**
E2E tests are expensive to write and run slowly. It's tempting to treat unit tests as sufficient coverage. The boundaries between components (especially WS protocol boundaries) are where bugs hide.

**How to avoid:**
- Phase H must include at minimum one Playwright E2E test: trigger a GitHub webhook against a running test server → verify the log viewer in a browser shows the expected output. This test uses `docker-compose` (server + Postgres) and a mock agent.
- Write a "vitest integration" test (not Playwright, but real HTTP + real DB) that covers the dispatch pipeline end-to-end: `POST /hooks/github/:orgSlug` → assert `task_runs` row created → assert WS dispatch frame sent to mock agent → mock agent sends `agent:result` → assert `task_runs.status = 'succeeded'`.
- The mock agent is a simple vitest fixture that connects to the WS endpoint, performs the handshake, and responds deterministically to dispatch frames.
- Add to the Phase F acceptance criteria: "An integration test exercises the full dispatch pipeline against a real Postgres instance."

**Warning signs:**
Test coverage shows high coverage on individual modules but no test that spans more than 2 components. Phase H tests only test the plugin's `verify()` and `mapToTask()` in isolation.

**Phase to address:** Phase F (dispatch pipeline) — add the dispatch integration test. Phase H (plugin system) — add the webhook-to-dispatch E2E test.

---

### Pitfall 26: Log Viewer Scroll Position Stolen During Live Stream

**What goes wrong:**
The `LogViewer` React component uses `useEffect` to auto-scroll to the bottom when new log chunks arrive. The implementation calls `containerRef.current.scrollTop = containerRef.current.scrollHeight` every time a new chunk is appended to the state array. This works correctly, but when the user tries to scroll up to review an earlier line, the next incoming chunk fires the effect and snaps the view back to the bottom. The user cannot read earlier output while the build is running. This is a frustrating UX regression compared to the v1 CLI (where you can scroll the terminal freely).

**Why it happens:**
The auto-scroll effect checks `userScrolled` state, but the state update is async. Between the user's `onScroll` event firing and React re-rendering with `userScrolled = true`, one or more log chunks arrive and trigger the auto-scroll effect before the scroll flag is set.

**How to avoid:**
- Use a `ref` (not state) for `userScrolled` tracking: `const userScrolledRef = useRef(false)`. Refs are synchronous — the `onScroll` handler updates the ref immediately, and the effect reads the current ref value before scrolling.
  ```typescript
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [chunks]); // runs after each chunk batch
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    userScrolledRef.current = !atBottom;
  };
  ```
- Add a "resume auto-scroll" button that appears when `userScrolled = true`. Clicking it sets the ref to `false` and immediately scrolls to bottom.
- The auto-scroll should batch: don't scroll on every individual chunk — scroll once after the RAF (requestAnimationFrame) cycle that processes a batch of chunks. This prevents the scroll from fighting the user's scroll gesture mid-gesture.

**Warning signs:**
Manual testing: open log viewer, scroll up while the build is running. If the view snaps back to bottom immediately, the pitfall is present.

**Phase to address:** Phase J (web dashboard UI) — implement the correct scroll behavior in the first version of `LogViewer`.

---

### Pitfall 27: Publishing @xci/server Before @xci/web (Missing Static Assets)

**What goes wrong:**
The turbo build pipeline builds all packages in dependency order. But the npm publish workflow runs `pnpm -r publish --access public`. If `@xci/server` is published before `@xci/web` finishes building (or if the SPA static assets are not copied into `@xci/server/dist/public/` before publish), the published `@xci/server` image contains an empty `public/` directory. Operators pulling the Docker image and running it see a 404 on the web UI root. The Docker image build in CI also has this issue if the build stages run in parallel without the correct dependency ordering.

**Why it happens:**
The turbo pipeline correctly orders builds, but npm publish is separate from the turbo pipeline. If someone runs `pnpm -r publish` manually without running `pnpm turbo run build` first (or if the turbo cache is stale), the published artifacts are incomplete.

**How to avoid:**
- `@xci/server/package.json` must declare `@xci/web` as a `peerDependency` or include the web build step in its `build` script:
  ```json
  // @xci/server/package.json
  "scripts": {
    "build": "pnpm --filter @xci/web build && tsup && cp -r ../web/dist ./dist/public"
  }
  ```
- The changeset publish workflow (`pnpm changeset publish`) must be preceded by `pnpm turbo run build`. Add this as a required step in the GitHub Actions publish workflow.
- Add a CI smoke test on the published Docker image: `docker run --rm xci-server curl -f http://localhost:3000/` must return the SPA HTML (not 404).
- In the Dockerfile, the `COPY --from=builder .../packages/@xci/web/dist` step is protected by a `RUN test -f packages/@xci/web/dist/index.html || exit 1` assertion before the copy.

**Warning signs:**
`@xci/server/dist/public/` is empty after `pnpm build`. `docker run` shows 404 on the root URL.

**Phase to address:** Phase L (Docker + publishing). Add the smoke test assertion as a required CI gate.

---

### Pitfall 28: WS Disconnect Not Indicated in the Dashboard UI

**What goes wrong:**
The browser's WS connection to the server drops (server restart, network blip). `reconnecting-websocket` automatically reconnects with exponential backoff. During the reconnection window (up to 30 seconds with the configured `maxReconnectionDelay`), the dashboard continues to show the last-known state: agents appear `online`, task runs appear `running`. No visual indicator shows that the dashboard is offline. Users make decisions based on stale data — they believe a task succeeded but the success event was missed during the disconnect window.

**Why it happens:**
`reconnecting-websocket` exposes `readyState` and events (`close`, `open`, `error`), but React components don't automatically react to these unless they're wired to state. Without explicit disconnect state management, the UI has no stale-data indicator.

**How to avoid:**
- Create a `useWsConnection()` hook that tracks `{ status: 'connected' | 'reconnecting' | 'disconnected' }` and updates React state on `close` and `open` events.
- When status is `reconnecting` or `disconnected`: show a visible banner at the top of the dashboard: "Connection lost — reconnecting..." with a spinner.
- On reconnect (`open` event): refetch all live data via React Query's `invalidateQueries()` to ensure the stale-data window is closed.
  ```typescript
  ws.addEventListener('close', () => setWsStatus('reconnecting'));
  ws.addEventListener('open', () => {
    setWsStatus('connected');
    queryClient.invalidateQueries(); // force refetch of all cached data
  });
  ```

**Warning signs:**
The browser DevTools Network tab shows a WS disconnect event, but the dashboard UI shows no visual change. Refreshing the page after a disconnect shows different data than the pre-disconnect state.

**Phase to address:** Phase J (web dashboard UI).

---

### Pitfall 29: Plugin mapToTask Lacks Idempotency Key — Duplicate Task Runs on Webhook Retry

**What goes wrong:**
GitHub retries webhook deliveries up to 3 times if the server does not respond with a 2xx within 10 seconds. The server creates a `task_run` on first receipt and returns 202. But the DB INSERT takes 8 seconds due to a slow query during a migration. GitHub marks the delivery as failed and retries. The server receives the second delivery, verifies the HMAC (same signature — valid), and creates a second `task_run`. The same commit now triggers the build twice. On Perforce triggers, the issue is worse: the trigger script may fire multiple times for the same changelist due to server-side retries in p4 triggers.

**Why it happens:**
Webhook endpoints are designed to be idempotent in most systems, but implementing idempotency requires either: (a) storing a delivery ID and checking it, or (b) making the DB INSERT idempotent. Neither is the default.

**How to avoid:**
- Use GitHub's `X-GitHub-Delivery` header (a UUID per delivery) as an idempotency key. Store it in `webhook_events.delivery_id` as a UNIQUE constraint.
  ```typescript
  const deliveryId = headers['x-github-delivery'];
  // Use ON CONFLICT DO NOTHING and check if the row was actually inserted
  const result = await db.queryOne`
    INSERT INTO webhook_events (id, org_id, plugin, delivery_id, ...)
    VALUES (${newUuid()}, ${orgId}, 'github', ${deliveryId}, ...)
    ON CONFLICT (delivery_id) DO NOTHING
    RETURNING id`;
  if (!result) {
    // Duplicate delivery — acknowledge but don't dispatch
    return reply.code(200).send({ dispatched: false, reason: 'duplicate_delivery' });
  }
  ```
- For Perforce: the trigger script should include a changelist number and timestamp. Use `(org_id, plugin, trigger_metadata->>'changelist')` as a unique key (or add a separate unique constraint).
- The server must respond within 3 seconds to avoid retry storms. The webhook handler returns 202 immediately and dispatches asynchronously.

**Warning signs:**
Multiple `task_runs` rows with the same `trigger_metadata->>'delivery_id'` value. Log shows the same build running twice with overlapping timestamps.

**Phase to address:** Phase H (plugin system + webhooks) — the `webhook_events` table must have a `delivery_id UNIQUE` constraint from the first migration.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| In-memory dispatch queue without DB persistence | No Redis/queue infra needed | Queue lost on server restart; reconciliation adds startup complexity; potential race condition in high-concurrency scenarios | v2.0 single-instance only. Revisit in v2.1 when HA is considered. |
| Session storage in Postgres (vs Redis) | No Redis infra | Session table grows unboundedly without a cleanup job; session lookup adds 1 DB round-trip per request | Acceptable for v2.0 single-instance. Requires a cleanup cron for `sessions WHERE expires_at < now()`. |
| Single-node WS fanout without pub/sub | No message broker | Cannot scale to multiple server instances; fanout is blocked by slow subscribers | Acceptable for v2.0. v2.1 with Redis pub/sub requires changing only `fanout.ts`. |
| Plugin system with static registration only | Security, reproducibility | Adding a new trigger type requires a server redeploy | Acceptable and correct for v2.0 with only 2 plugins. |
| Log retention via background cron (not streaming delete) | Simpler implementation | Retention is coarse-grained (fires every 6h); burst of deletes can cause lock contention | Acceptable. Add `LIMIT 10000` per deletion batch to reduce lock contention. |
| Drizzle `jsonb` for `trigger_metadata` and `labels` | Flexible schema evolution | No type safety at query time; jsonb queries are slower than column queries | Acceptable. Type safety is enforced at the application layer via TypeScript. |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `pnpm workspace:*` deps in Docker | `packages/xci` workspace dep not resolved in Docker build because pnpm-workspace.yaml is not copied | Copy `pnpm-workspace.yaml` BEFORE running `pnpm install` in the builder stage. See STACK.md Dockerfile. |
| `@node-rs/argon2` prebuilt binaries | Installing on Alpine (musl) picks up wrong prebuilt binary, falls back to node-gyp compilation which fails | Use `node:22-slim` (glibc). Already specified in STACK.md. |
| Fastify `rawBody` for HMAC verification | `@fastify/rawbody` plugin must be registered BEFORE the route. If registered after, `request.rawBody` is undefined | Register `@fastify/rawbody` in `app.ts` before route plugins are registered. |
| `reconnecting-websocket` in Node.js | Default export is a browser `WebSocket` wrapper. In Node.js, must pass `ws` as the `WebSocket` constructor: `new ReconnectingWebSocket(url, [], { WebSocket: ws })` | See STACK.md. Test the agent's reconnection in a Node.js environment, not just in the browser. |
| Drizzle `ON CONFLICT DO NOTHING` | Does not return the conflicting row — returns `null`. Code that assumes `queryOne` always returns a row will throw a null dereference | Always check the return value of idempotent INSERTs for null. |
| Fastify `@fastify/csrf-protection` + JSON API | CSRF plugin checks for a CSRF token header on POST/PUT/DELETE. The xci agent's REST calls (from the CLI, not a browser) don't send a CSRF header and will be rejected | Scope `@fastify/csrf-protection` only to routes that are called from the browser SPA. Agent REST endpoints use Bearer token auth instead of session cookies — CSRF protection is not applicable to them. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 query in agent list API | Dashboard agent list loads in 200ms with 5 agents, 3s with 50 agents | Use a single `JOIN` query: `SELECT agents.*, agent_tokens.revoked_at FROM agents LEFT JOIN agent_tokens` instead of N token queries | At ~20 agents |
| Log viewer rendering 100K DOM nodes | Browser freezes when viewing long builds | Use a virtualized list (react-window or TanStack Virtual). Render only the visible rows. | At ~5K log lines |
| `SELECT COUNT(*)` on `log_chunks` for billing stats | Count queries on large tables take seconds as the table grows | Use `pg_catalog.reltuples` for approximate counts, or maintain a counter in `org_usage_stats`. `COUNT(*)` is fine for small tables but catastrophic at 100M+ rows. | At ~10M log chunks |
| `log_chunks` table growing without partition pruning | Retention DELETE is slow on a 500M-row table | Partition `log_chunks` by `received_at` (monthly partitions). Retention then becomes `DROP TABLE log_chunks_2024_01` — O(1) instead of O(N). | At ~50M rows (2-3 months of moderate usage) |
| WS registry using `Map<agentId, WebSocket>` scanned per-dispatch | Dispatch scans the entire registry to find eligible agents | Add an `onlineAgentsByOrg: Map<orgId, Map<agentId, WebSocket>>` index to the registry | At ~100 agents |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| MEK stored in `orgs` table or any DB location | If DB is breached, attacker can decrypt all org DEKs and secrets | MEK is ONLY in `XCI_MASTER_KEY` env var or Docker secret. Never in DB. |
| Admin endpoints skipping org isolation middleware | An admin user in Org A can modify Org B's resources | All authenticated routes must use `fastify.authenticate` hook which sets `request.session.orgId`. Admin role check is a second check, not a replacement for org isolation. |
| `DELETE /api/agents/:id` without verifying org ownership | Org A can delete Org B's agents by guessing agent UUIDs | The route handler uses `makeAgentsRepo(db, request.session.orgId).deleteById(id)` — which includes the `AND org_id = ${orgId}` filter. The delete fails silently (0 rows affected) if the agent belongs to a different org. Return 404 in this case (not 403, to avoid confirming that the ID exists). |
| Password reset token stored unhashed | DB breach exposes all reset tokens | Store `sha256(token)` in `password_reset_tokens.token_hash`. The raw token is sent only once via email and never stored. |
| Session token stored unhashed | DB breach exposes all sessions → immediate account takeover | Store `sha256(token)` in `sessions.token_hash`. Already specified in the schema. |
| Webhook endpoint accepts `GET` requests | Search engine crawlers trigger webhook processing | Webhook route is `POST` only. `GET /api/webhooks/:orgSlug/:plugin` returns 405 Method Not Allowed. |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No empty states in the agent list or task list | New user sees blank page, assumes the product is broken | Add empty states with actionable CTAs for all list views before Phase J ships. |
| Error toasts with no recovery action | User sees "Task failed" toast but doesn't know how to retry | Error toasts include a link: "View logs" for task failures, "Retry" button for transient errors. |
| WS disconnect not indicated (Pitfall 28) | User makes decisions based on stale data | Implement the `useWsConnection()` hook with visual reconnecting banner. |
| Log viewer scroll stolen during live stream (Pitfall 26) | User can't review earlier output while build runs | Implement ref-based scroll tracking (not state-based). |
| Dark mode not honored by system preference | Dashboard is jarring in dark-mode OS | Build with CSS custom properties (`--color-bg`, etc.) from day one. A `@media (prefers-color-scheme: dark)` block then covers basic dark mode with minimal effort. |
| Keyboard trap in YAML task editor (Monaco) | Tab key inserts a tab in Monaco, preventing keyboard navigation to the Save button | Use Monaco's `tabMovesFocus` option or provide an explicit "Submit" keyboard shortcut (Ctrl+Enter). |

---

## "Looks Done But Isn't" Checklist

- [ ] **Agent reconnect:** Often missing `currentTaskRunId` handling — verify the server correctly reconciles in-progress tasks after reconnect (not just new connections).
- [ ] **Multi-org isolation:** Often missing a test that creates two orgs and verifies cross-org data is invisible — verify via the multi-org integration test fixture.
- [ ] **Revocation check on reconnect:** Often the reconnect path omits `AND revoked_at IS NULL` — verify by revoking a token and reconnecting.
- [ ] **Log redaction before storage:** Often implemented only at display time — verify `log_chunks` rows in the DB do not contain plaintext secret values.
- [ ] **Plugin config encryption:** Often `plugin_configs.config` is stored in plain text — verify the column contains encrypted bytes, not a plain JSON object.
- [ ] **Delivery idempotency:** Often missing the `ON CONFLICT (delivery_id) DO NOTHING` — verify that sending the same webhook twice creates only one `task_run`.
- [ ] **ws not in CLI bundle:** Often regresses when new shared types are added — verify with `du -sh dist/cli.mjs` after every Phase D–H change to `packages/xci/`.
- [ ] **Queue reconciliation on startup:** Often missing — verify that task runs in `queued` state survive a server restart and are re-dispatched.
- [ ] **Drizzle migrator (not drizzle-kit) in Docker:** Often wrong — verify `drizzle-kit` is NOT in `@xci/server/package.json` `dependencies`.
- [ ] **Heartbeat terminates dead connections:** Often ping is sent but the pong timeout is not wired — verify that killing an agent at the network layer (not sending FIN) marks it offline within 35 seconds.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| ws bundled into CLI | LOW | Update tsup external list, rebuild, release patch. Cold-start regresses for users until they upgrade. |
| Multi-org data leakage | CRITICAL | Immediate: take server offline, patch query, restore DB from backup. Notify affected orgs (GDPR/compliance obligation). Audit all logs for exposure window. |
| MEK in Docker ENV visible | HIGH | Rotate MEK: generate new MEK, re-encrypt all org DEKs with new MEK, update container deployment with Docker secret, redeploy. Audit who had access to the old value. |
| IV reuse in encryption | HIGH | Rotate all affected org DEKs: re-encrypt all `org_secrets` with new DEK generated with fresh IV. |
| Agent token in URL logged | MEDIUM | Revoke all agent tokens, issue new tokens, advise operators to rotate. Purge log archives from affected time range (not always possible). |
| Webhook duplicate dispatch | LOW | Delete duplicate `task_runs`. Add the `ON CONFLICT` constraint. Redeploy. |
| Log streaming out-of-order | MEDIUM | Re-stream from DB (order by seq). Fix the buffer→fanout ordering in the next release. |
| Retention deleting active runs | HIGH | Restore deleted rows from DB backup. Add the `status` filter to the retention query. Redeploy. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P1: ws bundled into CLI | Phase A | CI step: `du -sh packages/xci/dist/cli.mjs` fails if > 200KB |
| P2: v1 test suite broken by monorepo | Phase A | CI job: `pnpm --filter xci test` is a required check |
| P3: ws via indirect type import | Phase A | Biome import restriction + bundle size check |
| P4: top-level await in agent.ts | Phase D | ESLint/Biome no-top-level-await rule; cold-start benchmark |
| P5: exit code regression | Phase D | Test: `xci nonexistent-alias` exits 50 after agent mode added |
| P6: half-open WS via NAT | Phase D | Integration test: kill agent network, verify server marks offline ≤35s |
| P7: reconnection storm | Phase D + Phase B | Load test: restart server with 20 mock agents connected |
| P8: frame size without fragmentation | Phase G | Test: agent emits 128KB chunk, verify stored as 2 sequential chunks |
| P9: message ordering in buffer/fanout | Phase G | Test: browser reconnects mid-run, verify no gap in chunk sequence |
| P10: slow browser blocks agent stream | Phase G | Load test: add 1 crippled subscriber, verify other subscribers unaffected |
| P11: retention racing with active stream | Phase G | Test: retention job fires while task is running, verify run is not deleted |
| P12: MEK in Docker ENV | Phase I + Phase L | `docker inspect` shows no `XCI_MASTER_KEY`; startup warning in logs |
| P13: IV reuse | Phase I | Unit test: two encrypt calls produce different IVs |
| P14: missing org filter (HIGHEST RISK) | Phase C (fixture) + every subsequent phase | Multi-org integration test covers every API endpoint and WS handler |
| P15: WS log subscription cross-org | Phase G | Multi-org test covers the WS log subscription path |
| P16: agent token in URL | Phase D | Test: WS upgrade URL contains no `token=` parameter |
| P17: revocation check skipped on reconnect | Phase D | Test: revoke token, reconnect, expect handshake_reject |
| P18: HMAC compared with `===` | Phase H | Static analysis test; biome lint rule |
| P19: secrets logged via pino | Phase C (configure) + Phase I (test) | Integration test: POST /api/secrets, scan pino output |
| P20: plugin config stored unencrypted | Phase H | Integration test: verify `plugin_configs.config` column contains bytes |
| P21: base64 secret bypass | Phase G + Phase I | Test: log contains base64-encoded secret value, verify it is redacted |
| P22: DB pool exhaustion | Phase B (configure) + Phase G (batch writes) | Load test: 50 concurrent log streams, verify pool utilization < 80% |
| P23: drizzle-kit in production | Phase B + Phase L | Verify `drizzle-kit` not in prod deps; Docker smoke test |
| P24: quota check after resource creation | Phase D + Phase K | Test: concurrent registrations at quota boundary |
| P25: no E2E for full pipeline | Phase F + Phase H | Playwright test: webhook → log viewer shows output |
| P26: scroll position stolen | Phase J | Manual test + automated Playwright scroll test |
| P27: server published before web | Phase L | CI smoke test: `curl -f http://localhost:3000/` returns HTML |
| P28: WS disconnect not in UI | Phase J | Playwright test: kill server WS, verify banner appears |
| P29: duplicate dispatch on webhook retry | Phase H | Test: send same webhook twice, verify 1 task_run created |

---

## Sources

- Buildkite Agent source (Go): NAT half-open detection via ping/pong in `agent/agent.go` — connection termination after missed pong
- GitHub Actions runner source: timing-safe token comparison in auth handler
- Drone CI log masking feature request (Harness Ideas): base64-encoded secret bypass — https://ideas.harness.io/feature-request/p/drone-ci-masking-secrets-in-the-execution-logs-after-they-are-base64-encoded
- Buildkite HMAC signed webhooks: https://buildkite.com/resources/changelog/128-hmac-signed-webhooks/ — timingSafeEqual requirement
- node:crypto AES-GCM IV reuse security implications: https://nodejs.org/api/crypto.html — authoritative
- Docker secrets vs ENV for sensitive data: https://docs.docker.com/engine/swarm/secrets/ — authoritative
- pnpm workspace Docker pitfall (copying workspace YAML): https://pnpm.io/docker — authoritative
- Drizzle programmatic migrator vs drizzle-kit: https://orm.drizzle.team/docs/migrations — authoritative
- WebSocket backpressure in Node.js ws library: https://github.com/websockets/ws/blob/master/README.md#how-to-detect-and-close-broken-connections — HIGH confidence
- GitHub webhook delivery retry behavior: https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks#retries — HIGH confidence

---

*Pitfalls research for: xci v2.0 Remote CI — Agents + Web Dashboard (adding distributed features to existing local CLI)*
*Researched: 2026-04-16*
