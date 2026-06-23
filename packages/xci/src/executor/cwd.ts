// src/executor/cwd.ts
//
// Resolve every cwd field on an ExecutionPlan to an absolute path against projectRoot.
// Relative paths become projectRoot-relative. Absolute paths pass through. Undefined stays undefined.
// Called by cli.ts between resolver.resolve() and executor.run() (quick-260421-g99).

import { statSync } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { CwdMissingError } from '../errors.js';
import type { ExecutionPlan, SequentialStep } from '../types.js';

/**
 * Throw CwdMissingError if a defined, non-empty cwd does not exist (or is not a directory).
 * No-op when cwd is undefined/empty — an absent cwd inherits process.cwd(), always valid.
 * Cross-platform (node:fs); cheap enough to keep within the cold-start budget.
 */
export function assertCwdExists(cwd: string | undefined): void {
  if (cwd === undefined || cwd === '') return;
  let isDir = false;
  try {
    isDir = statSync(cwd).isDirectory();
  } catch {
    isDir = false; // ENOENT or unreadable → treat as missing
  }
  if (!isDir) throw new CwdMissingError(cwd);
}

function toAbs(cwd: string | undefined, projectRoot: string): string | undefined {
  if (cwd === undefined) return undefined;
  if (isAbsolute(cwd)) return cwd;
  return resolvePath(projectRoot, cwd);
}

function resolveStepCwd(step: SequentialStep, projectRoot: string): SequentialStep {
  // 'set' and 'prompt' steps never have cwd — pass through unchanged.
  if (step.kind === 'set' || step.kind === 'prompt') return step;
  // Both 'ini' and the cmd variant (kind undefined or 'cmd') may carry cwd.
  const abs = toAbs(step.cwd, projectRoot);
  // For xci steps: also rewrite project to absolute (relative project is against projectRoot).
  if (step.kind === 'xci') {
    const absProject = toAbs(step.project, projectRoot);
    const result = {
      ...step,
      ...(absProject !== undefined ? { project: absProject } : {}),
      ...(abs !== undefined ? { cwd: abs } : {}),
    };
    return result;
  }
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
    case 'uproject': {
      const abs = toAbs(plan.cwd, projectRoot);
      return abs === undefined ? plan : { ...plan, cwd: abs };
    }
    case 'xci': {
      const abs = toAbs(plan.cwd, projectRoot);
      const absProject = toAbs(plan.project, projectRoot);
      return {
        ...plan,
        ...(abs !== undefined ? { cwd: abs } : {}),
        ...(absProject !== undefined ? { project: absProject } : {}),
      };
    }
  }
}
