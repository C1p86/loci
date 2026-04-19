// Phase 9 D-24: platform admin gate.
// Single trusted operator identified by PLATFORM_ADMIN_EMAIL env var.
// Per-org Owners/Members cannot reach any route guarded by this function.
// Case-insensitive compare — both sides lowercased before comparison.
import type { FastifyRequest } from 'fastify';
import { PlatformAdminRequiredError, SessionRequiredError } from '../errors.js';

export async function requirePlatformAdmin(req: FastifyRequest): Promise<void> {
  if (!req.user) throw new SessionRequiredError();
  const configured = req.server.config.PLATFORM_ADMIN_EMAIL.toLowerCase();
  if (req.user.email.toLowerCase() !== configured) {
    throw new PlatformAdminRequiredError();
  }
}
