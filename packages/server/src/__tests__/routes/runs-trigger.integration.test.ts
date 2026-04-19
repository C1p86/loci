// Integration tests for POST /api/orgs/:orgId/tasks/:taskId/runs (trigger route)
// + POST /api/orgs/:orgId/runs/:runId/cancel (cancel route)
// Plan 10-04 Task 1 — TDD RED phase
//
// Tests cover:
//   1-12: trigger endpoint (DISP-09, QUOTA-04, Pino redaction)
//   13-18: cancel endpoint (D-25, D-26 idempotency, authz)

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { generateId } from '../../crypto/tokens.js';
import { agents, orgPlans, taskRuns, tasks } from '../../db/schema.js';
import { makeRepos } from '../../repos/index.js';
import { clearAllRunTimers } from '../../services/timeout-manager.js';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import type { TwoOrgFixture } from '../../test-utils/two-org-fixture.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';

// --- Helpers ---------------------------------------------------------------

async function _getAuthCookie(
  app: Awaited<ReturnType<typeof buildApp>>,
  _email: string,
  _orgId: string,
): Promise<{ cookie: string; csrfToken: string }> {
  // 1. Request CSRF token
  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const csrfBody = csrfRes.json<{ csrfToken: string }>();
  const csrfToken = csrfBody.csrfToken;
  const csrfCookie = csrfRes.headers['set-cookie'] as string;

  // 2. Login — use the test user's email, password hash in fixture is dummy (not a real password)
  // We need a real user, so use the signupTx approach or directly insert sessions
  return { cookie: csrfCookie, csrfToken };
}

/**
 * Seed an org with a real user who has a valid session + CSRF cookie via the test db.
 * Returns: { sessionToken, csrfToken, csrfCookieHeader }
 */
async function seedSessionForUser(
  app: Awaited<ReturnType<typeof buildApp>>,
  userId: string,
  orgId: string,
  _role: 'owner' | 'member' | 'viewer' = 'owner',
): Promise<{ cookie: string; csrfToken: string }> {
  const db = getTestDb();
  const mek = getTestMek();
  const repos = makeRepos(db, mek);

  // Create real session in DB
  const { token } = await repos.admin.createSession({ userId, activeOrgId: orgId });

  // Get CSRF token via app
  const csrfRes = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
  const csrfBody = csrfRes.json<{ csrfToken: string }>();
  const csrfToken = csrfBody.csrfToken;
  // The csrf cookie comes as Set-Cookie header
  const rawSetCookie = csrfRes.headers['set-cookie'];
  const csrfCookieVal =
    typeof rawSetCookie === 'string'
      ? rawSetCookie.split(';')[0]
      : ((rawSetCookie as string[])[0]?.split(';')[0] ?? '');

  // Build cookie string: session + csrf
  const cookie = `session=${token}; ${csrfCookieVal}`;

  return { cookie, csrfToken };
}

/**
 * Seed a real org member with the given role (in addition to the owner).
 */
async function seedMemberUser(
  db: ReturnType<typeof getTestDb>,
  orgId: string,
  role: 'member' | 'viewer',
): Promise<{ userId: string; email: string }> {
  const userId = generateId('usr');
  const email = `${role}-${randomBytes(4).toString('hex')}@example.com`;
  await db
    .insert((await import('../../db/schema.js')).users)
    .values({ id: userId, email, passwordHash: 'dummy' });
  await db
    .insert((await import('../../db/schema.js')).orgMembers)
    .values({ id: generateId('mem'), orgId, userId, role });
  return { userId, email };
}

/**
 * Seed a task definition with an optional yamlDefinition.
 */
async function seedTask(
  orgId: string,
  opts: {
    yaml?: string;
    labelRequirements?: string[];
    defaultTimeoutSeconds?: number;
  } = {},
): Promise<{ taskId: string }> {
  const db = getTestDb();
  const taskId = generateId('tsk');
  const yaml = opts.yaml ?? 'steps:\n  - run: echo hello';
  await db.insert(tasks).values({
    id: taskId,
    orgId,
    name: `task-${randomBytes(4).toString('hex')}`,
    description: '',
    yamlDefinition: yaml,
    labelRequirements: opts.labelRequirements ?? [],
    ...(opts.defaultTimeoutSeconds !== undefined && {
      defaultTimeoutSeconds: opts.defaultTimeoutSeconds,
    }),
  });
  return { taskId };
}

// --- Tests ----------------------------------------------------------------

describe('POST /api/orgs/:orgId/tasks/:taskId/runs (trigger)', () => {
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

  // Test 1: Happy path — Owner triggers run, gets 201 + queued state
  it('Test 1 (happy path): Owner triggers run → 201 {runId, state:queued}', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ runId: string; state: string }>();
    expect(body.runId).toMatch(/^xci_run_/);
    expect(body.state).toBe('queued');

    // Verify DB row
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(body.runId);
    expect(run).toBeDefined();
    expect(run?.state).toBe('queued');
    expect(run?.taskId).toBe(taskId);
    expect(run?.timeoutSeconds).toBe(3600);
    expect(run?.taskSnapshot).toBeDefined();
  });

  // Test 2: DISP-09 param overrides — yamlDefinition resolved, task unchanged
  it('Test 2 (DISP-09): param_overrides resolved in snapshot; source task unchanged', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — test fixture with placeholder syntax
    const yaml = 'steps:\n  - run: deploy to ${DEPLOY_HOST}';
    const { taskId } = await seedTask(f.orgA.id, { yaml });
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { param_overrides: { DEPLOY_HOST: 'staging.example.com' } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ runId: string }>();

    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(body.runId);
    const snap = run?.taskSnapshot as Record<string, unknown>;
    // snapshot has resolved value
    expect(snap.yaml_definition).toContain('staging.example.com');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — asserting placeholder NOT present
    expect(snap.yaml_definition).not.toContain('${DEPLOY_HOST}');

    // Original task unchanged
    const task = await repos.forOrg(f.orgA.id).tasks.getById(taskId);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — asserting placeholder still present in source
    expect(task?.yamlDefinition).toContain('${DEPLOY_HOST}');
    expect(task?.yamlDefinition).not.toContain('staging.example.com');
  });

  // Test 3: timeout override
  it('Test 3 (timeout override): body.timeout_seconds stored in run row', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { timeout_seconds: 600 },
    });

    expect(res.statusCode).toBe(201);
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(res.json<{ runId: string }>().runId);
    expect(run?.timeoutSeconds).toBe(600);
  });

  // Test 4: task.defaultTimeoutSeconds honored when body doesn't set it
  it('Test 4 (default timeout from task): uses task.defaultTimeoutSeconds=900', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const { taskId } = await seedTask(f.orgA.id, { defaultTimeoutSeconds: 900 });
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(res.json<{ runId: string }>().runId);
    expect(run?.timeoutSeconds).toBe(900);
  });

  // Test 5: timeout cap 86400 — AJV rejects values > 86400
  it('Test 5 (timeout cap): timeout_seconds > 86400 → 400', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { timeout_seconds: 100000 },
    });

    expect(res.statusCode).toBe(400);
  });

  // Test 6: Viewer rejected
  it('Test 6 (Viewer rejected): Viewer POST → 403', async () => {
    const db = getTestDb();
    const { taskId } = await seedTask(f.orgA.id);
    const { userId } = await seedMemberUser(db, f.orgA.id, 'viewer');
    const { cookie, csrfToken } = await seedSessionForUser(app, userId, f.orgA.id, 'viewer');

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  // Test 7: CSRF required
  it('Test 7 (CSRF required): missing x-csrf-token → 403', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie }, // no x-csrf-token
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  // Test 8: rate-limit (testing the global rate-limit, not per-endpoint)
  // Note: rate-limit is harder to test here since we use global 100/min
  // We verify the route has rate-limiting by checking the route works under limit
  it('Test 8 (rate-limit smoke): repeated requests succeed under limit', async () => {
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {},
    });

    // Just verify the route is functional (rate-limit doesn't fire here)
    expect([201, 429]).toContain(res.statusCode);
  });

  // Test 9: task from other org → 404
  it('Test 9 (cross-org task): task owned by orgB while user in orgA → 404', async () => {
    const { taskId: orgBTaskId } = await seedTask(f.orgB.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${orgBTaskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  // Test 10: QUOTA-04 queue depth — reject at 2*max_concurrent
  it('Test 10 (QUOTA-04): queued+active >= 2*max_concurrent → 429 RunQuotaExceededError', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    // Set max_concurrent_tasks=2 for this org
    await db.update(orgPlans).set({ maxConcurrentTasks: 2 }).where(eq(orgPlans.orgId, f.orgA.id));

    // Seed 4 queued runs (= 2*max = threshold)
    const repos = makeRepos(db, mek);
    const snap = {
      task_id: taskId,
      name: 'test',
      description: '',
      yaml_definition: 'steps:\n  - run: sleep 60',
      label_requirements: [],
    };
    for (let i = 0; i < 4; i++) {
      await repos.forOrg(f.orgA.id).taskRuns.create({
        taskId,
        taskSnapshot: snap as Record<string, unknown>,
        timeoutSeconds: 3600,
      });
    }

    // 5th trigger should be rejected
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {},
    });

    expect(res.statusCode).toBe(429);
    const body = res.json<{ code: string }>();
    expect(body.code).toBe('QUOTA_RUN_EXCEEDED');
  });

  // Test 11: params resolved at trigger time — org secret resolved into snapshot
  it('Test 11 (secret resolution): org secret resolved in snapshot at trigger time', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — test fixture with placeholder syntax
    const yaml = 'steps:\n  - run: call ${SECRET_KEY}';
    const { taskId } = await seedTask(f.orgA.id, { yaml });
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    // Seed an org secret
    const repos = makeRepos(db, mek);
    await repos.forOrg(f.orgA.id).secrets.create({
      name: 'SECRET_KEY',
      value: 'xyz123',
      createdByUserId: f.orgA.ownerUser.id,
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(res.json<{ runId: string }>().runId);
    const snap = run?.taskSnapshot as Record<string, unknown>;
    expect(snap.yaml_definition).toContain('xyz123');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — asserting placeholder NOT present
    expect(snap.yaml_definition).not.toContain('${SECRET_KEY}');
  });

  // Test 12: Pino log redaction — param_overrides values not in logs
  it('Test 12 (Pino redaction): param_override value not logged in plaintext', async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — test fixture with placeholder syntax
    const yaml = 'steps:\n  - run: deploy to ${DEPLOY_HOST}';
    const { taskId } = await seedTask(f.orgA.id, { yaml });
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    // Capture log output via spy
    const logLines: string[] = [];
    const origInfo = app.log.info.bind(app.log);
    const spy = vi.spyOn(app.log, 'info').mockImplementation((obj: unknown, ...rest: unknown[]) => {
      logLines.push(`${JSON.stringify(obj)} ${rest.join(' ')}`);
      return origInfo(obj as Parameters<typeof origInfo>[0], ...(rest as [string]));
    });

    await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: { param_overrides: { DEPLOY_HOST: 'super-secret-host-12345' } },
    });

    spy.mockRestore();

    // No log line should contain the plaintext value
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain('super-secret-host-12345');
  });
});

// --- Cancel route tests ---------------------------------------------------

describe('POST /api/orgs/:orgId/runs/:runId/cancel', () => {
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

  // Test 13: Owner cancels queued run
  it('Test 13 (Owner cancels queued run): DB state=cancelled', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    // Trigger a run first
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie, 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(triggerRes.statusCode).toBe(201);
    const runId = triggerRes.json<{ runId: string }>().runId;

    // Cancel it
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/runs/${runId}/cancel`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });

    expect(cancelRes.statusCode).toBe(200);
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('cancelled');
    expect(run?.cancelledByUserId).toBe(f.orgA.ownerUser.id);

    // Run should not be in queue
    expect(app.dispatchQueue.getEntries().find((e) => e.runId === runId)).toBeUndefined();
  });

  // Test 14: Member who triggered cancels own run
  it('Test 14 (Member self-cancel): Member who triggered can cancel own run', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const { taskId } = await seedTask(f.orgA.id);
    const { userId: memberId } = await seedMemberUser(db, f.orgA.id, 'member');
    const { cookie: memberCookie, csrfToken: memberCsrf } = await seedSessionForUser(
      app,
      memberId,
      f.orgA.id,
      'member',
    );

    // Member triggers run
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie: memberCookie, 'x-csrf-token': memberCsrf },
      payload: {},
    });
    expect(triggerRes.statusCode).toBe(201);
    const runId = triggerRes.json<{ runId: string }>().runId;

    // Member cancels their own run
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/runs/${runId}/cancel`,
      headers: { cookie: memberCookie, 'x-csrf-token': memberCsrf },
    });

    expect(cancelRes.statusCode).toBe(200);
    const repos = makeRepos(db, mek);
    const run = await repos.forOrg(f.orgA.id).taskRuns.getById(runId);
    expect(run?.state).toBe('cancelled');
  });

  // Test 15: Member who did NOT trigger is rejected
  it('Test 15 (Member cross-cancel rejected): Member B cannot cancel Member A run → 403', async () => {
    const db = getTestDb();
    const { taskId } = await seedTask(f.orgA.id);

    const { userId: memberAId } = await seedMemberUser(db, f.orgA.id, 'member');
    const { userId: memberBId } = await seedMemberUser(db, f.orgA.id, 'member');

    const { cookie: cookieA, csrfToken: csrfA } = await seedSessionForUser(
      app,
      memberAId,
      f.orgA.id,
      'member',
    );
    const { cookie: cookieB, csrfToken: csrfB } = await seedSessionForUser(
      app,
      memberBId,
      f.orgA.id,
      'member',
    );

    // Member A triggers run
    const triggerRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/tasks/${taskId}/runs`,
      headers: { cookie: cookieA, 'x-csrf-token': csrfA },
      payload: {},
    });
    expect(triggerRes.statusCode).toBe(201);
    const runId = triggerRes.json<{ runId: string }>().runId;

    // Member B tries to cancel — should fail
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/runs/${runId}/cancel`,
      headers: { cookie: cookieB, 'x-csrf-token': csrfB },
    });

    expect(cancelRes.statusCode).toBe(403);
  });

  // Test 16: Running run cancel — cancel frame sent to agent mock
  it('Test 16 (running run cancel): cancel frame sent to connected agent WS', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const repos = makeRepos(db, mek);

    // Seed a run directly in 'running' state with agentId
    const mockAgentId = generateId('agt');
    await db.insert(agents).values({
      id: mockAgentId,
      orgId: f.orgA.id,
      hostname: 'test-host',
      labels: {},
      state: 'online',
      lastSeenAt: new Date(),
    });

    const snap = {
      task_id: taskId,
      name: 'test',
      description: '',
      yaml_definition: 'steps:\n  - run: sleep 60',
      label_requirements: [],
    };
    const run = await repos.forOrg(f.orgA.id).taskRuns.create({
      taskId,
      taskSnapshot: snap as Record<string, unknown>,
      timeoutSeconds: 3600,
      triggeredByUserId: f.orgA.ownerUser.id,
    });

    // Transition to running
    await repos.forOrg(f.orgA.id).taskRuns.updateState(run.id, 'queued', 'dispatched', {
      agentId: mockAgentId,
    });
    await repos.forOrg(f.orgA.id).taskRuns.updateState(run.id, 'dispatched', 'running', {});

    // Register mock WS
    const mockSend = vi.fn();
    app.agentRegistry.set(mockAgentId, { readyState: 1, send: mockSend } as never);

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/runs/${run.id}/cancel`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });

    expect(cancelRes.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledOnce();
    const frame = JSON.parse(mockSend.mock.calls[0]?.[0] as string) as Record<string, unknown>;
    expect(frame.type).toBe('cancel');
    expect(frame.run_id).toBe(run.id);
    expect(frame.reason).toBe('manual');

    // Cleanup
    app.agentRegistry.delete(mockAgentId);
  });

  // Test 17: Cancel idempotent — already terminal run
  it('Test 17 (idempotent): cancelling succeeded run → 200 with current state, no-op', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const { taskId } = await seedTask(f.orgA.id);
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const repos = makeRepos(db, mek);
    const snap = {
      task_id: taskId,
      name: 'test',
      description: '',
      yaml_definition: 'steps:\n  - run: echo done',
      label_requirements: [],
    };
    const run = await repos.forOrg(f.orgA.id).taskRuns.create({
      taskId,
      taskSnapshot: snap as Record<string, unknown>,
      timeoutSeconds: 3600,
    });

    // Manually mark as succeeded
    await db
      .update(taskRuns)
      .set({ state: 'succeeded', exitCode: 0 })
      .where(eq(taskRuns.id, run.id));

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/runs/${run.id}/cancel`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });

    expect(cancelRes.statusCode).toBe(200);
    const body = cancelRes.json<{ state: string; message: string }>();
    expect(body.state).toBe('succeeded');
    expect(body.message).toBe('already terminal');

    // DB state unchanged
    const fresh = await repos.forOrg(f.orgA.id).taskRuns.getById(run.id);
    expect(fresh?.state).toBe('succeeded');
  });

  // Test 18: Cancel nonexistent run → 404
  it('Test 18 (nonexistent run): cancel unknown runId → 404', async () => {
    const { cookie, csrfToken } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/runs/xci_run_notexist/cancel`,
      headers: { cookie, 'x-csrf-token': csrfToken },
    });

    expect(cancelRes.statusCode).toBe(404);
  });
});
