// src/executor/sequential.ts
//
// Sequential chain execution: runs steps in order, stops at first non-zero exit (EXE-03).

import type { ExecutionResult } from '../types.js';
import { printStepHeader } from './output.js';
import { runSingle } from './single.js';

/**
 * Run a sequence of command argv arrays in order.
 * Prints a step header (D-08) before each step.
 * Stops and returns the exit code of the first failing step (EXE-03).
 * Returns exitCode 0 if all steps succeed.
 */
export async function runSequential(
  steps: readonly (readonly string[])[],
  cwd: string,
  env: Record<string, string>,
): Promise<ExecutionResult> {
  for (const step of steps) {
    printStepHeader(step[0] ?? '(unknown)');
    const result = await runSingle(step, cwd, env);
    if (result.exitCode !== 0) {
      return result;
    }
  }
  return { exitCode: 0 };
}
