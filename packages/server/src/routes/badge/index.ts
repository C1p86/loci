// Phase 13 D-29/D-32/D-33/BADGE-01..04: Public badge endpoint
// GET /badge/:orgSlug/:taskSlug.svg
// - Unauthenticated (no requireAuth — badges are embeddable in public READMEs)
// - Rate-limited 120/min per IP (D-32)
// - Returns grey 'unknown' SVG for non-existent org/task OR expose_badge=false (BADGE-03/04)
// - Cache-Control: public, max-age=30 (BADGE-02)
// - Mounted at root (NO /api prefix) — see app.ts

import type { FastifyPluginAsync } from 'fastify';
import { makeRepos } from '../../repos/index.js';
import { type BadgeState, renderBadgeSvg } from './svg.js';

export const registerBadgeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { orgSlug: string; taskSlug: string } }>(
    '/badge/:orgSlug/:taskSlug.svg',
    {
      config: {
        rateLimit: { max: 120, timeWindow: '1 minute' }, // D-32, T-13-01-02
      },
    },
    async (req, reply) => {
      const { orgSlug, taskSlug } = req.params;
      const repos = makeRepos(fastify.db, fastify.mek);

      const state: BadgeState = await resolveBadgeState(
        repos.admin,
        orgSlug,
        taskSlug,
      );
      const svg = renderBadgeSvg(state);

      // T-13-01: Security headers — BADGE-02 + MIME sniff prevention
      reply
        .header('Content-Type', 'image/svg+xml; charset=utf-8')
        .header('Cache-Control', 'public, max-age=30') // BADGE-02
        .header('X-Content-Type-Options', 'nosniff');

      return reply.send(svg);
    },
  );
};

async function resolveBadgeState(
  adminRepo: ReturnType<typeof makeRepos>['admin'],
  orgSlug: string,
  taskSlug: string,
): Promise<BadgeState> {
  const org = await adminRepo.findOrgBySlug(orgSlug);
  if (!org) return 'unknown'; // BADGE-03: unknown for non-existent org (T-13-01-01)

  const task = await adminRepo.findTaskByOrgAndSlug(org.id, taskSlug);
  if (!task || !task.exposeBadge) return 'unknown'; // BADGE-03/04: unknown for missing task or expose_badge=false

  const run = await adminRepo.findLastTerminalRun(task.id);
  if (!run) return 'unknown'; // no terminal run yet

  return run.state === 'succeeded' ? 'passing' : 'failing';
}
