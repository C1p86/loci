// src/commands/normalize.ts
//
// Raw YAML → typed CommandDef normalization (Phase 3).
// Converts the flexible user-facing YAML shapes into the strict CommandDef union.

import { CommandSchemaError } from '../errors.js';
import type { CommandDef, CommandMap, PlatformOverrides } from '../types.js';
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
 * Normalize an object-form alias definition.
 */
function normalizeObject(
  aliasName: string,
  obj: Record<string, unknown>,
  _filePath: string,
): CommandDef {
  // Check for steps (sequential)
  if (Object.hasOwn(obj, 'steps')) {
    const steps = validateStringArray(aliasName, obj.steps, 'steps');
    const description = typeof obj.description === 'string' ? obj.description : undefined;
    return { kind: 'sequential', steps, description };
  }

  // Check for parallel (concurrent group)
  if (Object.hasOwn(obj, 'parallel')) {
    const group = validateStringArray(aliasName, obj.parallel, 'parallel');
    const description = typeof obj.description === 'string' ? obj.description : undefined;
    return { kind: 'parallel', group, description };
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

  return { kind: 'single', cmd, description, platforms };
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
