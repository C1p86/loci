// packages/server/src/__tests__/static-serving.integration.test.ts
// PKG-05 / D-04 / D-05: @fastify/static conditional registration integration tests.
// Uses fastify inject() — cross-platform safe, no real server bind needed.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures/web-dist');

// ------------------------------------------------------------------
// Suite A: Static serving ENABLED (WEB_STATIC_ROOT set)
// ------------------------------------------------------------------
describe('static serving — WEB_STATIC_ROOT enabled', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const savedRoot = process.env.WEB_STATIC_ROOT;

  beforeAll(async () => {
    process.env.WEB_STATIC_ROOT = FIXTURE_DIR;
    app = await buildApp({ logLevel: 'error' });
  });

  afterAll(async () => {
    await app?.close();
    if (savedRoot === undefined) {
      delete process.env.WEB_STATIC_ROOT;
    } else {
      process.env.WEB_STATIC_ROOT = savedRoot;
    }
  });

  // Test 1: GET / returns index.html
  it('GET / returns 200 text/html with fixture content', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('XCI SPA');
  });

  // Test 2: Static asset served with JS MIME type
  it('GET /assets/app.js returns 200 with javascript MIME', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    // application/javascript or text/javascript both accepted
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body).toContain("console.log('xci')");
  });

  // Test 3: SPA fallback for unknown client-side route
  it('GET /agents returns 200 text/html = index.html (SPA fallback)', async () => {
    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('XCI SPA');
  });

  // Test 4: API routes take precedence over static fallback — 404 for unknown API routes
  it('GET /api/nonexistent returns 404 (API routes take precedence)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  // Test 5: /api/healthz returns { ok: true } (API route, not static file)
  it('GET /api/healthz returns 200 JSON (API, not static)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  // Test 6 (part of Test 5 clarification): /healthz at root is NOT the healthcheck route
  // (actual healthcheck is under /api prefix); root /healthz should serve index.html via SPA fallback
  it('GET /healthz (root, no /api) is served by SPA fallback or 404 — NOT the healthcheck JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    // Either served as SPA fallback (200 html) or 404 — but NOT the {ok:true} JSON
    const isHtml = res.headers['content-type']?.toString().includes('text/html');
    const isSpaFallback = res.statusCode === 200 && isHtml;
    const isNotFound = res.statusCode === 404;
    expect(isSpaFallback || isNotFound).toBe(true);
    // Crucially: it must NOT be the API healthcheck response
    if (res.statusCode === 200) {
      expect(res.body).not.toContain('"ok":true');
    }
  });
});

// ------------------------------------------------------------------
// Suite B: Static serving DISABLED (WEB_STATIC_ROOT not set)
// ------------------------------------------------------------------
describe('static serving — WEB_STATIC_ROOT disabled', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const savedRoot = process.env.WEB_STATIC_ROOT;

  beforeAll(async () => {
    delete process.env.WEB_STATIC_ROOT;
    app = await buildApp({ logLevel: 'error' });
  });

  afterAll(async () => {
    await app?.close();
    if (savedRoot !== undefined) {
      process.env.WEB_STATIC_ROOT = savedRoot;
    }
  });

  // Test 6 (plan): when WEB_STATIC_ROOT is unset, GET / returns 404
  it('GET / returns 404 when WEB_STATIC_ROOT is unset (static not registered)', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
  });

  // API still works without static serving
  it('GET /api/healthz still returns 200 JSON when static serving is disabled', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
