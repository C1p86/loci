// PATCH /api/orgs/:orgId/secrets/:secretId — Owner/Member + CSRF.
// D-19 / Pitfall 3: name is IMMUTABLE — body accepts {value} ONLY.
// additionalProperties:false rejects any non-value field (including name) at the AJV layer.
// SEC-04: response is {id} only — never echoes value/ciphertext.

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireOwnerOrMemberAndOrgMatch } from './create.js';

interface UpdateSecretBody {
  value: string;
}

export const updateSecretRoute: FastifyPluginAsync = async (fastify) => {
  fastify.patch<{ Params: { orgId: string; secretId: string }; Body: UpdateSecretBody }>(
    '/:orgId/secrets/:secretId',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          required: ['value'],
          // Pitfall 3: additionalProperties:false rejects name field — preserves AAD stability
          additionalProperties: false,
          properties: {
            value: { type: 'string', minLength: 1, maxLength: 65536 },
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

      // The repo: looks up existing name, re-encrypts with NEW random IV (SEC-02), writes audit log (D-22).
      // Throws SecretNotFoundError if secretId not found in this org.
      await repos.forOrg(orgId).secrets.update(req.params.secretId, {
        value: req.body.value,
        actorUserId: userId,
      });

      // SEC-04: return only {id} — do NOT echo value.
      return reply.status(200).send({ id: req.params.secretId });
    },
  );
};
