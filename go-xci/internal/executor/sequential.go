package executor

import (
	"strings"

	"github.com/andrearuggeri/xci/internal/output"
	"github.com/andrearuggeri/xci/internal/resolver"
)

// runSequential executes steps one by one, stopping at first non-zero exit.
// KEY=VALUE set-steps update the env overlay; subsequent steps re-interpolate
// their argv against the accumulated setVars using lenient interpolation.
func runSequential(steps []resolver.Step, opts Options) (int, error) {
	// setVars accumulates KEY=VALUE overrides from set-steps.
	setVars := make(map[string]string)

	for i, step := range steps {
		if step.SetVars != nil {
			// KEY=VALUE step: update setVars overlay
			for k, v := range step.SetVars {
				setVars[k] = v
			}
			continue
		}

		// Re-interpolate argv against current setVars for deferred ${VAR} resolution
		argv := step.Argv
		if len(setVars) > 0 {
			argv = resolver.InterpolateArgvLenient(step.Argv, setVars)
		}

		if len(argv) == 0 {
			continue
		}

		// Effective cwd: step cwd > opts cwd
		cwd := opts.Cwd
		if step.Cwd != "" {
			cwd = step.Cwd
		}

		// Print step header
		label := step.Label
		if label == "" {
			label = strings.Join(argv, " ")
		}
		if len(label) > 80 {
			label = label[:80] + "..."
		}
		output.PrintStepHeader(label, i+1, len(steps))
		output.PrintStepCwd(cwd)

		// Build env: inherit opts.Env, then overlay setVars
		env := opts.Env
		if len(setVars) > 0 {
			env = make([]string, len(opts.Env))
			copy(env, opts.Env)
			for k, v := range setVars {
				env = append(env, k+"="+v)
			}
		}

		code, err := runSingle(argv, cwd, env, opts.ShowOutput)
		if err != nil {
			return code, err
		}
		if code != 0 {
			return code, nil
		}
	}
	return 0, nil
}
