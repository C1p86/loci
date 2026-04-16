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
 * Try to resolve a key as a JSON path: find a base variable whose value is JSON,
 * then navigate the remaining path (e.g. [0].BuildId).
 * Returns the resolved string value, or undefined if not resolvable.
 */
function resolveJsonPath(key: string, values: Readonly<Record<string, string>>): string | undefined {
  // Find the split point: first '[' or '.' that separates base var from JSON path
  const bracketIdx = key.indexOf('[');
  const dotIdx = key.indexOf('.');

  // Try bracket first (e.g. AwsBuild[0].BuildId → base=AwsBuild, path=[0].BuildId)
  // Then try dot splits progressively (e.g. data.items.0 → base=data, path=items.0)
  const splitPoints: number[] = [];
  if (bracketIdx > 0) splitPoints.push(bracketIdx);
  for (let i = 0; i < key.length; i++) {
    if (key[i] === '.' && i > 0) splitPoints.push(i);
  }

  for (const sp of splitPoints) {
    const base = key.slice(0, sp);
    if (!Object.hasOwn(values, base)) continue;

    const jsonStr = values[base];
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      continue; // value is not JSON, try next split
    }

    // Navigate the remaining path
    const pathStr = key.slice(sp);
    const result = navigateJson(parsed, pathStr);
    if (result !== undefined) {
      return typeof result === 'string' ? result : JSON.stringify(result);
    }
  }

  return undefined;
}

/**
 * Navigate a parsed JSON value with a path like [0].BuildId or .name.
 * Supports bracket notation [N] for arrays and dot notation .key for objects.
 */
function navigateJson(value: unknown, path: string): unknown | undefined {
  let current = value;
  // Tokenize path: split into segments like [0], .BuildId, .name
  const segmentRe = /\[(\d+)\]|\.([^.[]+)/g;
  let m: RegExpExecArray | null;
  while ((m = segmentRe.exec(path)) !== null) {
    if (current === null || current === undefined) return undefined;
    if (m[1] !== undefined) {
      // Array index: [N]
      if (!Array.isArray(current)) return undefined;
      const idx = Number(m[1]);
      current = (current as unknown[])[idx];
    } else if (m[2] !== undefined) {
      // Object key: .key
      if (typeof current !== 'object' || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[m[2]];
    }
  }
  return current;
}

/**
 * Expand placeholders in a single argv token.
 * Throws UndefinedPlaceholderError if a referenced key is absent from values.
 * Supports JSON path access: ${var[0].field} navigates into JSON-valued variables.
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
    // Direct key lookup
    if (Object.hasOwn(values, key)) {
      return String(values[key]);
    }
    // JSON path resolution: ${var[0].field} or ${var.nested.key}
    const jsonResult = resolveJsonPath(key, values);
    if (jsonResult !== undefined) {
      return jsonResult;
    }
    throw new UndefinedPlaceholderError(key, aliasName);
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

/**
 * Lenient interpolation: resolve known placeholders, leave unknown ones as ${key}.
 * Used for sequential steps where some placeholders may be provided at runtime by capture.
 */
function interpolateTokenLenient(
  token: string,
  values: Readonly<Record<string, string>>,
): string {
  return token.replace(PLACEHOLDER_RE, (match, key?: string) => {
    if (key === undefined) {
      return match.slice(1); // $${ escape
    }
    if (Object.hasOwn(values, key)) {
      return String(values[key]);
    }
    // Try JSON path resolution
    const jsonResult = resolveJsonPath(key, values);
    if (jsonResult !== undefined) return jsonResult;
    return match; // leave as ${key}
  });
}

/**
 * Lenient interpolation for an argv array.
 * Known values are replaced, unknown ${key} are left as-is for runtime resolution.
 */
export function interpolateArgvLenient(
  argv: readonly string[],
  values: Readonly<Record<string, string>>,
): readonly string[] {
  return argv.map((token) => interpolateTokenLenient(token, values));
}
