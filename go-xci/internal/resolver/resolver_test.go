package resolver

import (
	"runtime"
	"testing"

	"github.com/andrearuggeri/xci/internal/commands"
	"github.com/andrearuggeri/xci/internal/config"
)

// makeConfig is a test helper to build a ResolvedConfig from a map.
func makeConfig(values map[string]string) config.ResolvedConfig {
	return config.ResolvedConfig{
		Values:     values,
		Provenance: map[string]config.ConfigLayer{},
		SecretKeys: map[string]bool{},
	}
}

func TestResolve_single(t *testing.T) {
	cmds := commands.CommandMap{
		"build": {Kind: commands.KindSingle, Cmd: []string{"go", "build", "./..."}},
	}
	cfg := makeConfig(map[string]string{})
	plan, err := Resolve("build", cmds, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Kind != commands.KindSingle {
		t.Errorf("expected single, got %v", plan.Kind)
	}
	if len(plan.Argv) != 3 || plan.Argv[0] != "go" {
		t.Errorf("unexpected argv: %v", plan.Argv)
	}
}

func TestResolve_singleWithPlatformOverride(t *testing.T) {
	goos := runtime.GOOS
	platformKey := goos
	if platformKey == "darwin" {
		platformKey = "macos"
	}

	platformCmd := map[string][]string{
		platformKey: {"platform-cmd", "arg"},
	}
	cmds := commands.CommandMap{
		"run": {
			Kind:      commands.KindSingle,
			Cmd:       []string{"default-cmd"},
			Platforms: platformCmd,
		},
	}
	cfg := makeConfig(map[string]string{})
	plan, err := Resolve("run", cmds, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Argv[0] != "platform-cmd" {
		t.Errorf("expected platform-cmd, got %q", plan.Argv[0])
	}
}

func TestResolve_sequential_withSetStep(t *testing.T) {
	cmds := commands.CommandMap{
		"ci": {
			Kind:  commands.KindSequential,
			Steps: []string{"ENV=prod", "echo done"},
		},
	}
	cfg := makeConfig(map[string]string{})
	plan, err := Resolve("ci", cmds, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Kind != commands.KindSequential {
		t.Errorf("expected sequential")
	}
	if len(plan.Steps) != 2 {
		t.Fatalf("expected 2 steps, got %d", len(plan.Steps))
	}
	// First step is KEY=VALUE
	if plan.Steps[0].SetVars == nil {
		t.Error("expected SetVars for KEY=VALUE step")
	}
	if plan.Steps[0].SetVars["ENV"] != "prod" {
		t.Errorf("expected ENV=prod, got %v", plan.Steps[0].SetVars)
	}
}

func TestResolve_sequential_withAliasRef(t *testing.T) {
	cmds := commands.CommandMap{
		"build": {Kind: commands.KindSingle, Cmd: []string{"go", "build", "./..."}},
		"ci": {
			Kind:  commands.KindSequential,
			Steps: []string{"build", "go test ./..."},
		},
	}
	cfg := makeConfig(map[string]string{})
	plan, err := Resolve("ci", cmds, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Steps) != 2 {
		t.Fatalf("expected 2 steps (inline expanded alias), got %d", len(plan.Steps))
	}
	// First step is the inlined build alias
	if len(plan.Steps[0].Argv) == 0 || plan.Steps[0].Argv[0] != "go" {
		t.Errorf("expected inlined build argv, got %v", plan.Steps[0].Argv)
	}
}

func TestResolve_parallel_defaultFailMode(t *testing.T) {
	cmds := commands.CommandMap{
		"all": {
			Kind:  commands.KindParallel,
			Group: []string{"go build ./...", "go vet ./..."},
		},
	}
	cfg := makeConfig(map[string]string{})
	plan, err := Resolve("all", cmds, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if plan.FailMode != "fast" {
		t.Errorf("expected default failMode=fast, got %q", plan.FailMode)
	}
	if len(plan.Group) != 2 {
		t.Errorf("expected 2 group entries, got %d", len(plan.Group))
	}
}

func TestResolve_depthCap(t *testing.T) {
	// Build a chain: a->b->c->...->k (11 levels deep)
	cmds := commands.CommandMap{}
	for i := 0; i <= 11; i++ {
		name := string(rune('a' + i))
		next := string(rune('a' + i + 1))
		cmds[name] = commands.CommandDef{
			Kind:  commands.KindSequential,
			Steps: []string{next},
		}
	}
	// leaf
	cmds[string(rune('a'+12))] = commands.CommandDef{
		Kind: commands.KindSingle,
		Cmd:  []string{"echo", "leaf"},
	}
	_, err := Resolve("a", cmds, makeConfig(nil))
	if err == nil {
		t.Fatal("expected depth cap error")
	}
}

func TestResolve_unknownAlias(t *testing.T) {
	cmds := commands.CommandMap{}
	_, err := Resolve("nonexistent", cmds, makeConfig(nil))
	if err == nil {
		t.Fatal("expected error for unknown alias")
	}
}
