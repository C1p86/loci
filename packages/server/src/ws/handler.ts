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

import { sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { makeRepos } from '../repos/index.js';
import { cancelRunTimer } from '../services/timeout-manager.js';
import { parseAgentFrame } from './frames.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import type { AgentConnection } from './registry.js';
import type { AgentIncomingFrame, ServerOutgoingFrame } from './types.js';

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

    // Authenticated frames: update last_seen_at on every message EXCEPT log_chunk.
    // Pitfall 7 (RESEARCH): log_chunk frames arrive thousands/sec during verbose tasks.
    // Skipping recordHeartbeat on log_chunk prevents DB thrash. Pong frames still update
    // last_seen_at via the heartbeat module, so agent-online detection is unaffected.
    if (conn && frame.type !== 'log_chunk') {
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

    // Phase 10: authenticated run-keyed frame routing
    if (frame.type === 'state' && conn) {
      await handleStateAck(fastify, socket, conn, frame);
      return;
    }
    if (frame.type === 'result' && conn) {
      await handleResultFrame(fastify, socket, conn, frame);
      return;
    }
    if (frame.type === 'log_chunk' && conn) {
      await handleLogChunkFrame(fastify, socket, conn, frame);
      return;
    }
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

    // D-18: reconciliation stub — empty array (Phase 10-03 populates with real run data)
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

// ---- Phase 10: authenticated run-keyed frame handlers ----

/**
 * Cross-tenant frame spoofing guard (T-10-02-01 / RESEARCH Pitfall 5).
 * Verifies the run_id belongs to the authenticated agent's org BEFORE any DB mutation.
 * Returns true if guard passes; returns false and sends error frame if mismatch.
 */
async function verifyRunOwnership(
  fastify: FastifyInstance,
  socket: WebSocket,
  conn: AgentConnection,
  runId: string,
): Promise<boolean> {
  const repos = makeRepos(fastify.db, fastify.mek);
  const belongs = await repos.forOrg(conn.orgId).taskRuns.verifyBelongsToOrg(runId);
  if (!belongs) {
    send(socket, {
      type: 'error',
      code: 'AUTHZ_RUN_CROSS_ORG',
      message: 'run not found or belongs to another org',
      close: false,
    });
    fastify.log.warn(
      { agentId: conn.agentId, runId, orgId: conn.orgId },
      'frame spoofing attempt: run_id does not belong to agent org',
    );
    return false;
  }
  return true;
}

/**
 * Handle incoming `state` frame (agent → server transition ack).
 * CAS transition: dispatched → running, sets started_at = now().
 * Guards against cross-tenant spoofing via verifyRunOwnership.
 */
async function handleStateAck(
  fastify: FastifyInstance,
  socket: WebSocket,
  conn: AgentConnection,
  frame: Extract<AgentIncomingFrame, { type: 'state' }>,
): Promise<void> {
  if (!(await verifyRunOwnership(fastify, socket, conn, frame.run_id))) return;

  const repos = makeRepos(fastify.db, fastify.mek);
  const updated = await repos
    .forOrg(conn.orgId)
    .taskRuns.updateState(frame.run_id, 'dispatched', 'running', {
      startedAt: sql`now()` as unknown as Date,
    });
  if (!updated) {
    fastify.log.debug(
      { runId: frame.run_id, agentId: conn.agentId },
      'state ack for non-dispatched run — CAS miss (possibly already running or terminal)',
    );
  }
}

/**
 * Handle incoming `result` frame (agent → server execution result).
 * Steps:
 *   1. Cancel server-side run timer FIRST (Pitfall 1 — always before DB write).
 *   2. Cross-tenant guard via verifyRunOwnership.
 *   3. CAS transition: (dispatched|running) → (succeeded|failed|cancelled) based on exit_code.
 *   4. If CAS misses (already terminal), log at debug level and ignore silently.
 */
async function handleResultFrame(
  fastify: FastifyInstance,
  socket: WebSocket,
  conn: AgentConnection,
  frame: Extract<AgentIncomingFrame, { type: 'result' }>,
): Promise<void> {
  // Step 1: cancel run timer BEFORE DB write (RESEARCH Pitfall 1 discipline).
  // This is a no-op stub in Plan 10-02; Plan 10-03 replaces with real timer management.
  cancelRunTimer(frame.run_id);

  if (!(await verifyRunOwnership(fastify, socket, conn, frame.run_id))) return;

  // Determine target state: cancelled takes priority over exit_code comparison
  // (agent sends cancelled:true when responding to a cancel/timeout frame).
  const targetState = frame.cancelled
    ? ('cancelled' as const)
    : frame.exit_code === 0
      ? ('succeeded' as const)
      : ('failed' as const);

  const repos = makeRepos(fastify.db, fastify.mek);
  const updated = await repos
    .forOrg(conn.orgId)
    .taskRuns.updateStateMulti(frame.run_id, ['running', 'dispatched'], targetState, {
      exitCode: frame.exit_code,
      finishedAt: sql`now()` as unknown as Date,
    });

  if (!updated) {
    // CAS loser — run already in a terminal state (e.g. timed_out arrived first).
    // This is expected when server sends cancel + agent responds with result after server
    // already marked timed_out. Silent debug log only — no error frame back to agent.
    fastify.log.debug(
      { runId: frame.run_id, agentId: conn.agentId },
      'result frame for already-terminal run — CAS miss, ignored',
    );
  }
}

/**
 * Handle incoming `log_chunk` frame (agent → server streaming).
 * Phase 10: SERVER DISCARDS payload (Phase 11 adds storage).
 * Still applies verifyRunOwnership guard — accepting log_chunk for wrong-org run
 * would allow probing run_id existence across tenants (T-10-02-01).
 */
async function handleLogChunkFrame(
  fastify: FastifyInstance,
  socket: WebSocket,
  conn: AgentConnection,
  frame: Extract<AgentIncomingFrame, { type: 'log_chunk' }>,
): Promise<void> {
  if (!(await verifyRunOwnership(fastify, socket, conn, frame.run_id))) return;

  // Phase 10: discard payload. Phase 11 wires storage here.
  // Trace log for debugging; never log frame.data (may contain secrets — D-10).
  fastify.log.trace(
    { runId: frame.run_id, seq: frame.seq, stream: frame.stream, agentId: conn.agentId },
    'log_chunk discarded (Phase 11 will store)',
  );
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
