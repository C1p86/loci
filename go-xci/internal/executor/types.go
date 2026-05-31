package executor

// Options configures how a plan is executed.
type Options struct {
	Cwd        string   // working directory for child processes (overridden per-step by plan Cwd)
	Env        []string // full environment for child processes (os.Environ() + overrides)
	ShowOutput bool     // if true, stream child stdout/stderr to os.Stdout/os.Stderr
}
