// Barrel for DLQ management routes (D-21, Plan 12-04 Task 2).
// Registered under /orgs prefix in routes/index.ts.

import type { FastifyPluginAsync } from 'fastify';
import { listDlqRoute } from './list.js';
import { retryDlqRoute } from './retry.js';

export const registerDlqRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listDlqRoute);
  await fastify.register(retryDlqRoute);
};
