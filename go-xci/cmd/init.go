package cmd

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

// COMMANDS_YML_TEMPLATE is the example commands.yml content.
const COMMANDS_YML_TEMPLATE = `# xci commands.yml — define your project aliases here
hello:
  cmd: echo "Hello from xci!"
  description: Example single command

# Sequential alias: steps run one by one; stop on first failure
build:
  steps:
    - echo cleaning...
    - echo building...
  description: Build the project

# Parallel alias: entries run concurrently
check:
  parallel:
    - echo "check A"
    - echo "check B"
  failMode: fast
  description: Run checks in parallel
`

// CONFIG_YML_TEMPLATE is the example config.yml content.
const CONFIG_YML_TEMPLATE = `# xci config.yml — project-level configuration (commit this file)
# project: my-project   # optional: links to machine config subdirectory
# REGISTRY: ghcr.io/myorg
# IMAGE: myimage
`

// SECRETS_EXAMPLE_YML is the example secrets.yml content.
const SECRETS_EXAMPLE_YML = `# xci secrets.yml — machine-local secrets (DO NOT COMMIT)
# MY_TOKEN: "secret-value"
`

// LOCAL_EXAMPLE_YML is the example local.yml content.
const LOCAL_EXAMPLE_YML = `# xci local.yml — machine-local overrides (DO NOT COMMIT)
# ENV: local
`

var gitignoreEntries = []string{".xci/secrets.yml", ".xci/local.yml"}

// writeIfAbsent writes content to filePath only if the file does not already exist.
// Reports the action taken via stdout.
func writeIfAbsent(filePath, content string) error {
	if _, err := os.Stat(filePath); err == nil {
		fmt.Printf("  skipped  %s\n", relPath(filePath))
		return nil
	}
	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return fmt.Errorf("write %s: %w", filePath, err)
	}
	fmt.Printf("  created  %s\n", relPath(filePath))
	return nil
}

// relPath returns the path relative to cwd, or path itself on error.
func relPath(path string) string {
	cwd, err := os.Getwd()
	if err != nil {
		return path
	}
	rel, err := filepath.Rel(cwd, path)
	if err != nil {
		return path
	}
	return rel
}

// ensureGitignore ensures .xci/secrets.yml and .xci/local.yml are in .gitignore.
func ensureGitignore(projectDir string) error {
	gitignorePath := filepath.Join(projectDir, ".gitignore")
	if _, err := os.Stat(gitignorePath); os.IsNotExist(err) {
		// Create fresh .gitignore
		content := "# xci\n"
		for _, entry := range gitignoreEntries {
			content += entry + "\n"
		}
		if err := os.WriteFile(gitignorePath, []byte(content), 0644); err != nil {
			return fmt.Errorf("create .gitignore: %w", err)
		}
		fmt.Printf("  created  .gitignore\n")
		return nil
	}

	// Read existing .gitignore
	existing, err := os.ReadFile(gitignorePath)
	if err != nil {
		return fmt.Errorf("read .gitignore: %w", err)
	}
	existingStr := string(existing)

	// Find missing entries
	var missing []string
	for _, entry := range gitignoreEntries {
		found := false
		for _, line := range splitLines(existingStr) {
			if trimLine(line) == entry {
				found = true
				break
			}
		}
		if !found {
			missing = append(missing, entry)
		}
	}

	if len(missing) == 0 {
		fmt.Printf("  skipped  .gitignore\n")
		return nil
	}

	// Append missing entries
	appendContent := "\n# xci\n"
	for _, entry := range missing {
		appendContent += entry + "\n"
	}
	f, err := os.OpenFile(gitignorePath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("open .gitignore for append: %w", err)
	}
	defer f.Close()
	if _, err := f.WriteString(appendContent); err != nil {
		return fmt.Errorf("append .gitignore: %w", err)
	}
	fmt.Printf("  updated  .gitignore\n")
	return nil
}

func splitLines(s string) []string {
	var lines []string
	current := ""
	for _, ch := range s {
		if ch == '\n' {
			lines = append(lines, current)
			current = ""
		} else {
			current += string(ch)
		}
	}
	if current != "" {
		lines = append(lines, current)
	}
	return lines
}

func trimLine(s string) string {
	// Trim carriage return and spaces
	for len(s) > 0 && (s[len(s)-1] == '\r' || s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	return s
}

// newInitCmd creates the `xci init` cobra command.
func newInitCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "init",
		Short: "Scaffold a .xci/ directory in the current project",
		RunE: func(cmd *cobra.Command, args []string) error {
			cwd, err := os.Getwd()
			if err != nil {
				return fmt.Errorf("cannot determine working directory: %w", err)
			}
			return runInit(cwd)
		},
	}
}

// runInit scaffolds the .xci/ directory in the given projectDir.
func runInit(projectDir string) error {
	xciDir := filepath.Join(projectDir, ".xci")
	if err := os.MkdirAll(xciDir, 0755); err != nil {
		return fmt.Errorf("create .xci/: %w", err)
	}

	fmt.Print("xci init\n\n")

	if err := writeIfAbsent(filepath.Join(xciDir, "config.yml"), CONFIG_YML_TEMPLATE); err != nil {
		return err
	}
	if err := writeIfAbsent(filepath.Join(xciDir, "commands.yml"), COMMANDS_YML_TEMPLATE); err != nil {
		return err
	}
	if err := writeIfAbsent(filepath.Join(xciDir, "secrets.yml.example"), SECRETS_EXAMPLE_YML); err != nil {
		return err
	}
	if err := writeIfAbsent(filepath.Join(xciDir, "local.yml.example"), LOCAL_EXAMPLE_YML); err != nil {
		return err
	}
	if err := ensureGitignore(projectDir); err != nil {
		return err
	}

	fmt.Println("\nRun `xci hello` to test your setup.")
	return nil
}
