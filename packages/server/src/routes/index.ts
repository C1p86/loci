import type { FastifyPluginAsync } from 'fastify';
import { registerAdminRoutes } from './admin/index.js';
import { registerAgentRoutes } from './agents/index.js';
import { registerAuthRoutes } from './auth/index.js';
import { registerInviteRoutes } from './invites/index.js';
import { registerOrgRoutes } from './orgs/index.js';
import { registerSecretsRoutes } from './secrets/index.js';
import { registerTaskRoutes } from './tasks/index.js';

export const registerRoutes: FastifyPluginAsync = async (fastify) => {
  // Healthcheck — no auth, no CSRF, no rate-limit override
  fastify.get('/healthz', async (_req, reply) => {
    return reply.send({ ok: true });
  });

  // Auth routes: signup, verify-email, login, logout, request-reset, reset, csrf
  await fastify.register(registerAuthRoutes, { prefix: '/auth' });

  // Org management routes: invites + member role changes
  await fastify.register(registerOrgRoutes, { prefix: '/orgs' });

  // Invite acceptance routes
  await fastify.register(registerInviteRoutes, { prefix: '/invites' });

  // Phase 8: Agent management REST routes (mounted under /orgs like invites)
  await fastify.register(registerAgentRoutes, { prefix: '/orgs' });

  // Phase 9: Task CRUD routes (mounted under /orgs — paths: /api/orgs/:orgId/tasks[/...])
  await fastify.register(registerTaskRoutes, { prefix: '/orgs' });

  // Phase 9: Secrets CRUD + audit-log routes (mounted under /orgs)
  // Paths: /api/orgs/:orgId/secrets[/...] and /api/orgs/:orgId/secret-audit-log
  await fastify.register(registerSecretsRoutes, { prefix: '/orgs' });

  // Phase 9 SEC-08: Admin routes — MEK rotation (platform-admin gated)
  // Final path: /api/admin/rotate-mek
  await fastify.register(registerAdminRoutes, { prefix: '/admin' });
};
