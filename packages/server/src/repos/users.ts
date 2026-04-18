import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { orgMembers, users } from '../db/schema.js';

export function makeUsersRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async findByEmail(email: string) {
      return db
        .select({ user: users })
        .from(users)
        .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
        .where(and(eq(orgMembers.orgId, orgId), eq(users.email, email.toLowerCase())))
        .limit(1);
    },
    async findById(userId: string) {
      return db
        .select({ user: users })
        .from(users)
        .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
        .where(and(eq(orgMembers.orgId, orgId), eq(users.id, userId)))
        .limit(1);
    },
    async listMembers() {
      return db
        .select({ user: users, role: orgMembers.role })
        .from(users)
        .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
        .where(eq(orgMembers.orgId, orgId));
    },
  };
}

export type UsersRepo = ReturnType<typeof makeUsersRepo>;
