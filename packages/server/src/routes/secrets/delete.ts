// DELETE /api/orgs/:orgId/secrets/:secretId — Owner ONLY + CSRF (D-19).
// D-21 / D-22: tombstone audit entry (secretId=null, secretName preserved) written in same transaction.

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireOwnerAndOrgMatch } from './create.js';

export const deleteSecretRoute: FastifyPluginAsync = async (fastify) => {
  fastify.delete<{ Params: { orgId: string; secretId: string } }>(
    '/:orgId/secrets/:secretId',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireOwnerAndOrgMatch(req);
      const orgId = req.org?.id;
      const userId = req.user?.id;
      if (!orgId || !userId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);

      // The repo: gets secret name for tombstone, deletes row, writes tombstone audit entry (D-22).
      // Throws SecretNotFoundError if secretId not found in this org.
      await repos.forOrg(orgId).secrets.delete(req.params.secretId, userId);

      return reply.status(204).send();
    },
  );
};
