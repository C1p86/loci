// Integration tests for PATCH /api/orgs/:orgId/secrets/:secretId.
// Covers: happy path, SEC-02 new IV per update, name immutability (additionalProperties:false),
// 404 non-existent, 404 cross-org scoping, audit log entry written.

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { secretAuditLog, secrets } from '../../../db/schema.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

type App = Awaited<ReturnType<typeof buildApp>>;

async function makeSession(app: App, userId: string, orgId: string) {
  const db = getTestDb();
  const repos = makeRepos(db, TEST_MEK);
  const s = await repos.admin.createSession({ userId, activeOrgId: orgId });
  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: s.token },
  });
  const csrfToken = csrfRes.json().csrfToken as string;
  const csrfCookie =
    (csrfRes.headers['set-cookie'] as string | string[]).toString().match(/_csrf=([^;]+)/)?.[1] ??
    '';
  return { sid: s.token, csrfToken, csrfCookie };
}

async function createSecret(
  app: App,
  orgId: string,
  session: Awaited<ReturnType<typeof makeSession>>,
  name: string,
  secretValue: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/orgs/${orgId}/secrets`,
    cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
    headers: { 'x-csrf-token': session.csrfToken },
    payload: { name, value: secretValue },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('PATCH /api/orgs/:orgId/secrets/:secretId', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner updates value → 200 + {id}; SEC-02 IV differs from pre-update', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const secretId = await createSecret(app, f.orgA.id, session, 'DB_PASSWORD', 'original-value');

    // Capture pre-update IV
    const preRows = await db
      .select({ iv: secrets.iv })
      .from(secrets)
      .where(and(eq(secrets.orgId, f.orgA.id), eq(secrets.id, secretId)));
    // biome-ignore lint/style/noNonNullAssertion: row must exist after create
    const preIv = Buffer.from(preRows[0]!.iv).toString('hex');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { value: 'updated-value' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(secretId);

    // SEC-02: post-update IV must differ (new random IV per encrypt call)
    const postRows = await db
      .select({ iv: secrets.iv })
      .from(secrets)
      .where(and(eq(secrets.orgId, f.orgA.id), eq(secrets.id, secretId)));
    // biome-ignore lint/style/noNonNullAssertion: row must exist after update
    const postIv = Buffer.from(postRows[0]!.iv).toString('hex');
    expect(preIv).not.toBe(postIv);
  });

  it('PATCH body {name: "NEW"} → 400 additionalProperties error (name is immutable)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const secretId = await createSecret(app, f.orgA.id, session, 'IMMUTABLE_KEY', 'value');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'NEW_NAME' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('Non-existent secretId → 404', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/secrets/xci_sec_nonexistent`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { value: 'new-value' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('orgA session updating orgB secret → 404 (forOrg scoping)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sessionA = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const sessionB = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);
    const secretBId = await createSecret(app, f.orgB.id, sessionB, 'ORG_B_SECRET', 'value');

    // orgA session tries to patch orgB's secret via orgA URL — scoped WHERE returns 0 rows
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretBId}`,
      cookies: { xci_sid: sessionA.sid, _csrf: sessionA.csrfCookie },
      headers: { 'x-csrf-token': sessionA.csrfToken },
      payload: { value: 'hacked' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('Audit log entry written for update (D-22)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const secretId = await createSecret(app, f.orgA.id, session, 'AUDITED_KEY', 'v1');

    await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { value: 'v2' },
    });

    const auditRows = await db
      .select()
      .from(secretAuditLog)
      .where(and(eq(secretAuditLog.orgId, f.orgA.id), eq(secretAuditLog.action, 'update')));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted
    expect(auditRows[0]!.secretName).toBe('AUDITED_KEY');
  });

  it('Viewer updates secret → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const ownerSession = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const secretId = await createSecret(app, f.orgA.id, ownerSession, 'VIEWER_TARGET', 'value');

    const repos = makeRepos(db, TEST_MEK);
    const viewerSignup = await repos.admin.signupTx({
      email: `viewer-${Date.now()}@example.com`,
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(viewerSignup.user.id);
    await repos.admin.addMemberToOrg({
      orgId: f.orgA.id,
      userId: viewerSignup.user.id,
      role: 'viewer',
    });
    const viewerSession = await makeSession(app, viewerSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: viewerSession.sid, _csrf: viewerSession.csrfCookie },
      headers: { 'x-csrf-token': viewerSession.csrfToken },
      payload: { value: 'hacked' },
    });
    expect(res.statusCode).toBe(403);
  });
});
