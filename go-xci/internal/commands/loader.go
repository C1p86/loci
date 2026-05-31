package commands

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Tokenize splits a command string into argv tokens.
// Rules: whitespace is delimiter; double-quoted segments are a single token (quotes stripped);
// unclosed double quote returns an error.
func Tokenize(input, aliasName string) ([]string, error) {
	var tokens []string
	current := ""
	inQuotes := false

	for _, ch := range input {
		switch {
		case ch == '"':
			inQuotes = !inQuotes
		case !inQuotes && (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r'):
			if len(current) > 0 {
				tokens = append(tokens, current)
				current = ""
			}
		default:
			current += string(ch)
		}
	}

	if inQuotes {
		return nil, fmt.Errorf("%s: unclosed double quote in command string", aliasName)
	}
	if len(current) > 0 {
		tokens = append(tokens, current)
	}
	return tokens, nil
}

// validateStringSlice validates that raw is a []interface{} whose elements are all strings.
func validateStringSlice(aliasName, field string, raw interface{}) ([]string, error) {
	arr, ok := raw.([]interface{})
	if !ok {
		return nil, fmt.Errorf("%s: %s must be an array", aliasName, field)
	}
	result := make([]string, 0, len(arr))
	for _, item := range arr {
		s, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("%s: %s must contain only strings", aliasName, field)
		}
		result = append(result, s)
	}
	return result, nil
}

// normalizePlatformBlock parses a platform override block { cmd: ... }.
func normalizePlatformBlock(aliasName, platformKey string, raw interface{}) ([]string, error) {
	obj, ok := raw.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("%s: platform override %q must be an object with a cmd field", aliasName, platformKey)
	}
	cmdRaw, exists := obj["cmd"]
	if !exists {
		return nil, fmt.Errorf("%s: platform override %q must have a cmd field", aliasName, platformKey)
	}
	switch c := cmdRaw.(type) {
	case string:
		return Tokenize(c, aliasName)
	case []interface{}:
		return validateStringSlice(aliasName, platformKey+".cmd", cmdRaw)
	default:
		return nil, fmt.Errorf("%s: platform override %q.cmd must be a string or array of strings", aliasName, platformKey)
	}
}

// normalizeObject parses an object-form alias definition.
// IN SCOPE: single (cmd + platforms), sequential (steps), parallel.
// OUT OF SCOPE: ini, for_each, capture, params — return error if encountered.
func normalizeObject(aliasName string, obj map[string]interface{}) (CommandDef, error) {
	// OUT OF SCOPE checks
	if _, has := obj["ini"]; has {
		return CommandDef{}, fmt.Errorf("%s: ini aliases are not supported in the Go port", aliasName)
	}
	if _, has := obj["for_each"]; has {
		return CommandDef{}, fmt.Errorf("%s: for_each aliases are not supported in the Go port", aliasName)
	}

	description := ""
	if d, ok := obj["description"]; ok {
		if s, ok := d.(string); ok {
			description = s
		}
	}

	// Parse optional cwd
	cwd := ""
	if c, ok := obj["cwd"]; ok {
		if s, ok := c.(string); ok {
			cwd = s
		} else {
			return CommandDef{}, fmt.Errorf("%s: cwd must be a string", aliasName)
		}
	}

	// Sequential: has steps
	if stepsRaw, has := obj["steps"]; has {
		steps, err := validateStringSlice(aliasName, "steps", stepsRaw)
		if err != nil {
			return CommandDef{}, err
		}
		return CommandDef{
			Kind:        KindSequential,
			Steps:       steps,
			Description: description,
			Cwd:         cwd,
		}, nil
	}

	// Parallel: has parallel
	if parallelRaw, has := obj["parallel"]; has {
		group, err := validateStringSlice(aliasName, "parallel", parallelRaw)
		if err != nil {
			return CommandDef{}, err
		}
		failMode := ""
		if fm, has := obj["failMode"]; has {
			s, ok := fm.(string)
			if !ok || (s != "fast" && s != "complete") {
				return CommandDef{}, fmt.Errorf("%s: failMode must be \"fast\" or \"complete\"", aliasName)
			}
			failMode = s
		}
		return CommandDef{
			Kind:        KindParallel,
			Group:       group,
			FailMode:    failMode,
			Description: description,
			Cwd:         cwd,
		}, nil
	}

	// Single command: cmd + optional platform blocks
	platformKeys := []string{"linux", "windows", "macos"}
	platforms := make(map[string][]string)
	for _, pk := range platformKeys {
		if block, has := obj[pk]; has {
			argv, err := normalizePlatformBlock(aliasName, pk, block)
			if err != nil {
				return CommandDef{}, err
			}
			platforms[pk] = argv
		}
	}

	cmdRaw, hasCmdKey := obj["cmd"]
	if !hasCmdKey && len(platforms) == 0 {
		return CommandDef{}, fmt.Errorf("%s: must have cmd, steps, or parallel", aliasName)
	}

	var cmd []string
	if !hasCmdKey {
		// Platform-only command: empty default cmd
		cmd = []string{}
	} else {
		switch c := cmdRaw.(type) {
		case string:
			var err error
			cmd, err = Tokenize(c, aliasName)
			if err != nil {
				return CommandDef{}, err
			}
		case []interface{}:
			var err error
			cmd, err = validateStringSlice(aliasName, "cmd", cmdRaw)
			if err != nil {
				return CommandDef{}, err
			}
		default:
			return CommandDef{}, fmt.Errorf("%s: cmd must be a string or array of strings", aliasName)
		}
	}

	def := CommandDef{
		Kind:        KindSingle,
		Cmd:         cmd,
		Description: description,
		Cwd:         cwd,
	}
	if len(platforms) > 0 {
		def.Platforms = platforms
	}
	return def, nil
}

// normalizeAlias normalizes a single raw alias value to CommandDef.
func normalizeAlias(aliasName string, raw interface{}) (CommandDef, error) {
	switch v := raw.(type) {
	case string:
		// Bare string shorthand
		cmd, err := Tokenize(v, aliasName)
		if err != nil {
			return CommandDef{}, err
		}
		return CommandDef{Kind: KindSingle, Cmd: cmd}, nil
	case []interface{}:
		// Array form: pre-split argv
		cmd, err := validateStringSlice(aliasName, "array form", raw)
		if err != nil {
			return CommandDef{}, err
		}
		return CommandDef{Kind: KindSingle, Cmd: cmd}, nil
	case map[string]interface{}:
		return normalizeObject(aliasName, v)
	default:
		return CommandDef{}, fmt.Errorf("%s: alias must be a string, array, or object", aliasName)
	}
}

// LoadCommands reads and normalizes the commands.yml file at path.
// Missing file is an error (commands.yml is required when running an alias).
func LoadCommands(path string) (CommandMap, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read commands file %s: %w", path, err)
	}

	var rawMap map[string]interface{}
	if err := yaml.Unmarshal(data, &rawMap); err != nil {
		return nil, fmt.Errorf("%s: YAML parse error: %w", path, err)
	}
	if rawMap == nil {
		return CommandMap{}, nil
	}

	result := make(CommandMap, len(rawMap))
	for name, raw := range rawMap {
		def, err := normalizeAlias(name, raw)
		if err != nil {
			return nil, err
		}
		result[name] = def
	}
	return result, nil
}
