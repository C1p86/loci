package config

import (
	"os"
	"path/filepath"
	"testing"
)

// writeFile creates a file in dir with the given name and content.
func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("writeFile %s: %v", path, err)
	}
	return path
}

// makeXciDir creates a .xci subdirectory in dir.
func makeXciDir(t *testing.T, dir string) string {
	t.Helper()
	xci := filepath.Join(dir, ".xci")
	if err := os.Mkdir(xci, 0755); err != nil {
		t.Fatalf("mkdir .xci: %v", err)
	}
	return xci
}

// -------------------------------------------------------
// flattenToStrings tests
// -------------------------------------------------------

func TestFlattenToStrings_nested(t *testing.T) {
	obj := map[string]interface{}{
		"a": map[string]interface{}{
			"b": "hello",
		},
	}
	got, err := flattenToStrings(obj, "test.yml", "")
	if err != nil {
		t.Fatal(err)
	}
	if got["a.b"] != "hello" {
		t.Errorf("expected a.b=hello, got %q", got["a.b"])
	}
}

func TestFlattenToStrings_array(t *testing.T) {
	obj := map[string]interface{}{
		"items": []interface{}{"x", "y"},
	}
	got, err := flattenToStrings(obj, "test.yml", "")
	if err != nil {
		t.Fatal(err)
	}
	if got["items"] != `["x","y"]` {
		t.Errorf("unexpected array value: %q", got["items"])
	}
}

func TestFlattenToStrings_boolError(t *testing.T) {
	obj := map[string]interface{}{
		"flag": true,
	}
	_, err := flattenToStrings(obj, "test.yml", "")
	if err == nil {
		t.Fatal("expected error for bool leaf")
	}
}

func TestFlattenToStrings_nullError(t *testing.T) {
	obj := map[string]interface{}{
		"key": nil,
	}
	_, err := flattenToStrings(obj, "test.yml", "")
	if err == nil {
		t.Fatal("expected error for null leaf")
	}
}

// -------------------------------------------------------
// Load tests
// -------------------------------------------------------

func TestLoad_lastWins(t *testing.T) {
	dir := t.TempDir()
	xci := makeXciDir(t, dir)
	writeFile(t, xci, "config.yml", "KEY: from-project\n")
	writeFile(t, xci, "local.yml", "KEY: from-local\n")

	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Values["KEY"] != "from-local" {
		t.Errorf("expected from-local, got %q", cfg.Values["KEY"])
	}
}

func TestLoad_secretKeys_finalProvenance(t *testing.T) {
	dir := t.TempDir()
	xci := makeXciDir(t, dir)
	writeFile(t, xci, "config.yml", "")
	writeFile(t, xci, "secrets.yml", "TOKEN: secret-value\n")
	// local overrides TOKEN -> final provenance is local, NOT secret
	writeFile(t, xci, "local.yml", "TOKEN: local-override\n")

	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SecretKeys["TOKEN"] {
		t.Error("TOKEN overridden by local should NOT be tagged as secret (final-provenance semantics)")
	}
}

func TestLoad_secretKeys_tagged(t *testing.T) {
	dir := t.TempDir()
	xci := makeXciDir(t, dir)
	writeFile(t, xci, "config.yml", "")
	writeFile(t, xci, "secrets.yml", "MY_TOKEN: secret-value\n")

	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.SecretKeys["MY_TOKEN"] {
		t.Error("MY_TOKEN should be tagged as secret")
	}
}

func TestLoad_selfInterpolation(t *testing.T) {
	dir := t.TempDir()
	xci := makeXciDir(t, dir)
	writeFile(t, xci, "config.yml", "base: /home/user\nfull: \"${base}/project\"\n")

	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Values["full"] != "/home/user/project" {
		t.Errorf("expected interpolated value, got %q", cfg.Values["full"])
	}
}

func TestLoad_escapedInterpolation(t *testing.T) {
	dir := t.TempDir()
	xci := makeXciDir(t, dir)
	writeFile(t, xci, "config.yml", "escaped: \"$${KEY}\"\n")

	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Values["escaped"] != "${KEY}" {
		t.Errorf("expected literal ${KEY}, got %q", cfg.Values["escaped"])
	}
}

func TestLoad_cycleDetection(t *testing.T) {
	dir := t.TempDir()
	xci := makeXciDir(t, dir)
	// a -> b -> a
	writeFile(t, xci, "config.yml", "a: \"${b}\"\nb: \"${a}\"\n")

	// Should not panic; cycle leaves the value unchanged (not throwing)
	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Values with cycle: we just verify it doesn't crash and returns something
	_ = cfg
}

func TestLoad_builtins(t *testing.T) {
	dir := t.TempDir()
	makeXciDir(t, dir)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Values["XCI_PROJECT_PATH"] != dir {
		t.Errorf("expected XCI_PROJECT_PATH=%q got %q", dir, cfg.Values["XCI_PROJECT_PATH"])
	}
}

func TestLoad_emptyFile(t *testing.T) {
	dir := t.TempDir()
	xci := makeXciDir(t, dir)
	writeFile(t, xci, "config.yml", "")

	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	_ = cfg // Just verify no error
}

func TestLoad_missingFiles(t *testing.T) {
	// No .xci/ files at all, just the dir
	dir := t.TempDir()
	makeXciDir(t, dir)

	cfg, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	_ = cfg
}
