// src/resolver/envvars.ts
//
// Env var name transform and secrets redaction (Phase 3).
// D-07: all config keys injected as env vars (12-factor model).
// D-08: dot-notation keys mapped to UPPER_UNDERSCORE env var names.

/**
 * Transform a flat config values map into process.env-compatible key-value pairs.
 * Converts dot-notation keys to UPPER_UNDERSCORE: e.g. "deploy.host" → "DEPLOY_HOST".
 */
export function buildEnvVars(values: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [dotKey, value] of Object.entries(values)) {
    const envKey = dotKey.toUpperCase().replace(/\./g, '_');
    env[envKey] = value;
  }
  return env;
}

/**
 * Replace secret env var values with '***' for display/dry-run output.
 * secretKeys uses dot-notation (e.g. "api.key"); envVars keys are UPPER_UNDERSCORE.
 * This is for display only — never applied to actual env injection (INT-05).
 */
export function redactSecrets(
  envVars: Record<string, string>,
  secretKeys: ReadonlySet<string>,
): Record<string, string> {
  const redactedKeySet = new Set([...secretKeys].map((k) => k.toUpperCase().replace(/\./g, '_')));
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(envVars)) {
    result[k] = redactedKeySet.has(k) ? '***' : v;
  }
  return result;
}
