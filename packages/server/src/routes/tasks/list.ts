// GET /api/orgs/:orgId/tasks — any org member (including Viewer) can list tasks.
// D-10: returns metadata only — no yamlDefinition in list payload.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { OrgMembershipRequiredError, SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  // Any role (owner/member/viewer) can list tasks — read-only endpoint
}

export const listTasksRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string } }>(
    '/:orgId/tasks',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      requireMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const rows = await repos.forOrg(orgId).tasks.list();

      return rows.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        labelRequirements: t.labelRequirements,
        slug: t.slug,
        expose_badge: t.exposeBadge,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      }));
    },
  );
};
