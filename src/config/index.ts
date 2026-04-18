// src/config/index.ts
//
// 4-layer YAML config loader (Phase 2 implementation).

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { ConfigReadError, MachineConfigInvalidError, YamlParseError } from '../errors.js';
import type { ConfigLayer, ConfigLoader, ResolvedConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively list all .yml/.yaml files in a directory tree, sorted alphabetically
 * by their full path. Returns absolute paths.
 */
function listYamlFilesRecursive(dirPath: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }
  for (const entry of entries.sort()) {
    const full = join(dirPath, entry);
    try {
      if (statSync(full).isDirectory()) {
        results.push(...listYamlFilesRecursive(full));
      } else if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
        results.push(full);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results;
}

/**
 * Check whether a path is an existing directory.
 */
function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

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
    } else if (Array.isArray(value)) {
      // Serialize arrays as JSON strings so modifiers (|map:, |join:) can parse them
      result[fullKey] = JSON.stringify(value);
    } else {
      // D-04: non-string leaf (number, boolean, null)
      const actualType = value === null ? 'null' : typeof value;
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
      throw new YamlParseError(filePath, line, err, raw);
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
  projectRoot?: string,
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

  // Inject builtins before interpolation so ${XCI_PROJECT_PATH} works in config files
  if (projectRoot) {
    values['xci.project.path'] = projectRoot;
    values['XCI_PROJECT_PATH'] = projectRoot;
  }

  // Build secretKeys from final provenance (A1: final-provenance semantics).
  // A key overridden by local is NOT secret-tagged even if it was in secrets.yml.
  const secretKeys = new Set<string>();
  for (const [key, layer] of Object.entries(provenance)) {
    if (layer === 'secrets') {
      secretKeys.add(key);
    }
  }

  // Interpolate ${key} references across config values (after merge, before freeze)
  const interpolated = interpolateValues(values);

  return {
    values: Object.freeze(interpolated),
    provenance: Object.freeze(provenance),
    secretKeys: Object.freeze(secretKeys),
  };
}

// ---------------------------------------------------------------------------
// Config value interpolation
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\$\$\{[^}]+\}|\$\{([^}]+)\}/g;

/**
 * Resolve ${key} placeholders in config values using other config values.
 * Supports transitive references (a → b → c). Detects circular references.
 * Escape with $${key} to produce a literal ${key}.
 */
function interpolateValues(values: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};
  const resolving = new Set<string>(); // cycle detection

  function resolve(key: string): string {
    if (Object.hasOwn(resolved, key)) return resolved[key];
    if (resolving.has(key)) {
      throw new YamlParseError(
        '<config>',
        undefined,
        new Error(`Circular interpolation: "${key}" references itself through ${[...resolving].join(' → ')}`),
      );
    }
    const raw = values[key];
    if (raw === undefined) return '';
    // No placeholders → fast path
    if (!raw.includes('${')) {
      resolved[key] = raw;
      return raw;
    }
    resolving.add(key);
    const result = raw.replace(PLACEHOLDER_RE, (match, refKey?: string) => {
      if (refKey === undefined) {
        // $${ ... } → literal ${ ... }
        return match.slice(1);
      }
      if (!Object.hasOwn(values, refKey)) {
        // Unknown key — leave as-is (will be caught later at command resolution if needed)
        return match;
      }
      return resolve(refKey);
    });
    resolving.delete(key);
    resolved[key] = result;
    return result;
  }

  for (const key of Object.keys(values)) {
    resolve(key);
  }
  return resolved;
}

/**
 * Check whether .xci/secrets.yml is tracked by git in the given working directory.
 * Returns true if tracked (warning required), false if not tracked or git not available.
 * Per D-05 and CFG-09: best-effort check, non-blocking.
 */
function isSecretTrackedByGit(cwd: string): boolean {
  try {
    execSync('git ls-files --error-unmatch .xci/secrets.yml', { stdio: 'pipe', cwd });
    return true; // exit 0 = file IS tracked
  } catch (err: unknown) {
    // ENOENT = git not installed; any other error (exit 1 = not tracked, exit 128 = not a repo) → false
    if (isEnoent(err)) return false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Machine config directory resolution
// ---------------------------------------------------------------------------

export type MachineDirResolution =
  | { dir: string; source: 'env' | 'home' }
  | { dir: null; source: 'none' };

/**
 * Resolve which directory (if any) to use for the machine-config layer.
 *
 *   1. If XCI_MACHINE_CONFIGS is set AND points to a directory → use it.
 *   2. If XCI_MACHINE_CONFIGS is set AND does NOT point to a directory → throw.
 *   3. Otherwise, if ~/.xci/ is a directory → use it.
 *   4. Otherwise → no machine layer.
 *
 * env and isDirectoryFn are injected so unit tests can drive every branch
 * without touching process.env or the real filesystem.
 */
export function resolveMachineConfigDir(
  env: NodeJS.ProcessEnv = process.env,
  isDirectoryFn: (p: string) => boolean = isDirectory,
): MachineDirResolution {
  const envPath = env['XCI_MACHINE_CONFIGS'];
  if (envPath !== undefined && envPath !== '') {
    if (!isDirectoryFn(envPath)) {
      throw new MachineConfigInvalidError(envPath);
    }
    return { dir: envPath, source: 'env' };
  }
  const homeDir = join(homedir(), '.xci');
  if (isDirectoryFn(homeDir)) {
    return { dir: homeDir, source: 'home' };
  }
  return { dir: null, source: 'none' };
}

// ---------------------------------------------------------------------------
// ConfigLoader export
// ---------------------------------------------------------------------------

export const configLoader: ConfigLoader = {
  async load(cwd: string): Promise<ResolvedConfig> {
    const resolution = resolveMachineConfigDir(); // throws MachineConfigInvalidError on bad env
    const machineDir = resolution.dir;
    const projectPath = join(cwd, '.xci', 'config.yml');
    const secretsPath = join(cwd, '.xci', 'secrets.yml');
    const secretsDir = join(cwd, '.xci', 'secrets');
    const localPath = join(cwd, '.xci', 'local.yml');

    // Read project name from config.yml for project-aware machine loading
    let projectName: string | undefined;
    const projectResult = readLayer(projectPath, 'project');
    if (projectResult) {
      projectName = projectResult.values['project'];
    }

    // Machine config + secrets: load from root + <project>/ subdirectory of the resolved machine dir
    const machineConfigLayers: Array<{ values: Record<string, string>; layer: ConfigLayer } | null> = [];
    const machineSecretLayers: Array<{ values: Record<string, string>; layer: ConfigLayer } | null> = [];
    if (machineDir) {
      const machineDirs = [machineDir];
      if (projectName) {
        const projDir = join(machineDir, projectName);
        if (isDirectory(projDir)) {
          machineDirs.push(projDir);
        } else {
          process.stderr.write(`[xci] NOTE: machine project dir not found: ${projDir}\n`);
        }
      } else {
        process.stderr.write(`[xci] NOTE: "project" not set in config.yml — skipping project-specific machine config\n`);
      }
      let machineFilesLoaded = 0;
      for (const dir of machineDirs) {
        // Machine config.yml
        const mcFile = readLayer(join(dir, 'config.yml'), 'machine');
        if (mcFile) { machineConfigLayers.push(mcFile); machineFilesLoaded++; }
        // Machine secrets
        const msFile = readLayer(join(dir, 'secrets.yml'), 'secrets');
        if (msFile) { machineSecretLayers.push(msFile); machineFilesLoaded++; }
        const msDir = join(dir, 'secrets');
        if (isDirectory(msDir)) {
          for (const f of listYamlFilesRecursive(msDir)) {
            machineSecretLayers.push(readLayer(f, 'secrets'));
            machineFilesLoaded++;
          }
        }
      }
      if (machineFilesLoaded === 0) {
        const label = resolution.source === 'home'
          ? '~/.xci/ (home fallback)'
          : `XCI_MACHINE_CONFIGS="${machineDir}"`;
        process.stderr.write(`[xci] NOTE: ${label} — no config/secrets files found\n`);
      }
    }

    // Project secrets: .xci/secrets.yml + .xci/secrets/ (recursive)
    const projectSecretLayers: Array<{ values: Record<string, string>; layer: ConfigLayer } | null> = [];
    const secretsResult = readLayer(secretsPath, 'secrets');
    if (secretsResult) projectSecretLayers.push(secretsResult);
    if (isDirectory(secretsDir)) {
      for (const f of listYamlFilesRecursive(secretsDir)) {
        projectSecretLayers.push(readLayer(f, 'secrets'));
      }
    }

    const layers = [
      ...machineConfigLayers,    // machine config (lowest priority)
      readLayer(projectPath, 'project'),
      ...machineSecretLayers,    // machine secrets
      ...projectSecretLayers,    // project secrets
      readLayer(localPath, 'local'),
    ];

    // CFG-09: warn (not throw) if secrets.yml is git-tracked
    if (secretsResult !== null) {
      if (isSecretTrackedByGit(cwd)) {
        process.stderr.write(
          '[xci] WARNING: .xci/secrets.yml is tracked by git. Run: git rm --cached .xci/secrets.yml\n',
        );
      }
    }

    return mergeLayers(layers, cwd);
  },
};
