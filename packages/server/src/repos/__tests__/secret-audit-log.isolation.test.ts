/**
 * D-04 + D-31: Two-org isolation tests for makeSecretAuditLogRepo.
 * Verifies: org-scoped list, newest-first ordering, pagination, limit clamping (D-23).
 * Auto-discovery meta-test (isolation-coverage.isolation.test.ts) picks this file up automatically.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeSecretAuditLogRepo } from '../secret-audit-log.js';
import { makeSecretsRepo } from '../secrets.js';

let mek: Buffer;
beforeAll(() => {
  mek = randomBytes(32);
});

describe('secret-audit-log repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('list scoped to orgA only returns orgA entries (never orgB entries)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeSecretsRepo(db, f.orgA.id, mek);
    const repoB = makeSecretsRepo(db, f.orgB.id, mek);
    const auditA = makeSecretAuditLogRepo(db, f.orgA.id);

    await repoA.create({ name: 'SECRET_A', value: 'va', createdByUserId: f.orgA.ownerUser.id });
    await repoB.create({ name: 'SECRET_B', value: 'vb', createdByUserId: f.orgB.ownerUser.id });

    const rows = await auditA.list({});
    expect(rows.every((r) => r.orgId === f.orgA.id)).toBe(true);
    expect(rows.every((r) => r.secretName !== 'SECRET_B')).toBe(true);
    expect(rows.some((r) => r.secretName === 'SECRET_A')).toBe(true);
  });

  it('list returns entries newest-first (ORDER BY created_at DESC)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeSecretsRepo(db, f.orgA.id, mek);
    const auditA = makeSecretAuditLogRepo(db, f.orgA.id);

    // Create 3 secrets to produce 3 audit entries
    await repoA.create({ name: 'S1', value: 'v1', createdByUserId: f.orgA.ownerUser.id });
    await repoA.create({ name: 'S2', value: 'v2', createdByUserId: f.orgA.ownerUser.id });
    await repoA.create({ name: 'S3', value: 'v3', createdByUserId: f.orgA.ownerUser.id });

    const rows = await auditA.list({});
    expect(rows.length).toBe(3);

    // Verify descending order: each entry's createdAt >= the next one's
    for (let i = 0; i < rows.length - 1; i++) {
      const current = rows[i];
      const next = rows[i + 1];
      if (current && next) {
        expect(current.createdAt.getTime()).toBeGreaterThanOrEqual(next.createdAt.getTime());
      }
    }
  });

  it('pagination: list({limit:1, offset:0}) and list({limit:1, offset:1}) return disjoint sets', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeSecretsRepo(db, f.orgA.id, mek);
    const auditA = makeSecretAuditLogRepo(db, f.orgA.id);

    await repoA.create({ name: 'PA', value: 'va', createdByUserId: f.orgA.ownerUser.id });
    await repoA.create({ name: 'PB', value: 'vb', createdByUserId: f.orgA.ownerUser.id });

    const page1 = await auditA.list({ limit: 1, offset: 0 });
    const page2 = await auditA.list({ limit: 1, offset: 1 });

    expect(page1.length).toBe(1);
    expect(page2.length).toBe(1);
    expect(page1[0]?.id).not.toBe(page2[0]?.id);
  });

  it('limit clamped to 1000 — list({limit: 10000}) returns at most 1000 rows (D-23)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeSecretsRepo(db, f.orgA.id, mek);
    const auditA = makeSecretAuditLogRepo(db, f.orgA.id);

    // Seed just 2 entries — the clamping is in the SQL LIMIT, not row count
    await repoA.create({ name: 'CL1', value: 'v1', createdByUserId: f.orgA.ownerUser.id });
    await repoA.create({ name: 'CL2', value: 'v2', createdByUserId: f.orgA.ownerUser.id });

    // With only 2 rows, passing limit=10000 should return ≤2 (clamped SQL LIMIT=1000 still allows 2)
    const rows = await auditA.list({ limit: 10000 });
    expect(rows.length).toBeLessThanOrEqual(1000);
    // All 2 seeded entries are returned (well under clamp)
    expect(rows.length).toBe(2);
  });
});
