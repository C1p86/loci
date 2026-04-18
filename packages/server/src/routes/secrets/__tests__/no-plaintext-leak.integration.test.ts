// SEC-04 architectural invariant guard.
// Performs a full CRUD sequence and asserts NO response body ever contains:
//   - The plaintext secret value
//   - Base64 or hex encoding of the DB ciphertext
//   - Any key matching /value|ciphertext|iv|auth_?tag|dek|mek/i
//
// This is the CI-enforced end-to-end proof of the "no plaintext in response" invariant.

import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { secrets } from '../../../db/schema.js';
import { makeRepos } from '../../../repos/index.js';
import { getTestDb, resetDb, TEST_MEK } from '../../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../../test-utils/two-org-fixture.js';

type App = Awaited<ReturnType<typeof buildApp>>;

// Distinctive plaintext marker — not a real secret value, chosen to be unique enough
// that false positives are impossible.
const PLAINTEXT_MARKER = 'SECRET_PLAINTEXT_MARKER_7a3b1_xci_no_leak';

// Regex for forbidden key names anywhere in a response body object (recursive).
const FORBIDDEN_KEY_RE = /^(value|ciphertext|iv|auth_?tag|dek|mek)$/i;

/**
 * Recursively traverses an object and asserts no key matches the forbidden pattern.
 * Also asserts the stringified body does not contain the plaintext marker,
 * its base64, or its ciphertext encodings.
 */
function assertNoLeak(
  body: unknown,
  marker: string,
  ctBase64: string | null,
  ctHex: string | null,
  label: string,
): void {
  const json = JSON.stringify(body);

  if (json.includes(marker)) {
    throw new Error(`[${label}] LEAK: response body contains plaintext marker`);
  }
  if (ctBase64 && json.includes(ctBase64)) {
    throw new Error(`[${label}] LEAK: response body contains ciphertext (base64)`);
  }
  if (ctHex && json.includes(ctHex)) {
    throw new Error(`[${label}] LEAK: response body contains ciphertext (hex)`);
  }

  // Recursive key name check
  function checkKeys(obj: unknown, path: string): void {
    if (obj === null || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        checkKeys(obj[i], `${path}[${i}]`);
      }
      return;
    }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_RE.test(k)) {
        throw new Error(`[${label}] LEAK: forbidden key "${k}" found at ${path}.${k}`);
      }
      checkKeys(v, `${path}.${k}`);
    }
  }
  checkKeys(body, 'root');
}

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

describe('SEC-04: no-plaintext-leak invariant — full CRUD sequence', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb();
    // Use warn level — disableRequestLogging already suppresses req/res in test mode
    app = await buildApp({ logLevel: 'warn' });
  });
  afterEach(async () => app.close());

  it('No response body ever contains the plaintext marker, ciphertext, or forbidden key names', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    // ── Step 1: CREATE ──
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'LEAK_TEST_KEY', value: PLAINTEXT_MARKER },
    });
    expect(createRes.statusCode).toBe(201);
    const createBody = createRes.json();
    const secretId = createBody.id as string;

    // Read ciphertext from DB for comparison
    const dbRows = await db
      .select({ ciphertext: secrets.ciphertext })
      .from(secrets)
      .where(and(eq(secrets.orgId, f.orgA.id), eq(secrets.id, secretId)));
    // biome-ignore lint/style/noNonNullAssertion: row must exist after create
    const ct = Buffer.from(dbRows[0]!.ciphertext);
    const ctBase64 = ct.toString('base64');
    const ctHex = ct.toString('hex');

    // Check create response
    assertNoLeak(createBody, PLAINTEXT_MARKER, ctBase64, ctHex, 'POST /secrets');

    // ── Step 2: LIST ──
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid },
    });
    expect(listRes.statusCode).toBe(200);
    assertNoLeak(listRes.json(), PLAINTEXT_MARKER, ctBase64, ctHex, 'GET /secrets');

    // ── Step 3: UPDATE (get new ciphertext after) ──
    const updatedMarker = `${PLAINTEXT_MARKER}_v2`;
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { value: updatedMarker },
    });
    expect(patchRes.statusCode).toBe(200);
    assertNoLeak(patchRes.json(), PLAINTEXT_MARKER, ctBase64, ctHex, 'PATCH /secrets/:id');

    // Fetch updated ciphertext from DB
    const updatedRows = await db
      .select({ ciphertext: secrets.ciphertext })
      .from(secrets)
      .where(and(eq(secrets.orgId, f.orgA.id), eq(secrets.id, secretId)));
    // biome-ignore lint/style/noNonNullAssertion: row must exist after update
    const ct2 = Buffer.from(updatedRows[0]!.ciphertext);
    const ct2Base64 = ct2.toString('base64');
    const ct2Hex = ct2.toString('hex');
    // Also assert updated marker not leaked
    assertNoLeak(
      patchRes.json(),
      updatedMarker,
      ct2Base64,
      ct2Hex,
      'PATCH /secrets/:id (v2 check)',
    );

    // ── Step 4: AUDIT LOG ──
    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secret-audit-log`,
      cookies: { xci_sid: session.sid },
    });
    expect(auditRes.statusCode).toBe(200);
    assertNoLeak(auditRes.json(), PLAINTEXT_MARKER, ct2Base64, ct2Hex, 'GET /secret-audit-log');
    assertNoLeak(auditRes.json(), updatedMarker, ct2Base64, ct2Hex, 'GET /secret-audit-log (v2)');

    // ── Step 5: DELETE ──
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
    });
    expect(deleteRes.statusCode).toBe(204);
    // 204 has no body — just verify status and no payload
    expect(deleteRes.payload).toBe('');
  });

  it('List response contains no forbidden key names even with multiple secrets', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    // Create several secrets
    const names = ['KEY_ALPHA', 'KEY_BETA', 'KEY_GAMMA'];
    for (const name of names) {
      await app.inject({
        method: 'POST',
        url: `/api/orgs/${f.orgA.id}/secrets`,
        cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
        headers: { 'x-csrf-token': session.csrfToken },
        payload: { name, value: `${PLAINTEXT_MARKER}_${name}` },
      });
    }

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid },
    });
    expect(listRes.statusCode).toBe(200);
    const rows = listRes.json();

    // Check each row — no forbidden keys, no plaintext marker
    for (const row of rows as Array<Record<string, unknown>>) {
      for (const [k] of Object.entries(row)) {
        expect(FORBIDDEN_KEY_RE.test(k), `Key "${k}" should not appear in list response`).toBe(
          false,
        );
      }
      const rowStr = JSON.stringify(row);
      for (const name of names) {
        expect(rowStr.includes(`${PLAINTEXT_MARKER}_${name}`)).toBe(false);
      }
    }
  });

  it('Audit log response after delete contains tombstone with no plaintext', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const session = await makeSession(app, f.orgA.ownerUser.id, f.orgA.id);

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/orgs/${f.orgA.id}/secrets`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
      payload: { name: 'TOMBSTONE_KEY', value: PLAINTEXT_MARKER },
    });
    const secretId = createRes.json().id as string;

    await app.inject({
      method: 'DELETE',
      url: `/api/orgs/${f.orgA.id}/secrets/${secretId}`,
      cookies: { xci_sid: session.sid, _csrf: session.csrfCookie },
      headers: { 'x-csrf-token': session.csrfToken },
    });

    const auditRes = await app.inject({
      method: 'GET',
      url: `/api/orgs/${f.orgA.id}/secret-audit-log`,
      cookies: { xci_sid: session.sid },
    });
    expect(auditRes.statusCode).toBe(200);

    const body = auditRes.json() as { entries: Array<Record<string, unknown>> };
    // Find the delete entry
    const deleteEntry = body.entries.find((e) => e.action === 'delete');
    expect(deleteEntry).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    const entry = deleteEntry!;

    // Tombstone should preserve name but NOT leak plaintext value
    expect(entry.secretName).toBe('TOMBSTONE_KEY');
    expect(entry.secretId).toBeNull();
    expect(JSON.stringify(entry).includes(PLAINTEXT_MARKER)).toBe(false);

    // No forbidden key names in entry
    for (const [k] of Object.entries(entry)) {
      expect(FORBIDDEN_KEY_RE.test(k), `Forbidden key "${k}" in audit tombstone`).toBe(false);
    }
  });
});
