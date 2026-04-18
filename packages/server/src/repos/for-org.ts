import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { makeAgentCredentialsRepo } from './agent-credentials.js';
import { makeAgentsRepo } from './agents.js';
import { makeEmailVerificationsRepo } from './email-verifications.js';
import { makeOrgInvitesRepo } from './org-invites.js';
import { makeOrgPlansRepo } from './org-plans.js';
import { makePasswordResetsRepo } from './password-resets.js';
import { makeRegistrationTokensRepo } from './registration-tokens.js';
import { makeSessionsRepo } from './sessions.js';
import { makeUsersRepo } from './users.js';

/**
 * D-01: forOrg(orgId) is the SOLE entry point into org-scoped repos.
 * Returns a curried function: makeForOrg(db)(orgId) → all repos scoped to that org.
 * Never import the individual makeXxxRepo factories from outside src/repos/.
 */
export function makeForOrg(db: PostgresJsDatabase) {
  return (orgId: string) => ({
    users: makeUsersRepo(db, orgId),
    sessions: makeSessionsRepo(db, orgId),
    emailVerifications: makeEmailVerificationsRepo(db, orgId),
    passwordResets: makePasswordResetsRepo(db, orgId),
    invites: makeOrgInvitesRepo(db, orgId),
    plan: makeOrgPlansRepo(db, orgId),
    agents: makeAgentsRepo(db, orgId),
    agentCredentials: makeAgentCredentialsRepo(db, orgId),
    registrationTokens: makeRegistrationTokensRepo(db, orgId),
  });
}

export type ForOrgFactory = ReturnType<typeof makeForOrg>;
export type ForOrgRepos = ReturnType<ForOrgFactory>;
