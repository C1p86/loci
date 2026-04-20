import ReconnectingWebSocket from 'reconnecting-websocket';
import WS from 'ws';
import type { AgentFrame } from './types.js';

export interface AgentClientOptions {
  url: string;
  onOpen: () => void;
  onMessage: (frame: AgentFrame) => void;
  onClose: (code: number, reason: string) => void;
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

    this.rws.addEventListener('error', (event: Event) => {
      // ReconnectingWebSocket's ErrorEvent may carry `.message` (bubbled from
      // ws) or it may not. Use a structural cast + String fallback.
      const msg = (event as { message?: string } | null)?.message ?? String(event);
      process.stderr.write(`[agent] connect error: ${msg}\n`);
      if (!this.hasOpenedOnce && !this.hasLoggedRetry) {
        process.stderr.write('[agent] retrying (exponential backoff, max 30s)\n');
        this.hasLoggedRetry = true;
      }
    });

    this.rws.addEventListener('message', (event: MessageEvent) => {
      try {
        const frame = JSON.parse(String(event.data)) as AgentFrame;
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
