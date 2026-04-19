// GET /api/orgs/:orgId/tasks/:taskId — any org member can retrieve a full task.
// D-10: returns full row including yamlDefinition.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  OrgMembershipRequiredError,
  SessionRequiredError,
  TaskNotFoundError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
}

export const getTaskRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string; taskId: string } }>(
    '/:orgId/tasks/:taskId',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      requireMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const task = await repos.forOrg(orgId).tasks.getById(req.params.taskId);
      if (!task) throw new TaskNotFoundError();

      return {
        id: task.id,
        name: task.name,
        description: task.description,
        yamlDefinition: task.yamlDefinition,
        labelRequirements: task.labelRequirements,
        slug: task.slug,
        expose_badge: task.exposeBadge,
        createdByUserId: task.createdByUserId,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
      };
    },
  );
};
