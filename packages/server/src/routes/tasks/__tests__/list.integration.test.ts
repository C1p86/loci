// Integration tests for GET /api/orgs/:orgId/tasks.
// Covers: org-scoped list, no yamlDefinition in response, Viewer can read.

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
  return app.inject({
    method: 'POST',
    url: `/api/orgs/${orgId}/tasks`,
    cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
    headers: { 'x-csrf-token': session.csrfToken },
    payload: { name, yamlDefinition: VALID_YAML },
  });
}

describe('GET /api/orgs/:orgId/tasks', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('orgA lists only orgA tasks — never orgB tasks', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const sessionA = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const sessionB = await makeSession(app, f.orgB.ownerUser.id, f.orgB.id);

    await createTask(app, f.orgA.id, sessionA, 'orgA-task');
    await createTask(app, f.orgB.id, sessionB, 'orgB-task');

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: sessionA.sid },
    });
    expect(res.statusCode).toBe(200);
    const tasks = res.json() as Array<{ name: string }>;
    expect(tasks.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    expect(tasks[0]!.name).toBe('orgA-task');
  });

  it('List response does NOT include yamlDefinition field (D-10 lean shape)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    await createTask(app, f.orgA.id, session, 'build');

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: session.sid },
    });
    expect(res.statusCode).toBe(200);
    const tasks = res.json() as Array<Record<string, unknown>>;
    expect(tasks.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    const first = tasks[0]!;
    expect('yamlDefinition' in first).toBe(false);
    expect(first.id).toBeDefined();
    expect(first.name).toBeDefined();
    expect(first.createdAt).toBeDefined();
  });

  it('Viewer can list tasks (read access)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const ownerSession = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    await createTask(app, f.orgA.id, ownerSession, 'build');

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
      url: `/api/orgs/${f.orgA.id}/tasks`,
      cookies: { xci_sid: viewerSession.sid },
    });
    expect(res.statusCode).toBe(200);
    const tasks = res.json() as Array<{ name: string }>;
    expect(tasks.length).toBe(1);
    // biome-ignore lint/style/noNonNullAssertion: length checked above
    expect(tasks[0]!.name).toBe('build');
  });

  it('No session → 401', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/tasks`,
    });
    expect(res.statusCode).toBe(401);
  });
});
