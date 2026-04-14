// src/executor/index.ts
//
// Executor interface implementation dispatching to single/sequential/parallel runners.

import type { ExecutionPlan, ExecutionResult, Executor, ExecutorOptions } from '../types.js';
import { runParallel } from './parallel.js';
import { runSequential } from './sequential.js';
import { runSingle } from './single.js';

export { buildSecretValues, printDryRun, printVerboseTrace } from './output.js';

export const executor: Executor = {
  async run(plan: ExecutionPlan, options: ExecutorOptions): Promise<ExecutionResult> {
    const { cwd, env } = options;

    switch (plan.kind) {
      case 'single':
        return runSingle(plan.argv, cwd, env);
      case 'sequential':
        return runSequential(plan.steps, cwd, env);
      case 'parallel':
        return runParallel(plan.group, plan.failMode, cwd, env);
    }
  },
};
