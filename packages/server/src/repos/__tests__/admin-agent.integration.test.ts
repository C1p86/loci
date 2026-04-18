import { beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../crypto/tokens.js';
import { RegistrationTokenExpiredError } from '../../errors.js';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeAdminRepo } from '../admin.js';
import { makeAgentCredentialsRepo } from '../agent-credentials.js';
import { makeAgentsRepo } from '../agents.js';
import { makeRegistrationTokensRepo } from '../registration-tokens.js';

describe('adminRepo agent helpers (D-37)', () => {
  beforeEach(async () => resetDb());

  it('findValidRegistrationToken + consumeRegistrationToken full cycle', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { id, tokenPlaintext } = await makeRegistrationTokensRepo(db, f.orgA.id).create(
      f.orgA.ownerUser.id,
    );

    const found = await admin.findValidRegistrationToken(tokenPlaintext);
    expect(found?.id).toBe(id);
    expect(found?.orgId).toBe(f.orgA.id);

    const consumedOrgId = await admin.consumeRegistrationToken(id);
    expect(consumedOrgId).toBe(f.orgA.id);

    // Second consume throws RegistrationTokenExpiredError
    await expect(admin.consumeRegistrationToken(id)).rejects.toBeInstanceOf(
      RegistrationTokenExpiredError,
    );

    // After consume, findValid returns undefined
    const afterConsume = await admin.findValidRegistrationToken(tokenPlaintext);
    expect(afterConsume).toBeUndefined();
  });

  it('findValidRegistrationToken returns undefined for unknown plaintext', async () => {
    const db = getTestDb();
    await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const result = await admin.findValidRegistrationToken(
      'not-a-real-token-xxxxxxxxxxxxxxxxxxxxxxxxx',
    );
    expect(result).toBeUndefined();
  });

  it('registerNewAgent atomic transaction creates agent + credential', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'testhost',
      labels: { env: 'prod' },
    });
    expect(agentId).toMatch(/^xci_agt_/);
    expect(credentialPlaintext).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const agent = await makeAgentsRepo(db, f.orgA.id).getById(agentId);
    expect(agent?.state).toBe('online');
    const cred = await makeAgentCredentialsRepo(db, f.orgA.id).findActiveByAgentId(agentId);
    expect(cred).toBeDefined();
    expect(cred?.credentialHash).toBe(hashToken(credentialPlaintext));
  });

  it('findActiveAgentCredential returns orgId and agentId for active cred', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    const found = await admin.findActiveAgentCredential(credentialPlaintext);
    expect(found).toEqual({ agentId, orgId: f.orgA.id });
  });

  it('findActiveAgentCredential returns undefined after revoke', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    await makeAgentCredentialsRepo(db, f.orgA.id).revokeForAgent(agentId);
    const found = await admin.findActiveAgentCredential(credentialPlaintext);
    expect(found).toBeUndefined();
  });

  it('issueAgentCredential rotates — old cred invalid, new cred valid', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const admin = makeAdminRepo(db);
    const { agentId, credentialPlaintext: oldCred } = await admin.registerNewAgent({
      orgId: f.orgA.id,
      hostname: 'h',
      labels: {},
    });
    const newCred = await admin.issueAgentCredential(agentId, f.orgA.id);
    expect(newCred).not.toBe(oldCred);

    const oldLookup = await admin.findActiveAgentCredential(oldCred);
    expect(oldLookup).toBeUndefined();
    const newLookup = await admin.findActiveAgentCredential(newCred);
    expect(newLookup).toEqual({ agentId, orgId: f.orgA.id });
  });
});
