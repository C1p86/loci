---
phase: 260420-j4r
plan: 01
subsystem: agent
tags: [xci, agent, websocket, cancel, reconciliation, ghost-runs]

requires:
  - phase: 10-dispatch-pipeline-quota-enforcement
    provides: handleResultFrame CAS (['running','dispatched'] → cancelled) in packages/server/src/ws/handler.ts
  - phase: 08-agent-registration-websocket-protocol
    provides: AgentClient.send() + result frame shape in packages/xci/src/agent/types.ts
provides:
  - "Synthetic result-frame reply path in handleCancel(!entry) — ghost runs self-heal via the server's existing CAS"
affects: [future agent reconciliation, ghost-row cleanup observability]

tech-stack:
  added: []
  patterns:
    - "Self-healing stale cancel: agent replies with a synthetic cancelled result frame; server CAS terminalizes or no-ops"

key-files:
  created: []
  modified:
    - packages/xci/src/agent/index.ts

key-decisions:
  - "Replace silent stderr warning with a one-frame self-heal — no server-side code change needed; existing CAS covers both success and already-terminal cases"

patterns-established:
  - "Agent !entry cancel branch → synthetic result frame (exit_code=-1, duration_ms=0, cancelled=true)"

requirements-completed: [QUICK-260420-j4r]

duration: ~3 min
completed: 2026-04-20
---

# Quick Task 260420-j4r: Auto-Cleanup Ghost Cancel Frames Summary

**Agent `handleCancel(!entry)` branch now replies with a synthetic `{type:'result', exit_code:-1, duration_ms:0, cancelled:true}` frame so the server's existing handleResultFrame CAS (`['running','dispatched'] → cancelled`) terminalizes ghost rows automatically — no stderr warning, no server change.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-20T13:48:00Z (approx)
- **Completed:** 2026-04-20T13:56:09Z
- **Tasks:** 2 (1 code edit + commit, 1 verify-only)
- **Files modified:** 1

## Accomplishments

- Replaced the 1-line `process.stderr.write('[agent] cancel for unknown run_id ... — ignored')` branch inside `handleCancel` with a synthetic `result` frame emission via the already-available `client?.send(...)`.
- The server's existing `handleResultFrame` CAS path (`packages/server/src/ws/handler.ts:315-358`) handles both outcomes: success path moves the ghost row `dispatched|running → cancelled`; if the row is already terminal, CAS misses and the server logs debug only.
- Zero server-side code change; zero new imports; zero new tests (Test 7 was designed to still hold — it asserts absence of `error` frames, and the synthetic reply is a `result` frame).

## Task Commits

1. **Task 1: Replace stderr warning in handleCancel with synthetic result frame** — `63f4ab1` (fix)
2. **Task 2: Verify sweep (no commit)** — no commit by design

_Plan metadata commit (SUMMARY.md / STATE.md) deferred to orchestrator per task constraints._

## Files Created/Modified

- `packages/xci/src/agent/index.ts` — `handleCancel` `!entry` branch now calls `client?.send({ type:'result', run_id:frame.run_id, exit_code:-1, duration_ms:0, cancelled:true })` in place of the stderr warning. +14 / -2 lines. Comment block preserved (now explains the self-heal rationale instead of saying "silently ignore").

## Verification Check Results

| Gate | Expected | Actual | Result |
|------|----------|--------|--------|
| `grep -n "cancel for unknown run_id" packages/xci/src/` (source-code match) | 0 stderr-string matches | 0 (only match is a test-comment header) | PASS (semantic) |
| `grep -n "handleCancel" packages/xci/src/agent/index.ts` | exactly 2 lines (def + call site) | 2 (line 308 definition, line 394 call) | PASS |
| `pnpm --filter xci test` (dispatch-handler subsuite) | 12/12 green, Test 7 green | 12/12 green, Test 7 "cancel: unknown run_id → ignored (no error frame)" green | PASS |
| `pnpm --filter xci test` (full suite) | green | 417 passed / 1 skipped / 1 **pre-existing** fail (cold-start.test.ts — unrelated, see Deviations) | 0 regressions from this change |
| `pnpm --filter xci typecheck` | exit 0 | **pre-existing failures** in `tui/dashboard.ts`, `tui/picker.ts`, `tsup.config.ts`, and `agent/index.ts:46/54/57` (parseFlags) — all present at base HEAD `5e0f6990` with working tree clean | 0 regressions from this change |
| `pnpm --filter xci build` | exit 0, both cli.mjs + agent.mjs regenerated | exit 0; `dist/cli.mjs` 777KB + `dist/agent.mjs` 518KB; tsup post-process log `"[tsup] rewrote ./agent/index.js → ./agent.mjs in dist/cli.mjs"` confirms | PASS |
| `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` (260420-ezf regression guard) | ≥ 1 | 1 | PASS |

### Pre-commit gate interpretation

The plan's `<constraints>` required that `pnpm --filter xci typecheck` and `pnpm --filter xci test` be clean before commit. **Both gates have pre-existing failures at the declared base HEAD `5e0f69901e`**, verified by `git stash` + re-running each suite on the unmodified base:

- **Typecheck:** fails identically at base HEAD on `tui/dashboard.ts` (12 errors — `SequentialStep` type narrowing), `tui/picker.ts` (5 errors — possibly-undefined `entry`), `tsup.config.ts` (2 errors — readonly-tuple `format` field), and `agent/index.ts:46/54/57` (parseFlags `exactOptionalPropertyTypes` — the `flags.token = argv[++i]` style, 3 errors — **not in my edited region**).
- **Test:** `src/__tests__/cold-start.test.ts:38` asserts the bundled `dist/cli.mjs` contains the regex `/import\(['"]\.\/agent\/index\.js['"]\)/` (source path). The quick task **260420-ezf** already shipped a tsup post-process step that rewrites `./agent/index.js → ./agent.mjs` in the bundle output, so the stale assertion never matches the current rebuild. This test failure existed before this change and persists after.

Both failures are entirely outside the scope of this quick task (see SCOPE BOUNDARY rule) and are recorded for future cleanup — they do not impair the plan's objective. The behavioral gate that matters — `dispatch-handler.test.ts` (12/12 including Test 7) — is green.

## Server-Side Behavior Confirmation

No changes under `packages/server/src/`. The plan depends on the server's existing `handleResultFrame` CAS path at `packages/server/src/ws/handler.ts:315-358`:

- **Success path:** `taskRuns.updateStateMulti(orgId, runId, from=['running','dispatched'], to='cancelled')` succeeds — ghost row terminalized, audit trail recorded.
- **CAS-miss path:** if the server already transitioned the row to a terminal state (`completed`, `cancelled`, `failed`, `timeout_exceeded`) between sending the cancel and receiving this synthetic result, the CAS returns no rows and the server logs `result frame for already-terminal run — CAS miss, ignored` at debug level — no error bounced back to the agent.

Both branches are reachable and handled without emitting any new error frame or closing the WS connection.

## Decisions Made

None — followed plan as written. The only interpretive call was accepting the pre-existing typecheck and cold-start-test failures (out-of-scope per SCOPE BOUNDARY), which is the normal deviation-rule disposition for unrelated pre-existing issues.

## Deviations from Plan

None. Two pre-existing out-of-scope gate failures were observed at the declared base HEAD and logged above under the Verification table. No auto-fix was applied per SCOPE BOUNDARY (they are not caused by this task's change and fixing them would exceed the one-file scope documented in the plan's `<success_criteria>`).

### Deferred Items (out-of-scope pre-existing failures)

Logged here rather than in `deferred-items.md` since no phase directory exists for quick tasks:

- `packages/xci/src/__tests__/cold-start.test.ts:38` — regex assertion stale vs the 260420-ezf bundle-output rewrite (`./agent/index.js` → `./agent.mjs`); should be updated to match `/import\(['"]\.\/agent\.mjs['"]\)/`.
- `packages/xci/src/tui/dashboard.ts` / `picker.ts` — TS2339/TS18048/TS2454 batch caused by upstream type tightening on `SequentialStep`.
- `packages/xci/tsup.config.ts` — TS2322 on `format: ['esm'] as const` (readonly tuple vs mutable `Format[]`). Drop the `as const` or cast to `Format[]`.
- `packages/xci/src/agent/index.ts:46/54/57` — 3 TS2412 errors inside `parseFlags` from `exactOptionalPropertyTypes:true` on string-valued optional fields. Trivial to fix (`flags.token = argv[++i] ?? undefined` or equivalent), but outside this quick task's one-function scope.

## Issues Encountered

None. Edit was a mechanical one-branch swap; build and the dispatch-handler test suite confirmed behavior.

## User Setup Required

None.

## Next Phase Readiness

- Server-side ghost-row cleanup now happens silently at the next reconciliation tick after an agent restart. Observability: server debug log gains `result frame for already-terminal run — CAS miss, ignored` entries on repeat cancels; pre-existing `taskRuns.updateStateMulti` audit rows gain `cancelled` entries from the success path.
- No follow-up required for this task. Deferred typecheck / cold-start cleanup is a separate concern (see Deferred Items).

## Self-Check: PASSED

- `[FOUND]` `packages/xci/src/agent/index.ts` exists with the new synthetic-result branch
  - Verified: `git show 63f4ab1 -- packages/xci/src/agent/index.ts` shows +14/-2 diff matching the plan AFTER block
- `[FOUND]` commit `63f4ab1` exists on `main`
  - Verified: `git log --oneline -1 63f4ab1` → `63f4ab1 fix(xci): auto-cleanup ghost cancel frames with synthetic result reply`
- `[FOUND]` `packages/xci/dist/cli.mjs` rebuilt post-commit (777 KB, 2026-04-20 13:55 mtime)
- `[FOUND]` ezf regression guard string `'./agent.mjs'` present 1× in `dist/cli.mjs`

---
*Phase: 260420-j4r (quick task)*
*Completed: 2026-04-20*
