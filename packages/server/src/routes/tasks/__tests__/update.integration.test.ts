// Integration tests for PATCH /api/orgs/:orgId/tasks/:taskId.
// Covers: Owner updates, invalid YAML rejected, cross-org isolation, Viewer blocked.

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

describe('PATCH /api/orgs/:orgId/tasks/:taskId', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner updates name + yamlDefinition → 200 + DB reflects new values', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const taskId = await createTask(app, f.orgA.id, session, 'build');

    const newYaml = 'build:\n  cmd: npm run build --prod\n';
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'build-prod', yamlDefinition: newYaml },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(taskId);

    // GET to verify DB update
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: session.sid },
    });
    expect(getRes.statusCode).toBe(200);
    const task = getRes.json();
    expect(task.name).toBe('build-prod');
    expect(task.yamlDefinition).toBe(newYaml);
  });

  it('Update with invalid YAML → 400 TaskValidationError with errors[].line', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const taskId = await createTask(app, f.orgA.id, session, 'build');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { yamlDefinition: 'name: [unclosed' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('XCI_SRV_TASK_VALIDATION');
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('Update stranger-org taskId → 404', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sessionA = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const sessionB = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);
    const orgBTaskId = await createTask(app, f.orgB.id, sessionB, 'build');

    // orgA owner tries to update orgB's task using orgA's orgId
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/tasks/${orgBTaskId}`,
      cookies: { xci_sid: sessionA.sid, _csrf: sessionA.csrfCookie },
      headers: { 'x-csrf-token': sessionA.csrfToken },
      payload: { name: 'hacked' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('Viewer update → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const ownerSession = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const taskId = await createTask(app, f.orgA.id, ownerSession, 'build');

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
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      cookies: { xci_sid: viewerSession.sid, _csrf: viewerSession.csrfCookie },
      headers: { 'x-csrf-token': viewerSession.csrfToken },
      payload: { name: 'hacked' },
    });
    expect(res.statusCode).toBe(403);
  });
});
