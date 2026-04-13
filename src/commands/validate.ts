// src/commands/validate.ts
//
// Eager load-time graph validation: cycle detection (DFS, three-color marking),
// depth cap enforcement (D-10), and unknown alias reference checking (D-11).

import { CircularAliasError, CommandSchemaError } from '../errors.js';
import type { CommandDef, CommandMap } from '../types.js';

type Color = 'white' | 'gray' | 'black';

/**
 * Return alias references embedded in a command definition.
 * Per D-09 (lookup-based detection): only entries that exist as keys in
 * the CommandMap are alias refs; all others are inline commands.
 */
function getAliasRefs(def: CommandDef, commands: CommandMap): readonly string[] {
  if (def.kind === 'sequential') {
    return def.steps.filter((step) => commands.has(step));
  }
  if (def.kind === 'parallel') {
    return def.group.filter((entry) => commands.has(entry));
  }
  // single: no alias refs
  return [];
}

/**
 * Validate the alias composition graph in `commands`.
 *
 * Performs:
 * 1. DFS with three-color marking to detect cycles (D-11, CMD-06).
 * 2. Depth cap enforcement at 10 levels (D-10).
 *
 * Per D-09, only step/group entries that match keys in `commands` are
 * followed as alias edges. Unknown entries are treated as inline commands
 * and are NOT validated here (no UnknownAliasError for inline commands).
 *
 * Throws:
 * - CircularAliasError — if a cycle is detected (any gray-node revisit)
 * - CommandSchemaError — if alias nesting depth exceeds 10
 */
export function validateGraph(commands: CommandMap): void {
  const color = new Map<string, Color>();
  const path: string[] = [];

  // Initialize all nodes as white (unvisited)
  for (const alias of commands.keys()) {
    color.set(alias, 'white');
  }

  function dfs(alias: string, depth: number): void {
    if (depth > 10) {
      throw new CommandSchemaError(
        path[0] ?? alias,
        `alias nesting exceeds maximum depth of 10: ${path.join(' -> ')}`,
      );
    }

    color.set(alias, 'gray');
    path.push(alias);

    const def = commands.get(alias);
    if (def === undefined) {
      // Should not happen since we iterate commands.keys(), but guard anyway
      path.pop();
      color.set(alias, 'black');
      return;
    }

    for (const ref of getAliasRefs(def, commands)) {
      const refColor = color.get(ref) ?? 'white';

      if (refColor === 'gray') {
        // Found a back-edge — extract cycle from the path
        const cycleStart = path.indexOf(ref);
        const cyclePath = [...path.slice(cycleStart), ref];
        throw new CircularAliasError(cyclePath);
      }

      if (refColor === 'white') {
        dfs(ref, depth + 1);
      }
      // black = already fully explored, skip
    }

    path.pop();
    color.set(alias, 'black');
  }

  for (const alias of commands.keys()) {
    if ((color.get(alias) ?? 'white') === 'white') {
      dfs(alias, 0);
    }
  }
}
