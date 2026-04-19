// Integration tests for POST /api/admin/rotate-mek.
// D-26 plaintext-unchanged acceptance test + D-28 idempotency.
// Platform-admin guard: 403 for non-admin, 401 for no session, 403 for missing CSRF.
// AJV schema: 400 for invalid base64 length, 400 for wrong-pattern base64.

import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, getTestMek, resetDb } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

// Stable admin email — must match PLATFORM_ADMIN_EMAIL set in global-setup.ts.
const ADMIN_EMAIL = 'admin@xci.test';

type App = Awaited<ReturnType<typeof buildApp>>;

/** Generate a fresh 32-byte MEK. Returns both Buffer and base64 string. */
function makeMek(): { mek: Buffer; base64: string } {
  const mek = randomBytes(32);
  return { mek, base64: mek.toString('base64') };
}

/** Insert a user+org into the DB. The user is an Owner of their personal org. */
async function createUser(db: ReturnType<typeof getTestDb>, email: string) {
  const { users, orgMembers, orgPlans, orgs } = await import('../../../db/schema.js');
  const { generateId } = await import('../../../crypto/tokens.js');
  const orgId = generateId('org');
  const userId = generateId('usr');
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId, email, passwordHash: 'dummy' });
    await tx.insert(orgs).values({
      id: orgId,
      name: 'Admin Org',
      slug: `admin-org-${randomBytes(3).toString('hex')}`,
    });
    await tx.insert(orgMembers).values({ id: generateId('mem'), orgId, userId, role: 'owner' });
    await tx.insert(orgPlans).values({ id: generateId('plan'), orgId });
  });
  return { userId, orgId };
}

/** Create a session + CSRF token for a user in a given org. */
async function makeSession(app: App, userId: string, orgId: string) {
  const db = getTestDb();
  const repos = makeRepos(db, getTestMek());
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

describe('POST /api/admin/rotate-mek', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    app = await buildApp({ logLevel: 'warn' });
  });

  afterEach(async () => {
    await app.close();
  });

  it('non-admin user (org Owner) gets 403', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);
    const { base64: newBase64 } = makeMek();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { newMekBase64: newBase64 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('no session gets 401', async () => {
    const { base64: newBase64 } = makeMek();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      payload: { newMekBase64: newBase64 },
    });
    expect(res.statusCode).toBe(401);
  });

  it('missing CSRF token gets 403', async () => {
    const db = getTestDb();
    const { userId, orgId } = await createUser(db, ADMIN_EMAIL);
    const repos = makeRepos(db, getTestMek());
    const s = await repos.admin.createSession({ userId, activeOrgId: orgId });
    const { base64: newBase64 } = makeMek();

    // No CSRF cookie or header — CSRF plugin blocks this
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      cookies: { xci_sid: s.token },
      payload: { newMekBase64: newBase64 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('valid rotation returns {rotated, mekVersion} with rotated >= 0', async () => {
    const db = getTestDb();
    const { userId, orgId } = await createUser(db, ADMIN_EMAIL);
    const session = await makeSession(app, userId, orgId);
    const { base64: newBase64 } = makeMek();

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { newMekBase64: newBase64 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.rotated).toBe('number');
    expect(body.rotated).toBeGreaterThanOrEqual(0);
    expect(typeof body.mekVersion).toBe('number');
  });

  it('D-26: plaintext unchanged through rotation', async () => {
    // This test rebuilds the app with the new MEK after rotation to mirror the real runbook.
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    // Seed 6 secrets across 2 orgs (3 each)
    const repos = makeRepos(db, getTestMek());
    const secretsToCreate = [
      { orgId: f.orgA.id, userId: f.orgA.ownerUser.id, name: 'SECRET_A1', value: 'plaintext-a1' },
      { orgId: f.orgA.id, userId: f.orgA.ownerUser.id, name: 'SECRET_A2', value: 'plaintext-a2' },
      { orgId: f.orgA.id, userId: f.orgA.ownerUser.id, name: 'SECRET_A3', value: 'plaintext-a3' },
      { orgId: f.orgB.id, userId: f.orgB.ownerUser.id, name: 'SECRET_B1', value: 'plaintext-b1' },
      { orgId: f.orgB.id, userId: f.orgB.ownerUser.id, name: 'SECRET_B2', value: 'plaintext-b2' },
      { orgId: f.orgB.id, userId: f.orgB.ownerUser.id, name: 'SECRET_B3', value: 'plaintext-b3' },
    ];
    for (const s of secretsToCreate) {
      await repos.forOrg(s.orgId).secrets.create({
        name: s.name,
        value: s.value,
        createdByUserId: s.userId,
      });
    }

    // Create admin user and call rotate-mek
    const { userId: adminUserId, orgId: adminOrgId } = await createUser(db, ADMIN_EMAIL);
    const session = await makeSession(app, adminUserId, adminOrgId);
    const { base64: newBase64, mek: newMek } = makeMek();

    const rotRes = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { newMekBase64: newBase64 },
    });
    expect(rotRes.statusCode).toBe(200);
    const rotBody = rotRes.json();
    // DEKs were created for 2 orgs (orgA + orgB from seedTwoOrgs) + admin org — at least 2
    expect(rotBody.rotated).toBeGreaterThanOrEqual(2);

    // Restart app with NEW mek — mirrors step 3 of the runbook
    await app.close();
    const savedMekBase64 = process.env.XCI_MASTER_KEY;
    process.env.XCI_MASTER_KEY = newBase64;
    app = await buildApp({ logLevel: 'warn' });

    // Verify all secrets decrypt correctly with the new MEK
    const newRepos = makeRepos(db, newMek);
    for (const s of secretsToCreate) {
      const plaintext = await newRepos.forOrg(s.orgId).secrets.resolveByName(s.name, s.userId);
      expect(plaintext).toBe(s.value);
    }

    // Restore env MEK so subsequent tests use the original key
    if (savedMekBase64 !== undefined) {
      process.env.XCI_MASTER_KEY = savedMekBase64;
    }
  });

  it('D-28: idempotency — second call with same newMekBase64 returns rotated=0', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    // Create a secret so there's a DEK to rotate
    const repos = makeRepos(db, getTestMek());
    await repos.forOrg(f.orgA.id).secrets.create({
      name: 'IDEM_SECRET',
      value: 'idempotent-value',
      createdByUserId: f.orgA.ownerUser.id,
    });

    const { userId, orgId } = await createUser(db, ADMIN_EMAIL);
    const session = await makeSession(app, userId, orgId);
    const { base64: newBase64 } = makeMek();

    // First call — should rotate at least 1 row
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { newMekBase64: newBase64 },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.rotated).toBeGreaterThanOrEqual(1);

    // Second call with same body — D-28 idempotency guard returns rotated=0
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { newMekBase64: newBase64 },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.rotated).toBe(0);
  });

  it('invalid base64 (43 chars, no padding) returns 400', async () => {
    const db = getTestDb();
    const { userId, orgId } = await createUser(db, ADMIN_EMAIL);
    const session = await makeSession(app, userId, orgId);

    // 43 chars — missing '=' padding → AJV minLength 44 rejects
    const invalidBase64 = randomBytes(32).toString('base64').slice(0, 43);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { newMekBase64: invalidBase64 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('wrong-pattern base64 (44 chars ending with ==) returns 400', async () => {
    const db = getTestDb();
    const { userId, orgId } = await createUser(db, ADMIN_EMAIL);
    const session = await makeSession(app, userId, orgId);

    // 30 bytes → 40-char base64 with '==' ending; prefix with 'AAAA' to reach 44 chars.
    // The result ends with '==' not '=' — fails AJV pattern ^[A-Za-z0-9+/]{43}=$
    const thirtyByteBase64 = randomBytes(30).toString('base64'); // 40 chars, ends with ==
    const wrongPattern = `AAAA${thirtyByteBase64}`; // 44 chars, ends with ==

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/rotate-mek',
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { newMekBase64: wrongPattern },
    });
    expect(res.statusCode).toBe(400);
  });
});
