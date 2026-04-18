import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeAgentsRepo } from '../agents.js';

describe('agents repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('list scoped to orgA never returns orgB agents', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    await makeAgentsRepo(db, f.orgA.id).create({ hostname: 'hostA', labels: { env: 'A' } });
    await makeAgentsRepo(db, f.orgB.id).create({ hostname: 'hostB', labels: { env: 'B' } });

    const resultA = await makeAgentsRepo(db, f.orgA.id).list();
    expect(resultA).toHaveLength(1);
    expect(resultA[0]!.hostname).toBe('hostA');
  });

  it('getById scoped to orgA never returns orgB agent by id', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: orgBAgentId } = await makeAgentsRepo(db, f.orgB.id).create({
      hostname: 'hostB',
      labels: {},
    });
    const result = await makeAgentsRepo(db, f.orgA.id).getById(orgBAgentId);
    expect(result).toBeUndefined();
  });

  it('create produces xci_agt_ prefix', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id } = await makeAgentsRepo(db, f.orgA.id).create({ hostname: 'h', labels: {} });
    expect(id).toMatch(/^xci_agt_/);
  });

  it('updateState scoped — orgA cannot update orgB agent', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: bAgentId } = await makeAgentsRepo(db, f.orgB.id).create({
      hostname: 'hB',
      labels: {},
    });
    await makeAgentsRepo(db, f.orgA.id).updateState(bAgentId, 'draining');
    // Reading from orgB's scope — state should STILL be 'offline' (default), not 'draining'
    const bAgent = await makeAgentsRepo(db, f.orgB.id).getById(bAgentId);
    expect(bAgent?.state).toBe('offline');
  });

  it('updateHostname scoped — orgA cannot change orgB hostname', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: bAgentId } = await makeAgentsRepo(db, f.orgB.id).create({
      hostname: 'original',
      labels: {},
    });
    await makeAgentsRepo(db, f.orgA.id).updateHostname(bAgentId, 'hijacked');
    const bAgent = await makeAgentsRepo(db, f.orgB.id).getById(bAgentId);
    expect(bAgent?.hostname).toBe('original');
  });

  it('recordHeartbeat scoped — orgA cannot bump orgB last_seen_at', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: bAgentId } = await makeAgentsRepo(db, f.orgB.id).create({
      hostname: 'hB',
      labels: {},
    });
    await makeAgentsRepo(db, f.orgA.id).recordHeartbeat(bAgentId);
    const bAgent = await makeAgentsRepo(db, f.orgB.id).getById(bAgentId);
    expect(bAgent?.lastSeenAt).toBeNull();
  });

  it('delete scoped — orgA cannot delete orgB agent', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: bAgentId } = await makeAgentsRepo(db, f.orgB.id).create({
      hostname: 'hB',
      labels: {},
    });
    await makeAgentsRepo(db, f.orgA.id).delete(bAgentId);
    const bAgent = await makeAgentsRepo(db, f.orgB.id).getById(bAgentId);
    expect(bAgent).toBeDefined();
  });
});
