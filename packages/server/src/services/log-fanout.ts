// Phase 11 D-12/D-13: live fanout subscriber registry.
// Each subscriber has a bounded queue (max 500). Overflow → drop-head + emit single gap frame.
// Pump is synchronous (inline drain); never awaits WS send.
// D-12: broadcastEnd sends {type:'end'} then schedules ws.close after 5s grace.

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

export interface ChunkFrame {
  type: 'chunk';
  seq: number;
  stream: 'stdout' | 'stderr';
  data: string;
  ts: string;
}

export interface GapFrame {
  type: 'gap';
  droppedCount: number;
}

export interface EndFrame {
  type: 'end';
  state: string;
  exitCode: number | null;
}

type OutFrame = ChunkFrame | GapFrame | EndFrame;

const WS_OPEN = 1;
const MAX_QUEUE = 500; // D-13
const END_GRACE_MS = 5_000; // D-12

class Subscriber {
  readonly ws: WebSocket;
  readonly runId: string;
  readonly orgId: string;
  private queue: OutFrame[] = [];
  private pumping = false;

  constructor(ws: WebSocket, runId: string, orgId: string) {
    this.ws = ws;
    this.runId = runId;
    this.orgId = orgId;
  }

  push(frame: OutFrame): void {
    if (this.queue.length >= MAX_QUEUE) {
      // D-13 drop-head: remove oldest chunks until there is room for the incoming frame + gap marker.
      // Emit a single gap frame describing how many were dropped in this overflow event.
      let dropped = 0;
      // Make room for the gap frame AND the new frame (need 2 slots)
      while (this.queue.length >= MAX_QUEUE - 1) {
        this.queue.shift();
        dropped++;
      }
      this.queue.push({ type: 'gap', droppedCount: dropped });
    }
    this.queue.push(frame);
  }

  pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      const wsWithState = this.ws as unknown as { readyState: number };
      while (this.queue.length > 0 && wsWithState.readyState === WS_OPEN) {
        const next = this.queue.shift();
        if (next === undefined) break;
        try {
          this.ws.send(JSON.stringify(next));
        } catch {
          // Broken/slow subscriber — drain remaining queue and let ws.on('close') deregister
          this.queue = [];
          break;
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}

export class LogFanout {
  private readonly fastify: FastifyInstance;
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  constructor(fastify: FastifyInstance) {
    this.fastify = fastify;
  }

  /**
   * Register a new subscriber for a run.
   * Attaches ws.on('close') and ws.on('error') handlers that auto-deregister.
   * Returns the Subscriber instance (needed by Plan 11-03 subscribe endpoint for replay).
   */
  addSubscriber(runId: string, orgId: string, ws: WebSocket): Subscriber {
    const sub = new Subscriber(ws, runId, orgId);
    let set = this.subscribers.get(runId);
    if (!set) {
      set = new Set();
      this.subscribers.set(runId, set);
    }
    set.add(sub);
    ws.on('close', () => this.removeSubscriber(sub));
    ws.on('error', () => this.removeSubscriber(sub));
    return sub;
  }

  /**
   * Deregister a subscriber. Cleans up empty run entries.
   */
  removeSubscriber(sub: Subscriber): void {
    const set = this.subscribers.get(sub.runId);
    if (!set) return;
    set.delete(sub);
    if (set.size === 0) {
      this.subscribers.delete(sub.runId);
    }
  }

  /**
   * Fan out a chunk frame to all subscribers for a run.
   * Synchronous — never awaits. Each subscriber's pump drains inline.
   */
  broadcast(runId: string, frame: ChunkFrame): void {
    const set = this.subscribers.get(runId);
    if (!set || set.size === 0) return;
    for (const sub of set) {
      sub.push(frame);
      sub.pump();
    }
  }

  /**
   * D-12: send an end frame to all subscribers and schedule ws.close after 5s grace.
   * Called by handleResultFrame regardless of CAS outcome (idempotent; duplicate end frames harmless).
   */
  broadcastEnd(runId: string, state: string, exitCode: number | null): void {
    const set = this.subscribers.get(runId);
    if (!set || set.size === 0) return;
    for (const sub of set) {
      sub.push({ type: 'end', state, exitCode });
      sub.pump();
      // 5s grace before closing — unref so we don't hold the event loop on shutdown
      const timer = setTimeout(() => {
        try {
          sub.ws.close(1000, 'run ended');
        } catch {
          /* already closed */
        }
      }, END_GRACE_MS);
      timer.unref();
    }
  }

  /**
   * Close all subscriber connections with code 1001 (server going away).
   * Used by app.addHook('onClose', …).
   */
  closeAll(): void {
    for (const [, set] of this.subscribers) {
      for (const sub of set) {
        try {
          sub.ws.close(1001, 'server shutting down');
        } catch {
          /* ignore — ws may already be closed */
        }
      }
    }
    this.subscribers.clear();
  }

  /**
   * Returns true if there is at least one live subscriber for the given run.
   * Used by Plan 11-03 subscribe endpoint to decide whether to skip replay.
   */
  hasSubscribers(runId: string): boolean {
    const set = this.subscribers.get(runId);
    return !!set && set.size > 0;
  }
}
