import ReconnectingWebSocket from 'reconnecting-websocket';
import type { ErrorEvent } from 'reconnecting-websocket';
import WS from 'ws';
import type { AgentFrame } from './types.js';

export interface AgentClientOptions {
  url: string;
  onOpen: () => void;
  onMessage: (frame: AgentFrame) => void;
  onClose: (code: number, reason: string) => void;
}

/**
 * Format a WS frame for stderr logging.
 * Redaction invariants (MUST NOT change):
 *   - `token` field → '<redacted>' (registration token plaintext)
 *   - `credential` field → '<redacted>' (agent credential plaintext)
 *   - `log_chunk.data` field → OMITTED (can be large; already redacted at source)
 *
 * Direction arrow: '->' (agent to server) or '<-' (server to agent).
 */
function formatFrameForLog(frame: unknown, direction: '->' | '<-'): string {
  const prefix = `[agent] ${direction} server:`;
  if (!frame || typeof frame !== 'object') return `${prefix} <invalid>`;
  const f = frame as Record<string, unknown>;
  const type = typeof f.type === 'string' ? f.type : '<no-type>';
  const parts: string[] = [type];

  // run_id always visible (not sensitive)
  if (typeof f.run_id === 'string') parts.push(`run_id=${f.run_id}`);

  // Sensitive: redact (never emit plaintext)
  if (f.token !== undefined) parts.push('token=<redacted>');
  if (f.credential !== undefined) parts.push('credential=<redacted>');

  // log_chunk: omit data, include seq/stream
  if (type === 'log_chunk') {
    if (typeof f.seq === 'number') parts.push(`seq=${f.seq}`);
    if (typeof f.stream === 'string') parts.push(`stream=${f.stream}`);
    return `${prefix} ${parts.join(' ')}`;
  }

  // Other safe primitive fields
  const safeKeys = [
    'code',
    'message',
    'exit_code',
    'duration_ms',
    'cancelled',
    'reason',
    'state',
    'agent_id',
    'close',
    'timeout_seconds',
  ];
  for (const k of safeKeys) {
    const v = f[k];
    if (v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      parts.push(`${k}=${v}`);
    }
  }

  // Compact structured-field summaries
  if (f.labels && typeof f.labels === 'object' && !Array.isArray(f.labels)) {
    try {
      parts.push(`labels=${JSON.stringify(f.labels)}`);
    } catch {
      parts.push('labels=<unserializable>');
    }
  }
  if (Array.isArray(f.running_runs)) parts.push(`running_runs=${f.running_runs.length}`);
  if (Array.isArray(f.reconciliation)) parts.push(`reconciliation=${f.reconciliation.length}`);
  if (f.task_snapshot && typeof f.task_snapshot === 'object') {
    const ts = f.task_snapshot as Record<string, unknown>;
    if (typeof ts.name === 'string') parts.push(`task_name=${ts.name}`);
  }

  return `${prefix} ${parts.join(' ')}`;
}

/**
 * Wraps ReconnectingWebSocket with the Node.js-specific WS adapter (Pitfall 2: { WebSocket: WS }).
 * Exponential backoff per AGENT-02:
 *   minReconnectionDelay: ~1.0-1.5s (jittered)
 *   maxReconnectionDelay: 30s cap
 *   reconnectionDelayGrowFactor: 1.5x
 */
export class AgentClient {
  private rws: ReconnectingWebSocket;
  private hasOpenedOnce = false;
  private hasLoggedRetry = false;

  constructor(opts: AgentClientOptions) {
    this.rws = new ReconnectingWebSocket(opts.url, [], {
      // Pitfall 2: must pass the WS constructor explicitly on Node.js
      WebSocket: WS as unknown as typeof globalThis.WebSocket,
      minReconnectionDelay: 1000 + Math.random() * 500, // ~1.0-1.5s jitter
      maxReconnectionDelay: 30_000,
      reconnectionDelayGrowFactor: 1.5,
      connectionTimeout: 5000,
      maxRetries: Infinity,
      startClosed: false,
    });

    this.rws.addEventListener('open', () => {
      if (this.hasOpenedOnce) {
        process.stderr.write('[agent] websocket open (reconnected)\n');
      } else {
        process.stderr.write('[agent] websocket open\n');
        this.hasOpenedOnce = true;
      }
      // Reset so a future disconnect-reconnect cycle can re-emit the retry
      // notice if the new attempt also fails.
      this.hasLoggedRetry = false;
      opts.onOpen();
    });

    this.rws.addEventListener('error', (event: ErrorEvent) => {
      // ReconnectingWebSocket's ErrorEvent carries `.message` bubbled from ws;
      // fall back to String(event) if it ever arrives without one.
      const msg = event?.message ?? String(event);
      process.stderr.write(`[agent] connect error: ${msg}\n`);
      if (!this.hasOpenedOnce && !this.hasLoggedRetry) {
        process.stderr.write('[agent] retrying (exponential backoff, max 30s)\n');
        this.hasLoggedRetry = true;
      }
    });

    this.rws.addEventListener('message', (event: MessageEvent) => {
      try {
        const frame = JSON.parse(String(event.data)) as AgentFrame;
        process.stderr.write(`${formatFrameForLog(frame, '<-')}\n`);
        opts.onMessage(frame);
      } catch {
        // Silently ignore malformed server frames
      }
    });

    this.rws.addEventListener('close', (event: CloseEvent) => {
      opts.onClose(event.code, event.reason);
    });
  }

  /** Send a frame — no-op if the socket is not currently OPEN. */
  send(frame: AgentFrame): void {
    if (this.rws.readyState === WS.OPEN) {
      process.stderr.write(`${formatFrameForLog(frame, '->')}\n`);
      this.rws.send(JSON.stringify(frame));
    }
  }

  /** Is the underlying socket currently OPEN? */
  get isOpen(): boolean {
    return this.rws.readyState === WS.OPEN;
  }

  /**
   * Disable auto-reconnect and close the underlying socket with code 1000.
   * After this call no further reconnect attempts will be made.
   */
  close(): void {
    this.rws.close();
  }
}
