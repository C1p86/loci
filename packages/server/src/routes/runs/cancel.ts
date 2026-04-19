// packages/server/src/routes/runs/cancel.ts
//
// POST /api/orgs/:orgId/runs/:runId/cancel
// Plan 10-04: DISP-07, D-25, D-26.
//
// Flow:
//   1. requireAuth + CSRF.
//   2. Load run (forOrg scoping — cross-org returns 404).
//   3. D-26 idempotency: if already terminal → 200 with current state, no-op.
//   4. Authz: Owner always allowed; Member iff run.triggeredByUserId === currentUserId; Viewer always rejected.
//   5. cancelRunTimer(runId) — clear any pending timeout.
//   6. If agentId + WS open: send {type:'cancel', run_id, reason:'manual'}.
//   7. If run was queued: CAS queued→cancelled immediately + dequeue from in-memory queue.
//      If run was dispatched/running: set cancelled_by_user_id (non-state mutation) + register 30s fallback timer.
//   8. Return 200.
//
// Security invariants:
//   T-10-04-04: Member-cancelling-other-member's-run is rejected (step 4).
//   T-10-04-07: forOrg scoping prevents cross-org cancel via 404.
//   T-10-04-09: CSRF guard.

import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  OrgMembershipRequiredError,
  RoleInsufficientError,
  RunNotFoundError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';
import { cancelRunTimer, registerRunTimer } from '../../services/timeout-manager.js';

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned']);
const CANCEL_FALLBACK_SECONDS = 30;

export const cancelRunRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { orgId: string; runId: string } }>(
    '/:orgId/runs/:runId/cancel',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      const orgId = req.org?.id;
      const userId = req.user?.id;
      if (!orgId || !userId) throw new SessionRequiredError();

      const { runId } = req.params;
      const repos = makeRepos(fastify.db, fastify.mek);

      // 2. Load run — 404 if missing or cross-org
      const run = await repos.forOrg(orgId).taskRuns.getById(runId);
      if (!run) throw new RunNotFoundError();

      // 3. D-26 idempotency: already terminal → 200 no-op
      if (TERMINAL_STATES.has(run.state)) {
        return reply.status(200).send({
          state: run.state,
          message: 'already terminal',
        });
      }

      // 4. Authz check
      if (!req.org) throw new SessionRequiredError();
      if (req.org.id !== orgId) throw new OrgMembershipRequiredError(orgId);
      // Viewer always rejected
      if (req.org.role === 'viewer') throw new RoleInsufficientError('member');
      // Member only allowed if they triggered the run
      if (req.org.role === 'member' && run.triggeredByUserId !== userId) {
        throw new RoleInsufficientError('owner');
      }
      // Owner is always allowed (falls through)

      // 5. Cancel the existing timeout timer
      cancelRunTimer(runId);

      // 6. Send cancel frame to agent if connected and run has an agent
      if (run.agentId) {
        const ws = fastify.agentRegistry.get(run.agentId);
        if (ws && (ws as unknown as { readyState: number }).readyState === 1) {
          (ws as unknown as { send: (data: string) => void }).send(
            JSON.stringify({ type: 'cancel', run_id: runId, reason: 'manual' }),
          );
        }
      }

      // 7. State-specific cancel handling
      if (run.state === 'queued') {
        // Queued runs: CAS directly to cancelled + dequeue from in-memory
        await repos.forOrg(orgId).taskRuns.updateState(runId, 'queued', 'cancelled', {
          cancelledByUserId: userId,
          finishedAt: sql`now()` as unknown as Date,
        });
        fastify.dispatchQueue.dequeue(runId);
      } else {
        // Dispatched/running runs: annotate intent + register 30s fallback timer
        // Set cancelled_by_user_id without changing state (D-25 design note: wait for agent ack)
        await fastify.db.execute(
          sql`UPDATE task_runs SET cancelled_by_user_id = ${userId}, updated_at = now()
              WHERE id = ${runId} AND org_id = ${orgId} AND cancelled_by_user_id IS NULL`,
        );

        // Register 30s fallback: CAS (dispatched|running) → cancelled if agent doesn't ack
        registerRunTimer(fastify, runId, orgId, CANCEL_FALLBACK_SECONDS);
      }

      fastify.log.info({ runId, orgId, userId }, 'run cancel requested');

      return reply.status(200).send({
        runId,
        cancelled_by: userId,
        state: run.state === 'queued' ? 'cancelled' : run.state,
      });
    },
  );
};
