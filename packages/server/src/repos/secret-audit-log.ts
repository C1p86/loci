import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import { type NewSecretAuditLogEntry, secretAuditLog } from '../db/schema.js';

/**
 * D-29 / D-21: Org-scoped append-only audit log for secret operations.
 * All queries include eq(secretAuditLog.orgId, orgId) in their WHERE clause.
 * Never exported from repos/index.ts (D-01 discipline).
 */
export function makeSecretAuditLogRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * List audit log entries for this org, newest-first with pagination.
     * Limit is clamped to max 1000 (D-23).
     */
    async list({ limit = 100, offset = 0 }: { limit?: number; offset?: number } = {}) {
      const clampedLimit = Math.min(limit, 1000);
      return db
        .select()
        .from(secretAuditLog)
        .where(and(eq(secretAuditLog.orgId, orgId)))
        .orderBy(desc(secretAuditLog.createdAt))
        .limit(clampedLimit)
        .offset(offset);
    },
  };
}

export type SecretAuditLogRepo = ReturnType<typeof makeSecretAuditLogRepo>;

/**
 * Standalone helper for writing a single audit log entry within a caller-supplied
 * transaction (or plain db handle). Called by makeSecretsRepo inside its own transactions
 * to satisfy the D-22 same-transaction audit discipline.
 *
 * Accepts PostgresJsDatabase<any> so it works with both the plain db handle and
 * a Drizzle transaction handle (both satisfy the same query interface).
 */
export async function writeSecretAuditEntry(
  // biome-ignore lint/suspicious/noExplicitAny: accepts both db and tx handles
  tx: PostgresJsDatabase<any>,
  payload: {
    orgId: string;
    secretId: string | null;
    secretName: string;
    action: 'create' | 'update' | 'rotate' | 'delete' | 'resolve';
    actorUserId: string | null;
  },
): Promise<void> {
  const entry = {
    id: generateId('sal'),
    orgId: payload.orgId,
    secretId: payload.secretId ?? undefined,
    secretName: payload.secretName,
    action: payload.action,
    actorUserId: payload.actorUserId ?? undefined,
  } satisfies NewSecretAuditLogEntry;
  await tx.insert(secretAuditLog).values(entry);
}
