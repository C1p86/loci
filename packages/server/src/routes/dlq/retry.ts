/**
 * POST /api/orgs/:orgId/dlq/:dlqId/retry
 *
 * D-20: Retry SKIPS signature verify — admin action consciously bypasses signature check.
 * Audit log: WARN 'dlq_retry_skipping_signature_verify' for every retry invocation.
 *
 * Flow:
 *   1. Load dlq_entries row (forOrg org-scoped).
 *   2. getPlugin(entry.pluginName) → defensive guard (should always resolve for bundled plugins).
 *   3. Log warn: dlq_retry_skipping_signature_verify.
 *   4. Synthesize a pseudo-request from scrubbed_body + scrubbed_headers for plugin.parse.
 *   5. plugin.parse; on throw or null → markRetried failed_same_reason.
 *   6. listTriggerable + plugin.mapToTask; on 0 matches → markRetried failed_same_reason.
 *   7. For each match: resolveTaskParams + insert task_run + enqueue.
 *   8. markRetried 'succeeded' + return 200 {dispatched, runIds, retryResult:'succeeded'}.
 *
 * T-12-04-02: dispatched runs use trigger_source='webhook', triggered_by_user_id=NULL
 * (no privilege inheritance from retrier).
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { DlqEntryNotFoundError, DlqRetryFailedError, SessionRequiredError } from '../../errors.js';
import { getPlugin } from '../../plugins-trigger/index.js';
import { makeRepos } from '../../repos/index.js';
import { resolveTaskParams } from '../../services/dispatch-resolver.js';
import { buildRedactionTable } from '../../services/redaction-table.js';
import type { TaskSnapshot } from '../../ws/types.js';
import { requireMemberOrAbove } from '../runs/helpers.js';

export const retryDlqRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { orgId: string; dlqId: string } }>(
    '/:orgId/dlq/:dlqId/retry',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
    },
    async (req, reply) => {
      requireMemberOrAbove(req);
      const orgId = req.org?.id;
      if (!orgId) throw new SessionRequiredError();
      const { dlqId } = req.params;

      const repos = makeRepos(fastify.db, fastify.mek);
      const scopedRepos = repos.forOrg(orgId);

      // Step 1: Load DLQ entry (forOrg-scoped — cross-org returns undefined)
      const entry = await scopedRepos.dlqEntries.getById(dlqId);
      if (!entry) throw new DlqEntryNotFoundError();

      // Step 2: Plugin lookup (should always resolve for bundled plugins)
      const plugin = getPlugin(entry.pluginName);
      if (!plugin) {
        await scopedRepos.dlqEntries.markRetried(dlqId, 'failed_new_reason');
        throw new DlqRetryFailedError(`plugin ${entry.pluginName} not found at retry time`);
      }

      // Step 3: D-20 — Log explicit bypass of signature verification (audit trail)
      req.log.warn(
        { orgId, dlqId, pluginName: entry.pluginName },
        'dlq_retry_skipping_signature_verify',
      );

      // Step 4: Synthesize a minimal pseudo-request for plugin.parse.
      // plugin.parse reads req.body + req.headers (e.g., x-github-event).
      // scrubbed_headers preserves non-sensitive headers (D-25 deny-list removes only
      // Authorization/X-Hub-Signature/X-GitHub-Token/Cookie etc — NOT x-github-event).
      const synthReq = {
        headers: (entry.scrubbedHeaders as Record<string, unknown>) ?? {},
        body: entry.scrubbedBody,
      } as unknown as FastifyRequest;

      // Step 5: parse
      let event: unknown;
      try {
        event = plugin.parse(synthReq);
      } catch {
        await scopedRepos.dlqEntries.markRetried(dlqId, 'failed_same_reason');
        return reply.status(200).send({ dispatched: 0, retryResult: 'failed_same_reason' });
      }
      if (event === null) {
        // Ignored event type — count as failed_same_reason
        await scopedRepos.dlqEntries.markRetried(dlqId, 'failed_same_reason');
        return reply.status(200).send({ dispatched: 0, retryResult: 'failed_same_reason' });
      }

      // Step 6: candidates + mapToTask
      const candidates = await scopedRepos.tasks.listTriggerable();
      const mapToCandidates = candidates.map((c) => ({
        taskId: c.id,
        configs: c.triggerConfigs,
      }));
      const matches = plugin.mapToTask(event, mapToCandidates);
      if (matches.length === 0) {
        await scopedRepos.dlqEntries.markRetried(dlqId, 'failed_same_reason');
        return reply.status(200).send({ dispatched: 0, retryResult: 'failed_same_reason' });
      }

      // Step 7: dispatch — same as shared-handler Step 9
      // Pre-load org secrets once (not per-match)
      const secretNames = (await scopedRepos.secrets.list()).map((s) => s.name);
      const orgSecrets: Record<string, string> = {};
      for (const name of secretNames) {
        try {
          orgSecrets[name] = await scopedRepos.secrets.resolveByName(
            name,
            null as unknown as string,
          );
        } catch {
          // If a secret fails to decrypt, skip it — may be handled agent-side
        }
      }

      const runIds: string[] = [];
      try {
        for (const match of matches) {
          const task = await scopedRepos.tasks.getById(match.taskId);
          if (!task) continue; // task may have been deleted between list and lookup

          const { resolvedYaml } = resolveTaskParams({
            task: { id: task.id, name: task.name, yamlDefinition: task.yamlDefinition },
            runOverrides: match.params,
            orgSecrets,
          });

          const taskSnapshot: TaskSnapshot = {
            task_id: task.id,
            name: task.name,
            description: task.description,
            yaml_definition: resolvedYaml,
            label_requirements: task.labelRequirements ?? [],
          };

          // D-30: webhook-triggered runs — trigger_source='webhook', triggered_by_user_id=NULL
          const newRun = await scopedRepos.taskRuns.create({
            taskId: task.id,
            taskSnapshot: taskSnapshot as unknown as Record<string, unknown>,
            paramOverrides: match.params,
            triggerSource: 'webhook',
            timeoutSeconds: task.defaultTimeoutSeconds ?? 3600,
          });

          buildRedactionTable(fastify, newRun.id, Object.values(orgSecrets));

          fastify.dispatchQueue.enqueue({
            runId: newRun.id,
            orgId,
            taskSnapshot,
            params: { ...orgSecrets, ...match.params },
            labelRequirements: task.labelRequirements ?? [],
            timeoutSeconds: task.defaultTimeoutSeconds ?? 3600,
          });

          runIds.push(newRun.id);
        }
      } catch (err) {
        await scopedRepos.dlqEntries.markRetried(dlqId, 'failed_new_reason');
        throw new DlqRetryFailedError('retry dispatch failed', err);
      }

      // Step 8: mark retried + return
      await scopedRepos.dlqEntries.markRetried(dlqId, 'succeeded');
      return reply.status(200).send({
        dispatched: runIds.length,
        runIds,
        retryResult: 'succeeded',
      });
    },
  );
};
