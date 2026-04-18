// POST /api/orgs/:orgId/agents/:agentId/revoke — Owner/Member revokes credential.
// ATOK-04: sets revoked_at + force-closes any active WS with 4001 'revoked'.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  OrgMembershipRequiredError,
  RoleInsufficientError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { forceCloseAgent } from '../../ws/handler.js';

function requireOwnerOrMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner' && req.org.role !== 'member')
    throw new RoleInsufficientError('member');
}

export const agentRevokeRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { orgId: string; agentId: string } }>(
    '/:orgId/agents/:agentId/revoke',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireOwnerOrMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const scoped = repos.forOrg(orgId);
      const agent = await scoped.agents.getById(req.params.agentId);
      if (!agent) return reply.status(404).send({ error: 'agent not found' });

      // ATOK-04: close WS FIRST — prevents agent from accepting dispatches during revoke
      forceCloseAgent(fastify, req.params.agentId, 4001, 'revoked');

      // Revoke credential in DB
      await scoped.agentCredentials.revokeForAgent(req.params.agentId);

      // Mark offline immediately
      await scoped.agents.updateState(req.params.agentId, 'offline');

      return reply.status(204).send();
    },
  );
};
