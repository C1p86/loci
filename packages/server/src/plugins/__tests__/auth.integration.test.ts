import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { sessions } from '../../db/schema.js';
import { makeRepos } from '../../repos/index.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';

// Environment set by globalSetup (global-setup.ts sets DATABASE_URL etc.)
beforeAll(async () => {
  // Ensure required env vars are set even if globalSetup didn't run (e.g. unit-only run)
  if (!process.env.SESSION_COOKIE_SECRET) {
    process.env.SESSION_COOKIE_SECRET = 'test-cookie-secret-at-least-32-bytes-long!';
  }
  if (!process.env.EMAIL_TRANSPORT) {
    process.env.EMAIL_TRANSPORT = 'stub';
  }
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
});

async function buildTestApp(): Promise<FastifyInstance> {
  return buildApp({ logLevel: 'error' });
}

describe('auth plugin (D-02 + D-09)', () => {
  beforeEach(async () => resetDb());

  it('no cookie → request.user/org/session remain null', async () => {
    const app = await buildTestApp();
    app.get('/test', async (req) => ({
      hasSession: req.session !== null,
      hasUser: req.user !== null,
      hasOrg: req.org !== null,
    }));
    const res = await app.inject({ method: 'GET', url: '/test' });
    expect(res.json()).toEqual({ hasSession: false, hasUser: false, hasOrg: false });
    await app.close();
  });

  it('requireAuth throws SessionRequiredError (401) when no cookie', async () => {
    const app = await buildTestApp();
    app.get('/protected', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHN_SESSION_REQUIRED');
    await app.close();
  });

  it('valid xci_sid cookie populates user, org, session', async () => {
    const app = await buildTestApp();
    const db = getTestDb();
    const repos = makeRepos(db);
    const { user, org } = await repos.admin.signupTx({
      email: 'u@example.com',
      password: 'long-enough-password',
    });
    const s = await repos.admin.createSession({ userId: user.id, activeOrgId: org.id });

    app.get('/me', { preHandler: [app.requireAuth] }, async (req) => ({
      userId: req.user?.id,
      userEmail: req.user?.email,
      orgId: req.org?.id,
      orgRole: req.org?.role,
      sessionId: req.session?.id,
    }));
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { xci_sid: s.token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.userId).toBe(user.id);
    expect(body.userEmail).toBe('u@example.com');
    expect(body.orgId).toBe(org.id);
    expect(body.orgRole).toBe('owner');
    expect(body.sessionId).toBe(s.token);
    await app.close();
  });

  it('revoked session rejected (AUTH-12 irreversible)', async () => {
    const app = await buildTestApp();
    const db = getTestDb();
    const repos = makeRepos(db);
    const { user, org } = await repos.admin.signupTx({
      email: 'r@example.com',
      password: 'long-enough-password',
    });
    const s = await repos.admin.createSession({ userId: user.id, activeOrgId: org.id });
    await repos.admin.revokeSession(s.token);

    app.get('/me', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { xci_sid: s.token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHN_SESSION_REQUIRED');
    await app.close();
  });

  it('expired session rejected', async () => {
    const app = await buildTestApp();
    const db = getTestDb();
    const repos = makeRepos(db);
    const { user, org } = await repos.admin.signupTx({
      email: 'e@example.com',
      password: 'long-enough-password',
    });
    const s = await repos.admin.createSession({ userId: user.id, activeOrgId: org.id });
    // Force expiration in the past
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, s.token));

    app.get('/me', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));
    const res = await app.inject({
      method: 'GET',
      url: '/me',
      cookies: { xci_sid: s.token },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('sliding expiry updates last_seen_at after 1h throttle (Pitfall 6 atomic)', async () => {
    const app = await buildTestApp();
    const db = getTestDb();
    const repos = makeRepos(db);
    const { user, org } = await repos.admin.signupTx({
      email: 'slide@example.com',
      password: 'long-enough-password',
    });
    const s = await repos.admin.createSession({ userId: user.id, activeOrgId: org.id });

    // Backdate last_seen_at by 2 hours to cross the throttle
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000) })
      .where(eq(sessions.id, s.token));

    app.get('/me', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/me', cookies: { xci_sid: s.token } });

    // After the request, last_seen_at should be refreshed to ~now
    const rows = await db.select().from(sessions).where(eq(sessions.id, s.token));
    const lastSeenMs = rows[0]?.lastSeenAt?.getTime() ?? 0;
    const ageMs = Date.now() - lastSeenMs;
    expect(ageMs).toBeLessThan(60 * 1000); // less than 1 minute old
    await app.close();
  });
});
