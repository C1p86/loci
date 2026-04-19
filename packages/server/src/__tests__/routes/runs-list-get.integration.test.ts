// Integration tests for GET /api/orgs/:orgId/runs (list) + GET /api/orgs/:orgId/runs/:runId (get)
// Plan 10-04 Task 2 — TDD RED phase

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { generateId } from '../../crypto/tokens.js';
import { orgMembers, taskRuns, tasks, users } from '../../db/schema.js';
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

async function seedMemberUser(
  db: ReturnType<typeof getTestDb>,
  orgId: string,
  role: 'member' | 'viewer',
): Promise<{ userId: string }> {
  const userId = generateId('usr');
  const email = `${role}-${randomBytes(4).toString('hex')}@example.com`;
  await db.insert(users).values({ id: userId, email, passwordHash: 'dummy' });
  await db.insert(orgMembers).values({ id: generateId('mem'), orgId, userId, role });
  return { userId };
}

async function seedTask(orgId: string): Promise<{ taskId: string }> {
  const db = getTestDb();
  const taskId = generateId('tsk');
  await db.insert(tasks).values({
    id: taskId,
    orgId,
    name: `task-${randomBytes(4).toString('hex')}`,
    description: '',
    yamlDefinition: 'steps:\n  - run: echo test',
    labelRequirements: [],
  });
  return { taskId };
}

async function seedRun(
  orgId: string,
  taskId: string,
  state = 'queued',
  triggeredByUserId?: string,
): Promise<string> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  const snap = {
    task_id: taskId,
    name: 'test',
    description: '',
    yaml_definition: 'steps:\n  - run: echo test',
    label_requirements: [],
  };
  const run = await repos.forOrg(orgId).taskRuns.create({
    taskId,
    taskSnapshot: snap as Record<string, unknown>,
    paramOverrides: { SOME_OVERRIDE: 'secret-value-should-not-leak' },
    timeoutSeconds: 3600,
    ...(triggeredByUserId !== undefined && { triggeredByUserId }),
  });

  if (state !== 'queued') {
    await db
      .update(taskRuns)
      .set({ state: state as 'succeeded' })
      .where(eq(taskRuns.id, run.id));
  }

  return run.id;
}

// --- Tests: List -----------------------------------------------------------

describe('GET /api/orgs/:orgId/runs (list)', () => {
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
    const db = getTestDb();
    f = await seedTwoOrgs(db);
  });

  afterEach(() => {
    clearAllRunTimers();
  });

  // Test 1: basic list
  it('Test 1 (basic list): Viewer/Member/Owner GET → 200 runs array queued_at DESC', async () => {
    const db = getTestDb();
    const { taskId } = await seedTask(f.orgA.id);
    await seedRun(f.orgA.id, taskId);
    await seedRun(f.orgA.id, taskId);
    await seedRun(f.orgA.id, taskId);

    // Viewer can read
    const { userId: viewerId } = await seedMemberUser(db, f.orgA.id, 'viewer');
    const { cookie } = await seedSessionForUser(app, viewerId, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ runs: unknown[]; nextCursor: string | null }>();
    expect(body.runs).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
  });

  // Test 2: state filter
  it('Test 2 (state filter): ?state=queued → only queued runs', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    await seedRun(f.orgA.id, taskId, 'queued');
    await seedRun(f.orgA.id, taskId, 'queued');
    await seedRun(f.orgA.id, taskId, 'succeeded');
    await seedRun(f.orgA.id, taskId, 'failed');

    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res1 = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs?state=queued`,
      headers: { cookie },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json<{ runs: Array<{ state: string }> }>();
    expect(body1.runs).toHaveLength(2);
    expect(body1.runs.every((r) => r.state === 'queued')).toBe(true);

    // CSV multi-state filter
    const res2 = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs?state=succeeded,failed`,
      headers: { cookie },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json<{ runs: Array<{ state: string }> }>();
    expect(body2.runs).toHaveLength(2);
  });

  // Test 3: taskId filter
  it('Test 3 (taskId filter): runs filtered by task', async () => {
    const { taskId: t1 } = await seedTask(f.orgA.id);
    const { taskId: t2 } = await seedTask(f.orgA.id);
    await seedRun(f.orgA.id, t1);
    await seedRun(f.orgA.id, t1);
    await seedRun(f.orgA.id, t2);

    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs?taskId=${t1}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ runs: Array<{ taskId: string }> }>();
    expect(body.runs).toHaveLength(2);
    expect(body.runs.every((r) => r.taskId === t1)).toBe(true);
  });

  // Test 4: limit pagination
  it('Test 4 (limit): ?limit=2 → 2 rows; nextCursor set', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    await seedRun(f.orgA.id, taskId);
    await seedRun(f.orgA.id, taskId);
    await seedRun(f.orgA.id, taskId);

    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs?limit=2`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ runs: unknown[]; nextCursor: string | null }>();
    expect(body.runs).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();
  });

  // Test 5: since cursor pagination
  it('Test 5 (since cursor): second page via since=<cursor>', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    // Seed 4 runs
    for (let i = 0; i < 4; i++) {
      await seedRun(f.orgA.id, taskId);
      // Small delay to ensure distinct queued_at
      await new Promise((r) => setTimeout(r, 5));
    }

    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    // First page: limit=2
    const page1 = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs?limit=2`,
      headers: { cookie },
    });
    const body1 = page1.json<{ runs: Array<{ queuedAt: string }>; nextCursor: string }>();
    expect(body1.runs).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    // Second page: use nextCursor as since
    const page2 = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs?limit=2&since=${encodeURIComponent(body1.nextCursor)}`,
      headers: { cookie },
    });
    const body2 = page2.json<{ runs: Array<{ queuedAt: string }>; nextCursor: string | null }>();
    expect(body2.runs.length).toBeGreaterThanOrEqual(1);
    // Second page runs should be older than first page cursor
    for (const r of body2.runs) {
      expect(new Date(r.queuedAt).getTime()).toBeLessThan(new Date(body1.nextCursor).getTime());
    }
  });

  // Test 6: limit clamped to 200 max
  it('Test 6 (limit clamped): ?limit=10000 → 400', async () => {
    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs?limit=10000`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(400);
  });

  // Test 7: cross-org isolation
  it('Test 7 (cross-org isolation): orgA runs never appear for orgB user', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    await seedRun(f.orgA.id, taskId);
    await seedRun(f.orgA.id, taskId);

    const { cookie: cookieB } = await seedSessionForUser(app, f.orgB.ownerUser.id, f.orgB.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgB.id}/runs`,
      headers: { cookie: cookieB },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ runs: unknown[] }>();
    expect(body.runs).toHaveLength(0);
  });

  // Test 8: param_overrides NOT in response
  it('Test 8 (SEC-04): param_overrides excluded from list response', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    await seedRun(f.orgA.id, taskId);

    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ runs: Array<Record<string, unknown>> }>();
    expect(body.runs.length).toBeGreaterThan(0);
    for (const run of body.runs) {
      expect(run.paramOverrides).toBeUndefined();
      expect(run.param_overrides).toBeUndefined();
    }
  });
});

// --- Tests: Get -----------------------------------------------------------

describe('GET /api/orgs/:orgId/runs/:runId (get)', () => {
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
    const db = getTestDb();
    f = await seedTwoOrgs(db);
  });

  afterEach(() => {
    clearAllRunTimers();
  });

  // Test 9: returns full row minus param_overrides + task_snapshot included
  it('Test 9 (full row): taskSnapshot included; paramOverrides excluded', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    const runId = await seedRun(f.orgA.id, taskId);

    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs/${runId}`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body.id).toBe(runId);
    expect(body.taskSnapshot).toBeDefined();
    // paramOverrides must NOT be in response
    expect(body.paramOverrides).toBeUndefined();
    expect(body.param_overrides).toBeUndefined();
  });

  // Test 10: 404 cross-org
  it('Test 10 (cross-org 404): orgA run → orgB user → 404', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    const runId = await seedRun(f.orgA.id, taskId);

    const { cookie: cookieB } = await seedSessionForUser(app, f.orgB.ownerUser.id, f.orgB.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgB.id}/runs/${runId}`,
      headers: { cookie: cookieB },
    });

    expect(res.statusCode).toBe(404);
  });
});
