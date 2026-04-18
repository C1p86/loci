// src/executor/sequential.ts
//
// Sequential chain execution: runs steps in order, stops at first non-zero exit (EXE-03).

import { execSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { execa } from 'execa';
import { SpawnError } from '../errors.js';

const IS_WINDOWS = process.platform === 'win32';
import { interpolateArgv } from '../resolver/interpolate.js';
import type { ExecutionResult, SequentialStep } from '../types.js';
import { validateCapture } from './capture.js';
import { writeIni, deleteIniKeys } from './ini.js';
import { printCaptureResult, printStepHeader, printStepPreview, printStepResult } from './output.js';
import { runSingle } from './single.js';

/**
 * Run a single command and capture its stdout as a trimmed string.
 * Also writes to log file if provided.
 */
async function runAndCapture(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
  logFile?: string,
): Promise<{ exitCode: number; stdout: string }> {
  const [cmd, ...args] = argv;
  if (!cmd) throw new SpawnError('(empty command)', new Error('argv is empty'));

  const logStream = logFile ? createWriteStream(logFile, { flags: 'a' }) : undefined;

  const proc = execa(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
  });

  let interrupted = false;
  const pid = proc.pid;
  const sigintHandler = async () => {
    interrupted = true;
    process.stderr.write('\n[xci] Stopping child process...\n');
    if (IS_WINDOWS && pid) {
      try { execSync(`taskkill /f /t /pid ${pid}`, { stdio: 'pipe' }); } catch { /* */ }
    } else {
      proc.kill('SIGTERM');
    }
    const forceTimer = setTimeout(() => {
      if (IS_WINDOWS && pid) {
        try { execSync(`taskkill /f /t /pid ${pid}`, { stdio: 'pipe' }); } catch { /* */ }
      } else {
        proc.kill('SIGKILL');
      }
    }, 5000);
    try { await proc; } catch { /* expected */ }
    clearTimeout(forceTimer);
    process.stderr.write('[xci] Child process terminated.\n');
  };
  process.on('SIGINT', sigintHandler);

  try {
    const result = await proc;

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    if (logStream) {
      if (stdout) logStream.write(stdout + '\n');
      if (stderr) logStream.write(stderr + '\n');
      logStream.end();
    }

    if (interrupted) return { exitCode: 130, stdout: '' };
    if (result.failed && result.exitCode === undefined && result.cause) {
      throw new SpawnError(cmd, result.cause);
    }
    return { exitCode: result.exitCode ?? 1, stdout: stdout.trim() };
  } catch (err: unknown) {
    logStream?.end();
    if (interrupted) return { exitCode: 130, stdout: '' };
    if (err instanceof SpawnError) throw err;
    throw new SpawnError(cmd, err);
  } finally {
    process.off('SIGINT', sigintHandler);
  }
}

/**
 * Run a sequence of steps in order.
 * Steps with `capture` pipe stdout into a variable available to subsequent steps.
 * Validates captured values against type and assertions if configured.
 * Prints a step header (D-08) before each step.
 * Stops and returns the exit code of the first failing step (EXE-03).
 */
export async function runSequential(
  steps: readonly SequentialStep[],
  cwd: string,
  env: Record<string, string>,
  logFile?: string,
  showOutput = true,
  tailLines?: number,
  fromStep?: string,
): Promise<ExecutionResult> {
  const capturedVars: Record<string, string> = {};
  const totalSteps = steps.length;
  let stepNum = 0;
  let skipping = !!fromStep; // skip until we find the fromStep

  for (const step of steps) {
    stepNum++;

    // Determine step label for --from matching
    const stepLabel = step.kind === 'ini' ? `ini:${step.mode}`
      : step.kind === 'set' ? 'set'
      : (step.label ?? step.argv[0] ?? '(unknown)');

    // Check if this is the --from target
    if (skipping && stepLabel === fromStep) {
      skipping = false;
    }

    // Print skipped steps
    if (skipping) {
      printStepHeader(stepLabel, stepNum, totalSteps);
      printStepResult(stepLabel, 0, 0, 'SKIPPED');
      continue;
    }

    // Handle variable assignment steps
    if (step.kind === 'set') {
      printStepHeader('set', stepNum, totalSteps);
      const mergedValues = { ...env, ...capturedVars };
      for (const [key, rawValue] of Object.entries(step.vars)) {
        // Interpolate the value with available variables
        let resolved = interpolateArgv([rawValue], '(set)', mergedValues)[0] ?? rawValue;
        // Strip surrounding double quotes from JSON-resolved values
        if (resolved.length >= 2 && resolved.startsWith('"') && resolved.endsWith('"')) {
          resolved = resolved.slice(1, -1);
        }
        capturedVars[key] = resolved;
        const envKey = key.toUpperCase().replace(/[.\-]/g, '_');
        capturedVars[envKey] = resolved;
        process.stderr.write(`  ${key}=${resolved}\n`);
      }
      printStepResult('set', 0, 0);
      continue;
    }

    // Handle ini steps inline
    if (step.kind === 'ini') {
      const iniLabel = `ini:${step.mode}`;
      printStepHeader(iniLabel, stepNum, totalSteps);
      const startTime = Date.now();
      try {
        if (step.set) writeIni(step.file, step.set, step.mode);
        if (step.delete) deleteIniKeys(step.file, step.delete as Record<string, string[]>);
        process.stderr.write(`  ${step.file}\n`);
        if (step.set) {
          for (const [section, keys] of Object.entries(step.set)) {
            for (const [k, v] of Object.entries(keys)) {
              process.stderr.write(`    [${section}] ${k}=${v}\n`);
            }
          }
        }
        printStepResult(iniLabel, 0, Date.now() - startTime);
      } catch (err) {
        process.stderr.write(`  error: ${(err as Error).message}\n`);
        printStepResult(iniLabel, 1, Date.now() - startTime);
        return { exitCode: 1 };
      }
      continue;
    }

    // Re-interpolate argv with captured vars from prior steps
    const mergedValues = { ...env, ...capturedVars };
    const finalArgv = step.rawArgv
      ? interpolateArgv(step.rawArgv, '(step)', mergedValues)
      : step.argv;

    const stepCmd = step.label ?? finalArgv[0] ?? '(unknown)';
    printStepHeader(stepCmd, stepNum, totalSteps);
    printStepPreview(step.rawArgv, finalArgv, undefined, { verbose: env['XCI_VERBOSE'] === '1', logFile });

    // Merge captured variables into env for this step
    const stepEnv = { ...env, ...capturedVars };
    const startTime = Date.now();

    if (step.capture) {
      const cap = step.capture;
      // Capture mode: pipe stdout, store in variable
      const result = await runAndCapture(finalArgv, cwd, stepEnv, logFile);
      const elapsed = Date.now() - startTime;

      if (result.exitCode !== 0) {
        printStepResult(stepCmd, result.exitCode, elapsed);
        return { exitCode: result.exitCode };
      }

      // Print captured stdout so it's visible in the terminal
      if (result.stdout.length > 0 && showOutput) {
        process.stdout.write(result.stdout + '\n');
      }

      // Validate captured value
      const validation = validateCapture(result.stdout, cap);
      const isVerbose = stepEnv['XCI_VERBOSE'] === '1';
      printCaptureResult(cap, validation, isVerbose);

      if (!validation.valid) {
        printStepResult(stepCmd, 1, elapsed);
        return { exitCode: 1 };
      }

      // Store for subsequent steps (both dot-notation and UPPER_UNDERSCORE)
      capturedVars[cap.var] = validation.coerced;
      const envKey = cap.var.toUpperCase().replace(/[.\-]/g, '_');
      capturedVars[envKey] = validation.coerced;

      printStepResult(stepCmd, 0, elapsed);
    } else {
      const result = await runSingle(finalArgv, cwd, stepEnv, logFile, showOutput, tailLines);
      const elapsed = Date.now() - startTime;
      printStepResult(stepCmd, result.exitCode, elapsed);

      if (result.exitCode !== 0) {
        return result;
      }
    }
  }
  return { exitCode: 0 };
}
