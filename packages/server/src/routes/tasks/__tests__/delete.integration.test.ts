// Integration tests for DELETE /api/orgs/:orgId/tasks/:taskId.
// Covers: Owner deletes, Member blocked (Owner-only), non-existent → 404.

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

async function createTask(
  app: App,
  orgId: string,
  session: Awaited<ReturnType<typeof makeSession>>,
  name: string,
) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/orgs/${orgId}/tasks`,
    cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
    headers: { 'x-csrf-token': session.csrfToken },
    payload: { name, yamlDefinition: VALID_YAML },
  });
  return res.json().id as string;
}

describe('DELETE /api/orgs/:orgId/tasks/:taskId', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner delete → 204; subsequent GET returns 404', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const taskId = await createTask(app, f.orgA.id, session, 'build');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
    });
    expect(deleteRes.statusCode).toBe(204);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: session.sid },
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('Member delete → 403 (Owner-only per D-10)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const ownerSession = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const taskId = await createTask(app, f.orgA.id, ownerSession, 'build');

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
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: memberSession.sid, _csrf: memberSession.csrfCookie },
      headers: { 'x-csrf-token': memberSession.csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it('Non-existent taskId → 404', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/tasks/xci_tsk_nonexistent`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it('Missing CSRF → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, TEST_MEK);
    const s = await repos.admin.createSession({
      userId: f.orgA.ownerUser.id,
      activeOrgId: f.orgA.id,
    });
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const taskId = await createTask(app, f.orgA.id, session, 'build');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: s.token },
    });
    expect(res.statusCode).toBe(403);
  });
});
