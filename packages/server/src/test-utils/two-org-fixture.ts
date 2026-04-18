// packages/server/src/test-utils/two-org-fixture.ts
import { randomBytes } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { generateId } from '../crypto/tokens.js';
import { orgMembers, orgPlans, orgs, users } from '../db/schema.js';

export interface TwoOrgFixture {
  orgA: { id: string; ownerUser: { id: string; email: string } };
  orgB: { id: string; ownerUser: { id: string; email: string } };
}

export async function seedTwoOrgs(db: PostgresJsDatabase): Promise<TwoOrgFixture> {
  const orgAId = generateId('org');
  const orgBId = generateId('org');
  const userAId = generateId('usr');
  const userBId = generateId('usr');
  const aEmail = `a-${randomBytes(4).toString('hex')}@example.com`;
  const bEmail = `b-${randomBytes(4).toString('hex')}@example.com`;

  await db.transaction(async (tx) => {
    await tx.insert(orgs).values([
      {
        id: orgAId,
        name: 'Org A',
        slug: `org-a-${randomBytes(3).toString('hex')}`,
        isPersonal: false,
      },
      {
        id: orgBId,
        name: 'Org B',
        slug: `org-b-${randomBytes(3).toString('hex')}`,
        isPersonal: false,
      },
    ]);
    await tx.insert(users).values([
      { id: userAId, email: aEmail, passwordHash: 'dummy-not-a-real-hash' },
      { id: userBId, email: bEmail, passwordHash: 'dummy-not-a-real-hash' },
    ]);
    await tx.insert(orgMembers).values([
      { id: generateId('mem'), orgId: orgAId, userId: userAId, role: 'owner' },
      { id: generateId('mem'), orgId: orgBId, userId: userBId, role: 'owner' },
    ]);
    await tx.insert(orgPlans).values([
      { id: generateId('plan'), orgId: orgAId },
      { id: generateId('plan'), orgId: orgBId },
    ]);
  });

  return {
    orgA: { id: orgAId, ownerUser: { id: userAId, email: aEmail } },
    orgB: { id: orgBId, ownerUser: { id: userBId, email: bEmail } },
  };
}
