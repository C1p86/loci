# Phase 16: Go CLI Output Infrastructure - Research

**Researched:** 2026-06-01
**Domain:** Go terminal output, fatih/color, TTY detection, colored CLI formatting
**Confidence:** HIGH

## Summary

Phase 16 creates `go-xci/internal/output/output.go` — a shared colored output package that replaces all ad-hoc `fmt.Fprintf(os.Stderr, ...)` calls in the executor with a consistent, colored, TTY-aware formatting layer. The package ports five functions from the TypeScript `output.ts` reference: `ShouldUseColor`, `PrintRunHeader`, `PrintStepHeader`, `PrintStepResult`, and `PrintParallelSummary`.

The critical dependency is `github.com/fatih/color` v1.19.0 (latest stable, verified from Go module proxy). It provides color attributes, automatic Windows VT processing via `go-colorable`, and TTY detection via `go-isatty`. The global `color.NoColor` bool is the single control knob: setting it at startup (based on `ShouldUseColor()` logic) disables all fatih/color output centrally.

The three Go files that need surgical edits are: `cmd/run.go` (insert `output.PrintRunHeader` after `resolver.Resolve`), `internal/executor/sequential.go` (replace `fmt.Fprintf` step header with `output.PrintStepHeader`), and `internal/executor/parallel.go` (replace summary `fmt.Fprintln` with `output.PrintParallelSummary`). All output goes exclusively to `os.Stderr`.

**Primary recommendation:** Add `github.com/fatih/color v1.19.0` to `go.mod`, create `internal/output/output.go` with the five functions, then wire call sites in three existing files. The whole change is self-contained — no changes to resolver or config types are needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Package location: `go-xci/internal/output/output.go` as package `output`. Own package, importable by both `cmd/` and `internal/executor/` without circular dependencies.
- **D-02:** Run-header shows: `▶ running: alias` in bold bright cyan, followed by a `variables:` block with only the vars the alias actually references via `${VAR}` in raw CommandDef strings (Cmd/Steps/Group). No steps list in Phase 16.
- **D-03:** Referenced-var scanning mirrors TypeScript `collectReferencedPlaceholders`: regex scan of raw CommandDef strings (Cmd, Steps, Group) for `${VARNAME}` tokens, then filter mergedValues.
- **D-04:** Secret values are masked (`**********`). The var name is shown, not the value.
- **D-05:** `ShouldUseColor()` priority: `NO_COLOR` env set → false, `FORCE_COLOR` env set → true, otherwise `fatih/color` isTTY detection on stderr.
- **D-06:** `fatih/color` handles Windows VT processing (`ENABLE_VIRTUAL_TERMINAL_PROCESSING`) automatically. No manual Windows-specific code needed.
- **D-07:** Phase 16 migrates the existing `[xci] step N: label` headers in `internal/executor/sequential.go` to `▶ label [N/total]` in bold cyan via `output.PrintStepHeader`.
- **D-08:** The parallel summary in `internal/executor/parallel.go` is upgraded to use output package functions for consistency.
- **D-09:** All output from `internal/output/output.go` writes to `os.Stderr` only. `os.Stdout` stays clean for shell completion. This is a hard requirement.

### Claude's Discretion
- Exact color constants (bright cyan hex, dim yellow) — match TypeScript ANSI palette where possible; adjust where `fatih/color` API differs.
- Step result summary format (checkmark/cross icons, duration display) — match TypeScript `printStepResult` as closely as Go rendering allows.
- Whether to expose `PrintParallelSummary` in Phase 16 or stub it — planner decides based on how much refactoring sequential.go and parallel.go need.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. `for_each`, `cwd` field, and breadcrumbs are Phase 17.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GOCLI-06 | User can see a colored run-header showing alias name and resolved params before execution begins (output.go foundation with fatih/color, isTTY detection, Windows VT support) | fatih/color v1.19.0 API verified; call site in cmd/run.go identified; TypeScript reference ported; Windows VT automatic via go-colorable |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Node.js + TypeScript for the main package; Go for `go-xci` (single-binary port)
- **Dependencies:** Minimal. For Go: `cobra`, `yaml`, plus now `fatih/color`.
- **Security:** Never log secret values. Mask with `**********` in all output.
- **Performance:** Cold-start < 300ms; bundle all deps. For Go: fat binary keeps startup fast.
- **Windows:** Must work on Windows 10+ — `fatih/color` + `go-colorable` handles VT processing automatically, satisfying this constraint.
- **stdout purity:** All diagnostic output on stderr (required for shell completion — Phase 18 dependency).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| github.com/fatih/color | v1.19.0 | Colored terminal output with TTY detection | De-facto standard for Go CLI color; handles Windows ENABLE_VIRTUAL_TERMINAL_PROCESSING automatically via go-colorable; respects NO_COLOR; used by cobra, helm, kubectl, etc. |
| github.com/mattn/go-isatty | v0.0.20 | TTY detection | Pulled in transitively by fatih/color; no direct import needed |
| github.com/mattn/go-colorable | v0.1.14 | Windows VT terminal output writer | Pulled in transitively by fatih/color; no direct import needed |

**fatih/color version confirmed:** v1.19.0 (latest as of 2026-06-01, verified via Go module proxy `proxy.golang.org/github.com/fatih/color/@v/list`).

### Supporting
All other Go dependencies already present in go.mod:
- `github.com/spf13/cobra v1.10.2` — CLI framework (already installed)
- `gopkg.in/yaml.v3 v3.0.1` — YAML parsing (already installed)

**Installation:**
```bash
# From go-xci/ directory
go get github.com/fatih/color@v1.19.0
```

This will also pull go-isatty and go-colorable as indirect deps and update go.sum automatically.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| fatih/color | raw ANSI codes + manual os.Getenv("NO_COLOR") | D-06 is locked: fatih/color required. Raw ANSI breaks cmd.exe on Windows without manual VT enabling. |
| fatih/color | mgutz/ansi | Less maintained, no automatic Windows support. |

---

## Architecture Patterns

### Recommended Project Structure Addition
```
go-xci/
├── internal/
│   ├── output/
│   │   └── output.go       # NEW — shared output package (package output)
│   ├── executor/
│   │   ├── sequential.go   # MODIFY — replace fmt.Fprintf step header
│   │   ├── parallel.go     # MODIFY — replace fmt.Fprintln summary
│   │   ├── executor.go     # unchanged
│   │   └── types.go        # unchanged (Options struct stays as-is)
│   └── ...
└── cmd/
    └── run.go              # MODIFY — insert PrintRunHeader call
```

### Pattern 1: fatih/color Package-Level Init + ShouldUseColor

**What:** Initialize `color.NoColor` once at startup based on env var priority, then let all `color.New(...)` instances follow that global flag automatically.

**When to use:** Any CLI tool that respects NO_COLOR / FORCE_COLOR standards.

```go
// Source: pkg.go.dev/github.com/fatih/color
// internal/output/output.go

package output

import (
    "os"
    "github.com/fatih/color"
)

// ShouldUseColor returns true when ANSI color codes should be emitted.
// Priority: NO_COLOR env → false, FORCE_COLOR env → true, else fatih/color isTTY.
// Called once at program startup; result stored in color.NoColor globally.
func ShouldUseColor() bool {
    if _, ok := os.LookupEnv("NO_COLOR"); ok {
        return false
    }
    if _, ok := os.LookupEnv("FORCE_COLOR"); ok {
        return true
    }
    // fatih/color's NoColor default already checks isTTY on stderr
    return !color.NoColor
}

// InitColor must be called once at startup (in cmd/root.go or cmd/run.go)
// to set color.NoColor based on ShouldUseColor().
func InitColor() {
    if !ShouldUseColor() {
        color.NoColor = true
    } else {
        color.NoColor = false
    }
}
```

**Important nuance:** `fatih/color`'s default `NoColor` is set based on `os.Stdout` TTY detection, not `os.Stderr`. Since xci writes all output to stderr, the isTTY check in `ShouldUseColor()` should ideally test stderr. The safe approach: check `color.NoColor` default (which may be `false` on TTY stdout) and override with explicit `NO_COLOR`/`FORCE_COLOR` checks. If `!color.NoColor && os.Getenv("NO_COLOR") == "" && os.Getenv("FORCE_COLOR") == ""`, use `mattn/go-isatty` directly on stderr fd — but this is optional since in practice stdout and stderr share the same TTY.

### Pattern 2: Color Object Reuse

**What:** Create package-level `color.Color` instances once; reuse across calls. Avoids repeated allocation.

```go
// Source: pkg.go.dev/github.com/fatih/color
var (
    boldCyan   = color.New(color.FgCyan, color.Bold)
    dimWhite   = color.New(color.FgWhite, color.Faint)
    greenCheck = color.New(color.FgGreen)
    redCross   = color.New(color.FgRed)
    yellow     = color.New(color.FgYellow)
)
```

### Pattern 3: PrintRunHeader Signature

**What:** The run-header function receives the raw `CommandDef` (for placeholder scanning), the merged values map, and the secret keys set.

```go
// internal/output/output.go

// PrintRunHeader prints the colored alias header before execution.
// alias: the alias name invoked.
// def: raw CommandDef (used to scan for ${VAR} references).
// mergedValues: all resolved parameter values.
// secretKeys: set of keys whose values must be masked.
func PrintRunHeader(alias string, def commands.CommandDef, mergedValues map[string]string, secretKeys map[string]bool) {
    // 1. Print bold cyan title: ▶ running: alias
    // 2. Collect referenced placeholders from def (D-03)
    // 3. Filter mergedValues to only referenced keys
    // 4. Print variables: block, masking secretKeys (D-04)
}
```

**Call site in cmd/run.go** — after `resolver.Resolve`, before `executor.Run`, after the dryRun branch:
```go
// cmd/run.go — in runAlias(), line ~196 (after dryRun block, before opts/executor.Run)
output.PrintRunHeader(alias, cmds[alias], mergedValues, mergedCfg.SecretKeys)
return executor.Run(plan, opts)
```

### Pattern 4: collectReferencedPlaceholders (Go port)

**What:** Scan raw CommandDef string fields for `${VARNAME}` tokens. Return a `map[string]bool` (set).

**TypeScript equivalent:** `collectReferencedPlaceholders` in `output.ts` lines 164–208.

```go
// Source: TypeScript output.ts collectReferencedPlaceholders (ported to Go)
var placeholderRE = regexp.MustCompile(`\$\{([^}]+)\}`)

func collectReferencedPlaceholders(def commands.CommandDef) map[string]bool {
    out := make(map[string]bool)
    scan := func(s string) {
        for _, m := range placeholderRE.FindAllStringSubmatch(s, -1) {
            if len(m) > 1 {
                out[m[1]] = true
            }
        }
    }
    switch def.Kind {
    case commands.KindSingle:
        for _, s := range def.Cmd {
            scan(s)
        }
    case commands.KindSequential:
        for _, s := range def.Steps {
            scan(s)
        }
    case commands.KindParallel:
        for _, s := range def.Group {
            scan(s)
        }
    }
    return out
}
```

**Note:** The TypeScript version also handles `for_each` and `ini` kinds. Go CLI does not have those kinds in Phase 16 scope. The three kinds above cover 100% of Go CLI cases.

### Pattern 5: PrintStepHeader Signature and Call Site

**What:** Replaces the existing `fmt.Fprintf(os.Stderr, "[xci] step %d: %s", ...)` in `sequential.go`.

```go
// internal/output/output.go
// PrintStepHeader prints ▶ label [N/total] to stderr.
func PrintStepHeader(label string, stepNum, totalSteps int) {
    counter := fmt.Sprintf(" [%d/%d]", stepNum, totalSteps)
    boldCyan.Fprintf(os.Stderr, "▶ %s%s\n", label, counter)
}
```

**Existing call site in sequential.go** (lines 44–55):
```go
// BEFORE (sequential.go lines 44-55):
label := step.Label
if label == "" {
    label = strings.Join(argv, " ")
}
if len(label) > 80 {
    label = label[:80] + "..."
}
fmt.Fprintf(os.Stderr, "[xci] step %d: %s", i+1, label)
if cwd != "" {
    fmt.Fprintf(os.Stderr, " (cwd: %s)", cwd)
}
fmt.Fprintln(os.Stderr)

// AFTER:
label := step.Label
if label == "" {
    label = strings.Join(argv, " ")
}
if len(label) > 80 {
    label = label[:80] + "..."
}
output.PrintStepHeader(label, i+1, len(steps))
```

The `cwd` display is Phase 17 (GOCLI-10). Strip it in Phase 16 (or leave plain — see Pitfall 3 below).

### Pattern 6: PrintParallelSummary Call Site

**What:** Replaces `fmt.Fprintln(os.Stderr, "[xci] parallel results:")` in `parallel.go`.

The existing parallel summary in `parallel.go` (lines 154–165) already collects result structs. The `PrintParallelSummary` function receives the group aliases and result codes:

```go
// internal/output/output.go
type ParallelResult struct {
    Alias    string
    ExitCode int
    Canceled bool
}

// PrintParallelSummary prints ✓ / ✗ per alias with exit code to stderr.
func PrintParallelSummary(results []ParallelResult) {
    fmt.Fprintln(os.Stderr) // blank line before summary
    for _, r := range results {
        if r.ExitCode == 0 {
            greenCheck.Fprintf(os.Stderr, "  ✓ %s (exit 0)\n", r.Alias)
        } else {
            redCross.Fprintf(os.Stderr, "  ✗ %s (exit %d)\n", r.Alias, r.ExitCode)
        }
    }
}
```

**Important:** `parallel.go` collects results out of order (goroutines complete non-deterministically). The existing code uses a `summaryLines` slice. `PrintParallelSummary` should accept the results in whatever order they arrive (matching TypeScript behavior — TypeScript also collects as goroutines complete).

### Anti-Patterns to Avoid
- **Writing to os.Stdout from output.go:** Violates D-09 and breaks tab completion (Phase 18). All output goes to `os.Stderr`.
- **Calling fatih/color methods before InitColor():** `color.NoColor` defaults based on stdout TTY, not stderr. Call `InitColor()` early in the command flow.
- **Using `color.CyanString(...)` shorthand functions:** These allocate new Color objects each call. Use package-level vars instead.
- **Importing output package from resolver or config:** Creates circular imports. Output package may only import `internal/commands` (for `CommandDef`) — it must not import `internal/config`, `internal/resolver`, or `internal/executor`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Windows VT100 terminal mode | Manual `syscall.SetConsoleMode` calls | `fatih/color` + `go-colorable` | go-colorable handles ENABLE_VIRTUAL_TERMINAL_PROCESSING at the Writer level; manual calls require windows build tags, const values, and error handling |
| TTY detection | os.Stat("/dev/stdin") tricks | `fatih/color` NoColor default + explicit env var checks | go-isatty uses platform-specific syscalls correctly; DIY approaches miss Windows named pipes, CI runners, etc. |
| ANSI reset | Building escape sequences manually | `color.New(...).Sprint(...)` | fatih/color wraps sequences with reset codes; raw strings risk terminal state bleed |

**Key insight:** Windows ANSI support is genuinely complex (ConEmu vs Windows Terminal vs cmd.exe vs PowerShell have different VT support levels). `go-colorable` has been solving this since 2013; the handwritten path always has edge cases.

---

## Runtime State Inventory

Step 2.5: SKIPPED — this is a new feature phase (greenfield `output.go` + call-site edits), not a rename or migration. No stored data, live service config, OS-registered state, secrets, or build artifacts reference anything being renamed or migrated.

---

## Common Pitfalls

### Pitfall 1: color.NoColor Defaults to stdout TTY, Not stderr TTY
**What goes wrong:** `fatih/color` initializes `color.NoColor` based on `os.Stdout` being a TTY. When xci is run as `xci build > output.txt`, stdout is a pipe (non-TTY), so `color.NoColor` becomes `true` — colors disabled even though stderr (where output.go writes) is still a terminal.

**Why it happens:** fatih/color was designed for tools that write to stdout. xci writes diagnostics to stderr.

**How to avoid:** In `ShouldUseColor()`, explicitly re-check stderr TTY status. Use `go-isatty` directly on `os.Stderr`:
```go
import "github.com/mattn/go-isatty"
// isatty.IsTerminal(os.Stderr.Fd()) or isatty.IsCygwinTerminal(os.Stderr.Fd())
```
Since `go-isatty` is already a transitive dependency of `fatih/color`, no new import is needed in go.mod.

**Warning signs:** Colors appear in terminal but disappear when stdout is redirected. Test with: `xci build > /dev/null` — colors should still appear on stderr.

### Pitfall 2: Stdout Pollution Breaking Tab Completion
**What goes wrong:** Any `fmt.Println` or `fmt.Printf` in the execution path that writes to stdout will corrupt shell completion output when cobra's `__complete` sub-command is invoked.

**Why it happens:** Shell completion scripts pipe `xci __complete xci "" "" ""` and parse stdout line by line. Extra lines break the parser silently.

**How to avoid:** `output.go` must use `os.Stderr` for ALL writes. The `verbose` output in `cmd/run.go` (lines 171–186) uses `fmt.Println` to stdout — this is a pre-existing issue but is NOT in Phase 16 scope. Phase 16 only creates new functions that write to stderr.

**Warning signs:** Tab completion returns no results or errors after Phase 16 changes. Test with: `xci __complete xci "" "" ""`

### Pitfall 3: Removing the cwd Display from Sequential Steps
**What goes wrong:** The existing `sequential.go` prints `(cwd: %s)` after the step label. If `PrintStepHeader` omits cwd, this info disappears from the UX until Phase 17 adds `PrintStepCwd`.

**Why it happens:** D-07 specifies the format `▶ label [N/total]` without cwd. Phase 17 (GOCLI-10) adds cwd display.

**How to avoid:** Two acceptable approaches: (a) Drop cwd display entirely in Phase 16 — users lose it temporarily until Phase 17. (b) Add a `PrintStepCwd` stub in Phase 16 that uses plain yellow color but is called from sequential.go. CONTEXT.md says "cwd field" is Phase 17 territory. The planner must decide: drop it or stub it. The TypeScript `printStepPreview` (output.ts lines 619–624) shows cwd in yellow before the command. Stubbing it now is safer than a regression.

**Warning signs:** A user running Phase 16 binary loses the cwd display they had before. File an intent in the plan.

### Pitfall 4: Unicode Characters on Windows
**What goes wrong:** `▶` (U+25B6), `✓` (U+2713), `✗` (U+2717) render as `?` or garbled characters in older Windows terminal environments (cmd.exe with legacy code page 850/1252).

**Why it happens:** Go's string literals contain UTF-8. Windows Terminal and modern PowerShell support UTF-8 natively, but cmd.exe with default code page does not.

**How to avoid:** For Phase 16 scope (Windows 10+ target per CLAUDE.md), Windows Terminal is standard and UTF-8 works. The risk is low. If a fallback is desired, it can be added as a `ShouldUseUnicode()` guard, but the TypeScript implementation uses the same characters without such guards — so matching TypeScript behavior means accepting the same risk.

**Warning signs:** `▶` appears as `?` — test on a Windows cmd.exe terminal with default code page.

### Pitfall 5: Import Cycle — output importing resolver or executor
**What goes wrong:** `output.go` needs `CommandDef` (from `internal/commands`) to implement `collectReferencedPlaceholders`. If it tries to import `internal/resolver` or `internal/executor` for Plan/Step types (e.g., to print the steps block), a circular import forms: executor imports output, output imports executor.

**Why it happens:** Phase 16 run-header does NOT include a steps block (D-02: "No steps list in Phase 16"). But a planner might add steps display anyway.

**How to avoid:** `output.go` must only import `internal/commands` for types. The run-header call in `cmd/run.go` has access to both `cmds[alias]` (CommandDef from `internal/commands`) and `plan` (from `internal/resolver`) — pass only what's needed to output functions. Never pass `resolver.Plan` into output package.

**Warning signs:** `go build` fails with "import cycle not allowed".

---

## Code Examples

### Full PrintRunHeader Implementation Pattern
```go
// Source: TypeScript output.ts printRunHeader (lines 217-318), ported to Go
// internal/output/output.go

func PrintRunHeader(alias string, def commands.CommandDef, mergedValues map[string]string, secretKeys map[string]bool) {
    // Title line: ▶ running: alias
    boldCyan.Fprintf(os.Stderr, "▶ running: %s\n", alias)

    // Variable block: only vars referenced via ${...} in the raw definition
    referenced := collectReferencedPlaceholders(def)
    
    // Sort keys for deterministic output
    var keys []string
    for k := range mergedValues {
        if referenced[k] {
            keys = append(keys, k)
        }
    }
    sort.Strings(keys)

    if len(keys) > 0 {
        fmt.Fprintln(os.Stderr, "variables:")
        for _, k := range keys {
            v := mergedValues[k]
            if secretKeys[k] {
                v = "**********"
            }
            fmt.Fprintf(os.Stderr, "  %s = %s\n", k, v)
        }
    }
}
```

### Exact Call Site — cmd/run.go
```go
// After resolver.Resolve, after dryRun/verbose branches, before executor.Run
// Lines ~196-204 in cmd/run.go (after existing verbose block, before opts/executor.Run)

output.InitColor()
output.PrintRunHeader(alias, cmds[alias], mergedValues, mergedCfg.SecretKeys)

opts := executor.Options{
    Cwd:        root,
    Env:        env,
    ShowOutput: true,
}
return executor.Run(plan, opts)
```

**Note:** `InitColor()` should be called as early as possible — ideally at the top of `runAlias()` or in `NewRootCmd`'s `PersistentPreRunE`. Calling it just before `PrintRunHeader` is also safe since no color output happens before that point.

### Existing sequential.go Step Header (BEFORE/AFTER)
```go
// BEFORE (lines 44-55 of sequential.go):
fmt.Fprintf(os.Stderr, "[xci] step %d: %s", i+1, label)
if cwd != "" {
    fmt.Fprintf(os.Stderr, " (cwd: %s)", cwd)
}
fmt.Fprintln(os.Stderr)

// AFTER Phase 16:
output.PrintStepHeader(label, i+1, len(steps))
// cwd display deferred to Phase 17 (GOCLI-10)
```

### Existing parallel.go Summary (BEFORE/AFTER)
```go
// BEFORE (line 155 of parallel.go):
fmt.Fprintln(os.Stderr, "[xci] parallel results:")
// ... scan summaryLines with buffered scanner ...

// AFTER Phase 16:
// Collect into []output.ParallelResult while processing results channel
// then:
output.PrintParallelSummary(parallelResults)
```

The refactor in parallel.go also simplifies the `summaryLines` / scanner dance — `PrintParallelSummary` accepts a `[]ParallelResult` slice that can be built while draining the `results` channel.

### go.mod Addition
```
require (
    github.com/fatih/color v1.19.0
    // existing deps...
)
```

After `go get github.com/fatih/color@v1.19.0`, `go.mod` gains:
```
require (
    github.com/fatih/color v1.19.0
    github.com/mattn/go-colorable v0.1.14 // indirect
    github.com/mattn/go-isatty v0.0.20 // indirect
    ...
)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual ANSI + syscall.SetConsoleMode on Windows | fatih/color + go-colorable | ~2014, stable | No Windows-specific code paths needed |
| fmt.Fprintf(os.Stderr, "[xci] step N: ...") | output.PrintStepHeader() via fatih/color | Phase 16 | Colored, structured, TTY-aware output |
| color.Output writer (fatih/color's stdout wrapper) | Fprint to os.Stderr directly | Architecture decision | go-colorable wraps os.Stderr transparently when using Fprint(os.Stderr) |

**Deprecated/outdated:**
- Direct `\x1b[` escape codes in Go: works on Linux/macOS but fails on cmd.exe without manual VT mode enabling. Not appropriate for cross-platform CLI.
- `github.com/TwiN/go-color`: smaller alternative but no Windows VT support, less community adoption.

---

## Open Questions

1. **ShouldUseColor() stderr vs stdout TTY check**
   - What we know: `fatih/color`'s `NoColor` default checks stdout. xci writes to stderr.
   - What's unclear: In practice, stdout and stderr share the same TTY. The issue only manifests when stdout is redirected (e.g., `xci build > out.txt`). Is this a real use case that needs explicit stderr TTY check?
   - Recommendation: Add explicit stderr isatty check via `github.com/mattn/go-isatty` (already transitive). One extra line, zero extra dependencies.

2. **cwd display in sequential step headers (Phase 16 regression risk)**
   - What we know: `sequential.go` currently prints `(cwd: %s)` after step label. Phase 17 (GOCLI-10) adds cwd display back. Phase 16 would temporarily drop it.
   - What's unclear: Is the regression acceptable for the Phase 16 release window?
   - Recommendation: The planner should add a `PrintStepCwd(cwd string)` helper to output.go in Phase 16 and call it from sequential.go before `PrintStepHeader`. This avoids regression and gives Phase 17 a hook to build on. The TypeScript reference (`printStepPreview`, output.ts line 619) prints cwd before the step run line — same pattern.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Go toolchain | Build go-xci | ✓ | go1.26.2 windows/amd64 | — |
| github.com/fatih/color | output.go color formatting | needs `go get` | v1.19.0 (in registry) | — |
| git | checkSecretsTracked (pre-existing) | ✓ (assumed) | — | already handled by best-effort |

**Missing dependencies with no fallback:**
- `github.com/fatih/color` must be added via `go get` — this is a `go.mod` edit task, not a blocker.

**Missing dependencies with fallback:**
- None.

---

## Sources

### Primary (HIGH confidence)
- `pkg.go.dev/github.com/fatih/color` — API for `color.New()`, attributes, `Fprint*`, `NoColor` global — verified via WebFetch
- `proxy.golang.org/github.com/fatih/color/@v/list` — v1.19.0 confirmed as latest stable — verified via Bash
- `proxy.golang.org/github.com/mattn/go-isatty/@v/list` — v0.0.20 confirmed as latest — verified via Bash
- `proxy.golang.org/github.com/mattn/go-colorable/@v/list` — v0.1.14 confirmed as latest — verified via Bash
- `packages/xci/src/executor/output.ts` — TypeScript reference implementation, read directly from repo
- `go-xci/internal/executor/sequential.go` — existing step header format confirmed — read directly
- `go-xci/internal/executor/parallel.go` — existing parallel summary format confirmed — read directly
- `go-xci/cmd/run.go` — exact call site after `resolver.Resolve` confirmed — read directly
- `go-xci/go.mod` — current deps (no fatih/color yet) confirmed — read directly
- `go-xci/internal/commands/types.go` — `CommandDef` struct fields (Cmd, Steps, Group) confirmed — read directly
- `go-xci/internal/config/types.go` — `ResolvedConfig.SecretKeys map[string]bool` confirmed — read directly

### Secondary (MEDIUM confidence)
- `github.com/fatih/color README.md` — Windows support via go-colorable, NO_COLOR behavior — verified via WebFetch from official repo

### Tertiary (LOW confidence)
- None flagged.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — fatih/color v1.19.0 verified from Go module proxy; all other deps are transitive
- Architecture: HIGH — TypeScript reference read directly, Go call sites read directly, no speculation
- Pitfalls: HIGH — import cycle (structural analysis), stdout pollution (per STATE.md critical pitfall #1), color.NoColor/stderr issue (known fatih/color behavior)

**Research date:** 2026-06-01
**Valid until:** 2026-09-01 (fatih/color is stable; check for v1.20 if planning much later)
