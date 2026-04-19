// DELETE /api/orgs/:orgId/webhook-tokens/:id — Owner-only + CSRF hard delete.
// D-29: Owner-only; membership + org scoping enforced.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  OrgMembershipRequiredError,
  RoleInsufficientError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireOwnerAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner') throw new RoleInsufficientError('owner');
}

export const deleteWebhookTokenRoute: FastifyPluginAsync = async (fastify) => {
  fastify.delete<{ Params: { orgId: string; id: string } }>(
    '/:orgId/webhook-tokens/:id',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireOwnerAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      await repos.forOrg(orgId).webhookTokens.delete(req.params.id);

      return reply.status(204).send();
    },
  );
};
