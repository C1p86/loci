// PATCH /api/orgs/:orgId/tasks/:taskId — Owner/Member + CSRF updates a task.
// D-12: Same 4-step validation pipeline as create when yamlDefinition is provided.
// Phase 13 D-34: extended to accept slug + expose_badge (T-13-01-05).

import type { FastifyPluginAsync } from 'fastify';
import {
  SessionRequiredError,
  TaskNotFoundError,
  TaskSlugConflictError,
  TaskValidationError,
} from '../../errors.js';
import { validateTriggerConfigs } from '../../plugins-trigger/validate-trigger-configs.js';
import { makeRepos } from '../../repos/index.js';
import { requireOwnerOrMemberAndOrgMatch, validateTaskYaml } from './create.js';

interface UpdateTaskBody {
  name?: string;
  description?: string;
  yamlDefinition?: string;
  labelRequirements?: string[];
  trigger_configs?: unknown[];
  // Phase 13 D-34
  slug?: string;
  expose_badge?: boolean;
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
            trigger_configs: { type: 'array', maxItems: 20 },
            // Phase 13: T-13-01-05 slug validation: lowercase alphanumeric + hyphens, 2-64 chars
            slug: {
              type: 'string',
              pattern: '^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$',
            },
            expose_badge: { type: 'boolean' },
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

      // D-18: Validate trigger_configs entries against TriggerConfig union type.
      if (req.body.trigger_configs !== undefined) {
        const tcErrors = validateTriggerConfigs(req.body.trigger_configs);
        if (tcErrors.length > 0) throw new TaskValidationError(tcErrors);
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
        triggerConfigs: import('../../plugins-trigger/types.js').TriggerConfig[];
        slug: string;
        exposeBadge: boolean;
      }> = {};
      if (req.body.name !== undefined) patch.name = req.body.name;
      if (req.body.description !== undefined) patch.description = req.body.description;
      if (req.body.yamlDefinition !== undefined) patch.yamlDefinition = req.body.yamlDefinition;
      if (req.body.labelRequirements !== undefined)
        patch.labelRequirements = req.body.labelRequirements;
      if (req.body.trigger_configs !== undefined)
        patch.triggerConfigs = req.body
          .trigger_configs as import('../../plugins-trigger/types.js').TriggerConfig[];
      // Phase 13: snake_case → camelCase remapping (T-13-01-05)
      if (req.body.slug !== undefined) patch.slug = req.body.slug;
      if (req.body.expose_badge !== undefined) patch.exposeBadge = req.body.expose_badge;

      try {
        await repos.forOrg(orgId).tasks.update(req.params.taskId, patch);
      } catch (err) {
        if (err instanceof TaskSlugConflictError) {
          return reply.code(409).send({
            ok: false,
            error: 'TASK_SLUG_CONFLICT',
            message: 'A task with that slug already exists in this org.',
          });
        }
        throw err;
      }

      return reply.status(200).send({ id: req.params.taskId });
    },
  );
};
