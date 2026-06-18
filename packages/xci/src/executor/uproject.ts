// src/executor/uproject.ts
//
// Unreal Engine .uproject file manipulation for the `uproject` command kind.
// Native JSON only — no new runtime dependencies (cold-start budget).

import { readFileSync, writeFileSync } from 'node:fs';

export interface UprojectPlugin {
  Name: string;
  Enabled: boolean;
  [key: string]: unknown;
}

export interface UprojectOps {
  plugins?: {
    enable?: readonly string[];
    disable?: readonly string[];
    remove?: readonly string[];
  };
  set?: Readonly<Record<string, string>>;
}

export interface UprojectEditResult {
  json: Record<string, unknown>;
  warnings: string[];
}

/**
 * PURE function: apply plugin enable/disable/remove operations and top-level set
 * operations to a .uproject JSON object. Returns a NEW object (input is NOT mutated)
 * and a list of warning messages (do not log secret values).
 *
 * Semantics (LOCKED):
 *   - Plugins live in json.Plugins (array of { Name, Enabled, ...other }).
 *     If absent and an enable op adds one, the array is created.
 *   - enable: if entry exists → set Enabled:true (warn if already true);
 *             if absent → push { Name, Enabled: true }.
 *   - disable: if entry exists → set Enabled:false (warn if already false, preserve
 *              other fields); if absent → push { Name, Enabled: false } (creating the
 *              Plugins array if needed). UE engine plugins enabled by default are not
 *              listed in the .uproject, so disabling them requires adding an explicit
 *              { Name, Enabled: false } entry.
 *   - remove: if present → delete entry from Plugins;
 *             if absent → warn "plugin X not found (remove skipped)", no error.
 *   - set: assign each key on the top-level object. Existing key order is preserved
 *          (new keys append at end via object insertion order).
 */
export function applyUprojectEdits(
  json: Record<string, unknown>,
  ops: UprojectOps,
): UprojectEditResult {
  // Deep-clone input so it is never mutated
  const result: Record<string, unknown> = JSON.parse(JSON.stringify(json));
  const warnings: string[] = [];

  // Apply plugin operations
  const { plugins } = ops;
  if (plugins && (plugins.enable?.length || plugins.disable?.length || plugins.remove?.length)) {
    // enable
    if (plugins.enable) {
      for (const name of plugins.enable) {
        if (!Array.isArray(result.Plugins)) {
          result.Plugins = [];
        }
        const list = result.Plugins as UprojectPlugin[];
        const idx = list.findIndex((p) => p.Name === name);
        if (idx >= 0) {
          if (list[idx]!.Enabled === true) {
            warnings.push(`plugin "${name}" is already enabled`);
          } else {
            list[idx] = { ...list[idx]!, Enabled: true };
          }
        } else {
          list.push({ Name: name, Enabled: true });
        }
      }
    }

    // disable
    if (plugins.disable) {
      for (const name of plugins.disable) {
        if (!Array.isArray(result.Plugins)) {
          result.Plugins = [];
        }
        const list = result.Plugins as UprojectPlugin[];
        const idx = list.findIndex((p) => p.Name === name);
        if (idx >= 0) {
          if (list[idx]!.Enabled === false) {
            warnings.push(`plugin "${name}" is already disabled`);
          } else {
            list[idx] = { ...list[idx]!, Enabled: false };
          }
        } else {
          // Engine plugins enabled by default aren't listed — add an explicit
          // disabled entry so the plugin is actually turned off.
          list.push({ Name: name, Enabled: false });
        }
      }
    }

    // remove
    if (plugins.remove) {
      for (const name of plugins.remove) {
        if (!Array.isArray(result.Plugins)) {
          warnings.push(`plugin "${name}" not found (remove skipped)`);
          continue;
        }
        const list = result.Plugins as UprojectPlugin[];
        const idx = list.findIndex((p) => p.Name === name);
        if (idx >= 0) {
          list.splice(idx, 1);
        } else {
          warnings.push(`plugin "${name}" not found (remove skipped)`);
        }
      }
    }
  }

  // Apply top-level set operations
  if (ops.set) {
    for (const [key, value] of Object.entries(ops.set)) {
      result[key] = value;
    }
  }

  return { json: result, warnings };
}

/**
 * Read a .uproject file and parse it as JSON.
 * Returns the parsed object (Record<string, unknown>).
 */
export function readUproject(filePath: string): Record<string, unknown> {
  const content = readFileSync(filePath, 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Write a .uproject file with 2-space indentation and a trailing newline.
 * Uses native JSON only (no new dependency).
 */
export function writeUproject(filePath: string, json: Record<string, unknown>): void {
  writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf8');
}
