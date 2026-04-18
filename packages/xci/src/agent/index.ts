// packages/xci/src/agent/index.ts
// Full agent daemon — replaces the Plan 01 stub (08-04).
// Lazy-loaded from cli.ts when --agent is found in argv (D-02).

import { AgentModeArgsError } from '../errors.js';
import { AgentClient } from './client.js';
import { credentialPath, loadCredential, saveCredential, type StoredCredential } from './credential.js';
import { detectLabels } from './labels.js';
import { createAgentState } from './state.js';
import type { AgentFrame } from './types.js';

interface ParsedFlags {
  agent: string; // server WS URL
  token?: string;
  labels: string[];
  hostname?: string;
  configDir?: string;
  help: boolean;
}

function parseFlags(argv: readonly string[]): ParsedFlags {
  const flags: ParsedFlags = { agent: '', labels: [], help: false };
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
      '  --agent <url>          Server WS URL (required). Example: wss://xci.example.com/ws/agent\n' +
      '  --token <reg-token>    Registration token (first-run only; omit on subsequent runs)\n' +
      '  --label key=value      Custom label (repeatable)\n' +
      '  --hostname <name>      Override auto-detected hostname\n' +
      '  --config-dir <path>    Override credential storage directory\n' +
      '                         (default: env-paths xci config location)\n' +
      '  --help, -h             Show this help\n' +
      '\nCredential file location by OS:\n' +
      '  Linux:   ~/.config/xci/agent.json\n' +
      '  macOS:   ~/Library/Preferences/xci/agent.json\n' +
      '  Windows: %APPDATA%\\xci\\Config\\agent.json\n',
  );
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

  const state = createAgentState();

  let resolveExit!: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  let exiting = false;
  let client: AgentClient | null = null;

  async function handleMessage(frame: AgentFrame): Promise<void> {
    switch (frame.type) {
      case 'register_ack': {
        // Persist credential (ATOK-02)
        const cred: StoredCredential = {
          version: 1,
          server_url: flags.agent,
          agent_id: frame.agent_id,
          credential: frame.credential,
          registered_at: new Date().toISOString(),
        };
        try {
          await saveCredential(cred, flags.configDir);
        } catch (err) {
          process.stderr.write(
            `[agent] failed to save credential: ${(err as Error).message}\n`,
          );
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
        break;
      case 'state':
        state.draining = frame.state === 'draining';
        process.stderr.write(`[agent] state: ${frame.state}\n`);
        break;
      case 'error':
        process.stderr.write(`[agent] error frame [${frame.code}]: ${frame.message}\n`);
        if (frame.close) {
          client?.close();
          resolveExit(1);
        }
        break;
      default:
        // Other frames (dispatch/cancel/result etc.) are reserved for Phase 10/11
        break;
    }
  }

  function handleOpen(): void {
    if (!client) return;
    if (existingCred) {
      // Reconnect with stored credential
      client.send({ type: 'reconnect', credential: existingCred.credential, running_runs: [] });
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

  client = new AgentClient({
    url: flags.agent,
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
        client.send({ type: 'goodbye', running_runs: [] });
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
