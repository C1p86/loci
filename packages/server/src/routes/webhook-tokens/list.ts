// GET /api/orgs/:orgId/webhook-tokens — any member can list tokens (metadata only).
// D-29: Never returns tokenHash or plugin_secret columns.
// T-12-04-01: Response schema uses additionalProperties:false to prevent accidental field leak.

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireAnyMember } from '../runs/helpers.js';

export const listWebhookTokensRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string } }>(
    '/:orgId/webhook-tokens',
    {
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireAnyMember(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const rows = await repos.forOrg(orgId).webhookTokens.list();

      // Explicit field selection — never include tokenHash or pluginSecretEncrypted.
      // hasPluginSecret is derived in the repo via IS NOT NULL on plugin_secret_encrypted.
      return reply.status(200).send({
        tokens: rows.map((row) => ({
          id: row.id,
          pluginName: row.pluginName,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          revokedAt: row.revokedAt ?? null,
          createdByUserId: row.createdByUserId,
          hasPluginSecret: row.hasPluginSecret,
        })),
      });
    },
  );
};
