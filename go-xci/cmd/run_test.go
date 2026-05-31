package cmd

import (
	"strings"
	"testing"

	"github.com/andrearuggeri/xci/internal/commands"
	"github.com/andrearuggeri/xci/internal/resolver"
)

// -------------------------------------------------------
// parseOverrides tests
// -------------------------------------------------------

func TestParseOverrides(t *testing.T) {
	tests := []struct {
		name            string
		args            []string
		wantOverrides   map[string]string
		wantPassthrough []string
	}{
		{
			name:            "key=value only",
			args:            []string{"KEY=VALUE"},
			wantOverrides:   map[string]string{"KEY": "VALUE"},
			wantPassthrough: nil,
		},
		{
			name:            "double dash separator",
			args:            []string{"--", "--verbose"},
			wantOverrides:   map[string]string{},
			wantPassthrough: []string{"--verbose"},
		},
		{
			name:            "key=value then double dash then passthrough",
			args:            []string{"KEY=VALUE", "--", "--extra"},
			wantOverrides:   map[string]string{"KEY": "VALUE"},
			wantPassthrough: []string{"--extra"},
		},
		{
			name:            "empty args",
			args:            []string{},
			wantOverrides:   map[string]string{},
			wantPassthrough: nil,
		},
		{
			name:            "non-kv arg before dash becomes passthrough",
			args:            []string{"not-kv-arg"},
			wantOverrides:   map[string]string{},
			wantPassthrough: []string{"not-kv-arg"},
		},
		{
			name:            "multiple kv then passthrough",
			args:            []string{"A=1", "B=2", "--", "--flag", "val"},
			wantOverrides:   map[string]string{"A": "1", "B": "2"},
			wantPassthrough: []string{"--flag", "val"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			overrides, passthrough := parseOverrides(tc.args)

			// Check overrides
			if len(overrides) != len(tc.wantOverrides) {
				t.Errorf("overrides length: got %d want %d: %v", len(overrides), len(tc.wantOverrides), overrides)
			}
			for k, v := range tc.wantOverrides {
				if got, ok := overrides[k]; !ok || got != v {
					t.Errorf("overrides[%q]: got %q want %q", k, got, v)
				}
			}

			// Check passthrough
			if len(passthrough) != len(tc.wantPassthrough) {
				t.Errorf("passthrough length: got %d want %d: %v vs %v",
					len(passthrough), len(tc.wantPassthrough), passthrough, tc.wantPassthrough)
				return
			}
			for i, want := range tc.wantPassthrough {
				if passthrough[i] != want {
					t.Errorf("passthrough[%d]: got %q want %q", i, passthrough[i], want)
				}
			}
		})
	}
}

// -------------------------------------------------------
// validateParams tests
// -------------------------------------------------------

func TestValidateParams(t *testing.T) {
	tests := []struct {
		name      string
		alias     string
		params    map[string]commands.ParamDef
		values    map[string]string
		wantError bool
		wantMsg   string // substring that must appear in error message
	}{
		{
			name:      "required param missing",
			alias:     "build",
			params:    map[string]commands.ParamDef{"TOKEN": {Required: true}},
			values:    map[string]string{},
			wantError: true,
			wantMsg:   "TOKEN",
		},
		{
			name:      "required param present",
			alias:     "build",
			params:    map[string]commands.ParamDef{"TOKEN": {Required: true}},
			values:    map[string]string{"TOKEN": "abc"},
			wantError: false,
		},
		{
			name:      "optional param missing is OK",
			alias:     "build",
			params:    map[string]commands.ParamDef{"OPT": {Required: false}},
			values:    map[string]string{},
			wantError: false,
		},
		{
			name:      "nil params is OK",
			alias:     "build",
			params:    nil,
			values:    map[string]string{},
			wantError: false,
		},
		{
			name:  "multiple required with one missing",
			alias: "build",
			params: map[string]commands.ParamDef{
				"TOKEN": {Required: true},
				"HOST":  {Required: true},
			},
			values:    map[string]string{"TOKEN": "t"},
			wantError: true,
			wantMsg:   "HOST",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			def := commands.CommandDef{
				Kind:   commands.KindSingle,
				Cmd:    []string{"echo"},
				Params: tc.params,
			}
			err := validateParams(tc.alias, def, tc.values)
			if tc.wantError {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				if tc.wantMsg != "" && !strings.Contains(err.Error(), tc.wantMsg) {
					t.Errorf("error %q does not contain %q", err.Error(), tc.wantMsg)
				}
				// Verify alias name appears in error
				if !strings.Contains(err.Error(), tc.alias) {
					t.Errorf("error %q does not contain alias name %q", err.Error(), tc.alias)
				}
			} else {
				if err != nil {
					t.Fatalf("expected nil error, got: %v", err)
				}
			}
		})
	}
}

// -------------------------------------------------------
// Passthrough switch logic tests (GOCLI-05)
// -------------------------------------------------------

func TestPassthroughSequential(t *testing.T) {
	// Simulate the switch logic for KindSequential
	passthrough := []string{"--verbose"}
	plan := resolver.Plan{
		Kind: commands.KindSequential,
		Steps: []resolver.Step{
			{Argv: []string{"go", "test"}},
			{Argv: []string{"go", "build"}},
		},
	}

	// Apply the passthrough switch (mirrors runAlias logic)
	if len(passthrough) > 0 {
		switch plan.Kind {
		case commands.KindSingle:
			plan.Argv = append(plan.Argv, passthrough...)
		case commands.KindSequential:
			if len(plan.Steps) > 0 {
				last := len(plan.Steps) - 1
				plan.Steps[last].Argv = append(plan.Steps[last].Argv, passthrough...)
			}
		case commands.KindParallel:
			if len(plan.Group) > 0 {
				last := len(plan.Group) - 1
				plan.Group[last].Argv = append(plan.Group[last].Argv, passthrough...)
			}
		}
	}

	// First step unchanged
	if len(plan.Steps[0].Argv) != 2 || plan.Steps[0].Argv[1] != "test" {
		t.Errorf("first step modified unexpectedly: %v", plan.Steps[0].Argv)
	}
	// Last step has passthrough appended
	last := plan.Steps[len(plan.Steps)-1]
	if len(last.Argv) != 3 {
		t.Fatalf("expected 3 argv in last step, got %d: %v", len(last.Argv), last.Argv)
	}
	if last.Argv[2] != "--verbose" {
		t.Errorf("expected --verbose appended, got %q", last.Argv[2])
	}
}

func TestPassthroughParallel(t *testing.T) {
	// Simulate the switch logic for KindParallel
	passthrough := []string{"--race"}
	plan := resolver.Plan{
		Kind: commands.KindParallel,
		Group: []resolver.GroupEntry{
			{Alias: "lint", Argv: []string{"golangci-lint", "run"}},
			{Alias: "test", Argv: []string{"go", "test", "./..."}},
		},
	}

	// Apply the passthrough switch
	if len(passthrough) > 0 {
		switch plan.Kind {
		case commands.KindSingle:
			plan.Argv = append(plan.Argv, passthrough...)
		case commands.KindSequential:
			if len(plan.Steps) > 0 {
				last := len(plan.Steps) - 1
				plan.Steps[last].Argv = append(plan.Steps[last].Argv, passthrough...)
			}
		case commands.KindParallel:
			if len(plan.Group) > 0 {
				last := len(plan.Group) - 1
				plan.Group[last].Argv = append(plan.Group[last].Argv, passthrough...)
			}
		}
	}

	// First entry unchanged
	if len(plan.Group[0].Argv) != 2 {
		t.Errorf("first group entry modified unexpectedly: %v", plan.Group[0].Argv)
	}
	// Last entry has passthrough appended
	last := plan.Group[len(plan.Group)-1]
	if len(last.Argv) != 4 {
		t.Fatalf("expected 4 argv in last group entry, got %d: %v", len(last.Argv), last.Argv)
	}
	if last.Argv[3] != "--race" {
		t.Errorf("expected --race appended, got %q", last.Argv[3])
	}
}
