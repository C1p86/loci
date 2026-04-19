// GET /api/auth/me — returns the authenticated user's session context.
// D-34: Used by the SPA root loader to hydrate auth state (user, org, plan).
// T-13-01-04: auth plugin guarantees session before this handler runs.

import type { FastifyPluginAsync } from 'fastify';
import { SessionRequiredError } from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

export const registerAuthMeRoute: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/me',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        response: {
          200: {
            type: 'object',
            required: ['ok', 'user', 'org', 'plan'],
            properties: {
              ok: { type: 'boolean' },
              user: {
                type: 'object',
                required: ['id', 'email'],
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                },
              },
              org: {
                type: 'object',
                required: ['id', 'name', 'slug', 'role'],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  role: { type: 'string', enum: ['owner', 'member', 'viewer'] },
                },
              },
              plan: {
                type: 'object',
                required: ['planName', 'maxAgents', 'maxConcurrentTasks', 'logRetentionDays'],
                properties: {
                  planName: { type: 'string' },
                  maxAgents: { type: 'integer' },
                  maxConcurrentTasks: { type: 'integer' },
                  logRetentionDays: { type: 'integer' },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!req.user || !req.org) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);
      const plan = await repos.admin.getOrgPlan(req.org.id);

      // Org plan must exist (created at signup — D-37 invariant).
      if (!plan) throw new SessionRequiredError();

      return reply.send({
        ok: true,
        user: { id: req.user.id, email: req.user.email },
        org: { id: req.org.id, name: req.org.name, slug: req.org.slug, role: req.org.role },
        plan: {
          planName: plan.planName,
          maxAgents: plan.maxAgents,
          maxConcurrentTasks: plan.maxConcurrentTasks,
          logRetentionDays: plan.logRetentionDays,
        },
      });
    },
  );
};
