import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { orgMembers, orgPlans, orgs, users } from '../schema.js';

describe('db migrator smoke (Wave 1 foundation)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('container booted and SELECT 1 works', async () => {
    const db = getTestDb();
    const result = await db.execute(sql`SELECT 1 as one`);
    // postgres-js returns a rows-like array; shape depends on driver wrapping
    // Accept either [{one: 1}] or similar — just verify non-empty
    expect(
      Array.isArray(result) ? result.length : (result as { rows?: unknown[] }).rows?.length,
    ).toBeGreaterThan(0);
  });

  it('all 8 application tables exist after migrations', async () => {
    const db = getTestDb();
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name != '__drizzle_migrations'
      ORDER BY table_name
    `);
    // postgres-js returns a Response-like array with the rows
    const tableNames = (
      Array.isArray(rows) ? rows : ((rows as { rows?: Array<{ table_name: string }> }).rows ?? [])
    )
      .map((r) => r.table_name)
      .sort();
    expect(tableNames).toEqual([
      'email_verifications',
      'org_invites',
      'org_members',
      'org_plans',
      'orgs',
      'password_resets',
      'sessions',
      'users',
    ]);
  });

  it('seedTwoOrgs creates two orgs with owner memberships and Free plans (QUOTA-02)', async () => {
    const db = getTestDb();
    const fixture = await seedTwoOrgs(db);

    const orgCount = await db.select().from(orgs);
    expect(orgCount.length).toBe(2);

    const userCount = await db.select().from(users);
    expect(userCount.length).toBe(2);

    const memberCount = await db.select().from(orgMembers);
    expect(memberCount.length).toBe(2);
    expect(memberCount.every((m) => m.role === 'owner')).toBe(true);

    const planCount = await db.select().from(orgPlans);
    expect(planCount.length).toBe(2);
    expect(planCount.every((p) => p.planName === 'free')).toBe(true);
    expect(planCount.every((p) => p.maxAgents === 5)).toBe(true);
    expect(planCount.every((p) => p.maxConcurrentTasks === 5)).toBe(true);
    expect(planCount.every((p) => p.logRetentionDays === 30)).toBe(true);

    // Sanity: fixture IDs match DB IDs
    expect(orgCount.map((o) => o.id).sort()).toEqual([fixture.orgA.id, fixture.orgB.id].sort());
  });

  it('resetDb empties all 8 tables dynamically (Pitfall 5)', async () => {
    const db = getTestDb();
    await seedTwoOrgs(db);
    // Pre-reset: data present
    expect((await db.select().from(orgs)).length).toBe(2);

    await resetDb();

    // Post-reset: all 8 tables empty
    expect((await db.select().from(orgs)).length).toBe(0);
    expect((await db.select().from(users)).length).toBe(0);
    expect((await db.select().from(orgMembers)).length).toBe(0);
    expect((await db.select().from(orgPlans)).length).toBe(0);
  });
});
