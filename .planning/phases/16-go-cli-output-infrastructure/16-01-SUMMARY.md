---
phase: 16-go-cli-output-infrastructure
plan: 01
subsystem: go-cli
tags: [go, fatih-color, tty, ansi, color, output, isatty]

# Dependency graph
requires: []
provides:
  - go-xci/internal/output package with ShouldUseColor, InitColor, PrintRunHeader, PrintStepHeader, PrintStepCwd, PrintParallelSummary, ParallelResult
  - github.com/fatih/color v1.19.0 in go.mod/go.sum with transitive deps go-isatty, go-colorable
affects:
  - 16-02 (wires output package into executor call sites)
  - 17-go-cli-parity (PrintStepCwd used for cwd display; PrintStepHeader label extended for breadcrumbs)
  - 18-dispatch-and-completions (startup-path stderr purity enables cobra __complete)

# Tech tracking
tech-stack:
  added:
    - github.com/fatih/color v1.19.0
    - github.com/mattn/go-colorable v0.1.14 (transitive)
    - github.com/mattn/go-isatty v0.0.20 (transitive)
    - golang.org/x/sys v0.42.0 (transitive)
  patterns:
    - ShouldUseColor stderr-TTY check pattern (check NO_COLOR > FORCE_COLOR > isatty on stderr fd)
    - Package-level color.Color var reuse (avoid per-call allocation)
    - All diagnostic output via os.Stderr exclusively (stdout stays clean for shell completion)
    - TDD red-green cycle: write failing tests before implementation

key-files:
  created:
    - go-xci/internal/output/output.go
    - go-xci/internal/output/output_test.go
  modified:
    - go-xci/go.mod
    - go-xci/go.sum

key-decisions:
  - "ShouldUseColor checks stderr TTY via go-isatty directly (not color.NoColor default which uses stdout) — avoids regression when stdout is redirected"
  - "PrintStepCwd added in Phase 16 despite Phase 17 scope — prevents cwd regression in sequential.go when Phase 16 replaces step headers"
  - "collectReferencedPlaceholders is unexported — white-box test in package output (not _test package) to access it directly"

patterns-established:
  - "Pattern: All go-xci diagnostic output uses internal/output package, never raw fmt.Fprintf(os.Stderr)"
  - "Pattern: NO_COLOR / FORCE_COLOR / stderr isTTY priority for color detection"
  - "Pattern: Secret masking with '**********' string literal for any secretKeys[k] == true"

requirements-completed: [GOCLI-06]

# Metrics
duration: 10min
completed: 2026-06-01
---

# Phase 16 Plan 01: Go CLI Output Infrastructure — output.go

**TTY-aware colored output package for go-xci using fatih/color with stderr-only writes, NO_COLOR/FORCE_COLOR priority, and secret-masking in the run header**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-01T10:13:00Z
- **Completed:** 2026-06-01T10:23:36Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `github.com/fatih/color v1.19.0` to `go-xci/go.mod` with transitive deps (go-isatty, go-colorable, sys)
- Created `go-xci/internal/output/output.go` with all 6 exported functions and `ParallelResult` type
- `ShouldUseColor` checks stderr TTY (not stdout) via go-isatty, honoring NO_COLOR and FORCE_COLOR
- `PrintRunHeader` shows alias + only referenced `${VAR}` params with secret masking
- Unit tests pass for all env-priority and placeholder-scanning behaviors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add fatih/color dependency** - `488da90` (chore)
2. **Task 2 RED: Failing tests** - `7c5e720` (test)
3. **Task 2 GREEN: Implement output package** - `6fca7ec` (feat)

**Plan metadata:** (TBD — added in final commit)

## Files Created/Modified
- `go-xci/internal/output/output.go` - Shared output package: ShouldUseColor, InitColor, PrintRunHeader, PrintStepHeader, PrintStepCwd, PrintParallelSummary, ParallelResult
- `go-xci/internal/output/output_test.go` - Unit tests for env priority and collectReferencedPlaceholders
- `go-xci/go.mod` - Added fatih/color + transitive deps
- `go-xci/go.sum` - Updated checksums

## Decisions Made
- Used `isatty.IsTerminal(os.Stderr.Fd())` instead of relying on `color.NoColor` default — fatih/color initializes NoColor based on stdout, but xci writes diagnostics to stderr. When stdout is redirected, colors would incorrectly disable on stderr. Explicit stderr check fixes this.
- Added `PrintStepCwd` to the Phase 16 output package even though it's a Phase 17 (GOCLI-10) concern. Research identified a regression risk: replacing sequential.go's step header would drop the existing `(cwd: %s)` display. Adding the hook in Phase 16 prevents temporary regression.
- `collectReferencedPlaceholders` is unexported — test file uses `package output` (white-box) to access it directly, which is the standard Go pattern for testing unexported helpers.

## Deviations from Plan

None — plan executed exactly as written. The `PrintStepCwd` function was pre-planned in the task spec (Open Question 2 resolution) so it is not a deviation.

## Issues Encountered
None.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- `internal/output` package compiles cleanly with no import cycle
- All 6 exported symbols and `ParallelResult` type are ready for Phase 16 Plan 02 wiring
- `go build ./...` passes — whole module builds without modification to call sites
- Phase 17 can use `PrintStepCwd` directly for GOCLI-10 cwd display

---
*Phase: 16-go-cli-output-infrastructure*
*Completed: 2026-06-01*
