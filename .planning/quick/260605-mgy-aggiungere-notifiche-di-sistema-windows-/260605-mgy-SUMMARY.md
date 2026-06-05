---
phase: quick-260605-mgy
plan: 01
subsystem: xci-executor
tags: [notifications, UX, cross-platform, node-notifier]
dependency_graph:
  requires: []
  provides: [notifyCompletion]
  affects: [packages/xci/src/executor/output.ts, packages/xci/src/executor/index.ts]
tech_stack:
  added: [node-notifier@^10.0.1]
  patterns: [dynamic-import-silent-fallback]
key_files:
  created: []
  modified:
    - packages/xci/package.json
    - packages/xci/src/executor/output.ts
    - packages/xci/src/executor/index.ts
decisions:
  - "node-notifier imported via dynamic import with typed interface cast to avoid @types/node-notifier devDependency"
  - "import('node-notifier' as string) cast used to suppress TS7016 without adding types package"
  - "notifyCompletion is async due to dynamic import; executor run() already async so await is valid"
metrics:
  duration: ~3min
  completed: 2026-06-05
---

# Quick Task 260605-mgy: Add OS Desktop Notifications Summary

**One-liner:** Opt-in OS toast notifications on xci completion via XCI_NOTIFY=1, using node-notifier with silent fallback when unavailable.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add node-notifier dependency and install | 7126332 | packages/xci/package.json, pnpm-lock.yaml |
| 2 | Implement notifyCompletion in output.ts and wire into executor/index.ts | c09d306 | packages/xci/src/executor/output.ts, packages/xci/src/executor/index.ts |

## What Was Built

Added `notifyCompletion(exitCode: number): Promise<void>` to `packages/xci/src/executor/output.ts`:

- Returns immediately if `XCI_NOTIFY` env var is not `'1'`
- On success (exitCode 0): sends toast with message `'xci: completato ✓'`
- On failure: sends toast with message `'xci: errore (exit N)'`
- Dynamic imports `node-notifier` at call time; entire try/catch swallows any failure silently
- node-notifier handles Windows (PowerShell/SnoreToast), macOS (osascript), Linux (notify-send) natively

Wired in `packages/xci/src/executor/index.ts`:
- Added `notifyCompletion` to named import from `./output.js`
- Called as `await notifyCompletion(result.exitCode)` immediately after `beepCompletion`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TS7016: no type declarations for node-notifier**

- **Found during:** Task 2 (typecheck step)
- **Issue:** TypeScript emitted `TS7016: Could not find a declaration file for module 'node-notifier'` because node-notifier ships without bundled types and the plan explicitly said not to add `@types/node-notifier`.
- **Fix:** Changed `await import('node-notifier')` to `await import('node-notifier' as string)` with an inline type assertion `as { default: { notify(opts: { title: string; message: string }): void } }`. This suppresses the error without any additional dependency.
- **Files modified:** packages/xci/src/executor/output.ts
- **Commit:** c09d306

## Verification

- `pnpm typecheck` — no new errors in output.ts or index.ts (pre-existing errors in other files unchanged)
- `pnpm build` — succeeds, tsup bundles cli.mjs at 919 KB with dynamic import preserved
- node-notifier present in packages/xci/package.json dependencies

## Known Stubs

None — feature is fully wired. Manual smoke test (setting `XCI_NOTIFY=1` and running an xci alias) required to verify OS toast delivery on the target platform.

## Self-Check: PASSED

- packages/xci/package.json contains `"node-notifier": "^10.0.1"` in dependencies — FOUND
- packages/xci/src/executor/output.ts exports `notifyCompletion` — FOUND
- packages/xci/src/executor/index.ts awaits `notifyCompletion` — FOUND
- Commit 7126332 exists — FOUND
- Commit c09d306 exists — FOUND
