import type { FastifyPluginAsync } from 'fastify';
import { verifyPassword } from '../../crypto/password.js';
import { EmailNotVerifiedError, InvalidCredentialsError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

interface LoginBody {
  email: string;
  password: string;
}

export const loginRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
          keyGenerator: (req) => {
            const body = req.body as { email?: string } | undefined;
            const email = body?.email?.toLowerCase() ?? 'anon';
            return `${req.ip}:${email}`;
          },
        },
      },
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            password: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (req, reply) => {
      const repos = makeRepos(fastify.db);
      const userRows = await repos.admin.findUserByEmail(req.body.email);
      const user = userRows[0];

      // Constant-time: run a dummy verify even when user is missing to make the response
      // timing similar between "unknown email" and "wrong password" (T-07-06-03).
      if (!user) {
        await verifyPassword(
          '$argon2id$v=19$m=19456,t=2,p=1$abcdefghijklmnop$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          'dummy',
        ).catch(() => {});
        throw new InvalidCredentialsError();
      }

      const ok = await verifyPassword(user.passwordHash, req.body.password);
      if (!ok) throw new InvalidCredentialsError();

      // SC-1: user must have verified email before login (T-07-06-10)
      if (user.emailVerifiedAt === null) {
        throw new EmailNotVerifiedError();
      }

      const firstRows = await repos.admin.findUserFirstOrgMembership(user.id);
      const firstMembership = firstRows[0];
      if (!firstMembership) {
        // Should never happen — signupTx always creates a membership.
        throw new InvalidCredentialsError(); // obscure the state
      }

      const session = await repos.admin.createSession({
        userId: user.id,
        activeOrgId: firstMembership.orgId,
      });

      reply.setCookie('xci_sid', session.token, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 14 * 24 * 60 * 60, // 14 days (D-13)
      });

      return reply.status(200).send({
        userId: user.id,
        orgId: firstMembership.orgId,
      });
    },
  );
};
