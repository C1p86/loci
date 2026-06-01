# Phase 16: Go CLI Output Infrastructure - Context

**Gathered:** 2026-06-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Create `go-xci/internal/output/output.go` — a shared colored output package — and wire it into all execution paths. Deliver a colored run-header (alias name + referenced params) printed before any alias executes. Upgrade existing step headers in sequential.go to colored format. This is the output foundation that Phases 17 and 18 depend on.

Scope is GOCLI-06 only. `for_each`, `cwd` field, and breadcrumbs are Phase 17.

</domain>

<decisions>
## Implementation Decisions

### output.go Package Location
- **D-01:** `go-xci/internal/output/output.go` as package `output`. Own package, importable by both `cmd/` and `internal/executor/` without circular dependencies. This is the canonical shared output package for all Go CLI diagnostic output.

### Run-Header Content
- **D-02:** The run-header shows: `▶ running: alias` in bold bright cyan, followed by a `variables:` block with only the vars the alias actually references via `${VAR}` in its raw definition (Cmd/Steps/Group strings). Secrets masked with `**********`. No steps list in Phase 16 — that's Phase 17 territory.
- **D-03:** Referenced-var scanning mirrors TypeScript `collectReferencedPlaceholders`: regex scan of raw CommandDef strings (Cmd, Steps, Group) for `${VARNAME}` tokens, then filter mergedValues to only show referenced vars.
- **D-04:** Secret values are masked (`**********`) using the SecretKeys set from config. The var name is shown, not the value.

### Color Detection
- **D-05:** `ShouldUseColor()` checks in this priority order: `NO_COLOR` env var set → false, `FORCE_COLOR` env var set → true, otherwise `fatih/color` isTTY detection on stderr. This matches TypeScript behavior and the no-color.org standard.
- **D-06:** `fatih/color` handles Windows VT processing (`ENABLE_VIRTUAL_TERMINAL_PROCESSING`) automatically. No manual Windows-specific code needed.

### Step Header Upgrade
- **D-07:** Phase 16 migrates the existing `[xci] step N: label` headers in `internal/executor/sequential.go` to the TypeScript-matching format: `▶ label [N/total]` in bold cyan via `output.PrintStepHeader`. When Phase 17 adds breadcrumb labels, it only needs to change the label string passed in — color infra is already in place.
- **D-08:** The parallel summary in `internal/executor/parallel.go` (`[xci] parallel results:`) is also upgraded to use output package functions for consistency.

### stdout Purity
- **D-09:** All output from `internal/output/output.go` writes to `os.Stderr` only. `os.Stdout` stays clean for shell completion (Phase 18 dependency). This is a hard requirement.

### Claude's Discretion
- Exact color constants (bright cyan hex, dim yellow) — match TypeScript ANSI palette where possible; adjust where `fatih/color` API differs.
- Step result summary format (✓/✗ icons, duration display) — match TypeScript `printStepResult` as closely as Go rendering allows.
- Whether to expose `PrintParallelSummary` in Phase 16 or stub it — planner decides based on how much refactoring sequential.go and parallel.go need.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### TypeScript Reference Implementation
- `packages/xci/src/executor/output.ts` — Canonical output module. Functions to port: `ShouldUseColor`, `PrintRunHeader`, `PrintStepHeader`, `PrintStepResult`, `PrintParallelSummary`. Check `collectReferencedPlaceholders` for the var-scanning logic.
- `packages/xci/src/executor/sequential.ts` — Shows how step headers integrate into execution flow (printStepHeader → printStepPreview → runSingle → printStepResult pattern).

### Go CLI Source Files to Modify
- `go-xci/internal/executor/sequential.go` — Replace plain [xci] step headers with output.PrintStepHeader calls.
- `go-xci/internal/executor/parallel.go` — Replace [xci] parallel results: with output package calls.
- `go-xci/cmd/run.go` — Call output.PrintRunHeader after resolver.Resolve, before executor.Run (in runAlias function, after the dryRun branch).
- `go-xci/go.mod` — Add github.com/fatih/color dependency.

### Go CLI Types
- `go-xci/internal/commands/types.go` — CommandDef struct (Cmd, Steps, Group fields to scan for ${VAR} references).
- `go-xci/internal/config/types.go` — ResolvedConfig.SecretKeys for secret masking.
- `go-xci/internal/resolver/resolver.go` — Plan struct (what's available post-resolve for header display).

### Phase Requirements
- `.planning/REQUIREMENTS.md` §GOCLI-06 — Acceptance criteria for this phase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `internal/executor/types.go` → `Options` struct: may need `SecretKeys` added so executor can pass secret info to output calls, OR the run-header call happens in cmd/run.go before executor.Run (preferred — keeps executor simple).
- `internal/resolver/resolver.go` → `Plan` struct: available at the call site in cmd/run.go with kind, argv, steps, group — planner can use this for display.

### Established Patterns
- All existing diagnostic output uses `fmt.Fprintf(os.Stderr, ...)` — output.go replaces these call sites in sequential.go and parallel.go.
- cmd/run.go already has access to both `cmds[alias]` (CommandDef) and `plan` (resolved Plan) — perfect call site for PrintRunHeader.
- Step counting is already implicit in sequential.go's `for i, step := range steps` — `len(steps)` gives totalSteps.

### Integration Points
- `cmd/run.go:runAlias()` → after `resolver.Resolve()`, before `executor.Run()`: insert `output.PrintRunHeader(alias, cmds[alias], mergedValues, mergedCfg.SecretKeys)`.
- `internal/executor/sequential.go:runSequential()` → replace `fmt.Fprintf(os.Stderr, "[xci] step %d: ...")` with `output.PrintStepHeader(label, i+1, len(steps))`.
- `internal/executor/parallel.go:runParallel()` → replace `fmt.Fprintln(os.Stderr, "[xci] parallel results:")` summary with `output.PrintParallelSummary(...)`.

</code_context>

<specifics>
## Specific Ideas

- The `▶` character (U+25B6) and `✓`/`✗` result icons match the TypeScript implementation exactly.
- The run-header title line: `▶ running: alias` in bold + bright cyan (ANSI `\x1b[1m\x1b[36m`). On non-TTY: plain `▶ running: alias`.
- Step header: `▶ label [N/total]` in bold cyan. Phase 17 changes `label` to a breadcrumb string — no other changes needed.
- fatih/color's `color.NoColor` bool can be set based on `ShouldUseColor()` to centrally control all color.Color instances.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 16-go-cli-output-infrastructure*
*Context gathered: 2026-06-01*
