// src/executor/index.ts
//
// Executor interface implementation dispatching to single/sequential/parallel runners.

import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ExecutionPlan, ExecutionResult, Executor, ExecutorOptions } from '../types.js';
import { extractFromOutput, validateCapture } from './capture.js';
import { writeIni, deleteIniKeys } from './ini.js';
import { applyUprojectEdits, readUproject, writeUproject } from './uproject.js';
import { removeReadonly } from './unreadonly.js';
import { runXciDelegate } from './xci-delegate.js';
import {
  notifyCompletion,
  printCaptureResult,
  printDelegationBanner,
  printStepHeader,
  printStepPreview,
  printStepResult,
  resetTerminalTitle,
  setTerminalTitle,
  formatWarning,
} from './output.js';
import { runParallel } from './parallel.js';
import { runSequential } from './sequential.js';
import { runSingle, runSingleCapture } from './single.js';

export {
  buildSecretValues,
  printCaptureResult,
  printDryRun,
  printRunHeader,
  printStepPreview,
  printVerboseCommand,
  printVerboseTrace,
} from './output.js';
export { resolveAbsoluteCwds } from './cwd.js';

export const executor: Executor = {
  async run(plan: ExecutionPlan, options: ExecutorOptions): Promise<ExecutionResult> {
    const { cwd, env, logFile, showOutput, tailLines, fromStep, secretValues } = options;
    const show = showOutput ?? true;

    const result = await (async (): Promise<ExecutionResult> => {
      switch (plan.kind) {
        case 'single': {
          const cmdName = plan.argv[0] ?? '(cmd)';
          // quick-260421-g99: plan.cwd (absolute after resolveAbsoluteCwds) overrides the options default.
          const effectiveCwd = plan.cwd ?? cwd;
          const singleCmd = plan.argv.join(' ');
          setTerminalTitle(
            `xci: ${singleCmd.length > 70 ? `${singleCmd.slice(0, 67)}…` : singleCmd}`,
          );
          printStepHeader(cmdName);
          // quick-260422-pnv: always pass cwd so the dark-yellow cwd line appears for single commands too.
          printStepPreview(undefined, plan.argv, secretValues, {
            verbose: env['XCI_VERBOSE'] === '1',
            ...(logFile !== undefined ? { logFile } : {}),
            ...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {}),
          });
          const startTime = Date.now();

          if (plan.capture) {
            const captureResult = await runSingleCapture(plan.argv, effectiveCwd, env, logFile);
            const elapsed = Date.now() - startTime;
            if (captureResult.exitCode !== 0) {
              printStepResult(cmdName, captureResult.exitCode, elapsed);
              resetTerminalTitle();
              return { exitCode: captureResult.exitCode };
            }

            if (captureResult.stdout.length > 0 && show) {
              process.stdout.write(captureResult.stdout + '\n');
            }
            const validation = validateCapture(
              extractFromOutput(captureResult.stdout, plan.capture),
              plan.capture,
            );
            const isVerbose = env['XCI_VERBOSE'] === '1';
            printCaptureResult(plan.capture, validation, isVerbose);
            if (!validation.valid) {
              printStepResult(cmdName, 1, elapsed);
              resetTerminalTitle();
              return { exitCode: 1 };
            }
            printStepResult(cmdName, 0, elapsed);
            resetTerminalTitle();
            return { exitCode: 0 };
          }

          const singleResult = await runSingle(
            plan.argv,
            effectiveCwd,
            env,
            logFile,
            show,
            tailLines,
          );
          printStepResult(cmdName, singleResult.exitCode, Date.now() - startTime);
          resetTerminalTitle();
          return singleResult;
        }
        case 'sequential':
          return runSequential(
            plan.steps,
            cwd,
            env,
            logFile,
            show,
            tailLines,
            fromStep,
            secretValues,
          );
        case 'parallel': {
          setTerminalTitle(`xci: [${plan.group.length} in parallel]`);
          const parallelResult = await runParallel(
            plan.group,
            plan.failMode,
            cwd,
            env,
            logFile,
            show,
            secretValues,
          );
          resetTerminalTitle();
          return parallelResult;
        }
        case 'ini': {
          const iniLabel = `ini:${plan.mode}`;
          // quick-260421-g99: relative file path resolves against plan.cwd ?? default cwd.
          const effectiveCwd = plan.cwd ?? cwd;
          const filePath = isAbsolute(plan.file) ? plan.file : resolvePath(effectiveCwd, plan.file);
          setTerminalTitle(`xci: ${iniLabel}`);
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
            resetTerminalTitle();
            return { exitCode: 0 };
          } catch (err) {
            process.stderr.write(`  error: ${(err as Error).message}\n`);
            printStepResult(iniLabel, 1, Date.now() - startTime);
            resetTerminalTitle();
            return { exitCode: 1 };
          }
        }
        case 'uproject': {
          const uprojectLabel = 'uproject';
          // Resolve file path against plan.cwd ?? default cwd
          const effectiveCwd = plan.cwd ?? cwd;
          const filePath = isAbsolute(plan.file) ? plan.file : resolvePath(effectiveCwd, plan.file);
          setTerminalTitle(`xci: ${uprojectLabel}`);
          printStepHeader(uprojectLabel);
          const startTime = Date.now();
          try {
            const existing = readUproject(filePath);
            const ops: import('./uproject.js').UprojectOps = {};
            if (plan.plugins !== undefined) ops.plugins = plan.plugins;
            if (plan.set !== undefined) ops.set = plan.set;
            const { json, warnings } = applyUprojectEdits(existing, ops);
            writeUproject(filePath, json);
            process.stderr.write(`  ${filePath}\n`);
            for (const w of warnings) {
              process.stderr.write(`  ${formatWarning(w)}\n`);
            }
            printStepResult(uprojectLabel, 0, Date.now() - startTime);
            resetTerminalTitle();
            return { exitCode: 0 };
          } catch (err) {
            process.stderr.write(`  error: ${(err as Error).message}\n`);
            printStepResult(uprojectLabel, 1, Date.now() - startTime);
            resetTerminalTitle();
            return { exitCode: 1 };
          }
        }
        case 'unreadonly': {
          const unreadonlyLabel = 'unreadonly';
          // Resolve target path: 'project' is a special literal meaning the effective cwd.
          const effectiveCwd = plan.cwd ?? cwd;
          const targetPath =
            plan.path === 'project'
              ? effectiveCwd
              : isAbsolute(plan.path)
                ? plan.path
                : resolvePath(effectiveCwd, plan.path);
          setTerminalTitle(`xci: ${unreadonlyLabel}`);
          printStepHeader(unreadonlyLabel);
          const startTime = Date.now();
          try {
            removeReadonly(targetPath, plan.recursive);
            process.stderr.write(`  ${targetPath}\n`);
            if (plan.recursive) {
              process.stderr.write(`  (recursive)\n`);
            }
            printStepResult(unreadonlyLabel, 0, Date.now() - startTime);
            resetTerminalTitle();
            return { exitCode: 0 };
          } catch (err) {
            process.stderr.write(`  error: ${(err as Error).message}\n`);
            printStepResult(unreadonlyLabel, 1, Date.now() - startTime);
            resetTerminalTitle();
            return { exitCode: 1 };
          }
        }
        case 'xci': {
          const xciLabel = `xci:${plan.alias}`;
          // Delegate spawn cwd: resolved project (absolute) > plan.cwd > options cwd
          const effectiveCwd = plan.project ?? plan.cwd ?? cwd;
          setTerminalTitle(`xci: ${xciLabel}`);
          printStepHeader(xciLabel);
          printDelegationBanner(effectiveCwd, plan.alias, plan.args, secretValues ?? new Set());
          const startTime = Date.now();
          const isVerboseXci = env.XCI_VERBOSE === '1';
          const xciResult = await runXciDelegate(
            {
              alias: plan.alias,
              ...(plan.project !== undefined ? { project: plan.project } : {}),
              ...(plan.args !== undefined ? { args: plan.args } : {}),
              ...(plan.cwd !== undefined ? { cwd: plan.cwd } : {}),
              // quick-260623-ipz: forward accumulated breadcrumb to child process env
              ...(plan.breadcrumb !== undefined ? { breadcrumb: plan.breadcrumb } : {}),
            },
            cwd,
            env,
            undefined, // entryScript: default (process.argv[1])
            logFile,
            show,
            tailLines,
            isVerboseXci,
          );
          printStepResult(xciLabel, xciResult.exitCode, Date.now() - startTime);
          resetTerminalTitle();
          return xciResult;
        }
      }
    })();

    // exit 130 = SIGINT (CTRL+C): user intentionally aborted. Do NOT fire a
    // completion toast — there is nothing to notify about a deliberate abort.
    if (result.exitCode !== 130) {
      await notifyCompletion(result.exitCode, options.projectName, options.alias);
    }
    return result;
  },
};
