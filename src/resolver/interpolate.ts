// src/resolver/interpolate.ts
//
// Placeholder ${VAR} expansion with $${} escape support (Phase 3).
// D-05: multiple placeholders expand inline within one token.
// D-06: $${} produces literal ${} (escape syntax).
// INT-03: each token stays as one argv element (no re-splitting after interpolation).

import { UndefinedPlaceholderError } from '../errors.js';

/**
 * Regex matching either:
 * - $${...}  → escape sequence producing literal ${...} (captured group undefined)
 * - ${key}   → placeholder to be replaced with config value (captured group = key)
 */
const PLACEHOLDER_RE = /\$\$\{[^}]+\}|\$\{([^}]+)\}/g;

/**
 * Expand placeholders in a single argv token.
 * Throws UndefinedPlaceholderError if a referenced key is absent from values.
 */
function interpolateToken(
  token: string,
  aliasName: string,
  values: Readonly<Record<string, string>>,
): string {
  return token.replace(PLACEHOLDER_RE, (match, key?: string) => {
    if (key === undefined) {
      // Matched $${ ... } → strip one leading $ to produce ${ ... }
      return match.slice(1);
    }
    if (!Object.hasOwn(values, key)) {
      throw new UndefinedPlaceholderError(key, aliasName);
    }
    // key is present (hasOwn check above) — cast is safe
    return String(values[key]);
  });
}

/**
 * Interpolate all ${VAR} placeholders across every token in an argv array.
 * Returns a new readonly array with all placeholders resolved.
 */
export function interpolateArgv(
  argv: readonly string[],
  aliasName: string,
  values: Readonly<Record<string, string>>,
): readonly string[] {
  return argv.map((token) => interpolateToken(token, aliasName, values));
}
