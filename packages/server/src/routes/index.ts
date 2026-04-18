import type { FastifyPluginAsync } from 'fastify';
import { registerAuthRoutes } from './auth/index.js';

export const registerRoutes: FastifyPluginAsync = async (fastify) => {
  // Healthcheck — no auth, no CSRF, no rate-limit override
  fastify.get('/healthz', async (_req, reply) => {
    return reply.send({ ok: true });
  });

  // Auth routes: signup, verify-email, login, logout, request-reset, reset, csrf
  await fastify.register(registerAuthRoutes, { prefix: '/auth' });

  // Plan 07 will register org/invite routes here:
  // await fastify.register(registerOrgRoutes, { prefix: '/orgs' });
  // await fastify.register(registerInviteRoutes, { prefix: '/invites' });
};
