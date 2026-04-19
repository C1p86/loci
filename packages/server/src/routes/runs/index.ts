// packages/server/src/routes/runs/index.ts
//
// Barrel that registers all run-related route plugins.
// Plan 10-04 + Plan 11-03.
//
// Route tree (mounted under /api/orgs):
//   POST  /:orgId/tasks/:taskId/runs           → triggerRunRoute
//   GET   /:orgId/runs                          → listRunsRoute
//   GET   /:orgId/runs/:runId                   → getRunRoute
//   POST  /:orgId/runs/:runId/cancel            → cancelRunRoute
//   GET   /:orgId/usage                         → usageRoute
//   GET   /:orgId/runs/:runId/logs.log          → downloadLogRoute  (Plan 11-03)
//   WS    /ws/orgs/:orgId/runs/:runId/logs      → logsWsRoute      (Plan 11-03, no /api prefix)

import type { FastifyPluginAsync } from 'fastify';
import { cancelRunRoute } from './cancel.js';
import { downloadLogRoute } from './download.js';
import { getRunRoute } from './get.js';
import { listRunsRoute } from './list.js';
import { logsWsRoute } from './logs-ws.js';
import { triggerRunRoute } from './trigger.js';
import { usageRoute } from './usage.js';

export const registerRunRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(triggerRunRoute);
  await fastify.register(cancelRunRoute);
  await fastify.register(listRunsRoute);
  await fastify.register(getRunRoute);
  await fastify.register(usageRoute);
  // Plan 11-03: download endpoint (mounted under /api/orgs by the parent prefix)
  // Final path: GET /api/orgs/:orgId/runs/:runId/logs.log
  await fastify.register(downloadLogRoute);
};

// Re-export logsWsRoute so app.ts can register it at the root level
// (WS path: /ws/orgs/:orgId/runs/:runId/logs — no /api prefix, mirrors agent WS pattern)
export { logsWsRoute };
