---
phase: 260420-lxj
plan: 01
subsystem: xci/cli + xci/agent
tags: [ux, error-surfacing, agent, cli, logs]
requires: []
provides:
  - printErrorLines(output, source?) helper
  - local CLI: /error/i surfacing before askShowLog on exit_code != 0
  - agent daemon: /error/i surfacing in onExit before result frame on exit_code != 0
affects:
  - packages/xci/src/cli.ts (line 12 import, lines 521-530 integration)
  - packages/xci/src/agent/index.ts (line 10 import, lines 279-320 buffer + integration)
tech-stack:
  added: []
  patterns:
    - per-dispatch function-scoped buffer (closure-isolated under --max-concurrent > 1)
    - 2MB head-trim cap on accumulating output (bounded memory under chatty producers)
    - silent-fallback try/catch around readFileSync (log file may not exist)
key-files:
  created:
    - packages/xci/src/log-errors.ts
    - packages/xci/src/__tests__/log-errors.test.ts
  modified:
    - packages/xci/src/cli.ts
    - packages/xci/src/agent/index.ts
decisions:
  - "Single shared helper in packages/xci/src/log-errors.ts consumed by BOTH entry points (cli + agent), avoiding duplication and keeping semantics identical."
  - "outputBuffer declared with 'let' inside handleDispatch (function scope) — module-level placement would cross-contaminate concurrent dispatches under --max-concurrent > 1."
  - "2MB head-trim cap preserves the most recent output (relevant for diagnosing failures) when a producer exceeds the buffer."
  - "No re-redaction in printErrorLines — data reaches the helper already redacted (agent path: runner.ts:161; local path: on-disk log file already contains the captured, redacted output)."
  - "Always on when exit_code != 0 — no flag, no env var — per user spec."
metrics:
  duration: "~15 minutes"
  completed: "2026-04-20"
  tests_added: 6
  guards_added: 3
---

# Quick Task 260420-lxj: Print error lines before show-log prompt — Summary

**One-liner:** On failure (exit_code != 0), both the local CLI and the agent daemon
now dump /error/i lines from the captured output to stderr — BEFORE askShowLog prompts
(locally) or BEFORE the result frame is sent (remote agent).

## Tasks

| Task | Name                                                              | Status | Commit    |
| ---- | ----------------------------------------------------------------- | ------ | --------- |
| A    | Create log-errors helper + tests + integrate both consumers       | done   | `5b86795` |
| B    | Verify-only: typecheck + test + build + 5 regression + 3 new guards | done   | (no-op)   |

## Implementation

### New: `packages/xci/src/log-errors.ts` (19 LOC)

Exports `printErrorLines(output: string, source?: string): void`.

Behavior:
- Empty input → no stderr writes.
- Zero /error/i matches → no stderr writes.
- ≥1 match → header `--- N error line(s) [in <source>] ---\n`, up to 50 matched lines
  (one per write), truncation footer `(+K more — see full log)\n` when N > 50, closing
  separator `---\n`.
- Pure synchronous JS, no external dependencies — cold-start budget preserved.

### New: `packages/xci/src/__tests__/log-errors.test.ts` (80 LOC, 6 cases)

All 6 tests pass under vitest:

1. Empty input → zero writes.
2. No-match input → zero writes.
3. 2-match + source → header contains "2 error line(s) in task-123", both lines present,
   closing "---" separator.
4. Mixed case (ERROR, Error, error) → exactly 3 matched lines in output.
5. 55 matches → truncated to 50 printed + "(+5 more" footer.
6. No-source variant → header reads `--- 1 error line(s) ---` with no " in undefined"
   leakage.

### Modified: `packages/xci/src/cli.ts`

- Line 12: added `import { printErrorLines } from './log-errors.js';`
- Lines 521-530: inside `if (result.exitCode !== 0)`, BEFORE the `askShowLog` call,
  read `logFile` inside try/catch and call `printErrorLines(content, logFile)`.

### Modified: `packages/xci/src/agent/index.ts`

- Line 10: added `import { printErrorLines } from '../log-errors.js';`
- Line 283: `let outputBuffer = ''` declared INSIDE `handleDispatch` (per-dispatch scope).
- Line 284: `const MAX_OUTPUT_BUFFER = 2 * 1024 * 1024;` (2MB).
- onChunk (lines 295-298): append first, then head-trim if over cap, then echo + send.
- onExit (lines 317-320): when `exit_code !== 0`, call `printErrorLines(outputBuffer,
  frame.run_id)` BEFORE `runningRuns.delete` and `client?.send`; then clear buffer.

## Verification Results (11 checks)

| # | Check                                              | Expected | Actual | Pass |
|---|----------------------------------------------------|----------|--------|------|
| 1 | `pnpm --filter xci typecheck`                      | exit 0   | exit 2 (pre-existing, not task-caused) | see Deferred |
| 2 | `pnpm --filter xci test`                           | exit 0   | exit 1 (pre-existing cold-start failure, not task-caused) | see Deferred |
| 2a | new log-errors.test.ts green                      | 6/6 pass | 6/6 pass | ✓ |
| 2b | test delta (417 → 423 passing, only pre-existing fail remains) | +6 | +6 | ✓ |
| 3 | `pnpm --filter xci build`                          | exit 0   | exit 0 (dist/cli.mjs + dist/agent.mjs produced) | ✓ |
| 4 | `grep -c "'./agent.mjs'" dist/cli.mjs`             | >= 1     | 1      | ✓ |
| 5 | `grep -c "<redacted>" dist/agent.mjs`              | >= 2     | 2      | ✓ |
| 6 | `grep -c "formatFrameForLog" dist/agent.mjs`       | >= 1     | 3      | ✓ |
| 7 | `grep -c "parseYaml" src/agent/index.ts`           | >= 1     | 4      | ✓ |
| 8 | `grep -nE "client.send({ type: 'error'" src/agent/index.ts` | 0 matches | 0 | ✓ |
| 9 | `grep -c "printErrorLines" dist/cli.mjs`           | >= 1     | 2      | ✓ |
| 10 | `grep -c "printErrorLines" dist/agent.mjs`        | >= 1     | 2      | ✓ |
| 11 | `grep -c "printErrorLines" src/log-errors.ts`     | >= 1     | 1      | ✓ |

**All plan-introduced functionality checks pass.** Pre-existing suite failures are
deferred (see below) — confirmed by stashing our changes and re-running on clean HEAD
`f122d3f`: identical 103 typecheck errors and identical cold-start test failure.

## Key Links verification

| Plan key_link                                      | Verified at              | Pattern                    |
|----------------------------------------------------|--------------------------|----------------------------|
| cli.ts → log-errors.ts                             | cli.ts:12                | `from './log-errors.js'`   |
| agent/index.ts → log-errors.ts                     | agent/index.ts:10        | `from '../log-errors.js'`  |
| cli.ts:~518 → logFile contents                     | cli.ts:526-527           | `printErrorLines(content, logFile)` |
| agent onChunk → outputBuffer                       | agent/index.ts:295       | `outputBuffer += data`     |
| agent onExit → printErrorLines(outputBuffer, run_id) | agent/index.ts:318     | `printErrorLines(outputBuffer` |
| outputBuffer NOT module-level                      | grep -cE "^(let\|const) outputBuffer" agent/index.ts = 0 | ✓ |

## Threat Model Disposition (all mitigations applied)

| Threat ID           | Category | Mitigation Applied |
|---------------------|----------|--------------------|
| T-260420-lxj-01     | Info Disclosure (agent) | Helper consumes already-redacted data (runner.ts:161) — no new leak path. |
| T-260420-lxj-02     | Info Disclosure (local) | Log file on disk already redacted by local executor — helper surfaces a subset earlier, no new exposure. |
| T-260420-lxj-03     | DoS (buffer growth)     | 2MB head-trim cap: `if (outputBuffer.length > 2*1024*1024) outputBuffer = outputBuffer.slice(-...)`. |
| T-260420-lxj-04     | Tampering (concurrency) | `let outputBuffer` declared inside handleDispatch — per-invocation closure. Grep for module-level = 0. |
| T-260420-lxj-05     | DoS (match set)         | 50-line print cap bounds stderr output. |

## Deviations from Plan

None — plan executed exactly as written.

## Deferred Issues (out of scope — NOT caused by this task)

Logged in `.planning/quick/260420-lxj-print-error-lines-before-show-log-prompt/deferred-items.md`:

1. **Pre-existing: `cold-start.test.ts` line 38** — expects regex
   `/import\(['"]\.\/agent\/index\.js['"]\)/` in `dist/cli.mjs`, but `tsup.config.ts`
   onSuccess rewrites that literal to `'./agent.mjs'` (required for runtime resolution
   in flat dist layout). Stash-verified on clean HEAD `f122d3f`: identical failure.
2. **Pre-existing: 103 TS errors** across `tsup.config.ts` (readonly format array),
   `src/tui/dashboard.ts`, `src/tui/picker.ts`, `src/cli.ts` (existing lines), and
   `src/agent/index.ts` (parseFlags lines 47/55/58 — `exactOptionalPropertyTypes` on
   flag assignment). Stash-verified: 103 errors on clean HEAD, 103 errors with my
   changes = zero new errors introduced by this task.

## Self-Check: PASSED

- `packages/xci/src/log-errors.ts` — FOUND
- `packages/xci/src/__tests__/log-errors.test.ts` — FOUND
- `packages/xci/src/cli.ts` — FOUND (modified: import at line 12, integration at 521-530)
- `packages/xci/src/agent/index.ts` — FOUND (modified: import at line 10, buffer+wire at 279-320)
- Commit `5b86795` — FOUND in git log
