import type { FastifyPluginAsync } from 'fastify';

export const registerRoutes: FastifyPluginAsync = async (fastify) => {
  // Healthcheck — no auth, no CSRF, no rate-limit override
  fastify.get('/healthz', async (_req, reply) => {
    return reply.send({ ok: true });
  });

  // Plan 06 will register auth routes via a child plugin here.
  // Plan 07 will register org/invite routes via a child plugin here.
};
