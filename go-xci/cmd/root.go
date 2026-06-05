package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/spf13/cobra"

	"github.com/andrearuggeri/xci/internal/commands"
	"github.com/andrearuggeri/xci/internal/config"
	"github.com/andrearuggeri/xci/internal/discovery"
)

// Execute builds the root command, executes it, and returns the exit code.
// The caller should pass the result to os.Exit.
func Execute() int {
	root := NewRootCmd()
	if err := root.Execute(); err != nil {
		// cobra already printed the error
		return 1
	}
	return 0
}

// NewRootCmd creates the root cobra command for xci.
func NewRootCmd() *cobra.Command {
	var listFlag bool
	var dryRun bool
	var verbose bool

	rootCmd := &cobra.Command{
		Use:                "xci [alias] [KEY=VALUE...] [-- passthrough...]",
		Short:              "xci — Local CI command runner",
		SilenceUsage:       true,
		SilenceErrors:      true,
		DisableFlagParsing: false,
		// Allow arbitrary args (alias + overrides)
		Args: cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if listFlag || len(args) == 0 {
				return printList()
			}
			// First non-flag arg is the alias; rest are cliArgs
			alias := args[0]
			cliArgs := args[1:]
			code, err := runAlias(alias, cliArgs, dryRun, verbose)
			if err != nil {
				fmt.Fprintln(os.Stderr, "xci:", err)
			}
			os.Exit(code)
			return nil
		},
	}

	rootCmd.Flags().BoolVar(&listFlag, "list", false, "List all available aliases")
	rootCmd.Flags().BoolVar(&dryRun, "dry-run", false, "Print config values and execution plan without executing")
	rootCmd.Flags().BoolVar(&verbose, "verbose", false, "Print config values before executing")

	// Register init subcommand
	rootCmd.AddCommand(newInitCmd())

	return rootCmd
}

// printList discovers the xci root and prints all defined aliases.
func printList() error {
	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("cannot determine cwd: %w", err)
	}

	root, found := discovery.FindXciRoot(cwd)
	if !found {
		fmt.Println("xci: no .xci/ directory found. Run `xci init` to scaffold one.")
		return nil
	}

	cmdsPath := filepath.Join(root, ".xci", "commands.yml")
	cmds, err := commands.LoadCommands(cmdsPath)
	if err != nil {
		return fmt.Errorf("cannot load commands: %w", err)
	}

	_, err = config.Load(root)
	if err != nil {
		// Non-fatal for list
		fmt.Fprintf(os.Stderr, "[xci] config warning: %v\n", err)
	}

	fmt.Println("xci — Local CI command runner")
	fmt.Println()
	fmt.Println("Project aliases:")
	fmt.Println()

	// Sort alias names for deterministic output
	names := make([]string, 0, len(cmds))
	for name := range cmds {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		def := cmds[name]
		typeStr := kindLabel(def.Kind)
		desc := def.Description
		if desc == "" {
			desc = "-"
		}
		fmt.Printf("  %-16s  %s (%s)\n", name, desc, typeStr)
	}
	fmt.Println()
	return nil
}

func kindLabel(k commands.Kind) string {
	switch k {
	case commands.KindSingle:
		return "single"
	case commands.KindSequential:
		return "sequential"
	case commands.KindParallel:
		return "parallel"
	default:
		return string(k)
	}
}
