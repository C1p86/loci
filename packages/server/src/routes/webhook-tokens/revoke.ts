// POST /api/orgs/:orgId/webhook-tokens/:id/revoke — Owner/Member + CSRF.
// D-29: sets revoked_at; subsequent webhook deliveries using that plaintext return 404.

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError, WebhookTokenNotFoundError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireMemberOrAbove } from '../runs/helpers.js';

export const revokeWebhookTokenRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { orgId: string; id: string } }>(
    '/:orgId/webhook-tokens/:id/revoke',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireMemberOrAbove(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const scopedRepos = repos.forOrg(orgId);

      // Verify token exists in this org before revoking (cross-org isolation)
      const token = await scopedRepos.webhookTokens.getById(req.params.id);
      if (!token) throw new WebhookTokenNotFoundError();

      await scopedRepos.webhookTokens.revoke(req.params.id);

      return reply.status(204).send();
    },
  );
};
