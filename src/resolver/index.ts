// src/resolver/index.ts
//
// Resolver implementation (Phase 3).
// Takes alias name + CommandMap + ResolvedConfig → ExecutionPlan with fully interpolated argv.

import { tokenize } from '../commands/tokenize.js';
import { CommandSchemaError, UnknownAliasError } from '../errors.js';
import type { CommandDef, CommandMap, ExecutionPlan, ResolvedConfig, Resolver, SequentialStep } from '../types.js';
import { interpolateArgv, interpolateArgvLenient } from './interpolate.js';
import { selectPlatformCmd } from './platform.js';

export { buildEnvVars, redactSecrets } from './envvars.js';
export { interpolateArgv } from './interpolate.js';

/**
 * Resolve an alias into SequentialSteps using lenient interpolation.
 * Unknown ${placeholders} are kept as-is for runtime resolution (e.g. captured vars).
 * Stores rawArgv for deferred interpolation at execution time.
 */
function resolveToStepsLenient(
  aliasName: string,
  commands: CommandMap,
  config: ResolvedConfig,
  depth: number,
  chain: string[],
): readonly SequentialStep[] {
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
      const rawCmd = selectPlatformCmd(def, aliasName);
      const argv = interpolateArgvLenient(rawCmd, config.values);
      return [{
        argv,
        rawArgv: rawCmd,
        ...(def.capture ? { capture: def.capture } : {}),
      }];
    }
    case 'sequential': {
      const allSteps: SequentialStep[] = [];
      for (const step of def.steps) {
        if (commands.has(step)) {
          const subSteps = resolveToStepsLenient(step, commands, config, depth + 1, [...chain, step]);
          for (const s of subSteps) allSteps.push(s);
        } else {
          const tokens = tokenize(step, aliasName);
          const argv = interpolateArgvLenient(tokens, config.values);
          allSteps.push({ argv, rawArgv: tokens });
        }
      }
      return allSteps;
    }
    case 'parallel':
      // A parallel alias embedded in a sequential context: each parallel entry becomes one step
      return def.group.map((entry) => {
        if (commands.has(entry)) {
          const sub = resolveToStepsLenient(entry, commands, config, depth + 1, [...chain, entry]);
          if (sub.length === 1) return sub[0];
          // Multi-step can't be flattened into a single parallel entry; return first
          return sub[0];
        }
        const tokens = tokenize(entry, aliasName);
        const argv = interpolateArgvLenient(tokens, config.values);
        return { argv, rawArgv: tokens };
      });
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
      return { kind: 'single', argv, ...(def.capture ? { capture: def.capture } : {}) };
    }

    case 'sequential': {
      // Use lenient interpolation: unknown ${placeholders} are kept for runtime
      // resolution with captured variables from prior steps.
      const allSteps: SequentialStep[] = [];
      for (const step of def.steps) {
        if (commands.has(step)) {
          const subSteps = resolveToStepsLenient(step, commands, config, depth + 1, [...chain, step]);
          for (const s of subSteps) allSteps.push(s);
        } else {
          const tokens = tokenize(step, aliasName);
          const argv = interpolateArgvLenient(tokens, config.values);
          allSteps.push({ argv, rawArgv: tokens });
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

    case 'for_each': {
      // Expand for_each into sequential or parallel plan.
      // For each value in def.in, substitute ${def.var} and resolve the command.
      if (def.mode === 'parallel') {
        const group: { alias: string; argv: readonly string[] }[] = [];
        for (const value of def.in) {
          const loopConfig: ResolvedConfig = {
            ...config,
            values: { ...config.values, [def.var]: value },
          };
          if (def.run && commands.has(def.run)) {
            const subPlan = resolveAlias(def.run, commands, loopConfig, depth + 1, [...chain, def.run]);
            if (subPlan.kind !== 'single') {
              throw new CommandSchemaError(aliasName, `for_each.run "${def.run}" must resolve to a single command`);
            }
            group.push({ alias: `${def.run}[${value}]`, argv: subPlan.argv });
          } else if (def.cmd) {
            const argv = interpolateArgv(def.cmd, aliasName, loopConfig.values);
            group.push({ alias: `${aliasName}[${value}]`, argv });
          }
        }
        return { kind: 'parallel', group, failMode: def.failMode ?? 'fast' };
      }

      // Sequential mode (steps)
      const allSteps: SequentialStep[] = [];
      for (const value of def.in) {
        const loopValues = { ...config.values, [def.var]: value };
        if (def.run && commands.has(def.run)) {
          const loopConfig: ResolvedConfig = { ...config, values: loopValues };
          const subSteps = resolveToStepsLenient(def.run, commands, loopConfig, depth + 1, [...chain, def.run]);
          for (const s of subSteps) allSteps.push(s);
        } else if (def.cmd) {
          const argv = interpolateArgvLenient(def.cmd, loopValues);
          allSteps.push({ argv, rawArgv: def.cmd });
        }
      }
      return { kind: 'sequential', steps: allSteps };
    }

    case 'ini': {
      // Interpolate file path and values
      const file = interpolateArgv([def.file], aliasName, config.values)[0];
      let set: Record<string, Record<string, string>> | undefined;
      if (def.set) {
        set = {};
        for (const [section, keys] of Object.entries(def.set)) {
          set[section] = {};
          for (const [k, v] of Object.entries(keys)) {
            set[section][k] = interpolateArgv([v], aliasName, config.values)[0];
          }
        }
      }
      return {
        kind: 'ini',
        file,
        mode: def.mode ?? 'overwrite',
        ...(set ? { set } : {}),
        ...(def.delete ? { delete: def.delete } : {}),
      };
    }
  }
}

export const resolver: Resolver = {
  resolve(aliasName: string, commands: CommandMap, config: ResolvedConfig): ExecutionPlan {
    return resolveAlias(aliasName, commands, config, 0, [aliasName]);
  },
};
