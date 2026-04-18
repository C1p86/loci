// Connection registry types and helpers.
// The actual Map lives on fastify.agentRegistry (decorated in app.ts).
// This file exports the AgentConnection type + small helpers.

import type { WebSocket } from 'ws';

export interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  orgId: string;
  lastPongAt: number;
  pingTimer: NodeJS.Timeout | null;
  pongTimer: NodeJS.Timeout | null;
}

/**
 * Add an agent to the registry.
 * D-17: if a duplicate agentId is already present, the CALLER must close the prior
 * socket (before calling this) with code 4004 'superseded'.
 * Returns the prior socket if one existed, or undefined.
 */
export function addToRegistry(
  registry: Map<string, WebSocket>,
  agentId: string,
  socket: WebSocket,
): WebSocket | undefined {
  const existing = registry.get(agentId);
  registry.set(agentId, socket);
  return existing;
}

export function removeFromRegistry(registry: Map<string, WebSocket>, agentId: string): void {
  registry.delete(agentId);
}
