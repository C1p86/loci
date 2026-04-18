// Integration tests for GET /api/orgs/:orgId/secrets.
// Covers: Owner/Member/Viewer read access, org scoping, metadata-only response (SEC-04).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

type App = Awaited<ReturnType<typeof buildApp>>;

const FORBIDDEN_KEYS = ['value', 'ciphertext', 'iv', 'authTag', 'auth_tag', 'aad'];

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
) {
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

describe('GET /api/orgs/:orgId/secrets', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner lists secrets → 200 with metadata only (no value/ciphertext)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    await createSecret(app, f.orgA.id, session, 'MY_API_KEY', 'super-secret-value');

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    const first = row!;
    expect(typeof first.id).toBe('string');
    expect(first.name).toBe('MY_API_KEY');
    expect(typeof first.createdAt).toBe('string');
    expect(typeof first.updatedAt).toBe('string');
    // SEC-04: ensure no forbidden keys in response
    for (const key of FORBIDDEN_KEYS) {
      expect(first).not.toHaveProperty(key);
    }
  });

  it('Member lists secrets → 200 (read access allowed per D-19)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, TEST_MEK);
    const memberSignup = await repos.admin.signupTx({
      email: `member-${Date.now()}@example.com`,
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(memberSignup.user.id);
    await repos.admin.addMemberToOrg({
      orgId: f.orgA.id,
      userId: memberSignup.user.id,
      role: 'member',
    });
    const memberSession = await makeSession(app, memberSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: memberSession.sid },
    });
    expect(res.statusCode).toBe(200);
  });

  it('Viewer lists secrets → 200 (read access allowed per D-19)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
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
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: viewerSession.sid },
    });
    expect(res.statusCode).toBe(200);
  });

  it('orgA session only sees orgA secrets (org isolation)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sessionA = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const sessionB = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);

    await createSecret(app, f.orgA.id, sessionA, 'SECRET_A', 'value-a');
    await createSecret(app, f.orgB.id, sessionB, 'SECRET_B', 'value-b');

    const resA = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: sessionA.sid },
    });
    const rowsA = resA.json() as Array<Record<string, unknown>>;
    expect(rowsA).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted
    expect(rowsA[0]!.name).toBe('SECRET_A');

    // orgA session cannot list orgB secrets → 403 (OrgMembership check)
    const crossRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgB.id}/secrets`,
      cookies: { xci_sid: sessionA.sid },
    });
    expect(crossRes.statusCode).toBe(403);
  });

  it('No session → 401', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secrets`,
    });
    expect(res.statusCode).toBe(401);
  });
});
