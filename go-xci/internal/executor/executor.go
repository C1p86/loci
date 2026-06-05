package executor

import (
	"github.com/andrearuggeri/xci/internal/commands"
	"github.com/andrearuggeri/xci/internal/resolver"
)

// Run dispatches a resolved Plan to the appropriate executor.
// Returns the exit code (0 = success, non-zero = failure).
func Run(plan resolver.Plan, opts Options) (int, error) {
	switch plan.Kind {
	case commands.KindSingle:
		cwd := opts.Cwd
		if plan.Cwd != "" {
			cwd = plan.Cwd
		}
		return runSingle(plan.Argv, cwd, opts.Env, opts.ShowOutput)
	case commands.KindSequential:
		return runSequential(plan.Steps, opts)
	case commands.KindParallel:
		return runParallel(plan.Group, plan.FailMode, opts)
	default:
		return 1, nil
	}
}
