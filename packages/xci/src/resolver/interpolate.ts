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
    if (jsonStr === undefined) continue;
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
 * Parse a placeholder key into the variable key and optional modifier.
 * E.g. "AWS.LOCATIONS|map:Location=" → { key: "AWS.LOCATIONS", modifier: "map", arg: "Location=" }
 */
function parseModifier(raw: string): { key: string; modifier?: string; arg?: string } {
  const pipeIdx = raw.indexOf('|');
  if (pipeIdx < 0) return { key: raw };
  const key = raw.substring(0, pipeIdx);
  const modPart = raw.substring(pipeIdx + 1);
  const colonIdx = modPart.indexOf(':');
  if (colonIdx < 0) return { key, modifier: modPart };
  return { key, modifier: modPart.substring(0, colonIdx), arg: modPart.substring(colonIdx + 1) };
}

/**
 * Resolve a key to its raw string value (direct lookup or JSON path).
 * Returns undefined if not found.
 */
function resolveKey(key: string, values: Readonly<Record<string, string>>): string | undefined {
  if (Object.hasOwn(values, key)) return String(values[key]);
  return resolveJsonPath(key, values);
}

/**
 * Apply a modifier to a resolved value. Returns an array of strings.
 * - map:prefix — parse value as JSON array, prepend prefix to each element
 * - join:sep — parse value as JSON array, join with separator into one string
 */
function applyModifier(value: string, modifier: string, arg: string | undefined): string[] {
  let arr: unknown[];
  try {
    const parsed = JSON.parse(value);
    arr = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    arr = [value];
  }

  switch (modifier) {
    case 'map': {
      const prefix = arg ?? '';
      return arr.map((item) => `${prefix}${String(item)}`);
    }
    case 'join': {
      const sep = arg ?? ',';
      return [arr.map((item) => String(item)).join(sep)];
    }
    default:
      return [value];
  }
}

/**
 * Single-pass placeholder replacement (strict mode).
 */
function interpolateTokenOnce(
  token: string,
  aliasName: string,
  values: Readonly<Record<string, string>>,
): string {
  return token.replace(PLACEHOLDER_RE, (match, rawKey?: string) => {
    if (rawKey === undefined) {
      return match; // $${} escapes already handled by sentinel
    }
    const { key, modifier } = parseModifier(rawKey);
    // If key contains nested ${, leave as-is for multi-pass resolution
    if (key.includes('${')) return match;
    const resolved = resolveKey(key, values);
    if (resolved !== undefined) {
      if (modifier === 'join') {
        return applyModifier(resolved, modifier, parseModifier(rawKey).arg)[0] ?? match;
      }
      return resolved;
    }
    throw new UndefinedPlaceholderError(key, aliasName);
  });
}

// Sentinel to protect $${} escapes during multi-pass resolution
const ESCAPE_SENTINEL = '\x00XCI_ESC\x00';
const ESCAPE_SENTINEL_RE = /\x00XCI_ESC\x00/g;

/**
 * Resolve innermost ${...} placeholders first (those whose key contains no nested ${}).
 * This handles ${outer.${inner}|mod} by resolving ${inner} first, then ${outer.resolved|mod}.
 */
function resolveInnermost(
  token: string,
  aliasName: string,
  values: Readonly<Record<string, string>>,
  strict: boolean,
): string {
  // Match ${...} where the content has no nested ${ (innermost placeholders)
  const INNERMOST_RE = /\$\{([^{}]+)\}/g;
  return token.replace(INNERMOST_RE, (match, rawKey: string) => {
    const { key, modifier } = parseModifier(rawKey);
    // Leave expanding modifiers (map) for expandToken to handle
    if (modifier === 'map') return match;
    const resolved = resolveKey(key, values);
    if (resolved !== undefined) {
      if (modifier === 'join') {
        return applyModifier(resolved, modifier, parseModifier(rawKey).arg)[0] ?? match;
      }
      return resolved;
    }
    if (strict) throw new UndefinedPlaceholderError(key, aliasName);
    return match;
  });
}

/**
 * Expand placeholders in a single argv token.
 * Multi-pass: resolves innermost ${} first, then outer ${} in subsequent passes.
 * Protects $${} escapes with a sentinel so they survive multi-pass.
 */
function interpolateToken(
  token: string,
  aliasName: string,
  values: Readonly<Record<string, string>>,
): string {
  // Replace $${...} escapes with sentinel before multi-pass
  let result = token.replace(/\$\$\{([^}]+)\}/g, `${ESCAPE_SENTINEL}{$1}`);
  for (let pass = 0; pass < 5; pass++) {
    const next = resolveInnermost(result, aliasName, values, true);
    if (next === result) break;
    result = next;
  }
  // Restore sentinels to literal ${...}
  return result.replace(ESCAPE_SENTINEL_RE, '$');
}

/**
 * Check if a token contains an expanding modifier (map) that needs special handling.
 * Uses simple string check since nested ${} makes regex unreliable.
 */
function hasExpandingModifier(token: string): boolean {
  return token.includes('|map:');
}

/**
 * Expand a token with a map modifier into multiple argv entries.
 * Resolves inner placeholders first via lenient multi-pass before expanding.
 */
function expandToken(
  token: string,
  aliasName: string,
  values: Readonly<Record<string, string>>,
): string[] {
  // Protect $${} escapes
  let resolved = token.replace(/\$\$\{([^}]+)\}/g, `${ESCAPE_SENTINEL}{$1}`);
  for (let pass = 0; pass < 5; pass++) {
    // Check if we have a clean ${key|map:...} ready to expand
    const m = /^\$\{([^{}]+)\}$/.exec(resolved);
    if (m && m[1] && m[1].includes('|map:')) {
      const { key, modifier, arg } = parseModifier(m[1]);
      const val = resolveKey(key, values);
      if (val === undefined) {
        throw new UndefinedPlaceholderError(key, aliasName);
      }
      return applyModifier(val, modifier!, arg);
    }
    // Resolve innermost placeholders first (e.g. ${Group} inside ${AWS.${Group}|map:X})
    const next = resolveInnermost(resolved, aliasName, values, false);
    if (next === resolved) break;
    resolved = next;
  }
  // Fallback: no expanding modifier found after resolution
  return [resolved.replace(ESCAPE_SENTINEL_RE, '$')];
}

/**
 * Interpolate all ${VAR} placeholders across every token in an argv array.
 * Tokens with expanding modifiers (map) may produce multiple argv entries.
 * Returns a new readonly array with all placeholders resolved.
 */
export function interpolateArgv(
  argv: readonly string[],
  aliasName: string,
  values: Readonly<Record<string, string>>,
): readonly string[] {
  const result: string[] = [];
  for (const token of argv) {
    if (hasExpandingModifier(token)) {
      result.push(...expandToken(token, aliasName, values));
    } else {
      result.push(interpolateToken(token, aliasName, values));
    }
  }
  return result;
}

/**
 * Single-pass lenient placeholder replacement.
 */
function interpolateTokenLenientOnce(
  token: string,
  values: Readonly<Record<string, string>>,
): string {
  return token.replace(PLACEHOLDER_RE, (match, rawKey?: string) => {
    if (rawKey === undefined) {
      return match; // $${} escapes already handled by sentinel
    }
    const { key, modifier } = parseModifier(rawKey);
    const resolved = resolveKey(key, values);
    if (resolved !== undefined) {
      if (modifier === 'join') {
        return applyModifier(resolved, modifier, parseModifier(rawKey).arg)[0] ?? match;
      }
      return resolved;
    }
    return match;
  });
}

/**
 * Lenient interpolation: resolve known placeholders, leave unknown ones as ${key}.
 * Multi-pass: resolves innermost ${} first, then outer ${} in subsequent passes.
 */
function interpolateTokenLenient(
  token: string,
  values: Readonly<Record<string, string>>,
): string {
  let result = token.replace(/\$\$\{([^}]+)\}/g, `${ESCAPE_SENTINEL}{$1}`);
  for (let pass = 0; pass < 5; pass++) {
    const next = resolveInnermost(result, '(lenient)', values, false);
    if (next === result) break;
    result = next;
  }
  return result.replace(ESCAPE_SENTINEL_RE, '$');
}

/**
 * Lenient interpolation for an argv array.
 * Known values are replaced, unknown ${key} are left as-is for runtime resolution.
 * Expanding modifiers (map) produce multiple entries when the value is available.
 */
export function interpolateArgvLenient(
  argv: readonly string[],
  values: Readonly<Record<string, string>>,
): readonly string[] {
  const result: string[] = [];
  for (const token of argv) {
    if (hasExpandingModifier(token)) {
      const m = /^\$\{([^}]+)\}$/.exec(token);
      if (m && m[1]) {
        const { key, modifier, arg } = parseModifier(m[1]);
        const resolved = resolveKey(key, values);
        if (resolved !== undefined && modifier) {
          result.push(...applyModifier(resolved, modifier, arg));
          continue;
        }
      }
      result.push(interpolateTokenLenient(token, values));
    } else {
      result.push(interpolateTokenLenient(token, values));
    }
  }
  return result;
}
