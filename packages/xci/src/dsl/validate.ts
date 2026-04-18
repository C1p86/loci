// D-05 + D-12 steps 3-4.
// validateCommandMap wraps v1 validateGraph (cycles only).
// validateAliasRefs is NEW: scans explicit alias refs for unknowns + suggests via levenshtein.

import { validateGraph } from '../commands/validate.js';
import { CircularAliasError, CommandSchemaError } from '../errors.js';
import type { CommandDef, CommandMap } from '../types.js';
import { suggest } from './levenshtein.js';
import type { ValidationError } from './types.js';

export interface ValidateResult {
  ok: boolean;
  errors: ValidationError[];
}

export function validateCommandMap(map: CommandMap): ValidateResult {
  try {
    validateGraph(map);
    return { ok: true, errors: [] };
  } catch (err) {
    if (err instanceof CircularAliasError || err instanceof CommandSchemaError) {
      return { ok: false, errors: [{ message: err.message }] };
    }
    return { ok: false, errors: [{ message: err instanceof Error ? err.message : String(err) }] };
  }
}

export function validateAliasRefs(map: CommandMap): ValidationError[] {
  const errors: ValidationError[] = [];
  const known = [...map.keys()];
  for (const [alias, def] of map.entries()) {
    for (const ref of collectExplicitRefs(def)) {
      if (!map.has(ref)) {
        const matches = suggest(ref, known);
        const ve: ValidationError = {
          message: `alias '${alias}' references unknown alias '${ref}'`,
        };
        if (matches[0] !== undefined) {
          ve.suggestion = `did you mean '${matches[0]}'?`;
        }
        errors.push(ve);
      }
    }
  }
  return errors;
}

function collectExplicitRefs(def: CommandDef): readonly string[] {
  // Mirror getAliasRefs in commands/validate.ts but return ALL candidate names
  // (including unknowns — the whole point of this helper).
  if (def.kind === 'sequential') {
    return def.steps;
  }
  if (def.kind === 'parallel') {
    return def.group;
  }
  if (def.kind === 'for_each') {
    return def.run ? [def.run] : [];
  }
  return [];
}
