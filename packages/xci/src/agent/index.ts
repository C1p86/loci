// packages/xci/src/agent/index.ts
// Full agent daemon — replaces the Plan 01 stub (08-04).
// Lazy-loaded from cli.ts when --agent is found in argv (D-02).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { AgentModeArgsError } from '../errors.js';
import { tokenize } from '../commands/tokenize.js';
import { AgentClient } from './client.js';
import {
  credentialPath,
  loadCredential,
  type StoredCredential,
  saveCredential,
} from './credential.js';
import { detectLabels } from './labels.js';
import { spawnTask } from './runner.js';
import { createAgentState } from './state.js';
import type { AgentFrame, RunState, TaskSnapshot } from './types.js';
import { normalizeAgentUrl } from './url.js';

interface ParsedFlags {
  agent: string; // server WS URL
  token?: string;
  labels: string[];
  hostname?: string;
  configDir?: string;
  maxConcurrent: number;
  help: boolean;
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const flags: ParsedFlags = { agent: '', labels: [], maxConcurrent: 1, help: false };
  // argv is process.argv-style: [node, scriptPath, ...userArgs]
  // We accept index >= 2 but also handle being called with just user args.
  const start = argv[0]?.endsWith('node') || argv[0]?.endsWith('.mjs') ? 2 : 0;
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    switch (a) {
      case '--agent':
        flags.agent = argv[++i] ?? '';
        break;
      case '--token':
        flags.token = argv[++i];
        break;
      case '--label': {
        const v = argv[++i];
        if (v) flags.labels.push(v);
        break;
      }
      case '--hostname':
        flags.hostname = argv[++i];
        break;
      case '--config-dir':
        flags.configDir = argv[++i];
        break;
      case '--max-concurrent': {
        const raw = argv[++i];
        const n = raw !== undefined ? parseInt(raw, 10) : NaN;
        if (Number.isNaN(n) || n < 1) {
          throw new AgentModeArgsError('--max-concurrent must be a positive integer');
        }
        flags.maxConcurrent = n;
        break;
      }
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        // Ignore unknown flags — alias names may appear in argv when called in error; handled below
        break;
    }
  }
  return flags;
}

function printHelp(): void {
  process.stdout.write(
    'xci --agent <url> [--token <reg-token>] [options]\n\n' +
      'Daemon mode: connects to a server via WebSocket and awaits dispatches.\n\n' +
      'Flags:\n' +
      '  --agent <url>             Server WS URL (required). Example: wss://xci.example.com/ws/agent\n' +
      '  --token <reg-token>       Registration token (first-run only; omit on subsequent runs)\n' +
      '  --label key=value         Custom label (repeatable)\n' +
      '  --hostname <name>         Override auto-detected hostname\n' +
      '  --config-dir <path>       Override credential storage directory\n' +
      '                            (default: env-paths xci config location)\n' +
      '  --max-concurrent <n>      Maximum simultaneous task dispatches (default: 1)\n' +
      '  --help, -h                Show this help\n' +
      '\nCredential file location by OS:\n' +
      '  Linux:   ~/.config/xci/agent.json\n' +
      '  macOS:   ~/Library/Preferences/xci/agent.json\n' +
      '  Windows: %APPDATA%\\xci\\Config\\agent.json\n',
  );
}

/**
 * Load agent-local .xci/secrets.yml from the given cwd.
 * Returns an empty record if the file doesn't exist.
 * Per SEC-06: agent-local secrets WIN over dispatched params on collision.
 * Called on every dispatch (not cached) so file changes are picked up.
 */
function loadLocalSecrets(cwd: string): Record<string, string> {
  const secretsPath = join(cwd, '.xci', 'secrets.yml');
  let raw: string;
  try {
    raw = readFileSync(secretsPath, 'utf8');
  } catch {
    return {}; // missing file is OK
  }
  try {
    const parsed = parse(raw);
    if (parsed === null || parsed === undefined) return {};
    if (typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // Flatten one level: only string values
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Parse yaml_definition string into argv.
 * Returns null if the YAML represents a sequence/parallel (unsupported).
 */
function parseYamlToArgv(
  yamlDef: string,
): { argv: readonly string[] } | { unsupported: string } {
  let parsed: unknown;
  try {
    parsed = parse(yamlDef);
  } catch {
    // Treat as raw string command
    parsed = yamlDef;
  }

  if (typeof parsed === 'string') {
    // "echo hello" → tokenize
    const argv = tokenize(parsed, '<dispatched>');
    if (argv.length === 0) return { unsupported: 'empty command string' };
    return { argv };
  }

  if (Array.isArray(parsed)) {
    // ["node", "-e", "..."] — all elements must be strings
    if (parsed.every((x) => typeof x === 'string')) {
      return { argv: parsed as string[] };
    }
    return { unsupported: 'array contains non-string elements' };
  }

  if (typeof parsed === 'object' && parsed !== null) {
    // Object shape: sequence/parallel — not supported in Phase 10
    return {
      unsupported:
        'sequence/parallel task dispatch not supported in Phase 10; use a single-command yaml_definition',
    };
  }

  return { unsupported: `unexpected yaml_definition type: ${typeof parsed}` };
}

export async function runAgent(argv: readonly string[]): Promise<number> {
  const flags = parseFlags(argv);

  if (flags.help) {
    printHelp();
    return 0;
  }
  if (!flags.agent) {
    throw new AgentModeArgsError('--agent <url> is required');
  }

  // Normalize to canonical ws(s)://host[:port]/ws/agent form.
  // Throws AgentModeArgsError for unparseable input; propagates through
  // the existing cli.ts catch-all that renders AgentModeArgsError.
  const normalizedUrl = normalizeAgentUrl(flags.agent);

  // TOFU: --token AND credential file present → error (D-09)
  const existingCred = await loadCredential(flags.configDir);
  if (existingCred && flags.token) {
    throw new AgentModeArgsError(
      `Agent already registered at ${credentialPath(flags.configDir)}. ` +
        'To re-register, delete the credential file and retry.',
    );
  }

  const rawLabels = detectLabels(flags.labels);
  if (flags.hostname) rawLabels.hostname = flags.hostname;
  const labels = rawLabels;

  const state = createAgentState(flags.maxConcurrent);

  let resolveExit!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  let exiting = false;
  let client: AgentClient | null = null;

  /** Serialize runningRuns Map → RunState[] for frame payloads */
  function getRunningRunsArray(): RunState[] {
    return Array.from(state.runningRuns.entries()).map(([run_id]) => ({
      run_id,
      status: 'running' as const,
    }));
  }

  async function handleDispatch(frame: {
    type: 'dispatch';
    run_id: string;
    task_snapshot: TaskSnapshot;
    params: Record<string, string>;
    timeout_seconds: number;
  }): Promise<void> {
    if (!client) return;

    // D-16: drain check
    if (state.draining) {
      client.send({
        type: 'error',
        code: 'AGENT_DRAINING',
        message: 'agent is draining — no new dispatches accepted',
        close: false,
      });
      return;
    }

    // D-15: concurrency cap
    if (state.runningRuns.size >= state.maxConcurrent) {
      client.send({
        type: 'error',
        code: 'AGENT_AT_CAPACITY',
        message: `agent at max concurrency (${state.maxConcurrent})`,
        close: false,
      });
      return;
    }

    // Parse yaml_definition → argv
    const parseResult = parseYamlToArgv(frame.task_snapshot.yaml_definition);
    if ('unsupported' in parseResult) {
      client.send({
        type: 'error',
        code: 'AGENT_UNSUPPORTED_TASK',
        message: parseResult.unsupported,
        close: false,
      });
      return;
    }
    const { argv: taskArgv } = parseResult;

    // SEC-06: load agent-local secrets; agent-local WINS on collision
    const localSecrets = loadLocalSecrets(process.cwd());
    const mergedEnv: Record<string, string> = { ...frame.params, ...localSecrets };

    // D-08/D-24: build redaction list from agent-local secrets (min 4 chars per D-05 parity)
    const redactionValues = Object.values(localSecrets).filter(
      (v): v is string => typeof v === 'string' && v.length >= 4,
    );

    // Send state:running ack
    client.send({ type: 'state', state: 'running', run_id: frame.run_id });

    // Spawn task
    const handle = spawnTask(frame.run_id, {
      argv: taskArgv,
      cwd: process.cwd(),
      env: mergedEnv,
      redactionValues,
      onChunk: (stream, data, seq) => {
        client?.send({
          type: 'log_chunk',
          run_id: frame.run_id,
          seq,
          stream,
          data,
          ts: new Date().toISOString(),
        });
      },
      onExit: (exit_code, duration_ms, cancelled) => {
        state.runningRuns.delete(frame.run_id);
        client?.send({
          type: 'result',
          run_id: frame.run_id,
          exit_code,
          duration_ms,
          ...(cancelled ? { cancelled: true } : {}),
        });
      },
    });

    state.runningRuns.set(frame.run_id, {
      handle,
      startedAt: new Date().toISOString(),
      taskSnapshot: frame.task_snapshot,
    });
  }

  async function handleCancel(frame: {
    type: 'cancel';
    run_id: string;
    reason: string;
  }): Promise<void> {
    const entry = state.runningRuns.get(frame.run_id);
    if (!entry) {
      // Stale cancel from a prior session — the run's result frame never reached
      // the server (agent crashed or disconnected mid-run), so the server still
      // has the row in dispatched/running state and its timer just fired. Reply
      // with a synthetic cancelled result: server's handleResultFrame will CAS
      // (['running','dispatched'] → cancelled); if the server already moved the
      // row to a terminal state, the CAS misses and it logs debug. Either way
      // the ghost is cleaned up — no stderr warning needed.
      client?.send({
        type: 'result',
        run_id: frame.run_id,
        exit_code: -1,
        duration_ms: 0,
        cancelled: true,
      });
      return;
    }
    // Cancel triggers the runner's SIGTERM/SIGKILL sequence; runner's onExit fires
    // with cancelled=true, which sends the result frame (single sender — no race)
    await entry.handle.cancel();
  }

  async function handleMessage(frame: AgentFrame): Promise<void> {
    switch (frame.type) {
      case 'register_ack': {
        // Persist credential (ATOK-02)
        const cred: StoredCredential = {
          version: 1,
          server_url: normalizedUrl,
          agent_id: frame.agent_id,
          credential: frame.credential,
          registered_at: new Date().toISOString(),
        };
        try {
          await saveCredential(cred, flags.configDir);
        } catch (err) {
          process.stderr.write(`[agent] failed to save credential: ${(err as Error).message}\n`);
          // Server-side registration already happened; credential is lost locally.
          // Must re-register. Exit non-zero.
          client?.close();
          resolveExit(1);
          return;
        }
        process.stderr.write(`[agent] registered as ${frame.agent_id}\n`);
        break;
      }
      case 'reconnect_ack':
        process.stderr.write(
          `[agent] reconnected (reconciliation: ${frame.reconciliation.length} entries)\n`,
        );
        // Handle server-directed abandonment: kill any runs the server wants stopped
        for (const entry of frame.reconciliation) {
          if (entry.action === 'abandon') {
            const run = state.runningRuns.get(entry.run_id);
            if (run) {
              process.stderr.write(`[agent] abandoning run ${entry.run_id} per server reconciliation\n`);
              void run.handle.cancel();
            }
          }
        }
        break;
      case 'state':
        if ('run_id' in frame) {
          // Incoming state:running from ourselves echoed back — ignore
          break;
        }
        state.draining = (frame as { state: 'draining' | 'online' }).state === 'draining';
        process.stderr.write(`[agent] state: ${(frame as { state: string }).state}\n`);
        break;
      case 'error':
        process.stderr.write(`[agent] error frame [${frame.code}]: ${frame.message}\n`);
        if (frame.close) {
          client?.close();
          resolveExit(1);
        }
        break;
      case 'dispatch':
        await handleDispatch(frame);
        break;
      case 'cancel':
        await handleCancel(frame);
        break;
      default:
        break;
    }
  }

  function handleOpen(): void {
    if (!client) return;
    const running_runs = getRunningRunsArray();
    if (existingCred) {
      // Reconnect with stored credential; include currently running runs
      client.send({ type: 'reconnect', credential: existingCred.credential, running_runs });
    } else if (flags.token) {
      // First-time registration
      client.send({ type: 'register', token: flags.token, labels });
    } else {
      // Neither credential file nor --token — cannot authenticate
      process.stderr.write('[agent] no credential file and no --token; cannot authenticate\n');
      client.close();
      resolveExit(1);
    }
  }

  function handleClose(code: number, reason: string): void {
    if (exiting) return;
    // Terminal close codes: ATOK-05 revoked (4001), 4002 token_invalid, 4004 superseded → stop
    if (code === 4001 || code === 4002 || code === 4004) {
      process.stderr.write(`[agent] terminal close [${code}]: ${reason} — exiting\n`);
      client?.close();
      resolveExit(1);
    }
    // 4003 heartbeat_timeout, 4005 handshake_timeout, 1001 going_away → rws auto-reconnects
    // Normal close (1000) triggered by handleShutdown is handled there
  }

  process.stderr.write(`[agent] connecting to ${normalizedUrl}\n`);
  client = new AgentClient({
    url: normalizedUrl,
    onOpen: handleOpen,
    onMessage: handleMessage,
    onClose: handleClose,
  });

  // AGENT-08: graceful shutdown on SIGINT/SIGTERM
  async function handleShutdown(): Promise<void> {
    if (exiting) return;
    exiting = true;
    try {
      if (client && client.isOpen) {
        const running_runs = getRunningRunsArray();
        client.send({ type: 'goodbye', running_runs });
        // Brief flush window (D-27: up to 5s, but in Phase 8 no ack expected — 500ms is enough)
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      client?.close();
      resolveExit(0);
    }
  }

  process.once('SIGINT', () => {
    void handleShutdown();
  });
  process.once('SIGTERM', () => {
    void handleShutdown();
  });

  return exitPromise;
}
