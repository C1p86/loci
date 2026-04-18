// packages/server/src/db/schema.ts
// Source: https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const orgs = pgTable(
  'orgs',
  {
    id: text('id').primaryKey(), // xci_org_<rand>
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    isPersonal: boolean('is_personal').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('orgs_slug_unique').on(t.slug)],
);

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(), // xci_usr_<rand>
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash').notNull(), // argon2 encoded string
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Case-insensitive unique on email — store as-is, enforce via LOWER(email)
    uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`),
  ],
);

export const orgMembers = pgTable(
  'org_members',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member', 'viewer'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('org_members_org_user_unique').on(t.orgId, t.userId),
    // At most one owner per org: partial unique index (AUTH-08)
    uniqueIndex('org_members_one_owner_per_org').on(t.orgId).where(sql`role = 'owner'`),
    index('org_members_user_idx').on(t.userId),
  ],
);

export const orgPlans = pgTable(
  'org_plans',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    planName: text('plan_name').notNull().default('free'), // QUOTA-02 default
    maxAgents: integer('max_agents').notNull().default(5), // QUOTA-02 default
    maxConcurrentTasks: integer('max_concurrent_tasks').notNull().default(5), // QUOTA-02 default
    logRetentionDays: integer('log_retention_days').notNull().default(30), // QUOTA-02 default
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 1:1 with orgs per D-37 (one plan per org)
    uniqueIndex('org_plans_org_unique').on(t.orgId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(), // randomBytes(32) base64url — D-11
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // D-18: activeOrgId with SET NULL so org delete doesn't cascade-destroy sessions
    activeOrgId: text('active_org_id').references(() => orgs.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    // Partial index for auth hot path: active sessions only
    index('sessions_active_idx').on(t.userId).where(sql`revoked_at IS NULL`),
  ],
);

export const emailVerifications = pgTable(
  'email_verifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(), // randomBytes(32) base64url
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('email_verifications_token_unique').on(t.token),
    index('email_verifications_user_idx').on(t.userId),
  ],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('password_resets_token_unique').on(t.token),
    index('password_resets_user_idx').on(t.userId),
  ],
);

export const orgInvites = pgTable(
  'org_invites',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => orgs.id, { onDelete: 'cascade' }),
    inviterUserId: text('inviter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(), // invitee email; compared case-insensitive at acceptance
    role: text('role', { enum: ['member', 'viewer'] }).notNull(),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: text('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('org_invites_token_unique').on(t.token),
    index('org_invites_org_idx').on(t.orgId),
    index('org_invites_email_lower_idx').on(sql`lower(${t.email})`),
  ],
);

// Type inference per D-04 / general use
export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OrgMember = typeof orgMembers.$inferSelect;
export type NewOrgMember = typeof orgMembers.$inferInsert;
export type OrgPlan = typeof orgPlans.$inferSelect;
export type NewOrgPlan = typeof orgPlans.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type EmailVerification = typeof emailVerifications.$inferSelect;
export type NewEmailVerification = typeof emailVerifications.$inferInsert;
export type PasswordReset = typeof passwordResets.$inferSelect;
export type NewPasswordReset = typeof passwordResets.$inferInsert;
export type OrgInvite = typeof orgInvites.$inferSelect;
export type NewOrgInvite = typeof orgInvites.$inferInsert;
