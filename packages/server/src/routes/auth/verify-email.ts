import type { FastifyPluginAsync } from 'fastify';
import { TokenInvalidError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

interface VerifyBody {
  token: string;
}

export const verifyEmailRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: VerifyBody }>(
    '/verify-email',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: (req) => req.ip },
      },
      schema: {
        body: {
          type: 'object',
          required: ['token'],
          additionalProperties: false,
          properties: { token: { type: 'string', minLength: 20, maxLength: 64 } },
        },
      },
    },
    async (req, reply) => {
      const repos = makeRepos(fastify.db, fastify.mek);
      const rows = await repos.admin.findEmailVerificationByToken(req.body.token);
      const row = rows[0];
      if (!row) throw new TokenInvalidError();

      await repos.admin.markEmailVerificationConsumed(req.body.token);
      await repos.admin.markUserEmailVerified(row.userId);

      return reply.status(200).send({ ok: true });
    },
  );
};
