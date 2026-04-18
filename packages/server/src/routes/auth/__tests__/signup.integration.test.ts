import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { orgPlans, orgs, users } from '../../../db/schema.js';
import { createTransport, type EmailTransport } from '../../../email/transport.js';
import { getTestDb, resetDb } from '../../../test-utils/db-harness.js';

function makeStub(): EmailTransport {
  return createTransport('stub', { logger: { info: () => {} } });
}

describe('POST /api/auth/signup (AUTH-01 + AUTH-07 + AUTH-11)', () => {
  beforeEach(async () => resetDb());

  it('happy path: creates user+org+owner+Free plan, sends verification email, returns 201', async () => {
    const stub = makeStub();
    const app = await buildApp({ logLevel: 'error', emailTransport: stub });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'alice@example.com', password: 'at-least-twelve-chars' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.userId).toMatch(/^xci_usr_/);
    expect(body.orgId).toMatch(/^xci_org_/);

    // Database state
    const db = getTestDb();
    expect((await db.select().from(users)).length).toBe(1);
    expect((await db.select().from(orgs)).length).toBe(1);
    const plans = await db.select().from(orgPlans);
    expect(plans[0]?.planName).toBe('free');
    expect(plans[0]?.maxAgents).toBe(5);

    // Email sent — AUTH-11 pluggable transport
    expect(stub.captured).toHaveLength(1);
    expect(stub.captured?.[0]?.to).toBe('alice@example.com');
    expect(stub.captured?.[0]?.subject).toMatch(/verify/i);
    expect(stub.captured?.[0]?.text).toContain('verify');

    // Password NEVER appears in the sent email body
    const emailJson = JSON.stringify(stub.captured);
    expect(emailJson).not.toContain('at-least-twelve-chars');

    await app.close();
  });

  it('duplicate email → 409 CONFLICT_EMAIL_TAKEN (case-insensitive)', async () => {
    const app = await buildApp({ logLevel: 'error', emailTransport: makeStub() });
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'x@x.com', password: 'long-enough-1234' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'X@X.com', password: 'another-long-password' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT_EMAIL_TAKEN');
    await app.close();
  });

  it('short password → 400 VAL_SCHEMA (D-32 min 12)', async () => {
    const app = await buildApp({ logLevel: 'error', emailTransport: makeStub() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'y@y.com', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VAL_SCHEMA');
    await app.close();
  });

  it('invalid email format → 400', async () => {
    const app = await buildApp({ logLevel: 'error', emailTransport: makeStub() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'not-an-email', password: 'long-enough-123456' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('NO CSRF required (Pitfall 1) — signup succeeds without csrf cookie', async () => {
    const app = await buildApp({ logLevel: 'error', emailTransport: makeStub() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'csrf@x.com', password: 'long-enough-password' },
      // No _csrf cookie, no x-csrf-token header
    });
    expect(res.statusCode).toBe(201);
    await app.close();
  });
});
