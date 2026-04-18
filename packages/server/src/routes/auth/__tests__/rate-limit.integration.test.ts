import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { createTransport } from '../../../email/transport.js';
import { resetDb } from '../../../test-utils/db-harness.js';

describe('rate limits (AUTH-06 + D-35)', () => {
  beforeEach(async () => resetDb());

  it('signup 6th from same IP within 1h → 429', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const results: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: `u${i}@example.com`, password: 'long-enough-password' },
      });
      results.push(res.statusCode);
    }
    // First 5 succeed (201), 6th rate-limited (429). D-35: signup 5/h per IP.
    expect(results.filter((s) => s === 201).length).toBeGreaterThanOrEqual(5);
    expect(results[5]).toBe(429);
    await app.close();
  });

  it('login 11th with same email+IP → 429', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const results: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'hot@example.com', password: 'wrong-password-here' },
      });
      results.push(res.statusCode);
    }
    // First 10 are 401, 11th is 429
    expect(results.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(results[10]).toBe(429);
    await app.close();
  });

  it('request-reset 4th with same IP+email → 429', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/request-reset',
        payload: { email: 'r@example.com' },
      });
      results.push(res.statusCode);
    }
    expect(results.slice(0, 3).every((s) => s === 204)).toBe(true);
    expect(results[3]).toBe(429);
    await app.close();
  });
});
