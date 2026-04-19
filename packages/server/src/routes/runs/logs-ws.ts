// packages/server/src/routes/runs/logs-ws.ts
//
// GET /ws/orgs/:orgId/runs/:runId/logs  (WebSocket upgrade)
// Plan 11-03 Task 1 — D-12/D-13/D-14.
//
// Frame grammar (client → server):
//   {type:'subscribe', sinceSeq?: number}  — first and only client frame
//
// Frame grammar (server → client):
//   {type:'chunk', seq, stream, data, ts}  — each persisted log chunk
//   {type:'end', state, exitCode}          — run reached terminal state
//   {type:'error', code}                   — auth/validation error before close
//   {type:'gap', droppedCount}             — slow subscriber dropped chunks (from LogFanout)
//
// Auth flow (T-11-03-03):
//   authPlugin onRequest fires BEFORE the WS upgrade handshake — req.user / req.org already
//   populated from xci_sid cookie when this handler fires. preHandler:[requireAuth] enforces it.
//
// Security invariants:
//   T-11-03-01: forOrg(orgId).taskRuns.getById(runId) returns undefined for cross-org runId → close
//   T-11-03-07: sinceSeq input validated as integer ≥ -1 before DB query
//   T-11-03-08: readyState checked before each ws.send in catch-up loop

import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import { makeRepos } from '../../repos/index.js';
import { requireAnyMember } from './helpers.js';

const WS_OPEN = 1;
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned']);
const END_GRACE_MS = 5_000; // D-12: close WS 5s after sending end frame
const CURSOR_LIMIT = 1000; // D-14: catch-up pagination

interface SubscribeFrame {
  type: 'subscribe';
  sinceSeq?: number | undefined;
}

/**
 * Parse and validate the subscribe frame from the client.
 * T-11-03-07: sinceSeq must be an integer ≥ -1 if provided.
 */
function parseSubscribeFrame(raw: string): SubscribeFrame | null {
  try {
    const o = JSON.parse(raw) as unknown;
    if (typeof o !== 'object' || o === null) return null;
    const obj = o as Record<string, unknown>;
    if (obj.type !== 'subscribe') return null;
    if (obj.sinceSeq !== undefined) {
      const s = obj.sinceSeq;
      if (typeof s !== 'number' || !Number.isInteger(s) || s < -1) return null;
    }
    const result: SubscribeFrame = { type: 'subscribe' };
    if (obj.sinceSeq !== undefined) {
      result.sinceSeq = obj.sinceSeq as number;
    }
    return result;
  } catch {
    return null;
  }
}

export const logsWsRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgId: string; runId: string } }>(
    '/ws/orgs/:orgId/runs/:runId/logs',
    { websocket: true, preHandler: [fastify.requireAuth] },
    async (socket, req) => {
      // Auth + org membership (T-11-03-03: authPlugin already ran on HTTP upgrade request)
      try {
        requireAnyMember(req);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'AUTHZ_DENIED';
        if ((socket as unknown as { readyState: number }).readyState === WS_OPEN) {
          socket.send(JSON.stringify({ type: 'error', code }));
        }
        socket.close(1008, 'unauthorized');
        return;
      }

      const orgId = req.org?.id;
      if (!orgId) {
        socket.close(1008, 'no session');
        return;
      }

      // Extract params (available via req.params after preHandler)
      const { orgId: urlOrgId, runId } = req.params;

      // Verify org consistency (belt-and-suspenders — requireAnyMember already checks req.org.id === urlOrgId)
      if (orgId !== urlOrgId) {
        socket.send(JSON.stringify({ type: 'error', code: 'AUTHZ_LOG_SUBSCRIPTION' }));
        socket.close(1008, 'unauthorized');
        return;
      }

      const repos = makeRepos(fastify.db, fastify.mek);

      // Load the run — forOrg scoping: cross-org runId returns undefined (T-11-03-01)
      const run = await repos.forOrg(orgId).taskRuns.getById(runId);
      if (!run) {
        if ((socket as unknown as { readyState: number }).readyState === WS_OPEN) {
          socket.send(JSON.stringify({ type: 'error', code: 'NF_RUN' }));
        }
        socket.close(1008, 'not found');
        return;
      }

      // Await first frame: the subscribe handshake
      // Subsequent frames are ignored (future extension point)
      let subscribed = false;

      socket.on('message', async (data: Buffer) => {
        if (subscribed) return; // only process first subscribe frame

        const frame = parseSubscribeFrame(data.toString('utf8'));
        if (!frame) {
          socket.close(4002, 'frame_invalid');
          return;
        }
        subscribed = true;

        // D-14 catch-up: replay DB chunks starting from sinceSeq
        const startFromSeq = frame.sinceSeq ?? -1;
        let lastSeq = startFromSeq;

        try {
          while (true) {
            const rows = await repos.forOrg(orgId).logChunks.getByRunId(runId, {
              sinceSeq: lastSeq,
              limit: CURSOR_LIMIT,
            });
            if (rows.length === 0) break;

            for (const row of rows) {
              // T-11-03-08: check readyState before each send
              if ((socket as unknown as { readyState: number }).readyState !== WS_OPEN) return;
              (socket as WebSocket).send(
                JSON.stringify({
                  type: 'chunk',
                  seq: row.seq,
                  stream: row.stream,
                  data: row.data,
                  ts: row.ts.toISOString(),
                }),
              );
            }
            const lastRow = rows[rows.length - 1];
            if (lastRow) lastSeq = lastRow.seq;
            if (rows.length < CURSOR_LIMIT) break;
          }
        } catch (err) {
          fastify.log.warn({ err, runId, orgId }, 'logs-ws: catch-up query error');
          socket.close(1011, 'server error');
          return;
        }

        // Check if run is already terminal after catch-up completes
        let latestRun: typeof run | undefined;
        try {
          latestRun = await repos.forOrg(orgId).taskRuns.getById(runId);
        } catch {
          latestRun = run; // fallback to the pre-subscribe snapshot
        }

        if (latestRun && TERMINAL_STATES.has(latestRun.state)) {
          // Send end frame and schedule close after 5s grace
          if ((socket as unknown as { readyState: number }).readyState === WS_OPEN) {
            (socket as WebSocket).send(
              JSON.stringify({
                type: 'end',
                state: latestRun.state,
                exitCode: latestRun.exitCode ?? null,
              }),
            );
          }
          const timer = setTimeout(() => {
            try {
              socket.close(1000, 'run ended');
            } catch {
              /* already closed */
            }
          }, END_GRACE_MS);
          timer.unref();
          return; // don't register live subscriber for already-terminal run
        }

        // D-12: register as a live subscriber for ongoing run
        // LogFanout wires ws.on('close') and ws.on('error') for auto-deregistration
        fastify.logFanout.addSubscriber(runId, orgId, socket as WebSocket);
      });
    },
  );
};
