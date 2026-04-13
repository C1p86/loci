// src/config/index.ts
//
// 4-layer YAML config loader (Phase 2 implementation).

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { ConfigReadError, YamlParseError } from '../errors.js';
import type { ConfigLayer, ConfigLoader, ResolvedConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * Recursively flatten a nested YAML object to dot-notation keys.
 * Every leaf value must be a string (D-03, D-04). Non-string leaves throw YamlParseError.
 * Dot-key collisions (a quoted "a.b" key colliding with nested a.b path) throw YamlParseError.
 */
function flattenToStrings(
  obj: Record<string, unknown>,
  filePath: string,
  prefix = '',
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      // Dot-collision detection: a quoted key "a.b" vs nested a: { b: val }
      if (Object.hasOwn(result, fullKey)) {
        throw new YamlParseError(
          filePath,
          undefined,
          new Error(`Key collision: "${fullKey}" appears both as nested path and direct key`),
        );
      }
      result[fullKey] = value;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Recurse into nested mapping
      const nested = flattenToStrings(value as Record<string, unknown>, filePath, fullKey);
      for (const [k, v] of Object.entries(nested)) {
        // Dot-collision: nested result key collides with a previously seen flat key
        if (Object.hasOwn(result, k)) {
          throw new YamlParseError(
            filePath,
            undefined,
            new Error(`Key collision: "${k}" appears both as nested path and direct key`),
          );
        }
        result[k] = v;
      }
    } else {
      // D-04: non-string leaf (number, boolean, array, null)
      const actualType = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
      throw new YamlParseError(
        filePath,
        undefined,
        new Error(`${fullKey}: expected string, got ${actualType}`),
      );
    }
  }
  return result;
}

/**
 * Read and parse a single YAML config layer.
 * - Missing file (ENOENT): returns null (D-08)
 * - Empty file: returns { values: {}, layer } (D-07)
 * - Malformed YAML: throws YamlParseError with filename and line number (D-06, CFG-07)
 * - Non-string leaf: throws YamlParseError (D-04)
 * - Permission error: throws ConfigReadError
 */
function readLayer(
  filePath: string | undefined,
  layer: ConfigLayer,
): { values: Record<string, string>; layer: ConfigLayer } | null {
  if (filePath === undefined) return null;

  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    if (isEnoent(err)) return null; // D-08: missing = silently skip
    throw new ConfigReadError(filePath, err);
  }

  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err: unknown) {
    if (err instanceof YamlLibError) {
      const line = err.linePos?.[0]?.line;
      throw new YamlParseError(filePath, line, err);
    }
    throw err;
  }

  // D-07: null/undefined = empty file = empty layer
  if (parsed === null || parsed === undefined) {
    return { values: {}, layer };
  }

  // Root document must be a YAML mapping (object), not an array or scalar
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new YamlParseError(
      filePath,
      undefined,
      new Error('Root document must be a YAML mapping'),
    );
  }

  const values = flattenToStrings(parsed as Record<string, unknown>, filePath);
  return { values, layer };
}

/**
 * Merge up to 4 config layers in order: machine → project → secrets → local.
 * Last value wins per key (leaf-level merge, D-02).
 * Tracks provenance (CFG-06) and secretKeys (A1: final-provenance semantics).
 */
function mergeLayers(
  layers: ReadonlyArray<{ values: Record<string, string>; layer: ConfigLayer } | null>,
): ResolvedConfig {
  const values: Record<string, string> = {};
  const provenance: Record<string, ConfigLayer> = {};

  for (const entry of layers) {
    if (!entry) continue;
    for (const [key, value] of Object.entries(entry.values)) {
      values[key] = value;
      provenance[key] = entry.layer;
    }
  }

  // Build secretKeys from final provenance (A1: final-provenance semantics).
  // A key overridden by local is NOT secret-tagged even if it was in secrets.yml.
  const secretKeys = new Set<string>();
  for (const [key, layer] of Object.entries(provenance)) {
    if (layer === 'secrets') {
      secretKeys.add(key);
    }
  }

  return {
    values: Object.freeze(values),
    provenance: Object.freeze(provenance),
    secretKeys: Object.freeze(secretKeys),
  };
}

/**
 * Check whether .loci/secrets.yml is tracked by git in the given working directory.
 * Returns true if tracked (warning required), false if not tracked or git not available.
 * Per D-05 and CFG-09: best-effort check, non-blocking.
 */
function isSecretTrackedByGit(cwd: string): boolean {
  try {
    execSync('git ls-files --error-unmatch .loci/secrets.yml', { stdio: 'pipe', cwd });
    return true; // exit 0 = file IS tracked
  } catch (err: unknown) {
    // ENOENT = git not installed; any other error (exit 1 = not tracked, exit 128 = not a repo) → false
    if (isEnoent(err)) return false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// ConfigLoader export
// ---------------------------------------------------------------------------

export const configLoader: ConfigLoader = {
  async load(cwd: string): Promise<ResolvedConfig> {
    const machinePath = process.env['LOCI_MACHINE_CONFIG'];
    const projectPath = join(cwd, '.loci', 'config.yml');
    const secretsPath = join(cwd, '.loci', 'secrets.yml');
    const localPath = join(cwd, '.loci', 'local.yml');

    const layers = [
      readLayer(machinePath, 'machine'),
      readLayer(projectPath, 'project'),
      readLayer(secretsPath, 'secrets'),
      readLayer(localPath, 'local'),
    ];

    // CFG-09: warn (not throw) if secrets.yml is git-tracked
    if (layers[2] !== null) {
      if (isSecretTrackedByGit(cwd)) {
        process.stderr.write(
          '[loci] WARNING: .loci/secrets.yml is tracked by git. Run: git rm --cached .loci/secrets.yml\n',
        );
      }
    }

    return mergeLayers(layers);
  },
};
