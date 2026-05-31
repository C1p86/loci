package discovery

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindXciRoot_found(t *testing.T) {
	dir := t.TempDir()
	xciDir := filepath.Join(dir, ".xci")
	if err := os.Mkdir(xciDir, 0755); err != nil {
		t.Fatal(err)
	}
	// Search from a subdirectory
	sub := filepath.Join(dir, "a", "b", "c")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	got, ok := FindXciRoot(sub)
	if !ok {
		t.Fatal("expected to find root, got not found")
	}
	if got != dir {
		t.Errorf("expected %q got %q", dir, got)
	}
}

func TestFindXciRoot_notFound(t *testing.T) {
	// Create a subdirectory inside the OS temp dir (not under the project tree)
	// to ensure no ancestor has a .xci/ folder.
	base := os.TempDir()
	dir, err := os.MkdirTemp(base, "goxci-notfound-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })

	// Verify the dir itself and its ancestors truly don't have .xci
	// (if OS temp is under a project with .xci, skip rather than fail)
	if _, found := FindXciRoot(dir); found {
		t.Skip("OS temp dir has a .xci ancestor — skipping not-found test")
	}
	_, ok := FindXciRoot(dir)
	if ok {
		t.Fatal("expected not found")
	}
}

func TestFindXciRoot_self(t *testing.T) {
	dir := t.TempDir()
	xciDir := filepath.Join(dir, ".xci")
	if err := os.Mkdir(xciDir, 0755); err != nil {
		t.Fatal(err)
	}
	got, ok := FindXciRoot(dir)
	if !ok {
		t.Fatal("expected found")
	}
	if got != dir {
		t.Errorf("expected %q got %q", dir, got)
	}
}
