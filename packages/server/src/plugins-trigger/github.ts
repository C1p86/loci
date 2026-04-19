import { createHmac } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { compareToken } from '../crypto/tokens.js';
import { matchGlob } from './glob.js';
import type {
  GitHubEvent,
  GitHubTriggerConfig,
  TaskTriggerMatch,
  TriggerConfig,
  TriggerPlugin,
  VerifyResult,
} from './types.js';

/**
 * GitHub webhook plugin — PLUG-03.
 * D-08: HMAC-SHA256 via X-Hub-Signature-256 header, timingSafeEqual compare (ATOK-06).
 * D-09: 'push' + 'pull_request' events only; others return null from parse().
 * D-11: param extraction populates git.* (push) or pr.* (PR) keys.
 *
 * Security invariants:
 * - T-12-02-01: compareToken (timingSafeEqual wrapper) used for all HMAC comparisons.
 * - T-12-02-02: exhaustive typeof checks in parse(); throws on shape mismatch.
 * - T-12-02-03: pluginSecret Buffer never logged, stringified, or included in errors.
 * - T-12-02-05: rawBody absent → signature_mismatch (fail-closed), never throws.
 */
const githubPlugin: TriggerPlugin<GitHubEvent> = {
  name: 'github',

  verify(req: FastifyRequest, pluginSecret: Buffer | null): VerifyResult {
    // GitHub plugin always requires a pluginSecret — if absent, treat as header_missing
    // so the route handler lands on the right DLQ reason without exposing internals.
    if (pluginSecret === null) {
      return { ok: false, reason: 'header_missing' };
    }

    const deliveryId = req.headers['x-github-delivery'];
    if (typeof deliveryId !== 'string' || deliveryId.length === 0) {
      return { ok: false, reason: 'header_missing' };
    }

    const sigHeader = req.headers['x-hub-signature-256'];
    if (typeof sigHeader !== 'string' || !sigHeader.startsWith('sha256=')) {
      return { ok: false, reason: 'signature_missing' };
    }
    const providedHex = sigHeader.slice('sha256='.length);

    // rawBody must be populated by Plan 12-03's preHandler before JSON parsing.
    // If absent (misconfigured route), return mismatch rather than throwing (T-12-02-05).
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw) {
      return { ok: false, reason: 'signature_mismatch' };
    }

    const computedHex = createHmac('sha256', pluginSecret).update(raw).digest('hex');
    // T-12-02-01: timingSafeEqual via compareToken — never use === for HMAC strings.
    if (!compareToken(providedHex, computedHex)) {
      return { ok: false, reason: 'signature_mismatch' };
    }

    return { ok: true, deliveryId };
  },

  parse(req: FastifyRequest): GitHubEvent | null {
    const event = req.headers['x-github-event'];
    if (typeof event !== 'string') return null;

    // biome-ignore lint/suspicious/noExplicitAny: webhook payload has dynamic shape
    const body = req.body as any;

    if (event === 'push') {
      // T-12-02-02: defensive field check — GitHub always sends these; guard anyway.
      if (typeof body?.ref !== 'string' || typeof body?.repository?.full_name !== 'string') {
        throw new Error('github_push_malformed');
      }
      return {
        kind: 'push',
        ref: body.ref,
        repository: body.repository.full_name,
        sha: typeof body.head_commit?.id === 'string' ? body.head_commit.id : '',
        pusher: typeof body.pusher?.name === 'string' ? body.pusher.name : '',
        message:
          typeof body.head_commit?.message === 'string' ? body.head_commit.message : '',
      };
    }

    if (event === 'pull_request') {
      if (
        typeof body?.action !== 'string' ||
        typeof body?.pull_request?.head?.ref !== 'string' ||
        typeof body?.pull_request?.base?.ref !== 'string' ||
        typeof body?.repository?.full_name !== 'string'
      ) {
        throw new Error('github_pr_malformed');
      }
      const action = body.action as string;
      // Unknown PR actions (e.g. 'assigned', 'labeled') are silently ignored per D-09.
      if (!['opened', 'synchronize', 'closed', 'reopened'].includes(action)) {
        return null;
      }
      return {
        kind: 'pull_request',
        action: action as GitHubEvent extends { kind: 'pull_request' }
          ? GitHubEvent['action']
          : never,
        repository: body.repository.full_name,
        number: body.pull_request.number,
        headRef: body.pull_request.head.ref,
        baseRef: body.pull_request.base.ref,
        title: typeof body.pull_request.title === 'string' ? body.pull_request.title : '',
      };
    }

    // D-09: all other events (issues, workflow_run, ping, etc.) → null (ignored, not DLQ).
    return null;
  },

  mapToTask(
    event: GitHubEvent,
    candidates: Array<{ taskId: string; configs: TriggerConfig[] }>,
  ): TaskTriggerMatch[] {
    const matches: TaskTriggerMatch[] = [];

    for (const { taskId, configs } of candidates) {
      for (const cfg of configs) {
        if (cfg.plugin !== 'github') continue;
        const g = cfg as GitHubTriggerConfig;

        // Event kind must be in config.events array
        if (!g.events.includes(event.kind as 'push' | 'pull_request')) continue;

        // Repository glob filter (optional — absent means match all)
        if (g.repository && !matchGlob(g.repository, event.repository)) continue;

        if (event.kind === 'push') {
          // Branch extracted from ref: 'refs/heads/main' → 'main'; tags/other → '' (D-11).
          const branch = event.ref.startsWith('refs/heads/')
            ? event.ref.slice('refs/heads/'.length)
            : '';

          if (g.branch && !matchGlob(g.branch, branch)) continue;

          matches.push({
            taskId,
            params: {
              'git.ref': event.ref,
              'git.sha': event.sha,
              'git.repository': event.repository,
              'git.pusher': event.pusher,
              'git.message': event.message,
            },
          });
        } else {
          // pull_request
          if (g.actions && g.actions.length > 0 && !g.actions.includes(event.action)) continue;

          // branch glob for PR matches headRef (D-10)
          if (g.branch && !matchGlob(g.branch, event.headRef)) continue;

          matches.push({
            taskId,
            params: {
              'pr.number': String(event.number),
              'pr.action': event.action,
              'pr.head_ref': event.headRef,
              'pr.base_ref': event.baseRef,
              'pr.title': event.title,
              'git.repository': event.repository,
            },
          });
        }

        // Found a matching config for this task — break inner loop to avoid duplicates
        // (one task fires once per event, even if multiple configs match).
        break;
      }
    }

    return matches;
  },
};

export default githubPlugin;
