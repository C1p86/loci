import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { sessions } from '../../../db/schema.js';
import { createTransport } from '../../../email/transport.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb } from '../../../test-utils/db-harness.js';

async function signupAndVerify(email: string, password: string) {
  const db = getTestDb();
  const repos = makeRepos(db);
  const { user, org } = await repos.admin.signupTx({ email, password });
  await repos.admin.markUserEmailVerified(user.id);
  return { user, org };
}

describe('POST /api/auth/login (AUTH-03)', () => {
  beforeEach(async () => resetDb());

  it('valid credentials → 200 + xci_sid cookie with correct attributes', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { user, org } = await signupAndVerify('a@example.com', 'long-enough-password-123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@example.com', password: 'long-enough-password-123' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: user.id, orgId: org.id });

    const setCookieHeaders = res.headers['set-cookie'];
    const sidCookie = Array.isArray(setCookieHeaders)
      ? setCookieHeaders.find((c) => c.includes('xci_sid='))
      : typeof setCookieHeaders === 'string' && setCookieHeaders.includes('xci_sid=')
        ? setCookieHeaders
        : undefined;
    expect(sidCookie).toBeDefined();
    expect(sidCookie).toMatch(/xci_sid=/);
    expect(sidCookie).toMatch(/HttpOnly/i);
    expect(sidCookie).toMatch(/SameSite=Strict/i);
    expect(sidCookie).toMatch(/Path=\//);
    // secure only in production
    expect(sidCookie).not.toMatch(/Secure/i);
    await app.close();
  });

  it('wrong password → 401 AUTHN_INVALID_CREDENTIALS (body has no user info)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    await signupAndVerify('wp@example.com', 'correct-long-password-1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'wp@example.com', password: 'wrong-long-password-2' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHN_INVALID_CREDENTIALS');
    expect(res.json().message).toBe('Invalid email or password');
    expect(JSON.stringify(res.json())).not.toContain('wp@example.com'); // no email echo
    await app.close();
  });

  it('unknown email → 401 same code/message as wrong password (no enumeration)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'any-password-here' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHN_INVALID_CREDENTIALS');
    expect(res.json().message).toBe('Invalid email or password');
    await app.close();
  });

  it('unverified email → 401 AUTHN_EMAIL_NOT_VERIFIED (SC-1 gate)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const db = getTestDb();
    const repos = makeRepos(db);
    await repos.admin.signupTx({ email: 'unv@example.com', password: 'long-enough-password' });
    // Deliberately do NOT mark verified
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'unv@example.com', password: 'long-enough-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHN_EMAIL_NOT_VERIFIED');
    await app.close();
  });

  it('multiple concurrent sessions (D-14)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    await signupAndVerify('m@example.com', 'long-enough-password');
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'm@example.com', password: 'long-enough-password' },
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'm@example.com', password: 'long-enough-password' },
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const c1 = (r1.headers['set-cookie'] as string | string[]).toString();
    const c2 = (r2.headers['set-cookie'] as string | string[]).toString();
    // Extract the xci_sid tokens — they should be different
    const tok1 = c1.match(/xci_sid=([^;]+)/)?.[1];
    const tok2 = c2.match(/xci_sid=([^;]+)/)?.[1];
    expect(tok1).toBeDefined();
    expect(tok2).toBeDefined();
    expect(tok1).not.toBe(tok2);

    // Both sessions exist in DB
    const db = getTestDb();
    const sessionRows = await db.select().from(sessions);
    expect(sessionRows.length).toBe(2);
    await app.close();
  });

  it('session persists across requests (SC-1)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    await signupAndVerify('p@example.com', 'long-enough-password');
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'p@example.com', password: 'long-enough-password' },
    });
    const sidHeader = (loginRes.headers['set-cookie'] as string | string[]).toString();
    const sid = sidHeader.match(/xci_sid=([^;]+)/)?.[1];
    expect(sid).toBeDefined();

    // Register a protected test route then verify session is recognized
    app.get('/api/whoami', { preHandler: [app.requireAuth] }, async (req) => ({
      userId: req.user?.id,
      orgId: req.org?.id,
    }));
    const r2 = await app.inject({
      method: 'GET',
      url: '/api/whoami',
      cookies: { xci_sid: sid ?? '' },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().userId).toBeDefined();
    await app.close();
  });
});
