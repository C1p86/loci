// GET /api/orgs/:orgId/secrets — any org member (including Viewer) can list secrets.
// D-19: returns METADATA ONLY — never ciphertext, iv, authTag, aad, or plaintext value.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { OrgMembershipRequiredError, SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  // Any role (owner/member/viewer) can list secrets — read-only endpoint per D-19
}

export const listSecretsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string } }>(
    '/:orgId/secrets',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      requireMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const rows = await repos.forOrg(orgId).secrets.list();

      // SEC-04: Explicit field selection — do NOT spread row (guards against future schema changes)
      return rows.map((s) => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
      }));
    },
  );
};
