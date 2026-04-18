// Integration tests for POST /api/orgs/:orgId/secrets.
// Covers: Owner/Member create, Viewer blocked, CSRF, duplicate name, cross-org uniqueness,
// AJV validation (64KB cap, name pattern), SEC-04 no-plaintext response.

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { secrets } from '../../../db/schema.js';
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

describe('POST /api/orgs/:orgId/secrets', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner creates secret → 201 + {id, name, createdAt}; DB row has ciphertext+iv+authTag+aad', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'API_KEY', value: 'super-secret' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.id).toBe('string');
    expect(body.name).toBe('API_KEY');
    expect(typeof body.createdAt).toBe('string');
    // SEC-04: response must NOT contain plaintext fields
    expect(body).not.toHaveProperty('value');
    expect(body).not.toHaveProperty('ciphertext');
    expect(body).not.toHaveProperty('iv');
    expect(body).not.toHaveProperty('authTag');

    // Verify DB row was encrypted (ciphertext + iv + authTag + aad present)
    const rows = await db
      .select()
      .from(secrets)
      .where(and(eq(secrets.orgId, f.orgA.id), eq(secrets.name, 'API_KEY')));
    expect(rows).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted
    const row = rows[0]!;
    expect(row.ciphertext).toBeTruthy();
    expect(row.iv).toBeTruthy();
    expect(row.authTag).toBeTruthy();
    expect(row.aad).toBe(`${f.orgA.id}:API_KEY`);
  });

  it('Member creates secret → 201', async () => {
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
    const session = await makeSession(app, memberSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'DB_PASS', value: 'password123' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('Viewer create → 403 RoleInsufficientError', async () => {
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
    const session = await makeSession(app, viewerSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'SECRET', value: 'shh' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTHZ_ROLE_INSUFFICIENT');
  });

  it('Missing CSRF → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, TEST_MEK);
    const s = await repos.admin.createSession({
      userId: f.orgA.ownerUser.id,
      activeOrgId: f.orgA.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: s.token },
      payload: { name: 'SECRET', value: 'shh' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Duplicate name in same org → 409 CONFLICT_SECRET_NAME', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'MY_KEY', value: 'value1' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'MY_KEY', value: 'value2' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT_SECRET_NAME');
  });

  it('Same name in different org succeeds (per-org uniqueness)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sessionA = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const sessionB = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);

    const resA = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: sessionA.sid, _csrf: sessionA.csrfCookie },
      headers: { 'x-csrf-token': sessionA.csrfToken },
      payload: { name: 'SHARED_NAME', value: 'value-a' },
    });
    const resB = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgB.id}/secrets`,
      cookies: { xci_sid: sessionB.sid, _csrf: sessionB.csrfCookie },
      headers: { 'x-csrf-token': sessionB.csrfToken },
      payload: { name: 'SHARED_NAME', value: 'value-b' },
    });
    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    // SEC-02 cross-org: same name + different orgs → different DEKs → different ciphertexts
    const rowsA = await db
      .select({ ciphertext: secrets.ciphertext })
      .from(secrets)
      .where(and(eq(secrets.orgId, f.orgA.id), eq(secrets.name, 'SHARED_NAME')));
    const rowsB = await db
      .select({ ciphertext: secrets.ciphertext })
      .from(secrets)
      .where(and(eq(secrets.orgId, f.orgB.id), eq(secrets.name, 'SHARED_NAME')));
    // biome-ignore lint/style/noNonNullAssertion: length asserted via 201 responses
    const ctA = Buffer.from(rowsA[0]!.ciphertext);
    // biome-ignore lint/style/noNonNullAssertion: length asserted via 201 responses
    const ctB = Buffer.from(rowsB[0]!.ciphertext);
    expect(ctA.toString('hex')).not.toBe(ctB.toString('hex'));
  });

  it('value.length > 65536 → 400 AJV schema error', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'BIG_VALUE', value: 'x'.repeat(65537) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('name with lowercase letters → 400 pattern error', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'lowercase_name', value: 'value' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('name starting with digit → 400 pattern error', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: '1INVALID', value: 'value' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('No session → 401', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      payload: { name: 'SECRET', value: 'shh' },
    });
    expect(res.statusCode).toBe(401);
  });
});
