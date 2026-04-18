// DELETE /api/orgs/:orgId/agents/:agentId — Owner-only hard delete.
// D-19: Owner only (not Member). CASCADE removes agent_credentials via FK.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  OrgMembershipRequiredError,
  RoleInsufficientError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { forceCloseAgent } from '../../ws/handler.js';

function requireOwnerAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner') throw new RoleInsufficientError('owner');
}

export const agentDeleteRoute: FastifyPluginAsync = async (fastify) => {
  fastify.delete<{ Params: { orgId: string; agentId: string } }>(
    '/:orgId/agents/:agentId',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireOwnerAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const scoped = repos.forOrg(orgId);
      const agent = await scoped.agents.getById(req.params.agentId);
      if (!agent) return reply.status(404).send({ error: 'agent not found' });

      // Close any active WS before deleting
      forceCloseAgent(fastify, req.params.agentId, 4001, 'deleted');

      // Hard delete — CASCADE removes agent_credentials per schema FK
      await scoped.agents.delete(req.params.agentId);

      return reply.status(204).send();
    },
  );
};
