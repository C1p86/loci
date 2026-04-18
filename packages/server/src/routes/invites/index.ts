import type { FastifyPluginAsync } from 'fastify';
import { acceptInviteRoute } from './accept.js';

export const registerInviteRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(acceptInviteRoute);
};
