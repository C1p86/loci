// src/commands/normalize.ts
//
// Raw YAML → typed CommandDef normalization (Phase 3).
// Converts the flexible user-facing YAML shapes into the strict CommandDef union.

import { CommandSchemaError } from '../errors.js';
import type { CaptureConfig, CaptureType, CommandDef, CommandMap, ParamDef, PlatformOverrides } from '../types.js';
import { tokenize } from './tokenize.js';

/**
 * Validate that a value is an array of strings. Returns the validated array.
 * Throws CommandSchemaError if the value is not an array or contains non-strings.
 */
function validateStringArray(
  aliasName: string,
  value: unknown,
  fieldName: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new CommandSchemaError(aliasName, `${fieldName} must be an array`);
  }
  for (const item of value) {
    if (typeof item !== 'string') {
      const actualType = item === null ? 'null' : typeof item;
      throw new CommandSchemaError(
        aliasName,
        `${fieldName} must contain only strings, got ${actualType}`,
      );
    }
  }
  return value as readonly string[];
}

/**
 * Normalize a platform override block (linux:/windows:/macos: sub-object).
 * Each platform block must have a `cmd` key that is a string or string array.
 */
function normalizePlatformBlock(
  aliasName: string,
  platformKey: string,
  block: unknown,
): readonly string[] {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    throw new CommandSchemaError(
      aliasName,
      `platform override "${platformKey}" must be an object with a cmd field`,
    );
  }
  const blockObj = block as Record<string, unknown>;
  const cmd = blockObj.cmd;
  if (cmd === undefined) {
    throw new CommandSchemaError(
      aliasName,
      `platform override "${platformKey}" must have a cmd field`,
    );
  }
  if (typeof cmd === 'string') {
    return tokenize(cmd, aliasName);
  }
  if (Array.isArray(cmd)) {
    return validateStringArray(aliasName, cmd, `${platformKey}.cmd`);
  }
  throw new CommandSchemaError(
    aliasName,
    `platform override "${platformKey}.cmd" must be a string or array of strings`,
  );
}

/**
 * Normalize a params block: Record<string, { required?, default?, description? }>
 */
function normalizeParams(
  aliasName: string,
  raw: unknown,
): Readonly<Record<string, ParamDef>> | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CommandSchemaError(aliasName, 'params must be an object of { paramName: { required?, default?, description? } }');
  }
  const result: Record<string, ParamDef> = {};
  for (const [name, def] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof def === 'string') {
      // Shorthand: params: { BuildVersion: "required" }
      if (def === 'required') {
        result[name] = { required: true };
      } else {
        // Treat as default value
        result[name] = { default: def };
      }
      continue;
    }
    if (typeof def === 'object' && def !== null && !Array.isArray(def)) {
      const obj = def as Record<string, unknown>;
      const param: { required?: boolean; default?: string; description?: string } = {};
      if (obj.required !== undefined) {
        if (typeof obj.required !== 'boolean') {
          throw new CommandSchemaError(aliasName, `params.${name}.required must be a boolean`);
        }
        param.required = obj.required;
      }
      if (obj.default !== undefined) {
        if (typeof obj.default !== 'string') {
          throw new CommandSchemaError(aliasName, `params.${name}.default must be a string`);
        }
        param.default = obj.default;
      }
      if (obj.description !== undefined) {
        if (typeof obj.description !== 'string') {
          throw new CommandSchemaError(aliasName, `params.${name}.description must be a string`);
        }
        param.description = obj.description;
      }
      result[name] = param;
      continue;
    }
    throw new CommandSchemaError(aliasName, `params.${name} must be "required", a default value string, or an object { required?, default?, description? }`);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Normalize an object-form alias definition.
 */
function normalizeObject(
  aliasName: string,
  obj: Record<string, unknown>,
  _filePath: string,
): CommandDef {
  // Check for ini (file manipulation)
  if (Object.hasOwn(obj, 'ini')) {
    const raw = obj.ini;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new CommandSchemaError(aliasName, 'ini must be an object with { file, set?, delete? }');
    }
    const ini = raw as Record<string, unknown>;
    if (typeof ini.file !== 'string') {
      throw new CommandSchemaError(aliasName, 'ini.file must be a string (path to INI file)');
    }
    const mode = ini.mode ?? 'overwrite';
    if (mode !== 'overwrite' && mode !== 'merge') {
      throw new CommandSchemaError(aliasName, 'ini.mode must be "overwrite" or "merge"');
    }

    // Validate set: Record<string, Record<string, string>>
    let set: Record<string, Record<string, string>> | undefined;
    if (ini.set !== undefined) {
      if (typeof ini.set !== 'object' || ini.set === null || Array.isArray(ini.set)) {
        throw new CommandSchemaError(aliasName, 'ini.set must be an object of { section: { key: value } }');
      }
      set = {};
      for (const [section, keys] of Object.entries(ini.set as Record<string, unknown>)) {
        if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
          throw new CommandSchemaError(aliasName, `ini.set["${section}"] must be an object of { key: value }`);
        }
        set[section] = {};
        for (const [k, v] of Object.entries(keys as Record<string, unknown>)) {
          if (typeof v !== 'string') {
            throw new CommandSchemaError(aliasName, `ini.set["${section}"]["${k}"] must be a string`);
          }
          set[section][k] = v;
        }
      }
    }

    // Validate delete: Record<string, string[]>
    let del: Record<string, string[]> | undefined;
    if (ini.delete !== undefined) {
      if (typeof ini.delete !== 'object' || ini.delete === null || Array.isArray(ini.delete)) {
        throw new CommandSchemaError(aliasName, 'ini.delete must be an object of { section: [keys] }');
      }
      del = {};
      for (const [section, keys] of Object.entries(ini.delete as Record<string, unknown>)) {
        if (!Array.isArray(keys)) {
          throw new CommandSchemaError(aliasName, `ini.delete["${section}"] must be an array of key names`);
        }
        del[section] = keys as string[];
      }
    }

    if (!set && !del) {
      throw new CommandSchemaError(aliasName, 'ini must have at least one of: set, delete');
    }

    const description = typeof obj.description === 'string' ? obj.description : undefined;
    const params = normalizeParams(aliasName, obj.params);

    return {
      kind: 'ini',
      file: ini.file,
      mode: mode as 'overwrite' | 'merge',
      ...(set !== undefined ? { set } : {}),
      ...(del !== undefined ? { delete: del } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(params !== undefined ? { params } : {}),
    };
  }

  // Check for for_each (loop)
  if (Object.hasOwn(obj, 'for_each')) {
    const raw = obj.for_each;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new CommandSchemaError(aliasName, 'for_each must be an object with { var, in, cmd|run }');
    }
    const fe = raw as Record<string, unknown>;
    if (typeof fe.var !== 'string') {
      throw new CommandSchemaError(aliasName, 'for_each.var must be a string (loop variable name)');
    }
    let inField: readonly string[] | string;
    if (Array.isArray(fe.in)) {
      for (const v of fe.in) {
        if (typeof v !== 'string') {
          throw new CommandSchemaError(aliasName, 'for_each.in must contain only strings');
        }
      }
      inField = fe.in as readonly string[];
    } else if (typeof fe.in === 'string') {
      if (!/\$\{[^}]+\}/.test(fe.in)) {
        throw new CommandSchemaError(aliasName, 'for_each.in as string must reference a variable via ${...}');
      }
      inField = fe.in;
    } else {
      throw new CommandSchemaError(aliasName, 'for_each.in must be an array of strings OR a "${var}" placeholder string');
    }
    const mode = fe.mode ?? 'steps';
    if (mode !== 'steps' && mode !== 'parallel') {
      throw new CommandSchemaError(aliasName, 'for_each.mode must be "steps" or "parallel"');
    }
    if (!fe.cmd && !fe.run) {
      throw new CommandSchemaError(aliasName, 'for_each must have cmd or run');
    }
    let cmd: readonly string[] | undefined;
    if (fe.cmd !== undefined) {
      if (typeof fe.cmd === 'string') {
        cmd = tokenize(fe.cmd, aliasName);
      } else if (Array.isArray(fe.cmd)) {
        cmd = validateStringArray(aliasName, fe.cmd, 'for_each.cmd');
      } else {
        throw new CommandSchemaError(aliasName, 'for_each.cmd must be a string or array');
      }
    }
    const run = typeof fe.run === 'string' ? fe.run : undefined;
    const description = typeof obj.description === 'string' ? obj.description : undefined;

    let failMode: 'fast' | 'complete' | undefined;
    if (fe.failMode !== undefined) {
      if (fe.failMode !== 'fast' && fe.failMode !== 'complete') {
        throw new CommandSchemaError(aliasName, 'for_each.failMode must be "fast" or "complete"');
      }
      failMode = fe.failMode;
    }

    const params = normalizeParams(aliasName, obj.params);

    return {
      kind: 'for_each',
      var: fe.var,
      in: inField,
      mode: mode as 'steps' | 'parallel',
      ...(cmd !== undefined ? { cmd } : {}),
      ...(run !== undefined ? { run } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(failMode !== undefined ? { failMode } : {}),
      ...(params !== undefined ? { params } : {}),
    };
  }

  // Check for steps (sequential)
  if (Object.hasOwn(obj, 'steps')) {
    const steps = validateStringArray(aliasName, obj.steps, 'steps');
    const description = typeof obj.description === 'string' ? obj.description : undefined;
    const params = normalizeParams(aliasName, obj.params);
    return { kind: 'sequential', steps, ...(description !== undefined ? { description } : {}), ...(params !== undefined ? { params } : {}) };
  }

  // Check for parallel (concurrent group)
  if (Object.hasOwn(obj, 'parallel')) {
    const group = validateStringArray(aliasName, obj.parallel, 'parallel');
    const description = typeof obj.description === 'string' ? obj.description : undefined;

    // D-15: failMode validation
    let failMode: 'fast' | 'complete' | undefined;
    if (Object.hasOwn(obj, 'failMode')) {
      const raw = obj.failMode;
      if (raw !== 'fast' && raw !== 'complete') {
        throw new CommandSchemaError(
          aliasName,
          `failMode must be "fast" or "complete", got "${String(raw)}"`,
        );
      }
      failMode = raw;
    }

    const params = normalizeParams(aliasName, obj.params);

    return {
      kind: 'parallel',
      group,
      ...(description !== undefined ? { description } : {}),
      ...(failMode !== undefined ? { failMode } : {}),
      ...(params !== undefined ? { params } : {}),
    };
  }

  // Single command (cmd + optional description + optional platform overrides)
  const description = typeof obj.description === 'string' ? obj.description : undefined;

  // Build platform overrides
  const platformKeys = ['linux', 'windows', 'macos'] as const;
  let platforms: PlatformOverrides | undefined;

  for (const platform of platformKeys) {
    if (Object.hasOwn(obj, platform)) {
      if (platforms === undefined) {
        platforms = {};
      }
      const platformCmd = normalizePlatformBlock(aliasName, platform, obj[platform]);
      platforms = { ...platforms, [platform]: platformCmd };
    }
  }

  // Resolve cmd
  const rawCmd = obj.cmd;

  if (rawCmd === undefined && platforms === undefined) {
    throw new CommandSchemaError(aliasName, 'must have cmd, steps, or parallel');
  }

  let cmd: readonly string[];
  if (rawCmd === undefined) {
    // D-14: platform-only command — empty default cmd
    cmd = [];
  } else if (typeof rawCmd === 'string') {
    cmd = tokenize(rawCmd, aliasName);
  } else if (Array.isArray(rawCmd)) {
    cmd = validateStringArray(aliasName, rawCmd, 'cmd');
  } else {
    throw new CommandSchemaError(aliasName, 'cmd must be a string or array of strings');
  }

  // Optional capture: stdout → variable with optional validation
  let capture: CaptureConfig | undefined;
  if (Object.hasOwn(obj, 'capture')) {
    const raw = obj.capture;
    if (typeof raw === 'string') {
      // Simple form: capture: my_var
      capture = { var: raw };
    } else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      // Extended form: capture: { var, type, assert }
      const captureObj = raw as Record<string, unknown>;
      if (typeof captureObj.var !== 'string') {
        throw new CommandSchemaError(aliasName, 'capture.var must be a string (variable name)');
      }
      const validTypes = ['string', 'int', 'float', 'json'];
      let captureType: CaptureType | undefined;
      if (captureObj.type !== undefined) {
        if (typeof captureObj.type !== 'string' || !validTypes.includes(captureObj.type)) {
          throw new CommandSchemaError(aliasName, `capture.type must be one of: ${validTypes.join(', ')}`);
        }
        captureType = captureObj.type as CaptureType;
      }
      let assert: string | readonly string[] | undefined;
      if (captureObj.assert !== undefined) {
        if (typeof captureObj.assert === 'string') {
          assert = captureObj.assert;
        } else if (Array.isArray(captureObj.assert)) {
          for (const a of captureObj.assert) {
            if (typeof a !== 'string') {
              throw new CommandSchemaError(aliasName, 'capture.assert array must contain only strings');
            }
          }
          assert = captureObj.assert as string[];
        } else {
          throw new CommandSchemaError(aliasName, 'capture.assert must be a string or array of strings');
        }
      }
      capture = {
        var: captureObj.var,
        ...(captureType !== undefined ? { type: captureType } : {}),
        ...(assert !== undefined ? { assert } : {}),
      };
    } else {
      throw new CommandSchemaError(aliasName, 'capture must be a string or object with { var, type?, assert? }');
    }
  }

  const params = normalizeParams(aliasName, obj.params);

  return {
    kind: 'single',
    cmd,
    ...(description !== undefined ? { description } : {}),
    ...(platforms !== undefined ? { platforms } : {}),
    ...(capture !== undefined ? { capture } : {}),
    ...(params !== undefined ? { params } : {}),
  };
}

/**
 * Normalize a single alias value from raw YAML to a typed CommandDef.
 */
function normalizeAlias(aliasName: string, raw: unknown, filePath: string): CommandDef {
  // D-01: bare string shorthand
  if (typeof raw === 'string') {
    return { kind: 'single', cmd: tokenize(raw, aliasName) };
  }

  // CMD-02: array form — treat as pre-split argv
  if (Array.isArray(raw)) {
    const cmd = validateStringArray(aliasName, raw, 'array form');
    return { kind: 'single', cmd };
  }

  // Object form
  if (typeof raw === 'object' && raw !== null) {
    return normalizeObject(aliasName, raw as Record<string, unknown>, filePath);
  }

  // Anything else (null, number, boolean)
  throw new CommandSchemaError(aliasName, 'must be a string, array, or object');
}

/**
 * Normalize all aliases from raw YAML to a typed CommandMap.
 * Throws CommandSchemaError on invalid alias definitions.
 */
export function normalizeCommands(raw: Record<string, unknown>, filePath: string): CommandMap {
  const commands = new Map<string, CommandDef>();
  for (const [aliasName, value] of Object.entries(raw)) {
    commands.set(aliasName, normalizeAlias(aliasName, value, filePath));
  }
  return commands;
}
