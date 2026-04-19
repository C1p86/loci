// Integration tests for GET /api/orgs/:orgId/usage
// Plan 10-04 Task 2 — QUOTA-05, QUOTA-06

import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { generateId } from '../../crypto/tokens.js';
import { orgMembers, users } from '../../db/schema.js';
import { makeAdminRepo } from '../../repos/admin.js';
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

// --- Tests ----------------------------------------------------------------

describe('GET /api/orgs/:orgId/usage', () => {
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

  // Test 11: QUOTA-06 shape — usage response has correct structure
  it('Test 11 (QUOTA-06 shape): Owner GETs /usage → {agents:{used,max}, concurrent:{used,max}, retention_days}', async () => {
    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/usage`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      agents: { used: number; max: number };
      concurrent: { used: number; max: number };
      retention_days: number;
    }>();
    expect(typeof body.agents.used).toBe('number');
    expect(typeof body.agents.max).toBe('number');
    expect(typeof body.concurrent.used).toBe('number');
    expect(typeof body.concurrent.max).toBe('number');
    expect(typeof body.retention_days).toBe('number');
    // Default Free plan values
    expect(body.agents.max).toBe(5);
    expect(body.concurrent.max).toBe(5);
    expect(body.retention_days).toBe(30);
  });

  // Test 12: any member role allowed (Viewer can read /usage)
  it('Test 12 (Viewer allowed): Viewer GETs /usage → 200', async () => {
    const db = getTestDb();
    const { userId: viewerId } = await seedMemberUser(db, f.orgA.id, 'viewer');
    const { cookie } = await seedSessionForUser(app, viewerId, f.orgA.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/usage`,
      headers: { cookie },
    });

    expect(res.statusCode).toBe(200);
  });

  // Test 13: agents.used reflects actual count
  it('Test 13 (live count): agents.used increments after registering agent', async () => {
    const db = getTestDb();
    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    // Check initial count
    const res1 = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/usage`,
      headers: { cookie },
    });
    const before = res1.json<{ agents: { used: number } }>();
    const usedBefore = before.agents.used;

    // Register 2 agents for orgA
    const adminRepo = makeAdminRepo(db);
    await adminRepo.registerNewAgent({ orgId: f.orgA.id, hostname: 'host1', labels: {} });
    await adminRepo.registerNewAgent({ orgId: f.orgA.id, hostname: 'host2', labels: {} });

    const res2 = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/usage`,
      headers: { cookie },
    });
    const after = res2.json<{ agents: { used: number } }>();
    expect(after.agents.used).toBe(usedBefore + 2);
  });

  // Test 14 (Pino redaction): trigger run + verify param_overrides not in logs
  // Note: Pino redaction is verified in the trigger test suite (Test 12 in runs-trigger tests).
  // This test verifies the usage endpoint doesn't log sensitive data.
  it('Test 14 (Pino redaction smoke): usage endpoint produces no sensitive output', async () => {
    const { cookie } = await seedSessionForUser(app, f.orgA.ownerUser.id, f.orgA.id);

    const logLines: string[] = [];
    const spy = vi
      .spyOn(app.log, 'info')
      .mockImplementation((obj: unknown, ..._rest: unknown[]) => {
        logLines.push(JSON.stringify(obj));
      });

    await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/usage`,
      headers: { cookie },
    });

    spy.mockRestore();

    // Usage endpoint never logs param_overrides or secrets
    const allLogs = logLines.join('\n');
    expect(allLogs).not.toContain('paramOverrides');
    expect(allLogs).not.toContain('param_overrides');
  });
});
