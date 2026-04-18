import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { createTransport } from '../../../email/transport.js';
import { resetDb } from '../../../test-utils/db-harness.js';

describe('GET /api/auth/csrf + CSRF enforcement', () => {
  beforeEach(async () => resetDb());

  it('returns {csrfToken} + sets _csrf cookie', async () => {
    const app = await buildApp({
      logLevel: 'error',
      emailTransport: createTransport('stub', { logger: { info: () => {} } }),
    });
    const res = await app.inject({ method: 'GET', url: '/api/auth/csrf' });
    expect(res.statusCode).toBe(200);
    expect(res.json().csrfToken).toMatch(/.+/);
    expect((res.headers['set-cookie'] as string | string[]).toString()).toMatch(/_csrf=/);
    await app.close();
  });
});
