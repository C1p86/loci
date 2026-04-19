/**
 * packages/server/src/routes/hooks/index.ts
 * Plan 12-03 Task 1 — webhook ingress route plugin.
 *
 * Webhook ingress routes. Mounted OUTSIDE /api prefix (matches /ws/agent pattern — these are
 * external machine senders, no session cookie, no CSRF).
 *
 * Security layers:
 *   1. @fastify/rate-limit: 60/min/IP per D-07 (override global 100/min default)
 *   2. contentTypeParser captures req.rawBody:Buffer BEFORE JSON.parse — required for HMAC verify
 *   3. URL token → adminRepo.findWebhookTokenByPlaintext resolves org (no session)
 *   4. plugin.verify then enforces cryptographic auth (HMAC or header token)
 */

import type { FastifyPluginAsync } from 'fastify';
import { handleIncomingWebhook } from './shared-handler.js';

export const registerHookRoutes: FastifyPluginAsync = async (fastify) => {
  // Capture raw body BEFORE JSON parsing — HMAC verify needs exact byte sequence the sender signed.
  // Fastify 5: default content-type parser for JSON replaces raw bytes with parsed object.
  // We add a custom parser on the JSON content-type scoped to /hooks routes via encapsulation.
  // SCOPE: addContentTypeParser inside registerHookRoutes without fastify-plugin wrapper applies
  // ONLY to routes registered in the same encapsulated scope — exactly what we want.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const buf = body as Buffer;
        // Attach raw bytes for downstream HMAC verify (github.ts plugin reads req.rawBody)
        (req as unknown as { rawBody: Buffer }).rawBody = buf;
        const json = buf.length === 0 ? {} : JSON.parse(buf.toString('utf8'));
        done(null, json);
      } catch (err) {
        // Parse failures bubble to the route handler; the handler catches and routes to DLQ.
        done(err as Error, undefined);
      }
    },
  );

  fastify.post<{ Params: { pluginName: string; orgToken: string } }>(
    '/:pluginName/:orgToken',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        },
      },
    },
    handleIncomingWebhook,
  );
};
