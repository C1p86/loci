// Package output provides a shared colored output layer for the xci Go CLI.
// All functions write exclusively to os.Stderr. os.Stdout is never touched
// so that shell completion (cobra __complete) keeps a clean stdout channel.
package output

import (
	"fmt"
	"os"
	"regexp"
	"sort"

	"github.com/fatih/color"
	"github.com/mattn/go-isatty"

	"github.com/andrearuggeri/xci/internal/commands"
)

// Package-level compiled regexp for placeholder scanning.
var placeholderRE = regexp.MustCompile(`\$\{([^}]+)\}`)

// Package-level reusable color objects (allocated once, not per call).
var (
	boldCyan   = color.New(color.FgCyan, color.Bold)
	greenCheck = color.New(color.FgGreen)
	redCross   = color.New(color.FgRed)
	dimYellow  = color.New(color.FgYellow)
)

// ShouldUseColor returns true when ANSI color codes should be emitted.
// Priority order:
//  1. NO_COLOR env var present (any value, even empty) → false
//  2. FORCE_COLOR env var present → true
//  3. Fallback: check if stderr is a TTY (go-isatty, covers Windows Terminal + Cygwin)
//
// This checks stderr, NOT stdout — xci writes all diagnostics to stderr and a user
// redirecting stdout (e.g. xci build > out.txt) should still see colored stderr.
func ShouldUseColor() bool {
	if _, ok := os.LookupEnv("NO_COLOR"); ok {
		return false
	}
	if _, ok := os.LookupEnv("FORCE_COLOR"); ok {
		return true
	}
	return isatty.IsTerminal(os.Stderr.Fd()) || isatty.IsCygwinTerminal(os.Stderr.Fd())
}

// InitColor sets the global color.NoColor flag based on ShouldUseColor().
// Call once at program startup (in cmd/root.go PersistentPreRun or cmd/run.go).
// All color.New(...) instances automatically respect this global flag.
func InitColor() {
	color.NoColor = !ShouldUseColor()
}

// PrintRunHeader prints the alias run header to stderr before execution begins.
// It shows the alias name in bold cyan, then a variables block listing only the
// parameter keys that the alias definition actually references via ${VAR} tokens.
// Secret values are masked as "**********".
//
// Parameters:
//   - alias: the alias name being executed
//   - def: raw CommandDef (scanned for ${VAR} references — not the resolved plan)
//   - mergedValues: all resolved parameter values
//   - secretKeys: set of keys whose values must be masked
func PrintRunHeader(alias string, def commands.CommandDef, mergedValues map[string]string, secretKeys map[string]bool) {
	boldCyan.Fprintf(os.Stderr, "▶ running: %s\n", alias)

	referenced := collectReferencedPlaceholders(def)

	// Build a sorted slice of keys from mergedValues that are referenced by the alias.
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

// PrintStepHeader prints a step header to stderr before each sequential step.
// Format: ▶ label [N/total] in bold cyan.
func PrintStepHeader(label string, stepNum, totalSteps int) {
	boldCyan.Fprintf(os.Stderr, "▶ %s [%d/%d]\n", label, stepNum, totalSteps)
}

// PrintStepCwd prints the effective working directory before a step spawns.
// It uses dim yellow to visually distinguish cwd from the step header.
// No-op when cwd is empty.
func PrintStepCwd(cwd string) {
	if cwd == "" {
		return
	}
	dimYellow.Fprintf(os.Stderr, "  cwd: %s\n", cwd)
}

// ParallelResult carries the outcome of one parallel execution entry.
type ParallelResult struct {
	Alias    string
	ExitCode int
}

// PrintParallelSummary prints a summary of parallel execution results to stderr.
// A blank line is printed first, then one line per result with ✓ (green) or
// ✗ (red) and the exit code.
func PrintParallelSummary(results []ParallelResult) {
	fmt.Fprintln(os.Stderr)
	for _, r := range results {
		if r.ExitCode == 0 {
			greenCheck.Fprintf(os.Stderr, "  ✓ %s (exit 0)\n", r.Alias)
		} else {
			redCross.Fprintf(os.Stderr, "  ✗ %s (exit %d)\n", r.Alias, r.ExitCode)
		}
	}
}

// collectReferencedPlaceholders scans a raw CommandDef for ${VARNAME} tokens.
// Returns a set (map[string]bool) of all placeholder names found.
// Scans: Cmd for KindSingle, Steps for KindSequential, Group for KindParallel.
// This mirrors the TypeScript collectReferencedPlaceholders in output.ts.
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
