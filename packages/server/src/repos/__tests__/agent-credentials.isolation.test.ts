import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../crypto/tokens.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeAgentCredentialsRepo } from '../agent-credentials.js';
import { makeAgentsRepo } from '../agents.js';

describe('agent-credentials repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('createForAgent scoped — cannot create for orgB agent from orgA scope', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: bAgentId } = await makeAgentsRepo(db, f.orgB.id).create({
      hostname: 'hB',
      labels: {},
    });
    // Attempt from orgA scope — FK on (agentId + orgId) will not match orgB's agent; at
    // minimum, orgB's scope should see no credential for its agent after this attempt.
    try {
      await makeAgentCredentialsRepo(db, f.orgA.id).createForAgent(bAgentId, hashToken('t'));
    } catch {
      // expected FK/scope error — swallow
    }
    const bCred = await makeAgentCredentialsRepo(db, f.orgB.id).findActiveByAgentId(bAgentId);
    expect(bCred).toBeUndefined();
  });

  it('createForAgent revokes prior active before insert — no 23505', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: agentId } = await makeAgentsRepo(db, f.orgA.id).create({
      hostname: 'h',
      labels: {},
    });
    await makeAgentCredentialsRepo(db, f.orgA.id).createForAgent(agentId, hashToken('token1'));
    // Second call must not throw PG 23505
    await expect(
      makeAgentCredentialsRepo(db, f.orgA.id).createForAgent(agentId, hashToken('token2')),
    ).resolves.toBeDefined();
    const active = await makeAgentCredentialsRepo(db, f.orgA.id).findActiveByAgentId(agentId);
    expect(active?.credentialHash).toBe(hashToken('token2'));
  });

  it('revokeForAgent scoped — orgA cannot revoke orgB credentials', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: bAgentId } = await makeAgentsRepo(db, f.orgB.id).create({
      hostname: 'hB',
      labels: {},
    });
    await makeAgentCredentialsRepo(db, f.orgB.id).createForAgent(bAgentId, hashToken('tokB'));
    await makeAgentCredentialsRepo(db, f.orgA.id).revokeForAgent(bAgentId);
    const bCred = await makeAgentCredentialsRepo(db, f.orgB.id).findActiveByAgentId(bAgentId);
    expect(bCred).toBeDefined();
    expect(bCred?.revokedAt).toBeNull();
  });

  it('findActiveByAgentId scoped — orgA returns undefined for orgB agent', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const { id: bAgentId } = await makeAgentsRepo(db, f.orgB.id).create({
      hostname: 'hB',
      labels: {},
    });
    await makeAgentCredentialsRepo(db, f.orgB.id).createForAgent(bAgentId, hashToken('t'));
    const result = await makeAgentCredentialsRepo(db, f.orgA.id).findActiveByAgentId(bAgentId);
    expect(result).toBeUndefined();
  });
});
