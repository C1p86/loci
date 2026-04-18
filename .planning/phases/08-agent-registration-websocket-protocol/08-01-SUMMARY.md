---
phase: 08-agent-registration-websocket-protocol
plan: "01"
subsystem: xci-agent-scaffold
tags: [fence-reversal, websocket, schema, drizzle, multi-entry]
dependency_graph:
  requires: [06-monorepo-setup-backward-compat-fence, 07-database-schema-auth]
  provides: [agent-module-stub, ws-fence-reversed, agents-schema, drizzle-migration-0001]
  affects: [packages/xci, packages/server, biome.json, .github/workflows/ci.yml]
tech_stack:
  added:
    - ws@8.20.0 (runtime dep in xci)
    - reconnecting-websocket@4.4.0 (runtime dep in xci)
    - env-paths@4.0.0 (runtime dep in xci)
  patterns:
    - tsup multi-entry (cli + agent separate bundles)
    - argv pre-scan lazy import (cold-start preservation)
    - Drizzle pgTable with jsonb + partial uniqueIndex
key_files:
  created:
    - packages/xci/src/agent/index.ts
    - packages/xci/src/agent/types.ts
    - packages/server/drizzle/0001_agents_websocket.sql
    - packages/server/drizzle/meta/0001_snapshot.json
    - .changeset/phase-08-agent-registration.md
  modified:
    - packages/xci/package.json
    - packages/xci/tsup.config.ts
    - packages/xci/src/cli.ts
    - packages/xci/src/errors.ts
    - packages/server/src/db/schema.ts
    - packages/server/src/db/relations.ts
    - packages/server/drizzle/meta/_journal.json
    - biome.json
    - .github/workflows/ci.yml
decisions:
  - "ws/reconnecting-websocket kept external in tsup (D-01) — not bundled into cli.mjs; agent.mjs is the dedicated entry"
  - "argv pre-scan before any import ensures zero cold-start cost on non-agent paths (D-02)"
  - "Biome ws-fence narrowed to cli.ts only — agent module may import ws freely (D-01 reversal)"
  - "Drizzle partial uniqueIndex on agent_credentials enforces at-most-one active credential per agent at DB level (T-08-01-06)"
  - "jsonb labels column typed as Record<string,string> via .$type<>() — Drizzle emits correct DEFAULT '{}'::jsonb"
metrics:
  duration: ~20 minutes
  completed: 2026-04-18
  tasks_completed: 2
  files_changed: 14
---

# Phase 8 Plan 01: Phase 6 Fence Reversal + Schema Foundation Summary

Atomic Phase 6 ws-fence reversal combined with the three-table Drizzle schema foundation for agent registration and WebSocket protocol.

## What Was Built

### Task 1: Phase 6 Fence Reversal (commit 32c4887)

**Dependencies added** to `packages/xci/package.json`:
- `ws@8.20.0`
- `reconnecting-websocket@4.4.0`
- `env-paths@4.0.0`

**tsup multi-entry** — `entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' }`:
- `dist/cli.mjs` — 788 KB (near-zero delta from before; ws/rws remain external)
- `dist/agent.mjs` — 283 B (stub; grows in Plan 08-04)

**cli.ts argv pre-scan** — 3-line check for `--agent` before any Commander parsing; if found, lazy-loads `./agent/index.js` and delegates. Non-agent cold-start unaffected.

**agent/index.ts stub** — exports `runAgent(argv)` returning 0; imports `AgentFrame` type to prove tsup wiring.

**agent/types.ts** — `AgentFrame` discriminated union (D-15): register, reconnect, goodbye, state, register_ack, reconnect_ack, error variants.

**errors.ts** — 4 new CliError subclasses: `AgentModeArgsError`, `AgentRegistrationFailedError`, `AgentCredentialReadError`, `AgentCredentialWriteError`.

**biome.json** changes:
1. First override narrowed: `"packages/xci/src/**/*.ts"` → `"packages/xci/src/cli.ts"` (ws restriction now only covers cli entry)
2. Second override (Phase 7 server ws-block) deleted entirely
3. Third override extended with 6 new agent repo paths for D-01 enforcement

**ci.yml** — `WS-exclusion grep gate (D-16b)` step removed. Cold-start hyperfine gate stays.

### Task 2: Server Schema Extension (commit cd13a0d)

**Three new Drizzle tables** in `packages/server/src/db/schema.ts`:

| Table | Columns | Key Constraints |
|-------|---------|-----------------|
| `agents` | id, org_id, hostname, labels(jsonb), state, last_seen_at, registered_at, created_at, updated_at | FK orgs ON DELETE CASCADE; index (org_id, state) |
| `agent_credentials` | id, agent_id, org_id, credential_hash, created_at, revoked_at | FK agents + orgs ON DELETE CASCADE; partial unique WHERE revoked_at IS NULL; index (org_id, agent_id) |
| `registration_tokens` | id, org_id, token_hash, created_by_user_id, created_at, expires_at, consumed_at | FK orgs + users ON DELETE CASCADE; index org_id; partial index WHERE consumed_at IS NULL AND expires_at > now() |

**Relations** extended in `relations.ts`: agentsRelations, agentCredentialsRelations, registrationTokensRelations.

**Migration generated**: `packages/server/drizzle/0001_agents_websocket.sql`
- 3 CREATE TABLE statements
- 5 ALTER TABLE ADD CONSTRAINT (FK + ON DELETE CASCADE)
- 1 CREATE UNIQUE INDEX (partial: WHERE revoked_at IS NULL)
- 4 CREATE INDEX statements
- Journal updated with `idx: 1` entry

## Metrics

| Metric | Value |
|--------|-------|
| dist/cli.mjs size | 788 KB (near-zero delta — ws/rws remain external) |
| dist/agent.mjs size | 283 B (stub baseline) |
| Cold-start (mean, 5 runs) | 70.2 ms (PASS — under 300 ms D-29) |
| xci unit tests | 302/302 passed (BC-01, BC-02) |
| Server unit tests | 60/60 passed |
| hyperfine | Not available locally; CI cold-start gate will verify |

## Fence Reversal Checklist

| # | Item | Status |
|---|------|--------|
| 1 | ws + reconnecting-websocket + env-paths added to xci deps | Done |
| 2 | tsup external[] for ws/rws KEPT unchanged | Done |
| 3 | tsup entry changed to multi-entry object | Done |
| 4 | dist/cli.mjs contains zero ReconnectingWebSocket strings | Verified (grep → 0) |
| 5 | Biome override 1 narrowed to cli.ts | Done |
| 6 | Biome override 2 (Phase 7 server ws-block) deleted | Done |
| 7 | Biome override 3 extended with 6 agent repo paths | Done |
| 8 | CI WS-exclusion grep gate removed | Done |
| 9 | CI cold-start hyperfine gate KEPT | Done |
| 10 | 302 xci unit tests still green | Verified |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome formatting: long lines in schema.ts**
- **Found during:** Task 2 biome check
- **Issue:** Three lines exceeded 100-char line width: state enum chain, partial uniqueIndex chain, registration_tokens_active_idx chain
- **Fix:** Split chained method calls across lines per biome formatter expectations
- **Files modified:** packages/server/src/db/schema.ts
- **Commit:** cd13a0d

**2. [Rule 1 - Bug] Biome organizeImports: missing blank line after import in agent/index.ts**
- **Found during:** Task 1 biome check on agent module
- **Issue:** `assist/source/organizeImports` required blank line after import statement
- **Fix:** Added blank line between import and void expression
- **Files modified:** packages/xci/src/agent/index.ts
- **Commit:** 32c4887

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `runAgent` returns 0 immediately | packages/xci/src/agent/index.ts:9 | Intentional — full daemon implementation lands in Plan 08-04 |

## Threat Flags

None — all new surface (ws-gated agent module, 3 new DB tables) is within the plan's threat model. No unexpected network endpoints, auth paths, or schema changes outside T-08-01-01 through T-08-01-07.

## Self-Check: PASSED

- `packages/xci/dist/cli.mjs` — FOUND
- `packages/xci/dist/agent.mjs` — FOUND
- `packages/server/drizzle/0001_agents_websocket.sql` — FOUND
- `packages/server/drizzle/meta/_journal.json` idx:1 — FOUND
- commit 32c4887 — FOUND
- commit cd13a0d — FOUND
