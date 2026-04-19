// D-04 auto-discovery: referenced by isolation-coverage.isolation.test.ts.
// Two-org isolation tests for makeWebhookTokensRepo.
// T-12-01-02: cross-tenant getById/list must return undefined/empty for the wrong org.
// T-12-01-01: create stores only hash + encrypted secret; plaintext never persisted.

import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, getTestMek, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeWebhookTokensRepo } from '../webhook-tokens.js';

describe('webhook-tokens repo isolation (D-04 / T-12-01-02)', () => {
  beforeEach(async () => resetDb());

  it('list scoped to orgA never returns orgB tokens', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookTokensRepo(db, f.orgA.id, mek);
    const repoB = makeWebhookTokensRepo(db, f.orgB.id, mek);

    await repoA.create({ pluginName: 'github', createdByUserId: f.orgA.ownerUser.id });
    await repoA.create({ pluginName: 'perforce', createdByUserId: f.orgA.ownerUser.id });
    await repoB.create({ pluginName: 'github', createdByUserId: f.orgB.ownerUser.id });
    await repoB.create({ pluginName: 'github', createdByUserId: f.orgB.ownerUser.id });

    const listA = await repoA.list();
    expect(listA).toHaveLength(2);
    expect(listA.every((t) => t.orgId === f.orgA.id)).toBe(true);

    const listB = await repoB.list();
    expect(listB).toHaveLength(2);
    expect(listB.every((t) => t.orgId === f.orgB.id)).toBe(true);
  });

  it('getById scoped to orgA never returns orgB token', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookTokensRepo(db, f.orgA.id, mek);
    const repoB = makeWebhookTokensRepo(db, f.orgB.id, mek);

    const { id: tokenAId } = await repoA.create({ pluginName: 'github' });
    const { id: tokenBId } = await repoB.create({ pluginName: 'github' });

    // orgA can see its own token
    const own = await repoA.getById(tokenAId);
    expect(own).toBeDefined();
    expect(own?.id).toBe(tokenAId);

    // orgA cannot see orgB's token (T-12-01-02)
    const cross = await repoA.getById(tokenBId);
    expect(cross).toBeUndefined();
  });

  it('create stores only hash; plaintext not found in any DB column', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const repo = makeWebhookTokensRepo(db, f.orgA.id, mek);
    const { id, plaintext } = await repo.create({
      pluginName: 'github',
      pluginSecret: 'my-github-secret',
    });

    // Verify the row via a raw SELECT to check no column contains the plaintext token
    const { webhookTokens } = await import('../../db/schema.js');
    const { eq } = await import('drizzle-orm');
    const rows = await db.select().from(webhookTokens).where(eq(webhookTokens.id, id)).limit(1);
    const row = rows[0];
    expect(row).toBeDefined();

    // tokenHash is present (sha256 hex, not the plaintext)
    expect(row?.tokenHash).toBeDefined();
    expect(row?.tokenHash).not.toBe(plaintext);
    expect(row?.tokenHash).toHaveLength(64); // sha256 hex is 64 chars

    // No column should contain the plaintext token value
    const rowValues = Object.values(row ?? {});
    for (const val of rowValues) {
      if (typeof val === 'string') {
        expect(val).not.toBe(plaintext);
      }
    }

    // plugin_secret_encrypted is present (not null) and is a Buffer (ciphertext)
    expect(row?.pluginSecretEncrypted).toBeDefined();
    expect(row?.pluginSecretEncrypted).not.toBeNull();
  });

  it('resolvePluginSecret returns Buffer for github token and null for perforce', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const repo = makeWebhookTokensRepo(db, f.orgA.id, mek);
    const { id: githubTokenId } = await repo.create({
      pluginName: 'github',
      pluginSecret: 'super-secret',
    });
    const { id: perforceTokenId } = await repo.create({ pluginName: 'perforce' });

    const githubSecret = await repo.resolvePluginSecret(githubTokenId);
    expect(githubSecret).toBeInstanceOf(Buffer);
    expect((githubSecret as Buffer).toString('utf8')).toBe('super-secret');

    const perforceSecret = await repo.resolvePluginSecret(perforceTokenId);
    expect(perforceSecret).toBeNull();
  });

  it('resolvePluginSecret returns undefined for cross-org token id (T-12-01-02)', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookTokensRepo(db, f.orgA.id, mek);
    const repoB = makeWebhookTokensRepo(db, f.orgB.id, mek);

    const { id: tokenBId } = await repoB.create({
      pluginName: 'github',
      pluginSecret: 'orgB-secret',
    });

    // orgA repo must not resolve orgB's plugin secret
    const result = await repoA.resolvePluginSecret(tokenBId);
    expect(result).toBeUndefined();
  });

  it('revoke scoped to orgA cannot revoke orgB token', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const repoA = makeWebhookTokensRepo(db, f.orgA.id, mek);
    const repoB = makeWebhookTokensRepo(db, f.orgB.id, mek);

    const { id: tokenBId } = await repoB.create({ pluginName: 'github' });

    // orgA attempts to revoke orgB's token — must be a no-op
    await repoA.revoke(tokenBId);

    // Token should still be active in orgB
    const tokenB = await repoB.getById(tokenBId);
    expect(tokenB?.revokedAt).toBeNull();
  });

  it('resolvePluginSecret returns undefined for revoked token', async () => {
    const db = getTestDb();
    const mek = getTestMek();
    const f = await seedTwoOrgs(db);

    const repo = makeWebhookTokensRepo(db, f.orgA.id, mek);
    const { id } = await repo.create({ pluginName: 'github', pluginSecret: 'secret' });

    await repo.revoke(id);
    const result = await repo.resolvePluginSecret(id);
    expect(result).toBeUndefined();
  });
});
