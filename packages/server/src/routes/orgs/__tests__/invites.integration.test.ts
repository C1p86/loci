import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { orgMembers } from '../../../db/schema.js';
import { createTransport } from '../../../email/transport.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';

async function ownerSession(app: Awaited<ReturnType<typeof buildApp>>, email = 'o@example.com') {
  const db = getTestDb();
  const repos = makeRepos(db, TEST_MEK);
  const { user, org } = await repos.admin.signupTx({ email, password: 'long-enough-password' });
  await repos.admin.markUserEmailVerified(user.id);
  const s = await repos.admin.createSession({ userId: user.id, activeOrgId: org.id });
  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: s.token },
  });
  const csrfToken = csrfRes.json().csrfToken as string;
  const csrfCookieMatch = (csrfRes.headers['set-cookie'] as string | string[])
    .toString()
    .match(/_csrf=([^;]+)/);
  const csrfCookie = csrfCookieMatch?.[1] ?? '';
  return { user, org, sid: s.token, csrfToken, csrfCookie };
}

describe('POST /api/orgs/:orgId/invites (AUTH-09)', () => {
  beforeEach(async () => resetDb());
  afterEach(async () => {});

  it('owner invites member → 201 + email sent with 7d expiry', async () => {
    const stub = createTransport('stub', { logger: { info: () => {} } });
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const { org, sid, csrfToken, csrfCookie } = await ownerSession(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.id}/invites`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { email: 'invitee@example.com', role: 'member' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.inviteId).toMatch(/^xci_inv_/);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expiresAt = new Date(body.expiresAt as string);
    const deltaMs = expiresAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(deltaMs).toBeLessThan(8 * 24 * 60 * 60 * 1000);

    expect(stub.captured?.length).toBe(1);
    expect(stub.captured?.[0]?.to).toBe('invitee@example.com');
    expect(stub.captured?.[0]?.subject).toMatch(/invited/i);
    await app.close();
  });

  it('viewer attempts invite → 403 AUTHZ_ROLE_INSUFFICIENT', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const db = getTestDb();
    const repos = makeRepos(db, TEST_MEK);
    const owner = await repos.admin.signupTx({
      email: 'own@example.com',
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(owner.user.id);
    const viewer = await repos.admin.signupTx({
      email: 'view@example.com',
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(viewer.user.id);
    await repos.admin.addMemberToOrg({
      orgId: owner.org.id,
      userId: viewer.user.id,
      role: 'viewer',
    });
    const s = await repos.admin.createSession({
      userId: viewer.user.id,
      activeOrgId: owner.org.id,
    });
    const csrfRes = await app.inject({
      method: 'GET',
      url: '/api/auth/csrf',
      cookies: { xci_sid: s.token },
    });
    const csrfToken = csrfRes.json().csrfToken as string;
    const csrfCookie =
      (csrfRes.headers['set-cookie'] as string | string[]).toString().match(/_csrf=([^;]+)/)?.[1] ??
      '';

    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: s.token, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { email: 'x@y.com', role: 'member' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTHZ_ROLE_INSUFFICIENT');
    await app.close();
  });

  it('orgId in URL does not match request.org.id → 403 AUTHZ_NOT_ORG_MEMBER', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { sid, csrfToken, csrfCookie } = await ownerSession(app);
    const otherOrgId = 'xci_org_spoofedorgiddoesnotexist';
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${otherOrgId}/invites`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { email: 'x@y.com', role: 'member' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTHZ_NOT_ORG_MEMBER');
    await app.close();
  });

  it('missing CSRF on POST → 403', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { org, sid } = await ownerSession(app);
    const res = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.id}/invites`,
      cookies: { xci_sid: sid },
      payload: { email: 'x@y.com', role: 'member' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('GET pending invites (owner only)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { org, sid, csrfToken, csrfCookie } = await ownerSession(app);

    await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.id}/invites`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { email: 'a@ex.com', role: 'member' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/orgs/${org.id}/invites`,
      cookies: { xci_sid: sid },
    });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ email: string; role: string }>;
    expect(list.length).toBe(1);
    expect(list[0]?.email).toBe('a@ex.com');
    await app.close();
  });

  it('DELETE invite (revoke) → 204 + revoked email sent', async () => {
    const stub = createTransport('stub', { logger: { info: () => {} } });
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const { org, sid, csrfToken, csrfCookie } = await ownerSession(app);
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${org.id}/invites`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { email: 'rev@ex.com', role: 'viewer' },
    });
    const inviteId = createRes.json().inviteId as string;

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${org.id}/invites/${inviteId}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(delRes.statusCode).toBe(204);
    // 2 emails: invite + invite-revoked
    expect(stub.captured?.length).toBe(2);
    expect(stub.captured?.[1]?.subject).toMatch(/revoked/i);
    await app.close();
  });

  it('PATCH role owner→viewer blocked (OwnerRoleImmutable — AUTH-08)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { user: owner, org, sid, csrfToken, csrfCookie } = await ownerSession(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${org.id}/members/${owner.id}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT_OWNER_IMMUTABLE');
    await app.close();
  });

  it('PATCH role member→viewer succeeds + role-changed email sent', async () => {
    const stub = createTransport('stub', { logger: { info: () => {} } });
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const { org, sid, csrfToken, csrfCookie } = await ownerSession(app);
    const db = getTestDb();
    const repos = makeRepos(db, TEST_MEK);
    const other = await repos.admin.signupTx({
      email: 'mbr@ex.com',
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(other.user.id);
    await repos.admin.addMemberToOrg({ orgId: org.id, userId: other.user.id, role: 'member' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${org.id}/members/${other.user.id}`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);

    const memberRow = await db
      .select()
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.userId, other.user.id)));
    expect(memberRow[0]?.role).toBe('viewer');
    expect(stub.captured?.some((m) => m.to === 'mbr@ex.com' && /role/i.test(m.subject))).toBe(true);
    await app.close();
  });

  it('PATCH non-member → 404 NF_USER', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const { org, sid, csrfToken, csrfCookie } = await ownerSession(app);
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${org.id}/members/xci_usr_notamember1234567890`,
      cookies: { xci_sid: sid, _csrf: csrfCookie },
      headers: { 'x-csrf-token': csrfToken },
      payload: { role: 'viewer' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NF_USER');
    await app.close();
  });
});
