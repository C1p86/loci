// DELETE /api/orgs/:orgId/tasks/:taskId — Owner ONLY + CSRF.
// D-10: DELETE restricted to Owner (not Member or Viewer).

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  OrgMembershipRequiredError,
  RoleInsufficientError,
  SessionRequiredError,
  TaskNotFoundError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireOwnerAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner') throw new RoleInsufficientError('owner');
}

export const deleteTaskRoute: FastifyPluginAsync = async (fastify) => {
  fastify.delete<{ Params: { orgId: string; taskId: string } }>(
    '/:orgId/tasks/:taskId',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireOwnerAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const { rowCount } = await repos.forOrg(orgId).tasks.delete(req.params.taskId);
      if (rowCount === 0) throw new TaskNotFoundError();

      return reply.status(204).send();
    },
  );
};
