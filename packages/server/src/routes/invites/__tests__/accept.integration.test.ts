import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { orgInvites, orgMembers } from '../../../db/schema.js';
import { createTransport } from '../../../email/transport.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';

async function setupOwnerAndSession(app: Awaited<ReturnType<typeof buildApp>>) {
  const db = getTestDb();
  const repos = makeRepos(db, TEST_MEK);
  const { user, org } = await repos.admin.signupTx({
    email: 'owner@ex.com',
    password: 'long-enough-password',
  });
  await repos.admin.markUserEmailVerified(user.id);
  const s = await repos.admin.createSession({ userId: user.id, activeOrgId: org.id });
  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: s.token },
  });
  const csrfToken = csrfRes.json().csrfToken as string;
  const csrfCookie =
    (csrfRes.headers['set-cookie'] as string | string[]).toString().match(/_csrf=([^;]+)/)?.[1] ??
    '';
  return { user, org, sid: s.token, csrfToken, csrfCookie };
}

async function setupInviteeAndSession(app: Awaited<ReturnType<typeof buildApp>>, email: string) {
  const db = getTestDb();
  const repos = makeRepos(db, TEST_MEK);
  const { user, org } = await repos.admin.signupTx({
    email,
    password: 'long-enough-password',
  });
  await repos.admin.markUserEmailVerified(user.id);
  const s = await repos.admin.createSession({ userId: user.id, activeOrgId: org.id });
  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: s.token },
  });
  const csrfToken = csrfRes.json().csrfToken as string;
  const csrfCookie =
    (csrfRes.headers['set-cookie'] as string | string[]).toString().match(/_csrf=([^;]+)/)?.[1] ??
    '';
  return { user, personalOrg: org, sid: s.token, csrfToken, csrfCookie };
}

describe('POST /api/invites/:token/accept (AUTH-09 SC-3 + D-15)', () => {
  beforeEach(async () => resetDb());
  afterEach(async () => {});

  it('end-to-end SC-3: owner invites member by email; invitee accepts; joins correct org with correct role', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const owner = await setupOwnerAndSession(app);

    // Owner creates invite
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
      payload: { email: 'invitee@ex.com', role: 'member' },
    });
    expect(inviteRes.statusCode).toBe(201);
    const inviteToken = inviteRes.json().token as string;

    // Invitee signs up + verifies email + logs in (simulated via direct repo calls)
    const invitee = await setupInviteeAndSession(app, 'invitee@ex.com');

    // Invitee accepts
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: invitee.sid, _csrf: invitee.csrfCookie },
      headers: { 'x-csrf-token': invitee.csrfToken },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json()).toEqual({ orgId: owner.org.id, role: 'member' });

    // DB: invitee is now a member of owner.org with role member
    const db = getTestDb();
    const member = await db.select().from(orgMembers).where(eq(orgMembers.userId, invitee.user.id));
    const membership = member.find((m) => m.orgId === owner.org.id);
    expect(membership?.role).toBe('member');

    // Invite marked accepted
    const inv = (await db.select().from(orgInvites).where(eq(orgInvites.token, inviteToken)))[0];
    expect(inv?.acceptedAt).not.toBeNull();
    expect(inv?.acceptedByUserId).toBe(invitee.user.id);
    await app.close();
  });

  it('wrong email user → 403 AUTHZ_INVITE_EMAIL_MISMATCH (D-15 email-pinned)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const owner = await setupOwnerAndSession(app);
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
      payload: { email: 'invitee@ex.com', role: 'member' },
    });
    const inviteToken = inviteRes.json().token as string;

    // A DIFFERENT user tries to accept
    const wrongUser = await setupInviteeAndSession(app, 'mallory@ex.com');
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: wrongUser.sid, _csrf: wrongUser.csrfCookie },
      headers: { 'x-csrf-token': wrongUser.csrfToken },
    });
    expect(acceptRes.statusCode).toBe(403);
    expect(acceptRes.json().code).toBe('AUTHZ_INVITE_EMAIL_MISMATCH');
    await app.close();
  });

  it('email match is case-insensitive (D-15)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const owner = await setupOwnerAndSession(app);
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
      payload: { email: 'MixedCase@ex.COM', role: 'viewer' },
    });
    const inviteToken = inviteRes.json().token as string;
    // Invitee signs up with lowercase version
    const invitee = await setupInviteeAndSession(app, 'mixedcase@ex.com');
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: invitee.sid, _csrf: invitee.csrfCookie },
      headers: { 'x-csrf-token': invitee.csrfToken },
    });
    expect(acceptRes.statusCode).toBe(200);
    await app.close();
  });

  it('expired invite → 404 NF_INVITE', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const owner = await setupOwnerAndSession(app);
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
      payload: { email: 'exp@ex.com', role: 'member' },
    });
    const inviteToken = inviteRes.json().token as string;
    // Force expire
    const db = getTestDb();
    await db
      .update(orgInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orgInvites.token, inviteToken));
    const invitee = await setupInviteeAndSession(app, 'exp@ex.com');
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: invitee.sid, _csrf: invitee.csrfCookie },
      headers: { 'x-csrf-token': invitee.csrfToken },
    });
    expect(acceptRes.statusCode).toBe(404);
    expect(acceptRes.json().code).toBe('NF_INVITE');
    await app.close();
  });

  it('revoked invite → 404 NF_INVITE', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const owner = await setupOwnerAndSession(app);
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
      payload: { email: 'r@ex.com', role: 'viewer' },
    });
    const inviteId = inviteRes.json().inviteId as string;
    const inviteToken = inviteRes.json().token as string;

    // Owner revokes
    await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${owner.org.id}/invites/${inviteId}`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
    });

    const invitee = await setupInviteeAndSession(app, 'r@ex.com');
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: invitee.sid, _csrf: invitee.csrfCookie },
      headers: { 'x-csrf-token': invitee.csrfToken },
    });
    expect(acceptRes.statusCode).toBe(404);
    expect(acceptRes.json().code).toBe('NF_INVITE');
    await app.close();
  });

  it('same token accepted twice → 404 on second call (single-use D-19)', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const owner = await setupOwnerAndSession(app);
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
      payload: { email: 'd@ex.com', role: 'member' },
    });
    const inviteToken = inviteRes.json().token as string;
    const invitee = await setupInviteeAndSession(app, 'd@ex.com');
    const r1 = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: invitee.sid, _csrf: invitee.csrfCookie },
      headers: { 'x-csrf-token': invitee.csrfToken },
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: invitee.sid, _csrf: invitee.csrfCookie },
      headers: { 'x-csrf-token': invitee.csrfToken },
    });
    expect(r2.statusCode).toBe(404);
    await app.close();
  });

  it('invitee with existing personal org keeps it (D-18) — ends up in 2 orgs', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const owner = await setupOwnerAndSession(app);
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
      payload: { email: 'dual@ex.com', role: 'viewer' },
    });
    const inviteToken = inviteRes.json().token as string;
    const invitee = await setupInviteeAndSession(app, 'dual@ex.com');
    const r = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: invitee.sid, _csrf: invitee.csrfCookie },
      headers: { 'x-csrf-token': invitee.csrfToken },
    });
    expect(r.statusCode).toBe(200);

    const db = getTestDb();
    const memberships = await db
      .select()
      .from(orgMembers)
      .where(eq(orgMembers.userId, invitee.user.id));
    expect(memberships.length).toBe(2); // personal + invited
    expect(memberships.some((m) => m.orgId === invitee.personalOrg.id && m.role === 'owner')).toBe(
      true,
    );
    expect(memberships.some((m) => m.orgId === owner.org.id && m.role === 'viewer')).toBe(true);
    await app.close();
  });

  it('missing CSRF → 403', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const owner = await setupOwnerAndSession(app);
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${owner.org.id}/invites`,
      cookies: { xci_sid: owner.sid, _csrf: owner.csrfCookie },
      headers: { 'x-csrf-token': owner.csrfToken },
      payload: { email: 'nc@ex.com', role: 'member' },
    });
    const inviteToken = inviteRes.json().token as string;
    const invitee = await setupInviteeAndSession(app, 'nc@ex.com');
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/invites/${encodeURIComponent(inviteToken)}/accept`,
      cookies: { xci_sid: invitee.sid },
      // No CSRF token or cookie
    });
    expect(acceptRes.statusCode).toBe(403);
    await app.close();
  });
});
