import type { FastifyPluginAsync } from 'fastify';

export const csrfRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get('/csrf', async (_req, reply) => {
    const token = await reply.generateCsrf();
    reply.setCookie('xci_csrf', token, {
      path: '/',
      sameSite: 'strict',
      httpOnly: false, // intentionally readable by JS for header injection
      secure: process.env.NODE_ENV === 'production',
    });
    return reply.send({ csrfToken: token });
  });
};
