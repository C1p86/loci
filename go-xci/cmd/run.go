package cmd

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/andrearuggeri/go-xci/internal/commands"
	"github.com/andrearuggeri/go-xci/internal/config"
	"github.com/andrearuggeri/go-xci/internal/discovery"
	"github.com/andrearuggeri/go-xci/internal/executor"
	"github.com/andrearuggeri/go-xci/internal/resolver"
)

// keyValueRE matches KEY=VALUE style overrides.
var keyValueRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.]*=`)

// parseOverrides splits CLI args into KEY=VALUE overrides and remaining passthrough args.
// Everything after a standalone "--" is treated as passthrough.
func parseOverrides(cliArgs []string) (overrides map[string]string, passthrough []string) {
	overrides = make(map[string]string)
	sawDash := false
	for _, arg := range cliArgs {
		if arg == "--" {
			sawDash = true
			continue
		}
		if sawDash {
			passthrough = append(passthrough, arg)
			continue
		}
		if keyValueRE.MatchString(arg) {
			eqIdx := strings.Index(arg, "=")
			key := arg[:eqIdx]
			value := arg[eqIdx+1:]
			overrides[key] = value
		} else {
			passthrough = append(passthrough, arg)
		}
	}
	return
}

// runAlias loads config/commands, resolves the alias, and executes it.
// Returns the child process exit code.
func runAlias(alias string, cliArgs []string, dryRun, verbose bool) (int, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return 1, fmt.Errorf("cannot determine cwd: %w", err)
	}

	root, found := discovery.FindXciRoot(cwd)
	if !found {
		fmt.Fprintln(os.Stderr, "xci: no .xci/ directory found. Run `xci init` to scaffold one.")
		return 1, nil
	}

	cfg, err := config.Load(root)
	if err != nil {
		return 1, fmt.Errorf("config error: %w", err)
	}

	cmdsPath := root + "/.xci/commands.yml"
	cmds, err := commands.LoadCommands(cmdsPath)
	if err != nil {
		return 1, fmt.Errorf("commands error: %w", err)
	}

	// Parse KEY=VALUE overrides from CLI args
	overrides, passthrough := parseOverrides(cliArgs)

	// Apply overrides on top of config values
	mergedValues := make(map[string]string, len(cfg.Values)+len(overrides))
	for k, v := range cfg.Values {
		mergedValues[k] = v
	}
	for k, v := range overrides {
		mergedValues[k] = v
	}
	mergedCfg := config.ResolvedConfig{
		Values:     mergedValues,
		Provenance: cfg.Provenance,
		SecretKeys: cfg.SecretKeys,
	}

	plan, err := resolver.Resolve(alias, cmds, mergedCfg)
	if err != nil {
		return 1, fmt.Errorf("resolve error: %w", err)
	}

	// Append passthrough args to single-command argv
	if plan.Kind == commands.KindSingle && len(passthrough) > 0 {
		plan.Argv = append(plan.Argv, passthrough...)
	}

	if dryRun {
		fmt.Println("[DRY RUN]")
		fmt.Println("")
		fmt.Println("Config values:")
		keys := make([]string, 0, len(mergedValues))
		for k := range mergedValues {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			v := mergedValues[k]
			if mergedCfg.SecretKeys[k] {
				v = "<redacted>"
			}
			fmt.Printf("  %s=%s\n", k, v)
		}
		fmt.Println("")
		fmt.Println("Execution plan:")
		printPlan(plan, root)
		return 0, nil
	}

	if verbose {
		fmt.Println("Config values:")
		keys := make([]string, 0, len(mergedValues))
		for k := range mergedValues {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			v := mergedValues[k]
			if mergedCfg.SecretKeys[k] {
				v = "<redacted>"
			}
			fmt.Printf("  %s=%s\n", k, v)
		}
		fmt.Println("")
	}

	// Build child environment: inherit os.Environ, apply overrides
	env := os.Environ()
	for k, v := range overrides {
		env = append(env, k+"="+v)
	}
	// Inject config values as env vars too so ${VAR} baked into argv is also in env
	for k, v := range mergedValues {
		env = append(env, k+"="+v)
	}

	opts := executor.Options{
		Cwd:        root,
		Env:        env,
		ShowOutput: true,
	}

	return executor.Run(plan, opts)
}

// printPlan prints a human-readable plan for --dry-run output.
func printPlan(plan resolver.Plan, projectRoot string) {
	switch plan.Kind {
	case commands.KindSingle:
		cwd := plan.Cwd
		if cwd == "" {
			cwd = projectRoot
		}
		fmt.Printf("  type: single\n")
		fmt.Printf("  cmd:  %s\n", strings.Join(plan.Argv, " "))
		fmt.Printf("  cwd:  %s\n", cwd)
	case commands.KindSequential:
		fmt.Printf("  type: sequential (%d steps)\n", len(plan.Steps))
		for i, step := range plan.Steps {
			if step.SetVars != nil {
				for k, v := range step.SetVars {
					fmt.Printf("  step %d: [set] %s=%s\n", i+1, k, v)
				}
			} else {
				fmt.Printf("  step %d: %s\n", i+1, strings.Join(step.Argv, " "))
			}
		}
	case commands.KindParallel:
		fmt.Printf("  type: parallel (failMode=%s, %d entries)\n", plan.FailMode, len(plan.Group))
		for _, ge := range plan.Group {
			fmt.Printf("  entry: %s\n", strings.Join(ge.Argv, " "))
		}
	}
}
