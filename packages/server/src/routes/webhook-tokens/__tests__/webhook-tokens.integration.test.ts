/**
 * Integration tests for webhook-token CRUD routes (Plan 12-04 Task 1).
 *
 * Covers:
 *   - POST /api/orgs/:orgId/webhook-tokens (create, github + perforce, role checks, CSRF)
 *   - GET /api/orgs/:orgId/webhook-tokens (list — any member)
 *   - POST /api/orgs/:orgId/webhook-tokens/:id/revoke (Owner/Member, CSRF, cross-org)
 *   - DELETE /api/orgs/:orgId/webhook-tokens/:id (Owner-only, CSRF)
 *   - trigger_configs validation on task create/update
 */

import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { makeRepos } from '../../../repos/index.js';
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

describe('POST /api/orgs/:orgId/webhook-tokens', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner creates github token → 201 {id, plaintext, endpointUrl}', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ pluginName: 'github', pluginSecret: 'super-secret-hmac-key-123' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; plaintext: string; endpointUrl: string }>();
    expect(body.id).toBeTruthy();
    expect(body.plaintext).toBeTruthy();
    expect(body.endpointUrl).toContain('/hooks/github/');
    expect(body.endpointUrl).toContain(body.plaintext);
    // plaintext should NOT be in the DB
    // (no tokenHash or plugin_secret in response)
    expect(body).not.toHaveProperty('tokenHash');
    expect(body).not.toHaveProperty('pluginSecretEncrypted');
  });

  it('Owner creates perforce token without pluginSecret → 201', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ pluginName: 'perforce' }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; plaintext: string; endpointUrl: string }>();
    expect(body.endpointUrl).toContain('/hooks/perforce/');
  });

  it('Member can create a token → 201', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: memberId } = await addMember(f.orgA.id, 'member');
    const { sid, csrfToken, csrfCookie } = await makeSession(app, memberId, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ pluginName: 'perforce' }),
    });

    expect(res.statusCode).toBe(201);
  });

  it('Viewer cannot create a token → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: viewerId } = await addMember(f.orgA.id, 'viewer');
    const { sid, csrfToken, csrfCookie } = await makeSession(app, viewerId, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ pluginName: 'perforce' }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('Missing CSRF → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const mek = getTestMek();
    const repos = makeRepos(db, mek);
    const s = await repos.admin.createSession({
      userId: f.orgA.ownerUser.id,
      activeOrgId: f.orgA.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: s.token },
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ pluginName: 'perforce' }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('Invalid pluginName → 400', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ pluginName: 'gitlab' }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('GitHub token without pluginSecret → 400 (HMAC secret required)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ pluginName: 'github' }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('Perforce token with pluginSecret → 400 (Perforce does not use HMAC)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({ pluginName: 'perforce', pluginSecret: 'some-secret-value-12' }),
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/orgs/:orgId/webhook-tokens', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner can list tokens — returns metadata, no plaintext or secrets', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    await repos.forOrg(f.orgA.id).webhookTokens.create({
      pluginName: 'perforce',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const {
      sid,
      csrfToken: _csrf,
      csrfCookie,
    } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ tokens: Array<Record<string, unknown>> }>();
    expect(Array.isArray(body.tokens)).toBe(true);
    expect(body.tokens.length).toBe(1);
    const token = body.tokens[0] ?? {};
    expect(token.id).toBeTruthy();
    expect(token.pluginName).toBe('perforce');
    expect(token).not.toHaveProperty('tokenHash');
    expect(token).not.toHaveProperty('pluginSecretEncrypted');
    expect(token).not.toHaveProperty('plaintext');
  });

  it('Viewer can also list tokens', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: viewerId } = await addMember(f.orgA.id, 'viewer');
    const { sid, csrfCookie } = await makeSession(app, viewerId, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    expect(res.statusCode).toBe(200);
  });

  it('hasPluginSecret is true for github token (has pluginSecret), false for perforce', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    await repos.forOrg(f.orgA.id).webhookTokens.create({
      pluginName: 'github',
      pluginSecret: 'secret-for-hmac-verification-123',
      createdByUserId: f.orgA.ownerUser.id,
    });
    await repos.forOrg(f.orgA.id).webhookTokens.create({
      pluginName: 'perforce',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const { sid, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });

    const body = res.json<{ tokens: Array<{ pluginName: string; hasPluginSecret: boolean }> }>();
    const githubToken = body.tokens.find((t) => t.pluginName === 'github');
    const perforceToken = body.tokens.find((t) => t.pluginName === 'perforce');
    expect(githubToken?.hasPluginSecret).toBe(true);
    expect(perforceToken?.hasPluginSecret).toBe(false);
  });
});

describe('POST /api/orgs/:orgId/webhook-tokens/:id/revoke', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner can revoke a token → 204', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    const { id: tokenId } = await repos.forOrg(f.orgA.id).webhookTokens.create({
      pluginName: 'perforce',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens/${tokenId}/revoke`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(204);

    // Token should now be revoked (revokedAt set)
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
    });
    const body = listRes.json<{ tokens: Array<{ id: string; revokedAt: string | null }> }>();
    const token = body.tokens.find((t) => t.id === tokenId);
    expect(token?.revokedAt).toBeTruthy();
  });

  it('Member can revoke a token → 204', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    const { id: tokenId } = await repos.forOrg(f.orgA.id).webhookTokens.create({
      pluginName: 'perforce',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const { id: memberId } = await addMember(f.orgA.id, 'member');
    const { sid, csrfToken, csrfCookie } = await makeSession(app, memberId, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens/${tokenId}/revoke`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(204);
  });

  it('Viewer cannot revoke → 403', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    const { id: tokenId } = await repos.forOrg(f.orgA.id).webhookTokens.create({
      pluginName: 'perforce',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const { id: viewerId } = await addMember(f.orgA.id, 'viewer');
    const { sid, csrfToken, csrfCookie } = await makeSession(app, viewerId, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens/${tokenId}/revoke`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(403);
  });

  it('Cross-org: orgA owner revoking orgB token ID → 404', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    const { id: tokenIdB } = await repos.forOrg(f.orgB.id).webhookTokens.create({
      pluginName: 'perforce',
      createdByUserId: f.orgB.ownerUser.id,
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens/${tokenIdB}/revoke`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/orgs/:orgId/webhook-tokens/:id', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner can hard-delete a token → 204 + row gone', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    const { id: tokenId } = await repos.forOrg(f.orgA.id).webhookTokens.create({
      pluginName: 'perforce',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens/${tokenId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(204);

    // Verify token is gone
    const token = await repos.forOrg(f.orgA.id).webhookTokens.getById(tokenId);
    expect(token).toBeUndefined();
  });

  it('Member cannot delete (Owner-only) → 403', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    const { id: tokenId } = await repos.forOrg(f.orgA.id).webhookTokens.create({
      pluginName: 'perforce',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const { id: memberId } = await addMember(f.orgA.id, 'member');
    const { sid, csrfToken, csrfCookie } = await makeSession(app, memberId, f.orgA.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/webhook-tokens/${tokenId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('trigger_configs validation on task create/update', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Task create with valid github trigger_configs → 201', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: `task-${randomBytes(4).toString('hex')}`,
        yamlDefinition: 'steps:\n  - run: echo hello',
        trigger_configs: [{ plugin: 'github', events: ['push'] }],
      }),
    });

    expect(res.statusCode).toBe(201);
  });

  it('Task create with invalid trigger_configs → 400', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: `task-${randomBytes(4).toString('hex')}`,
        yamlDefinition: 'steps:\n  - run: echo hello',
        trigger_configs: [{ plugin: 'gitlab' }],
      }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('Task update with invalid trigger_configs → 400', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    const { id: taskId } = await repos.forOrg(f.orgA.id).tasks.create({
      name: `task-${randomBytes(4).toString('hex')}`,
      yamlDefinition: 'steps:\n  - run: echo hello',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({
        trigger_configs: [{ plugin: 'github', events: [] }],
      }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('Task update with valid trigger_configs → 200', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, mek);
    const { id: taskId } = await repos.forOrg(f.orgA.id).tasks.create({
      name: `task-${randomBytes(4).toString('hex')}`,
      yamlDefinition: 'steps:\n  - run: echo hello',
      createdByUserId: f.orgA.ownerUser.id,
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
      payload: JSON.stringify({
        trigger_configs: [{ plugin: 'perforce', depot: '//depot/infra/*' }],
      }),
    });

    expect(res.statusCode).toBe(200);
  });
});
