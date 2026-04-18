// Server-driven heartbeat: ping every 25s, close 4003 if pong not received within 10s.
// D-16: last_seen_at updated on every pong via repo.

import type { FastifyInstance } from 'fastify';
import { makeRepos } from '../repos/index.js';
import type { AgentConnection } from './registry.js';

const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;

export function startHeartbeat(fastify: FastifyInstance, conn: AgentConnection): void {
  conn.pingTimer = setInterval(() => {
    if (conn.ws.readyState !== conn.ws.OPEN) return;

    // Schedule pong timeout: if not cleared within 10s, close as heartbeat_timeout
    if (conn.pongTimer) clearTimeout(conn.pongTimer);
    conn.pongTimer = setTimeout(() => {
      conn.ws.close(4003, 'heartbeat_timeout');
    }, PONG_TIMEOUT_MS);

    conn.ws.ping();
  }, PING_INTERVAL_MS);

  conn.ws.on('pong', async () => {
    if (conn.pongTimer) {
      clearTimeout(conn.pongTimer);
      conn.pongTimer = null;
    }
    conn.lastPongAt = Date.now();
    try {
      const repos = makeRepos(fastify.db);
      await repos.forOrg(conn.orgId).agents.recordHeartbeat(conn.agentId);
    } catch (err) {
      fastify.log.warn({ err, agentId: conn.agentId }, 'heartbeat recordHeartbeat failed');
    }
  });
}

export function stopHeartbeat(conn: AgentConnection): void {
  if (conn.pingTimer) {
    clearInterval(conn.pingTimer);
    conn.pingTimer = null;
  }
  if (conn.pongTimer) {
    clearTimeout(conn.pongTimer);
    conn.pongTimer = null;
  }
}
