// Integration tests for POST /api/orgs/:orgId/tasks.
// Covers: Owner creates, Member creates, Viewer rejected, duplicate name, cross-org isolation, CSRF, session.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

type App = Awaited<ReturnType<typeof buildApp>>;

const VALID_YAML = 'build:\n  cmd: npm run build\n';

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

describe('POST /api/orgs/:orgId/tasks', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner creates valid task → 201 + {id}', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { name: 'build', yamlDefinition: VALID_YAML },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.id).toBe('string');
    expect(body.id).toMatch(/^xci_tsk_/);
  });

  it('Member creates valid task → 201', async () => {
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
    const { sid, csrfToken, csrfCookie } = await makeSession(app, memberSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { name: 'deploy', yamlDefinition: VALID_YAML },
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
    const { sid, csrfToken, csrfCookie } = await makeSession(app, viewerSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { name: 'build', yamlDefinition: VALID_YAML },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTHZ_ROLE_INSUFFICIENT');
  });

  it('No session → 401', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      payload: { name: 'build', yamlDefinition: VALID_YAML },
    });
    expect(res.statusCode).toBe(401);
  });

  it('Duplicate task name in same org → 409 TaskNameConflictError', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { sid, csrfToken, csrfCookie } = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { name: 'build', yamlDefinition: VALID_YAML },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { name: 'build', yamlDefinition: VALID_YAML },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT_TASK_NAME');
  });

  it('Same task name in different org succeeds (per-org uniqueness)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sessionA = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const sessionB = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);

    const resA = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sessionA.sid, _csrf: sessionA.csrfCookie },
      headers: { 'x-csrf-token': sessionA.csrfToken },
      payload: { name: 'build', yamlDefinition: VALID_YAML },
    });
    const resB = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgB.id}/tasks`,
      cookies: { xci_sid: sessionB.sid, _csrf: sessionB.csrfCookie },
      headers: { 'x-csrf-token': sessionB.csrfToken },
      payload: { name: 'build', yamlDefinition: VALID_YAML },
    });
    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);
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
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: s.token },
      payload: { name: 'build', yamlDefinition: VALID_YAML },
    });
    expect(res.statusCode).toBe(403);
  });
});
