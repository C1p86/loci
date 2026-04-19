// packages/server/src/routes/runs/trigger.ts
//
// POST /api/orgs/:orgId/tasks/:taskId/runs
// Plan 10-04: DISP-03, DISP-04, DISP-09, QUOTA-04.
//
// Flow:
//   1. requireMemberOrAbove — Viewers blocked.
//   2. Load task (forOrg scoping — cross-org returns 404).
//   3. QUOTA-04 gate: countConcurrentByOrg + countByOrg(queue) >= maxConcurrentTasks * 2 → 429.
//   4. Resolve params via dispatch-resolver (DISP-09 / D-34 precedence).
//   5. Build task_snapshot JSONB.
//   6. Compute timeout (body override > task.defaultTimeoutSeconds > 3600).
//   7. Insert task_runs row (state='queued').
//   8. Enqueue in fastify.dispatchQueue (AFTER DB insert — accept crash-between-7-8 risk).
//   9. Return 201 {runId, state:'queued'}.
//
// Security invariants:
//   T-10-04-02: Pino redaction paths for param_overrides extended in app.ts.
//   T-10-04-03: Viewer rejected via requireMemberOrAbove.
//   T-10-04-05: QUOTA-04 gate + rate-limit from global @fastify/rate-limit.
//   T-10-04-09: CSRF guard via onRequest: [fastify.csrfProtection].

import type { FastifyPluginAsync } from 'fastify';
import { RunQuotaExceededError, SessionRequiredError, TaskNotFoundError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { resolveTaskParams } from '../../services/dispatch-resolver.js';
import type { TaskSnapshot } from '../../ws/types.js';
import { requireMemberOrAbove } from './helpers.js';

interface TriggerRunBody {
  param_overrides?: Record<string, string>;
  timeout_seconds?: number;
}

export const triggerRunRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Params: { orgId: string; taskId: string };
    Body: TriggerRunBody;
  }>(
    '/:orgId/tasks/:taskId/runs',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            param_overrides: {
              type: 'object',
              additionalProperties: { type: 'string' },
              maxProperties: 50,
              default: {},
            },
            timeout_seconds: {
              type: 'integer',
              minimum: 1,
              maximum: 86400,
            },
          },
        },
      },
    },
    async (req, reply) => {
      // 1. Auth guard
      requireMemberOrAbove(req);
      const orgId = req.org?.id;
      const userId = req.user?.id;
      if (!orgId || !userId) throw new SessionRequiredError();

      const { taskId } = req.params;
      const repos = makeRepos(fastify.db, fastify.mek);

      // 2. Load task (forOrg scoping — task in other org returns undefined → 404)
      const task = await repos.forOrg(orgId).tasks.getById(taskId);
      if (!task) throw new TaskNotFoundError();

      // 3. QUOTA-04 queue depth check (D-07 / D-11)
      const active = await repos.admin.countConcurrentByOrg(orgId);
      const queued = fastify.dispatchQueue.countByOrg(orgId);
      const planRows = await repos.forOrg(orgId).plan.get();
      const plan = planRows[0];
      if (!plan) throw new TaskNotFoundError(); // org setup incomplete — treat like 404
      const threshold = plan.maxConcurrentTasks * 2;
      if (active + queued >= threshold) {
        throw new RunQuotaExceededError({
          used: active + queued,
          max: threshold,
          planName: plan.planName,
        });
      }

      // 4. Resolve params (DISP-09 / D-34: runOverrides > orgSecrets > unresolved)
      // Collect all org secrets as plaintext map (resolveByName handles DEK internally)
      const secretNames = (await repos.forOrg(orgId).secrets.list()).map((s) => s.name);
      const orgSecrets: Record<string, string> = {};
      for (const name of secretNames) {
        try {
          orgSecrets[name] = await repos.forOrg(orgId).secrets.resolveByName(name, userId);
        } catch {
          // If a secret fails to decrypt, skip it — may be handled agent-side
        }
      }

      const { resolvedYaml, unresolved } = resolveTaskParams({
        task: {
          id: taskId,
          name: task.name,
          yamlDefinition: task.yamlDefinition,
        },
        runOverrides: req.body.param_overrides ?? {},
        orgSecrets,
      });

      // 5. Build task_snapshot JSONB (snake_case for protocol wire format)
      const taskSnapshot: TaskSnapshot = {
        task_id: taskId,
        name: task.name,
        description: task.description,
        yaml_definition: resolvedYaml,
        label_requirements: task.labelRequirements ?? [],
      };

      // 6. Compute timeout
      const timeoutSeconds = req.body.timeout_seconds ?? task.defaultTimeoutSeconds ?? 3600;

      // 7. Insert task_runs row
      const newRun = await repos.forOrg(orgId).taskRuns.create({
        taskId,
        taskSnapshot: taskSnapshot as unknown as Record<string, unknown>,
        paramOverrides: req.body.param_overrides ?? {},
        triggeredByUserId: userId,
        timeoutSeconds,
      });

      // 8. Enqueue in DispatchQueue AFTER DB insert.
      // If server crashes between here and the enqueue, boot reconciliation (DISP-08) re-enqueues.
      fastify.dispatchQueue.enqueue({
        runId: newRun.id,
        orgId,
        taskSnapshot,
        params: { ...orgSecrets, ...(req.body.param_overrides ?? {}) },
        labelRequirements: task.labelRequirements ?? [],
        timeoutSeconds,
      });

      // 9. Return 201
      return reply.status(201).send({
        runId: newRun.id,
        state: 'queued' as const,
        ...(unresolved.length > 0 && { missing_params: unresolved }),
      });
    },
  );
};
