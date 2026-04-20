---
phase: 260420-llo
plan: 01
subsystem: xci-agent
tags: [agent, dispatch, logging, observability]
requires: []
provides:
  - agent.onchunk.local-echo
affects:
  - packages/xci/src/agent/index.ts
tech-stack:
  added: []
  patterns:
    - "direct process.stdout.write / process.stderr.write for raw passthrough echo"
key-files:
  created: []
  modified:
    - packages/xci/src/agent/index.ts
decisions:
  - "No CLI flag or env-var toggle: local echo is always on (plan explicitly mandates unconditional)."
  - "Echo placed BEFORE client.send(log_chunk) to guarantee operator sees output even if WS send fails or backpressures."
  - "Data is not re-redacted in agent/index.ts — redactLine() in runner.ts:161 already sanitizes chunks upstream, so local echo inherits identical redaction as server stream (plan-asserted truth)."
metrics:
  duration_minutes: 5
  tasks_completed: 2
  files_modified: 1
  commits: 1
  completed: 2026-04-20
requirements:
  - QUICK-260420-llo
---

# Phase 260420-llo Plan 01: Agent Echoes Task stdout/stderr to Local Terminal Summary

Agent `handleDispatch.onChunk` callback now writes already-redacted chunk data to `process.stdout` / `process.stderr` before forwarding the `log_chunk` frame to the server, giving foreground operators real-time task output.

## What Changed

**Task A — Local echo in onChunk callback** (commit `93be7cf`)
- `packages/xci/src/agent/index.ts` lines 285-290: added a 6-line block inside the existing `onChunk: (stream, data, seq) => { ... }` arrow that branches on `stream` and invokes `process.stdout.write(data)` or `process.stderr.write(data)`.
- The subsequent `client?.send({ type: 'log_chunk', ... })` call is byte-identical to the prior version — server log stream is unchanged.
- No new dependencies, no new flags, no buffering, no prefix/timestamp/color — raw passthrough as specified.

**Task B — Verification (no commit, verify-only)**

| Gate | Result | Notes |
|------|--------|-------|
| Automated verify (`grep process.stdout.write(data)` / `process.stderr.write(data)` in `src/agent/index.ts`) | PASS | Lines 287 and 289 present. |
| `pnpm -C packages/xci build` | PASS | `dist/cli.mjs` (777 KB) and `dist/agent.mjs` (534 KB) emitted. tsup rewrite `./agent/index.js → ./agent.mjs` confirmed. |
| `pnpm -C packages/xci test` | **417 pass / 1 fail / 1 skip** | 1 failure is PRE-EXISTING — see Deferred Issues below. |
| `pnpm -C packages/xci typecheck` | **FAIL (pre-existing)** | Errors in `tui/dashboard.ts`, `tui/picker.ts`, `tsup.config.ts`, and `parseFlags` in `agent/index.ts` (lines 46/54/57). None introduced by this plan — see Deferred Issues. |
| Regression guard (a): `./agent.mjs` referenced in `cli.mjs` | PASS | count=1, required >=1 |
| Regression guard (b): `<redacted>` in `agent.mjs` | PASS | count=2, required >=2 |
| Regression guard (c): `formatFrameForLog` bundled into `agent.mjs` | PASS | count=3, required >=1 |
| Regression guard (d): no stray error-frame sends in `agent/index.ts` | PASS | count=0, required ==0 |
| Regression guard (e): `parseYaml` call path preserved | PASS | count=4, required >=1 |

## Must-Haves Satisfied

Plan's `must_haves.truths` re-verified against final code:

1. "Each task stdout line written by the child process appears on the agent's local terminal stdout in real time." — `process.stdout.write(data)` at line 287 executes synchronously on every `onChunk` invocation with `stream === 'stdout'`, and `runner.ts` invokes `onChunk` per line-chunk (readline-framed). PASS.
2. "Each task stderr line written by the child process appears on the agent's local terminal stderr in real time." — mirror path at line 289. PASS.
3. "The server still receives `log_chunk` frames with identical content." — the existing `client?.send({ type: 'log_chunk', ... data ... })` runs AFTER the local write, unchanged. Regression guards (a)+(c) also confirm the bundled agent still contains the log-chunk/format machinery. PASS.
4. "Redaction of agent-local secrets is preserved in the locally-echoed output." — data flowing into `onChunk` is already redacted by `redactLine()` at `runner.ts:161` (confirmed by interface doc in the plan and by guard (b) which verifies the `<redacted>` sentinel is still present in the bundled agent). The local write uses the same `data` variable, so local echo cannot leak un-redacted values. PASS.

## Deviations from Plan

None. The plan's Task A snippet was applied verbatim. Task B regression guards all pass.

## Deferred Issues (Pre-Existing, Out of Scope)

The following failures exist on `HEAD~1` (verified by reverting only my change and re-running) and are therefore out of scope per the executor's scope-boundary rule. They are unrelated to the onChunk echo feature:

1. **Typecheck errors (pre-existing)**:
   - `src/tui/dashboard.ts`: 7 errors (undefined narrowing, `SequentialStep` kind discrimination, `result` used-before-assigned).
   - `src/tui/picker.ts`: 5 errors (`entry is possibly undefined`).
   - `tsup.config.ts`: 2 errors (`readonly ["esm"]` not assignable to mutable `Format[]`).
   - `src/agent/index.ts` lines 46, 54, 57: 3 errors — `argv[++i]` returns `string | undefined` but `parseFlags` assigns to optional string fields under `exactOptionalPropertyTypes: true`. These are inside `parseFlags`, NOT inside `handleDispatch.onChunk` (my change). Confirmed pre-existing.

2. **Test failure (pre-existing)**: `src/__tests__/cold-start.test.ts:38` expects `import('./agent/index.js')` in `dist/cli.mjs`, but the `tsup` post-build rewrite step (visible in build log: `[tsup] rewrote ./agent/index.js → ./agent.mjs in dist/cli.mjs`) has updated the bundled path to `./agent.mjs`. The test has not been updated to match the new path. This is confirmed by regression guard (a) which asserts the NEW (correct) form and passes. 417 other tests pass; this single stale test would need updating in a follow-up.

These pre-existing issues should be tracked in a separate plan targeting TypeScript strictness cleanup for `tui/*`, `tsup.config.ts`, `parseFlags`, and updating `cold-start.test.ts` to assert `./agent.mjs`.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| A | `93be7cf` | `feat(xci): agent echoes task stdout/stderr to local terminal` |

Base HEAD before this plan: `7ff685c`.

## Self-Check: PASSED

- Created files: none (plan only modifies existing file).
- Modified file `packages/xci/src/agent/index.ts` — FOUND at `/home/developer/projects/loci/packages/xci/src/agent/index.ts`, contains `process.stdout.write(data)` at line 287 and `process.stderr.write(data)` at line 289.
- Commit `93be7cf` — FOUND on current branch: `git log --oneline | grep 93be7cf` ⇒ `93be7cf feat(xci): agent echoes task stdout/stderr to local terminal`.
- All success criteria met (see table above).
- Exactly one commit added by Task A; Task B added none.
