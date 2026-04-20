import type { FastifyPluginAsync } from 'fastify';
import { buildEmailLink } from '../../email/link.js';
import { verifyEmailTemplate } from '../../email/templates/verify-email.js';
import { makeRepos } from '../../repos/index.js';

interface SignupBody {
  email: string;
  password: string;
}

export const signupRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: SignupBody }>(
    '/signup',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
          keyGenerator: (req) => req.ip,
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            password: { type: 'string', minLength: 12, maxLength: 1024 },
          },
        },
      },
    },
    async (req, reply) => {
      const repos = makeRepos(fastify.db, fastify.mek);
      const result = await repos.admin.signupTx({
        email: req.body.email,
        password: req.body.password,
      });

      // Create verification record + send email
      const v = await repos.admin.createEmailVerification({ userId: result.user.id });
      const verifyLink = buildEmailLink(
        { appBaseUrl: fastify.config.APP_BASE_URL, headerHost: req.headers.host },
        `/verify-email/${encodeURIComponent(v.token)}`,
      );
      const tpl = verifyEmailTemplate({ link: verifyLink, email: result.user.email });
      try {
        await fastify.emailTransport.send({ to: result.user.email, ...tpl });
      } catch (err) {
        fastify.log.warn({ err, userId: result.user.id }, 'failed to send verification email');
        // Do not fail signup on email send — user can request resend later.
      }

      return reply.status(201).send({
        userId: result.user.id,
        orgId: result.org.id,
      });
    },
  );
};
