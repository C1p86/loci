package config

// ConfigLayer identifies the provenance of a config value.
type ConfigLayer string

const (
	LayerMachine ConfigLayer = "machine"
	LayerProject ConfigLayer = "project"
	LayerSecrets ConfigLayer = "secrets"
	LayerLocal   ConfigLayer = "local"
)

// ResolvedConfig holds the merged config values, their provenance, and the
// set of keys whose final provenance is the secrets layer.
type ResolvedConfig struct {
	Values     map[string]string
	Provenance map[string]ConfigLayer
	SecretKeys map[string]bool
}
