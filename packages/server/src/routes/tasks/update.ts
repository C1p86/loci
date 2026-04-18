// PATCH /api/orgs/:orgId/tasks/:taskId — Owner/Member + CSRF updates a task.
// D-12: Same 4-step validation pipeline as create when yamlDefinition is provided.

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError, TaskNotFoundError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireOwnerOrMemberAndOrgMatch, validateTaskYaml } from './create.js';

interface UpdateTaskBody {
  name?: string;
  description?: string;
  yamlDefinition?: string;
  labelRequirements?: string[];
}

export const updateTaskRoute: FastifyPluginAsync = async (fastify) => {
  fastify.patch<{ Params: { orgId: string; taskId: string }; Body: UpdateTaskBody }>(
    '/:orgId/tasks/:taskId',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 2000 },
            yamlDefinition: { type: 'string', minLength: 1, maxLength: 1048576 },
            labelRequirements: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerOrMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      // D-12: Run 4-step validation pipeline if yamlDefinition is being updated.
      if (req.body.yamlDefinition !== undefined) {
        validateTaskYaml(req.body.yamlDefinition);
      }

      const repos = makeRepos(fastify.db, fastify.mek);

      // Verify the task exists (forOrg scoped — orgB taskId returns undefined for orgA).
      const existing = await repos.forOrg(orgId).tasks.getById(req.params.taskId);
      if (!existing) throw new TaskNotFoundError();

      const patch: Partial<{
        name: string;
        description: string;
        yamlDefinition: string;
        labelRequirements: string[];
      }> = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.description !== undefined) patch.description = req.body.description;
      if (req.body.yamlDefinition !== undefined) patch.yamlDefinition = req.body.yamlDefinition;
      if (req.body.labelRequirements !== undefined)
        patch.labelRequirements = req.body.labelRequirements;

      await repos.forOrg(orgId).tasks.update(req.params.taskId, patch);

      return reply.status(200).send({ id: req.params.taskId });
    },
  );
};
