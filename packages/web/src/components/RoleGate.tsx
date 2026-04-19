import type { ReactNode } from 'react';
import type { Role } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';
import { DisabledWithTooltip } from './DisabledWithTooltip.js';

const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, owner: 2 };

interface RoleGateProps {
  /** Minimum role required to interact with children */
  role: Role;
  /** The mutation control to render */
  children: ReactNode;
  /** Optional custom fallback (overrides default disabled-with-tooltip) */
  fallback?: ReactNode;
  /** Tooltip text shown when role is insufficient */
  tooltip?: string;
}

/**
 * Renders children if current user role >= required role.
 * Otherwise renders children in a disabled+tooltip wrapper (NEVER null — D-11).
 */
export function RoleGate({ role, children, fallback, tooltip }: RoleGateProps) {
  const currentRole = useAuthStore((s) => s.org?.role ?? 'viewer');
  const allowed = ROLE_RANK[currentRole] >= ROLE_RANK[role];

  if (allowed) return <>{children}</>;
  if (fallback) return <>{fallback}</>;

  const reason =
    tooltip ?? `Your role (${currentRole}) cannot perform this action. Requires ${role} or higher.`;
  return <DisabledWithTooltip reason={reason}>{children}</DisabledWithTooltip>;
}
