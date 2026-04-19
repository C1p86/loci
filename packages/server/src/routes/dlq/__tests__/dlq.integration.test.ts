/**
 * Integration tests for DLQ list + retry routes (Plan 12-04 Task 2).
 *
 * Covers:
 *   - GET /api/orgs/:orgId/dlq (paginated, filtered, org-scoped)
 *   - POST /api/orgs/:orgId/dlq/:dlqId/retry (happy path, failures, roles)
 *
 * These tests require a Postgres testcontainer (Docker). This environment has no Docker
 * runtime — tests are written and committed but can only be executed in Linux CI
 * (ubuntu-latest with Docker). This matches the existing integration test pattern
 * documented in STATE.md Phase 7 decisions.
 */

import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { makeRepos } from '../../../repos/index.js';
import { clearAllRunTimers } from '../../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

type App = Awaited<ReturnType<typeof buildApp>>;

async function makeSession(app: App, userId: string, orgId: string) {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  const s = await repos.admin.createSession({ userId, activeOrgId: orgId });
  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: s.token },
  });
  const csrfToken = csrfRes.json<{ csrfToken: string }>().csrfToken;
  const csrfCookie =
    (csrfRes.headers['set-cookie'] as string | string[]).toString().match(/_csrf=([^;]+)/)?.[1] ??
    '';
  return { sid: s.token, csrfToken, csrfCookie };
}

async function addMember(orgId: string, role: 'member' | 'viewer'): Promise<{ id: string }> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  const email = `${role}-${randomBytes(4).toString('hex')}@example.com`;
  const signup = await repos.admin.signupTx({ email, password: 'long-enough-password-12' });
  await repos.admin.markUserEmailVerified(signup.user.id);
  await repos.admin.addMemberToOrg({ orgId, userId: signup.user.id, role });
  return { id: signup.user.id };
}

async function seedDlqEntry(
  orgId: string,
  opts: {
    pluginName?: 'github' | 'perforce';
    failureReason?:
      | 'signature_invalid'
      | 'parse_failed'
      | 'no_task_matched'
      | 'task_validation_failed'
      | 'internal';
    scrubbedBody?: Record<string, unknown>;
    scrubbedHeaders?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const db = getTestDb();
  const repos = makeRepos(db, getTestMek());
  const entry = await repos.forOrg(orgId).dlqEntries.create({
    pluginName: opts.pluginName ?? 'github',
    failureReason: opts.failureReason ?? 'signature_invalid',
    scrubbedBody: opts.scrubbedBody ?? {
      ref: 'refs/heads/main',
      repository: { full_name: 'acme/infra' },
    },
    scrubbedHeaders: opts.scrubbedHeaders ?? {
      'content-type': 'application/json',
      'x-github-event': 'push',
      'x-github-delivery': `dlv-${randomBytes(8).toString('hex')}`,
    },
    httpStatus: 401,
  });
  return entry.id;
}

describe('GET /api/orgs/:orgId/dlq', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => {
    clearAllRunTimers();
    await app.close();
  });

  it('any member can list DLQ entries → 200 with entries array', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    await seedDlqEntry(f.orgA.id);
    const { sid, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/dlq`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: Array<Record<string, unknown>> }>();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBe(1);
    expect(body.entries[0]).toHaveProperty('id');
    expect(body.entries[0]).toHaveProperty('failureReason', 'signature_invalid');
    expect(body.entries[0]).toHaveProperty('pluginName', 'github');
  });

  it('viewer can list DLQ entries', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: viewerId } = await addMember(f.orgA.id, 'viewer');
    await seedDlqEntry(f.orgA.id);
    const { sid, csrfCookie } = await makeSession(app, viewerId, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/dlq`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    expect(res.statusCode).toBe(200);
  });

  it('filters by plugin_name', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    await seedDlqEntry(f.orgA.id, { pluginName: 'github' });
    await seedDlqEntry(f.orgA.id, { pluginName: 'perforce' });
    const { sid, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/dlq?plugin_name=github`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    const body = res.json<{ entries: Array<{ pluginName: string }> }>();
    expect(body.entries.every((e) => e.pluginName === 'github')).toBe(true);
  });

  it('filters by failure_reason', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    await seedDlqEntry(f.orgA.id, { failureReason: 'signature_invalid' });
    await seedDlqEntry(f.orgA.id, { failureReason: 'no_task_matched' });
    const { sid, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/dlq?failure_reason=signature_invalid`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    const body = res.json<{ entries: Array<{ failureReason: string }> }>();
    expect(body.entries.every((e) => e.failureReason === 'signature_invalid')).toBe(true);
  });

  it('org isolation: orgB owner cannot list orgA DLQ → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    await seedDlqEntry(f.orgA.id);
    const { sid, csrfCookie } = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/dlq`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    expect([403, 401]).toContain(res.statusCode);
  });

  it('returns nextCursor when there are more results', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    // Seed 3 entries, request limit=2
    await seedDlqEntry(f.orgA.id);
    await seedDlqEntry(f.orgA.id);
    await seedDlqEntry(f.orgA.id);
    const { sid, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/dlq?limit=2`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    const body = res.json<{ entries: unknown[]; nextCursor?: string }>();
    expect(body.entries.length).toBe(2);
    expect(body.nextCursor).toBeTruthy();
  });
});

describe('POST /api/orgs/:orgId/dlq/:dlqId/retry', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => {
    clearAllRunTimers();
    await app.close();
  });

  it('Viewer cannot retry → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const dlqId = await seedDlqEntry(f.orgA.id);
    const { id: viewerId } = await addMember(f.orgA.id, 'viewer');
    const { sid, csrfToken, csrfCookie } = await makeSession(app, viewerId, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/dlq/${dlqId}/retry`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(403);
  });

  it('Non-existent dlqId → 404', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/dlq/xci_dlq_nonexistent/retry`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(404);
  });

  it('Cross-org: orgA retries orgB dlqId → 404', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const dlqIdB = await seedDlqEntry(f.orgB.id);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/dlq/${dlqIdB}/retry`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(404);
  });

  it('Missing CSRF → 403', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const dlqId = await seedDlqEntry(f.orgA.id);
    const repos = makeRepos(db, mek);
    const s = await repos.admin.createSession({
      userId: f.orgA.ownerUser.id,
      activeOrgId: f.orgA.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/dlq/${dlqId}/retry`,
      cookies: { xci_sid: s.token },
    });

    expect(res.statusCode).toBe(403);
  });

  it('Retry with no_task_matched entry → 200 retryResult=failed_same_reason', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    // no tasks with matching trigger_configs in this org
    const dlqId = await seedDlqEntry(f.orgA.id, {
      failureReason: 'no_task_matched',
      scrubbedHeaders: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': `dlv-${randomBytes(8).toString('hex')}`,
      },
      scrubbedBody: {
        ref: 'refs/heads/main',
        repository: { full_name: 'acme/infra' },
        head_commit: { id: 'abc123', message: 'test' },
        pusher: { name: 'alice' },
      },
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/dlq/${dlqId}/retry`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ retryResult: string; dispatched: number }>();
    expect(body.retryResult).toBe('failed_same_reason');
    expect(body.dispatched).toBe(0);

    // DLQ entry retriedAt should be set
    const mek = getTestMek();
    const repos = makeRepos(db, mek);
    const entry = await repos.forOrg(f.orgA.id).dlqEntries.getById(dlqId);
    expect(entry?.retriedAt).toBeTruthy();
    expect(entry?.retryResult).toBe('failed_same_reason');
  });

  it('Member can retry → 200 (Owner/Member can retry)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const dlqId = await seedDlqEntry(f.orgA.id, {
      failureReason: 'no_task_matched',
      scrubbedHeaders: {
        'content-type': 'application/json',
        'x-github-event': 'push',
        'x-github-delivery': `dlv-${randomBytes(8).toString('hex')}`,
      },
      scrubbedBody: {
        ref: 'refs/heads/main',
        repository: { full_name: 'acme/infra' },
        head_commit: { id: 'abc123', message: 'test' },
        pusher: { name: 'alice' },
      },
    });
    const { id: memberId } = await addMember(f.orgA.id, 'member');
    const { sid, csrfToken, csrfCookie } = await makeSession(app, memberId, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/dlq/${dlqId}/retry`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(200);
  });
});
