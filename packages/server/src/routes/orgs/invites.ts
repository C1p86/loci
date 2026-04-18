import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { inviteTemplate } from '../../email/templates/invite.js';
import { inviteRevokedTemplate } from '../../email/templates/invite-revoked.js';
import { roleChangedTemplate } from '../../email/templates/role-changed.js';
import {
  InviteNotFoundError,
  OrgMembershipRequiredError,
  OrgNotFoundError,
  RoleInsufficientError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireOwnerAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner') throw new RoleInsufficientError('owner');
}

interface CreateInviteBody {
  email: string;
  role: 'member' | 'viewer';
}

interface ChangeRoleBody {
  role: 'member' | 'viewer';
}

export const invitesRoute: FastifyPluginAsync = async (fastify) => {
  // POST /api/orgs/:orgId/invites — owner creates invite
  fastify.post<{ Params: { orgId: string }; Body: CreateInviteBody }>(
    '/:orgId/invites',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          required: ['email', 'role'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', format: 'email', maxLength: 254 },
            role: { type: 'string', enum: ['member', 'viewer'] },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerAndOrgMatch(req);
      // requireOwnerAndOrgMatch guarantees req.org and req.user are non-null
      const orgId = req.org?.id;
      const userId = req.user?.id;
      const userEmail = req.user?.email;
      if (!orgId || !userId || !userEmail) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);

      const orgRows = await repos.admin.findOrgById(orgId);
      const org = orgRows[0];
      if (!org) throw new OrgNotFoundError(orgId);

      const created = await repos.forOrg(orgId).invites.create({
        inviterUserId: userId,
        email: req.body.email,
        role: req.body.role,
      });

      const link = `https://${req.headers.host ?? 'localhost'}/invites/${encodeURIComponent(created.token)}/accept`;
      const tpl = inviteTemplate({
        link,
        orgName: org.name,
        inviterEmail: userEmail,
        role: req.body.role,
      });
      try {
        await fastify.emailTransport.send({ to: req.body.email, ...tpl });
      } catch (err) {
        fastify.log.warn({ err, inviteId: created.id }, 'failed to send invite email');
      }

      return reply.status(201).send({
        inviteId: created.id,
        token: created.token,
        expiresAt: created.expiresAt.toISOString(),
      });
    },
  );

  // GET /api/orgs/:orgId/invites — list pending (owner only)
  fastify.get<{ Params: { orgId: string } }>(
    '/:orgId/invites',
    {
      preHandler: [fastify.requireAuth],
    },
    async (req, _reply) => {
      requireOwnerAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const rows = await repos.forOrg(orgId).invites.listPending();
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      }));
    },
  );

  // DELETE /api/orgs/:orgId/invites/:inviteId — revoke invite
  fastify.delete<{ Params: { orgId: string; inviteId: string } }>(
    '/:orgId/invites/:inviteId',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireOwnerAndOrgMatch(req);
      const orgId = req.org?.id;
      const userEmail = req.user?.email;
      if (!orgId || !userEmail) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const orgScoped = repos.forOrg(orgId);

      // Fetch first to get invite details for notification
      const pending = await orgScoped.invites.listPending();
      const target = pending.find((p) => p.id === req.params.inviteId);
      if (!target) {
        throw new InviteNotFoundError();
      }

      await orgScoped.invites.revoke(req.params.inviteId);

      // Notify invitee
      const orgRows = await repos.admin.findOrgById(orgId);
      const org = orgRows[0];
      if (org) {
        const tpl = inviteRevokedTemplate({ orgName: org.name, revokerEmail: userEmail });
        try {
          await fastify.emailTransport.send({ to: target.email, ...tpl });
        } catch (err) {
          fastify.log.warn({ err, inviteId: target.id }, 'failed to send invite-revoked email');
        }
      }

      return reply.status(204).send();
    },
  );
};

export const membersRoute: FastifyPluginAsync = async (fastify) => {
  // PATCH /api/orgs/:orgId/members/:userId — change member role
  fastify.patch<{ Params: { orgId: string; userId: string }; Body: ChangeRoleBody }>(
    '/:orgId/members/:userId',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          additionalProperties: false,
          properties: {
            role: { type: 'string', enum: ['member', 'viewer'] },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerAndOrgMatch(req);
      const orgId = req.org?.id;
      const userEmail = req.user?.email;
      if (!orgId || !userEmail) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);

      await repos.admin.changeRole({
        orgId,
        userId: req.params.userId,
        newRole: req.body.role,
      });

      // Send role-changed email to the affected member
      const userRows = await repos.admin.findUserById(req.params.userId);
      const user = userRows[0];
      if (user) {
        const orgRows = await repos.admin.findOrgById(orgId);
        const org = orgRows[0];
        if (org) {
          const tpl = roleChangedTemplate({
            orgName: org.name,
            newRole: req.body.role,
            changedByEmail: userEmail,
          });
          try {
            await fastify.emailTransport.send({ to: user.email, ...tpl });
          } catch (err) {
            fastify.log.warn({ err, userId: user.id }, 'failed to send role-changed email');
          }
        }
      }

      return reply.status(200).send({ ok: true });
    },
  );
};
