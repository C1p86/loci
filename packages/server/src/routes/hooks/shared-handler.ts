/**
 * packages/server/src/routes/hooks/shared-handler.ts
 * Plan 12-03 Task 2 — full verify→parse→dedup→mapToTask→dispatch→DLQ pipeline.
 *
 * This stub is replaced with the full implementation in Task 2.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  WebhookPluginNotFoundError,
  WebhookSignatureInvalidError,
  WebhookTokenNotFoundError,
} from '../../errors.js';
import { getPlugin } from '../../plugins-trigger/index.js';
import { makeRepos } from '../../repos/index.js';
import { buildRedactionTable } from '../../services/redaction-table.js';
import { resolveTaskParams } from '../../services/dispatch-resolver.js';
import type { TaskSnapshot } from '../../ws/types.js';
import { scrubBody, scrubHeaders } from './scrub.js';

interface HookRouteParams {
  pluginName: string;
  orgToken: string;
}

type DlqFailureReason =
  | 'signature_invalid'
  | 'parse_failed'
  | 'no_task_matched'
  | 'task_validation_failed'
  | 'internal';

/**
 * Shared webhook entry point. Plan 12-03 Task 2.
 *
 * Flow:
 *   1. Plugin lookup — 404 if unknown (URL malformed; not a DLQ candidate).
 *   2. URL token → adminRepo lookup → 404 if unknown/revoked.
 *   3. Resolve plugin_secret (GitHub: Buffer; Perforce: null).
 *   4. Verify (HMAC or header-token). Invalid → DLQ + 401.
 *   5. Delivery-ID dedup insert. Duplicate → 200 {status:'duplicate'}.
 *   6. Parse event. Throws → DLQ parse_failed + 202. Null → 202 ignored.
 *   7. Load org's triggerable tasks (list w/ trigger_configs).
 *   8. plugin.mapToTask(event, candidates). Zero matches → DLQ no_task_matched + 202.
 *   9. For each match: load task → resolveTaskParams(runOverrides=match.params, orgSecrets)
 *      → insert task_runs → enqueue.
 *  10. Return 202 {dispatched: N, runIds: string[]}.
 *
 * Any unhandled error: attempt DLQ insert with failure_reason='internal' + 500 response.
 */
export async function handleIncomingWebhook(
  req: FastifyRequest<{ Params: HookRouteParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { pluginName, orgToken } = req.params;
  const fastify = req.server;
  const repos = makeRepos(fastify.db, fastify.mek);

  // Step 1: plugin lookup
  const plugin = getPlugin(pluginName);
  if (!plugin) throw new WebhookPluginNotFoundError();

  // Step 2: orgToken → orgId
  const tokenRow = await repos.admin.findWebhookTokenByPlaintext(orgToken);
  if (!tokenRow) throw new WebhookTokenNotFoundError();
  const { orgId, tokenId, pluginName: resolvedPluginName } = tokenRow;

  // Plugin name in URL must match plugin_name stored for this token (T-12-03-07 mitigation)
  if (resolvedPluginName !== pluginName) throw new WebhookTokenNotFoundError();

  const scopedRepos = repos.forOrg(orgId);

  // --- Helper: write a DLQ entry (best-effort; caller continues to return a response) ---
  const writeDlq = async (
    failureReason: DlqFailureReason,
    deliveryId: string | undefined,
    httpStatus: number,
  ): Promise<void> => {
    try {
      const dlqParams: {
        pluginName: 'github' | 'perforce';
        deliveryId?: string;
        failureReason: DlqFailureReason;
        scrubbedHeaders: Record<string, unknown>;
        scrubbedBody: Record<string, unknown>;
        httpStatus?: number;
      } = {
        pluginName: resolvedPluginName as 'github' | 'perforce',
        failureReason,
        scrubbedHeaders: scrubHeaders(req.headers as Record<string, unknown>),
        scrubbedBody: scrubBody(
          req.body !== null && typeof req.body === 'object'
            ? (req.body as Record<string, unknown>)
            : {},
        ),
        httpStatus,
      };
      if (deliveryId !== undefined) {
        dlqParams.deliveryId = deliveryId;
      }
      await scopedRepos.dlqEntries.create(dlqParams);
    } catch (err) {
      req.log.error({ err, orgId, failureReason }, 'dlq_insert_failed');
    }
  };

  // Step 3: plugin secret (null for Perforce)
  const pluginSecret = await scopedRepos.webhookTokens.resolvePluginSecret(tokenId);

  // Step 4: verify
  const verifyResult = plugin.verify(req, pluginSecret ?? null);
  if (!verifyResult.ok) {
    // D-06 / D-31 / SC-1: invalid signature → DLQ + 401
    // GitHub always sends x-github-delivery regardless of signature validity
    const deliveryIdFromHeader =
      typeof req.headers['x-github-delivery'] === 'string'
        ? (req.headers['x-github-delivery'] as string)
        : undefined;
    await writeDlq('signature_invalid', deliveryIdFromHeader, 401);
    throw new WebhookSignatureInvalidError();
  }

  const { deliveryId } = verifyResult;

  // Step 5: dedup (PLUG-07 / D-22 / D-23 / SC-3)
  const dedupResult = await scopedRepos.webhookDeliveries.recordDelivery({
    pluginName: resolvedPluginName as 'github' | 'perforce',
    deliveryId,
  });
  if (!dedupResult.inserted) {
    req.log.warn({ orgId, pluginName: resolvedPluginName, deliveryId }, 'webhook_duplicate_delivery');
    return reply.status(200).send({ status: 'duplicate', deliveryId });
  }

  // Step 6: parse
  let event: unknown;
  try {
    event = plugin.parse(req);
  } catch (err) {
    req.log.warn({ err, orgId, pluginName: resolvedPluginName }, 'webhook_parse_failed');
    await writeDlq('parse_failed', deliveryId, 202);
    return reply.status(202).send({ dispatched: 0, reason: 'parse_failed' });
  }
  if (event === null) {
    // D-09: ignored event (issues, workflow_run for GitHub, or unknown PR action)
    return reply.status(202).send({ dispatched: 0, ignored: true });
  }

  // Step 7: candidates for mapToTask
  // listTriggerable() scoped to this org via forOrg (T-12-03-04: org isolation invariant)
  const candidates = await scopedRepos.tasks.listTriggerable();
  const mapToCandidates = candidates.map((c) => ({
    taskId: c.id,
    configs: c.triggerConfigs,
  }));

  // Step 8: mapToTask
  const matches = plugin.mapToTask(event, mapToCandidates);
  if (matches.length === 0) {
    await writeDlq('no_task_matched', deliveryId, 202);
    return reply.status(202).send({ dispatched: 0, reason: 'no_task_matched' });
  }

  // Step 9: for each match → resolve params + insert task_runs + enqueue
  const runIds: string[] = [];

  // Pre-load org secrets once (not per-match). Same pattern as Plan 10-04 trigger.ts.
  const secretNames = (await scopedRepos.secrets.list()).map((s) => s.name);
  const orgSecrets: Record<string, string> = {};
  for (const name of secretNames) {
    try {
      // actorUserId=null: webhook-triggered, no user actor (audit log accepts null)
      orgSecrets[name] = await scopedRepos.secrets.resolveByName(name, null as unknown as string);
    } catch {
      // If a secret fails to decrypt, skip it — may be handled agent-side
    }
  }

  for (const match of matches) {
    const task = await scopedRepos.tasks.getById(match.taskId);
    if (!task) continue; // task may have been deleted between list and insert — skip silently

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

    // D-30: webhook-triggered runs have trigger_source='webhook', triggered_by_user_id=NULL
    const newRun = await scopedRepos.taskRuns.create({
      taskId: task.id,
      taskSnapshot: taskSnapshot as unknown as Record<string, unknown>,
      paramOverrides: match.params,
      // triggeredByUserId NOT set → defaults to NULL via schema
      triggerSource: 'webhook',
      timeoutSeconds: task.defaultTimeoutSeconds ?? 3600,
    });

    // Seed redaction table before enqueue (same as Plan 10-04)
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

  return reply.status(202).send({ dispatched: runIds.length, runIds, deliveryId });
}
