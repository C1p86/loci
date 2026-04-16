// src/tui/dashboard.ts
//
// Execution dashboard — split-panel TUI showing command status + scrollable log.
// Supports single, sequential, and parallel execution plans.

import { execa } from 'execa';
import type { ReadStream } from 'node:tty';
import { SpawnError } from '../errors.js';
import { validateCapture } from '../executor/capture.js';
import type { CommandMap, ExecutionPlan, ExecutionResult, ResolvedConfig } from '../types.js';
import { interpolateArgv, resolver } from '../resolver/index.js';
import { color, cursor, screen, box, write, termSize, stripAnsi } from './ansi.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommandStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'skipped';

interface CommandEntry {
  label: string;
  status: CommandStatus;
  exitCode?: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let commands: CommandEntry[] = [];
let logLines: string[] = [];
let logScrollOffset = 0;
let leftPanelWidth = 0;
let isExecuting = false;
let lastExitCode = 0;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function statusIcon(status: CommandStatus): string {
  switch (status) {
    case 'pending':  return `${color.dim}○${color.reset}`;
    case 'running':  return `${color.yellow}▶${color.reset}`;
    case 'success':  return `${color.green}✓${color.reset}`;
    case 'failed':   return `${color.red}✗${color.reset}`;
    case 'canceled': return `${color.gray}⊘${color.reset}`;
    case 'skipped':  return `${color.gray}–${color.reset}`;
  }
}

function statusColor(status: CommandStatus): string {
  switch (status) {
    case 'pending':  return color.dim;
    case 'running':  return color.yellow;
    case 'success':  return color.green;
    case 'failed':   return color.red;
    case 'canceled': return color.gray;
    case 'skipped':  return color.gray;
  }
}

/**
 * Build a plain string of exactly `width` characters from `text`.
 * Truncates with '…' or pads with spaces. Assumes `text` has no ANSI codes.
 */
function pad(text: string, width: number): string {
  if (text.length > width) return text.slice(0, width - 1) + '\u2026';
  if (text.length < width) return text + ' '.repeat(width - text.length);
  return text;
}

function renderFrame(): void {
  const { cols, rows } = termSize();
  leftPanelWidth = Math.max(24, Math.min(40, Math.floor(cols * 0.3)));
  const rightWidth = cols - leftPanelWidth - 3; // 3 for │ left │ divider │ right │
  const contentRows = rows - 4; // top border + header + bottom border + status bar

  const buf: string[] = [];

  // Top border (plain box drawing — no ANSI color math needed)
  const leftHeader = ` Commands ${box.horizontal.repeat(Math.max(0, leftPanelWidth - 11))}`;
  const rightHeader = ` Output ${box.horizontal.repeat(Math.max(0, rightWidth - 8))}`;
  buf.push(`${color.dim}${box.topLeft}${box.horizontal}${leftHeader}${box.teeDown}${box.horizontal}${rightHeader}${box.topRight}${color.reset}`);

  // Content rows — build each cell as plain text, then wrap with color
  for (let row = 0; row < contentRows; row++) {
    // Left cell: status icon + label, exactly leftPanelWidth chars
    let leftPlain = '';
    let leftStyled = '';
    if (row < commands.length) {
      const cmd = commands[row];
      const exitSuffix = cmd.exitCode !== undefined && cmd.status === 'failed'
        ? ` (${cmd.exitCode})` : '';
      // Icon takes 1 char visually; build plain text first for padding
      const iconChar = ({ pending: 'o', running: '>', success: 'v', failed: 'x', canceled: '-', skipped: '-' })[cmd.status];
      leftPlain = ` ${iconChar} ${cmd.label}${exitSuffix}`;
      leftPlain = pad(leftPlain, leftPanelWidth);
      // Now rebuild with ANSI colors using same structure
      const icon = statusIcon(cmd.status);
      const sColor = statusColor(cmd.status);
      const labelPart = pad(`${cmd.label}${exitSuffix}`, leftPanelWidth - 3); // 3 = space + icon + space
      leftStyled = ` ${icon} ${sColor}${labelPart}${color.reset}`;
    } else {
      leftPlain = ' '.repeat(leftPanelWidth);
      leftStyled = leftPlain;
    }

    // Right cell: log line, exactly rightWidth chars (log lines are already ANSI-stripped)
    let rightStyled = '';
    const logIdx = logScrollOffset + row;
    if (logIdx < logLines.length) {
      rightStyled = ' ' + pad(logLines[logIdx], rightWidth - 1);
    } else {
      rightStyled = ' '.repeat(rightWidth);
    }

    buf.push(`${color.dim}${box.vertical}${color.reset}${leftStyled}${color.dim}${box.vertical}${color.reset}${rightStyled}${color.dim}${box.vertical}${color.reset}`);
  }

  // Bottom border with keybindings
  const keys = isExecuting
    ? `${color.dim} Ctrl+C exit ${color.reset}`
    : `${color.dim} r rerun  n new command  ↑↓ scroll  Ctrl+C exit ${color.reset}`;
  const keysPlain = isExecuting
    ? ' Ctrl+C exit '
    : ' r rerun  n new command  ↑↓ scroll  Ctrl+C exit ';
  const borderLen = leftPanelWidth + rightWidth + 1; // +1 for middle divider
  const keysLen = keysPlain.length;
  const leftBorder = Math.max(1, Math.floor((borderLen - keysLen) / 2));
  const rightBorder = Math.max(0, borderLen - keysLen - leftBorder);
  buf.push(`${color.dim}${box.bottomLeft}${box.horizontal.repeat(leftBorder)}${color.reset}${keys}${color.dim}${box.horizontal.repeat(rightBorder)}${box.bottomRight}${color.reset}`);

  // Status bar
  const running = commands.filter((c) => c.status === 'running').length;
  const done = commands.filter((c) => c.status === 'success' || c.status === 'failed').length;
  const total = commands.length;
  let statusText: string;
  if (running > 0) {
    statusText = `  ${color.yellow}> ${running} running${color.reset}  ${color.dim}${done}/${total} done${color.reset}`;
  } else if (lastExitCode !== 0) {
    statusText = `  ${color.red}x exit ${lastExitCode}${color.reset}  ${color.dim}${done}/${total} done${color.reset}`;
  } else {
    statusText = `  ${color.green}${done}/${total} done${color.reset}`;
  }
  buf.push(statusText);

  // Write entire frame at once to reduce flicker
  write(cursor.moveTo(1, 1) + screen.clearDown + buf.join('\n'));
}

/**
 * Strip ANSI escape codes and control characters, normalize for display.
 */
function sanitize(s: string): string {
  return stripAnsi(s)
    .replace(/\r/g, '')           // carriage returns (progress bars)
    .replace(/\t/g, '    ')       // tabs → 4 spaces
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''); // other control chars
}

function appendLog(line: string): void {
  const clean = sanitize(line);
  // Split on newlines, then also handle \r-separated chunks (progress overwrite)
  const lines = clean.split('\n');
  for (const l of lines) {
    if (l.length > 0 || logLines.length > 0) {
      logLines.push(l);
    }
  }
  // Auto-scroll to bottom
  const { rows } = termSize();
  const contentRows = rows - 4;
  if (logLines.length > contentRows) {
    logScrollOffset = logLines.length - contentRows;
  }
}

// Throttle rendering: max ~30fps to avoid overlapping writes
let renderTimer: ReturnType<typeof setTimeout> | null = null;
let renderPending = false;

function scheduleRender(): void {
  renderPending = true;
  if (renderTimer !== null) return; // already scheduled
  renderTimer = setTimeout(() => {
    renderTimer = null;
    if (renderPending) {
      renderPending = false;
      renderFrame();
    }
  }, 33); // ~30fps
}

function flushRender(): void {
  if (renderTimer !== null) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  renderPending = false;
  renderFrame();
}

function updateCommand(index: number, status: CommandStatus, exitCode?: number): void {
  if (commands[index]) {
    commands[index].status = status;
    if (exitCode !== undefined) commands[index].exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// Build command entries from plan
// ---------------------------------------------------------------------------

function buildEntries(plan: ExecutionPlan): CommandEntry[] {
  switch (plan.kind) {
    case 'single':
      return [{ label: plan.argv[0] ?? '(cmd)', status: 'pending' }];
    case 'sequential':
      return plan.steps.map((step) => ({
        label: step.argv[0] ?? '(step)',
        status: 'pending' as CommandStatus,
      }));
    case 'parallel':
      return plan.group.map((entry) => ({
        label: entry.alias,
        status: 'pending' as CommandStatus,
      }));
  }
}

// ---------------------------------------------------------------------------
// Execution with dashboard
// ---------------------------------------------------------------------------

interface CaptureResult extends ExecutionResult {
  captured?: string;
}

async function runWithCapture(
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
  prefix?: string,
): Promise<CaptureResult> {
  const [cmd, ...args] = argv;
  if (!cmd) throw new SpawnError('(empty command)', new Error('argv is empty'));

  const proc = execa(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
    reject: false,
  });

  const pfx = prefix ? `[${prefix}] ` : '';
  const stdoutChunks: string[] = [];

  // Stream stdout/stderr into log panel (appendLog sanitizes for reliable width)
  proc.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    stdoutChunks.push(text);
    for (const line of text.split('\n')) {
      if (line.length > 0) appendLog(pfx + line);
    }
    scheduleRender();
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.length > 0) appendLog(pfx + line);
    }
    scheduleRender();
  });

  const result = await proc;

  if (result.failed && result.exitCode === undefined && result.cause) {
    throw new SpawnError(cmd, result.cause);
  }
  return {
    exitCode: result.exitCode ?? 1,
    captured: stdoutChunks.join('').trim(),
  };
}

async function execSingle(
  plan: Extract<ExecutionPlan, { kind: 'single' }>,
  cwd: string,
  env: Record<string, string>,
): Promise<ExecutionResult> {
  updateCommand(0, 'running');
  flushRender();
  try {
    const result = await runWithCapture(plan.argv, cwd, env);
    updateCommand(0, result.exitCode === 0 ? 'success' : 'failed', result.exitCode);
    flushRender();
    return result;
  } catch (err) {
    updateCommand(0, 'failed', 1);
    flushRender();
    throw err;
  }
}

async function execSequential(
  plan: Extract<ExecutionPlan, { kind: 'sequential' }>,
  cwd: string,
  env: Record<string, string>,
): Promise<ExecutionResult> {
  const capturedVars: Record<string, string> = {};

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];

    // Re-interpolate with captured vars from prior steps
    const mergedValues = { ...env, ...capturedVars };
    const finalArgv = step.rawArgv
      ? interpolateArgv(step.rawArgv, '(step)', mergedValues)
      : step.argv;

    updateCommand(i, 'running');
    appendLog(`-- step ${i + 1}/${plan.steps.length}: ${finalArgv[0]} --`);
    flushRender();

    const stepEnv = { ...env, ...capturedVars };

    try {
      const result = await runWithCapture(finalArgv, cwd, stepEnv);
      if (result.exitCode !== 0) {
        updateCommand(i, 'failed', result.exitCode);
        for (let j = i + 1; j < plan.steps.length; j++) {
          updateCommand(j, 'skipped');
        }
        flushRender();
        return result;
      }
      // Handle capture: validate and store stdout for subsequent steps
      if (step.capture && result.captured !== undefined) {
        const cap = step.capture;
        const validation = validateCapture(result.captured, cap);
        const typeName = cap.type ?? 'string';
        appendLog(`--- capture: ${cap.var} ---`);
        appendLog(`  value: ${validation.coerced}`);
        appendLog(`  type:  ${typeName}`);
        if (cap.assert) {
          const asserts = typeof cap.assert === 'string' ? [cap.assert] : cap.assert;
          appendLog(`  assert: ${asserts.join(', ')}`);
        }
        if (validation.valid) {
          appendLog(`  PASS`);
        } else {
          appendLog(`  FAIL: ${validation.error}`);
          appendLog(`--- end capture ---`);
          updateCommand(i, 'failed', 1);
          for (let j = i + 1; j < plan.steps.length; j++) {
            updateCommand(j, 'skipped');
          }
          flushRender();
          return { exitCode: 1 };
        }
        appendLog(`--- end capture ---`);
        capturedVars[cap.var] = validation.coerced;
        const envKey = cap.var.toUpperCase().replace(/\./g, '_');
        capturedVars[envKey] = validation.coerced;
      }
      updateCommand(i, 'success');
      flushRender();
    } catch (err) {
      updateCommand(i, 'failed', 1);
      for (let j = i + 1; j < plan.steps.length; j++) {
        updateCommand(j, 'skipped');
      }
      flushRender();
      throw err;
    }
  }
  return { exitCode: 0 };
}

async function execParallel(
  plan: Extract<ExecutionPlan, { kind: 'parallel' }>,
  cwd: string,
  env: Record<string, string>,
): Promise<ExecutionResult> {
  const controller = new AbortController();
  const { signal } = controller;

  // Mark all as running
  for (let i = 0; i < plan.group.length; i++) {
    updateCommand(i, 'running');
  }
  flushRender();

  const promises = plan.group.map(async (entry, idx) => {
    const [cmd, ...args] = entry.argv;
    if (!cmd) throw new SpawnError('(empty command)', new Error('argv is empty'));

    const pfx = `[${entry.alias}] `;

    const proc = execa(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
      cancelSignal: signal,
      forceKillAfterDelay: 3000,
      reject: false,
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.length > 0) appendLog(pfx + line);
      }
      scheduleRender();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.length > 0) appendLog(pfx + line);
      }
      scheduleRender();
    });

    const result = await proc;

    if (result.isCanceled) {
      updateCommand(idx, 'canceled');
      flushRender();
      return { exitCode: 0 };
    }

    const exitCode = result.exitCode ?? 1;
    updateCommand(idx, exitCode === 0 ? 'success' : 'failed', exitCode);

    if (exitCode !== 0 && plan.failMode === 'fast') {
      controller.abort(new Error('fail-fast'));
    }

    flushRender();
    return { exitCode };
  });

  const results = await Promise.allSettled(promises);

  let firstFail = 0;
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.exitCode !== 0 && firstFail === 0) {
      firstFail = r.value.exitCode;
    } else if (r.status === 'rejected' && firstFail === 0) {
      firstFail = 1;
    }
  }

  return { exitCode: firstFail };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a plan and update the dashboard state.
 */
async function executePlan(
  plan: ExecutionPlan,
  cwd: string,
  env: Record<string, string>,
): Promise<ExecutionResult> {
  commands = buildEntries(plan);
  logLines = [];
  logScrollOffset = 0;
  isExecuting = true;
  lastExitCode = 0;
  flushRender();

  let result: ExecutionResult;
  switch (plan.kind) {
    case 'single':
      result = await execSingle(plan, cwd, env);
      break;
    case 'sequential':
      result = await execSequential(plan, cwd, env);
      break;
    case 'parallel':
      result = await execParallel(plan, cwd, env);
      break;
  }

  isExecuting = false;
  lastExitCode = result.exitCode;
  flushRender();
  return result;
}

export interface DashboardContext {
  commandMap: CommandMap;
  config: ResolvedConfig;
  cwd: string;
  env: Record<string, string>;
}

/**
 * Run an execution plan with the TUI dashboard.
 * Stays open after execution — user can scroll log, rerun, pick another command, or Ctrl+C to exit.
 */
export async function runWithDashboard(
  plan: ExecutionPlan,
  cwd: string,
  env: Record<string, string>,
  ctx?: DashboardContext,
): Promise<ExecutionResult> {
  // Enter alternate buffer
  write(screen.altBuffer + cursor.hide + screen.clear);

  let currentResult: ExecutionResult;
  try {
    currentResult = await executePlan(plan, cwd, env);
  } catch (err) {
    write(cursor.show + screen.mainBuffer);
    throw err;
  }

  // Interactive loop — stay open until Ctrl+C
  const finalResult = await interactiveLoop(currentResult, cwd, env, ctx);

  // Restore terminal
  write(cursor.show + screen.mainBuffer);

  // Print compact summary
  printSummary(finalResult);

  return finalResult;
}

function printSummary(result: ExecutionResult): void {
  for (const cmd of commands) {
    const icon = cmd.status === 'success' ? `${color.green}v${color.reset}`
      : cmd.status === 'failed' ? `${color.red}x${color.reset}`
      : cmd.status === 'skipped' ? `${color.gray}-${color.reset}`
      : cmd.status === 'canceled' ? `${color.gray}-${color.reset}`
      : `${color.dim}o${color.reset}`;
    const exitStr = cmd.exitCode !== undefined && cmd.status === 'failed'
      ? ` ${color.dim}(exit ${cmd.exitCode})${color.reset}` : '';
    write(`${icon} ${cmd.label}${exitStr}\n`);
  }
  if (result.exitCode !== 0) {
    write(`\n${color.red}Exited with code ${result.exitCode}${color.reset}\n`);
  }
}

/**
 * Interactive loop after execution. Handles:
 *   r     — rerun the same plan
 *   n     — pick a new alias (if ctx provided)
 *   ↑/↓   — scroll log
 *   Ctrl+C — exit
 */
function interactiveLoop(
  currentResult: ExecutionResult,
  cwd: string,
  env: Record<string, string>,
  ctx?: DashboardContext,
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const stdin = process.stdin as ReadStream;
    if (!stdin.isTTY) {
      resolve(currentResult);
      return;
    }

    let result = currentResult;
    let lastPlan: ExecutionPlan | null = null;

    // Save the current plan entries for rerun
    const savedPlanEntries = [...commands];

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    function cleanup(): void {
      stdin.removeListener('data', onKey);
      try {
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
      } catch {
        // ignore
      }
    }

    async function onKey(data: Buffer): Promise<void> {
      const key = data.toString();

      // Ctrl+C → exit
      if (key === '\x03') {
        cleanup();
        resolve(result);
        return;
      }

      // Arrow up — scroll log up
      if (key === '\x1b[A' || key === 'k') {
        if (logScrollOffset > 0) {
          logScrollOffset--;
          flushRender();
        }
        return;
      }

      // Arrow down — scroll log down
      if (key === '\x1b[B' || key === 'j') {
        const { rows } = termSize();
        const contentRows = rows - 4;
        if (logScrollOffset < logLines.length - contentRows) {
          logScrollOffset++;
          flushRender();
        }
        return;
      }

      // Page Up
      if (key === '\x1b[5~') {
        const { rows } = termSize();
        const contentRows = rows - 4;
        logScrollOffset = Math.max(0, logScrollOffset - contentRows);
        flushRender();
        return;
      }

      // Page Down
      if (key === '\x1b[6~') {
        const { rows } = termSize();
        const contentRows = rows - 4;
        logScrollOffset = Math.min(
          Math.max(0, logLines.length - contentRows),
          logScrollOffset + contentRows,
        );
        flushRender();
        return;
      }

      // 'r' — rerun last plan
      if (key === 'r' || key === 'R') {
        if (isExecuting) return;
        // Rebuild the plan from saved entries
        stdin.removeListener('data', onKey);
        try {
          // Re-resolve the same alias
          const firstLabel = savedPlanEntries[0]?.label;
          if (firstLabel && ctx) {
            const plan = resolver.resolve(firstLabel, ctx.commandMap, ctx.config);
            result = await executePlan(plan, cwd, env);
          }
        } catch {
          // ignore errors, stay in loop
        }
        stdin.on('data', onKey);
        return;
      }

      // 'n' — pick new command
      if ((key === 'n' || key === 'N') && ctx) {
        if (isExecuting) return;
        stdin.removeListener('data', onKey);

        // Show inline picker
        const aliases = [...ctx.commandMap.keys()];
        const selected = await showInlinePicker(aliases);
        if (selected) {
          try {
            const plan = resolver.resolve(selected, ctx.commandMap, ctx.config);
            result = await executePlan(plan, cwd, env);
          } catch {
            // ignore
          }
        }
        stdin.on('data', onKey);
        return;
      }
    }

    stdin.on('data', onKey);
  });
}

/**
 * Inline alias picker that renders in the log panel area.
 */
function showInlinePicker(aliases: string[]): Promise<string | null> {
  return new Promise((resolveP) => {
    const stdin = process.stdin as ReadStream;
    let selected = 0;

    function renderPickerOverlay(): void {
      // Temporarily replace log with picker
      const savedLog = [...logLines];
      const savedOffset = logScrollOffset;
      logLines = ['', '  Select alias:', ''];
      for (let i = 0; i < aliases.length; i++) {
        const pointer = i === selected ? '> ' : '  ';
        logLines.push(`  ${pointer}${aliases[i]}`);
      }
      logLines.push('', '  Enter=select  Esc=cancel');
      logScrollOffset = 0;
      flushRender();
      // Restore log (will be overwritten on next action)
      logLines = savedLog;
      logScrollOffset = savedOffset;
    }

    renderPickerOverlay();

    function onKey(data: Buffer): void {
      const key = data.toString();

      if (key === '\x1b' || key === 'q') {
        stdin.removeListener('data', onKey);
        flushRender();
        resolveP(null);
        return;
      }

      if (key === '\r' || key === '\n') {
        stdin.removeListener('data', onKey);
        flushRender();
        resolveP(aliases[selected]);
        return;
      }

      if (key === '\x03') {
        stdin.removeListener('data', onKey);
        flushRender();
        resolveP(null);
        return;
      }

      if (key === '\x1b[A' || key === 'k') {
        selected = Math.max(0, selected - 1);
        renderPickerOverlay();
      } else if (key === '\x1b[B' || key === 'j') {
        selected = Math.min(aliases.length - 1, selected + 1);
        renderPickerOverlay();
      }
    }

    stdin.on('data', onKey);
  });
}
