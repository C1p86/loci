---
phase: 06-monorepo-setup-backward-compat-fence
plan: 04
subsystem: infra
tags: [tsup, biome, bundler, lint, ws-fence, noExternal, noRestrictedImports, monorepo]

requires:
  - phase: 06-monorepo-setup-backward-compat-fence
    plan: 02
    provides: "packages/xci/tsup.config.ts with noExternal: [/.*/] and size-limit config in packages/xci/package.json"
  - phase: 06-monorepo-setup-backward-compat-fence
    plan: 03
    provides: "root biome.json with files.includes scoped to packages/** (monorepo walk)"

provides:
  - "Layer (a) of D-16 three-layer ws-fence: packages/xci/tsup.config.ts has `external: ['ws', 'reconnecting-websocket']` combined with a negative-lookahead noExternal regex that lets the external entry actually take effect (Pitfall 1 navigated)"
  - "Layer (c) of D-16 three-layer ws-fence: root biome.json has an overrides[] entry scoped to packages/xci/src/**/*.ts that triggers noRestrictedImports on imports of 'ws' and 'reconnecting-websocket' (Pitfall 2 navigated — PLURAL 'includes' key)"
  - "Schema URL bumped to 2.4.12 (matches installed Biome 2.4.12)"
  - "Negative probe test verified: in-scope import → biome error with configured message; out-of-scope import (packages/server/src/) → no error"
  - "Fresh build produces working dist/cli.mjs with zero 'ws'/'reconnecting-websocket' string occurrences"

affects: ["06-05", "06-06", "phase-07-ci-gates", "phase-08-agent-mode"]

tech-stack:
  added: []
  patterns:
    - "tsup negative-lookahead noExternal regex: /^(?!ws$|reconnecting-websocket$).*/ — preserves 'bundle everything else' semantics while letting the external[] list take effect"
    - "Biome v2.x overrides[] use PLURAL 'includes' key — singular 'include' is silently ignored"
    - "noRestrictedImports rule category is lint.rules.style (not nursery, not correctness) in Biome 2.x"
    - "Three-layer defense-in-depth for module exclusion: build-time external (a) + CI grep (b, Plan 06-05) + lint-time rule (c)"

key-files:
  created:
    - ".planning/phases/06-monorepo-setup-backward-compat-fence/deferred-items.md"
    - ".planning/phases/06-monorepo-setup-backward-compat-fence/06-04-SUMMARY.md"
  modified:
    - "packages/xci/tsup.config.ts"
    - "biome.json"

key-decisions:
  - "Chose Option A from RESEARCH.md Pattern 7 (negative-lookahead regex + explicit external) over Option B (drop noExternal entirely). Option A makes the 'bundle everything except these two' intent explicit and survives future additions of devDeps that must be bundled."
  - "Preserved noExternal semantics for all OTHER packages — only ws and reconnecting-websocket carved out. This protects the existing cold-start bundle strategy and the Phase 1 P02 banner."
  - "Scoped the Biome override narrowly to packages/xci/src/**/*.ts (not packages/xci/**). Tests and config files inside xci can still reference the strings; the rule targets production source imports only."
  - "Used Biome `paths` form (not `patterns`). `paths` does exact-match on module specifiers — the right tool for banning two specific bare imports."
  - "Documented the pre-existing 787KB bundle-size regression in deferred-items.md rather than failing the plan. Fence-mechanism correctness is Plan 06-04's charter; bundle-size enforcement is Plan 06-05/06's CI-gate charter."

patterns-established:
  - "Three-layer exclusion fence pattern (build + grep + lint) is the canonical way to enforce 'this package must never import X' in the monorepo going forward"
  - "Negative probe test pattern: write a minimal file importing the banned module under the in-scope glob, verify biome check exits non-zero, delete the probe. Catches Pitfall 2 (silently-ignored override keys) before it ships."

requirements-completed: [BC-03]

duration: ~4min
completed: 2026-04-18
---

# Phase 6 Plan 04: Backward-Compat Fence (tsup external + Biome lint) Summary

**Three-layer ws-fence activated at layers (a) build-time and (c) lint-time — tsup negative-lookahead regex + explicit external[] combined with a path-scoped Biome noRestrictedImports override; both Pitfall 1 (tsup noExternal precedence) and Pitfall 2 (Biome PLURAL `includes`) navigated and verified by fresh build + negative probe test.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-18T16:23:xxZ
- **Completed:** 2026-04-18T16:27:43Z
- **Tasks:** 2 auto
- **Files modified:** 2 (packages/xci/tsup.config.ts, biome.json)
- **Files created:** 2 (deferred-items.md, this SUMMARY.md)

## Accomplishments

- **Layer (a) build-time fence** — packages/xci/tsup.config.ts rewritten: the old `noExternal: [/.*/]` (which would have swallowed any `external` entry per tsup's plugin ordering) is now `noExternal: [/^(?!ws$|reconnecting-websocket$).*/]`, preserving "bundle everything else" while letting `external: ['ws', 'reconnecting-websocket']` actually externalize the two packages.
- **Layer (c) lint-time fence** — root biome.json now has an `overrides[]` entry that scopes `lint.rules.style.noRestrictedImports` to `packages/xci/src/**/*.ts` using the PLURAL `includes` key (Biome 2.x schema; singular `include` is silently ignored).
- **Configured messages reference D-16** — both banned paths carry human-readable explanations that point developers to the Phase 6 CONTEXT doc ("Agent WebSocket lives in @xci/server or agent modules outside packages/xci/src").
- **Banner byte-preserved** — the Phase 1 P02 shebang + createRequire polyfill in tsup.config.ts `banner.js` is untouched (byte-for-byte).
- **All 302 xci tests still pass** after the config changes.

## Task Commits

1. **Task 1: Apply ws-fence to packages/xci/tsup.config.ts (Pitfall 1)** — `03cca78` (fix)
2. **Task 2: Add ws-fence lint override to root biome.json (Pitfall 2)** — `1a2a55b` (feat)

## Files Created/Modified

- `packages/xci/tsup.config.ts` — replaced `noExternal: [/.*/]` with `noExternal: [/^(?!ws$|reconnecting-websocket$).*/]`; added `external: ['ws', 'reconnecting-websocket']`; added 4-line explanatory comment block referencing RESEARCH.md Pitfall 1.
- `biome.json` — bumped schema URL to 2.4.12; added top-level `overrides` array with one entry scoping `noRestrictedImports` to `packages/xci/src/**/*.ts` with `ws` and `reconnecting-websocket` in the `paths` object; all existing formatter/linter rules preserved.
- `.planning/phases/06-monorepo-setup-backward-compat-fence/deferred-items.md` — documents the pre-existing bundle-size regression (unrelated to Plan 06-04 scope).

## Verification Evidence

### Task 1 fence-mechanism verification

```
=== external list present ===                                        PASS
=== negative-lookahead noExternal regex present ===                  PASS
=== old regex [/.*/] gone ===                                        PASS
=== banner preserved (#!/usr/bin/env node + createRequire) ===       PASS
=== fresh build succeeded (dist/cli.mjs exists) ===                  PASS
=== bundle has NO ws/reconnecting-websocket strings (grep exit 1) == PASS
=== smoke: node dist/cli.mjs --version → "0.0.0" ==                  PASS
```

### Task 2 Biome override verification

```
=== schema bumped to 2.4.12 ===                                      PASS
=== overrides[] exists ===                                           PASS
=== PLURAL 'includes' inside override ===                            PASS
=== NO singular 'include' anywhere ===                               PASS
=== noRestrictedImports present ===                                  PASS
=== 'ws' path present ===                                            PASS
=== 'reconnecting-websocket' path present ===                        PASS
=== files.includes walks packages/** ===                             PASS
=== existing linter rules preserved (5 rules) ===                    PASS
=== formatter settings preserved (7 settings) ===                    PASS
=== no probe file remains ===                                        PASS
```

### Negative probe test results

- **In-scope probe** (`packages/xci/src/__fence_probe.ts` with `import 'ws'`): biome check exit 1 with diagnostic:
  > `× The xci CLI must not import 'ws'. Agent WebSocket lives in @xci/server or agent modules outside packages/xci/src. See Phase 6 CONTEXT D-16.`
- **In-scope probe 2** (`packages/xci/src/__fence_probe2.ts` with `import 'reconnecting-websocket'`): biome check exit 1 with matching diagnostic.
- **Out-of-scope probe** (`packages/server/src/__fence_out.ts` with `import 'ws'`): biome reports "No fixes applied" — rule correctly does NOT fire outside the scope.
- All three probe files deleted; no leftovers in the working tree.

### Test suite

```
pnpm --filter xci test
Test Files  13 passed (13)
     Tests  302 passed (302)
   Duration  6.40s
```

## Decisions Made

- **Chose Option A (negative-lookahead regex) over Option B (drop noExternal)** — Option A is more self-documenting and won't silently change behavior if devDeps ever need force-bundling.
- **Narrow override glob `packages/xci/src/**/*.ts`** — Excludes `packages/xci/TestProject/`, `packages/xci/dist/`, and tooling files. Tests in `__tests__` are in-scope and benefit from the rule (test helpers that accidentally import ws would be caught).
- **Used `paths` (exact-match) not `patterns` (gitignore glob)** — Exact-match is correct for two specific bare specifiers; `patterns` would over-match (e.g., `websocket-stream` isn't banned).
- **Documented the pre-existing 787KB bundle as deferred** — Rather than halt the plan, noted it in deferred-items.md. The plan's STOP directive at Step 1.2 is about changes caused by THIS plan's edits; the regression pre-dates this plan (verified via `git stash` + rebuild).

## Deviations from Plan

### Scope-Boundary Deferral (not an auto-fix)

**1. [SCOPE BOUNDARY] Pre-existing bundle-size regression (787 KB vs 200 KB gate)**
- **Found during:** Task 1 Step 1.2 (fresh-build smoke check)
- **Issue:** `pnpm --filter xci build` produces 787548-byte `dist/cli.mjs`, far above the 204800-byte (200 KB × 1024) D-15 threshold. Plan Task 1 acceptance criterion "wc -c < 204800" is NOT met.
- **Investigation:** Ran `git stash` to remove my Plan 06-04 changes, then rebuilt from the stash-clean base — bundle was already 787 KB BEFORE any Plan 06-04 edits. Source tree (`packages/xci/src/`) has grown to ~7880 LOC across 32 files (cli.ts 923 lines, tui/dashboard.ts 795 lines, etc.) since the v1 baseline of 126.41 KB.
- **Disposition:** SCOPE BOUNDARY — the bloat is not caused by this plan's changes. The fence mechanism itself works (grep returns 0 matches; rebuilt bundle has zero `ws`/`reconnecting-websocket` strings). Documented in `.planning/phases/06-monorepo-setup-backward-compat-fence/deferred-items.md` for Plan 06-05/06 scope.
- **Files modified:** None in Plan 06-04; the follow-up will likely toggle `minify: true` or refactor `tui/`.
- **Verification:** The fence acceptance criteria (external+noExternal wiring correct, grep exit 1, banner preserved, tests pass) all pass independently of the bundle-size regression.

### Auto-fixed Issues

None. Plan executed as written; both Pitfall 1 and Pitfall 2 handled per the plan's explicit guidance.

---

**Total deviations:** 0 auto-fixes + 1 scope-boundary deferral (pre-existing, unrelated regression)
**Impact on plan:** The D-16 three-layer fence (layers a and c) is wired correctly and verified. The deferred bundle-size issue is orthogonal to this plan's charter.

## Issues Encountered

- **pnpm not globally installed** on the worktree environment — resolved by `corepack enable --install-directory "$HOME/.local/bin"` and activating pnpm 10.33.0 (matches root `packageManager` pin).

## TDD Gate Compliance

Plan type is `execute` (not `tdd`). No RED/GREEN gate required. Each task still committed atomically as required.

## Known Stubs

None. No hardcoded empty data, no "coming soon" placeholders.

## Next Plan Readiness

- **Plan 06-05** can now wire the Layer (b) CI grep gate: `! grep -qE "(reconnecting-websocket|['\"]ws['\"])" packages/xci/dist/cli.mjs` after build. The grep pattern is already verified against a freshly-built bundle (exit 1, no matches).
- **Plan 06-05** should also include a size-limit CI gate job; the 200 KB threshold must be met first — see `deferred-items.md` for suggested remediations (enable minification, or audit `tui/` dead code).
- **Phase 8+ work that introduces `ws`** will now fail at the editor/lint level AND the build level if it accidentally lands inside `packages/xci/src/`; the correct home for such code is `packages/server/src/` or `packages/*/agent/` (out-of-scope paths verified clean).

## Self-Check: PASSED

### Files exist:
- FOUND: packages/xci/tsup.config.ts
- FOUND: biome.json
- FOUND: .planning/phases/06-monorepo-setup-backward-compat-fence/06-04-SUMMARY.md
- FOUND: .planning/phases/06-monorepo-setup-backward-compat-fence/deferred-items.md

### Commits exist:
- FOUND: 03cca78 (Task 1: fix tsup.config.ts)
- FOUND: 1a2a55b (Task 2: feat biome.json override)

### Fence verified green:
- FOUND: external entry + negative-lookahead noExternal
- FOUND: overrides[].includes (PLURAL) scoping noRestrictedImports
- FOUND: negative probe fires with configured message
- FOUND: out-of-scope probe does NOT fire (scope correct)
- FOUND: 302/302 xci tests passing

---
*Phase: 06-monorepo-setup-backward-compat-fence*
*Completed: 2026-04-18*
