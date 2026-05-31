package resolver

import (
	"fmt"
	"regexp"
	"strings"
)

// placeholderRE matches $${key} (escape) or ${key} (substitution).
var placeholderRE = regexp.MustCompile(`\$\$\{[^}]+\}|\$\{([^}]+)\}`)

// escapeSentinel is used to protect $${} escapes during processing.
const escapeSentinel = "\x00XCI_ESC\x00"

// interpolateToken resolves ${KEY} placeholders in a single argv token.
// strict=true: missing key returns an error.
// strict=false: missing key is left as ${KEY}.
// $${KEY} -> literal ${KEY} in both modes.
// Token is NOT re-split after interpolation (values with spaces stay one element).
func interpolateToken(token string, aliasName string, values map[string]string, strict bool) (string, error) {
	// Protect $${...} escapes with sentinel
	result := strings.ReplaceAll(token, "$${", escapeSentinel+"{")

	var resolveErr error
	resolved := placeholderRE.ReplaceAllStringFunc(result, func(match string) string {
		if resolveErr != nil {
			return match
		}
		// escapeSentinel{...} is NOT a real placeholder; handled after
		// but actually we replaced $${x} with sentinel{x} which does not match ${x}
		// so this callback only fires for ${key} patterns
		if strings.HasPrefix(match, escapeSentinel) {
			return match
		}
		// Extract key from ${key}
		key := match[2 : len(match)-1]
		val, ok := values[key]
		if !ok {
			if strict {
				resolveErr = fmt.Errorf("%s: undefined placeholder ${%s}", aliasName, key)
				return match
			}
			return match // lenient: leave as-is
		}
		return val
	})

	if resolveErr != nil {
		return "", resolveErr
	}

	// Restore sentinel to literal ${...}
	resolved = strings.ReplaceAll(resolved, escapeSentinel+"{", "${")
	return resolved, nil
}

// interpolateTokenMultiPass resolves ${KEY} placeholders repeatedly until the
// output is stable (no more changes) or maxPasses is exhausted.
// This handles self-referencing values: if base="https://example.com" and
// url="${base}/api", then resolving "${url}" yields "${base}/api" on pass 1,
// then "https://example.com/api" on pass 2.
// Escape sequences ($${KEY}) are protected across all passes and restored once at the end.
func interpolateTokenMultiPass(token, aliasName string, values map[string]string, strict bool, maxPasses int) (string, error) {
	// Protect escape sequences for the entire multi-pass session so that
	// literals produced in pass N are not re-expanded in pass N+1.
	current := strings.ReplaceAll(token, "$${", escapeSentinel+"{")

	for pass := 0; pass < maxPasses; pass++ {
		var resolveErr error
		next := placeholderRE.ReplaceAllStringFunc(current, func(match string) string {
			if resolveErr != nil {
				return match
			}
			if strings.HasPrefix(match, escapeSentinel) {
				return match // leave escape sentinels intact
			}
			key := match[2 : len(match)-1]
			val, ok := values[key]
			if !ok {
				if strict {
					resolveErr = fmt.Errorf("%s: undefined placeholder ${%s}", aliasName, key)
					return match
				}
				return match // lenient: leave as-is
			}
			// Protect any escape sequences inside resolved values too
			return strings.ReplaceAll(val, "$${", escapeSentinel+"{")
		})
		if resolveErr != nil {
			return "", resolveErr
		}
		if next == current {
			break // stable — no remaining placeholders to expand
		}
		current = next
	}

	// Restore sentinels to literal ${ at the very end
	current = strings.ReplaceAll(current, escapeSentinel+"{", "${")
	return current, nil
}

// InterpolateArgv resolves ${KEY} placeholders across an argv array (strict mode).
// Returns an error if any placeholder key is not found in values.
// Tokens are NOT re-split; each token stays as one argv element.
func InterpolateArgv(argv []string, aliasName string, values map[string]string) ([]string, error) {
	result := make([]string, 0, len(argv))
	for _, token := range argv {
		resolved, err := interpolateTokenMultiPass(token, aliasName, values, true, 10)
		if err != nil {
			return nil, err
		}
		result = append(result, resolved)
	}
	return result, nil
}

// InterpolateArgvLenient resolves known ${KEY} placeholders; leaves unknown ones as ${KEY}.
// Never returns an error.
func InterpolateArgvLenient(argv []string, values map[string]string) []string {
	result := make([]string, 0, len(argv))
	for _, token := range argv {
		resolved, _ := interpolateTokenMultiPass(token, "", values, false, 10)
		result = append(result, resolved)
	}
	return result
}
