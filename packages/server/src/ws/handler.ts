// Main WS connection handler — open-then-handshake auth flow (D-14).
// D-13: NO session/cookie auth here; token arrives in the first frame.
// Pitfall 4: register socket.on('message') synchronously at top.
//
// WS close code registry (Phase 8 + Phase 10):
//   4001 revoked          — credential invalid or revoked
//   4002 frame_invalid    — bad JSON, unknown type, invalid token
//   4003 heartbeat_timeout — no pong within deadline
//   4004 superseded       — new connection replaced this one
//   4005 handshake_timeout — no first frame within 5s
//   4006 quota_exceeded   — org has reached max_agents limit (QUOTA-03)

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { makeRepos } from '../repos/index.js';
import { parseAgentFrame } from './frames.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import type { AgentConnection } from './registry.js';
import type { ServerOutgoingFrame } from './types.js';

const HANDSHAKE_TIMEOUT_MS = 5_000;

function send(socket: WebSocket, frame: ServerOutgoingFrame): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(frame));
  }
}

export function handleAgentConnection(
  fastify: FastifyInstance,
  socket: WebSocket,
  _request: FastifyRequest,
): void {
  // Pitfall 4: register 'message' handler synchronously at the top of the handler.
  let authenticated = false;
  let conn: AgentConnection | null = null;

  // D-14: 5s timeout for first frame
  const handshakeTimer = setTimeout(() => {
    if (!authenticated) {
      socket.close(4005, 'handshake_timeout');
    }
  }, HANDSHAKE_TIMEOUT_MS);

  socket.on('message', async (data) => {
    const raw = data.toString('utf8');
    let frame: ReturnType<typeof parseAgentFrame>;
    try {
      frame = parseAgentFrame(raw);
    } catch (err) {
      send(socket, {
        type: 'error',
        code: 'VAL_AGENT_FRAME',
        message: (err as Error).message,
        close: true,
      });
      socket.close(4002, 'frame_invalid');
      return;
    }

    if (!authenticated) {
      clearTimeout(handshakeTimer);
      conn = await handleHandshake(fastify, socket, frame);
      if (conn) {
        authenticated = true;
        startHeartbeat(fastify, conn);
      }
      return;
    }

    // Authenticated frames: update last_seen_at on every message (D-16)
    if (conn) {
      try {
        const repos = makeRepos(fastify.db, fastify.mek);
        await repos.forOrg(conn.orgId).agents.recordHeartbeat(conn.agentId);
      } catch (err) {
        fastify.log.warn({ err, agentId: conn.agentId }, 'recordHeartbeat on message failed');
      }
    }

    // D-27/D-28: goodbye frame — mark offline, close cleanly
    if (frame.type === 'goodbye' && conn) {
      fastify.log.info({ agentId: conn.agentId, orgId: conn.orgId }, 'agent goodbye');
      socket.close(1000, 'normal');
      return;
    }
    // dispatch/cancel/result/log_chunk frames — reserved for Phase 10/11; not handled here
  });

  socket.on('close', async () => {
    clearTimeout(handshakeTimer);
    if (conn) {
      stopHeartbeat(conn);
      fastify.agentRegistry.delete(conn.agentId);
      try {
        const repos = makeRepos(fastify.db, fastify.mek);
        await repos.forOrg(conn.orgId).agents.updateState(conn.agentId, 'offline');
      } catch (err) {
        fastify.log.warn({ err, agentId: conn.agentId }, 'offline-mark failed on WS close');
      }
    }
  });

  socket.on('error', (err) => {
    // Log only metadata — never frame body (D-10 / Do NOT List #7)
    fastify.log.error({ err: err.message }, 'agent ws error');
  });
}

async function handleHandshake(
  fastify: FastifyInstance,
  socket: WebSocket,
  frame: ReturnType<typeof parseAgentFrame>,
): Promise<AgentConnection | null> {
  const repos = makeRepos(fastify.db, fastify.mek);

  if (frame.type === 'register') {
    const tokenRow = await repos.admin.findValidRegistrationToken(frame.token);
    if (!tokenRow) {
      send(socket, {
        type: 'error',
        code: 'AUTHN_AGENT_TOKEN_INVALID',
        message: 'Invalid or expired registration token',
        close: true,
      });
      socket.close(4002, 'token_invalid');
      return null;
    }

    const orgId = await repos.admin.consumeRegistrationToken(tokenRow.id);

    // QUOTA-03 gate (D-10): check agent count AFTER consuming the token (security rationale in
    // RESEARCH FA-9 — after-consume prevents quota-state probing via token reuse).
    const [orgPlanRows, agentCount] = await Promise.all([
      repos.forOrg(orgId).plan.get(),
      repos.admin.countAgentsByOrg(orgId),
    ]);
    const orgPlan = orgPlanRows[0];
    if (!orgPlan) {
      fastify.log.error({ orgId }, 'no org plan found during registration quota check');
    } else if (agentCount >= orgPlan.maxAgents) {
      send(socket, {
        type: 'error',
        code: 'AGENT_QUOTA_EXCEEDED',
        message: `Org has ${agentCount} of ${orgPlan.maxAgents} agents (${orgPlan.planName} plan limit). Revoke an existing agent or contact support.`,
        close: true,
      });
      socket.close(4006, 'quota_exceeded');
      return null;
    }

    // Derive hostname from labels if provided; else default to 'unknown'
    const hostname = (frame.labels['hostname'] as string | undefined) ?? 'unknown';
    const { agentId, credentialPlaintext } = await repos.admin.registerNewAgent({
      orgId,
      hostname,
      labels: frame.labels,
    });

    // D-17: supersede any existing connection for this agentId
    const prior = fastify.agentRegistry.get(agentId);
    if (prior) prior.close(4004, 'superseded');
    fastify.agentRegistry.set(agentId, socket);

    send(socket, { type: 'register_ack', agent_id: agentId, credential: credentialPlaintext });
    fastify.log.info({ agentId, orgId }, 'agent registered');

    return {
      ws: socket,
      agentId,
      orgId,
      lastPongAt: Date.now(),
      pingTimer: null,
      pongTimer: null,
    };
  }

  if (frame.type === 'reconnect') {
    const credRow = await repos.admin.findActiveAgentCredential(frame.credential);
    if (!credRow) {
      send(socket, {
        type: 'error',
        code: 'AUTHN_AGENT_REVOKED',
        message: 'Credential invalid or revoked',
        close: true,
      });
      socket.close(4001, 'revoked');
      return null;
    }

    const { agentId, orgId } = credRow;

    // D-17: supersede any existing connection
    const prior = fastify.agentRegistry.get(agentId);
    if (prior) prior.close(4004, 'superseded');
    fastify.agentRegistry.set(agentId, socket);

    // D-18: reconciliation stub — empty array (Phase 10 populates with real run data)
    send(socket, { type: 'reconnect_ack', reconciliation: [] });

    // Mark online + update last_seen_at (D-12 + AGENT-05)
    await repos.forOrg(orgId).agents.updateState(agentId, 'online');
    await repos.forOrg(orgId).agents.recordHeartbeat(agentId);
    fastify.log.info({ agentId, orgId }, 'agent reconnected');

    return {
      ws: socket,
      agentId,
      orgId,
      lastPongAt: Date.now(),
      pingTimer: null,
      pongTimer: null,
    };
  }

  // goodbye or unknown frame before authentication is invalid
  send(socket, {
    type: 'error',
    code: 'VAL_AGENT_FRAME',
    message: 'goodbye before handshake',
    close: true,
  });
  socket.close(4002, 'frame_invalid');
  return null;
}

/**
 * Force-close a connected agent by agentId.
 * Used by the revoke and delete REST routes (Task 3).
 * Returns true if the agent was connected, false if not in registry.
 */
export function forceCloseAgent(
  fastify: FastifyInstance,
  agentId: string,
  code: number,
  reason: string,
): boolean {
  const ws = fastify.agentRegistry.get(agentId);
  if (!ws) return false;
  ws.close(code, reason);
  fastify.agentRegistry.delete(agentId);
  return true;
}
