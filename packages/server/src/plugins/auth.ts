import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { orgMembers, orgs, sessions } from '../db/schema.js';
import { SessionRequiredError } from '../errors.js';
import { makeRepos } from '../repos/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: string; email: string; emailVerifiedAt: Date | null } | null;
    // Phase 13: name + slug added for /api/auth/me (D-34)
    org: { id: string; name: string; slug: string; role: 'owner' | 'member' | 'viewer' } | null;
    session: { id: string; userId: string; expiresAt: Date } | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

interface AuthPluginOpts {
  clock?: () => Date;
}

const authPlugin: FastifyPluginAsync<AuthPluginOpts> = async (fastify, opts) => {
  const now = () => opts.clock?.() ?? new Date();

  fastify.decorateRequest('user', null);
  fastify.decorateRequest('org', null);
  fastify.decorateRequest('session', null);

  fastify.addHook('onRequest', async (req) => {
    const sid = req.cookies?.xci_sid;
    if (!sid) return;
    const db = fastify.db;
    const repos = makeRepos(db, fastify.mek);

    // Look up session cross-org (we don't know orgId yet — auth plugin discovers it)
    const sessionRows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sid), isNull(sessions.revokedAt), gt(sessions.expiresAt, now())))
      .limit(1);

    const sessionRow = sessionRows[0];
    if (!sessionRow) return; // no valid session — decorators remain null

    // Look up user via admin repo (cross-org lookup)
    const userRows = await repos.admin.findUserById(sessionRow.userId);
    const userRow = userRows[0];
    if (!userRow) return;

    req.session = {
      id: sessionRow.id,
      userId: sessionRow.userId,
      expiresAt: sessionRow.expiresAt,
    };
    req.user = {
      id: userRow.id,
      email: userRow.email,
      emailVerifiedAt: userRow.emailVerifiedAt,
    };

    // Determine active org: prefer session.activeOrgId if user is still a member; else fallback to first membership
    // Phase 13 D-34: load org name+slug for /api/auth/me hydration
    if (sessionRow.activeOrgId) {
      const memRows = await db
        .select({ role: orgMembers.role, name: orgs.name, slug: orgs.slug })
        .from(orgMembers)
        .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
        .where(
          and(
            eq(orgMembers.orgId, sessionRow.activeOrgId),
            eq(orgMembers.userId, sessionRow.userId),
          ),
        )
        .limit(1);
      const mem = memRows[0];
      if (mem) {
        req.org = { id: sessionRow.activeOrgId, name: mem.name, slug: mem.slug, role: mem.role };
      }
    }
    if (!req.org) {
      const firstRows = await db
        .select({ orgId: orgMembers.orgId, role: orgMembers.role, name: orgs.name, slug: orgs.slug })
        .from(orgMembers)
        .innerJoin(orgs, eq(orgs.id, orgMembers.orgId))
        .where(eq(orgMembers.userId, sessionRow.userId))
        .limit(1);
      const first = firstRows[0];
      if (first) {
        req.org = { id: first.orgId, name: first.name, slug: first.slug, role: first.role };
      }
    }

    // Sliding expiry with 1h write-throttle (D-13 + Pitfall 6).
    // Single UPDATE with predicate — atomic, no race to resurrect a revoked session.
    await db.execute(sql`
      UPDATE sessions
      SET last_seen_at = now(),
          expires_at = LEAST(
            now() + interval '14 days',
            created_at + interval '30 days'
          )
      WHERE id = ${sid}
        AND revoked_at IS NULL
        AND expires_at > now()
        AND last_seen_at < now() - interval '1 hour'
    `);
  });

  fastify.decorate('requireAuth', async (req: FastifyRequest) => {
    if (!req.session) throw new SessionRequiredError();
  });
};

export default fp(authPlugin, {
  name: 'auth-plugin',
  dependencies: ['db-plugin', '@fastify/cookie'],
});
