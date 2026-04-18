// Barrel: registers all 5 Secret CRUD routes + audit-log route.
// Mounted with { prefix: '/orgs' } by registerRoutes so paths become:
//   GET    /api/orgs/:orgId/secrets
//   POST   /api/orgs/:orgId/secrets
//   PATCH  /api/orgs/:orgId/secrets/:secretId
//   DELETE /api/orgs/:orgId/secrets/:secretId
//   GET    /api/orgs/:orgId/secret-audit-log

import type { FastifyPluginAsync } from 'fastify';
import { auditLogRoute } from './audit-log.js';
import { createSecretRoute } from './create.js';
import { deleteSecretRoute } from './delete.js';
import { listSecretsRoute } from './list.js';
import { updateSecretRoute } from './update.js';

export const registerSecretsRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(listSecretsRoute);
  await fastify.register(createSecretRoute);
  await fastify.register(updateSecretRoute);
  await fastify.register(deleteSecretRoute);
  await fastify.register(auditLogRoute);
};
