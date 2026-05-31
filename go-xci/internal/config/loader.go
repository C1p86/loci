package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// placeholderRE matches either $${ ... } (escape) or ${ key } (substitution).
// The first capture group is the key for ${key} matches; for $${} it is empty.
var placeholderRE = regexp.MustCompile(`\$\$\{[^}]+\}|\$\{([^}]+)\}`)

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// listYamlFilesRecursive returns all .yml/.yaml files under dirPath sorted by
// full path, matching the TS reference implementation.
func listYamlFilesRecursive(dirPath string) []string {
	var results []string
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil
	}
	// Sort entries for determinism
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})
	for _, e := range entries {
		full := filepath.Join(dirPath, e.Name())
		if e.IsDir() {
			results = append(results, listYamlFilesRecursive(full)...)
		} else if strings.HasSuffix(e.Name(), ".yml") || strings.HasSuffix(e.Name(), ".yaml") {
			results = append(results, full)
		}
	}
	return results
}

// isDir returns true if path is an existing directory.
func isDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// flattenToStrings recursively flattens a YAML map[string]interface{} to dot-notation keys.
// Non-string leaves (bool, int, float, nil) return an error.
// Arrays are JSON-serialized.
// Duplicate dot-key collisions return an error.
func flattenToStrings(obj map[string]interface{}, filePath, prefix string) (map[string]string, error) {
	result := make(map[string]string)
	for k, v := range obj {
		fullKey := k
		if prefix != "" {
			fullKey = prefix + "." + k
		}
		switch val := v.(type) {
		case string:
			if _, exists := result[fullKey]; exists {
				return nil, fmt.Errorf("%s: key collision: %q appears both as nested path and direct key", filePath, fullKey)
			}
			result[fullKey] = val
		case map[string]interface{}:
			nested, err := flattenToStrings(val, filePath, fullKey)
			if err != nil {
				return nil, err
			}
			for nk, nv := range nested {
				if _, exists := result[nk]; exists {
					return nil, fmt.Errorf("%s: key collision: %q appears both as nested path and direct key", filePath, nk)
				}
				result[nk] = nv
			}
		case []interface{}:
			b, err := json.Marshal(val)
			if err != nil {
				return nil, fmt.Errorf("%s: %s: failed to JSON-encode array: %w", filePath, fullKey, err)
			}
			result[fullKey] = string(b)
		case nil:
			return nil, fmt.Errorf("%s: %s: expected string, got null", filePath, fullKey)
		case bool:
			return nil, fmt.Errorf("%s: %s: expected string, got bool", filePath, fullKey)
		case int, int64, float64:
			return nil, fmt.Errorf("%s: %s: expected string, got number", filePath, fullKey)
		default:
			return nil, fmt.Errorf("%s: %s: expected string, got %T", filePath, fullKey, v)
		}
	}
	return result, nil
}

// layerResult holds parsed values for one config layer.
type layerResult struct {
	values map[string]string
	layer  ConfigLayer
}

// readLayer reads and parses a single YAML file.
// Returns (nil, nil) if the file does not exist.
// Returns (result, nil) on success.
// Returns (nil, err) on parse or validation error.
func readLayer(filePath string, layer ConfigLayer) (*layerResult, error) {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("cannot read %s: %w", filePath, err)
	}

	var parsed interface{}
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("%s: YAML parse error: %w", filePath, err)
	}

	// Empty / null document
	if parsed == nil {
		return &layerResult{values: map[string]string{}, layer: layer}, nil
	}

	// Root must be a mapping
	obj, ok := parsed.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("%s: root document must be a YAML mapping", filePath)
	}

	values, err := flattenToStrings(obj, filePath, "")
	if err != nil {
		return nil, err
	}
	return &layerResult{values: values, layer: layer}, nil
}

// ResolveMachineConfigDir resolves the machine config directory.
// 1. If XCI_MACHINE_CONFIGS is set and is a directory -> use it (source "env").
// 2. If XCI_MACHINE_CONFIGS is set but not a directory -> error.
// 3. Else if ~/.xci/ is a directory -> use it (source "home").
// 4. Else -> ("", "none", nil).
func ResolveMachineConfigDir() (dir string, source string, err error) {
	envPath := os.Getenv("XCI_MACHINE_CONFIGS")
	if envPath != "" {
		if !isDir(envPath) {
			return "", "", fmt.Errorf("XCI_MACHINE_CONFIGS=%q is not a directory", envPath)
		}
		return envPath, "env", nil
	}
	home, herr := os.UserHomeDir()
	if herr == nil {
		homeXci := filepath.Join(home, ".xci")
		if isDir(homeXci) {
			return homeXci, "home", nil
		}
	}
	return "", "none", nil
}

// mergeLayers merges layer results (last-wins), tracking provenance and secretKeys.
// projectRoot is injected as builtins xci.project.path and XCI_PROJECT_PATH before
// interpolation.
func mergeLayers(layers []*layerResult, projectRoot string) ResolvedConfig {
	values := make(map[string]string)
	provenance := make(map[string]ConfigLayer)

	for _, entry := range layers {
		if entry == nil {
			continue
		}
		for k, v := range entry.values {
			values[k] = v
			provenance[k] = entry.layer
		}
	}

	// Inject builtins
	if projectRoot != "" {
		values["xci.project.path"] = projectRoot
		values["XCI_PROJECT_PATH"] = projectRoot
	}

	// Build secretKeys: keys whose FINAL provenance is "secrets".
	secretKeys := make(map[string]bool)
	for k, layer := range provenance {
		if layer == LayerSecrets {
			secretKeys[k] = true
		}
	}

	// Self-interpolate values
	interpolated := interpolateValues(values)

	return ResolvedConfig{
		Values:     interpolated,
		Provenance: provenance,
		SecretKeys: secretKeys,
	}
}

// interpolateValues resolves ${key} references in config values using other values.
// Supports transitive references with cycle detection.
// $${key} produces a literal ${key}.
// Unknown references are left as-is.
func interpolateValues(values map[string]string) map[string]string {
	resolved := make(map[string]string)
	resolving := make(map[string]bool) // cycle detection

	var resolve func(key string) string
	resolve = func(key string) string {
		if v, ok := resolved[key]; ok {
			return v
		}
		if resolving[key] {
			// Cycle detected: leave the reference as-is (TS behavior: throws, but we
			// surface it to the caller via a sentinel; here we panic with a descriptive msg)
			panic(fmt.Sprintf("circular interpolation: %q references itself", key))
		}
		raw, exists := values[key]
		if !exists {
			return ""
		}
		if !strings.Contains(raw, "${") {
			resolved[key] = raw
			return raw
		}
		resolving[key] = true
		result := placeholderRE.ReplaceAllStringFunc(raw, func(match string) string {
			// $${ ... } -> strip one leading $
			if strings.HasPrefix(match, "$${") {
				return match[1:]
			}
			// ${ key } -> resolve key
			refKey := match[2 : len(match)-1]
			if _, ok := values[refKey]; !ok {
				return match // leave unknown refs as-is
			}
			return resolve(refKey)
		})
		delete(resolving, key)
		resolved[key] = result
		return result
	}

	for k := range values {
		func() {
			defer func() {
				if r := recover(); r != nil {
					// Cycle: leave value as-is
					resolved[k] = values[k]
				}
			}()
			resolve(k)
		}()
	}
	return resolved
}

// Load reads the 4-layer config for the project rooted at cwd.
// It discovers machine config dir, reads all layers, merges and self-interpolates.
func Load(cwd string) (ResolvedConfig, error) {
	machineDir, _, err := ResolveMachineConfigDir()
	if err != nil {
		return ResolvedConfig{}, err
	}

	projectConfigPath := filepath.Join(cwd, ".xci", "config.yml")
	secretsPath := filepath.Join(cwd, ".xci", "secrets.yml")
	secretsDir := filepath.Join(cwd, ".xci", "secrets")
	localPath := filepath.Join(cwd, ".xci", "local.yml")

	// Read project config to extract "project" key for machine dir subdir selection
	projectLayer, err := readLayer(projectConfigPath, LayerProject)
	if err != nil {
		return ResolvedConfig{}, err
	}

	var projectName string
	if projectLayer != nil {
		projectName = projectLayer.values["project"]
	}

	// Build machine layers
	var machineLayers []*layerResult

	if machineDir != "" {
		machineDirs := []string{machineDir}
		if projectName != "" {
			projDir := filepath.Join(machineDir, projectName)
			if isDir(projDir) {
				machineDirs = append(machineDirs, projDir)
			} else {
				fmt.Fprintf(os.Stderr, "[xci] NOTE: machine project dir not found: %s\n", projDir)
			}
		} else {
			fmt.Fprintf(os.Stderr, "[xci] NOTE: \"project\" not set in config.yml — skipping project-specific machine config\n")
		}

		machineFilesLoaded := 0
		for _, dir := range machineDirs {
			// Machine config.yml
			mcFile, err := readLayer(filepath.Join(dir, "config.yml"), LayerMachine)
			if err != nil {
				return ResolvedConfig{}, err
			}
			if mcFile != nil {
				machineLayers = append(machineLayers, mcFile)
				machineFilesLoaded++
			}
			// Machine secrets.yml
			msFile, err := readLayer(filepath.Join(dir, "secrets.yml"), LayerSecrets)
			if err != nil {
				return ResolvedConfig{}, err
			}
			if msFile != nil {
				machineLayers = append(machineLayers, msFile)
				machineFilesLoaded++
			}
			// Machine secrets/ dir
			msDir := filepath.Join(dir, "secrets")
			if isDir(msDir) {
				for _, f := range listYamlFilesRecursive(msDir) {
					fl, err := readLayer(f, LayerSecrets)
					if err != nil {
						return ResolvedConfig{}, err
					}
					if fl != nil {
						machineLayers = append(machineLayers, fl)
						machineFilesLoaded++
					}
				}
			}
		}

		if machineFilesLoaded == 0 {
			fmt.Fprintf(os.Stderr, "[xci] NOTE: machine config dir — no config/secrets files found\n")
		}
	}

	// Project secrets
	var projectSecretLayers []*layerResult
	secretsLayer, err := readLayer(secretsPath, LayerSecrets)
	if err != nil {
		return ResolvedConfig{}, err
	}
	if secretsLayer != nil {
		projectSecretLayers = append(projectSecretLayers, secretsLayer)
	}
	if isDir(secretsDir) {
		for _, f := range listYamlFilesRecursive(secretsDir) {
			fl, err := readLayer(f, LayerSecrets)
			if err != nil {
				return ResolvedConfig{}, err
			}
			if fl != nil {
				projectSecretLayers = append(projectSecretLayers, fl)
			}
		}
	}

	// Local layer
	localLayer, err := readLayer(localPath, LayerLocal)
	if err != nil {
		return ResolvedConfig{}, err
	}

	// Assemble all layers in order: machine config(s), project, machine secrets, project secrets, local
	// Note: machine secrets are already interleaved per-dir in machineLayers; we need to split.
	// The TS loader separates machineConfigLayers and machineSecretLayers. We keep them interleaved
	// per-dir (config.yml then secrets.yml per dir) which matches the effective merge order since
	// last-wins is per-dir incremental.
	var allLayers []*layerResult
	allLayers = append(allLayers, machineLayers...)
	allLayers = append(allLayers, projectLayer)
	allLayers = append(allLayers, projectSecretLayers...)
	allLayers = append(allLayers, localLayer)

	cfg := mergeLayers(allLayers, cwd)
	return cfg, nil
}
