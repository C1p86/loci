// src/resolver/params.ts
//
// Recursive parameter collection and validation for command chains.
// 1. Collects explicit `params` declarations and applies defaults/required rules.
// 2. Scans all ${placeholder} references in the entire command tree.
// 3. Reports undeclared+undefined placeholders as missing params before execution.

import { MissingParamsError } from '../errors.js';
import type { CommandDef, CommandMap, ParamDef } from '../types.js';

/** Matches a variable assignment step: KEY=VALUE. */
const VAR_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_.]*=/;

/** A collected parameter with merged metadata from the chain. */
interface CollectedParam {
  name: string;
  required: boolean;
  default?: string;
  description?: string;
  requiredBy: string[];  // alias names that reference this param
}

/** Find the matching close brace for an open brace at position `open` (where text[open] === '{').
 *  Returns -1 if unbalanced. Brace-balanced so nested ${...${...}...} resolves correctly. */
function findMatchingClose(text: string, open: number): number {
  let depth = 1;
  for (let j = open + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Find the first '|' at the top level of brace nesting inside `text`. Returns -1 if none. */
function findTopLevelPipe(text: string): number {
  let depth = 0;
  for (let j = 0; j < text.length; j++) {
    const ch = text[j];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '|' && depth === 0) return j;
  }
  return -1;
}

/** Extract all placeholder names from a string. Strips modifiers (|map:, |join:).
 *  Handles nested placeholders via brace-balanced scanning so ${A.${B}|mod} correctly
 *  extracts only the inner 'B' (outer A.${B} is unresolvable until B is substituted). */
function extractPlaceholders(text: string): string[] {
  const names: string[] = [];
  let i = 0;
  while (i < text.length) {
    // $${...} escape: skip the whole balanced group, no placeholder extracted
    if (text[i] === '$' && text[i + 1] === '$' && text[i + 2] === '{') {
      const close = findMatchingClose(text, i + 2);
      if (close === -1) break;
      i = close + 1;
      continue;
    }
    // ${...} placeholder — use brace-balanced scan so nested ${...} survives
    if (text[i] === '$' && text[i + 1] === '{') {
      const close = findMatchingClose(text, i + 1);
      if (close === -1) break; // unclosed — stop scanning; malformed input
      const inner = text.substring(i + 2, close);
      // Strip trailing top-level modifier: "key|mod:arg" → "key"
      const pipeIdx = findTopLevelPipe(inner);
      const key = pipeIdx >= 0 ? inner.substring(0, pipeIdx) : inner;
      if (key.includes('${')) {
        // Nested: only inner placeholders extractable (outer needs inner substituted first)
        names.push(...extractPlaceholders(key));
      } else {
        names.push(key);
      }
      i = close + 1;
      continue;
    }
    i++;
  }
  return names;
}

/** Extract all placeholder names from an argv array. */
function extractFromArgv(argv: readonly string[]): string[] {
  const names: string[] = [];
  for (const token of argv) {
    names.push(...extractPlaceholders(token));
  }
  return names;
}

/**
 * Recursively collect all params declarations and placeholder usages from an alias chain.
 * - `declared`: explicit params blocks (with required/default/description metadata)
 * - `usedBy`: map of placeholder name → alias names that use it
 */
function collectAll(
  aliasName: string,
  commands: CommandMap,
  declared: Map<string, CollectedParam>,
  usedBy: Map<string, Set<string>>,
  depth: number,
  isOutermost: boolean,
): void {
  if (depth > 10) return;

  const def: CommandDef | undefined = commands.get(aliasName);
  if (def === undefined) return;

  // Merge explicit params declarations
  if (def.params) {
    for (const [name, param] of Object.entries(def.params)) {
      const existing = declared.get(name);
      if (existing) {
        if (param.required) {
          existing.required = true;
          if (!existing.requiredBy.includes(aliasName)) existing.requiredBy.push(aliasName);
        }
        if (isOutermost) {
          if (param.default !== undefined) existing.default = param.default;
          if (param.description !== undefined) existing.description = param.description;
        }
      } else {
        declared.set(name, {
          name,
          required: param.required === true,
          default: param.default,
          description: param.description,
          requiredBy: param.required ? [aliasName] : [],
        });
      }
    }
  }

  // Track placeholder usage from command content
  const trackUsage = (names: string[]) => {
    for (const name of names) {
      let set = usedBy.get(name);
      if (!set) { set = new Set(); usedBy.set(name, set); }
      set.add(aliasName);
    }
  };

  // `cwd` is available on every kind — scan it uniformly so ${...} tokens surface
  // as required params via the same MissingParamsError path.
  if (typeof (def as { cwd?: unknown }).cwd === 'string') {
    trackUsage(extractPlaceholders((def as { cwd: string }).cwd));
  }

  // Scan placeholders based on command kind
  switch (def.kind) {
    case 'single':
      trackUsage(extractFromArgv(def.cmd));
      if (def.platforms) {
        if (def.platforms.linux) trackUsage(extractFromArgv(def.platforms.linux));
        if (def.platforms.windows) trackUsage(extractFromArgv(def.platforms.windows));
        if (def.platforms.macos) trackUsage(extractFromArgv(def.platforms.macos));
      }
      break;

    case 'sequential':
      // Steps that are inline commands (not alias refs) have placeholders
      for (const step of def.steps) {
        if (VAR_ASSIGN_RE.test(step)) {
          // Variable assignment: KEY=VALUE — track placeholders in the value
          const eqIdx = step.indexOf('=');
          const value = step.substring(eqIdx + 1);
          trackUsage(extractPlaceholders(value));
        } else if (!commands.has(step)) {
          trackUsage(extractPlaceholders(step));
        } else {
          collectAll(step, commands, declared, usedBy, depth + 1, false);
        }
      }
      return; // already recursed

    case 'parallel':
      for (const entry of def.group) {
        if (!commands.has(entry)) {
          trackUsage(extractPlaceholders(entry));
        } else {
          collectAll(entry, commands, declared, usedBy, depth + 1, false);
        }
      }
      return;

    case 'for_each':
      if (def.cmd) trackUsage(extractFromArgv(def.cmd));
      if (typeof def.in === 'string') trackUsage(extractFromArgv([def.in]));
      if (def.run && commands.has(def.run)) {
        collectAll(def.run, commands, declared, usedBy, depth + 1, false);
      }
      break;

    case 'ini':
      trackUsage(extractPlaceholders(def.file));
      if (def.set) {
        for (const keys of Object.values(def.set)) {
          for (const v of Object.values(keys)) {
            trackUsage(extractPlaceholders(v));
          }
        }
      }
      break;
  }

  // Recurse into sub-aliases for sequential/parallel (handled above via return)
  // For single/for_each/ini, recurse into referenced aliases
  if (def.kind === 'for_each' && def.run && commands.has(def.run)) {
    // already handled above
  }
}

/**
 * Collect captured variable names from the command chain.
 * These will be available at runtime and count as "provided".
 */
function collectCapturedVars(
  aliasName: string,
  commands: CommandMap,
  captured: Set<string>,
  depth: number,
): void {
  if (depth > 10) return;

  const def = commands.get(aliasName);
  if (!def) return;

  if (def.kind === 'single' && def.capture) {
    captured.add(def.capture.var);
    captured.add(def.capture.var.toUpperCase().replace(/[.\-]/g, '_'));
  }

  if (def.kind === 'sequential') {
    for (const step of def.steps) {
      if (VAR_ASSIGN_RE.test(step)) {
        const key = step.substring(0, step.indexOf('='));
        captured.add(key);
        captured.add(key.toUpperCase().replace(/[.\-]/g, '_'));
      } else if (commands.has(step)) {
        collectCapturedVars(step, commands, captured, depth + 1);
      }
    }
  } else if (def.kind === 'parallel') {
    for (const entry of def.group) {
      if (commands.has(entry)) {
        collectCapturedVars(entry, commands, captured, depth + 1);
      }
    }
  } else if (def.kind === 'for_each' && def.run && commands.has(def.run)) {
    collectCapturedVars(def.run, commands, captured, depth + 1);
  }
}

/**
 * Validate params for a command chain:
 * 1. Collect explicit params declarations (required/default/description)
 * 2. Scan all ${placeholder} usages in the entire command tree
 * 3. Apply defaults for declared params
 * 4. Report ALL undefined placeholders (declared required OR undeclared but used)
 *
 * Returns a new values record with defaults applied.
 */
export function validateParams(
  aliasName: string,
  commands: CommandMap,
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const declared = new Map<string, CollectedParam>();
  const usedBy = new Map<string, Set<string>>();
  collectAll(aliasName, commands, declared, usedBy, 0, true);

  // Gather captured vars from the chain
  const capturedVars = new Set<string>();
  collectCapturedVars(aliasName, commands, capturedVars, 0);

  // Also treat for_each loop vars as provided
  const loopVars = new Set<string>();
  collectLoopVars(aliasName, commands, loopVars, 0);

  const result = { ...values };

  // Apply defaults from declared params
  for (const [name, param] of declared) {
    if (!(name in result) && !capturedVars.has(name) && param.default !== undefined) {
      result[name] = param.default;
    }
  }

  // Find all missing placeholders: used in commands but not available from any source
  const missing: Array<{ name: string; requiredBy: string[]; description?: string }> = [];

  for (const [name, aliases] of usedBy) {
    let hasValue = name in result || capturedVars.has(name) || loopVars.has(name);

    // Check JSON path: ${AwsBuild[0].BuildId} or ${AwsBuild.BuildId} is provided
    // if the base var "AwsBuild" is a captured/loop var (not a config key — config keys use dots too)
    if (!hasValue) {
      // Check bracket-based paths: AwsBuild[0].BuildId → base is AwsBuild
      const bracketIdx = name.indexOf('[');
      if (bracketIdx > 0) {
        const baseName = name.substring(0, bracketIdx);
        hasValue = baseName in result || capturedVars.has(baseName) || loopVars.has(baseName);
      }
      // Check dot-based paths: only if a prefix is a captured/loop var
      // (config keys like UE.ENGINE.PATH are NOT captured, so this is safe)
      if (!hasValue && name.includes('.')) {
        const parts = name.split('.');
        for (let i = 1; i < parts.length; i++) {
          const prefix = parts.slice(0, i).join('.');
          if (capturedVars.has(prefix) || loopVars.has(prefix)) {
            hasValue = true;
            break;
          }
        }
      }
    }

    if (hasValue) continue;

    // Check if declared with a default (already applied above)
    const param = declared.get(name);
    if (param?.default !== undefined) continue;

    // Check if explicitly declared as optional (not required, no default)
    if (param && !param.required) continue;

    missing.push({
      name,
      requiredBy: [...aliases],
      description: param?.description,
    });
  }

  if (missing.length > 0) {
    throw new MissingParamsError(missing);
  }

  return result;
}

/**
 * Get all placeholder names used by an alias chain (for shell completions).
 * Returns param names with metadata (description, required, has default).
 */
export function getParamNames(
  aliasName: string,
  commands: CommandMap,
  values: Readonly<Record<string, string>>,
): Array<{ name: string; description?: string; required: boolean; hasDefault: boolean }> {
  const declared = new Map<string, CollectedParam>();
  const usedBy = new Map<string, Set<string>>();
  collectAll(aliasName, commands, declared, usedBy, 0, true);

  const capturedVars = new Set<string>();
  collectCapturedVars(aliasName, commands, capturedVars, 0);

  const loopVars = new Set<string>();
  collectLoopVars(aliasName, commands, loopVars, 0);

  const result: Array<{ name: string; description?: string; required: boolean; hasDefault: boolean }> = [];

  for (const [name] of usedBy) {
    // Skip if already provided by config, captures, or loop vars
    let provided = name in values || capturedVars.has(name) || loopVars.has(name);
    if (!provided) {
      const bracketIdx = name.indexOf('[');
      if (bracketIdx > 0) {
        const baseName = name.substring(0, bracketIdx);
        provided = baseName in values || capturedVars.has(baseName) || loopVars.has(baseName);
      }
      if (!provided && name.includes('.')) {
        const parts = name.split('.');
        for (let i = 1; i < parts.length; i++) {
          const prefix = parts.slice(0, i).join('.');
          if (capturedVars.has(prefix) || loopVars.has(prefix)) {
            provided = true;
            break;
          }
        }
      }
    }
    if (provided) continue;

    const param = declared.get(name);
    result.push({
      name,
      description: param?.description,
      required: param ? param.required : true, // undeclared = implicitly required
      hasDefault: param?.default !== undefined,
    });
  }

  return result;
}

/**
 * Collect loop variable names from for_each commands in the chain.
 */
function collectLoopVars(
  aliasName: string,
  commands: CommandMap,
  loopVars: Set<string>,
  depth: number,
): void {
  if (depth > 10) return;
  const def = commands.get(aliasName);
  if (!def) return;

  if (def.kind === 'for_each') {
    loopVars.add(def.var);
    if (def.run && commands.has(def.run)) {
      collectLoopVars(def.run, commands, loopVars, depth + 1);
    }
  } else if (def.kind === 'sequential') {
    for (const step of def.steps) {
      if (commands.has(step)) collectLoopVars(step, commands, loopVars, depth + 1);
    }
  } else if (def.kind === 'parallel') {
    for (const entry of def.group) {
      if (commands.has(entry)) collectLoopVars(entry, commands, loopVars, depth + 1);
    }
  }
}
