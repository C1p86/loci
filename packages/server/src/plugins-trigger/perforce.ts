import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { matchGlob } from './glob.js';
import type {
  PerforceEvent,
  PerforceTriggerConfig,
  TaskTriggerMatch,
  TriggerConfig,
  TriggerPlugin,
  VerifyResult,
} from './types.js';

/**
 * Perforce webhook plugin — PLUG-04.
 * D-13: verify via X-Xci-Token header presence (no HMAC — Perforce trigger scripts
 *        can't easily do HMAC in shell). Token identity check is performed at the
 *        route layer (Plan 12-03) via adminRepo.findWebhookTokenByPlaintext.
 *        This plugin's verify enforces defense-in-depth: X-Xci-Token MUST be present.
 * D-14: body is {change, user, client, root, depot} JSON posted by xci-emit-perforce-trigger.
 * D-15: mapToTask matches on depot/user/client globs; extracts p4.* params.
 * D-24: body.delivery_id used if present; auto-generated UUID otherwise.
 *
 * Security invariants:
 * - T-12-02-03: pluginSecret parameter (_pluginSecret) is ignored by this plugin —
 *   Perforce verify does not perform HMAC (no secret needed at plugin level).
 *   The route handler's URL token lookup is the primary auth mechanism.
 * - T-12-02-02: exhaustive typeof checks on all required fields; throws on mismatch.
 */
const perforcePlugin: TriggerPlugin<PerforceEvent> = {
  name: 'perforce',

  // biome-ignore lint/correctness/noUnusedFunctionParameters: pluginSecret intentionally unused (D-13)
  verify(req: FastifyRequest, _pluginSecret: Buffer | null): VerifyResult {
    const xciToken = req.headers['x-xci-token'];
    if (typeof xciToken !== 'string' || xciToken.length === 0) {
      return { ok: false, reason: 'header_missing' };
    }

    // Extract deliveryId from parsed body (if available at verify time).
    // biome-ignore lint/suspicious/noExplicitAny: body parsed by Fastify JSON parser
    const body = req.body as any;
    const deliveryId =
      typeof body?.delivery_id === 'string' && body.delivery_id.length > 0
        ? body.delivery_id
        : randomUUID();

    return { ok: true, deliveryId };
  },

  parse(req: FastifyRequest): PerforceEvent {
    // biome-ignore lint/suspicious/noExplicitAny: JSON body
    const body = req.body as any;

    // T-12-02-02: reject non-object bodies immediately.
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('perforce_body_not_object');
    }

    const { change, user, client, root, depot } = body as Record<string, unknown>;

    // All five fields are required strings (D-14).
    if (
      typeof change !== 'string' ||
      typeof user !== 'string' ||
      typeof client !== 'string' ||
      typeof root !== 'string' ||
      typeof depot !== 'string'
    ) {
      throw new Error('perforce_body_missing_fields');
    }

    // D-24: use provided delivery_id or auto-generate UUID.
    const deliveryId =
      typeof body.delivery_id === 'string' && body.delivery_id.length > 0
        ? body.delivery_id
        : randomUUID();

    return { kind: 'perforce_change', change, user, client, root, depot, deliveryId };
  },

  mapToTask(
    event: PerforceEvent,
    candidates: Array<{ taskId: string; configs: TriggerConfig[] }>,
  ): TaskTriggerMatch[] {
    const matches: TaskTriggerMatch[] = [];

    for (const { taskId, configs } of candidates) {
      for (const cfg of configs) {
        if (cfg.plugin !== 'perforce') continue;
        const p = cfg as PerforceTriggerConfig;

        // Optional glob filters — absent means match all (D-15).
        if (p.depot && !matchGlob(p.depot, event.depot)) continue;
        if (p.user && !matchGlob(p.user, event.user)) continue;
        if (p.client && !matchGlob(p.client, event.client)) continue;

        matches.push({
          taskId,
          params: {
            'p4.change': event.change,
            'p4.user': event.user,
            'p4.client': event.client,
            'p4.root': event.root,
            'p4.depot': event.depot,
          },
        });

        // One match per task per event — break inner loop.
        break;
      }
    }

    return matches;
  },
};

export default perforcePlugin;
