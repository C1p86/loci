// D-04 auto-discovery: referenced by isolation-coverage.isolation.test.ts.
// Two-org isolation tests for makeWebhookDeliveriesRepo.
// D-22: unique index on (plugin_name, delivery_id) — duplicate within same org returns inserted=false.
// Cross-org: same deliveryId for different orgs CAN succeed (unique is global per plugin+deliveryId).

import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeWebhookDeliveriesRepo } from '../webhook-deliveries.js';

describe('webhook-deliveries repo isolation (D-04 / D-22)', () => {
  beforeEach(async () => resetDb());

  it('recordDelivery succeeds and returns inserted=true on first insert', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookDeliveriesRepo(db, f.orgA.id);
    const result = await repoA.recordDelivery({
      pluginName: 'github',
      deliveryId: 'delivery-abc-123',
    });

    expect(result.inserted).toBe(true);
    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe('string');
  });

  it('duplicate deliveryId in same org returns inserted=false (dedup sentinel)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookDeliveriesRepo(db, f.orgA.id);

    const first = await repoA.recordDelivery({ pluginName: 'github', deliveryId: 'dup-id-001' });
    expect(first.inserted).toBe(true);

    // Second call with same (plugin, deliveryId) — unique index fires
    const second = await repoA.recordDelivery({ pluginName: 'github', deliveryId: 'dup-id-001' });
    expect(second.inserted).toBe(false);
    expect(second.id).toBeNull();
  });

  it('same deliveryId for different plugins is not a duplicate', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookDeliveriesRepo(db, f.orgA.id);

    const github = await repoA.recordDelivery({ pluginName: 'github', deliveryId: 'shared-id' });
    expect(github.inserted).toBe(true);

    // Different plugin — unique index is on (plugin_name, delivery_id), so this is distinct
    const perforce = await repoA.recordDelivery({ pluginName: 'perforce', deliveryId: 'shared-id' });
    expect(perforce.inserted).toBe(true);
  });

  it('isDuplicate returns true after recordDelivery, false for unknown delivery', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookDeliveriesRepo(db, f.orgA.id);
    await repoA.recordDelivery({ pluginName: 'github', deliveryId: 'check-id' });

    expect(await repoA.isDuplicate('github', 'check-id')).toBe(true);
    expect(await repoA.isDuplicate('github', 'unknown-id')).toBe(false);
  });

  it('isDuplicate scoped to org: orgA delivery not visible via orgB isDuplicate', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookDeliveriesRepo(db, f.orgA.id);
    const repoB = makeWebhookDeliveriesRepo(db, f.orgB.id);

    await repoA.recordDelivery({ pluginName: 'github', deliveryId: 'orgA-only-id' });

    // isDuplicate is org-scoped — orgB cannot see orgA's delivery
    expect(await repoB.isDuplicate('github', 'orgA-only-id')).toBe(false);
  });
});
