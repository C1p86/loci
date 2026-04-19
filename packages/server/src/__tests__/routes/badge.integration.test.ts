// Integration tests for GET /badge/:orgSlug/:taskSlug.svg (Phase 13 BADGE-01..04)
// Tests cover:
//   1: expose_badge=true + succeeded run → green SVG (passing)
//   2: failed run → red SVG (failing)
//   3: expose_badge=false → grey SVG (unknown, not 404) — BADGE-04
//   4: non-existent org → grey SVG (unknown, not 404) — BADGE-03
//   5: non-existent task slug → grey SVG (unknown, not 404) — BADGE-03
//   6: Cache-Control: public, max-age=30 header present — BADGE-02
//   7: response is valid SVG (starts <svg, ends </svg>) — BADGE-01

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { generateId } from '../../crypto/tokens.js';
import { taskRuns } from '../../db/schema.js';
import { makeRepos } from '../../repos/index.js';
import { clearAllRunTimers } from '../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import type { TwoOrgFixture } from '../../test-utils/two-org-fixture.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';

// --- Helpers ---------------------------------------------------------------

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

/**
 * Seed a task with a specific slug and expose_badge value via the API.
 * Returns taskId.
 */
async function seedBadgeTask(
  app: Awaited<ReturnType<typeof buildApp>>,
  orgId: string,
  cookie: string,
  csrfToken: string,
  name: string,
  slug: string,
  exposeBadge: boolean,
): Promise<string> {
  // Create task
  const createRes = await app.inject({
    method: 'POST',
    url: `/api/orgs/${orgId}/tasks`,
    headers: { cookie, 'x-csrf-token': csrfToken },
    payload: { name, yamlDefinition: 'steps:\n  - run: echo hi\n' },
  });
  expect(createRes.statusCode).toBe(201);
  const { id: taskId } = createRes.json<{ id: string }>();

  // Update with slug + expose_badge
  const patchRes = await app.inject({
    method: 'PATCH',
    url: `/api/orgs/${orgId}/tasks/${taskId}`,
    headers: { cookie, 'x-csrf-token': csrfToken },
    payload: { slug, expose_badge: exposeBadge },
  });
  expect(patchRes.statusCode).toBe(200);

  return taskId;
}

/**
 * Seed a terminal task run directly in the DB (bypass dispatcher for test speed).
 */
async function seedTerminalRun(
  taskId: string,
  orgId: string,
  state: 'succeeded' | 'failed' | 'cancelled' | 'timed_out',
): Promise<void> {
  const db = getTestDb();
  const runId = generateId('run');
  await db.insert(taskRuns).values({
    id: runId,
    orgId,
    taskId,
    taskSnapshot: {},
    state,
    finishedAt: new Date(),
  });
}

// --- Tests ----------------------------------------------------------------

describe('GET /badge/:orgSlug/:taskSlug.svg (BADGE-01..04)', () => {
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

  it('Test 1 (BADGE-01 passing): expose_badge=true + succeeded run → 200 green SVG', async () => {
    // Get actual org slug via /api/auth/me
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);
    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const { org: orgInfo } = meRes.json<{ org: { slug: string } }>();
    const orgSlug = orgInfo.slug;

    const taskId = await seedBadgeTask(app, f.orgA.id, cookie, csrfToken, 'deploy', 'deploy', true);
    await seedTerminalRun(taskId, f.orgA.id, 'succeeded');

    const res = await app.inject({
      method: 'GET',
      url: `/badge/${orgSlug}/deploy.svg`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toMatch(/#4c1/); // green color
    expect(res.body).toMatch(/passing/);
    expect(res.body.trim()).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  it('Test 2 (BADGE-01 failing): failed run → 200 red SVG', async () => {
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);
    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const { org: orgInfo } = meRes.json<{ org: { slug: string } }>();
    const orgSlug = orgInfo.slug;

    const taskId = await seedBadgeTask(app, f.orgA.id, cookie, csrfToken, 'build', 'build', true);
    await seedTerminalRun(taskId, f.orgA.id, 'failed');

    const res = await app.inject({
      method: 'GET',
      url: `/badge/${orgSlug}/build.svg`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/#e05d44/); // red color
    expect(res.body).toMatch(/failing/);
  });

  it('Test 3 (BADGE-04 expose_badge=false): expose_badge=false → 200 grey SVG, NOT 404', async () => {
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);
    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const { org: orgInfo } = meRes.json<{ org: { slug: string } }>();
    const orgSlug = orgInfo.slug;

    // Create task with expose_badge=false (default); seed a run so it would show if exposed
    const taskId = await seedBadgeTask(app, f.orgA.id, cookie, csrfToken, 'test', 'test-task', false);
    await seedTerminalRun(taskId, f.orgA.id, 'succeeded');

    const res = await app.inject({
      method: 'GET',
      url: `/badge/${orgSlug}/test-task.svg`,
    });

    expect(res.statusCode).toBe(200); // NOT 404 per BADGE-04
    expect(res.body).toMatch(/#9f9f9f/); // grey color
    expect(res.body).toMatch(/unknown/);
  });

  it('Test 4 (BADGE-03 non-existent org): non-existent org slug → 200 grey SVG, NOT 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/badge/this-org-does-not-exist/any-task.svg',
    });

    expect(res.statusCode).toBe(200); // NOT 404 per BADGE-03
    expect(res.body).toMatch(/#9f9f9f/);
    expect(res.body).toMatch(/unknown/);
  });

  it('Test 5 (BADGE-03 non-existent task): valid org + non-existent task slug → 200 grey SVG, NOT 404', async () => {
    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);
    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const { org: orgInfo } = meRes.json<{ org: { slug: string } }>();
    const orgSlug = orgInfo.slug;

    const res = await app.inject({
      method: 'GET',
      url: `/badge/${orgSlug}/task-does-not-exist.svg`,
    });

    expect(res.statusCode).toBe(200); // NOT 404 per BADGE-03
    expect(res.body).toMatch(/#9f9f9f/);
    expect(res.body).toMatch(/unknown/);
  });

  it('Test 6 (BADGE-02 cache header): Cache-Control: public, max-age=30 present on every response', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/badge/nonexistent-org/any-task.svg',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
  });

  it('Test 7 (BADGE-01 SVG structure): response body is valid SVG', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/badge/nonexistent-org/any-task.svg',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.trim()).toMatch(/^<svg[^>]*>[\s\S]*<\/svg>$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('Test 8 (unknown no runs): expose_badge=true but no terminal runs → grey SVG (unknown)', async () => {
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);
    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    const { org: orgInfo } = meRes.json<{ org: { slug: string } }>();
    const orgSlug = orgInfo.slug;

    // expose_badge=true but NO runs seeded
    await seedBadgeTask(app, f.orgA.id, cookie, csrfToken, 'ci', 'ci', true);

    const res = await app.inject({
      method: 'GET',
      url: `/badge/${orgSlug}/ci.svg`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/#9f9f9f/);
    expect(res.body).toMatch(/unknown/);
  });
});
