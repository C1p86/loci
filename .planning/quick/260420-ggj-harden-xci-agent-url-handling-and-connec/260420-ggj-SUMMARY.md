---
phase: 260420-ggj
plan: 01
subsystem: xci-agent + web-dashboard
tags: [agent, websocket, url-normalization, stderr-logging, ui, registration-command]
dependency_graph:
  requires:
    - packages/xci/src/errors.ts (AgentModeArgsError — unchanged, imported)
    - packages/xci/src/agent/client.ts (AgentClient — modified for WS event logging)
    - packages/xci/src/agent/index.ts (runAgent — threaded normalized URL)
    - packages/web/src/routes/agents/AgentsEmptyState.tsx (UI registration command)
  provides:
    - packages/xci/src/agent/url.ts (normalizeAgentUrl — canonical WS URL parser)
    - packages/web/src/lib/agentUrl.ts (buildAgentWsUrl — browser-safe twin)
    - Single stderr line "[agent] connecting to <wss|ws>://host[:port]/ws/agent" before socket open
    - Per-error-event stderr "[agent] connect error: <msg>" + one-time "[agent] retrying (exponential backoff, max 30s)" notice
    - "[agent] websocket open" / "[agent] websocket open (reconnected)" on successful open
  affects:
    - UX: xci --agent now accepts http/https/ws/wss/bare-host:port inputs (was ws/wss only)
    - UX: DNS miss / connection refused / 404-at-upgrade produce stderr output instead of silent hang
    - UX: web dashboard registration command copy-paste works on first try (canonical /ws/agent path)
tech_stack:
  added: []
  patterns:
    - WHATWG URL parser with explicit scheme allow-list (http/https/ws/wss only — reject file:, javascript:, data:)
    - Browser-safe URL normalizer that fails open (return input unchanged) so UI never blows up; CLI-side normalizer is authoritative
    - One-time retry-notice boolean guard reset on every successful open (retries re-log after reconnect failure)
    - reconnecting-websocket ErrorEvent type imported from the library directly (no DOM ambient dependency)
key_files:
  created:
    - packages/xci/src/agent/url.ts
    - packages/xci/src/agent/__tests__/url.test.ts
    - packages/web/src/lib/agentUrl.ts
    - packages/web/src/lib/__tests__/agentUrl.test.ts
  modified:
    - packages/xci/src/agent/index.ts (normalizedUrl wiring + startup log)
    - packages/xci/src/agent/client.ts (open + error listeners with state)
    - packages/web/src/routes/agents/AgentsEmptyState.tsx (use buildAgentWsUrl)
    - packages/web/src/__tests__/AgentsEmptyState.test.tsx (assertion updated to canonical URL)
decisions:
  - "normalizeAgentUrl uses WHATWG URL parser exclusively — explicit scheme allow-list (http/https/ws/wss) rejects file:, javascript:, data:; T-260420-ggj-01 mitigated"
  - "Custom reverse-proxy paths preserved verbatim (anything other than '' or '/' passes through)"
  - "Bare 'host[:port]' detected by absence of ://, prefixed with ws:// before URL.parse so WHATWG has a scheme to parse"
  - "AgentClient tracks hasOpenedOnce + hasLoggedRetry booleans to (a) distinguish first open from reconnect in log text and (b) throttle the retry notice to once per disconnect-reconnect cycle"
  - "hasLoggedRetry reset on every successful open so subsequent disconnect-reconnect cycles can re-emit retry notice if they also fail"
  - "buildAgentWsUrl (web) returns input unchanged on unparseable input — UI never throws; CLI-side normalizer issues the authoritative error when the user runs the pasted command (T-260420-ggj-04 mitigated)"
  - "ErrorEvent type imported from 'reconnecting-websocket' (not DOM ambient) — matches the library's callback signature; avoids dependence on lib.dom.d.ts"
  - "startup stderr line emitted ONCE before AgentClient construction — does not leak the registration token (token only in register frame body per v2.0 decision)"
metrics:
  duration: ~22m
  completed: 2026-04-20
  tasks_completed: 4
  files_created: 4
  files_modified: 4
  commits: 4 (3 feature + 1 fix follow-up)
---

# Phase 260420-ggj: Harden xci agent URL handling and connection error logging — Summary

## One-liner

WHATWG-URL-based `normalizeAgentUrl` coerces http(s)/ws(s)/bare-host `--agent` inputs to canonical `{ws|wss}://host[:port]/ws/agent`, AgentClient now logs open + per-error-event + one-shot retry notices to stderr, and the web dashboard's registration command composes the same canonical URL so copy-paste works on the first try.

## What changed (4 commits)

| # | Commit | Subject |
|---|--------|---------|
| 1 | `9ed368b` | `feat(xci): normalize agent URL + startup log` |
| 2 | `6e1ffd3` | `feat(xci): log WS connect errors and open events` |
| 3 | `1d11d70` | `feat(web): UI emits ws://host/ws/agent in registration command` |
| 4 | `d804448` | `fix(xci): type ErrorEvent parameter in AgentClient error listener` (follow-up to #2) |

## Files

### Created (4)
- `packages/xci/src/agent/url.ts` — normalizeAgentUrl() (68 lines)
- `packages/xci/src/agent/__tests__/url.test.ts` — 14 tests (40 lines)
- `packages/web/src/lib/agentUrl.ts` — buildAgentWsUrl() (38 lines)
- `packages/web/src/lib/__tests__/agentUrl.test.ts` — 6 tests (19 lines)

### Modified (4)
- `packages/xci/src/agent/index.ts` — +import, +normalizedUrl computed after !flags.agent guard, +stderr "[agent] connecting to …" line, server_url + AgentClient.url use normalizedUrl
- `packages/xci/src/agent/client.ts` — +hasOpenedOnce, +hasLoggedRetry, open listener rewrite, new error listener, ErrorEvent import from reconnecting-websocket
- `packages/web/src/routes/agents/AgentsEmptyState.tsx` — import buildAgentWsUrl; command template uses the normalized URL
- `packages/web/src/__tests__/AgentsEmptyState.test.tsx` — assertion regex updated to `/xci --agent wss:\/\/app\.example\.com\/ws\/agent --token SECRET-TOKEN-123/`

## Verify sweep (Task D)

| # | Gate | Result |
|---|------|--------|
| 1 | `pnpm --filter xci test` | **417 passed**, 1 pre-existing failure (see Deferred Issues #1), +14 new url.test.ts tests green |
| 2 | `pnpm --filter @xci/web test` | **101 passed**, 1 pre-existing suite-level failure (see Deferred Issues #2), +6 new agentUrl.test.ts green, AgentsEmptyState all 6 green |
| 3 | `pnpm --filter xci typecheck` | **103 errors** — zero delta from base `bdf3598` (same count before my edits; see Deferred Issues #3) |
| 4 | `pnpm --filter @xci/web typecheck` | **PASS** (exit 0) |
| 5 | `pnpm --filter xci build` | **PASS** — `dist/cli.mjs` 795 KB, `dist/agent.mjs` 531 KB; tsup onSuccess hook ran ("rewrote ./agent/index.js → ./agent.mjs in dist/cli.mjs") |
| 5a | `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` | **1** — 260420-ezf regression guard GREEN (required ≥ 1) |
| 6 | `pnpm --filter @xci/web build` | **PASS** — `dist/assets/index-DU4v1xcH.js` 178 KB gzipped |

**All critical gates pass.** The test suite failures are pre-existing at base commit `bdf3598` (reproduced by stashing my changes and re-running); none are caused by this plan's edits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 – Bug] Type mismatch in new error listener (commit `d804448`)**
- **Found during:** Task D typecheck gate after committing Task B (`6e1ffd3`).
- **Issue:** The error listener added in Task B was annotated `(event: Event)` (global DOM Event), but `reconnecting-websocket`'s `addEventListener('error', …)` overload demands `ErrorEvent` (from `reconnecting-websocket/dist/events.d.ts`). TS2345 under `--filter xci typecheck`.
- **Fix:** Imported `ErrorEvent` as a type from `reconnecting-websocket` and used it in the callback signature. Dropped the structural cast since `ErrorEvent` already exposes `.message: string`. Zero behavior change.
- **Files modified:** `packages/xci/src/agent/client.ts`
- **Commit:** `d804448`
- **Why a separate commit, not an amend:** GSD git safety protocol forbids `--amend`; interactive rebase also forbidden. Additional atomic fix commit tracks the defect transparently.

### Deferred Issues (pre-existing, out of scope)

See `deferred-items.md` in this directory for details:
1. `packages/xci/src/__tests__/cold-start.test.ts` line 38 assertion is stale after 260420-ezf's post-build rewrite (expects `./agent/index.js` but the build now emits `./agent.mjs`). Orchestrator's grep gate on `./agent.mjs` is the authoritative regression guard and it passes.
2. `packages/web/e2e/smoke.spec.ts` is picked up by vitest's runner and throws a Playwright `test.describe()` error; vitest config needs to exclude `e2e/**`. All 101 vitest tests still pass.
3. xci typecheck reports 103 pre-existing errors (largely `src/tui/**`, `src/cli.ts`, `src/executor/**`, `src/resolver/**`, `src/template/**`, `tsup.config.ts`). Count unchanged by this plan.

## Threat model status

All 5 threats from the plan's STRIDE register addressed per plan:
- **T-01 Tampering (URL parser):** mitigate — WHATWG URL + explicit scheme allow-list ✓
- **T-02 Info disclosure (stderr):** mitigate — log lines use only normalizedUrl (no token); error event `.message` is library-generated ✓
- **T-03 DoS (retry notice spam):** accept — boolean guard limits to once per disconnect-reconnect cycle ✓
- **T-04 Tampering (UI URL builder):** mitigate — browser URL parser + fail-open on unparseable ✓
- **T-05 Info disclosure (registration command):** accept — token inline in command is by design; existing test coverage preserved ✓

No new threat surface introduced beyond the plan's register.

## Self-Check: PASSED

- [x] `packages/xci/src/agent/url.ts` — FOUND
- [x] `packages/xci/src/agent/__tests__/url.test.ts` — FOUND
- [x] `packages/web/src/lib/agentUrl.ts` — FOUND
- [x] `packages/web/src/lib/__tests__/agentUrl.test.ts` — FOUND
- [x] Modified `packages/xci/src/agent/index.ts` — present (normalizeAgentUrl import + normalizedUrl wiring + stderr line)
- [x] Modified `packages/xci/src/agent/client.ts` — present (hasOpenedOnce/hasLoggedRetry fields, open + error listeners)
- [x] Modified `packages/web/src/routes/agents/AgentsEmptyState.tsx` — present (buildAgentWsUrl import + agentWsUrl derivation)
- [x] Modified `packages/web/src/__tests__/AgentsEmptyState.test.tsx` — present (canonical URL assertion)
- [x] Commit `9ed368b` — FOUND in git log
- [x] Commit `6e1ffd3` — FOUND in git log
- [x] Commit `1d11d70` — FOUND in git log
- [x] Commit `d804448` — FOUND in git log
- [x] `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` = 1 (≥ 1 required) — 260420-ezf regression guard preserved
