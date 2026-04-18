// PATCH /api/orgs/:orgId/agents/:agentId — Owner/Member updates hostname or state.
// D-24: when state flips to 'draining', server sends {type:'state', state:'draining'} to connected agent.
// D-25: drain → online transition also valid.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import {
  AgentPatchEmptyError,
  OrgMembershipRequiredError,
  RoleInsufficientError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireOwnerOrMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner' && req.org.role !== 'member')
    throw new RoleInsufficientError('member');
}

interface PatchBody {
  hostname?: string;
  state?: 'draining' | 'online';
}

function sendStateFrame(ws: WebSocket | undefined, state: 'draining' | 'online'): void {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type: 'state', state }));
}

export const agentPatchRoute: FastifyPluginAsync = async (fastify) => {
  fastify.patch<{ Params: { orgId: string; agentId: string }; Body: PatchBody }>(
    '/:orgId/agents/:agentId',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            hostname: { type: 'string', minLength: 1, maxLength: 255 },
            state: { type: 'string', enum: ['draining', 'online'] },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerOrMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      if (!req.body.hostname && !req.body.state) {
        throw new AgentPatchEmptyError();
      }

      const repos = makeRepos(fastify.db);
      const scoped = repos.forOrg(orgId);
      const existing = await scoped.agents.getById(req.params.agentId);
      if (!existing) return reply.status(404).send({ error: 'agent not found' });

      if (req.body.hostname) {
        await scoped.agents.updateHostname(req.params.agentId, req.body.hostname);
      }
      if (req.body.state) {
        await scoped.agents.updateState(req.params.agentId, req.body.state);
        // D-24: propagate state change to connected agent via WS frame
        const ws = fastify.agentRegistry.get(req.params.agentId);
        sendStateFrame(ws, req.body.state);
      }

      return reply.status(204).send();
    },
  );
};
