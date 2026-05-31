package executor

import (
	"fmt"
	"io"
	"os"
	"os/exec"
)

// runSingle executes a single argv. Returns the exit code and an error if spawning fails.
// Returns (1, err) on spawn failure, (code, nil) on normal exit.
// If show is false, stdout and stderr are discarded.
func runSingle(argv []string, cwd string, env []string, show bool) (int, error) {
	if len(argv) == 0 {
		return 1, fmt.Errorf("empty argv")
	}

	cmd := exec.Command(argv[0], argv[1:]...)

	if cwd != "" {
		cmd.Dir = cwd
	}
	if len(env) > 0 {
		cmd.Env = env
	}

	if show {
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	} else {
		cmd.Stdout = io.Discard
		cmd.Stderr = io.Discard
	}

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code := exitErr.ExitCode()
			if code < 0 {
				code = 1 // signal-killed
			}
			return code, nil
		}
		// Spawn failure (binary not found, permission denied, etc.)
		return 1, fmt.Errorf("spawn error for %q: %w", argv[0], err)
	}
	return 0, nil
}
