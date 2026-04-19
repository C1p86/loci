// Integration tests for GET /api/auth/me (Phase 13 D-34, T-13-01-04)
// Tests: authenticated → 200 + shape; unauthenticated → 401;
//        PATCH task with slug+expose_badge → GET returns slug+expose_badge;
//        duplicate slug → 409 TASK_SLUG_CONFLICT

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { makeRepos } from '../../repos/index.js';
import { clearAllRunTimers } from '../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import type { TwoOrgFixture } from '../../test-utils/two-org-fixture.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';

// --- Helpers ---------------------------------------------------------------

const YAML = 'build:\n  cmd: echo hello\n';

async function seedSessionForUser(
  app: Awaited<ReturnType<typeof buildApp>>,
  userId: string,
  orgId: string,
): Promise<{ cookie: string; csrfToken: string }> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  const { token } = await repos.admin.createSession({ userId, activeOrgId: orgId });

  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const csrfToken = csrfRes.json<{ csrfToken: string }>().csrfToken;
  const rawSetCookie = csrfRes.headers['set-cookie'];
  const csrfCookieVal =
    typeof rawSetCookie === 'string'
      ? rawSetCookie.split(';')[0]
      : ((rawSetCookie as string[])[0]?.split(';')[0] ?? '');

  return { cookie: `session=${token}; ${csrfCookieVal}`, csrfToken };
}

async function createTask(
  app: Awaited<ReturnType<typeof buildApp>>,
  orgId: string,
  cookie: string,
  csrfToken: string,
  name: string,
): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/orgs/${orgId}/tasks`,
    headers: { cookie, 'x-csrf-token': csrfToken },
    payload: { name, yamlDefinition: YAML },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>();
}

// --- Tests ----------------------------------------------------------------

describe('GET /api/auth/me', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let f: TwoOrgFixture;

  beforeAll(async () => {
    app = await buildApp({ logLevel: 'warn' });
    await app.ready();
  });

  afterAll(async () => {
    clearAllRunTimers();
    await app.close();
  });

  beforeEach(async () => {
    await resetDb();
    clearAllRunTimers();
    f = await seedTwoOrgs(getTestDb());
  });

  afterEach(() => {
    clearAllRunTimers();
  });

  it('Test 1 (auth-me authenticated): returns 200 with {user, org, plan} for authenticated user', async () => {
    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; user: unknown; org: unknown; plan: unknown }>();
    expect(body.ok).toBe(true);
    expect(body.user).toMatchObject({
      id: f.orgA.ownerUser.id,
      email: f.orgA.ownerUser.email,
    });
    expect(body.org).toMatchObject({
      id: f.orgA.id,
      role: 'owner',
    });
    expect(body.org).toHaveProperty('name');
    expect(body.org).toHaveProperty('slug');
    expect(body.plan).toMatchObject({
      planName: 'free',
      maxAgents: 5,
      maxConcurrentTasks: 5,
      logRetentionDays: 30,
    });
  });

  it('Test 2 (auth-me unauthenticated): returns 401 with no session cookie', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('Test 3 (task slug+expose_badge): PATCH with slug+expose_badge → GET returns updated fields', async () => {
    const { cookie, csrfToken } = await seedSessionForUser(
      app,
      f.orgA.ownerUser.id,
      f.orgA.id,
    );
    const { id: taskId } = await createTask(app, f.orgA.id, cookie, csrfToken, 'my-task');

    // PATCH with expose_badge + slug
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { expose_badge: true, slug: 'my-task' },
    });
    expect(patchRes.statusCode).toBe(200);

    // GET should include slug + expose_badge
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}`,
      headers: { cookie },
    });
    expect(getRes.statusCode).toBe(200);
    const task = getRes.json<{ slug: string; expose_badge: boolean }>();
    expect(task.slug).toBe('my-task');
    expect(task.expose_badge).toBe(true);
  });

  it('Test 4 (slug conflict): PATCH second task with same slug → 409 TASK_SLUG_CONFLICT', async () => {
    const { cookie, csrfToken } = await seedSessionForUser(
      app,
      f.orgA.ownerUser.id,
      f.orgA.id,
    );
    await createTask(app, f.orgA.id, cookie, csrfToken, 'task-one');
    const { id: task2Id } = await createTask(app, f.orgA.id, cookie, csrfToken, 'task-two');

    // Set slug on task-one first
    const patch1 = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/tasks/${task2Id}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { slug: 'shared-slug' },
    });
    expect(patch1.statusCode).toBe(200);

    // Try to set same slug on task-two — should conflict
    const { id: task3Id } = await createTask(app, f.orgA.id, cookie, csrfToken, 'task-three');
    const patch2 = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/tasks/${task3Id}`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { slug: 'shared-slug' },
    });
    expect(patch2.statusCode).toBe(409);
    const body = patch2.json<{ error: string }>();
    expect(body.error).toBe('TASK_SLUG_CONFLICT');
  });
});
