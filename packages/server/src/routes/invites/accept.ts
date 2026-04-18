import type { FastifyPluginAsync } from 'fastify';
import {
  InviteEmailMismatchError,
  InviteNotFoundError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

export const acceptInviteRoute: FastifyPluginAsync = async (fastify) => {
  // POST /api/invites/:token/accept — email-pinned invite acceptance (D-15)
  fastify.post<{ Params: { token: string } }>(
    '/:token/accept',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        params: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string', minLength: 20, maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const userEmail = req.user?.email;
      const userId = req.user?.id;
      // requireAuth preHandler guarantees user is non-null; guard for type narrowing
      if (!userEmail || !userId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const rows = await repos.admin.findInviteByToken(req.params.token);
      const invite = rows[0];
      if (!invite) throw new InviteNotFoundError();

      // Check validity: not accepted, not revoked, not expired — without leaking which failed
      if (
        invite.acceptedAt !== null ||
        invite.revokedAt !== null ||
        invite.expiresAt <= new Date()
      ) {
        throw new InviteNotFoundError();
      }

      // D-15 email-pinned: invitee's email MUST match invite email (case-insensitive)
      if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
        throw new InviteEmailMismatchError();
      }

      // Mark invite accepted (single-use) + add org membership (idempotent)
      await repos.admin.markInviteAccepted({ inviteId: invite.id, acceptedByUserId: userId });
      await repos.admin.addMemberToOrg({
        orgId: invite.orgId,
        userId,
        role: invite.role,
      });

      return reply.status(200).send({
        orgId: invite.orgId,
        role: invite.role,
      });
    },
  );
};
