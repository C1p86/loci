// Phase 9 SEC-08 / D-24 / D-25:
// POST /api/admin/rotate-mek — re-wraps all org DEKs under a new MEK atomically.
// Three gates: requireAuth (session) + requirePlatformAdmin (email match) + CSRF.
// Returns {rotated: N, mekVersion: V} where rotated is the number of rows updated.
// Does NOT hot-swap fastify.mek — operator must restart server with new XCI_MASTER_KEY.
// See packages/server/README.md §MEK Rotation Runbook for operator steps.
import type { FastifyPluginAsync } from 'fastify';
import { MekRotationError } from '../../errors.js';
import { requirePlatformAdmin } from '../../plugins/require-platform-admin.js';
import { makeRepos } from '../../repos/index.js';

interface RotateMekBody {
  newMekBase64: string;
}

export const rotateMekRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Body: RotateMekBody }>(
    '/rotate-mek',
    {
      onRequest: [fastify.csrfProtection],
      preHandler: [fastify.requireAuth, requirePlatformAdmin],
      schema: {
        body: {
          type: 'object',
          required: ['newMekBase64'],
          additionalProperties: false,
          properties: {
            newMekBase64: {
              type: 'string',
              // AJV enforces 44-char base64 string with exactly one trailing '='
              minLength: 44,
              maxLength: 44,
              pattern: '^[A-Za-z0-9+/]{43}=$',
            },
          },
        },
      },
    },
    async (req, reply) => {
      const newMek = Buffer.from(req.body.newMekBase64, 'base64');
      // Secondary validation — AJV pattern allows some edge cases; be explicit.
      if (newMek.length !== 32) {
        throw new MekRotationError('new MEK must decode to exactly 32 bytes');
      }
      const oldMek = fastify.mek;
      const repos = makeRepos(fastify.db, fastify.mek);
      const result = await repos.admin.rotateMek(oldMek, newMek);
      return reply.status(200).send(result);
    },
  );
};
