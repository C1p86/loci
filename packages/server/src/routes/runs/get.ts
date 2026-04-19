// packages/server/src/routes/runs/get.ts
//
// GET /api/orgs/:orgId/runs/:runId
// Plan 10-04: full run row minus param_overrides (T-10-04-01 / SEC-04 spirit).
// Auth: any member (Owner/Member/Viewer).

import type { FastifyPluginAsync } from 'fastify';
import { RunNotFoundError, SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireAnyMember } from './helpers.js';

export const getRunRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string; runId: string } }>(
    '/:orgId/runs/:runId',
    {
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireAnyMember(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const { runId } = req.params;
      const repos = makeRepos(fastify.db, fastify.mek);

      const run = await repos.forOrg(orgId).taskRuns.getById(runId);
      if (!run) throw new RunNotFoundError();

      // T-10-04-01: strip paramOverrides (SEC-04 spirit — may contain plaintext secrets)
      const { paramOverrides: _stripped, ...safeRun } = run;

      return reply.status(200).send(safeRun);
    },
  );
};
