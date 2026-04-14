// src/resolver/index.ts
//
// Resolver implementation (Phase 3).
// Takes alias name + CommandMap + ResolvedConfig → ExecutionPlan with fully interpolated argv.

import { tokenize } from '../commands/tokenize.js';
import { CommandSchemaError, UnknownAliasError } from '../errors.js';
import type { CommandDef, CommandMap, ExecutionPlan, ResolvedConfig, Resolver } from '../types.js';
import { interpolateArgv } from './interpolate.js';
import { selectPlatformCmd } from './platform.js';

export { buildEnvVars, redactSecrets } from './envvars.js';

/**
 * Recursively resolve an alias into a flat argv array suitable for a single step.
 * Used when resolving alias refs inside sequential or parallel groups.
 * If the referenced alias is sequential, its steps are returned as an array of argv arrays.
 */
function resolveToArgvArrays(
  aliasName: string,
  commands: CommandMap,
  config: ResolvedConfig,
  depth: number,
  chain: string[],
): readonly (readonly string[])[] {
  const plan = resolveAlias(aliasName, commands, config, depth, chain);
  switch (plan.kind) {
    case 'single':
      return [plan.argv];
    case 'sequential':
      return plan.steps;
    case 'parallel':
      // A parallel alias embedded in a sequential context: each parallel entry becomes one step
      return plan.group.map((entry) => entry.argv);
  }
}

/**
 * Internal recursive resolver. Tracks depth and chain for cycle/depth-cap detection.
 */
function resolveAlias(
  aliasName: string,
  commands: CommandMap,
  config: ResolvedConfig,
  depth: number,
  chain: string[],
): ExecutionPlan {
  if (depth > 10) {
    throw new CommandSchemaError(
      chain[0] ?? aliasName,
      `alias nesting exceeds maximum depth of 10: ${chain.join(' -> ')}`,
    );
  }

  const def: CommandDef | undefined = commands.get(aliasName);
  if (def === undefined) {
    throw new UnknownAliasError(aliasName);
  }

  switch (def.kind) {
    case 'single': {
      const cmd = selectPlatformCmd(def, aliasName);
      const argv = interpolateArgv(cmd, aliasName, config.values);
      return { kind: 'single', argv };
    }

    case 'sequential': {
      const allSteps: (readonly string[])[] = [];
      for (const step of def.steps) {
        if (commands.has(step)) {
          // D-09: alias ref — resolve recursively and flatten steps
          const subSteps = resolveToArgvArrays(step, commands, config, depth + 1, [...chain, step]);
          for (const s of subSteps) {
            allSteps.push(s);
          }
        } else {
          // Inline command — tokenize and interpolate
          const tokens = tokenize(step, aliasName);
          const argv = interpolateArgv(tokens, aliasName, config.values);
          allSteps.push(argv);
        }
      }
      return { kind: 'sequential', steps: allSteps };
    }

    case 'parallel': {
      const group: { alias: string; argv: readonly string[] }[] = [];
      for (const entry of def.group) {
        if (commands.has(entry)) {
          // D-09: alias ref — must resolve to a single command for parallel group
          const subPlan = resolveAlias(entry, commands, config, depth + 1, [...chain, entry]);
          if (subPlan.kind !== 'single') {
            throw new CommandSchemaError(
              aliasName,
              `parallel group entry "${entry}" must resolve to a single command`,
            );
          }
          group.push({ alias: entry, argv: subPlan.argv });
        } else {
          // Inline command
          const tokens = tokenize(entry, aliasName);
          const argv = interpolateArgv(tokens, aliasName, config.values);
          group.push({ alias: entry, argv });
        }
      }
      return { kind: 'parallel', group, failMode: def.failMode ?? 'fast' };
    }
  }
}

export const resolver: Resolver = {
  resolve(aliasName: string, commands: CommandMap, config: ResolvedConfig): ExecutionPlan {
    return resolveAlias(aliasName, commands, config, 0, [aliasName]);
  },
};
