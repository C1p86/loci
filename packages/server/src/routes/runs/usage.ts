// packages/server/src/routes/runs/usage.ts
//
// GET /api/orgs/:orgId/usage
// Plan 10-04: QUOTA-05, QUOTA-06.
// Returns {agents:{used,max}, concurrent:{used,max}, retention_days}.
// Auth: any member (Owner/Member/Viewer) — informational endpoint.
// T-10-04-08: plan details visible to Viewer; this is accepted (not secret).

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireAnyMember } from './helpers.js';

export const usageRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string } }>(
    '/:orgId/usage',
    {
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireAnyMember(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);

      // Parallel fetch for performance
      const [planRows, agentsUsed, concurrentUsed] = await Promise.all([
        repos.forOrg(orgId).plan.get(),
        repos.admin.countAgentsByOrg(orgId),
        repos.admin.countConcurrentByOrg(orgId),
      ]);

      const plan = planRows[0];
      if (!plan) {
        // Org setup incomplete — return safe defaults matching Free plan
        return reply.status(200).send({
          agents: { used: agentsUsed, max: 5 },
          concurrent: { used: concurrentUsed, max: 5 },
          retention_days: 30,
        });
      }

      return reply.status(200).send({
        agents: { used: agentsUsed, max: plan.maxAgents },
        concurrent: { used: concurrentUsed, max: plan.maxConcurrentTasks },
        retention_days: plan.logRetentionDays,
      });
    },
  );
};
