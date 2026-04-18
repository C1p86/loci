---
"@xci/server": minor
"xci": minor
"@xci/web": minor
---

Phase 7: Bootstrap @xci/server package with database schema, authentication, sessions, and multi-tenant isolation. This is the first real code in @xci/server — previously a Phase 6 placeholder.

- Drizzle ORM schema for orgs, users, org_members, org_plans, sessions, email_verifications, password_resets, org_invites
- Argon2id password hashing (@node-rs/argon2)
- Session cookie (httpOnly+secure+sameSite=strict) with sliding 14d expiry, absolute 30d cap
- Email verification, password reset, org invite flows
- Multi-tenant isolation via scoped repository wrapper (forOrg) + two-org integration fixture
- Free org plan entity (max_agents=5, max_concurrent_tasks=5, log_retention_days=30) — enforcement in Phase 10
