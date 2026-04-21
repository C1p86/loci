// src/executor/cwd.ts
//
// Resolve every cwd field on an ExecutionPlan to an absolute path against projectRoot.
// Relative paths become projectRoot-relative. Absolute paths pass through. Undefined stays undefined.
// Called by cli.ts between resolver.resolve() and executor.run() (quick-260421-g99).

import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ExecutionPlan, SequentialStep } from '../types.js';

function toAbs(cwd: string | undefined, projectRoot: string): string | undefined {
  if (cwd === undefined) return undefined;
  if (isAbsolute(cwd)) return cwd;
  return resolvePath(projectRoot, cwd);
}

function resolveStepCwd(step: SequentialStep, projectRoot: string): SequentialStep {
  // 'set' steps never have cwd — pass through unchanged.
  if (step.kind === 'set') return step;
  // Both 'ini' and the cmd variant (kind undefined or 'cmd') may carry cwd.
  const abs = toAbs(step.cwd, projectRoot);
  if (abs === undefined) return step;
  return { ...step, cwd: abs };
}

/**
 * Walk every cwd-carrying field in an ExecutionPlan and rewrite relative paths
 * to absolute against projectRoot. Returns the same plan shape (cwd replaced in place).
 */
export function resolveAbsoluteCwds(plan: ExecutionPlan, projectRoot: string): ExecutionPlan {
  switch (plan.kind) {
    case 'single': {
      const abs = toAbs(plan.cwd, projectRoot);
      return abs === undefined ? plan : { ...plan, cwd: abs };
    }
    case 'sequential':
      return { ...plan, steps: plan.steps.map((s) => resolveStepCwd(s, projectRoot)) };
    case 'parallel':
      return {
        ...plan,
        group: plan.group.map((entry) => {
          const abs = toAbs(entry.cwd, projectRoot);
          return abs === undefined ? entry : { ...entry, cwd: abs };
        }),
      };
    case 'ini': {
      const abs = toAbs(plan.cwd, projectRoot);
      return abs === undefined ? plan : { ...plan, cwd: abs };
    }
  }
}
