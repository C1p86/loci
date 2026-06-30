---
phase: quick-260630-uq4
plan: "01"
subsystem: executor/resolver
tags: [cwd, sequential, for_each, runtime-interpolation, captured-vars]
dependency_graph:
  requires: []
  provides: [resolveRuntimeCwd, toAbs-deferral, bakeLoopVarCwd]
  affects: [executor/cwd.ts, executor/sequential.ts, resolver/index.ts]
tech_stack:
  added: []
  patterns: [runtime-interpolation, lenient-vs-strict-interpolation, tdd]
key_files:
  created: []
  modified:
    - packages/xci/src/executor/cwd.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/executor/__tests__/cwd.test.ts
    - packages/xci/src/executor/__tests__/sequential.test.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
decisions:
  - "resolveRuntimeCwd uses STRICT interpolateArgv so a never-captured cwd var fails loudly"
  - "toAbs deferral guard is cwd.includes('${') — simple string check, no regex overhead"
  - "bakeLoopVarIntoRawArgv cwd baking is NOT gated on rawArgv presence (unlike rawArgv baking)"
  - "single and parallel executors intentionally untouched — no capture flow, placeholder cwds now left intact by resolveAbsoluteCwds rather than corrupted"
metrics:
  duration: "~15 min"
  completed: "2026-06-30"
  tasks: 4
  files: 6
---

# Phase quick-260630-uq4 Plan 01: Re-interpolate cwd at runtime against captured vars

**One-liner:** Three coupled fixes — toAbs deferral, resolveRuntimeCwd at all 5 sequential sites, bakeLoopVarIntoRawArgv cwd baking — so `cwd: "${VAR}"` resolves to the right directory whether VAR is a captured var or a for_each loop variable.

## What Was Built

### Fix 1 — toAbs deferral in resolveAbsoluteCwds (cwd.ts)

`toAbs` now returns the cwd string unchanged when it contains `${`. Without this, a step with `cwd: '${P4_WORKSPACE_ROOT}'` would be absolutized to `projectRoot\${P4_WORKSPACE_ROOT}` before the variable was known, corrupting the string irreversibly.

Config-resolved cwds (no placeholder) keep the existing absolute/relative behaviour exactly. The deferral is a single `if (cwd.includes('${')) return cwd;` guard added before the `isAbsolute` check.

### Fix 2 — resolveRuntimeCwd helper (cwd.ts)

New export `resolveRuntimeCwd(rawCwd, values, baseCwd): string` that is the runtime counterpart to `toAbs`:

- `undefined` → return `baseCwd` (inherited cwd, no interpolation)  
- contains `${` → STRICT `interpolateArgv` (throws `UndefinedPlaceholderError` on missing key)
- interpolated absolute → return as-is
- interpolated relative → `resolvePath(baseCwd, interpolated)`

Uses strict interpolation (not lenient) so a step whose cwd references a var that was never captured fails loudly, consistent with argv re-interpolation behaviour.

### Fix 2 (wiring) — all 5 sequential step kinds (sequential.ts)

Every step kind (xci, uproject, unreadonly, ini, cmd) previously used `step.cwd ?? cwd` directly. After the fix each site:
1. Computes `mergedValues = { ...env, ...capturedVars }` first
2. Calls `resolveRuntimeCwd(step.cwd, mergedValues, cwd)` which handles the undefined-means-inherit case

For xci/uproject/unreadonly/ini this required moving the `mergedValues` computation above the cwd line (it was already computed just after — reorder only, no logic change). For cmd the `stepSpawnCwd` line was already after `mergedValues`.

### Fix 3 — bakeLoopVarIntoRawArgv now bakes step.cwd (resolver/index.ts)

`bakeLoopVarIntoRawArgv` previously only baked the loop var into `rawArgv` (command variant only). The cwd bug: when a `for_each` definition has `cwd: '${region}'`, `computeEffectiveCwd` is called with the original `config` (not `loopConfig`) so the loop var is not yet in scope. `effectiveCwd` stays as `'${region}'`. Sub-steps that have no own cwd inherit it as `parentCwd`. The step leaves `resolveToStepsLenient` with `cwd: '${region}'`. Fix 1 keeps this string intact. But Fix 2 cannot help — `region` is a for_each loop var, never in `capturedVars` at runtime — `resolveRuntimeCwd` would throw.

The fix adds a cwd-baking step inside `bakeLoopVarIntoRawArgv` for **any** step that carries a `cwd` field (NOT gated on rawArgv presence — xci/ini/uproject/unreadonly body steps may have cwd without rawArgv). `set` and `prompt` are excluded (no cwd field in their type). Lenient interpolation is used, matching the rawArgv baking — unknown placeholders (captured vars) survive for Fix 2 to handle.

## Combined Ordering (preserved correctly)

```
bakeLoopVarIntoRawArgv (resolve time, loop var → rawArgv + cwd)
  → resolveAbsoluteCwds defers if ${  remains
      (loop var already gone → baked cwd absolutizes normally;
       captured-var placeholder survives unchanged)
  → runtime resolveRuntimeCwd (captured vars → interpolate + absolutize)
```

A cwd like `'${region}/${CAPTURED}'` becomes `'eu/${CAPTURED}'` after baking. `resolveAbsoluteCwds` leaves it deferred (still contains `${`). At runtime `resolveRuntimeCwd` interpolates `${CAPTURED}` from `capturedVars` and absolutizes.

## Single and Parallel Plans — Intentionally Untouched

`single.ts` and `parallel.ts` have no capture flow — no `set`/`capture`/`prompt` steps, no `capturedVars`. Neither executor was changed. `resolveAbsoluteCwds` now correctly leaves placeholder cwds intact for those plans too (no corruption) rather than joining them to projectRoot. The plan notes this as a no-regression improvement: if a user somehow has a placeholder cwd in a single or parallel alias, it will now be passed through (and fail loudly at spawn time rather than silently spawning in a nonsense directory).

## Test Coverage

| File | New Tests | What They Cover |
|------|-----------|-----------------|
| cwd.test.ts | 10 | toAbs deferral (single + sequential), resolveRuntimeCwd (6 cases) |
| sequential.test.ts | 3 | absolute captured cwd, relative captured cwd, inherited base cwd |
| resolver.test.ts | 3 | loop-var-only baked to per-iteration, mixed loop+captured preserved, no-cwd regression |

## Task 4 Results

- Full xci suite: **695 passed, 6 failed** (6 failures are pre-existing, confirmed unchanged from baseline)
- TypeScript: **0 errors** (`tsc --noEmit`)
- `pnpm install-local` completed successfully
- `xci --version` reports: **0.3.2**

## Deviations from Plan

**1. [Rule 2 - Missing] TypeScript type narrowing guards in resolver.test.ts**

- **Found during:** Task 4 typecheck
- **Issue:** `s0.cwd` / `plan.steps[0]?.cwd` accessed on `SequentialStep` union without narrowing away `set`/`prompt` variants which have no `cwd` field
- **Fix:** Added `if (s0.kind === 'set' || s0.kind === 'prompt') throw new Error(...)` guards before each `.cwd` access
- **Files modified:** `packages/xci/src/resolver/__tests__/resolver.test.ts`
- **Commit:** 3582f15

Otherwise plan executed exactly as written.

## Self-Check: PASSED

All committed files exist in git log. Test counts match expected (695 pass with 6 pre-existing failures unchanged). TypeScript compiles clean.
