package commands

import (
	"os"
	"path/filepath"
	"testing"
)

// -------------------------------------------------------
// Tokenize tests
// -------------------------------------------------------

func TestTokenize_basic(t *testing.T) {
	got, err := Tokenize("go build ./...", "test")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"go", "build", "./..."}
	if len(got) != len(want) {
		t.Fatalf("len mismatch: got %v want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("[%d] got %q want %q", i, got[i], want[i])
		}
	}
}

func TestTokenize_quotes(t *testing.T) {
	got, err := Tokenize(`echo "hello world"`, "test")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"echo", "hello world"}
	if len(got) != len(want) {
		t.Fatalf("len mismatch: got %v want %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("[%d] got %q want %q", i, got[i], want[i])
		}
	}
}

func TestTokenize_unclosedQuote(t *testing.T) {
	_, err := Tokenize(`echo "unclosed`, "test")
	if err == nil {
		t.Fatal("expected error for unclosed quote")
	}
}

func TestTokenize_empty(t *testing.T) {
	got, err := Tokenize("", "test")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty, got %v", got)
	}
}

// -------------------------------------------------------
// normalizeAlias tests via LoadCommands
// -------------------------------------------------------

func TestLoadCommands_bareString(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commands.yml")
	if err := os.WriteFile(path, []byte("build: go build ./...\n"), 0644); err != nil {
		t.Fatal(err)
	}
	cmds, err := LoadCommands(path)
	if err != nil {
		t.Fatal(err)
	}
	def := cmds["build"]
	if def.Kind != KindSingle {
		t.Errorf("expected single, got %v", def.Kind)
	}
	if len(def.Cmd) != 3 || def.Cmd[0] != "go" {
		t.Errorf("unexpected cmd: %v", def.Cmd)
	}
}

func TestLoadCommands_arrayForm(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commands.yml")
	yaml := "build:\n  - go\n  - build\n  - ./...\n"
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}
	cmds, err := LoadCommands(path)
	if err != nil {
		t.Fatal(err)
	}
	def := cmds["build"]
	if def.Kind != KindSingle {
		t.Errorf("expected single")
	}
	if len(def.Cmd) != 3 {
		t.Errorf("unexpected cmd len: %v", def.Cmd)
	}
}

func TestLoadCommands_singleWithCmd(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commands.yml")
	yaml := "build:\n  cmd: go build ./...\n  description: build project\n"
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}
	cmds, err := LoadCommands(path)
	if err != nil {
		t.Fatal(err)
	}
	def := cmds["build"]
	if def.Kind != KindSingle {
		t.Errorf("expected single")
	}
	if def.Description != "build project" {
		t.Errorf("unexpected description: %q", def.Description)
	}
}

func TestLoadCommands_sequential(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commands.yml")
	yaml := "ci:\n  steps:\n    - go build ./...\n    - go test ./...\n"
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}
	cmds, err := LoadCommands(path)
	if err != nil {
		t.Fatal(err)
	}
	def := cmds["ci"]
	if def.Kind != KindSequential {
		t.Errorf("expected sequential, got %v", def.Kind)
	}
	if len(def.Steps) != 2 {
		t.Errorf("expected 2 steps, got %d", len(def.Steps))
	}
}

func TestLoadCommands_parallel(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commands.yml")
	yaml := "all:\n  parallel:\n    - go build ./...\n    - go vet ./...\n  failMode: complete\n"
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}
	cmds, err := LoadCommands(path)
	if err != nil {
		t.Fatal(err)
	}
	def := cmds["all"]
	if def.Kind != KindParallel {
		t.Errorf("expected parallel, got %v", def.Kind)
	}
	if def.FailMode != "complete" {
		t.Errorf("expected failMode=complete, got %q", def.FailMode)
	}
	if len(def.Group) != 2 {
		t.Errorf("expected 2 group entries, got %d", len(def.Group))
	}
}

func TestLoadCommands_missingCmd(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commands.yml")
	yaml := "bad:\n  description: no cmd here\n"
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := LoadCommands(path)
	if err == nil {
		t.Fatal("expected error for missing cmd/steps/parallel")
	}
}

func TestLoadCommands_platformBlock(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "commands.yml")
	yaml := "run:\n  windows:\n    cmd: cmd /c run.bat\n  linux:\n    cmd: ./run.sh\n"
	if err := os.WriteFile(path, []byte(yaml), 0644); err != nil {
		t.Fatal(err)
	}
	cmds, err := LoadCommands(path)
	if err != nil {
		t.Fatal(err)
	}
	def := cmds["run"]
	if def.Kind != KindSingle {
		t.Errorf("expected single")
	}
	if len(def.Platforms) == 0 {
		t.Error("expected platforms to be set")
	}
	if _, ok := def.Platforms["windows"]; !ok {
		t.Error("expected windows platform")
	}
	if _, ok := def.Platforms["linux"]; !ok {
		t.Error("expected linux platform")
	}
}

func TestLoadCommands_missingFile(t *testing.T) {
	_, err := LoadCommands("/nonexistent/commands.yml")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}
