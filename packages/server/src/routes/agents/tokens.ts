// POST /api/orgs/:orgId/agent-tokens — Owner/Member creates a single-use 24h registration token.
// D-19 + D-39 + D-40: CSRF required, rate-limit 10/h per org+user.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  OrgMembershipRequiredError,
  OrgNotFoundError,
  RoleInsufficientError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireOwnerOrMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  // Viewers are excluded — only owner or member may create tokens (T-08-03-08)
  if (req.org.role !== 'owner' && req.org.role !== 'member')
    throw new RoleInsufficientError('member');
}

export const agentTokensRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { orgId: string } }>(
    '/:orgId/agent-tokens',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      config: {
        // D-40: rate limit 10/h per org+user
        rateLimit: { max: 10, timeWindow: '1 hour' },
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            label: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerOrMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      const userId = req.user?.id;
      if (!orgId || !userId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const orgRows = await repos.admin.findOrgById(orgId);
      if (!orgRows[0]) throw new OrgNotFoundError(orgId);

      const { id, tokenPlaintext, expiresAt } = await repos
        .forOrg(orgId)
        .registrationTokens.create(userId);

      return reply.status(201).send({
        tokenId: id,
        token: tokenPlaintext, // plaintext shown ONCE — server stores only the hash (ATOK-01)
        expiresAt: expiresAt.toISOString(),
      });
    },
  );
};
