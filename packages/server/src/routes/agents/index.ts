// Barrel: registers all 5 REST agent management routes + the WS upgrade route.
// REST routes: mounted under /api/orgs prefix (via registerRoutes → prefix: '/orgs').
// WS route: mounted at root /ws/agent (no /api prefix) — registered directly in app.ts.

import type { FastifyPluginAsync } from 'fastify';
import { handleAgentConnection } from '../../ws/handler.js';
import { agentDeleteRoute } from './delete.js';
import { agentListRoute } from './list.js';
import { agentPatchRoute } from './patch.js';
import { agentRevokeRoute } from './revoke.js';
import { agentTokensRoute } from './tokens.js';

/**
 * REST routes for agent management.
 * Mounted with { prefix: '/orgs' } by registerRoutes so paths become:
 *   POST   /api/orgs/:orgId/agent-tokens
 *   GET    /api/orgs/:orgId/agents
 *   PATCH  /api/orgs/:orgId/agents/:agentId
 *   POST   /api/orgs/:orgId/agents/:agentId/revoke
 *   DELETE /api/orgs/:orgId/agents/:agentId
 */
export const registerAgentRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(agentTokensRoute);
  await fastify.register(agentListRoute);
  await fastify.register(agentPatchRoute);
  await fastify.register(agentRevokeRoute);
  await fastify.register(agentDeleteRoute);
};

/**
 * WS route: GET /ws/agent (HTTP upgrade → WebSocket).
 * D-13: NO requireAuth preHandler — authentication happens in the first WS frame.
 * Registered at root level (no /api prefix) from app.ts.
 */
export const registerAgentWsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ws/agent', { websocket: true }, (socket, request) => {
    handleAgentConnection(fastify, socket, request);
  });
};
