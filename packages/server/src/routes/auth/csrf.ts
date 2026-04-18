import type { FastifyPluginAsync } from 'fastify';

export const csrfRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/csrf', async (_req, reply) => {
    const token = await reply.generateCsrf();
    return reply.send({ csrfToken: token });
  });
};
