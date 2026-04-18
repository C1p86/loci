// Integration tests for DELETE /api/orgs/:orgId/secrets/:secretId.
// Covers: Owner delete, Member blocked (Owner-only), tombstone audit entry (D-21/D-22),
// non-existent → 404.

import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { secretAuditLog, secrets } from '../../../db/schema.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

type App = Awaited<ReturnType<typeof buildApp>>;

async function makeSession(app: App, userId: string, orgId: string) {
  const db = getTestDb();
  const repos = makeRepos(db, TEST_MEK);
  const s = await repos.admin.createSession({ userId, activeOrgId: orgId });
  const csrfRes = await app.inject({
    method: 'GET',
    url: '/api/auth/csrf',
    cookies: { xci_sid: s.token },
  });
  const csrfToken = csrfRes.json().csrfToken as string;
  const csrfCookie =
    (csrfRes.headers['set-cookie'] as string | string[]).toString().match(/_csrf=([^;]+)/)?.[1] ??
    '';
  return { sid: s.token, csrfToken, csrfCookie };
}

async function createSecret(
  app: App,
  orgId: string,
  session: Awaited<ReturnType<typeof makeSession>>,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/orgs/${orgId}/secrets`,
    cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
    headers: { 'x-csrf-token': session.csrfToken },
    payload: { name, value: 'some-value' },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('DELETE /api/orgs/:orgId/secrets/:secretId', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('Owner delete → 204; secrets row removed; tombstone audit entry written (D-21/D-22)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const secretId = await createSecret(app, f.orgA.id, session, 'TO_DELETE');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Verify secrets row is gone
    const remaining = await db
      .select()
      .from(secrets)
      .where(and(eq(secrets.orgId, f.orgA.id), eq(secrets.id, secretId)));
    expect(remaining).toHaveLength(0);

    // D-21: tombstone audit entry — secretId IS NULL, secretName preserved
    const auditRows = await db
      .select()
      .from(secretAuditLog)
      .where(
        and(
          eq(secretAuditLog.orgId, f.orgA.id),
          eq(secretAuditLog.action, 'delete'),
          isNull(secretAuditLog.secretId),
        ),
      );
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    // biome-ignore lint/style/noNonNullAssertion: length asserted
    const tombstone = auditRows[0]!;
    expect(tombstone.secretName).toBe('TO_DELETE');
    expect(tombstone.secretId).toBeNull();
    expect(tombstone.actorUserId).toBe(f.orgA.ownerUser.id);
  });

  it('Member delete → 403 (Owner-only per D-19)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const ownerSession = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const secretId = await createSecret(app, f.orgA.id, ownerSession, 'MEMBER_TARGET');

    const repos = makeRepos(db, TEST_MEK);
    const memberSignup = await repos.admin.signupTx({
      email: `member-${Date.now()}@example.com`,
      password: 'long-enough-password',
    });
    await repos.admin.markUserEmailVerified(memberSignup.user.id);
    await repos.admin.addMemberToOrg({
      orgId: f.orgA.id,
      userId: memberSignup.user.id,
      role: 'member',
    });
    const memberSession = await makeSession(app, memberSignup.user.id, f.orgA.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: memberSession.sid, _csrf: memberSession.csrfCookie },
      headers: { 'x-csrf-token': memberSession.csrfToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('AUTHZ_ROLE_INSUFFICIENT');
  });

  it('Non-existent secretId → 404', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/secrets/xci_sec_nonexistent`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it('Missing CSRF → 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repos = makeRepos(db, TEST_MEK);
    const ownerSession = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const secretId = await createSecret(app, f.orgA.id, ownerSession, 'NO_CSRF');
    const s = await repos.admin.createSession({
      userId: f.orgA.ownerUser.id,
      activeOrgId: f.orgA.id,
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: s.token },
    });
    expect(res.statusCode).toBe(403);
  });
});
