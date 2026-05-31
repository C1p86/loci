package resolver

import (
	"fmt"
	"regexp"
	"runtime"

	"github.com/andrearuggeri/go-xci/internal/commands"
	"github.com/andrearuggeri/go-xci/internal/config"
)

// VAR_ASSIGN_RE matches KEY=VALUE steps in sequential definitions.
var varAssignRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.]*=`)

// Plan represents a fully resolved execution plan.
type Plan struct {
	Kind     commands.Kind
	Argv     []string     // KindSingle
	Steps    []Step       // KindSequential
	Group    []GroupEntry // KindParallel
	FailMode string       // KindParallel
	Cwd      string       // effective cwd (may be empty)
}

// Step represents one element in a sequential plan.
type Step struct {
	Argv    []string
	SetVars map[string]string // non-nil means this is a KEY=VALUE set step
	Label   string
	Cwd     string
}

// GroupEntry is one entry in a parallel plan.
type GroupEntry struct {
	Alias string
	Argv  []string
	Cwd   string
}

// selectPlatformCmd picks the argv for the current OS.
// Maps runtime.GOOS "darwin" -> "macos" block.
func selectPlatformCmd(def commands.CommandDef) []string {
	goos := runtime.GOOS
	platformKey := goos
	if platformKey == "darwin" {
		platformKey = "macos"
	}
	if def.Platforms != nil {
		if argv, ok := def.Platforms[platformKey]; ok && len(argv) > 0 {
			return argv
		}
	}
	return def.Cmd
}

// resolveAlias recursively resolves an alias to a Plan.
func resolveAlias(
	aliasName string,
	cmds commands.CommandMap,
	cfg config.ResolvedConfig,
	depth int,
	chain []string,
	parentCwd string,
) (Plan, error) {
	if depth > 10 {
		return Plan{}, fmt.Errorf("alias nesting exceeds maximum depth of 10: %v", chain)
	}

	def, ok := cmds[aliasName]
	if !ok {
		return Plan{}, fmt.Errorf("unknown alias: %q", aliasName)
	}

	// Compute effective cwd: own cwd (lenient-interpolated) or parent's
	effectiveCwd := parentCwd
	if def.Cwd != "" {
		interp := InterpolateArgvLenient([]string{def.Cwd}, cfg.Values)
		if len(interp) > 0 {
			effectiveCwd = interp[0]
		}
	}

	switch def.Kind {
	case commands.KindSingle:
		rawCmd := selectPlatformCmd(def)
		argv, err := InterpolateArgv(rawCmd, aliasName, cfg.Values)
		if err != nil {
			return Plan{}, err
		}
		return Plan{Kind: commands.KindSingle, Argv: argv, Cwd: effectiveCwd}, nil

	case commands.KindSequential:
		var steps []Step
		for _, stepStr := range def.Steps {
			if varAssignRE.MatchString(stepStr) {
				// KEY=VALUE set step
				eqIdx := -1
				for i, ch := range stepStr {
					if ch == '=' {
						eqIdx = i
						break
					}
				}
				key := stepStr[:eqIdx]
				value := stepStr[eqIdx+1:]
				steps = append(steps, Step{SetVars: map[string]string{key: value}})
			} else if _, exists := cmds[stepStr]; exists {
				// Alias reference: resolve and inline its steps
				subPlan, err := resolveAlias(stepStr, cmds, cfg, depth+1, append(chain, stepStr), effectiveCwd)
				if err != nil {
					return Plan{}, err
				}
				switch subPlan.Kind {
				case commands.KindSingle:
					steps = append(steps, Step{
						Argv:  subPlan.Argv,
						Label: stepStr,
						Cwd:   subPlan.Cwd,
					})
				case commands.KindSequential:
					steps = append(steps, subPlan.Steps...)
				default:
					// Parallel alias inlined as its individual entries
					for _, ge := range subPlan.Group {
						steps = append(steps, Step{Argv: ge.Argv, Label: ge.Alias, Cwd: ge.Cwd})
					}
				}
			} else {
				// Inline command: tokenize then lenient-interpolate
				argv, err := commands.Tokenize(stepStr, aliasName)
				if err != nil {
					return Plan{}, err
				}
				interpArgv := InterpolateArgvLenient(argv, cfg.Values)
				steps = append(steps, Step{Argv: interpArgv, Cwd: effectiveCwd})
			}
		}
		return Plan{Kind: commands.KindSequential, Steps: steps, Cwd: effectiveCwd}, nil

	case commands.KindParallel:
		var group []GroupEntry
		for _, entry := range def.Group {
			if _, exists := cmds[entry]; exists {
				// Alias reference: must resolve to single
				subPlan, err := resolveAlias(entry, cmds, cfg, depth+1, append(chain, entry), effectiveCwd)
				if err != nil {
					return Plan{}, err
				}
				if subPlan.Kind != commands.KindSingle {
					return Plan{}, fmt.Errorf("%s: parallel group entry %q must resolve to a single command", aliasName, entry)
				}
				group = append(group, GroupEntry{Alias: entry, Argv: subPlan.Argv, Cwd: subPlan.Cwd})
			} else {
				// Inline command: tokenize then strict-interpolate
				argv, err := commands.Tokenize(entry, aliasName)
				if err != nil {
					return Plan{}, err
				}
				interpArgv, err := InterpolateArgv(argv, aliasName, cfg.Values)
				if err != nil {
					return Plan{}, err
				}
				group = append(group, GroupEntry{Alias: entry, Argv: interpArgv, Cwd: effectiveCwd})
			}
		}
		failMode := def.FailMode
		if failMode == "" {
			failMode = "fast" // default
		}
		return Plan{Kind: commands.KindParallel, Group: group, FailMode: failMode, Cwd: effectiveCwd}, nil
	}

	return Plan{}, fmt.Errorf("unsupported command kind: %v", def.Kind)
}

// Resolve resolves an alias name to an execution Plan.
func Resolve(aliasName string, cmds commands.CommandMap, cfg config.ResolvedConfig) (Plan, error) {
	return resolveAlias(aliasName, cmds, cfg, 0, []string{aliasName}, "")
}
