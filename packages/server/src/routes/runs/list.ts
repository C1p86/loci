// packages/server/src/routes/runs/list.ts
//
// GET /api/orgs/:orgId/runs
// Plan 10-04: DISP-04, cursor-based pagination by queued_at DESC.
//
// Query params: state (CSV), taskId, limit (1-200 default 50), since (ISO cursor).
// Security: param_overrides stripped from all run objects in response (T-10-04-01).
// Auth: any member (Owner/Member/Viewer) — read-only.

import type { FastifyPluginAsync } from 'fastify';
import type { TaskRunState } from '../../db/schema.js';
import { SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireAnyMember } from './helpers.js';

// Valid task run states for CSV validation
const VALID_STATES = new Set<TaskRunState>([
  'queued',
  'dispatched',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'orphaned',
]);

export const listRunsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Params: { orgId: string };
    Querystring: {
      state?: string;
      taskId?: string;
      limit?: number;
      since?: string;
    };
  }>(
    '/:orgId/runs',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            state: { type: 'string' },
            taskId: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
            since: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      requireAnyMember(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();

      const { taskId, since } = req.query;
      const limit = req.query.limit ?? 50;

      // Parse state CSV and validate each value
      let stateFilter: TaskRunState | TaskRunState[] | undefined;
      if (req.query.state) {
        const parts = req.query.state.split(',').map((s) => s.trim()) as TaskRunState[];
        const invalid = parts.find((p) => !VALID_STATES.has(p));
        if (invalid) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: `Invalid state value: ${invalid}. Valid states: ${[...VALID_STATES].join(', ')}`,
          });
        }
        stateFilter = parts.length === 1 ? (parts[0] as TaskRunState) : parts;
      }

      const repos = makeRepos(fastify.db, fastify.mek);

      // Build opts without undefined values (exactOptionalPropertyTypes discipline)
      const runs = await repos.forOrg(orgId).taskRuns.list({
        limit,
        ...(stateFilter !== undefined && { state: stateFilter }),
        ...(taskId !== undefined && { taskId }),
        ...(since !== undefined && { since: new Date(since) }),
      });

      // T-10-04-01: strip paramOverrides from all responses (SEC-04 spirit)
      const masked = runs.map(({ paramOverrides: _stripped, ...rest }) => rest);

      // Cursor: if we got a full page, provide cursor for next page
      const nextCursor =
        runs.length === limit ? (runs[runs.length - 1]?.queuedAt.toISOString() ?? null) : null;

      return reply.status(200).send({ runs: masked, nextCursor });
    },
  );
};
