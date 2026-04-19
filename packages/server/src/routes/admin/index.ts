// Phase 9: admin route barrel.
// Registered at /admin prefix (final path: /api/admin/* via routes/index.ts).
import type { FastifyPluginAsync } from 'fastify';
import { rotateMekRoute } from './rotate-mek.js';

export const registerAdminRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(rotateMekRoute);
};
