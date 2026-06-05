// src/executor/sequential.ts
//
// Sequential chain execution: runs steps in order, stops at first non-zero exit (EXE-03).

import { execSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { createInterface } from 'node:readline';
import { execa } from 'execa';
import { SpawnError } from '../errors.js';

const IS_WINDOWS = process.platform === 'win32';
import { interpolateArgv } from '../resolver/interpolate.js';
import type { ExecutionResult, SequentialStep } from '../types.js';
import { extractFromOutput, validateCapture } from './capture.js';
import { writeIni, deleteIniKeys } from './ini.js';
import { notifyWaitingForInput, printCaptureResult, printStepHeader, printStepPreview, printStepResult, resetTerminalTitle, setTerminalTitle } from './output.js';
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
 * Read one line from stdin. Writes prompt message to stderr so it appears
 * even when stdout is piped. Resolves with the trimmed input.
 */
function promptUser(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl.question(`  ${message} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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
  secretValues?: ReadonlySet<string>,
): Promise<ExecutionResult> {
  const capturedVars: Record<string, string> = {};
  const totalSteps = steps.length;
  let stepNum = 0;
  let skipping = !!fromStep; // skip until we find the fromStep

  for (const step of steps) {
    stepNum++;

    // quick-260421-kbl: compute the true leaf label (used for --from matching
    // by leaf name — backward compat) and the breadcrumb-aware display label
    // that is rendered in step headers / results.
    const leafLabel = step.kind === 'ini' ? `ini:${step.mode}`
      : step.kind === 'set' ? 'set'
      : step.kind === 'prompt' ? `prompt:${step.var}`
      : (step.label ?? step.argv[0] ?? '(unknown)');
    const displayLabel = step.breadcrumb && step.breadcrumb.length > 0
      ? step.breadcrumb.join(' > ')
      : leafLabel;
    const alias = step.breadcrumb?.[0] ?? displayLabel;

    // Check if this is the --from target (match against leaf OR full path)
    if (skipping && (leafLabel === fromStep || displayLabel === fromStep)) {
      skipping = false;
    }

    // Print skipped steps
    if (skipping) {
      printStepHeader(displayLabel, stepNum, totalSteps);
      printStepResult(displayLabel, 0, 0, 'SKIPPED');
      continue;
    }

    // Handle variable assignment steps
    if (step.kind === 'set') {
      setTerminalTitle(`xci: ${alias} [${stepNum}/${totalSteps}] (set)`);
      printStepHeader(displayLabel, stepNum, totalSteps);
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
      printStepResult(displayLabel, 0, 0);
      continue;
    }

    // Handle prompt steps — pause and read user input from stdin
    if (step.kind === 'prompt') {
      setTerminalTitle(`xci: ${alias} [${stepNum}/${totalSteps}] (prompt)`);
      printStepHeader(displayLabel, stepNum, totalSteps);

      let value: string;
      if (!process.stdin.isTTY) {
        if (step.default !== undefined) {
          value = step.default;
          process.stderr.write(`  (non-interactive) using default: ${value}\n`);
        } else {
          process.stderr.write(`  error: prompt requires user input but stdin is not a TTY and no default is set\n`);
          printStepResult(displayLabel, 1, 0);
          resetTerminalTitle();
          return { exitCode: 1 };
        }
      } else {
        const message = step.message ?? `Enter value for ${step.var}:`;
        await notifyWaitingForInput(undefined, step.message);
        value = await promptUser(message);
        if (value === '' && step.default !== undefined) {
          value = step.default;
        }
      }

      capturedVars[step.var] = value;
      const envKey = step.var.toUpperCase().replace(/[.\-]/g, '_');
      capturedVars[envKey] = value;
      process.stderr.write(`  ${step.var}=${value}\n`);
      printStepResult(displayLabel, 0, 0);
      continue;
    }

    // Handle ini steps inline
    if (step.kind === 'ini') {
      setTerminalTitle(`xci: ${alias} [${stepNum}/${totalSteps}] (ini)`);
      printStepHeader(displayLabel, stepNum, totalSteps);
      const startTime = Date.now();
      // quick-260421-g99: resolve file relative to step.cwd ?? default cwd.
      const stepCwd = step.cwd ?? cwd;
      const mergedValues = { ...env, ...capturedVars };
      const rawFilePath = isAbsolute(step.file) ? step.file : resolvePath(stepCwd, step.file);
      const filePath = interpolateArgv([rawFilePath], '(ini)', mergedValues)[0] ?? rawFilePath;
      // Re-interpolate set values with capturedVars so runtime assignments like
      // BuildEnv="Trailer" are expanded before writing to the ini file.
      let resolvedSet: Record<string, Record<string, string>> | undefined;
      if (step.set) {
        resolvedSet = {};
        for (const [section, keys] of Object.entries(step.set)) {
          resolvedSet[section] = {};
          for (const [k, v] of Object.entries(keys)) {
            resolvedSet[section][k] = interpolateArgv([v], '(ini)', mergedValues)[0] ?? v;
          }
        }
      }
      try {
        if (resolvedSet) writeIni(filePath, resolvedSet, step.mode);
        if (step.delete) deleteIniKeys(filePath, step.delete as Record<string, string[]>);
        process.stderr.write(`  ${filePath}\n`);
        if (resolvedSet) {
          for (const [section, keys] of Object.entries(resolvedSet)) {
            for (const [k, v] of Object.entries(keys)) {
              process.stderr.write(`    [${section}] ${k}=${v}\n`);
            }
          }
        }
        printStepResult(displayLabel, 0, Date.now() - startTime);
      } catch (err) {
        process.stderr.write(`  error: ${(err as Error).message}\n`);
        printStepResult(displayLabel, 1, Date.now() - startTime);
        resetTerminalTitle();
        return { exitCode: 1 };
      }
      continue;
    }

    // Re-interpolate argv with captured vars from prior steps
    const mergedValues = { ...env, ...capturedVars };
    const finalArgv = step.rawArgv
      ? interpolateArgv(step.rawArgv, '(step)', mergedValues)
      : step.argv;

    // quick-260421-g99: per-step cwd override (absolute when set by resolveAbsoluteCwds).
    // quick-260422-mxr: declared before printStepPreview so preview always shows
    // the EFFECTIVE spawn cwd (own override or inherited/default), never hides it.
    const stepSpawnCwd = step.cwd ?? cwd;

    const stepCmd = displayLabel;
    const rawCmd = finalArgv.join(' ');
    const shortCmd = rawCmd.length > 60 ? `${rawCmd.slice(0, 57)}…` : rawCmd;
    setTerminalTitle(`xci: ${alias} [${stepNum}/${totalSteps}] ${shortCmd}`);
    printStepHeader(stepCmd, stepNum, totalSteps);
    printStepPreview(step.rawArgv, finalArgv, secretValues, {
      verbose: env['XCI_VERBOSE'] === '1',
      ...(logFile !== undefined ? { logFile } : {}),
      cwd: stepSpawnCwd,
    });

    // Merge captured variables into env for this step
    const stepEnv = { ...env, ...capturedVars };
    const startTime = Date.now();

    if (step.capture) {
      const cap = step.capture;
      // Capture mode: pipe stdout, store in variable
      const result = await runAndCapture(finalArgv, stepSpawnCwd, stepEnv, logFile);
      const elapsed = Date.now() - startTime;

      if (result.exitCode !== 0) {
        printStepResult(stepCmd, result.exitCode, elapsed);
        resetTerminalTitle();
        return { exitCode: result.exitCode };
      }

      // Print captured stdout so it's visible in the terminal
      if (result.stdout.length > 0 && showOutput) {
        process.stdout.write(result.stdout + '\n');
      }

      // Validate captured value (apply regex extraction first if configured)
      const validation = validateCapture(extractFromOutput(result.stdout, cap), cap);
      const isVerbose = stepEnv['XCI_VERBOSE'] === '1';
      printCaptureResult(cap, validation, isVerbose);

      if (!validation.valid) {
        printStepResult(stepCmd, 1, elapsed);
        resetTerminalTitle();
        return { exitCode: 1 };
      }

      // Store for subsequent steps (both dot-notation and UPPER_UNDERSCORE)
      capturedVars[cap.var] = validation.coerced;
      const envKey = cap.var.toUpperCase().replace(/[.\-]/g, '_');
      capturedVars[envKey] = validation.coerced;

      printStepResult(stepCmd, 0, elapsed);
    } else {
      const result = await runSingle(finalArgv, stepSpawnCwd, stepEnv, logFile, showOutput, tailLines);
      const elapsed = Date.now() - startTime;
      printStepResult(stepCmd, result.exitCode, elapsed);

      if (result.exitCode !== 0) {
        resetTerminalTitle();
        return result;
      }
    }
  }
  resetTerminalTitle();
  return { exitCode: 0 };
}
