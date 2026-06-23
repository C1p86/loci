# @xci/server

## 0.3.2

### Patch Changes

- Updated dependencies [11c84dc]
- Updated dependencies [2e294fd]
  - xci@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [25dead7]
- Updated dependencies [3c90081]
  - xci@0.3.1

## 0.3.0

### Minor Changes

- 5b6a5df: Phase 7: Bootstrap @xci/server package with database schema, authentication, sessions, and multi-tenant isolation. This is the first real code in @xci/server — previously a Phase 6 placeholder.

  - Drizzle ORM schema for orgs, users, org_members, org_plans, sessions, email_verifications, password_resets, org_invites
  - Argon2id password hashing (@node-rs/argon2)
  - Session cookie (httpOnly+secure+sameSite=strict) with sliding 14d expiry, absolute 30d cap
  - Email verification, password reset, org invite flows
  - Multi-tenant isolation via scoped repository wrapper (forOrg) + two-org integration fixture
  - Free org plan entity (max_agents=5, max_concurrent_tasks=5, log_retention_days=30) — enforcement in Phase 10

- 32c4887: feat(phase-08): agent registration scaffold (Phase 6 fence partially reversed)

  - xci: add `ws`, `reconnecting-websocket`, `env-paths` deps; lazy-loaded agent module entry (`dist/agent.mjs`) behind `--agent` flag
  - @xci/server: add `agents`, `agent_credentials`, `registration_tokens` tables (org-scoped, Phase 7 forOrg pattern)
  - CI: removed WS-exclusion grep gate (agent mode legitimately uses ws)
  - Biome: narrowed ws-restriction to packages/xci/src/cli.ts only; agent module may import ws/reconnecting-websocket

  No user-facing agent flows yet (Plans 08-02 through 08-04 deliver the full protocol).

### Patch Changes

- Updated dependencies [5b6a5df]
- Updated dependencies [32c4887]
- Updated dependencies [8aafe42]
- Updated dependencies [3cd5c18]
  - xci@0.3.0
