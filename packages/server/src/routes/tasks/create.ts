// POST /api/orgs/:orgId/tasks — Owner/Member + CSRF creates a task.
// D-12: 4-step save-time validation pipeline (parse → structureCheck → cycleCheck → aliasRefCheck).

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { parseYaml, validateAliasRefs, validateCommandMap } from 'xci/dsl';
import {
  OrgMembershipRequiredError,
  RoleInsufficientError,
  SessionRequiredError,
  type TaskValidationDetail,
  TaskValidationError,
} from '../../errors.js';
import { validateTriggerConfigs } from '../../plugins-trigger/validate-trigger-configs.js';
import { makeRepos } from '../../repos/index.js';

export function requireOwnerOrMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner' && req.org.role !== 'member')
    throw new RoleInsufficientError('member');
}

/**
 * D-12 4-step save-time validation pipeline.
 * Returns an empty array if valid; throws TaskValidationError on first failing step.
 * Steps are short-circuited — a parse failure makes cycle detection meaningless.
 */
export function validateTaskYaml(yamlDefinition: string): void {
  // Step 1: YAML must parse without syntax errors.
  const parseResult = parseYaml(yamlDefinition);
  if (parseResult.errors.length > 0) {
    const details: TaskValidationDetail[] = parseResult.errors.map((e) => {
      const d: TaskValidationDetail = { message: e.message };
      if (e.line !== undefined) d.line = e.line;
      if (e.column !== undefined) d.column = e.column;
      return d;
    });
    throw new TaskValidationError(details);
  }

  // Step 2: CommandMap must be structurally valid (each entry single|sequential|parallel).
  const validateResult = validateCommandMap(parseResult.commands);
  if (!validateResult.ok) {
    const details: TaskValidationDetail[] = validateResult.errors.map((e) => {
      const d: TaskValidationDetail = { message: e.message };
      if (e.suggestion !== undefined) d.suggestion = e.suggestion;
      return d;
    });
    throw new TaskValidationError(details);
  }

  // Steps 3+4: No cyclic alias composition; all alias references must resolve.
  // validateAliasRefs covers both cycle detection and unknown-alias with Levenshtein suggestion.
  const refErrors = validateAliasRefs(parseResult.commands);
  if (refErrors.length > 0) {
    const details: TaskValidationDetail[] = refErrors.map((e) => {
      const d: TaskValidationDetail = { message: e.message };
      if (e.suggestion !== undefined) d.suggestion = e.suggestion;
      return d;
    });
    throw new TaskValidationError(details);
  }
}

interface CreateTaskBody {
  name: string;
  description?: string;
  yamlDefinition: string;
  labelRequirements?: string[];
  trigger_configs?: unknown[];
}

export const createTaskRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { orgId: string }; Body: CreateTaskBody }>(
    '/:orgId/tasks',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          required: ['name', 'yamlDefinition'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 2000, default: '' },
            yamlDefinition: { type: 'string', minLength: 1, maxLength: 1048576 },
            labelRequirements: { type: 'array', items: { type: 'string' }, default: [] },
            trigger_configs: { type: 'array', maxItems: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerOrMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      const userId = req.user?.id;
      if (!orgId || !userId) throw new SessionRequiredError();

      // D-12: Run 4-step validation pipeline. Throws TaskValidationError on first failure.
      validateTaskYaml(req.body.yamlDefinition);

      // D-18: Validate trigger_configs entries against TriggerConfig union type.
      if (req.body.trigger_configs !== undefined) {
        const tcErrors = validateTriggerConfigs(req.body.trigger_configs);
        if (tcErrors.length > 0) throw new TaskValidationError(tcErrors);
      }

      const repos = makeRepos(fastify.db, fastify.mek);
      const created = await repos.forOrg(orgId).tasks.create({
        name: req.body.name,
        description: req.body.description ?? '',
        yamlDefinition: req.body.yamlDefinition,
        labelRequirements: req.body.labelRequirements ?? [],
        createdByUserId: userId,
        // exactOptionalPropertyTypes: only spread triggerConfigs when defined
        ...(req.body.trigger_configs !== undefined && {
          triggerConfigs: req.body
            .trigger_configs as import('../../plugins-trigger/types.js').TriggerConfig[],
        }),
      });

      return reply.status(201).send({ id: created.id });
    },
  );
};
