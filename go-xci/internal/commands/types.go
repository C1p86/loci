package commands

// Kind classifies the command type.
type Kind string

const (
	KindSingle     Kind = "single"
	KindSequential Kind = "sequential"
	KindParallel   Kind = "parallel"
)

// ParamDef defines a declared parameter for an alias.
type ParamDef struct {
	Required    bool
	Description string
}

// CommandDef holds the normalized definition of a single xci alias.
type CommandDef struct {
	Kind        Kind
	Cmd         []string            // pre-split argv for single commands
	Platforms   map[string][]string // platform overrides keyed "linux"/"windows"/"macos"
	Steps       []string            // raw step strings for sequential
	Group       []string            // parallel group entries
	FailMode    string              // "" | "fast" | "complete"
	Description string
	Cwd         string              // optional working directory
	Params      map[string]ParamDef // optional parameter declarations; nil means no params declared
}

// CommandMap maps alias names to their normalized definitions.
type CommandMap map[string]CommandDef
