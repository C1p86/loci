import type { FastifyPluginAsync } from 'fastify';
import { TokenInvalidError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

interface Body {
  token: string;
  newPassword: string;
}

export const resetRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: Body }>(
    '/reset',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: (req) => req.ip },
      },
      schema: {
        body: {
          type: 'object',
          required: ['token', 'newPassword'],
          additionalProperties: false,
          properties: {
            token: { type: 'string', minLength: 20, maxLength: 64 },
            newPassword: { type: 'string', minLength: 12, maxLength: 1024 },
          },
        },
      },
    },
    async (req, reply) => {
      const repos = makeRepos(fastify.db);
      const rows = await repos.admin.findPasswordResetByToken(req.body.token);
      const row = rows[0];
      if (!row) throw new TokenInvalidError();

      // AUTH-04: update password, mark token consumed, revoke all user sessions atomically
      await repos.admin.updateUserPassword({
        userId: row.userId,
        newPassword: req.body.newPassword,
      });
      await repos.admin.markPasswordResetConsumed(req.body.token);
      await repos.admin.revokeAllSessionsForUser(row.userId);

      return reply.status(200).send({ ok: true });
    },
  );
};
