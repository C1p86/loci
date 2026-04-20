---
phase: 260420-l9i
plan: 01
type: execute
subsystem: web
tags: [web, logviewer, websocket, bugfix]
wave: 1
requirements: [L9I-01]
dependency_graph:
  requires:
    - "packages/web/src/hooks/useLogWebSocket.ts (enabled=true path already supported)"
    - "packages/server/src/routes/runs/logs-ws.ts (replay + end-frame + graceful close)"
  provides:
    - "LogViewer component that always enables the log WS — users viewing completed runs now see replayed history + end-state banner"
  affects:
    - "packages/web/src/components/LogViewer.tsx"
tech_stack:
  added: []
  patterns:
    - "Use `_`-prefix destructure alias to keep a reserved prop interface-level while silencing tsc --noUnusedParameters"
key_files:
  created: []
  modified:
    - "packages/web/src/components/LogViewer.tsx"
decisions:
  - "Rename destructure `initialState` → `_initialState` (deviation Rule 3): plan's step-4 fallback suggested biome-ignore, but the unused-warning came from tsc (noUnusedParameters on), not biome. Underscore-prefix is the idiomatic TS way to mark intentionally-unused parameters and is cleaner than @ts-expect-error. The public LogViewerProps interface is unchanged — call sites still pass initialState."
metrics:
  duration: "~5m"
  completed_date: "2026-04-20"
  tasks: 2
  commits: 1
  files: 1
---

# Quick Task 260420-l9i: LogViewer fetches log history via WS for terminal runs — Summary

**One-liner:** LogViewer no longer gates the WS on run-state — terminal-state runs (succeeded/failed/cancelled/timed_out/orphaned) now open the log WS so the server's replay + end-frame path actually reaches the UI.

## What Changed

**`packages/web/src/components/LogViewer.tsx`** — 2 insertions, 6 deletions:

1. Removed the `TERMINAL_STATES` constant (module-level).
2. Removed the `const enabled = !TERMINAL_STATES.includes(initialState)` line.
3. Changed the hook call from `useLogWebSocket({ orgId, runId, enabled })` to `useLogWebSocket({ orgId, runId, enabled: true })`.
4. Renamed the destructured `initialState` to `_initialState` so tsc `--noUnusedParameters` does not error (the prop is retained on `LogViewerProps` for future end-state UX; call sites pass it).

Nothing else in the file (imports, JSX, effects, banners, end-state banner rendering) was modified.

## Why

Server-side log replay + graceful end-frame was already implemented in `packages/server/src/routes/runs/logs-ws.ts` specifically so that re-opening a completed run replays stored chunks and then cleanly closes. The client-side `TERMINAL_STATES` guard was the only thing preventing that path from ever executing — users viewing completed runs saw an empty log pane. With the guard removed, completed-run detail pages now render the replayed history and the end-state banner.

## Commits

| # | Hash | Message |
|---|------|---------|
| 1 | `99ef099` | fix(web): LogViewer always fetches log history via WS (even for terminal runs) |

The final docs commit (SUMMARY.md, deferred-items.md) is orchestrator-owned per plan constraints.

## Verification Results

### Task 1 — Always enable log WS in LogViewer

- `grep -n "TERMINAL_STATES" packages/web/src/components/LogViewer.tsx` → **no output (exit 1)** ✓
- `grep -n "enabled: true" packages/web/src/components/LogViewer.tsx` → line 22: `useLogWebSocket({ orgId, runId, enabled: true })` ✓
- Single commit `99ef099` touching only `packages/web/src/components/LogViewer.tsx` ✓

### Task 2 — Verification sweep (all gates pass)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `pnpm --filter @xci/web typecheck` | ✓ exit 0, no TS errors |
| LogViewer tests | `vitest run src/__tests__/LogViewer.test.tsx src/__tests__/useLogWebSocket.test.ts` | ✓ 20/20 pass (LogViewer: 10, useLogWebSocket: 10) |
| Full web test suite | `pnpm --filter @xci/web test` | 102/102 actual tests pass; 1 pre-existing unrelated Playwright-in-Vitest file-load failure (see Deferred Issues) |
| Build | `pnpm --filter @xci/web build` | ✓ produced `dist/assets/index-CsWaAt3t.css` + `index-D14dE31X.js` |
| CSS theme regression (260420-hcc) | `grep -oE "bg-background\|text-foreground\|border-border" dist/assets/index-*.css \| wc -l` | 7 (≥ 3 required) ✓ |
| xci agent.mjs regression | `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` | 1 (≥ 1 required) ✓ |
| Constant removal | `grep -n TERMINAL_STATES packages/web/src/components/LogViewer.tsx` | no output ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Rename destructured `initialState` to `_initialState`**

- **Found during:** Task 1 (initial typecheck run after the 2-line WS edit)
- **Issue:** `tsc --noUnusedParameters` flagged `initialState` as unused: `error TS6133: 'initialState' is declared but its value is never read.` at `src/components/LogViewer.tsx:15,36`. Typecheck blocked the Task 2 gate.
- **Plan guidance:** The plan's step-4 fallback suggested adding a `biome-ignore lint/correctness/noUnusedVariables` comment if biome complained. That comment does not suppress tsc errors, only biome.
- **Fix:** Rename only the destructure alias — `function LogViewer({ runId, initialState: _initialState }: LogViewerProps)`. The `_` prefix is idiomatic TypeScript for intentionally-unused parameters and is respected by `noUnusedParameters`. The public `LogViewerProps` interface is untouched — all call sites still pass `initialState`.
- **Files modified:** `packages/web/src/components/LogViewer.tsx` (part of the same commit)
- **Commit:** `99ef099`

## Deferred Issues (out-of-scope, pre-existing)

See `deferred-items.md` in this plan directory.

**Summary:**

1. **Vitest picks up Playwright E2E spec** — `packages/web/vitest.config.ts` has no `exclude` pattern for `e2e/**`, so `pnpm test` reports a failed test **file** (`e2e/smoke.spec.ts`) even though all 102 actual unit/component tests pass. Pre-existing since 6a59886 (Phase 13-06). Documented; not fixed here.
2. **Plan's literal CSS regression check uses `grep -c`** (line count) vs. occurrence count — semantic intent is satisfied (7 occurrences, required ≥ 3) but the literal awk check as written fails because minified CSS is one line. Observation only; nothing to fix.

## No Earlier Fix Was Weakened

- **260420-hcc (CSS theme vars):** dist CSS contains 7 occurrences of `bg-background|text-foreground|border-border` — intact.
- **xci agent.mjs relative-path fix:** `packages/xci/dist/cli.mjs` still imports `'./agent.mjs'` (1 occurrence) — intact.
- **Server-side log replay + end-frame** (`packages/server/src/routes/runs/logs-ws.ts`): untouched.
- **useLogWebSocket contract** (`packages/web/src/hooks/useLogWebSocket.ts`): untouched — its own test `useLogWebSocket.test.ts` test 10 (`enabled: false → no WS created`) still passes since we test the hook directly, not via LogViewer.

## Self-Check: PASSED

- [x] `packages/web/src/components/LogViewer.tsx` modified (git show HEAD confirms +2 / -6, single file)
- [x] Commit `99ef099` exists on `main` with message `fix(web): LogViewer always fetches log history via WS (even for terminal runs)`
- [x] `TERMINAL_STATES` absent from LogViewer.tsx (grep exit 1)
- [x] `enabled: true` present at line 22 of LogViewer.tsx
- [x] Typecheck, build, LogViewer/useLogWebSocket tests all green
- [x] No regression in CSS theme vars (7 occurrences) or xci agent.mjs (1 occurrence)
- [x] `deferred-items.md` created in plan dir for out-of-scope pre-existing issues
