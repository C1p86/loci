import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { passwordResets, sessions, users } from '../../../db/schema.js';
import { createTransport, type EmailTransport } from '../../../email/transport.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';

function makeStub(): EmailTransport {
  return createTransport('stub', { logger: { info: () => {} } });
}

async function signupAndVerify(email: string, password: string) {
  const db = getTestDb();
  const repos = makeRepos(db, TEST_MEK);
  const { user } = await repos.admin.signupTx({ email, password });
  await repos.admin.markUserEmailVerified(user.id);
  return user;
}

describe('password reset (AUTH-04)', () => {
  beforeEach(async () => resetDb());

  it('request-reset for verified user → 204 + email sent', async () => {
    const stub = makeStub();
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    await signupAndVerify('rr@example.com', 'long-enough-password');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/request-reset',
      payload: { email: 'rr@example.com' },
    });
    expect(res.statusCode).toBe(204);
    expect(stub.captured?.length).toBe(1);
    expect(stub.captured?.[0]?.to).toBe('rr@example.com');
    expect(stub.captured?.[0]?.text).toMatch(/token=/);
    await app.close();
  });

  it('request-reset for unknown email → 204 + NO email (no enumeration)', async () => {
    const stub = makeStub();
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/request-reset',
      payload: { email: 'noone@example.com' },
    });
    expect(res.statusCode).toBe(204);
    expect(stub.captured?.length ?? 0).toBe(0);
    await app.close();
  });

  it('request-reset for unverified user → 204 + NO email', async () => {
    const stub = makeStub();
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const db = getTestDb();
    const repos = makeRepos(db, TEST_MEK);
    await repos.admin.signupTx({ email: 'uv@example.com', password: 'long-enough-password' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/request-reset',
      payload: { email: 'uv@example.com' },
    });
    expect(res.statusCode).toBe(204);
    expect(stub.captured?.length ?? 0).toBe(0);
    await app.close();
  });

  it('reset with valid token → 200 + password hash updated + all user sessions revoked (AUTH-04 SC-5)', async () => {
    const app = await buildApp({ logLevel: 'error', emailTransport: makeStub() });
    const user = await signupAndVerify('rs@example.com', 'old-long-enough-password');
    const db = getTestDb();
    const repos = makeRepos(db, TEST_MEK);

    // Create an active session first
    await repos.admin.createSession({
      userId: user.id,
      activeOrgId: (await repos.admin.findUserFirstOrgMembership(user.id))[0]?.orgId ?? '',
    });
    expect(
      (await db.select().from(sessions).where(eq(sessions.userId, user.id)))[0]?.revokedAt,
    ).toBeNull();

    // Create a reset token
    const pr = await repos.admin.createPasswordReset({ userId: user.id });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token: pr.token, newPassword: 'new-long-enough-password-abc' },
    });
    expect(res.statusCode).toBe(200);

    const hash =
      (await db.select().from(users).where(eq(users.id, user.id)))[0]?.passwordHash ?? '';
    expect(hash).toMatch(/^\$argon2id/);
    // New hash verifies new password, not old
    const { verifyPassword } = await import('../../../crypto/password.js');
    expect(await verifyPassword(hash, 'new-long-enough-password-abc')).toBe(true);
    expect(await verifyPassword(hash, 'old-long-enough-password')).toBe(false);

    // Reset consumed
    const prRow = (
      await db.select().from(passwordResets).where(eq(passwordResets.token, pr.token))
    )[0];
    expect(prRow?.consumedAt).not.toBeNull();

    // All sessions revoked
    const sessionRows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(sessionRows.every((r) => r.revokedAt !== null)).toBe(true);
    await app.close();
  });

  it('reset with same token twice → second call 401 AUTHN_TOKEN_INVALID', async () => {
    const app = await buildApp({ logLevel: 'error', emailTransport: makeStub() });
    const user = await signupAndVerify('tw@example.com', 'old-long-enough-password');
    const repos = makeRepos(getTestDb(), TEST_MEK);
    const pr = await repos.admin.createPasswordReset({ userId: user.id });

    const r1 = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token: pr.token, newPassword: 'new-long-enough-password' },
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token: pr.token, newPassword: 'another-long-password' },
    });
    expect(r2.statusCode).toBe(401);
    expect(r2.json().code).toBe('AUTHN_TOKEN_INVALID');
    await app.close();
  });

  it('reset with expired token → 401', async () => {
    const app = await buildApp({ logLevel: 'error', emailTransport: makeStub() });
    const user = await signupAndVerify('ex@example.com', 'long-enough-password');
    const db = getTestDb();
    const repos = makeRepos(db, TEST_MEK);
    const pr = await repos.admin.createPasswordReset({ userId: user.id });
    await db
      .update(passwordResets)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResets.token, pr.token));

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token: pr.token, newPassword: 'new-long-enough-password' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('reset with short new password → 400 VAL_SCHEMA', async () => {
    const app = await buildApp({ logLevel: 'error', emailTransport: makeStub() });
    const user = await signupAndVerify('sp@example.com', 'long-enough-password');
    const repos = makeRepos(getTestDb(), TEST_MEK);
    const pr = await repos.admin.createPasswordReset({ userId: user.id });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/reset',
      payload: { token: pr.token, newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VAL_SCHEMA');
    await app.close();
  });
});
