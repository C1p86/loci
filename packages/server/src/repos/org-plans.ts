import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { orgPlans } from '../db/schema.js';

export function makeOrgPlansRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    /** Get the org plan (1:1 with org per D-37). Returns empty array if not found. */
    async get() {
      return db.select().from(orgPlans).where(eq(orgPlans.orgId, orgId)).limit(1);
    },
  };
}

export type OrgPlansRepo = ReturnType<typeof makeOrgPlansRepo>;
