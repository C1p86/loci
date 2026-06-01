package cmd

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"

	"github.com/andrearuggeri/xci/internal/commands"
	"github.com/andrearuggeri/xci/internal/config"
	"github.com/andrearuggeri/xci/internal/discovery"
	"github.com/andrearuggeri/xci/internal/executor"
	"github.com/andrearuggeri/xci/internal/output"
	"github.com/andrearuggeri/xci/internal/resolver"
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

// validateParams checks that all required params declared on the alias are
// present in values. Returns an error with the alias name and param name if any
// required param is missing. Best-practice: call before resolver.Resolve.
func validateParams(alias string, def commands.CommandDef, values map[string]string) error {
	for name, param := range def.Params {
		if !param.Required {
			continue
		}
		if _, ok := values[name]; !ok {
			return fmt.Errorf("alias %q: required parameter %s is not defined", alias, name)
		}
	}
	return nil
}

// checkSecretsTracked prints a warning on stderr if .xci/secrets.yml is
// tracked by git. Best-effort: silently ignores all errors (git not available,
// not a repo, secrets.yml not tracked — all treated as "no warning needed").
func checkSecretsTracked(root string) {
	cmd := exec.Command("git", "ls-files", "--error-unmatch", ".xci/secrets.yml")
	cmd.Dir = root
	if err := cmd.Run(); err == nil {
		fmt.Fprintln(os.Stderr, "warning: .xci/secrets.yml is tracked by git — secrets may be exposed")
	}
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

	// Check if secrets.yml is accidentally tracked by git (GOCLI-04)
	checkSecretsTracked(root)

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

	// Validate required params declared on the alias (GOCLI-02)
	if def, ok := cmds[alias]; ok {
		if err := validateParams(alias, def, mergedValues); err != nil {
			fmt.Fprintln(os.Stderr, "error:", err)
			return 1, nil
		}
	}

	plan, err := resolver.Resolve(alias, cmds, mergedCfg)
	if err != nil {
		return 1, fmt.Errorf("resolve error: %w", err)
	}

	// Append passthrough args to the last command of the plan (GOCLI-05)
	if len(passthrough) > 0 {
		switch plan.Kind {
		case commands.KindSingle:
			plan.Argv = append(plan.Argv, passthrough...)
		case commands.KindSequential:
			if len(plan.Steps) > 0 {
				last := len(plan.Steps) - 1
				plan.Steps[last].Argv = append(plan.Steps[last].Argv, passthrough...)
			}
		case commands.KindParallel:
			if len(plan.Group) > 0 {
				last := len(plan.Group) - 1
				plan.Group[last].Argv = append(plan.Group[last].Argv, passthrough...)
			}
		}
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

	output.InitColor()
	output.PrintRunHeader(alias, cmds[alias], mergedValues, mergedCfg.SecretKeys)

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
