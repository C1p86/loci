// packages/server/src/repos/webhook-deliveries.ts
// D-04 auto-discovery: covered by webhook-deliveries.isolation.test.ts.
// Phase 12 D-22: org-scoped idempotency repo for webhook_deliveries.
// Unique index on (plugin_name, delivery_id) enforces dedup at DB level.

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import { type NewWebhookDelivery, webhookDeliveries } from '../db/schema.js';

/**
 * D-22: Org-scoped repo for webhook_deliveries (idempotency table).
 * recordDelivery uses onConflictDoNothing; caller inspects `inserted` flag to detect duplicates.
 * Note: unique index is on (plugin_name, delivery_id) globally — not per-org.
 * GitHub delivery IDs are globally unique UUIDs so cross-org collision is astronomically unlikely.
 */
export function makeWebhookDeliveriesRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /**
     * Attempt to record a new delivery.
     * Uses INSERT … ON CONFLICT DO NOTHING RETURNING to detect duplicates atomically.
     * D-22: unique index on (plugin_name, delivery_id) fires on duplicate.
     *
     * Returns { inserted: true, id } on success.
     * Returns { inserted: false, id: null } on duplicate (no exception thrown).
     */
    async recordDelivery(params: {
      pluginName: 'github' | 'perforce';
      deliveryId: string;
    }): Promise<{ inserted: boolean; id: string | null }> {
      const id = generateId('whd');
      const payload = {
        id,
        orgId,
        pluginName: params.pluginName,
        deliveryId: params.deliveryId,
      } satisfies NewWebhookDelivery;

      const rows = await db
        .insert(webhookDeliveries)
        .values(payload)
        .onConflictDoNothing({
          target: [webhookDeliveries.pluginName, webhookDeliveries.deliveryId],
        })
        .returning({ id: webhookDeliveries.id });

      // Drizzle returns empty array when conflict was suppressed (pitfall noted in plan).
      const inserted = rows[0];
      if (inserted !== undefined) {
        return { inserted: true, id: inserted.id };
      }
      return { inserted: false, id: null };
    },

    /**
     * Check whether a delivery was already recorded, scoped to this org.
     * Used by tests; route handlers should prefer recordDelivery's inserted flag.
     */
    async isDuplicate(pluginName: 'github' | 'perforce', deliveryId: string): Promise<boolean> {
      const rows = await db
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(
          and(
            eq(webhookDeliveries.orgId, orgId),
            eq(webhookDeliveries.pluginName, pluginName),
            eq(webhookDeliveries.deliveryId, deliveryId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}

export type WebhookDeliveriesRepo = ReturnType<typeof makeWebhookDeliveriesRepo>;
