// GET /api/orgs/:orgId/dlq — any member; cursor-paginated; filters plugin_name, failure_reason, since.
// D-21: cursor-based pagination by (receivedAt DESC, id DESC).
// T-12-04-05: Explicit field selection — defense-in-depth against accidental scrub bypass.

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireAnyMember } from '../runs/helpers.js';

export const listDlqRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { orgId: string };
    Querystring: {
      plugin_name?: 'github' | 'perforce';
      failure_reason?: string;
      since?: string;
      limit?: number;
      cursor?: string;
    };
  }>(
    '/:orgId/dlq',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plugin_name: { type: 'string', enum: ['github', 'perforce'] },
            failure_reason: {
              type: 'string',
              enum: [
                'signature_invalid',
                'parse_failed',
                'no_task_matched',
                'task_validation_failed',
                'internal',
              ],
            },
            since: { type: 'string', format: 'date-time' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            cursor: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      requireAnyMember(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const { plugin_name, failure_reason, since, limit, cursor } = req.query;

      // Parse cursor: format is "<isoDate>:<id>"
      let parsedCursor: { receivedAt: Date; id: string } | undefined;
      if (cursor) {
        const colonIdx = cursor.indexOf(':');
        if (colonIdx > 0) {
          const isoDate = cursor.slice(0, colonIdx);
          const cursorId = cursor.slice(colonIdx + 1);
          const ts = new Date(isoDate);
          if (!Number.isNaN(ts.getTime()) && cursorId) {
            parsedCursor = { receivedAt: ts, id: cursorId };
          }
        }
      }

      type DlqFailureReason =
        | 'signature_invalid'
        | 'parse_failed'
        | 'no_task_matched'
        | 'task_validation_failed'
        | 'internal';

      const entries = await repos.forOrg(orgId).dlqEntries.list({
        // exactOptionalPropertyTypes: only include keys when value is defined
        ...(plugin_name !== undefined && { pluginName: plugin_name }),
        ...(failure_reason !== undefined && {
          failureReason: failure_reason as DlqFailureReason,
        }),
        ...(since !== undefined && { since: new Date(since) }),
        ...(limit !== undefined && { limit }),
        ...(parsedCursor !== undefined && { cursor: parsedCursor }),
      });

      const effectiveLimit = limit ?? 50;
      const nextCursor =
        entries.length === effectiveLimit
          ? `${entries[entries.length - 1]?.receivedAt.toISOString()}:${entries[entries.length - 1]?.id}`
          : undefined;

      // T-12-04-05: Explicit field selection — never leak unintended columns.
      return reply.status(200).send({
        entries: entries.map((e) => ({
          id: e.id,
          pluginName: e.pluginName,
          deliveryId: e.deliveryId,
          failureReason: e.failureReason,
          httpStatus: e.httpStatus,
          receivedAt: e.receivedAt,
          retriedAt: e.retriedAt,
          retryResult: e.retryResult,
          scrubbedHeaders: e.scrubbedHeaders,
          scrubbedBody: e.scrubbedBody,
        })),
        ...(nextCursor !== undefined && { nextCursor }),
      });
    },
  );
};
