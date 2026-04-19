// packages/server/src/routes/runs/download.ts
//
// GET /api/orgs/:orgId/runs/:runId/logs.log
// Plan 11-03 Task 1 — D-15/D-16 streaming download.
//
// Flow:
//   1. requireAuth preHandler + requireAnyMember (any org member, including viewer)
//   2. Load run via forOrg scoping — 404 if missing or cross-org
//   3. Set Content-Type, Content-Disposition, Cache-Control headers
//   4. reply.hijack() → stream chunks via cursor pagination (1000 rows/page)
//   5. Format: `[<ISO ts> <STREAM>] <data>\n` per chunk
//   6. reply.raw.end() on completion
//
// Security invariants (T-11-03-01, T-11-03-04):
//   - forOrg(orgId).taskRuns.getById(runId) returns undefined for cross-org runId → 404
//   - cursor pagination avoids buffering large logs in memory
//   - reply.hijack() bypasses Fastify serialization (no double-buffering)

import type { FastifyPluginAsync } from 'fastify';
import { RunNotFoundError, SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { requireAnyMember } from './helpers.js';

const CURSOR_LIMIT = 1000; // D-15: pagination size

export const downloadLogRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string; runId: string } }>(
    '/:orgId/runs/:runId/logs.log',
    { preHandler: [fastify.requireAuth] },
    async (req, reply) => {
      // Auth + org isolation
      requireAnyMember(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();
      const { runId } = req.params;

      const repos = makeRepos(fastify.db, fastify.mek);
      const run = await repos.forOrg(orgId).taskRuns.getById(runId);
      if (!run) throw new RunNotFoundError();

      // Set headers BEFORE hijack so they are flushed with the HTTP response head
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="run-${runId}.log"`);
      reply.header('Cache-Control', 'no-store');

      // D-15: hijack to write raw bytes — Fastify won't buffer or serialize
      reply.hijack();
      const raw = reply.raw;

      // Write HTTP response head manually (hijack skips this)
      raw.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="run-${runId}.log"`,
        'Cache-Control': 'no-store',
      });

      try {
        // D-15: cursor pagination — never load entire log into memory
        let lastSeq = -1;
        while (true) {
          const rows = await repos.forOrg(orgId).logChunks.getByRunId(runId, {
            sinceSeq: lastSeq,
            limit: CURSOR_LIMIT,
          });
          if (rows.length === 0) break;
          for (const row of rows) {
            const tsIso = row.ts.toISOString();
            const streamLabel = row.stream.toUpperCase();
            const prefix = `[${tsIso} ${streamLabel}] `;
            // Avoid double newline: if data already ends with \n, don't append another
            const suffix = row.data.endsWith('\n') ? '' : '\n';
            raw.write(`${prefix}${row.data}${suffix}`);
          }
          const lastRow = rows[rows.length - 1];
          if (lastRow) lastSeq = lastRow.seq;
          if (rows.length < CURSOR_LIMIT) break;
        }
      } finally {
        raw.end();
      }
    },
  );
};
