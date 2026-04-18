// packages/server/src/db/relations.ts
// Source: https://orm.drizzle.team/docs/relations
import { relations } from 'drizzle-orm';
import { orgs, users, orgMembers, orgPlans, sessions, orgInvites } from './schema.js';

export const orgsRelations = relations(orgs, ({ one, many }) => ({
  plan: one(orgPlans, { fields: [orgs.id], references: [orgPlans.orgId] }),
  members: many(orgMembers),
  invites: many(orgInvites),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(orgMembers),
  sessions: many(sessions),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  org: one(orgs, { fields: [orgMembers.orgId], references: [orgs.id] }),
  user: one(users, { fields: [orgMembers.userId], references: [users.id] }),
}));

export const orgPlansRelations = relations(orgPlans, ({ one }) => ({
  org: one(orgs, { fields: [orgPlans.orgId], references: [orgs.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  activeOrg: one(orgs, { fields: [sessions.activeOrgId], references: [orgs.id] }),
}));

export const orgInvitesRelations = relations(orgInvites, ({ one }) => ({
  org: one(orgs, { fields: [orgInvites.orgId], references: [orgs.id] }),
  inviter: one(users, { fields: [orgInvites.inviterUserId], references: [users.id] }),
}));
