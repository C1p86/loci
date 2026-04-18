// GET /api/orgs/:orgId/agents — any org member (including Viewer) can list agents.
// D-12: state is computed at read-time (online = last_seen_at < 60s ago AND state != draining).
// D-20: no public endpoint — session required.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { OrgMembershipRequiredError, SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

function requireMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  // Any role (owner/member/viewer) can list agents — read-only endpoint
}

const ONLINE_WINDOW_MS = 60_000;

export const agentListRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string } }>(
    '/:orgId/agents',
    { preHandler: [fastify.requireAuth] },
    async (req) => {
      requireMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db);
      const rows = await repos.forOrg(orgId).agents.list();
      const now = Date.now();

      return rows.map((a) => {
        // D-12 read-time state computation:
        // - 'draining' stored state is always returned as-is
        // - 'online' is computed: state='online' AND last_seen_at within 60s
        // - otherwise 'offline'
        let computed: 'online' | 'offline' | 'draining';
        if (a.state === 'draining') {
          computed = 'draining';
        } else if (a.lastSeenAt && now - a.lastSeenAt.getTime() < ONLINE_WINDOW_MS) {
          computed = 'online';
        } else {
          computed = 'offline';
        }

        return {
          id: a.id,
          hostname: a.hostname,
          labels: a.labels,
          state: computed,
          lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
          registeredAt: a.registeredAt.toISOString(),
        };
      });
    },
  );
};
