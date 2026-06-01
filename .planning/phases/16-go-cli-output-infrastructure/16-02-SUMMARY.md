---
phase: 16-go-cli-output-infrastructure
plan: 02
subsystem: go-cli
tags: [go, fatih-color, output, executor, sequential, parallel, run-header, tty]

# Dependency graph
requires:
  - 16-01 (internal/output package with all exported symbols)
provides:
  - cmd/run.go calls InitColor + PrintRunHeader before executor.Run
  - sequential.go uses PrintStepHeader + PrintStepCwd (replaces [xci] step header)
  - parallel.go uses PrintParallelSummary (replaces [xci] parallel results block)
  - fatih/color promoted to direct dependency in go.mod
affects:
  - 17-go-cli-parity (cwd display now via PrintStepCwd — no regression when Phase 17 extends breadcrumb)
  - 18-dispatch-and-completions (stdout stays clean — no [xci] noise on completion path)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - output.InitColor() called once per command invocation before executor.Run
    - All diagnostic output via internal/output package — no raw fmt.Fprintf(os.Stderr) in call sites
    - output.PrintRunHeader wired with raw CommandDef (not resolved plan) to enable placeholder scanning

key-files:
  created: []
  modified:
    - go-xci/cmd/run.go
    - go-xci/internal/executor/sequential.go
    - go-xci/internal/executor/parallel.go
    - go-xci/go.mod

key-decisions:
  - "PrintRunHeader receives cmds[alias] (raw CommandDef) not plan — enables placeholder-referenced-var scanning without import cycle risk"
  - "InitColor placed before PrintRunHeader (not in PersistentPreRun) — run.go is the only command path that executes user aliases; no need to initialize color for list/init commands that don't use colored output"
  - "fmt and os removed from sequential.go imports — only usage was the removed [xci] step header block; strings kept for strings.Join on label"
  - "bufio and strings removed from parallel.go — were only used by the summaryLines/scanner dance that PrintParallelSummary replaces"

# Metrics
duration: 3min
completed: 2026-06-01
---

# Phase 16 Plan 02: Wire output package into executor call sites

**output.InitColor + PrintRunHeader in run.go; PrintStepHeader/PrintStepCwd in sequential.go; PrintParallelSummary in parallel.go — GOCLI-06 observable end-to-end**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-06-01T10:24:00Z
- **Completed:** 2026-06-01T10:27:11Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `internal/output` import and `InitColor` + `PrintRunHeader` calls to `cmd/run.go`, placed after the verbose block and before `executor.Run` so dry-run is unaffected
- `fatih/color` promoted from `// indirect` to direct dependency in `go.mod` (via `go mod tidy`)
- Replaced the `[xci] step N: label (cwd: ...)` header in `sequential.go` with `output.PrintStepHeader + output.PrintStepCwd` — cwd display preserved (no regression)
- Replaced the `[xci] parallel results:` + `summaryLines` + `bufio.Scanner` dance in `parallel.go` with `output.PrintParallelSummary` taking a `[]output.ParallelResult` slice
- Removed unused imports: `fmt`, `os` from `sequential.go`; `bufio`, `strings` from `parallel.go`
- All tests pass (7 packages, 0 failures), `go vet ./...` clean

## Task Commits

Each task was committed atomically:

1. **Task 1: InitColor + PrintRunHeader in cmd/run.go** - `6a71f7a` (feat)
2. **Task 2: Replace [xci] step headers with output package calls** - `a4de56a` (feat)

## Files Created/Modified
- `go-xci/cmd/run.go` — Added output import; InitColor() + PrintRunHeader() after verbose block, before opts/executor.Run
- `go-xci/internal/executor/sequential.go` — output.PrintStepHeader + PrintStepCwd replacing fmt.Fprintf header; removed fmt, os imports
- `go-xci/internal/executor/parallel.go` — output.PrintParallelSummary replacing summaryLines + [xci] parallel results block; removed bufio, strings imports
- `go-xci/go.mod` — fatih/color promoted to direct dependency

## Decisions Made
- `PrintRunHeader` receives `cmds[alias]` (raw `CommandDef`) rather than the resolved `plan`. This lets the function scan raw `${VAR}` tokens to determine which params are referenced by the alias, matching the TypeScript behavior. Passing `plan` would risk an import cycle (output → resolver → commands) and `plan` does not contain the raw command strings after interpolation.
- `InitColor()` is placed in `runAlias()` (cmd/run.go) rather than in a cobra `PersistentPreRun` hook. The `run` command is the only path that needs color; `list`, `init`, and `__complete` never call `runAlias`. Keeping initialization close to use avoids touching cobra setup files (out of this plan's scope).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all output functions are fully implemented (Plan 01) and wired here.

## Self-Check: PASSED

- FOUND: go-xci/cmd/run.go (contains output.InitColor, output.PrintRunHeader)
- FOUND: go-xci/internal/executor/sequential.go (contains output.PrintStepHeader, output.PrintStepCwd)
- FOUND: go-xci/internal/executor/parallel.go (contains output.PrintParallelSummary, output.ParallelResult)
- FOUND: go-xci/go.mod (fatih/color without // indirect)
- Commits verified: 6a71f7a (Task 1), a4de56a (Task 2)

---
*Phase: 16-go-cli-output-infrastructure*
*Completed: 2026-06-01*
