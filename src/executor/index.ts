// src/executor/index.ts
//
// Phase 4 stub. Throws NotImplementedError per D-06.

import { NotImplementedError } from '../errors.js';
import type { ExecutionPlan, ExecutionResult, Executor } from '../types.js';

export const executor: Executor = {
  async run(_plan: ExecutionPlan): Promise<ExecutionResult> {
    throw new NotImplementedError('Executor (Phase 4)');
  },
};
