// POST /api/orgs/:orgId/secrets — Owner/Member + CSRF.
// D-19: body {name, value}; returns {id, name, createdAt} — NEVER echoes value, ciphertext, dek, mek.
// SEC-04 architectural invariant: no response body field may be named value/ciphertext/iv/auth_tag/dek/mek.

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  OrgMembershipRequiredError,
  RoleInsufficientError,
  SessionRequiredError,
} from '../../errors.js';
import { makeRepos } from '../../repos/index.js';

export function requireOwnerOrMemberAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner' && req.org.role !== 'member')
    throw new RoleInsufficientError('member');
}

export function requireOwnerAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner') throw new RoleInsufficientError('owner');
}

interface CreateSecretBody {
  name: string;
  value: string;
}

export const createSecretRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { orgId: string }; Body: CreateSecretBody }>(
    '/:orgId/secrets',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth],
      schema: {
        body: {
          type: 'object',
          required: ['name', 'value'],
          additionalProperties: false,
          properties: {
            // D-19 + RESEARCH FA-12: name must match ^[A-Z][A-Z0-9_]*$ (upper-snake env-var convention)
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 255,
              pattern: '^[A-Z][A-Z0-9_]*$',
            },
            // RESEARCH Open Q #9: 64KB cap prevents abuse; AES-256-GCM handles arbitrary bytes
            value: { type: 'string', minLength: 1, maxLength: 65536 },
          },
        },
      },
    },
    async (req, reply) => {
      requireOwnerOrMemberAndOrgMatch(req);
      const orgId = req.org?.id;
      const userId = req.user?.id;
      if (!orgId || !userId) throw new SessionRequiredError();

      const repos = makeRepos(fastify.db, fastify.mek);

      // The repo handles get-or-create org DEK, encryption, and audit log in one transaction (D-22).
      // Route passes value straight to repo — no route-level crypto (SEC-01..03 boundary).
      const created = await repos.forOrg(orgId).secrets.create({
        name: req.body.name,
        value: req.body.value,
        createdByUserId: userId,
      });

      // SEC-04: return ONLY {id, name, createdAt} — do NOT spread req.body (contains value).
      return reply.status(201).send({
        id: created.id,
        name: created.name,
        createdAt: new Date().toISOString(),
      });
    },
  );
};
