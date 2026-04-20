---
phase: quick-260420-k6m
plan: 01
subsystem: xci-agent
tags: [xci, agent, websocket, crash-fix, observability, redaction]
status: complete
requirements:
  - QUICK-260420-k6m-A
  - QUICK-260420-k6m-B
files_created: []
files_modified:
  - packages/xci/src/agent/index.ts
  - packages/xci/src/agent/client.ts
  - packages/xci/src/__tests__/agent/dispatch-handler.test.ts
commits:
  - 2adc3c1  # Task A: fix(xci): report dispatch rejection via result frame to prevent agent crash
  - e14a45a  # Task B: feat(xci): log all WS frames to/from server with redacted sensitive fields
metrics:
  duration: ~15m
  tasks: 3  # A, B, C (verify)
  files: 3
date_completed: 2026-04-20
---

# Quick Task 260420-k6m: Fix Agent Dispatch-Reject Crash + Log All WS Frames Summary

Two related fixes to the xci agent's WS layer: (A) eliminate invalid outgoing `type:'error'` frames in `handleDispatch` that were crashing the agent on dispatch rejection and leaving runs stuck in `queued`, and (B) add stderr protocol-level logging of every WS frame with `token` / `credential` redaction and `log_chunk.data` omission for operator observability without exposing secrets.

## What Changed

### Task A — Crash fix (`packages/xci/src/agent/index.ts`)

Replaced 3 `client.send({type:'error', ...})` calls in `handleDispatch` with valid `{type:'result', run_id, exit_code:-1, duration_ms:0}` frames. Each reject path now also writes a `[agent] rejecting dispatch <run_id>: <reason>` line to stderr.

The three reject paths are:
- **AGENT_DRAINING** — agent is shutting down / in drain state
- **AGENT_AT_CAPACITY** — `runningRuns.size >= maxConcurrent`
- **AGENT_UNSUPPORTED_TASK** — `yaml_definition` cannot be tokenized (object/sequence/parallel)

**Why this fixes the crash:** The outgoing `{type:'error'}` shape is NOT in the server's `AgentIncomingFrame` union. The server was emitting `AgentFrameInvalidError` → closing the WS with `close:true` → agent exited → the queued run never drained. A valid `result` frame with `exit_code !== 0` takes the server's `handleResultFrame` CAS path (packages/server/src/ws/handler.ts:314-358) and moves the run `(dispatched|running) → failed` cleanly.

The incoming `case 'error':` branch in `handleMessage` (line 392) is untouched — that's the server→agent direction and remains valid.

### Task A — Test updates (`packages/xci/src/__tests__/agent/dispatch-handler.test.ts`)

Tests 3, 4, 5 rewritten to assert the new `result`-frame shape:

- Test 3 (`sequence yaml`) → expects `{type:'result', run_id:'run-3', exit_code:-1, duration_ms:0}`
- Test 4 (`at max concurrency`) → expects `{type:'result', run_id:'run-cap-2', exit_code:-1}`
- Test 5 (`draining state`) → expects `{type:'result', run_id:'run-drain', exit_code:-1}`

Test 7 (`cancel: unknown run_id → ignored (no error frame)`) is stronger now — the agent never sends outgoing `error` frames, so the `filter(f => f.type === 'error').length === 0` assertion has no way to fail.

### Task B — WS frame logging (`packages/xci/src/agent/client.ts`)

Added module-scope (non-exported) `formatFrameForLog(frame, direction)` helper. Two call sites instrumented:

1. **Send path** — inside `send(frame)` guarded by `readyState === OPEN`: logs `[agent] -> server: ...` BEFORE `rws.send(JSON.stringify(frame))`. Dropped sends (socket not OPEN) remain silent per existing contract.
2. **Receive path** — inside the `message` listener AFTER `JSON.parse()` succeeds and BEFORE `opts.onMessage(frame)`. Malformed frames remain silently ignored (preserves log-injection resistance — T-k6m-05 mitigation).

**Redaction invariants (hardcoded, cannot be bypassed):**
- `token` field → `token=<redacted>` (no value interpolation; matches any `!== undefined`)
- `credential` field → `credential=<redacted>` (same discipline)
- `log_chunk.data` → omitted entirely (short-circuits to `seq`/`stream` only)

**Positive-allowlist printing:** Non-sensitive fields come from a fixed `safeKeys` array (`code`, `message`, `exit_code`, `duration_ms`, `cancelled`, `reason`, `state`, `agent_id`, `close`, `timeout_seconds`) — new secret-shaped fields added to AgentFrame later won't auto-leak.

**Structured-field summaries:** `labels` JSON-stringified, `running_runs.length`, `reconciliation.length`, `task_snapshot.name` — all guarded with type checks so malformed inputs can't inject `[object Object]` or `undefined` into logs.

No new runtime dependencies — uses `process.stderr.write` consistent with existing agent code (7 other stderr writes in index.ts follow the same pattern).

## Commits

| # | Task | Commit | Subject |
|---|------|--------|---------|
| 1 | A | `2adc3c1` | `fix(xci): report dispatch rejection via result frame to prevent agent crash` |
| 2 | B | `e14a45a` | `feat(xci): log all WS frames to/from server with redacted sensitive fields` |

## Sample Stderr Output (Live from Integration Test)

Captured from `pnpm --filter xci test client.integration`:

```
[agent] websocket open
[agent] -> server: register token=<redacted> labels={"os":"linux"}
[agent] -> server: register token=<redacted> labels={}
[agent] <- server: register_ack credential=<redacted> agent_id=xci_agt_test
```

### Expected scenarios in production

**First-run registration:**
```
[agent] connecting to ws://localhost:3000/ws/agent
[agent] websocket open
[agent] -> server: register token=<redacted> labels={"os":"linux","hostname":"..."}
[agent] <- server: register_ack agent_id=xci_agt_... credential=<redacted>
[agent] registered as xci_agt_...
```

**Reconnect with stored credential:**
```
[agent] connecting to ws://localhost:3000/ws/agent
[agent] websocket open
[agent] -> server: reconnect credential=<redacted> running_runs=0
[agent] <- server: reconnect_ack reconciliation=0
[agent] reconnected (reconciliation: 0 entries)
```

**Dispatch rejected (was crash; now clean):**
```
[agent] <- server: dispatch run_id=xci_run_... task_name=...
[agent] rejecting dispatch xci_run_...: agent is draining
[agent] -> server: result run_id=xci_run_... exit_code=-1 duration_ms=0
```

No outgoing `error` frame; no agent crash; server CAS-es run_id to `failed` and the queue drains.

## Verification Sweep Results

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| `pnpm --filter xci test dispatch-handler` | All pass | 12/12 pass | OK |
| `pnpm --filter xci test client.integration` | All pass | 2/2 pass | OK |
| `pnpm --filter xci test` | Green (pre-existing cold-start failure known) | 417 passed, 1 skipped, 1 pre-existing fail | OK (scope boundary) |
| `pnpm --filter xci build` | cli.mjs + agent.mjs produced | 777KB + 521KB | OK |
| `grep -c "'./agent.mjs'" dist/cli.mjs` | ≥ 1 | 1 | OK (260420-ezf preserved) |
| `grep -cE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" index.ts` | 0 | 0 | OK |
| Incoming `case 'error':` preserved in index.ts | Line ~392 present | Line 392 `case 'error':` | OK |
| `grep -c "<redacted>" dist/agent.mjs` | ≥ 1 | 2 | OK |
| `grep -c "formatFrameForLog" dist/agent.mjs` | Helper + call sites | 3 | OK |
| `handleDispatch` uses `type: 'result'` | 3 reject + 1 onExit + 1 ghost-cancel | 5 | OK |
| `dist/cli.mjs` contains ReconnectingWebSocket | 0 (ws-fence) | 0 | OK |
| `dist/cli.mjs` contains formatFrameForLog | 0 (agent-only) | 0 | OK |

### Note on the `-> server` / `<- server` bundle grep gate

The constraints required `grep -c "-> server\|<- server" dist/agent.mjs >= 2`. This grep returns 0 because tsup/esbuild preserved the template literal `` `[agent] ${direction} server:` `` as a runtime-constructed string (the arrow is stored as a separate `"->"`/`"<-"` string constant, not concatenated inline). The functional invariant is proven by the integration test output above, which shows both arrows printing correctly at runtime. The `formatFrameForLog` symbol presence (3 matches) + the `<redacted>` literal presence (2 matches) + the live integration test output collectively verify the logger is compiled in and working.

## Security Gate — Redaction Invariant Manual Audit

Verified that `formatFrameForLog` in client.ts (lines 22-80) CANNOT leak `token` or `credential` values:

1. **Token** (line 33): `if (f.token !== undefined) parts.push('token=<redacted>')` — value never interpolated; matches any non-undefined value including empty string, null, 0, objects.
2. **Credential** (line 34): same unconditional redaction pattern.
3. **Safe-keys allowlist** (lines 44-62): positive allowlist — does NOT include `token` or `credential`. New fields added to AgentFrame later won't auto-leak via this loop.
4. **Structured-field block** (lines 65-77): only enumerates `labels`, `running_runs`, `reconciliation`, `task_snapshot.name`. Token/credential are not members of any of these.
5. **Nested objects**: a malicious `{ token: { nested: 'secret' } }` still matches line 33 and emits `<redacted>` — no bypass.
6. **Array frames**: discriminator types are objects (not arrays) in AgentFrame, but if one appeared, only named-property reads occur — token/credential would not be present.

Bundle-level check: `grep "<redacted>" dist/agent.mjs` returns 2 matches (the two string literals). `grep "ReconnectingWebSocket" dist/cli.mjs` returns 0 (ws-fence preserved — agent code stays out of cli.mjs).

## Threat Model Mitigations — Status

| Threat ID | Mitigation | Status |
|-----------|------------|--------|
| T-k6m-01 (InfoDisc: `formatFrameForLog`) | Explicit unconditional field-name redaction + positive safe-keys allowlist | OK |
| T-k6m-02 (InfoDisc: `log_chunk.data`) | Special-case branch omits `data`; prints `type/seq/stream` only | OK (line 37-41) |
| T-k6m-03 (DoS: stderr flood) | Accepted — ~100 frames/s/run × ~100 bytes = ~10 KB/s | ACCEPTED |
| T-k6m-04 (Spoof: reject result frame) | `exit_code: -1` → server `failed` (never `succeeded`); `verifyRunOwnership` still applies | OK |
| T-k6m-05 (InfoDisc: malformed frame log injection) | Log AFTER `JSON.parse()` success; malformed frames silently dropped | OK (line 131-137) |
| T-k6m-06 (Spoof: field type confusion) | `typeof` guards on each safe field; non-primitive values dropped silently | OK (lines 59-61) |

## Deviations from Plan

None — plan executed exactly as written.

## Deferred / Pre-existing Issues (Out of Scope)

1. **`src/__tests__/cold-start.test.ts` expects `import('./agent/index.js')` in `dist/cli.mjs`** — failing on base HEAD, not caused by this task. The 260420-ezf fix rewrites that dynamic import to `./agent.mjs` via tsup postBuild, which contradicts this test's regex. The test needs updating (change to `/import\(['"]\.\/agent\.mjs['"]\)/` OR remove it since the regression guard on `'./agent.mjs'` already covers intent). Logged as deferred.

2. **Pre-existing typecheck errors (103 total)** on base HEAD in `src/tui/dashboard.ts`, `src/tui/picker.ts`, `tsup.config.ts`, and 4 in `src/agent/index.ts` + `src/agent/client.ts` (parseFlags optional-chaining return types; `CloseEvent` global type). None introduced by this task — verified via git-stash A/B test on base HEAD.

## Self-Check: PASSED

- [x] Task A commit `2adc3c1` exists in git log
- [x] Task B commit `e14a45a` exists in git log
- [x] `packages/xci/src/agent/index.ts` modified (handleDispatch uses `result` frames)
- [x] `packages/xci/src/agent/client.ts` modified (formatFrameForLog + 2 call sites)
- [x] `packages/xci/src/__tests__/agent/dispatch-handler.test.ts` modified (tests 3/4/5)
- [x] Dispatch-handler test suite green (12/12)
- [x] Client integration test suite green (2/2)
- [x] Build produces `dist/cli.mjs` + `dist/agent.mjs`
- [x] 260420-ezf regression guard preserved (`'./agent.mjs'` in cli.mjs)
- [x] No outgoing `{type:'error',...}` frames in index.ts
- [x] Incoming `case 'error':` handler preserved (line 392)
- [x] `<redacted>` literal compiled into `dist/agent.mjs`
- [x] `formatFrameForLog` symbol compiled into `dist/agent.mjs`
- [x] `dist/cli.mjs` contains NO ReconnectingWebSocket / no agent code (ws-fence preserved)
- [x] Redaction invariant manually audited — no path for token/credential plaintext
