import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { emailVerifications, users } from '../../../db/schema.js';
import { createTransport } from '../../../email/transport.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb } from '../../../test-utils/db-harness.js';

describe('POST /api/auth/verify-email (AUTH-02)', () => {
  beforeEach(async () => resetDb());

  async function signupAndGetToken(email: string, password: string) {
    const db = getTestDb();
    const repos = makeRepos(db);
    const { user } = await repos.admin.signupTx({ email, password });
    const v = await repos.admin.createEmailVerification({ userId: user.id });
    return { userId: user.id, token: v.token };
  }

  it('valid token → 200; email_verified_at set; consumed_at set', async () => {
    const stub = createTransport('stub', { logger: { info: () => {} } });
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const { userId, token } = await signupAndGetToken('v@example.com', 'long-enough-password');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    expect(res.statusCode).toBe(200);

    const db = getTestDb();
    const userRow = (await db.select().from(users).where(eq(users.id, userId)))[0];
    expect(userRow?.emailVerifiedAt).not.toBeNull();

    const verRow = (
      await db.select().from(emailVerifications).where(eq(emailVerifications.token, token))
    )[0];
    expect(verRow?.consumedAt).not.toBeNull();
    await app.close();
  });

  it('same token reused → 401 AUTHN_TOKEN_INVALID (single-use)', async () => {
    const stub = createTransport('stub', { logger: { info: () => {} } });
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const { token } = await signupAndGetToken('r@example.com', 'long-enough-password');

    await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHN_TOKEN_INVALID');
    await app.close();
  });

  it('expired token → 401', async () => {
    const stub = createTransport('stub', { logger: { info: () => {} } });
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const { token } = await signupAndGetToken('e@example.com', 'long-enough-password');
    const db = getTestDb();
    await db
      .update(emailVerifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailVerifications.token, token));

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTHN_TOKEN_INVALID');
    await app.close();
  });

  it('unknown token → 401', async () => {
    const stub = createTransport('stub', { logger: { info: () => {} } });
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: 'a'.repeat(43) },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
