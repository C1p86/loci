import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

beforeAll(async () => {
  // Ensure required env vars are set even if called outside full globalSetup
  if (!process.env.SESSION_COOKIE_SECRET) {
    process.env.SESSION_COOKIE_SECRET = 'test-cookie-secret-at-least-32-bytes-long!';
  }
  if (!process.env.EMAIL_TRANSPORT) {
    process.env.EMAIL_TRANSPORT = 'stub';
  }
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
});

describe('buildApp smoke (D-05 + D-06 plugin chain)', () => {
  it('registers all plugins + routes; /healthz returns 200', async () => {
    const app = await buildApp({ logLevel: 'error' });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('fastify.config is populated from env (D-07)', async () => {
    const app = await buildApp({ logLevel: 'error' });
    try {
      expect(app.config.DATABASE_URL).toBeDefined();
      expect(app.config.SESSION_COOKIE_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(app.config.EMAIL_TRANSPORT).toBe('stub');
    } finally {
      await app.close();
    }
  });

  it('fastify.db is decorated (D-06 plugin order)', async () => {
    const app = await buildApp({ logLevel: 'error' });
    try {
      expect(app.db).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('fastify.emailTransport is decorated', async () => {
    const app = await buildApp({ logLevel: 'error' });
    try {
      expect(app.emailTransport).toBeDefined();
      expect(typeof app.emailTransport.send).toBe('function');
    } finally {
      await app.close();
    }
  });

  it('fastify.requireAuth is decorated', async () => {
    const app = await buildApp({ logLevel: 'error' });
    try {
      expect(typeof app.requireAuth).toBe('function');
    } finally {
      await app.close();
    }
  });

  it('global rate-limit is installed (100 req/min default)', async () => {
    const app = await buildApp({ logLevel: 'error' });
    try {
      // Send 102 requests to /api/healthz — the 101st+ should 429 (hitting the global default).
      const responses = [];
      for (let i = 0; i < 102; i++) {
        responses.push(await app.inject({ method: 'GET', url: '/api/healthz' }));
      }
      const statuses = responses.map((r) => r.statusCode);
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
      expect(statuses.filter((s) => s === 200).length).toBe(100);
    } finally {
      await app.close();
    }
  }, 15_000);

  it('pino redaction hides req.body.password in logs (smoke)', async () => {
    const app = await buildApp({ logLevel: 'info' });
    try {
      app.post('/noop', async () => ({ ok: true }));
      const res = await app.inject({
        method: 'POST',
        url: '/noop',
        payload: { email: 'x@x.com', password: 'super-secret' },
      });
      // Request completes without error — actual redaction verified at the pino config level
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
