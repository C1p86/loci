// Barrel for webhook-token management routes (D-29).
// Registered under /orgs prefix in routes/index.ts.

import type { FastifyPluginAsync } from 'fastify';
import { createWebhookTokenRoute } from './create.js';
import { deleteWebhookTokenRoute } from './delete.js';
import { listWebhookTokensRoute } from './list.js';
import { revokeWebhookTokenRoute } from './revoke.js';

export const registerWebhookTokenRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(createWebhookTokenRoute);
  await fastify.register(listWebhookTokensRoute);
  await fastify.register(revokeWebhookTokenRoute);
  await fastify.register(deleteWebhookTokenRoute);
};
