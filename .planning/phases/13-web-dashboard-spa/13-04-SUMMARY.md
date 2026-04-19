---
phase: 13-web-dashboard-spa
plan: "04"
subsystem: web-dashboard
tags: [websocket, log-streaming, autoscroll, history, ui]
dependency_graph:
  requires: [13-02, 13-03]
  provides: [UI-04, UI-05, UI-08]
  affects: [13-06]
tech_stack:
  added: []
  patterns:
    - IntersectionObserver for autoscroll sentinel (SC-3)
    - Exponential backoff WS reconnect (1s..30s, cap)
    - TDD RED/GREEN per task — 30 new assertions
    - sinceSeq resumption on reconnect (T-13-04-05)
    - Cursor-stack prev/next pagination
key_files:
  created:
    - packages/web/src/hooks/useLogWebSocket.ts
    - packages/web/src/components/LogViewer.tsx
    - packages/web/src/hooks/useRunHistory.ts
    - packages/web/src/routes/history/HistoryList.tsx
    - packages/web/src/__tests__/useLogWebSocket.test.ts
    - packages/web/src/__tests__/LogViewer.test.tsx
    - packages/web/src/__tests__/HistoryList.test.tsx
  modified:
    - packages/web/src/routes/runs/RunDetail.tsx
    - packages/web/src/routes/index.tsx
    - packages/web/src/lib/types.ts
decisions:
  - LogChunk/LogGap types added to types.ts (shared by hook + component)
  - Gap frames synthesised as in-band stderr marker chunks (seq=toSeq) rather than a separate data type
  - Download link rendered as <a download> in LogViewer using authStore orgId (not run.orgId) — no RunSummary schema change needed
  - useRunHistory maps 'from'/'to' filter to 'since' server param (server only supports since/to, not from/to)
  - biome-ignore on useExhaustiveDependencies suppression not needed in Biome 2.x (removed)
metrics:
  duration_minutes: 23
  completed_date: "2026-04-19"
  tasks_completed: 3
  tasks_total: 3
  files_created: 7
  files_modified: 3
---

# Phase 13 Plan 04: LogViewer + useLogWebSocket + HistoryList Summary

Live log streaming wired into /runs/:id via WebSocket with autoscroll pause/resume (SC-3), WS indicator driven by wsStore, timestamp toggle, raw log download, and /history paginated list with state/task/date filters.

## What Was Built

### Task 1: useLogWebSocket hook (UI-08 driver)

**File:** `packages/web/src/hooks/useLogWebSocket.ts`

WS connection manager connecting to `/ws/orgs/:orgId/runs/:runId/logs`:

- Opens WS on `enabled=true`; sends `{type:'subscribe', sinceSeq: 0}` on first open
- On reconnect: sends `sinceSeq: lastSeenSeq + 1` (T-13-04-05 tamper mitigation)
- Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (cap); resets on successful open
- Terminal close codes 1000, 4001, 4004, 4008 do NOT trigger reconnect
- chunk frames: appended to state (tail-kept at 50k cap, T-13-04-03)
- gap frames: synthesised as in-band `stderr` marker chunk with text `[gap: N–M missed due to backpressure]`
- end frames: sets `endState` + `exitCode` for caller
- wsStore.status driven: `connected` on open, `reconnecting` on abnormal close, `disconnected` on terminal close or unmount
- Clean unmount: closes WS with code 1000 + 'unmount'

**WS frame contract (as consumed by web):**

| Frame | Fields | Action |
|-------|--------|--------|
| `chunk` | seq, stream, ts, data | append to chunks; update lastSeenSeq |
| `gap` | fromSeq, toSeq | synthesise marker chunk at toSeq |
| `end` | state, exitCode | set endState; LogViewer shows banner + invalidates query |
| `catchup_complete` | — | no-op |

**Reconnect backoff sequence:** `[1000, 2000, 4000, 8000, 16000, 30000]` ms

### Task 2: LogViewer component (SC-3, UI-04)

**File:** `packages/web/src/components/LogViewer.tsx`

- Renders chunks in `<pre>` with per-chunk `<span key={c.seq}>`; chunk data via `{c.data}` text — NEVER `dangerouslySetInnerHTML` (T-13-04-01 XSS mitigation)
- STDOUT: default slate color; STDERR: `text-red-300`
- IntersectionObserver on bottom sentinel div (threshold 0.01):
  - Sentinel visible → autoscroll enabled; scrolls bottomRef into view on each new chunk
  - Sentinel off-screen (user scrolled up) → `uiStore.logAutoscrollPaused=true`; banner shown
  - Banner shows new-lines-since-pause count; click → `setAutoscrollPaused(false)` + scrollToBottom
- Timestamp toggle reads/writes `uiStore.logTimestampVisible` (persisted via localStorage)
- Download button: `<a href="/api/orgs/:orgId/runs/:runId/logs.log" download>` — browser handles attachment, no fetch-to-blob
- End-state banner: when `endState` arrives, shows "Run finished: \<state\> (exit N)"
- On `endState` change: invalidates `['runs','detail', orgId, runId]` query key
- Wired into `RunDetail.tsx` replacing Plan 13-03 placeholder div

### Task 3: HistoryList + useRunHistory (UI-05)

**Files:** `packages/web/src/hooks/useRunHistory.ts`, `packages/web/src/routes/history/HistoryList.tsx`

- `useRunHistory(filters)`: TanStack Query hook, query key `['runs','history', orgId, qs]`
- Server endpoint: `GET /api/orgs/:orgId/runs?state=CSV&taskId=&since=&limit=25`
- `HistoryList`: paginated table with cursor-stack prev/next
- Filters: state multi-select (8 states), task dropdown (from useTasks), from/to datetime-local inputs
- Row columns: Run (last 8 chars, linked to /runs/:id), Task name, State, Exit, Started, Finished, Trigger
- Route `/history` wired in `packages/web/src/routes/index.tsx`

**History filter params (for v2.1 search enhancement tracking):**

| Param | Maps to server | Notes |
|-------|---------------|-------|
| states[] | state=CSV | multi-select; sent as comma-separated |
| taskId | taskId | dropdown; empty = all |
| from | since | ISO datetime-local value |
| to | (not yet supported by server) | reserved; sent but server ignores |
| cursor | since | ISO cursor from nextCursor |
| limit | limit | default 25 |

## XSS-Proof Evidence

Test in `packages/web/src/__tests__/LogViewer.test.tsx` test #2:
```
mockChunks.push({ seq: 1, stream: 'stdout', ts: '...', data: '<script>alert(1)</script>' });
// Assert literal text present
expect(screen.getByRole('log').textContent).toContain('<script>alert(1)</script>');
// Assert no actual script element
expect(container.querySelector('script')).toBeNull();
```

React's JSX text rendering (`{c.data}`) auto-escapes HTML — the `<script>` becomes `&lt;script&gt;` in the DOM, so `querySelector('script')` returns null. Test is green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MockWebSocket.OPEN undefined in tests**
- **Found during:** Task 1 GREEN phase
- **Issue:** `wsRef.current.readyState <= WebSocket.OPEN` — in the test environment, `WebSocket` is the mock class with no static `OPEN` property, so the comparison was always false (unmount never called close)
- **Fix:** Changed to `wsRef.current.readyState < 2` (2=CLOSING) which works with both real WebSocket constants and the mock
- **Files modified:** `packages/web/src/hooks/useLogWebSocket.ts`
- **Commit:** ed81047

**2. [Rule 1 - Bug] vi.clearAllMocks() wipes mock implementation in HistoryList tests**
- **Found during:** Task 3 GREEN phase
- **Issue:** Tests 6/7/8 couldn't find buttons/rows because `vi.clearAllMocks()` cleared the `mockReturnValue` override from tests 4/5, leaving the mock with no implementation
- **Fix:** Rewrote test structure to use `vi.mocked(useRunHistory).mockImplementation(...)` in `beforeEach` so each test starts with a fresh implementation that reads live mock state
- **Files modified:** `packages/web/src/__tests__/HistoryList.test.tsx`
- **Commit:** f8f6f33

**3. [Rule 2 - Missing] Unused triggerIntersection helper + stale ioCallback variable**
- **Found during:** Typecheck pass
- **Fix:** Removed unused `triggerIntersection` function and `ioCallback` variable; simplified IntersectionObserver mock to just stub `observe`/`disconnect`
- **Files modified:** `packages/web/src/__tests__/LogViewer.test.tsx`

**4. [Rule 1 - Bug] Biome suppression comment with no effect**
- **Found during:** lint:fix run
- **Issue:** `// biome-ignore lint/correctness/useExhaustiveDependencies` suppression is not a valid Biome 2.x rule name (was copied from ESLint pattern)
- **Fix:** Removed the suppression comment entirely; the warning is a Biome info-level suggestion, not an error
- **Files modified:** `packages/web/src/components/LogViewer.tsx`

## Known Stubs

None. All data sources are wired:
- `useLogWebSocket` connects to the real WS endpoint
- `useRunHistory` calls the real `apiGet` against Phase 10's list endpoint
- `HistoryList` reads real task names from `useTasks`

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. LogViewer renders only via `{c.data}` text nodes — T-13-04-01 mitigation confirmed by test.

## TDD Gate Compliance

All three tasks followed RED → GREEN pattern:

1. Task 1: `test(13-04)` gate — RED confirmed (import resolution error), GREEN after hook creation (10/10 pass)
2. Task 2: `test(13-04)` gate — RED confirmed (import resolution error), GREEN after component creation (10/10 pass)
3. Task 3: `test(13-04)` gate — RED confirmed (import resolution error), GREEN after component + hook creation (10/10 pass)

## Self-Check: PASSED

All 7 created files confirmed present on disk. All 3 task commits (ed81047, bd16c81, f8f6f33) confirmed in git log.
