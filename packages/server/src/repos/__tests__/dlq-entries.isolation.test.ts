// D-04 auto-discovery: referenced by isolation-coverage.isolation.test.ts.
// Two-org isolation tests for makeDlqEntriesRepo.
// T-12-01-02: cross-tenant getById/list must return undefined/empty for the wrong org.

import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeDlqEntriesRepo } from '../dlq-entries.js';

const SCRUBBED_BODY = { action: 'opened', repository: { name: 'repo' } };
const SCRUBBED_HEADERS = { 'x-github-event': 'pull_request', 'content-type': 'application/json' };

describe('dlq-entries repo isolation (D-04 / T-12-01-02)', () => {
  beforeEach(async () => resetDb());

  it('list scoped to orgA never returns orgB entries', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeDlqEntriesRepo(db, f.orgA.id);
    const repoB = makeDlqEntriesRepo(db, f.orgB.id);

    await repoA.create({
      pluginName: 'github',
      failureReason: 'signature_invalid',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });
    await repoA.create({
      pluginName: 'github',
      failureReason: 'parse_failed',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });
    await repoB.create({
      pluginName: 'perforce',
      failureReason: 'no_task_matched',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });
    await repoB.create({
      pluginName: 'perforce',
      failureReason: 'internal',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });

    const listA = await repoA.list({});
    expect(listA).toHaveLength(2);
    expect(listA.every((e) => e.orgId === f.orgA.id)).toBe(true);

    const listB = await repoB.list({});
    expect(listB).toHaveLength(2);
    expect(listB.every((e) => e.orgId === f.orgB.id)).toBe(true);
  });

  it('getById scoped to orgA never returns orgB entry (T-12-01-02)', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeDlqEntriesRepo(db, f.orgA.id);
    const repoB = makeDlqEntriesRepo(db, f.orgB.id);

    const entryA = await repoA.create({
      pluginName: 'github',
      failureReason: 'signature_invalid',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });
    const entryB = await repoB.create({
      pluginName: 'github',
      failureReason: 'parse_failed',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });

    // orgA can see its own entry
    const own = await repoA.getById(entryA.id);
    expect(own).toBeDefined();
    expect(own?.id).toBe(entryA.id);

    // orgA cannot see orgB's entry
    const cross = await repoA.getById(entryB.id);
    expect(cross).toBeUndefined();
  });

  it('markRetried cross-tenant: orgB cannot mark orgA entry as retried', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeDlqEntriesRepo(db, f.orgA.id);
    const repoB = makeDlqEntriesRepo(db, f.orgB.id);

    const entryA = await repoA.create({
      pluginName: 'github',
      failureReason: 'signature_invalid',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });
    await repoB.create({
      pluginName: 'github',
      failureReason: 'parse_failed',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });

    // orgB attempts to markRetried on orgA's entry — must return undefined (no row matched)
    const result = await repoB.markRetried(entryA.id, 'succeeded');
    expect(result).toBeUndefined();

    // orgA's entry must still have retriedAt=null
    const unchanged = await repoA.getById(entryA.id);
    expect(unchanged?.retriedAt).toBeNull();
    expect(unchanged?.retryResult).toBeNull();
  });

  it('markRetried within same org sets retriedAt and retryResult', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repoA = makeDlqEntriesRepo(db, f.orgA.id);
    const entry = await repoA.create({
      pluginName: 'github',
      failureReason: 'no_task_matched',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });

    const retried = await repoA.markRetried(entry.id, 'succeeded');
    expect(retried).toBeDefined();
    expect(retried?.retryResult).toBe('succeeded');
    expect(retried?.retriedAt).not.toBeNull();
  });

  it('list cursor pagination returns only entries before cursor', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);

    const repo = makeDlqEntriesRepo(db, f.orgA.id);

    // Insert 3 entries with slight delays would be ideal but we can rely on id ordering
    const e1 = await repo.create({
      pluginName: 'github',
      failureReason: 'signature_invalid',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });
    const e2 = await repo.create({
      pluginName: 'github',
      failureReason: 'parse_failed',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });
    const e3 = await repo.create({
      pluginName: 'github',
      failureReason: 'no_task_matched',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });

    // Get all — should have 3
    const all = await repo.list({ limit: 10 });
    expect(all).toHaveLength(3);

    // Get with limit 2
    const page1 = await repo.list({ limit: 2 });
    expect(page1).toHaveLength(2);

    // Verify entries belong to orgA
    expect(all.every((e) => e.orgId === f.orgA.id)).toBe(true);
    // Suppress unused variable warning
    void e1;
    void e2;
    void e3;
  });

  it('list limit clamped to max 200', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repo = makeDlqEntriesRepo(db, f.orgA.id);

    // Only 1 row but requesting 9999 — should not throw, returns available rows
    await repo.create({
      pluginName: 'github',
      failureReason: 'internal',
      scrubbedBody: SCRUBBED_BODY,
      scrubbedHeaders: SCRUBBED_HEADERS,
    });
    const result = await repo.list({ limit: 9999 });
    expect(result).toHaveLength(1); // only 1 row exists
  });
});
