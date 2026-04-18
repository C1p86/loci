// GET /api/orgs/:orgId/secret-audit-log — Owner only per D-23.
// D-23: paginated audit log; default limit 100, max 1000 (clamped at repo layer too).
// Note: URL is /secret-audit-log (not nested under /secrets/) per D-23.

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireOwnerAndOrgMatch } from './create.js';

interface AuditLogQuery {
  limit: number;
  offset: number;
}

export const auditLogRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string }; Querystring: AuditLogQuery }>(
    '/:orgId/secret-audit-log',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerAndOrgMatch(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const entries = await repos.forOrg(orgId).secretAuditLog.list({
        limit: req.query.limit,
        offset: req.query.offset,
      });

      // SEC-04: explicit field projection — audit log columns have no ciphertext/iv/tag anyway,
      // but we still whitelist fields for defense-in-depth and future schema evolution.
      return reply.status(200).send({
        entries: entries.map((e) => ({
          id: e.id,
          secretName: e.secretName,
          action: e.action,
          actorUserId: e.actorUserId,
          createdAt: e.createdAt.toISOString(),
          secretId: e.secretId ?? null,
        })),
        limit: req.query.limit,
        offset: req.query.offset,
      });
    },
  );
};
