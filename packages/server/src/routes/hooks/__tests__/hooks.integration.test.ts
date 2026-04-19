// packages/server/src/routes/hooks/__tests__/hooks.integration.test.ts
// Plan 12-03 Task 3 — end-to-end integration tests for webhook ingress routes.
//
// Covers:
//   Test 1 (SC-1 happy): valid HMAC → 202 dispatched
//   Test 2 (SC-1 sad + SC-5): invalid HMAC → 401 + DLQ with scrubbed headers
//   Test 3 (SC-3 dedup): same X-GitHub-Delivery twice → 200 duplicate, no second run
//   Test 4 (ignored event): issues event → 202 ignored, no run, no DLQ
//   Test 5 (no task matched): push to non-matching repo → 202 no_task_matched + DLQ
//   Test 6 (unknown plugin): POST /hooks/gitlab/... → 404
//   Test 7 (unknown token): POST /hooks/github/<invalid> → 404
//   Test 8 (Perforce happy, partial SC-2): valid X-Xci-Token + JSON → 202 dispatched
//   Test 9 (org isolation): orgA token, orgB task → NOT dispatched
//   Test 10 (SC-5 comprehensive): all denied headers in request → none persisted in DLQ

import { createHmac, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { generateId } from '../../../crypto/tokens.js';
import { dlqEntries, taskRuns, tasks } from '../../../db/schema.js';
import { makeRepos } from '../../../repos/index.js';
import { clearAllRunTimers } from '../../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

// ---------------------------------------------------------------------------
// HMAC oracle helper
// ---------------------------------------------------------------------------

function githubHmacHex(secret: Buffer | string, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function githubPushBody(opts: {
  repo: string;
  ref: string;
  sha?: string;
  pusher?: string;
  message?: string;
}): string {
  return JSON.stringify({
    ref: opts.ref,
    repository: { full_name: opts.repo },
    head_commit: {
      id: opts.sha ?? 'abc123def456',
      message: opts.message ?? 'test commit',
    },
    pusher: { name: opts.pusher ?? 'octocat' },
  });
}

async function postGithubWebhook(
  app: Awaited<ReturnType<typeof buildApp>>,
  opts: {
    plaintext: string;
    secret: Buffer | string;
    event: string;
    deliveryId: string;
    body: string;
    signatureOverride?: string;
    extraHeaders?: Record<string, string>;
  },
) {
  const signature =
    opts.signatureOverride ?? `sha256=${githubHmacHex(opts.secret, opts.body)}`;
  return app.inject({
    method: 'POST',
    url: `/hooks/github/${opts.plaintext}`,
    headers: {
      'content-type': 'application/json',
      'x-github-event': opts.event,
      'x-github-delivery': opts.deliveryId,
      'x-hub-signature-256': signature,
      ...opts.extraHeaders,
    },
    payload: opts.body,
  });
}

async function postPerforceWebhook(
  app: Awaited<ReturnType<typeof buildApp>>,
  opts: {
    plaintext: string;
    xciToken: string;
    body: object;
    deliveryId?: string;
  },
) {
  const payload = opts.deliveryId
    ? { ...opts.body, delivery_id: opts.deliveryId }
    : opts.body;
  return app.inject({
    method: 'POST',
    url: `/hooks/perforce/${opts.plaintext}`,
    headers: {
      'content-type': 'application/json',
      'x-xci-token': opts.xciToken,
    },
    payload: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function seedGithubWebhookToken(
  orgId: string,
  createdByUserId: string,
  pluginSecret: string,
): Promise<{ plaintext: string; tokenId: string }> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  const result = await repos.forOrg(orgId).webhookTokens.create({
    pluginName: 'github',
    pluginSecret,
    createdByUserId,
  });
  return { plaintext: result.plaintext, tokenId: result.id };
}

async function seedPerforceWebhookToken(
  orgId: string,
  createdByUserId: string,
): Promise<{ plaintext: string; tokenId: string }> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  const result = await repos.forOrg(orgId).webhookTokens.create({
    pluginName: 'perforce',
    createdByUserId,
  });
  return { plaintext: result.plaintext, tokenId: result.id };
}

async function seedTaskWithGithubTrigger(
  orgId: string,
  createdByUserId: string,
  opts: {
    repoGlob?: string;
    branch?: string;
  } = {},
): Promise<{ taskId: string }> {
  const db = getTestDb();
  const taskId = generateId('tsk');
  await db.insert(tasks).values({
    id: taskId,
    orgId,
    name: `task-${randomBytes(4).toString('hex')}`,
    description: '',
    yamlDefinition: 'steps:\n  - run: echo hello',
    labelRequirements: [],
    triggerConfigs: [
      {
        plugin: 'github' as const,
        events: ['push' as const],
        ...(opts.repoGlob !== undefined && { repository: opts.repoGlob }),
        ...(opts.branch !== undefined && { branch: opts.branch }),
      },
    ],
    createdByUserId,
  });
  return { taskId };
}

async function seedTaskWithPerforceTrigger(
  orgId: string,
  createdByUserId: string,
  opts: { depot?: string } = {},
): Promise<{ taskId: string }> {
  const db = getTestDb();
  const taskId = generateId('tsk');
  await db.insert(tasks).values({
    id: taskId,
    orgId,
    name: `p4task-${randomBytes(4).toString('hex')}`,
    description: '',
    yamlDefinition: 'steps:\n  - run: echo p4',
    labelRequirements: [],
    triggerConfigs: [
      {
        plugin: 'perforce' as const,
        ...(opts.depot !== undefined && { depot: opts.depot }),
      },
    ],
    createdByUserId,
  });
  return { taskId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Webhook ingress routes (Plan 12-03)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.ready();
  });

  afterAll(async () => {
    clearAllRunTimers();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    clearAllRunTimers();
  });

  // -------------------------------------------------------------------------
  // Test 1 (SC-1 happy): valid GitHub HMAC → 202 dispatched
  // -------------------------------------------------------------------------
  it('Test 1 (SC-1 happy): valid GitHub HMAC + push event → 202 dispatched:1', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const pluginSecret = 'my-webhook-secret-abc123';
    const { plaintext } = await seedGithubWebhookToken(
      f.orgA.id,
      f.orgA.ownerUser.id,
      pluginSecret,
    );
    const { taskId } = await seedTaskWithGithubTrigger(f.orgA.id, f.orgA.ownerUser.id, {
      repoGlob: 'acme/*',
      branch: 'main',
    });

    const body = githubPushBody({ repo: 'acme/infra', ref: 'refs/heads/main' });
    const deliveryId = 'delivery-abc-001';

    const res = await postGithubWebhook(app, {
      plaintext,
      secret: pluginSecret,
      event: 'push',
      deliveryId,
      body,
    });

    expect(res.statusCode).toBe(202);
    const resBody = res.json<{ dispatched: number; runIds: string[]; deliveryId: string }>();
    expect(resBody.dispatched).toBe(1);
    expect(resBody.runIds).toHaveLength(1);
    expect(resBody.deliveryId).toBe(deliveryId);

    // Verify task_runs row
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(resBody.runIds[0]!);
    expect(run).toBeDefined();
    expect(run?.triggerSource).toBe('webhook');
    expect(run?.triggeredByUserId).toBeNull();
    expect(run?.taskId).toBe(taskId);

    // Verify param overrides contain git.* keys
    const params = run?.paramOverrides as Record<string, string>;
    expect(params['git.ref']).toBe('refs/heads/main');
    expect(params['git.repository']).toBe('acme/infra');
    expect(params['git.sha']).toBeDefined();
    expect(params['git.pusher']).toBeDefined();

    // No DLQ entry
    const dlqRows = await db.select().from(dlqEntries).where(eq(dlqEntries.orgId, f.orgA.id));
    expect(dlqRows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 2 (SC-1 sad + SC-5): invalid HMAC → 401 + DLQ with scrubbed headers
  // -------------------------------------------------------------------------
  it('Test 2 (SC-1 sad + SC-5): invalid HMAC → 401 + DLQ with no sensitive headers', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const pluginSecret = 'correct-secret';
    const { plaintext } = await seedGithubWebhookToken(
      f.orgA.id,
      f.orgA.ownerUser.id,
      pluginSecret,
    );
    await seedTaskWithGithubTrigger(f.orgA.id, f.orgA.ownerUser.id, { repoGlob: 'acme/*' });

    const body = githubPushBody({ repo: 'acme/infra', ref: 'refs/heads/main' });
    const deliveryId = 'delivery-bad-sig-001';

    const res = await postGithubWebhook(app, {
      plaintext,
      secret: pluginSecret,
      event: 'push',
      deliveryId,
      body,
      // Wrong signature — intentional
      signatureOverride: 'sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      extraHeaders: {
        Authorization: 'Bearer should-not-be-stored',
      },
    });

    expect(res.statusCode).toBe(401);
    const resBody = res.json<{ code: string }>();
    expect(resBody.code).toBe('AUTHN_WEBHOOK_SIGNATURE_INVALID');

    // DLQ must have exactly 1 entry
    const dlqRows = await db.select().from(dlqEntries).where(eq(dlqEntries.orgId, f.orgA.id));
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.failureReason).toBe('signature_invalid');
    expect(dlqRows[0]!.httpStatus).toBe(401);

    // SC-5: none of the sensitive header names may appear in scrubbed_headers
    const headers = dlqRows[0]!.scrubbedHeaders as Record<string, unknown>;
    const headerKeysLower = Object.keys(headers).map((k) => k.toLowerCase());
    const deniedKeys = [
      'authorization',
      'x-hub-signature',
      'x-hub-signature-256',
      'x-github-token',
      'x-xci-token',
      'cookie',
      'set-cookie',
    ];
    for (const denied of deniedKeys) {
      expect(headerKeysLower, `key ${denied} must not be in scrubbed_headers`).not.toContain(
        denied,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Test 3 (SC-3 dedup): same X-GitHub-Delivery twice → 200 duplicate, 1 run
  // -------------------------------------------------------------------------
  it('Test 3 (SC-3 dedup): same delivery ID twice → second returns 200 duplicate', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const pluginSecret = 'dedup-secret';
    const { plaintext } = await seedGithubWebhookToken(
      f.orgA.id,
      f.orgA.ownerUser.id,
      pluginSecret,
    );
    await seedTaskWithGithubTrigger(f.orgA.id, f.orgA.ownerUser.id, { repoGlob: 'acme/*' });

    const body = githubPushBody({ repo: 'acme/infra', ref: 'refs/heads/main' });
    const deliveryId = 'delivery-dedup-001';

    // First delivery
    const res1 = await postGithubWebhook(app, {
      plaintext,
      secret: pluginSecret,
      event: 'push',
      deliveryId,
      body,
    });
    expect(res1.statusCode).toBe(202);
    expect(res1.json<{ dispatched: number }>().dispatched).toBe(1);

    // Second delivery — same ID
    const res2 = await postGithubWebhook(app, {
      plaintext,
      secret: pluginSecret,
      event: 'push',
      deliveryId,
      body,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json<{ status: string; deliveryId: string }>();
    expect(body2.status).toBe('duplicate');
    expect(body2.deliveryId).toBe(deliveryId);

    // Only 1 task_run row
    const runs = await db.select().from(taskRuns).where(eq(taskRuns.orgId, f.orgA.id));
    expect(runs).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Test 4 (ignored event): issues event → 202 ignored, no run, no DLQ
  // -------------------------------------------------------------------------
  it('Test 4 (ignored event): GitHub issues event → 202 ignored:true, no run, no DLQ', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const pluginSecret = 'ignored-event-secret';
    const { plaintext } = await seedGithubWebhookToken(
      f.orgA.id,
      f.orgA.ownerUser.id,
      pluginSecret,
    );
    await seedTaskWithGithubTrigger(f.orgA.id, f.orgA.ownerUser.id, { repoGlob: 'acme/*' });

    const body = JSON.stringify({ action: 'opened', issue: { number: 42 } });
    const deliveryId = 'delivery-issues-001';

    const res = await postGithubWebhook(app, {
      plaintext,
      secret: pluginSecret,
      event: 'issues',
      deliveryId,
      body,
    });

    expect(res.statusCode).toBe(202);
    const resBody = res.json<{ dispatched: number; ignored: boolean }>();
    expect(resBody.dispatched).toBe(0);
    expect(resBody.ignored).toBe(true);

    // No runs
    const runs = await db.select().from(taskRuns).where(eq(taskRuns.orgId, f.orgA.id));
    expect(runs).toHaveLength(0);

    // No DLQ (ignored events are not failures)
    const dlqRows = await db.select().from(dlqEntries).where(eq(dlqEntries.orgId, f.orgA.id));
    expect(dlqRows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 5 (no task matched): push to non-matching repo → 202 + DLQ
  // -------------------------------------------------------------------------
  it('Test 5 (no task matched): push to non-matching repo → 202 no_task_matched + DLQ', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const pluginSecret = 'no-match-secret';
    const { plaintext } = await seedGithubWebhookToken(
      f.orgA.id,
      f.orgA.ownerUser.id,
      pluginSecret,
    );
    // Task only listens to 'acme/*'
    await seedTaskWithGithubTrigger(f.orgA.id, f.orgA.ownerUser.id, { repoGlob: 'acme/*' });

    // Push to 'other/repo' — no match
    const body = githubPushBody({ repo: 'other/repo', ref: 'refs/heads/main' });
    const deliveryId = 'delivery-no-match-001';

    const res = await postGithubWebhook(app, {
      plaintext,
      secret: pluginSecret,
      event: 'push',
      deliveryId,
      body,
    });

    expect(res.statusCode).toBe(202);
    const resBody = res.json<{ dispatched: number; reason: string }>();
    expect(resBody.dispatched).toBe(0);
    expect(resBody.reason).toBe('no_task_matched');

    // DLQ entry
    const dlqRows = await db.select().from(dlqEntries).where(eq(dlqEntries.orgId, f.orgA.id));
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.failureReason).toBe('no_task_matched');

    // No runs
    const runs = await db.select().from(taskRuns).where(eq(taskRuns.orgId, f.orgA.id));
    expect(runs).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 6 (unknown plugin): POST /hooks/gitlab/... → 404
  // -------------------------------------------------------------------------
  it('Test 6 (unknown plugin): POST /hooks/gitlab/<any> → 404 NF_WEBHOOK_PLUGIN, no DLQ', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const res = await app.inject({
      method: 'POST',
      url: '/hooks/gitlab/some-unknown-token',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ event: 'push' }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe('NF_WEBHOOK_PLUGIN');

    // No DLQ (URL is malformed — not a legitimate webhook)
    const dlqRows = await db.select().from(dlqEntries).where(eq(dlqEntries.orgId, f.orgA.id));
    expect(dlqRows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 7 (unknown token): POST /hooks/github/<invalid> → 404
  // -------------------------------------------------------------------------
  it('Test 7 (unknown token): POST /hooks/github/<invalid> → 404 NF_WEBHOOK_TOKEN, no DLQ', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const res = await app.inject({
      method: 'POST',
      url: '/hooks/github/totally-invalid-token-that-does-not-exist',
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': 'delivery-unknown-001',
        'x-hub-signature-256': 'sha256=aaaaaaaaaaaaa',
      },
      payload: JSON.stringify({ ref: 'refs/heads/main' }),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<{ code: string }>().code).toBe('NF_WEBHOOK_TOKEN');

    // No DLQ (URL token invalid — not a legitimate webhook)
    const dlqRows = await db.select().from(dlqEntries).where(eq(dlqEntries.orgId, f.orgA.id));
    expect(dlqRows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 8 (Perforce happy, partial SC-2): valid X-Xci-Token + JSON → 202 dispatched
  // -------------------------------------------------------------------------
  it('Test 8 (Perforce SC-2 partial): valid X-Xci-Token + JSON body → 202 dispatched:1', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const { plaintext, tokenId } = await seedPerforceWebhookToken(
      f.orgA.id,
      f.orgA.ownerUser.id,
    );
    await seedTaskWithPerforceTrigger(f.orgA.id, f.orgA.ownerUser.id, {
      depot: '//depot/infra/*',
    });

    const deliveryId = 'p4-delivery-001';

    const res = await postPerforceWebhook(app, {
      plaintext,
      xciToken: plaintext, // X-Xci-Token — Perforce plugin just checks header presence
      body: {
        change: '12345',
        user: 'buildbot',
        client: 'buildbot-workspace',
        root: '/home/buildbot',
        depot: '//depot/infra/main/src',
      },
      deliveryId,
    });

    expect(res.statusCode).toBe(202);
    const resBody = res.json<{ dispatched: number; runIds: string[] }>();
    expect(resBody.dispatched).toBe(1);
    expect(resBody.runIds).toHaveLength(1);

    // Verify task_runs row
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(resBody.runIds[0]!);
    expect(run).toBeDefined();
    expect(run?.triggerSource).toBe('webhook');
    expect(run?.triggeredByUserId).toBeNull();

    const params = run?.paramOverrides as Record<string, string>;
    expect(params['p4.change']).toBe('12345');
    expect(params['p4.user']).toBe('buildbot');
    expect(params['p4.depot']).toBe('//depot/infra/main/src');
  });

  // -------------------------------------------------------------------------
  // Test 9 (org isolation): orgA token → orgB task NOT dispatched
  // -------------------------------------------------------------------------
  it('Test 9 (org isolation): orgA webhook → only orgA tasks dispatched, orgB isolated', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const pluginSecret = 'isolation-secret';
    const { plaintext } = await seedGithubWebhookToken(
      f.orgA.id,
      f.orgA.ownerUser.id,
      pluginSecret,
    );

    // Seed task in orgA — should be dispatched
    await seedTaskWithGithubTrigger(f.orgA.id, f.orgA.ownerUser.id, { repoGlob: 'acme/*' });

    // Seed task in orgB — same config but orgB
    await seedTaskWithGithubTrigger(f.orgB.id, f.orgB.ownerUser.id, { repoGlob: 'acme/*' });

    const body = githubPushBody({ repo: 'acme/infra', ref: 'refs/heads/main' });
    const deliveryId = 'delivery-isolation-001';

    const res = await postGithubWebhook(app, {
      plaintext,
      secret: pluginSecret,
      event: 'push',
      deliveryId,
      body,
    });

    expect(res.statusCode).toBe(202);
    const resBody = res.json<{ dispatched: number }>();
    expect(resBody.dispatched).toBe(1);

    // orgA has 1 run
    const runsA = await db.select().from(taskRuns).where(eq(taskRuns.orgId, f.orgA.id));
    expect(runsA).toHaveLength(1);

    // orgB has 0 runs — proof of org isolation (T-12-03-04)
    const runsB = await db.select().from(taskRuns).where(eq(taskRuns.orgId, f.orgB.id));
    expect(runsB).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 10 (SC-5 comprehensive): all denied headers → none in DLQ
  // -------------------------------------------------------------------------
  it('Test 10 (SC-5 comprehensive): all denied headers sent → none persist in DLQ scrubbed_headers', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const pluginSecret = 'scrub-test-secret';
    const { plaintext } = await seedGithubWebhookToken(
      f.orgA.id,
      f.orgA.ownerUser.id,
      pluginSecret,
    );
    // No task → forces no_task_matched → DLQ entry
    await seedTaskWithGithubTrigger(f.orgA.id, f.orgA.ownerUser.id, {
      repoGlob: 'wont-match/*',
    });

    const body = githubPushBody({ repo: 'acme/infra', ref: 'refs/heads/main' });
    const deliveryId = 'delivery-sc5-001';

    const res = await postGithubWebhook(app, {
      plaintext,
      secret: pluginSecret,
      event: 'push',
      deliveryId,
      body,
      extraHeaders: {
        Authorization: 'Bearer super-secret-token',
        'X-Hub-Signature': 'sha1=deadbeef',
        'X-Hub-Signature-256': `sha256=${githubHmacHex(pluginSecret, body)}`,
        'X-GitHub-Token': 'ghp_secret_token',
        'X-Xci-Token': 'xci-secret-value',
        Cookie: 'session=abc123; other=xyz',
      },
    });

    // Should be 202 no_task_matched (signature is valid, but no task matches)
    expect(res.statusCode).toBe(202);

    // DLQ entry must exist
    const dlqRows = await db.select().from(dlqEntries).where(eq(dlqEntries.orgId, f.orgA.id));
    expect(dlqRows).toHaveLength(1);
    expect(dlqRows[0]!.failureReason).toBe('no_task_matched');

    // SC-5: comprehensive check — EVERY denied header absent from scrubbed_headers
    const headers = dlqRows[0]!.scrubbedHeaders as Record<string, unknown>;
    const headerKeysLower = Object.keys(headers).map((k) => k.toLowerCase());
    const allDenied = [
      'authorization',
      'x-hub-signature',
      'x-hub-signature-256',
      'x-github-token',
      'x-xci-token',
      'cookie',
      'set-cookie',
    ];
    for (const denied of allDenied) {
      expect(headerKeysLower, `denied key '${denied}' must not appear in scrubbed_headers`).not.toContain(denied);
    }

    // Non-sensitive headers ARE preserved (x-github-event etc.)
    expect(headers['x-github-event']).toBe('push');
    expect(headers['x-github-delivery']).toBe(deliveryId);
  });
});
