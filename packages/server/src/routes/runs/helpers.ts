// packages/server/src/routes/runs/helpers.ts
//
// Shared auth helpers for run routes (Plan 10-04).
// These are the Member-inclusive variants of the Phase 7 requireOwnerAndOrgMatch helper.

import type { FastifyRequest } from 'fastify';
import {
  OrgMembershipRequiredError,
  RoleInsufficientError,
  SessionRequiredError,
} from '../../errors.js';

/**
 * Require that the caller is at least a Member of the org in the URL.
 * Rejects Viewers.
 * Used for mutating endpoints: POST /runs (trigger), POST /runs/:runId/cancel (for owners/triggerers).
 */
export function requireMemberOrAbove(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role === 'viewer') throw new RoleInsufficientError('member');
}

/**
 * Require that the caller is any member of the org in the URL (owner/member/viewer).
 * Used for read-only endpoints: GET /runs, GET /runs/:runId, GET /usage.
 */
export function requireAnyMember(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
}
