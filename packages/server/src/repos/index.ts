// D-01: ONLY forOrg() and adminRepo leave the repos module.
// Importing from './repos/users.js' etc. from outside src/repos/ is blocked by Biome
// (see biome.json override, third override block — Plan 01 Task 2).
// This barrel is the ONE permitted entry point from routes/plugins/app.ts.
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type AdminRepo, makeAdminRepo } from './admin.js';
import { type ForOrgFactory, makeForOrg } from './for-org.js';

export function makeRepos(db: PostgresJsDatabase, mek: Buffer) {
  return {
    forOrg: makeForOrg(db, mek),
    admin: makeAdminRepo(db),
  };
}

export type Repos = ReturnType<typeof makeRepos>;
export type { AdminRepo, ForOrgFactory };
