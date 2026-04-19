// packages/server/src/routes/runs/index.ts
//
// Barrel that registers all run-related route plugins.
// Plan 10-04.
//
// Route tree (mounted under /api/orgs):
//   POST  /:orgId/tasks/:taskId/runs           → triggerRunRoute
//   GET   /:orgId/runs                          → listRunsRoute
//   GET   /:orgId/runs/:runId                   → getRunRoute
//   POST  /:orgId/runs/:runId/cancel            → cancelRunRoute
//   GET   /:orgId/usage                         → usageRoute

import type { FastifyPluginAsync } from 'fastify';
import { cancelRunRoute } from './cancel.js';
import { getRunRoute } from './get.js';
import { listRunsRoute } from './list.js';
import { triggerRunRoute } from './trigger.js';
import { usageRoute } from './usage.js';

export const registerRunRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(triggerRunRoute);
  await fastify.register(cancelRunRoute);
  await fastify.register(listRunsRoute);
  await fastify.register(getRunRoute);
  await fastify.register(usageRoute);
};
