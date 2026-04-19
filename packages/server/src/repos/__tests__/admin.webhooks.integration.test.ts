// Integration tests for adminRepo webhook helpers (Phase 12 D-06 / D-22).
// Tests: findWebhookTokenByPlaintext (hit, miss, revoked) + cleanupDeliveries.
// Requires testcontainer Postgres — included in vitest.integration.config.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeAdminRepo } from '../admin.js';
import { makeWebhookDeliveriesRepo } from '../webhook-deliveries.js';
import { makeWebhookTokensRepo } from '../webhook-tokens.js';

describe('adminRepo webhook helpers (Phase 12)', () => {
  beforeEach(async () => resetDb());

  describe('findWebhookTokenByPlaintext', () => {
    it('returns { orgId, tokenId, pluginName } for a valid active token', async () => {
      const db = getTestDb();
      const mek = getTestMek();
      const f = await seedTwoOrgs(db);
      const admin = makeAdminRepo(db);

      const tokenRepo = makeWebhookTokensRepo(db, f.orgA.id, mek);
      const { id, plaintext } = await tokenRepo.create({
        pluginName: 'github',
        createdByUserId: f.orgA.ownerUser.id,
      });

      const result = await admin.findWebhookTokenByPlaintext(plaintext);
      expect(result).toBeDefined();
      expect(result?.orgId).toBe(f.orgA.id);
      expect(result?.tokenId).toBe(id);
      expect(result?.pluginName).toBe('github');
    });

    it('returns undefined for an unknown plaintext', async () => {
      const db = getTestDb();
      const mek = getTestMek();
      const admin = makeAdminRepo(db);
      await seedTwoOrgs(db);

      const result = await admin.findWebhookTokenByPlaintext('totally-unknown-plaintext-token');
      expect(result).toBeUndefined();
    });

    it('returns undefined for a revoked token (revoked_at filter)', async () => {
      const db = getTestDb();
      const mek = getTestMek();
      const f = await seedTwoOrgs(db);
      const admin = makeAdminRepo(db);

      const tokenRepo = makeWebhookTokensRepo(db, f.orgA.id, mek);
      const { id, plaintext } = await tokenRepo.create({ pluginName: 'github' });

      // Revoke the token
      await tokenRepo.revoke(id);

      // findWebhookTokenByPlaintext must not return revoked tokens (T-12-01-03)
      const result = await admin.findWebhookTokenByPlaintext(plaintext);
      expect(result).toBeUndefined();
    });

    it('does not log or return the plaintext (ATOK-06 — structural check)', async () => {
      const db = getTestDb();
      const mek = getTestMek();
      const f = await seedTwoOrgs(db);
      const admin = makeAdminRepo(db);

      const tokenRepo = makeWebhookTokensRepo(db, f.orgA.id, mek);
      const { plaintext } = await tokenRepo.create({ pluginName: 'github' });

      const result = await admin.findWebhookTokenByPlaintext(plaintext);
      expect(result).toBeDefined();
      // The returned object must not contain the plaintext itself
      const returnedValues = Object.values(result ?? {});
      expect(returnedValues).not.toContain(plaintext);
    });
  });

  describe('cleanupDeliveries', () => {
    it('deletes deliveries older than cutoff and preserves recent ones', async () => {
      const db = getTestDb();
      const f = await seedTwoOrgs(db);
      const admin = makeAdminRepo(db);

      // Insert 2 deliveries directly using raw SQL with old timestamps
      const { webhookDeliveries: wdTable } = await import('../../db/schema.js');
      const { sql } = await import('drizzle-orm');

      // Insert 2 old rows (60 days ago) using Drizzle with manual receivedAt override
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      await db.execute(
        sql`INSERT INTO webhook_deliveries (id, org_id, plugin_name, delivery_id, received_at)
            VALUES
              ('whd_old_1', ${f.orgA.id}, 'github', 'old-delivery-1', ${oldDate}),
              ('whd_old_2', ${f.orgA.id}, 'github', 'old-delivery-2', ${oldDate})`,
      );

      // Insert 2 recent rows (1 hour ago) using the repo
      const repoA = makeWebhookDeliveriesRepo(db, f.orgA.id);
      await repoA.recordDelivery({ pluginName: 'github', deliveryId: 'recent-1' });
      await repoA.recordDelivery({ pluginName: 'github', deliveryId: 'recent-2' });

      // Verify all 4 exist before cleanup
      const beforeCount = await db.execute(
        sql`SELECT COUNT(*) as n FROM webhook_deliveries`,
      );
      expect(Number((beforeCount as unknown as Array<{ n: string }>)[0]?.n)).toBe(4);

      // Run cleanup with cutoff = 30 days ago
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { rowsDeleted } = await admin.cleanupDeliveries(thirtyDaysAgo);
      expect(rowsDeleted).toBe(2);

      // Verify 2 recent rows remain
      const afterCount = await db.execute(
        sql`SELECT COUNT(*) as n FROM webhook_deliveries`,
      );
      expect(Number((afterCount as unknown as Array<{ n: string }>)[0]?.n)).toBe(2);
    });

    it('returns rowsDeleted=0 when nothing matches the cutoff', async () => {
      const db = getTestDb();
      const f = await seedTwoOrgs(db);
      const admin = makeAdminRepo(db);

      // Insert 2 recent deliveries
      const repo = makeWebhookDeliveriesRepo(db, f.orgA.id);
      await repo.recordDelivery({ pluginName: 'github', deliveryId: 'recent-a' });
      await repo.recordDelivery({ pluginName: 'github', deliveryId: 'recent-b' });

      // Cutoff = 90 days ago — nothing matches
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const { rowsDeleted } = await admin.cleanupDeliveries(ninetyDaysAgo);
      expect(rowsDeleted).toBe(0);
    });
  });
});
