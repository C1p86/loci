---
phase: 15-go-cli-parity-fixes
plan: "01"
subsystem: go-xci/resolver
tags: [go, interpolation, multi-pass, parity-fix]
dependency_graph:
  requires: []
  provides: [multi-pass-placeholder-resolution]
  affects: [go-xci/internal/resolver, go-xci/internal/executor]
tech_stack:
  added: []
  patterns: [multi-pass-stable-loop, escape-sentinel-protection]
key_files:
  created: []
  modified:
    - go-xci/internal/resolver/interpolate.go
    - go-xci/internal/resolver/interpolate_test.go
decisions:
  - Escape sequences ($${KEY}) protected via sentinel across the entire multi-pass loop, not per-pass, to prevent literal ${KEY} outputs from being re-expanded on subsequent passes
  - interpolateToken retained as unchanged single-pass primitive; interpolateTokenMultiPass wraps it with the stable-loop logic
  - InterpolateArgv and InterpolateArgvLenient updated to delegate to interpolateTokenMultiPass with maxPasses=10
metrics:
  duration: "156s (~2m)"
  completed: "2026-05-31T20:34:08Z"
  tasks: 2
  files: 2
---

# Phase 15 Plan 01: Multi-pass placeholder resolution for Go interpolation engine

**One-liner:** Added `interpolateTokenMultiPass` with stable-output loop (maxPasses=10) and cross-pass escape protection so self-referencing config values like `url="${base}/api"` resolve fully.

## What Changed

### interpolate.go

Added `interpolateTokenMultiPass` function (between `interpolateToken` and `InterpolateArgv`) that:
- Protects escape sequences (`$${KEY}`) across the entire multi-pass session (not per-pass) at the start, restoring them only after the loop
- Runs up to `maxPasses` iterations calling the regex-based expansion inline
- Breaks early when the token output is stable (no more changes)
- Returns error on first strict-mode missing-key, same as `interpolateToken`

Updated `InterpolateArgv` to call `interpolateTokenMultiPass(token, aliasName, values, true, 10)` instead of `interpolateToken`.

Updated `InterpolateArgvLenient` to call `interpolateTokenMultiPass(token, "", values, false, 10)` instead of `interpolateToken`.

`interpolateToken` itself is **unchanged** — it remains the single-pass primitive.

### interpolate_test.go

Added 3 new test functions after the existing 6 tests:

- `TestInterpolateArgv_multiPass`: `values={"base":"https://example.com","url":"${base}/api"}`, `InterpolateArgv(["${url}"])` → `["https://example.com/api"]` (2-pass chain)
- `TestInterpolateArgv_multiPassStable`: `values={"A":"hello"}`, resolves in 1 pass, no error
- `TestInterpolateArgv_multiPassMaxDepth`: 12-level chain `a→b→c→...→l` in lenient mode, terminates after maxPasses=10 without panic

## Test Evidence

```
=== RUN   TestInterpolateArgv_strict
--- PASS: TestInterpolateArgv_strict (0.00s)
=== RUN   TestInterpolateArgv_strictMissingError
--- PASS: TestInterpolateArgv_strictMissingError (0.00s)
=== RUN   TestInterpolateArgv_lenientLeavesUnknown
--- PASS: TestInterpolateArgv_lenientLeavesUnknown (0.00s)
=== RUN   TestInterpolateArgv_escape
--- PASS: TestInterpolateArgv_escape (0.00s)
=== RUN   TestInterpolateArgv_multiplePerToken
--- PASS: TestInterpolateArgv_multiplePerToken (0.00s)
=== RUN   TestInterpolateArgv_tokenNotResplit
--- PASS: TestInterpolateArgv_tokenNotResplit (0.00s)
=== RUN   TestInterpolateArgv_multiPass
--- PASS: TestInterpolateArgv_multiPass (0.00s)
=== RUN   TestInterpolateArgv_multiPassStable
--- PASS: TestInterpolateArgv_multiPassStable (0.00s)
=== RUN   TestInterpolateArgv_multiPassMaxDepth
--- PASS: TestInterpolateArgv_multiPassMaxDepth (0.00s)
PASS
ok  github.com/andrearuggeri/xci/internal/resolver  0.090s
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Escape sequence re-expansion in multi-pass loop**
- **Found during:** Task 1 GREEN phase (after first implementation attempt)
- **Issue:** The plan's proposed `interpolateTokenMultiPass` called `interpolateToken` per pass. `interpolateToken` restores `$${KEY}` → `${KEY}` at the end of each pass. The multi-pass loop then saw `${KEY}` in pass 2 and tried to expand it as a real placeholder in strict mode, causing `TestInterpolateArgv_escape` to fail.
- **Fix:** Moved escape-sequence protection outside the loop: `$${` → sentinel at the start of `interpolateTokenMultiPass`, inline regex expansion per pass (without calling `interpolateToken`), sentinel → `${` only at the end after all passes complete. This prevents literals produced by escape sequences from being re-expanded.
- **Files modified:** `go-xci/internal/resolver/interpolate.go`
- **Commit:** 4148d93

## Known Stubs

None — all code is fully wired. Tests validate real behavior end-to-end.

## Self-Check: PASSED

- `go-xci/internal/resolver/interpolate.go` exists and contains `interpolateTokenMultiPass`
- `go-xci/internal/resolver/interpolate_test.go` exists and contains `TestInterpolateArgv_multiPass`
- Commit 4148d93 exists (feat: implementation)
- Commit 3d9f1f1 exists (test: test cases)
- `go test ./internal/resolver/... -v` exits 0 with 16 tests green
