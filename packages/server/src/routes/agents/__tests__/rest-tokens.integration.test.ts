// Integration tests for POST /api/orgs/:orgId/agent-tokens.
// Covers: Owner creates, Member creates, Viewer rejected, non-member rejected, missing CSRF.

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

describe('POST /api/orgs/:orgId/agent-tokens', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner creates token → 201 with plaintext token + expiresAt ~24h future', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agent-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(typeof body.tokenId).toBe('string');
    const expiresAt = new Date(body.expiresAt as string);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  });

  it('Member creates token → 201', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, TEST_MEK);
    // Create a member user
    const memberEmail = `member-${Date.now()}@example.com`;
    const memberSignup = await repos.admin.signupTx({
      email: memberEmail,
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(memberSignup.user.id);
    await repos.admin.addMemberToOrg({
      orgId: f.orgA.id,
      userId: memberSignup.user.id,
      role: 'member',
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, memberSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agent-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(res.statusCode).toBe(201);
  });

  it('Viewer → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, TEST_MEK);
    const viewerEmail = `viewer-${Date.now()}@example.com`;
    const viewerSignup = await repos.admin.signupTx({
      email: viewerEmail,
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(viewerSignup.user.id);
    await repos.admin.addMemberToOrg({
      orgId: f.orgA.id,
      userId: viewerSignup.user.id,
      role: 'viewer',
    });
    const { sid, csrfToken, csrfCookie } = await makeSession(app, viewerSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agent-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('Non-member (orgB user) → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agent-tokens`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('Missing CSRF token → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, TEST_MEK);
    const s = await repos.admin.createSession({
      userId: f.orgA.ownerUser.id,
      activeOrgId: f.orgA.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agent-tokens`,
      cookies: { xci_sid: s.token },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('No session → 401', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/agent-tokens`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
});
