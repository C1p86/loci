---
phase: 260420-ezf
plan: 01
subsystem: build-tooling
tags: [tsup, bundle, cli, agent, dynamic-import, post-build-rewrite]
dependency_graph:
  requires:
    - packages/xci/src/cli.ts (unchanged — dynamic import literal stays correct for TS/dev)
    - packages/xci/src/agent/index.ts (unchanged — still the agent entry source)
  provides:
    - packages/xci/dist/cli.mjs with runtime-correct './agent.mjs' specifier
  affects:
    - npm-published xci --agent invocation (now resolves dynamic import instead of ERR_MODULE_NOT_FOUND)
tech_stack:
  added: []
  patterns:
    - tsup onSuccess async post-build hook
    - String.prototype.replaceAll with plain-string args (no regex escape risk)
    - node:fs/promises readFile + writeFile in build config
key_files:
  created: []
  modified:
    - packages/xci/tsup.config.ts
decisions:
  - "Post-build string rewrite chosen over editing src/cli.ts: keeps TS source resolution (`.js→.ts` convention) valid for tsc/vitest dev mode while producing a runtime-correct bundle"
  - "onSuccess hook lives on the cli+agent defineConfig entry only — DSL entry untouched (no agent import in dsl bundle)"
  - "esbuildOptions relative-path external rule preserved — it is what keeps the literal in the output for us to rewrite; removing it would inline agent code into cli.mjs (Phase 8 Pitfall 6 regression)"
  - "replaceAll with plain strings (not regex) — dots in `./agent/index.js` are literal, zero metachar hazard"
metrics:
  duration: ~6m
  completed: 2026-04-20
  tasks_completed: 1
  files_modified: 1
---

# Phase 260420-ezf Plan 01: Fix CLI --agent dynamic import in bundled output — Summary

## One-liner

tsup `onSuccess` hook rewrites `'./agent/index.js'` → `'./agent.mjs'` in `dist/cli.mjs` so the runtime dynamic import targets the sibling bundle tsup actually emits.

## Root cause (one line)

tsup emits a flat layout (`dist/cli.mjs` + `dist/agent.mjs`) but the TypeScript-style specifier `./agent/index.js` in `cli.ts:764` is preserved verbatim in the bundle by the `esbuildOptions` external rule — at runtime Node resolves it relative to `dist/cli.mjs` and finds nothing, throwing `ERR_MODULE_NOT_FOUND`.

## Fix (one line)

Added an async `onSuccess` hook to the first `defineConfig` entry (cli+agent block) that reads `dist/cli.mjs`, replaces the exact quoted literal `'./agent/index.js'` (and its double-quoted variant) with `'./agent.mjs'` via `String.prototype.replaceAll`, writes back.

## Files Modified

- `packages/xci/tsup.config.ts` — +17 lines (2 new ESM fs/promises imports + 1 `onSuccess` hook with an explanatory comment block)

## Files Intentionally Unchanged

- `packages/xci/src/cli.ts` — dev-mode TS resolution requires the `.js`/nested-path literal; `git diff --stat` shows zero changes.
- `packages/xci/package.json` — no dep changes, no script changes.
- `packages/xci/src/agent/index.ts` — agent entry source unaffected.
- Second `defineConfig` entry (DSL block) — no agent import exists there, hook would be a no-op.

## Verification Evidence

### Pre-fix bundle state (baseline)

| Check | Value |
|-------|-------|
| `grep -c "'./agent/index.js'" dist/cli.mjs` | `1` (at line 22253) |
| `grep -c "'./agent.mjs'" dist/cli.mjs` | `0` |
| `dist/cli.mjs` size | 795652 bytes |
| `dist/agent.mjs` size | 528902 bytes |
| `node dist/cli.mjs --agent ...` runtime | `ERR_MODULE_NOT_FOUND` — Cannot find module './agent/index.js' |

### Post-fix bundle state (after `pnpm --filter xci build`)

| Check | Value | Expected | Pass |
|-------|-------|----------|------|
| `grep -c "'./agent/index.js'" dist/cli.mjs` | `0` | `0` | YES |
| `grep -c "'./agent.mjs'" dist/cli.mjs` | `1` | `>= 1` | YES |
| Any `agent/index.js` substring in cli.mjs | `0` matches | `0` | YES |
| `dist/cli.mjs` size | 795647 bytes | `<= 795652` (rewrite is byte-neutral or shrinks) | YES (−5 bytes) |
| `dist/agent.mjs` size | 528902 bytes | unchanged | YES (identical) |
| `packages/xci/dist/agent.mjs` exists | yes | yes | YES |
| onSuccess hook stderr log on build | `[tsup] rewrote ./agent/index.js → ./agent.mjs in dist/cli.mjs` | present | YES |
| `git diff --stat packages/xci/src/cli.ts` | no output | no output | YES |
| `git diff --stat packages/xci/package.json` | no output | no output | YES |
| Runtime smoke: `node dist/cli.mjs --agent --help` | throws from inside `reconnecting-websocket` (bad URL `--help`) | NOT `ERR_MODULE_NOT_FOUND` | YES (dynamic import resolves; agent code runs) |

### Byte-count accounting

- Literal `'./agent/index.js'` = 18 chars (including surrounding single quotes)
- Literal `'./agent.mjs'` = 13 chars (including surrounding single quotes)
- Net per rewrite: −5 bytes
- Observed cli.mjs delta: 795652 → 795647 = **−5 bytes exactly** (1 rewrite × 5 bytes, matches expected)

The plan pre-estimated −7 bytes per rewrite; the correct math including quotes is −5 bytes. Either way, the rewrite never grows the file, so no size regression risk. Observed delta exactly matches expected.

### size-limit result

```
  Package size limit has exceeded by 595.65 kB
  Size limit: 200 kB
  Size:       795.65 kB
```

This is a **pre-existing, documented failure** (STATE.md, Phase 06 D-15): *"SC-2 bundle-size (200KB) gate DEFERRED — fresh rebuild 760KB; threshold was based on v1 Phase 1 baseline (126KB), pre-dates P2-P5 additions. CI size-limit step NOT wired"*. The plan's success-criteria row explicitly flags this: *"not regressing" is the operative assertion, not "under 200KB"*. cli.mjs shrunk 5 bytes — zero regression — so the applicable criterion passes. Not my task to fix the pre-existing threshold, out of scope.

### Runtime smoke test

```
$ node packages/xci/dist/cli.mjs --agent --help
.../ws/lib/websocket.js:697:13
SyntaxError: Invalid URL: --help
    at initAsClient (.../ws/lib/websocket.js:697:13)
    at new WebSocket (.../ws/lib/websocket.js:88:7)
    at .../reconnecting-websocket-cjs.js:519:19
```

Pre-fix expected error: `ERR_MODULE_NOT_FOUND: Cannot find module './agent/index.js'` — thrown BEFORE `runAgent` ever executes.

Post-fix observed error: `SyntaxError: Invalid URL: --help` — thrown from **inside `reconnecting-websocket`**, which means:
1. The dynamic `await import('./agent.mjs')` resolved successfully.
2. `runAgent()` from the agent bundle executed.
3. The agent's rws client tried to construct a WebSocket using `--help` as its URL argument and failed (unrelated: `--help` is not a valid `--agent` argument; help is a CLI-level flag, not an agent-mode flag).

The root-cause ERR_MODULE_NOT_FOUND is gone. Downstream argv handling inside agent mode is a separate concern (not in scope for this quick task — the task was to fix the dynamic-import resolution, which is done).

## Deviations from Plan

### Build environment bootstrap (not a code deviation)

`pnpm` was not on PATH in the execution environment. Resolved by `corepack enable --install-directory ~/.local/corepack-bin` + `export PATH`. `pnpm install --filter xci...` then restored `tsup` into `node_modules`. CI-env flag (`CI=true`) required to auto-accept the modules-dir recreate prompt. This was pure environment setup — no source or config deviation.

### Byte-count estimation (cosmetic)

Plan stated the rewrite shrinks cli.mjs by 7 bytes per occurrence; actual is 5 bytes (plan appears to have counted `./agent/index.js`=16 and `./agent.mjs`=11 without the surrounding quotes; including quotes the delta is 18−13=5). Invariant "never grows, always neutral or shrinks" holds. No action needed; noted for future reference.

### Auto-fixed issues

None. Plan executed exactly as written.

## Surprises

1. **cli.mjs shrunk by exactly 5 bytes, not 7** — documented above.
2. **esbuild treeshake warning during build**: `"execFileSync" is imported from external module "child_process" but never used in "dist/cli.mjs"` (same for agent.mjs). Pre-existing, unrelated to this fix — noted, not acted on (scope boundary).
3. **Smoke test produced a particularly clean signal**: the post-fix error stack is *inside reconnecting-websocket*, which is the most compelling possible proof that the dynamic import now resolves and the agent module actually loaded. Better than a null-signal "no ERR_MODULE_NOT_FOUND" check.
4. **onSuccess invocation ordering**: tsup runs onSuccess after the ESM build phase but BEFORE the DTS phase completes log output, so the stderr log interleaves between `ESM Build success` and `DTS Build success`. Not a problem — onSuccess completed before DTS kicked off (the build is sequential per entry).

## Self-Check: PASSED

Verified artefacts:
- `packages/xci/tsup.config.ts` — FOUND, +17 lines, contains `async onSuccess()`, `readFile`, `writeFile`, `replaceAll` (both single- and double-quoted variants), and the required stderr log line.
- Commit `2239202` — FOUND in `git log` (`git log --oneline --all | grep 2239202` returns the match).
- `packages/xci/dist/cli.mjs` — FOUND, contains `'./agent.mjs'` (1 occurrence), contains ZERO `agent/index.js` substrings.
- `packages/xci/dist/agent.mjs` — FOUND, 528902 bytes (unchanged from pre-fix).
- `packages/xci/src/cli.ts` — unchanged (`git diff --stat` returns empty).
- `packages/xci/package.json` — unchanged (`git diff --stat` returns empty).

All success criteria from the plan satisfied except the pre-existing 200KB size-limit threshold (documented deferral, non-regression preserved — cli.mjs shrunk by 5 bytes).
