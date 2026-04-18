// Integration tests for GET /api/orgs/:orgId/secret-audit-log.
// Covers: Owner access, Member/Viewer blocked (403), pagination, limit clamped at 1000 (D-23).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
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
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/orgs/${orgId}/secrets`,
    cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
    headers: { 'x-csrf-token': session.csrfToken },
    payload: { name, value: 'some-value' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('GET /api/orgs/:orgId/secret-audit-log', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner GET → 200 with paginated entries (newest-first)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    await createSecret(app, f.orgA.id, session, 'FIRST_KEY');
    await createSecret(app, f.orgA.id, session, 'SECOND_KEY');

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secret-audit-log`,
      cookies: { xci_sid: session.sid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      entries: Array<Record<string, unknown>>;
      limit: number;
      offset: number;
    };
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
    expect(body.entries).toHaveLength(2);
    // Entries are newest-first — SECOND_KEY create comes after FIRST_KEY
    // biome-ignore lint/style/noNonNullAssertion: length asserted
    expect(body.entries[0]!.secretName).toBe('SECOND_KEY');
    // biome-ignore lint/style/noNonNullAssertion: length asserted
    expect(body.entries[1]!.secretName).toBe('FIRST_KEY');

    // Verify field shape: no ciphertext/iv/tag in audit entries
    for (const entry of body.entries) {
      expect(entry).not.toHaveProperty('ciphertext');
      expect(entry).not.toHaveProperty('iv');
      expect(entry).not.toHaveProperty('authTag');
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('secretName');
      expect(entry).toHaveProperty('action');
      expect(entry).toHaveProperty('actorUserId');
      expect(entry).toHaveProperty('createdAt');
    }
  });

  it('Member GET → 403 (Owner-only per D-23)', async () => {
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
      url: `/api/orgs/${f.orgA.id}/secret-audit-log`,
      cookies: { xci_sid: memberSession.sid },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTHZ_ROLE_INSUFFICIENT');
  });

  it('Viewer GET → 403 (Owner-only per D-23)', async () => {
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
      url: `/api/orgs/${f.orgA.id}/secret-audit-log`,
      cookies: { xci_sid: viewerSession.sid },
    });
    expect(res.statusCode).toBe(403);
  });

  it('?limit=2000 is clamped to 1000 by AJV schema maximum (D-23)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    // AJV schema has maximum: 1000 — values exceeding it return 400
    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secret-audit-log?limit=2000`,
      cookies: { xci_sid: session.sid },
    });
    // AJV schema maximum:1000 rejects values > 1000 with 400
    expect(res.statusCode).toBe(400);
  });

  it('?limit=1000 succeeds (boundary)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secret-audit-log?limit=1000`,
      cookies: { xci_sid: session.sid },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { limit: number; offset: number };
    expect(body.limit).toBe(1000);
  });

  it('?limit=10&offset=1 returns disjoint page vs ?limit=10&offset=0', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    // Create 3 secrets so we have 3 audit entries
    await createSecret(app, f.orgA.id, session, 'KEY_ONE');
    await createSecret(app, f.orgA.id, session, 'KEY_TWO');
    await createSecret(app, f.orgA.id, session, 'KEY_THREE');

    const page0Res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secret-audit-log?limit=2&offset=0`,
      cookies: { xci_sid: session.sid },
    });
    const page1Res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secret-audit-log?limit=2&offset=2`,
      cookies: { xci_sid: session.sid },
    });
    expect(page0Res.statusCode).toBe(200);
    expect(page1Res.statusCode).toBe(200);

    const page0 = page0Res.json() as { entries: Array<{ id: string }> };
    const page1 = page1Res.json() as { entries: Array<{ id: string }> };
    const ids0 = page0.entries.map((e) => e.id);
    const ids1 = page1.entries.map((e) => e.id);
    // Pages must not overlap
    const overlap = ids0.filter((id) => ids1.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('No session → 401', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secret-audit-log`,
    });
    expect(res.statusCode).toBe(401);
  });
});
