// POST /api/orgs/:orgId/webhook-tokens — Owner/Member + CSRF creates a webhook token.
// D-29: Returns plaintext ONCE with endpoint URL. Plaintext never stored or logged.
// T-12-04-01: Response schema uses additionalProperties:false to prevent accidental field leak.

import type { FastifyPluginAsync } from 'fastify';
import { SchemaValidationError, SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireOwnerOrMemberAndOrgMatch } from '../tasks/create.js';

interface CreateWebhookTokenBody {
  pluginName: 'github' | 'perforce';
  pluginSecret?: string;
}

export const createWebhookTokenRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { orgId: string }; Body: CreateWebhookTokenBody }>(
    '/:orgId/webhook-tokens',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          required: ['pluginName'],
          additionalProperties: false,
          properties: {
            pluginName: { type: 'string', enum: ['github', 'perforce'] },
            pluginSecret: { type: 'string', minLength: 16, maxLength: 2048 },
          },
        },
        response: {
          201: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'plaintext', 'endpointUrl'],
            properties: {
              id: { type: 'string' },
              plaintext: { type: 'string' },
              endpointUrl: { type: 'string' },
            },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerOrMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      const userId = req.user?.id;
      if (!orgId || !userId) throw new SessionRequiredError();

      const { pluginName, pluginSecret } = req.body;

      // GitHub requires HMAC secret for signature verification
      if (pluginName === 'github' && !pluginSecret) {
        throw new SchemaValidationError(
          'GitHub webhook tokens require a pluginSecret for HMAC signature verification',
        );
      }

      // Perforce uses header token — extra secret is a configuration error
      if (pluginName === 'perforce' && pluginSecret) {
        throw new SchemaValidationError(
          'Perforce webhook tokens do not use HMAC — pluginSecret should not be provided',
        );
      }

      const repos = makeRepos(fastify.db, fastify.mek);
      // exactOptionalPropertyTypes: spread only defined optional fields
      const result = await repos.forOrg(orgId).webhookTokens.create({
        pluginName,
        createdByUserId: userId,
        ...(pluginSecret !== undefined && { pluginSecret }),
      });

      // T-12-04-01: Return ONLY the safe fields — plaintext returned ONCE, never stored.
      return reply.status(201).send({
        id: result.id,
        plaintext: result.plaintext,
        endpointUrl: result.endpointPath,
      });
    },
  );
};
