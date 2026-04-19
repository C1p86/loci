// Integration tests for GET /api/orgs/:orgId/runs/:runId/logs.log (download endpoint)
// Plan 11-03 Task 1 — TDD RED phase
//
// Tests:
//   1. Happy path — orgA user downloads run with 5 chunks → 200, text/plain, Content-Disposition, body in order
//   2. Cross-org — orgB user requests orgA run → 404
//   3. Unauthenticated — no session cookie → 401

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { generateId } from '../../crypto/tokens.js';
import { logChunks } from '../../db/schema.js';
import { makeRepos } from '../../repos/index.js';
import { clearAllRunTimers } from '../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import type { TwoOrgFixture } from '../../test-utils/two-org-fixture.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';

// Minimal task snapshot for test runs
const TASK_SNAPSHOT = {
  task_id: 'xci_task_test',
  name: 'Test Task',
  description: '',
  yaml_definition: 'steps:\n  - run: echo hello',
  label_requirements: [],
};

/** Create a session cookie + csrf token for a given user+org. */
async function seedSession(
  app: Awaited<ReturnType<typeof buildApp>>,
  userId: string,
  orgId: string,
): Promise<{ cookie: string; csrfToken: string }> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  const { token } = await repos.admin.createSession({ userId, activeOrgId: orgId });

  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const csrfBody = csrfRes.json<{ csrfToken: string }>();
  const rawSetCookie = csrfRes.headers['set-cookie'];
  const csrfCookieVal =
    typeof rawSetCookie === 'string'
      ? rawSetCookie.split(';')[0]
      : ((rawSetCookie as string[])[0]?.split(';')[0] ?? '');
  const cookie = `session=${token}; ${csrfCookieVal}`;
  return { cookie, csrfToken: csrfBody.csrfToken };
}

/** Seed a queued run for the given org and return the runId. */
async function seedRun(orgId: string): Promise<string> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);
  // Insert task first
  const taskId = generateId('tsk');
  await db.insert((await import('../../db/schema.js')).tasks).values({
    id: taskId,
    orgId,
    name: `task-${taskId}`,
    description: '',
    yamlDefinition: 'steps:\n  - run: echo hello',
    labelRequirements: [],
  });
  const run = await repos.forOrg(orgId).taskRuns.create({
    taskId,
    taskSnapshot: TASK_SNAPSHOT as unknown as Record<string, unknown>,
    timeoutSeconds: 3600,
  });
  return run.id;
}

/** Persist N log chunks directly into DB for a given runId. */
async function seedLogChunks(runId: string, count: number): Promise<void> {
  const db = getTestDb();
  const now = new Date();
  const chunks = Array.from({ length: count }, (_, i) => ({
    id: generateId('lch'),
    runId,
    seq: i,
    stream: 'stdout' as const,
    data: `line ${i}\n`,
    ts: new Date(now.getTime() + i * 100),
    persistedAt: now,
  }));
  await db.insert(logChunks).values(chunks);
}

describe('GET /api/orgs/:orgId/runs/:runId/logs.log (download)', () => {
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

  it('Test 1 (happy path): orgA user downloads 5 chunks → 200, correct headers + body', async () => {
    const runId = await seedRun(f.orgA.id);
    await seedLogChunks(runId, 5);
    const { cookie } = await seedSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs/${runId}/logs.log`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.headers['content-disposition']).toContain(`run-${runId}.log`);
    expect(res.headers['content-disposition']).toContain('attachment');

    const body = res.body;
    // All 5 chunks should be present in order
    for (let i = 0; i < 5; i++) {
      expect(body).toContain(`line ${i}`);
    }
    // Each line should have the [<ts> STDOUT] prefix
    expect(body).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*STDOUT\]/);
    // Lines should appear in seq order
    const lines = body.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThanOrEqual(5);
    // Verify seq order: "line 0" should appear before "line 4"
    const idx0 = body.indexOf('line 0');
    const idx4 = body.indexOf('line 4');
    expect(idx0).toBeLessThan(idx4);
  });

  it('Test 2 (cross-org isolation): orgB user requests orgA run → 404', async () => {
    const runId = await seedRun(f.orgA.id);
    await seedLogChunks(runId, 5);
    const { cookie } = await seedSession(app, f.orgB.ownerUser.id, f.orgB.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgB.id}/runs/${runId}/logs.log`,
      headers: { cookie },
    });

    // The run belongs to orgA, not orgB — scoped repo returns undefined → 404
    expect(res.statusCode).toBe(404);
  });

  it('Test 3 (unauthenticated): no session cookie → 401', async () => {
    const runId = await seedRun(f.orgA.id);
    await seedLogChunks(runId, 3);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/runs/${runId}/logs.log`,
    });

    expect(res.statusCode).toBe(401);
  });
});
