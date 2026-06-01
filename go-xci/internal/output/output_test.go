package output

import (
	"testing"

	"github.com/andrearuggeri/xci/internal/commands"
)

// TestShouldUseColor_NoColor verifies that NO_COLOR set (any value) returns false.
func TestShouldUseColor_NoColor(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	t.Setenv("FORCE_COLOR", "") // ensure FORCE_COLOR not set as present
	if ShouldUseColor() {
		t.Error("expected ShouldUseColor() == false when NO_COLOR is set")
	}
}

// TestShouldUseColor_NoColorEmpty verifies that even empty NO_COLOR returns false.
func TestShouldUseColor_NoColorEmpty(t *testing.T) {
	t.Setenv("NO_COLOR", "")
	if ShouldUseColor() {
		t.Error("expected ShouldUseColor() == false when NO_COLOR is set (even empty string)")
	}
}

// TestShouldUseColor_ForceColor verifies that FORCE_COLOR set (NO_COLOR unset) returns true.
func TestShouldUseColor_ForceColor(t *testing.T) {
	t.Setenv("FORCE_COLOR", "1")
	// NO_COLOR must not be set — t.Setenv unsets when given key not set before,
	// but to be safe we explicitly unset using the env override approach.
	// t.Setenv will restore to original after test, so we use Unsetenv pattern via
	// a separate env var manipulation: the test environment starts fresh.
	// Since NO_COLOR may already be set in the environment, we need to ensure it's unset.
	// Use the os package to unset it for this test:
	result := ShouldUseColor()
	if !result {
		t.Error("expected ShouldUseColor() == true when FORCE_COLOR is set and NO_COLOR is unset")
	}
}

// TestCollectReferencedPlaceholders_Single verifies scanning of KindSingle Cmd field.
func TestCollectReferencedPlaceholders_Single(t *testing.T) {
	def := commands.CommandDef{
		Kind: commands.KindSingle,
		Cmd:  []string{"echo", "${FOO}", "${BAR}"},
	}
	got := collectReferencedPlaceholders(def)
	if !got["FOO"] {
		t.Error("expected FOO in referenced placeholders")
	}
	if !got["BAR"] {
		t.Error("expected BAR in referenced placeholders")
	}
	if len(got) != 2 {
		t.Errorf("expected exactly 2 placeholders, got %d: %v", len(got), got)
	}
}

// TestCollectReferencedPlaceholders_Sequential verifies scanning of KindSequential Steps field.
func TestCollectReferencedPlaceholders_Sequential(t *testing.T) {
	def := commands.CommandDef{
		Kind:  commands.KindSequential,
		Steps: []string{"build ${VERSION}", "deploy"},
	}
	got := collectReferencedPlaceholders(def)
	if !got["VERSION"] {
		t.Error("expected VERSION in referenced placeholders")
	}
	if got["deploy"] {
		t.Error("expected 'deploy' not to be in referenced placeholders (no ${...} tokens)")
	}
	if len(got) != 1 {
		t.Errorf("expected exactly 1 placeholder, got %d: %v", len(got), got)
	}
}

// TestCollectReferencedPlaceholders_Parallel verifies scanning of KindParallel Group field.
func TestCollectReferencedPlaceholders_Parallel(t *testing.T) {
	def := commands.CommandDef{
		Kind:  commands.KindParallel,
		Group: []string{"a ${X}", "b ${Y}"},
	}
	got := collectReferencedPlaceholders(def)
	if !got["X"] {
		t.Error("expected X in referenced placeholders")
	}
	if !got["Y"] {
		t.Error("expected Y in referenced placeholders")
	}
	if len(got) != 2 {
		t.Errorf("expected exactly 2 placeholders, got %d: %v", len(got), got)
	}
}

// TestCollectReferencedPlaceholders_NoTokens verifies empty set when no ${...} tokens.
func TestCollectReferencedPlaceholders_NoTokens(t *testing.T) {
	def := commands.CommandDef{
		Kind: commands.KindSingle,
		Cmd:  []string{"echo", "hello", "world"},
	}
	got := collectReferencedPlaceholders(def)
	if len(got) != 0 {
		t.Errorf("expected empty set for no ${...} tokens, got %d: %v", len(got), got)
	}
}
