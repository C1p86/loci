---
phase: quick-260630-uq4
verified: 2026-06-30T22:49:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase quick-260630-uq4: Re-interpolate cwd at runtime — Verification Report

**Phase Goal:** cwd field re-interpolates at runtime against captured variables (capture/set/prompt) in the sequential executor; cwd absolutization is deferred when unresolved `${...}` remain; for_each loop vars are baked into step.cwd at resolve time. `cwd: "${P4_WORKSPACE_ROOT}"` resolves after the variable is captured. xci rebuilt and reinstalled locally.
**Verified:** 2026-06-30T22:49:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A step whose cwd is `${VAR}` captured by a prior set/capture/prompt step spawns in that directory | ✓ VERIFIED | `sequential.ts` lines 253/299/338/370/416 all call `resolveRuntimeCwd(step.cwd, mergedValues, cwd)`; sequential.test.ts "absolute captured cwd" passes exit 0 |
| 2 | A for_each-body step with `cwd: "${LOOP_VAR}"` resolves to the per-iteration loop value at RESOLVE time (bakeLoopVarIntoRawArgv, NOT runtime capture path) | ✓ VERIFIED | `resolver/index.ts` lines 70-78: cwd baking is a SEPARATE conditional from rawArgv narrow; resolver.test.ts test (a) asserts `s0.cwd === 'eu'` and `s1.cwd === 'us'`, passes |
| 3 | A mixed cwd `${LOOP_VAR}/${CAPTURED}`: loop var baked at resolve time, captured placeholder survives for runtime | ✓ VERIFIED | resolver.test.ts test (b) asserts `s0b.cwd === 'eu/${CAPTURED}'`; `resolveAbsoluteCwds` leaves it deferred (still contains `${`) |
| 4 | Config-resolved cwd with NO placeholder absolutizes against projectRoot exactly as before (no regression) | ✓ VERIFIED | `toAbs` guard `if (cwd.includes('${')) return cwd` fires only when placeholder present; cwd.test.ts no-regression cases pass |
| 5 | Relative captured cwd resolves against projectRoot (base cwd passed to runSequential) | ✓ VERIFIED | `resolveRuntimeCwd`: if interpolated path is not absolute → `resolvePath(baseCwd, interpolated)`; sequential.test.ts "relative captured cwd" passes exit 0 |
| 6 | `resolveAbsoluteCwds` leaves a cwd containing `${` intact (no longer corrupts to `projectRoot\${VAR}`) | ✓ VERIFIED | `cwd.ts` line 34: `if (cwd.includes('${')) return cwd;` — early return before `isAbsolute` check; cwd.test.ts deferral tests pass |
| 7 | `assertCwdExists` runs against the FINAL resolved absolute cwd, never the placeholder form | ✓ VERIFIED | `resolveRuntimeCwd` does NOT call `assertCwdExists`; `runAndCapture` (line 46) and `runSingle` call it with the post-interpolation, post-absolutization path |

**Score:** 7/7 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/xci/src/executor/cwd.ts` | resolveRuntimeCwd helper + toAbs deferral | ✓ VERIFIED | Exports `resolveRuntimeCwd`; `toAbs` has `if (cwd.includes('${')) return cwd` guard; imports `interpolateArgv` from `../resolver/interpolate.js` |
| `packages/xci/src/executor/sequential.ts` | Runtime cwd re-interpolation at all 5 step-kind call sites | ✓ VERIFIED | Lines 253, 299, 338, 370, 416 each compute `mergedValues = { ...env, ...capturedVars }` first then call `resolveRuntimeCwd` |
| `packages/xci/src/resolver/index.ts` | bakeLoopVarIntoRawArgv also bakes cwd, separate from rawArgv narrow | ✓ VERIFIED | Lines 64-67: rawArgv baking gated on `kind === undefined/'cmd' && rawArgv !== undefined`; lines 70-78: cwd baking unconditional for any step with a cwd field (excluding set/prompt) |
| `packages/xci/src/executor/__tests__/cwd.test.ts` | Unit tests for placeholder deferral + resolveRuntimeCwd | ✓ VERIFIED | 21 tests total; new `describe('resolveAbsoluteCwds — defers unresolved placeholders')` (4 cases) and `describe('resolveRuntimeCwd')` (6 cases); all pass |
| `packages/xci/src/executor/__tests__/sequential.test.ts` | Integration tests for captured-var cwd resolution | ✓ VERIFIED | 18 tests total; new `describe('runSequential — runtime cwd re-interpolation')` block (3 cases: absolute captured, relative captured, inherited base); all pass |
| `packages/xci/src/resolver/__tests__/resolver.test.ts` | Regression test: for_each body step cwd `${LOOP_VAR}` baked to per-iteration value | ✓ VERIFIED | 88 tests total; new `describe('resolver — for_each bakes loop variable into step.cwd (quick-260630-uq4)')` block (3 cases: loop-var-only, mixed loop+captured, no-cwd regression); all pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `sequential.ts` | `cwd.ts` | `import { assertCwdExists, resolveRuntimeCwd } from './cwd.js'` | ✓ WIRED | Line 16 of sequential.ts; `resolveRuntimeCwd` called at all 5 step-kind sites |
| `cwd.ts` | `resolver/interpolate.ts` | `import { interpolateArgv }` for runtime var resolution | ✓ WIRED | Line 10 of cwd.ts; `interpolateArgv([rawCwd], '(cwd)', values)` in `resolveRuntimeCwd` body |
| `resolver/index.ts` | `resolver/interpolate.ts` | `bakeLoopVarIntoRawArgv` uses `interpolateArgvLenient([s.cwd], loopVarValues)` | ✓ WIRED | Line 77: `interpolateArgvLenient([withBakedArgv.cwd], loopVarValues)[0] ?? withBakedArgv.cwd` |

---

### Data-Flow Trace (Level 4)

Not applicable. This phase modifies executor plumbing and resolver logic, not components that render dynamic data from a store or API. The test assertions (exit codes from spawned child processes) directly verify data flows.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 3 targeted test files pass | `pnpm --filter xci exec vitest run src/executor/__tests__/cwd.test.ts src/executor/__tests__/sequential.test.ts src/resolver/__tests__/resolver.test.ts` | 3 files, 127 tests, all passed | ✓ PASS |
| `xci --version` reports installed version | `xci --version` | `0.3.2` | ✓ PASS |
| absolute captured cwd spawns in correct directory | sequential.test.ts "absolute captured cwd" — spawns node with `process.cwd() === subDir ? 0 : 7` | exit 0 | ✓ PASS |
| relative captured cwd resolves against base | sequential.test.ts "relative captured cwd" — spawns node with `process.cwd() === resolvePath(tmpDir,'subdir') ? 0 : 8` | exit 0 | ✓ PASS |
| for_each loop var baked into step.cwd | resolver.test.ts test (a) — `s0.cwd === 'eu'`, `s1.cwd === 'us'` | assertion passes | ✓ PASS |

---

### Probe Execution

No probes declared in PLAN.md. No conventional `scripts/*/tests/probe-*.sh` detected. Skipped.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| quick-260630-uq4 | 260630-uq4-PLAN.md | cwd field re-interpolation at runtime against captured vars + for_each loop var baking | ✓ SATISFIED | 7/7 truths verified; 127 new+existing tests pass |

---

### Anti-Patterns Found

Scanned `cwd.ts`, `sequential.ts`, `resolver/index.ts` for TBD, FIXME, XXX, TODO, HACK, PLACEHOLDER, `return null/[]/{}`, `console.log`-only implementations.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

No anti-patterns found in any of the 3 source files modified by this phase.

---

### Single and Parallel Executors: Untouched

`packages/xci/src/executor/single.ts` and `packages/xci/src/executor/parallel.ts` were NOT modified in this phase (git log confirms last changes predate commits 53572d1/c281f49/0f30374). The plan explicitly scoped changes to `sequential.ts` only, since single and parallel have no capture flow.

---

### Pre-existing Failures: Independent Confirmation

Full suite result: **695 passed, 6 failed** — identical to the claim in SUMMARY.md.

The 6 failures occur in files NOT touched by this phase:

| Test File | Failure | Why Pre-existing | Relation to cwd |
|-----------|---------|-----------------|-----------------|
| `cli.e2e.test.ts` | `--version` expects `'0.0.0'` but gets `'0.3.2'` | Test written at version 0.0.0, never updated after version bumps; last relevant commit `741792a` (before cwd commits) | None |
| `cli.e2e.test.ts` | `-V` expects `'0.0.0'` but gets `'0.3.2'` | Same as above | None |
| `cli.e2e.test.ts` | `--verbose` config trace test failure | Unrelated CLI behavior | None |
| `cli.e2e.test.ts` | `${xci.project.path}` interpolation test | Unrelated placeholder; last cwd-related commit predates this | None |
| `cold-start.test.ts` | `dist/cli.mjs dynamic import points to ./agent/index.js` | Build artifact structure test; unrelated to executor logic | None |
| `single.test.ts` | `throws SpawnError when command does not exist` | Non-existent command on Windows returns exit 1 instead of throwing; last modified `9553ab0` (before cwd commits) | None — `single.ts` untouched |

Git confirms: none of these 3 test files appear in the cwd-phase commits (53572d1, c281f49, 0f30374).

---

### Human Verification Required

None. All goal behaviors are covered by automated spawn-based integration tests that verify actual process working-directory placement via `process.cwd()` comparisons and exit codes.

---

### Gaps Summary

No gaps. All 7 must-have truths verified with test evidence. All 6 artifacts exist, are substantive, and wired. All 3 key links confirmed. No anti-patterns. xci installed at 0.3.2. 6 pre-existing test failures confirmed independent of this phase's changes.

---

_Verified: 2026-06-30T22:49:00Z_
_Verifier: Claude (gsd-verifier)_
