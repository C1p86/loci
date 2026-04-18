// Barrel: registers all 5 Task CRUD routes.
// Mounted with { prefix: '/orgs' } by registerRoutes so paths become:
//   GET    /api/orgs/:orgId/tasks
//   GET    /api/orgs/:orgId/tasks/:taskId
//   POST   /api/orgs/:orgId/tasks
//   PATCH  /api/orgs/:orgId/tasks/:taskId
//   DELETE /api/orgs/:orgId/tasks/:taskId

import type { FastifyPluginAsync } from 'fastify';
import { createTaskRoute } from './create.js';
import { deleteTaskRoute } from './delete.js';
import { getTaskRoute } from './get.js';
import { listTasksRoute } from './list.js';
import { updateTaskRoute } from './update.js';

export const registerTaskRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listTasksRoute);
  await fastify.register(getTaskRoute);
  await fastify.register(createTaskRoute);
  await fastify.register(updateTaskRoute);
  await fastify.register(deleteTaskRoute);
};
