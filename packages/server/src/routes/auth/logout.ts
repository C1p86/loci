import type { FastifyPluginAsync } from 'fastify';
import { makeRepos } from '../../repos/index.js';

export const logoutRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/logout',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      const repos = makeRepos(fastify.db, fastify.mek);
      // req.session is guaranteed non-null here — requireAuth preHandler already validated it
      const sessionId = req.session?.id;
      if (sessionId) {
        await repos.admin.revokeSession(sessionId);
      }
      reply.clearCookie('xci_sid', { path: '/' });
      return reply.status(204).send();
    },
  );
};
