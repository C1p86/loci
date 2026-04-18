import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { sessions } from '../../../db/schema.js';
import { createTransport } from '../../../email/transport.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';

async function loginAndGetCookies(
  app: Awaited<ReturnType<typeof buildApp>>,
  email: string,
  password: string,
) {
  const db = getTestDb();
  const repos = makeRepos(db, TEST_MEK);
  await repos.admin.signupTx({ email, password });
  const userRows = await repos.admin.findUserByEmail(email);
  const userId = userRows[0]?.id;
  if (!userId) throw new Error('User not created in loginAndGetCookies');
  await repos.admin.markUserEmailVerified(userId);

  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  });
  const sidHeader = (loginRes.headers['set-cookie'] as string | string[]).toString();
  const sid = sidHeader.match(/xci_sid=([^;]+)/)?.[1] ?? '';

  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: sid },
  });
  const csrfToken = csrfRes.json().csrfToken as string;
  const csrfHeader = (csrfRes.headers['set-cookie'] as string | string[]).toString();
  const csrfCookie = csrfHeader.match(/_csrf=([^;]+)/)?.[1] ?? '';
  return { sid, csrfToken, csrfCookie };
}

describe('POST /api/auth/logout (AUTH-12)', () => {
  beforeEach(async () => resetDb());

  it('with CSRF + valid session → 204 + session revokedAt set + cookie cleared', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { sid, csrfToken, csrfCookie } = await loginAndGetCookies(
      app,
      'l@example.com',
      'long-enough-password',
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.statusCode).toBe(204);
    // Clear-cookie present
    expect((res.headers['set-cookie'] as string | string[]).toString()).toMatch(/xci_sid=;/);

    // DB: revokedAt set
    const db = getTestDb();
    const row = (await db.select().from(sessions).where(eq(sessions.id, sid)))[0];
    expect(row?.revokedAt).not.toBeNull();
    await app.close();
  });

  it('session after logout is REJECTED by requireAuth (AUTH-12 irreversible)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { sid, csrfToken, csrfCookie } = await loginAndGetCookies(
      app,
      'i@example.com',
      'long-enough-password',
    );

    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });

    app.get('/api/protected', { preHandler: [app.requireAuth] }, async () => ({ ok: true }));
    const res = await app.inject({
      method: 'GET',
      url: '/api/protected',
      cookies: { xci_sid: sid },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHN_SESSION_REQUIRED');
    await app.close();
  });

  it('missing CSRF → 403', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { sid } = await loginAndGetCookies(app, 'nc@example.com', 'long-enough-password');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { xci_sid: sid },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('no session → 403 (onRequest CSRF fires before preHandler requireAuth)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    // onRequest (csrf) fires before preHandler (requireAuth) → 403 (missing CSRF token)
    expect([401, 403]).toContain(res.statusCode);
    await app.close();
  });
});
