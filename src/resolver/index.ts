// src/resolver/index.ts
//
// Phase 3 stub. Throws NotImplementedError per D-06.

import { NotImplementedError } from '../errors.js';
import type { CommandMap, ExecutionPlan, ResolvedConfig, Resolver } from '../types.js';

export const resolver: Resolver = {
  resolve(_aliasName: string, _commands: CommandMap, _config: ResolvedConfig): ExecutionPlan {
    throw new NotImplementedError('Resolver (Phase 3)');
  },
};
