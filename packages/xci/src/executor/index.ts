// src/executor/index.ts
//
// Executor interface implementation dispatching to single/sequential/parallel runners.

import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ExecutionPlan, ExecutionResult, Executor, ExecutorOptions } from '../types.js';
import { validateCapture } from './capture.js';
import { writeIni, deleteIniKeys } from './ini.js';
import { printCaptureResult, printStepHeader, printStepPreview, printStepResult } from './output.js';
import { runParallel } from './parallel.js';
import { runSequential } from './sequential.js';
import { runSingle, runSingleCapture } from './single.js';

export { buildSecretValues, printCaptureResult, printDryRun, printRunHeader, printStepPreview, printVerboseCommand, printVerboseTrace } from './output.js';
export { resolveAbsoluteCwds } from './cwd.js';

export const executor: Executor = {
  async run(plan: ExecutionPlan, options: ExecutorOptions): Promise<ExecutionResult> {
    const { cwd, env, logFile, showOutput, tailLines, fromStep } = options;
    const show = showOutput ?? true;

    switch (plan.kind) {
      case 'single': {
        const cmdName = plan.argv[0] ?? '(cmd)';
        // quick-260421-g99: plan.cwd (absolute after resolveAbsoluteCwds) overrides the options default.
        const effectiveCwd = plan.cwd ?? cwd;
        printStepHeader(cmdName);
        printStepPreview(undefined, plan.argv, undefined, { verbose: env['XCI_VERBOSE'] === '1', logFile });
        const startTime = Date.now();

        if (plan.capture) {
          const result = await runSingleCapture(plan.argv, effectiveCwd, env, logFile);
          const elapsed = Date.now() - startTime;
          if (result.exitCode !== 0) {
            printStepResult(cmdName, result.exitCode, elapsed);
            return { exitCode: result.exitCode };
          }

          if (result.stdout.length > 0 && show) {
            process.stdout.write(result.stdout + '\n');
          }
          const validation = validateCapture(result.stdout, plan.capture);
          const isVerbose = env['XCI_VERBOSE'] === '1';
          printCaptureResult(plan.capture, validation, isVerbose);
          if (!validation.valid) {
            printStepResult(cmdName, 1, elapsed);
            return { exitCode: 1 };
          }
          printStepResult(cmdName, 0, elapsed);
          return { exitCode: 0 };
        }

        const result = await runSingle(plan.argv, effectiveCwd, env, logFile, show, tailLines);
        printStepResult(cmdName, result.exitCode, Date.now() - startTime);
        return result;
      }
      case 'sequential':
        return runSequential(plan.steps, cwd, env, logFile, show, tailLines, fromStep);
      case 'parallel':
        return runParallel(plan.group, plan.failMode, cwd, env, logFile, show);
      case 'ini': {
        const iniLabel = `ini:${plan.mode}`;
        // quick-260421-g99: relative file path resolves against plan.cwd ?? default cwd.
        const effectiveCwd = plan.cwd ?? cwd;
        const filePath = isAbsolute(plan.file) ? plan.file : resolvePath(effectiveCwd, plan.file);
        printStepHeader(iniLabel);
        const startTime = Date.now();
        try {
          if (plan.set) writeIni(filePath, plan.set, plan.mode);
          if (plan.delete) deleteIniKeys(filePath, plan.delete as Record<string, string[]>);
          process.stderr.write(`  ${filePath}\n`);
          if (plan.set) {
            for (const [section, keys] of Object.entries(plan.set)) {
              for (const [k, v] of Object.entries(keys)) {
                process.stderr.write(`    [${section}] ${k}=${v}\n`);
              }
            }
          }
          printStepResult(iniLabel, 0, Date.now() - startTime);
          return { exitCode: 0 };
        } catch (err) {
          process.stderr.write(`  error: ${(err as Error).message}\n`);
          printStepResult(iniLabel, 1, Date.now() - startTime);
          return { exitCode: 1 };
        }
      }
    }
  },
};
