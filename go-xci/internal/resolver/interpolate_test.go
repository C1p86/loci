package resolver

import (
	"testing"
)

func TestInterpolateArgv_strict(t *testing.T) {
	vals := map[string]string{"NAME": "world"}
	got, err := InterpolateArgv([]string{"echo", "hello-${NAME}"}, "test", vals)
	if err != nil {
		t.Fatal(err)
	}
	if got[1] != "hello-world" {
		t.Errorf("expected hello-world, got %q", got[1])
	}
}

func TestInterpolateArgv_strictMissingError(t *testing.T) {
	vals := map[string]string{}
	_, err := InterpolateArgv([]string{"echo", "${MISSING}"}, "test", vals)
	if err == nil {
		t.Fatal("expected error for undefined placeholder")
	}
}

func TestInterpolateArgv_lenientLeavesUnknown(t *testing.T) {
	vals := map[string]string{"A": "alpha"}
	got := InterpolateArgvLenient([]string{"${A}", "${B}"}, vals)
	if got[0] != "alpha" {
		t.Errorf("expected alpha, got %q", got[0])
	}
	if got[1] != "${B}" {
		t.Errorf("expected ${B} (left as-is), got %q", got[1])
	}
}

func TestInterpolateArgv_escape(t *testing.T) {
	vals := map[string]string{}
	got, err := InterpolateArgv([]string{"$${KEY}"}, "test", vals)
	if err != nil {
		t.Fatal(err)
	}
	if got[0] != "${KEY}" {
		t.Errorf("expected literal ${KEY}, got %q", got[0])
	}
}

func TestInterpolateArgv_multiplePerToken(t *testing.T) {
	vals := map[string]string{"A": "hello", "B": "world"}
	got, err := InterpolateArgv([]string{"${A}-${B}"}, "test", vals)
	if err != nil {
		t.Fatal(err)
	}
	if got[0] != "hello-world" {
		t.Errorf("expected hello-world, got %q", got[0])
	}
}

func TestInterpolateArgv_tokenNotResplit(t *testing.T) {
	// A value with spaces must NOT cause the token to split into multiple elements.
	vals := map[string]string{"MSG": "hello world"}
	got, err := InterpolateArgv([]string{"${MSG}"}, "test", vals)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 token, got %d: %v", len(got), got)
	}
	if got[0] != "hello world" {
		t.Errorf("expected 'hello world', got %q", got[0])
	}
}
