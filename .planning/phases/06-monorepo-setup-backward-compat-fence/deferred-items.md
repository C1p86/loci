# Deferred Items — Phase 06

## 06-04 Deferred: Pre-existing bundle-size regression

**Discovered during:** Plan 06-04 Task 1 fresh-build smoke check

**Issue:** A fresh `pnpm --filter xci build` produces `packages/xci/dist/cli.mjs` at **787548 bytes (~769 KB)**, far exceeding the 200 KB (204800 bytes) D-15 gate. Verified with `git stash`: the bundle was already 787 KB BEFORE any Plan 06-04 changes. Identical size pre- and post-edit.

**Root cause:** Pre-existing source growth. Since the STATE.md baseline of 126.41 KB (v1 baseline), the `packages/xci/src/` tree has grown to **~7880 LOC across 32 files**. Notable growth:
- `cli.ts` = 923 lines (vs. v1 baseline unknown but smaller)
- `tui/dashboard.ts` = 795 lines
- `commands/normalize.ts` = 424 lines
- `executor/output.ts` = 442 lines
- `resolver/params.ts` = 382 lines
- `template/index.ts` = 379 lines

This growth happened in quick-260415-* tasks BEFORE Phase 06 began.

**Why not fixed in Plan 06-04:**
- **SCOPE BOUNDARY:** The bundle bloat is not caused by Plan 06-04's changes (fence wiring). Bundle size is identical before and after the tsup.config.ts edit — the fence mechanism works correctly (grep confirms no `ws`/`reconnecting-websocket` strings in bundle).
- Plan 06-04's charter is the three-layer fence; size-limit enforcement is Plan 06-05/06's CI gate.
- Fixing the bundle bloat requires either (a) code deletion/refactor across multiple subsystems or (b) minification — both are out of Plan 06-04 scope.

**Impact on Plan 06-04 acceptance:**
- Fence mechanism verified working (negative-lookahead regex + external list + grep exit 1).
- The Plan 06-04 acceptance criterion "wc -c packages/xci/dist/cli.mjs < 204800" is NOT met due to pre-existing bloat.
- Plan's instruction "STOP and do NOT proceed" applies when the fence change causes the swell; it does not here.

**Required follow-up (before Plan 06-05 CI gate goes green):**
1. Turn on `minify: true` in `packages/xci/tsup.config.ts` (quick win — esbuild minification typically shrinks 3-5x).
2. OR investigate dead code in `tui/` (dashboard may ship unused code-paths), `executor/output.ts`, and `resolver/*.ts`.
3. OR re-evaluate the 200 KB D-15 threshold against the new source size (NOT recommended per plan's explicit guidance).

Track as a dedicated plan (e.g., Plan 06-07 "Shrink xci bundle to <200KB") or fold into Plan 06-05 scope.
