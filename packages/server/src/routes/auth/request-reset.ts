import type { FastifyPluginAsync } from 'fastify';
import { passwordResetTemplate } from '../../email/templates/password-reset.js';
import { makeRepos } from '../../repos/index.js';

interface Body {
  email: string;
}

export const requestResetRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: Body }>(
    '/request-reset',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '1 hour',
          keyGenerator: (req) => {
            const b = req.body as { email?: string } | undefined;
            const email = b?.email?.toLowerCase() ?? 'anon';
            return `${req.ip}:${email}`;
          },
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          additionalProperties: false,
          properties: { email: { type: 'string', format: 'email', maxLength: 254 } },
        },
      },
    },
    async (req, reply) => {
      const repos = makeRepos(fastify.db, fastify.mek);
      const rows = await repos.admin.findUserByEmail(req.body.email);
      const user = rows[0];

      // Always 204 — no enumeration (D-10 + T-07-06-04)
      if (user && user.emailVerifiedAt !== null) {
        const pr = await repos.admin.createPasswordReset({ userId: user.id });
        const link = `https://${req.headers.host ?? 'localhost'}/reset?token=${encodeURIComponent(pr.token)}`;
        const tpl = passwordResetTemplate({ link, email: user.email });
        try {
          await fastify.emailTransport.send({ to: user.email, ...tpl });
        } catch (err) {
          fastify.log.warn({ err, userId: user.id }, 'failed to send password reset email');
        }
      }

      return reply.status(204).send();
    },
  );
};
