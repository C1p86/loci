# Phase 8: Agent Registration & WebSocket Protocol — Pattern Map

**Mapped:** 2026-04-18
**Files analyzed:** ~40 new files + 7 modified files across `packages/xci/`, `packages/server/`, and root infrastructure.
**Analogs found:** 28 files map to exact or near-exact analogs in Phase 7 server code (repos/routes/errors). 6 files mirror existing xci patterns (`errors.ts`, `__tests__` style, argv parsing). 4 infra files (tsup config, biome, CI, package.json) are existing-file MODIFICATIONS (fence reversal). ~8 files are GREENFIELD (agent module, WS handler, frame types) — patterns sourced from RESEARCH.md.
**Source of truth:** CONTEXT.md D-01..D-43 (locked), RESEARCH.md §WS protocol + §Drizzle schema + §Fence Reversal Checklist, Phase 7 PATTERNS as the inheritance baseline.

---

## Framing

Phase 8 is a **dual-codebase phase**:

1. **xci CLI** grows a lazy-loaded **agent daemon** under `packages/xci/src/agent/`. No existing WS code — purely greenfield from RESEARCH.md. The **only xci analogs** are: `cli.ts` argv pattern + early exits, `errors.ts` `LociError` hierarchy discipline, `__tests__/` colocation convention.
2. **@xci/server** grows a WS endpoint + 5 REST routes + 3 new org-scoped repos + schema extension. **Phase 7 patterns are the primary analog source** — the server Phase-7 pattern map applies wholesale (forOrg scoped repos, Biome `noRestrictedImports` over routes/plugins, error hierarchy, per-route CSRF opt-in, two-org isolation tests + auto-discovery meta-test, testcontainers harness).
3. **Infrastructure** — Phase 6 fence (D-16(b) CI grep gate + D-16(c) Biome rule) is **partly reversed in this phase**. The fence's own change history in `.github/workflows/ci.yml`, `biome.json`, and `packages/xci/tsup.config.ts` is the best self-analog for the reversal.

**The Phase 6 fence reversal is the single most load-bearing infrastructure moment of Phase 8.** It MUST be atomic with the first agent-module scaffold (see §Sequencing / §Phase 6 Fence Reversal Checklist).

**Phase 7 D-01 discipline continues to apply unchanged:** new `agents.ts`, `agent-credentials.ts`, `registration-tokens.ts` repo files are NOT exported from `repos/index.ts`; only the existing `makeRepos()` barrel (extended) is exported. The Biome override that blocks `../repos/users.js` direct imports (third override block, lines 92-126 of current `biome.json`) must be **extended** with the three new file names.

---

## File Classification

### NEW files — xci agent module (`packages/xci/src/agent/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/xci/src/agent/index.ts` | entry / controller | event-driven (daemon loop) | `packages/xci/src/cli.ts` `main()` entry | partial (entry-point concept, argv parsing, error→exit code shape); **most logic is greenfield — see RESEARCH §Argv Pre-Scan + §Graceful Shutdown** |
| `packages/xci/src/agent/client.ts` | service (WS wrapper) | event-driven (pub-sub WS events) | — | **greenfield — see RESEARCH §reconnecting-websocket Node.js Usage + §Heartbeat** |
| `packages/xci/src/agent/credential.ts` | utility (file-I/O + TOFU) | file-I/O | — | **greenfield — see RESEARCH §Cross-Platform Credential Storage** |
| `packages/xci/src/agent/labels.ts` | utility | transform | — | **greenfield — trivial** (`os.hostname()`, `process.arch`, `process.version`, parse `--label key=value`) |
| `packages/xci/src/agent/state.ts` | model (in-memory state) | transform | — | **greenfield — stub in Phase 8**; `running_runs: []` placeholder per D-26 |
| `packages/xci/src/agent/types.ts` | model (frame envelope) | transform | `packages/xci/src/types.ts` (type-only contracts file discipline) | partial (discipline only); **frame shape from RESEARCH §WS Handshake Protocol + CONTEXT D-15** |
| `packages/xci/src/agent/__tests__/test-server.ts` | test utility | event-driven | — | **greenfield — see RESEARCH §Agent-Side Mock Server (D-32)** |
| `packages/xci/src/agent/__tests__/credential.test.ts` | test | file-I/O | `packages/xci/src/__tests__/errors.test.ts` (test style) | partial (vitest + `.js` imports only) |
| `packages/xci/src/agent/__tests__/labels.test.ts` | test | transform | `packages/xci/src/__tests__/errors.test.ts` | partial (test style) |
| `packages/xci/src/agent/__tests__/client.integration.test.ts` | test (integration) | event-driven | — | **greenfield — uses test-server.ts harness** |
| `packages/xci/src/__tests__/cold-start.test.ts` | test (smoke) | request-response | — | **greenfield** — uses `child_process.spawnSync` to time `xci --version` (CONTEXT Specifics line 326) |

### NEW files — server WS layer (`packages/server/src/ws/` + WS route)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/ws/handler.ts` | service (WS connection handler) | event-driven | — | **greenfield — see RESEARCH §WS Handshake Protocol** |
| `packages/server/src/ws/heartbeat.ts` | service | event-driven | — | **greenfield — see RESEARCH §Heartbeat Implementation** |
| `packages/server/src/ws/registry.ts` | model (in-memory Map) | transform | — | **greenfield — see RESEARCH §Connection Registry Decoration** |
| `packages/server/src/ws/frames.ts` | utility (parse + validate frames) | transform | — | **greenfield — hand-rolled discriminated union narrow per CONTEXT D-15; no zod** |
| `packages/server/src/ws/__tests__/handler.integration.test.ts` | test (integration) | event-driven | `packages/server/src/repos/__tests__/admin.integration.test.ts` (testcontainers + buildApp + ephemeral port is new) | partial — see RESEARCH §Server-Side WS Tests |

### NEW files — server REST routes (`packages/server/src/routes/agents/`)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/routes/agents/tokens.ts` | controller (POST) | request-response | `packages/server/src/routes/orgs/invites.ts` (`invitesRoute` POST /:orgId/invites) | **exact** — Owner/Member + CSRF + preHandler requireAuth + schema validation + return plaintext-once |
| `packages/server/src/routes/agents/list.ts` | controller (GET) | request-response | `packages/server/src/routes/orgs/invites.ts` (`invitesRoute` GET /:orgId/invites) | **exact** — session + org-match + forOrg().agents.list(); compute `online` read-side per D-12 |
| `packages/server/src/routes/agents/patch.ts` | controller (PATCH) | request-response | `packages/server/src/routes/orgs/invites.ts` (`membersRoute` PATCH) | **exact** — Owner/Member + CSRF + schema (`hostname` OR `state`) |
| `packages/server/src/routes/agents/revoke.ts` | controller (POST action) | request-response | `packages/server/src/routes/orgs/invites.ts` (`invitesRoute` DELETE revoke) | **near-exact** — same Owner/Member + CSRF pattern; side-effect: force-close WS via `fastify.agentRegistry` |
| `packages/server/src/routes/agents/delete.ts` | controller (DELETE) | request-response | `packages/server/src/routes/orgs/invites.ts` DELETE | **exact shape**; Owner-only + CSRF; cascade via FK (D-10) |
| `packages/server/src/routes/agents/index.ts` | barrel (registers 5 REST + 1 WS route) | — | `packages/server/src/routes/orgs/index.ts` | **exact** (6 lines: register each subroute) |
| `packages/server/src/routes/agents/__tests__/tokens.integration.test.ts` | test | request-response | Phase 7 HTTP integration test (if exists, else `admin.integration.test.ts`) | role-match (`fastify.inject()` pattern per Phase 7 D-24) |
| `packages/server/src/routes/agents/__tests__/list.integration.test.ts` | test | request-response | same | role-match |
| `packages/server/src/routes/agents/__tests__/patch.integration.test.ts` | test | request-response | same | role-match |
| `packages/server/src/routes/agents/__tests__/revoke.integration.test.ts` | test | request-response | same | role-match |
| `packages/server/src/routes/agents/__tests__/delete.integration.test.ts` | test | request-response | same | role-match |
| `packages/server/src/routes/agents/__tests__/ws-url-token-rejected.integration.test.ts` | test (security) | event-driven | — | **greenfield — verifies ATOK-03 (token in URL → reject)** |

### NEW files — server repos

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `packages/server/src/repos/agents.ts` | service (repo, org-scoped) | CRUD | `packages/server/src/repos/users.ts` + `packages/server/src/repos/org-invites.ts` | **exact** — `makeAgentsRepo(db, orgId)` factory, never exported from index.ts |
| `packages/server/src/repos/agent-credentials.ts` | service (repo, org-scoped) | CRUD | `packages/server/src/repos/org-invites.ts` | **exact** — single-active partial unique index precedent (org_members owner index, schema.ts line 60) |
| `packages/server/src/repos/registration-tokens.ts` | service (repo, org-scoped) | CRUD | `packages/server/src/repos/org-invites.ts` | **exact** — token issuance, list pending, revoke |
| `packages/server/src/repos/__tests__/agents.isolation.test.ts` | test | CRUD | `packages/server/src/repos/__tests__/users.isolation.test.ts` | **exact** — two-org fixture + `seedTwoOrgs` + `forOrg(orgA).agents` vs orgB data |
| `packages/server/src/repos/__tests__/agent-credentials.isolation.test.ts` | test | CRUD | `packages/server/src/repos/__tests__/org-invites.isolation.test.ts` | **exact** |
| `packages/server/src/repos/__tests__/registration-tokens.isolation.test.ts` | test | CRUD | `packages/server/src/repos/__tests__/org-invites.isolation.test.ts` | **exact** |

### MODIFIED files — server (extensions, NOT replacements)

| Modified File | Kind of Change | Reference Analog / Pattern |
|---------------|----------------|----------------------------|
| `packages/server/src/db/schema.ts` | Append 3 tables + $inferSelect/$inferInsert types | Same file, append after existing `orgInvites` (lines 142-168); mirror `uniqueIndex('...').where(sql`...`)` from line 60 (owner) & line 102 (sessions active partial index); `jsonb` column — see RESEARCH §Drizzle Schema for Phase 8 |
| `packages/server/src/db/relations.ts` | Add 3 new relation blocks | Same file — mirror `sessionsRelations` (lines 26-29) shape |
| `packages/server/src/repos/for-org.ts` | Add 3 new factory calls into the returned object | Same file — copy the 6 existing lines 16-21 pattern |
| `packages/server/src/repos/admin.ts` | Add 5 new cross-org helpers (D-37) | Same file — mirror `findInviteByToken` / `markInviteAccepted` / `createEmailVerification` patterns (lines 95-97, 136-149, 315-329) |
| `packages/server/src/repos/__tests__/isolation-coverage.isolation.test.ts` | **NO CODE CHANGE NEEDED** — auto-discovers the 3 new repos via file-system walk (line 21-25) | Existing meta-test does the work |
| `packages/server/src/crypto/tokens.ts` | Add `compareToken()` + `hashToken()`; extend `generateId` prefix union with `'agt' \| 'crd' \| 'rtk'` | Same file (currently 20 lines) — see RESEARCH §crypto.timingSafeEqual Usage, RESEARCH Open Q #4 |
| `packages/server/src/errors.ts` | Add concrete subclasses: `AgentTokenInvalidError extends AuthnError`, `AgentRevokedError extends AuthnError`, `RegistrationTokenExpiredError extends AuthnError`, `AgentFrameInvalidError extends ValidationError`, `AgentHandshakeTimeoutError extends AuthnError` | Same file — mirror `TokenInvalidError` (lines 135-140) + `InvalidCredentialsError` (lines 113-118); NEVER accept credential plaintext in the constructor (D-10 discipline) |
| `packages/server/src/__tests__/errors.test.ts` | Add new subclasses to `oneOfEachConcrete()` factory; code-uniqueness test auto-catches duplicates | Same test file (Phase 7 pattern — mirrors xci `errors.test.ts`) |
| `packages/server/src/app.ts` | `app.decorate('agentRegistry', new Map())` BEFORE `app.register(fastifyWebsocket, ...)`; register `@fastify/websocket@11.2.0` AFTER auth plugin, BEFORE `registerRoutes` | Same file — extend plugin chain (lines 57-95) per Pitfall 8 + RESEARCH §Updated Plugin Order |
| `packages/server/src/routes/index.ts` | `await fastify.register(registerAgentRoutes, { prefix: '/orgs' })` for REST; WS route registers WITHOUT `/api` prefix (see RESEARCH §WS Route Definition) | Same file (current 20 lines) — mirror `registerOrgRoutes` registration (line 16) |
| `packages/server/package.json` | Add `"@fastify/websocket": "11.2.0"` to `dependencies`; `"@types/ws": "8.18.1"` to `devDependencies` | Phase 7 dep shape |

### MODIFIED files — xci (fence-reversal + lazy-import wiring)

| Modified File | Kind of Change | Reference Analog |
|---------------|----------------|------------------|
| `packages/xci/package.json` | Add `"ws": "8.20.0"`, `"reconnecting-websocket": "4.4.0"`, `"env-paths": "4.0.0"` to `dependencies` | Current file (lines 21-25) — keep `commander`, `execa`, `yaml` unchanged |
| `packages/xci/tsup.config.ts` | Change `entry: ['src/cli.ts']` (line 7) → `entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' }`; **KEEP `external: ['ws', 'reconnecting-websocket']` (line 18) unchanged**; **KEEP `noExternal` regex (line 17) unchanged**; **KEEP `splitting: false` (line 23)** | Current file — see RESEARCH §Lazy Import in tsup-Bundled ESM + Pitfall 6 |
| `packages/xci/src/cli.ts` | Add a ~10-line argv pre-scan at top of `async function main(argv)` (before existing `--get-completions` check at line 708) | RESEARCH §Argv Pre-Scan in cli.ts + existing `--get-completions` early exit (line 708) as the shape analog |
| `packages/xci/src/errors.ts` | Add `AgentModeArgsError extends CliError`, `AgentRegistrationFailedError extends CliError`, `AgentCredentialReadError extends CliError`, `AgentCredentialWriteError extends CliError` | Current file (lines 204-221) — mirror `UnknownFlagError` / `NotImplementedError` |

### MODIFIED files — root infrastructure (Phase 6 fence reversal)

| Modified File | Kind of Change | Reference Analog |
|---------------|----------------|------------------|
| `biome.json` | (1) Narrow first override `includes` from `"packages/xci/src/**/*.ts"` (line 49) to `"packages/xci/src/cli.ts"`; (2) DELETE entire second override block for `"packages/server/src/**"` (lines 70-91); (3) EXTEND third override `paths` map with new agent repo entries | Current file — see §Phase 6 Fence Reversal Checklist below |
| `.github/workflows/ci.yml` | REMOVE the "WS-exclusion grep gate (D-16b)" step (lines 70-76 of current workflow). Fence-gates job KEEPS the cold-start gate (D-17, lines 78-95). Integration-tests job unchanged | Current file |
| `.changeset/*.md` | Add a new changeset describing Phase 8 changes: `xci` feat (agent mode), `@xci/server` feat (agent registration + WS protocol) | Existing changeset convention (fixed-versioning per Phase 6 D-11) |

---

## Pattern Assignments

### `packages/server/src/repos/agents.ts` (service, CRUD)

**Analog:** `packages/server/src/repos/users.ts` (33 lines) + `packages/server/src/repos/org-invites.ts` (98 lines) for time-guarded reads and updates

**Copy pattern — imports & factory header** (`packages/server/src/repos/users.ts` lines 1-5):
```typescript
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { orgMembers, users } from '../db/schema.js';

export function makeUsersRepo(db: PostgresJsDatabase, orgId: string) {
  return {
    async findByEmail(email: string) { ... }
  };
}
```

**Copy pattern — org-scoped read** (`packages/server/src/repos/users.ts` lines 7-14):
```typescript
async findByEmail(email: string) {
  return db
    .select({ user: users })
    .from(users)
    .innerJoin(orgMembers, eq(orgMembers.userId, users.id))
    .where(and(eq(orgMembers.orgId, orgId), eq(users.email, email.toLowerCase())))
    .limit(1);
},
```

**Copy pattern — mutation with `sql\`now()\`` and satisfies** (`packages/server/src/repos/org-invites.ts` lines 14-28):
```typescript
async create(params: { inviterUserId: string; email: string; role: 'member' | 'viewer' }):
  Promise<{ id: string; token: string; expiresAt: Date }> {
  const id = generateId('inv');
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const payload = { id, orgId, inviterUserId: params.inviterUserId, email: params.email.toLowerCase(),
    role: params.role, token, expiresAt } satisfies NewOrgInvite;
  await db.insert(orgInvites).values(payload);
  return { id, token, expiresAt };
},
```

**Methods for agents.ts** (from RESEARCH §Pattern for Three New Tables):
- `list()` — `where(eq(agents.orgId, orgId))`
- `getById(id)` — `where(and(eq(agents.orgId, orgId), eq(agents.id, id)))`
- `create({hostname, labels})` — uses `generateId('agt')` (tokens.ts union extension)
- `updateState(id, state)` — `.set({ state, updatedAt: sql\`now()\` })`
- `updateHostname(id, hostname)` — same shape
- `recordHeartbeat(id)` — `.set({ lastSeenAt: sql\`now()\`, updatedAt: sql\`now()\` })` (hot path: called on every pong)
- `delete(id)` — hard delete (CASCADE covers agent_credentials per D-10 schema)

**D-01 constraint:** `export function makeAgentsRepo` is NEVER added to `packages/server/src/repos/index.ts`. Only `forOrg(orgId).agents` (from extended `for-org.ts`) is reachable from routes.

---

### `packages/server/src/repos/agent-credentials.ts` (service, CRUD with partial unique index)

**Analog:** `packages/server/src/repos/org-invites.ts` (98 lines) for the revoke/isNull(revokedAt) pattern

**Copy pattern — revoke with conditional WHERE** (`packages/server/src/repos/org-invites.ts` lines 66-78):
```typescript
async revoke(inviteId: string) {
  return db
    .update(orgInvites)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(orgInvites.id, inviteId),
        eq(orgInvites.orgId, orgId),
        isNull(orgInvites.acceptedAt),
        isNull(orgInvites.revokedAt),
      ),
    );
},
```

**Critical schema note (from RESEARCH §Drizzle Schema):**
```typescript
uniqueIndex('agent_credentials_one_active_per_agent')
  .on(t.agentId)
  .where(sql`revoked_at IS NULL`),
```
Precedent in current `packages/server/src/db/schema.ts` line 60 (`org_members_one_owner_per_org`) confirms this syntax works in Drizzle. **Planner acceptance criterion:** `createForAgent` MUST first call `revokeForAgent(agentId)` inside a transaction, else the partial unique index will throw PG 23505 on second credential issuance.

**Methods:**
- `createForAgent(agentId, credentialHash)` — inside a transaction that first revokes existing active credential
- `revokeForAgent(agentId)` — sets `revoked_at = now()` where `revoked_at IS NULL`
- `findActiveByAgentId(agentId)` — scoped, filter `isNull(revokedAt)`

---

### `packages/server/src/repos/registration-tokens.ts` (service, CRUD)

**Analog:** `packages/server/src/repos/org-invites.ts` (token creation + list pending + revoke + mark consumed)

**Copy pattern — list pending with multi-guard** (`packages/server/src/repos/org-invites.ts` lines 51-63):
```typescript
async listPending() {
  return db
    .select()
    .from(orgInvites)
    .where(
      and(
        eq(orgInvites.orgId, orgId),
        isNull(orgInvites.acceptedAt),
        isNull(orgInvites.revokedAt),
        gt(orgInvites.expiresAt, sql`now()`),
      ),
    );
},
```

**Methods:**
- `create(createdByUserId)` — generates plaintext token via `generateToken()`, stores `tokenHash = hashToken(plaintext)`, returns plaintext ONCE (only time it ever leaves the server unhashed)
- `listActive()` — `isNull(consumedAt)` + `gt(expiresAt, sql\`now()\`)`
- `revoke(id)` — optional per scope; simplest is to set `consumed_at = now()` as a de-facto revoke

**Pitfall:** `consume` lives in `adminRepo` (not this repo) — handshake doesn't know `orgId` until token is validated.

---

### `packages/server/src/repos/admin.ts` (MODIFIED — adminRepo extensions per D-37)

**Analog:** existing functions in the same file — `findInviteByToken` (lines 95-97), `markInviteAccepted` (lines 315-329), `createEmailVerification` (lines 136-149), and especially the `signupTx` transaction pattern (lines 48-83) for `registerNewAgent`.

**Copy pattern — cross-org lookup by token** (`packages/server/src/repos/admin.ts` lines 95-97):
```typescript
async findInviteByToken(token: string) {
  return db.select().from(orgInvites).where(eq(orgInvites.token, token)).limit(1);
},
```

**Adapt for registration tokens** (note: stored as hash, not plaintext):
```typescript
async findValidRegistrationToken(tokenPlaintext: string) {
  const hash = hashToken(tokenPlaintext);
  // Cross-org lookup — no orgId filter (handshake doesn't know orgId yet)
  return db
    .select()
    .from(registrationTokens)
    .where(
      and(
        eq(registrationTokens.tokenHash, hash),
        isNull(registrationTokens.consumedAt),
        gt(registrationTokens.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
},
```

**Copy pattern — atomic transaction** (`packages/server/src/repos/admin.ts` lines 60-71, `signupTx`):
```typescript
await db.transaction(async (tx) => {
  await tx.insert(users).values({ id: userId, email, passwordHash } satisfies NewUser);
  await tx.insert(orgs).values({ id: orgId, name: orgName, slug, isPersonal: true });
  await tx.insert(orgMembers).values({ id: generateId('mem'), orgId, userId, role: 'owner' });
  await tx.insert(orgPlans).values({ id: generateId('plan'), orgId });
});
```

**Adapt for `registerNewAgent({orgId, hostname, labels})`:**
```typescript
async registerNewAgent(params: { orgId: string; hostname: string; labels: Record<string, string> }):
  Promise<{ agentId: string; credentialPlaintext: string }> {
  const agentId = generateId('agt');
  const credPlaintext = generateToken();
  const credHash = hashToken(credPlaintext);
  await db.transaction(async (tx) => {
    await tx.insert(agents).values({ id: agentId, orgId: params.orgId, hostname: params.hostname,
      labels: params.labels, state: 'online', lastSeenAt: new Date(), registeredAt: new Date() });
    await tx.insert(agentCredentials).values({ id: generateId('crd'), agentId, orgId: params.orgId,
      credentialHash: credHash });
  });
  return { agentId, credentialPlaintext: credPlaintext };
},
```

**All 5 new adminRepo helpers required (D-37):**
1. `findValidRegistrationToken(tokenPlaintext)` — cross-org, returns `{id, orgId, createdByUserId}`
2. `consumeRegistrationToken(tokenId)` — atomic `UPDATE ... SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL` returning orgId
3. `findActiveAgentCredential(credentialPlaintext)` — cross-org; returns `{agentId, orgId}` or null. Uses `hashToken(provided)` + `eq(credentialHash, hash)` + `isNull(revokedAt)`. For EXTRA safety layer on top of the hash equality, the planner MAY additionally pull the stored hash and call `compareToken` — but `eq` on sha256 hashes is already constant-time at the SQL layer.
4. `registerNewAgent({orgId, hostname, labels})` — transaction above
5. `issueAgentCredential(agentId, orgId)` — transaction: revoke old + insert new; returns plaintext ONCE

---

### `packages/server/src/repos/__tests__/agents.isolation.test.ts` (test, CRUD)

**Analog (exact):** `packages/server/src/repos/__tests__/users.isolation.test.ts` (35 lines).

**Copy verbatim — adjust import + assertion** (`packages/server/src/repos/__tests__/users.isolation.test.ts` lines 1-34):
```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeUsersRepo } from '../users.js';

describe('users repo isolation (D-04)', () => {
  beforeEach(async () => resetDb());

  it('findByEmail scoped to orgA never returns orgB user', async () => {
    const db = getTestDb();
    const f = await seedTwoOrgs(db);
    const repoA = makeUsersRepo(db, f.orgA.id);
    const result = await repoA.findByEmail(f.orgB.ownerUser.email);
    expect(result).toEqual([]);
  });
  // ... one it() per exported function
});
```

**Convention enforced by `isolation-coverage.isolation.test.ts`** (lines 40-55 of that file):
> Every `export function make\w+Repo` in the repo file must be referenced by name in the test file.

**Planner acceptance criterion:** one `it()` per `makeAgentsRepo` method (list, getById, create, updateState, updateHostname, recordHeartbeat, delete) — orgA's call must return empty/no-effect when aimed at orgB's data. `seedTwoOrgs()` helper needs a **tiny extension** to seed an agent per org (or the test seeds agents inline via `makeAgentsRepo(db, orgX.id).create({...})`). **Same applies to `agent-credentials.isolation.test.ts` and `registration-tokens.isolation.test.ts`.**

---

### `packages/server/src/routes/agents/tokens.ts` (controller, Owner/Member + CSRF + rate-limit)

**Analog (exact):** `packages/server/src/routes/orgs/invites.ts` `invitesRoute` POST (lines 32-88).

**Copy pattern — route options + schema + body validation** (`packages/server/src/routes/orgs/invites.ts` lines 32-48):
```typescript
fastify.post<{ Params: { orgId: string }; Body: CreateInviteBody }>(
  '/:orgId/invites',
  {
    onRequest: [fastify.csrfProtection],
    preHandler: [fastify.requireAuth],
    schema: {
      body: {
        type: 'object',
        required: ['email', 'role'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          role: { type: 'string', enum: ['member', 'viewer'] },
        },
      },
    },
  },
  async (req, reply) => { ... }
);
```

**Copy pattern — role/org match guard** (`packages/server/src/routes/orgs/invites.ts` lines 14-19):
```typescript
function requireOwnerAndOrgMatch(req: FastifyRequest): void {
  const urlOrgId = (req.params as { orgId: string }).orgId;
  if (!req.org) throw new SessionRequiredError();
  if (req.org.id !== urlOrgId) throw new OrgMembershipRequiredError(urlOrgId);
  if (req.org.role !== 'owner') throw new RoleInsufficientError('owner');
}
```

**Divergence for agent-tokens (Owner AND Member — D-19):** Write a parallel helper `requireOwnerOrMemberAndOrgMatch(req)` that allows `role === 'owner' || role === 'member'` (NOT viewer). Same shape.

**Copy pattern — makeRepos + forOrg call + 201 response with plaintext** (`packages/server/src/routes/orgs/invites.ts` lines 57-85):
```typescript
const repos = makeRepos(fastify.db);
const created = await repos.forOrg(orgId).invites.create({
  inviterUserId: userId,
  email: req.body.email,
  role: req.body.role,
});
// ... email send ...
return reply.status(201).send({
  inviteId: created.id,
  token: created.token,   // plaintext — shown ONCE
  expiresAt: created.expiresAt.toISOString(),
});
```

**Rate limit (D-40):** 10/h per org+user — add via `config.rateLimit` on the route options OR pre-registered `@fastify/rate-limit` keyGenerator. Both patterns acceptable; RESEARCH references Phase 7 pattern usage.

---

### `packages/server/src/routes/agents/revoke.ts` (controller + side-effect on WS registry)

**Analog (mostly exact):** `packages/server/src/routes/orgs/invites.ts` DELETE handler (lines 114-152). Divergence: side-effect must close the live WS if registry has an entry for the agentId.

**Copy pattern — then add the WS close side-effect:**
```typescript
const conn = fastify.agentRegistry.get(req.params.agentId);
if (conn) {
  conn.close(4001, 'revoked');   // app-defined close code per RESEARCH §Close Codes
  fastify.agentRegistry.delete(req.params.agentId);
}
await repos.forOrg(orgId).agentCredentials.revokeForAgent(req.params.agentId);
```

**ATOK-04 acceptance criterion:** a route-level integration test must verify that a connected agent's WS receives close code 4001 within 500ms of the revoke call.

---

### `packages/server/src/routes/agents/index.ts` (barrel — 5 REST + 1 WS)

**Analog (exact):** `packages/server/src/routes/orgs/index.ts` (7 lines).

**Mirror wholesale** (`packages/server/src/routes/orgs/index.ts`):
```typescript
import type { FastifyPluginAsync } from 'fastify';
import { invitesRoute, membersRoute } from './invites.js';

export const registerOrgRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(invitesRoute);
  await fastify.register(membersRoute);
};
```

**Divergence (critical per RESEARCH §WS Route Definition):** The WS route `GET /ws/agent` must be registered WITHOUT the `/api` prefix. Two ways:
1. Register the WS handler in `packages/server/src/routes/index.ts` BEFORE `fastify.register(registerRoutes, { prefix: '/api' })` in `app.ts` — but `registerRoutes` is the thing being prefixed, so the WS registration needs to go in `app.ts` directly OR in a new sibling barrel `registerWsRoutes` registered with no prefix.
2. Use `fastify.register(wsHandler, { prefix: '' })` and register `wsHandler` **outside** the `registerRoutes` barrel.

**Planner decision point (from RESEARCH §Recommended File Structure):** Put the WS route registration in `packages/server/src/routes/agents/index.ts` BUT register the agent barrel twice in `app.ts` — once for REST (with `/api/orgs` prefix) and once for WS (no prefix). OR simpler: register WS handler directly in `app.ts` alongside `@fastify/websocket` plugin setup.

---

### `packages/server/src/app.ts` (MODIFIED — plugin chain extension)

**Analog (exact — the same file):** existing plugin chain (lines 57-95).

**Mirror existing order, insert NEW lines per RESEARCH §Updated Plugin Order:**
```typescript
// ...existing register calls...
await app.register(authPlugin, opts.clock !== undefined ? { clock: opts.clock } : {});
await app.register(errorHandlerPlugin);

// Phase 8 ADDITIONS — MUST be in this exact order:
app.decorate('agentRegistry', new Map());  // Pitfall 8 — BEFORE fastifyWebsocket registration
await app.register(fastifyWebsocket, {
  options: { maxPayload: 65536 },
  preClose: async function () {
    for (const client of this.websocketServer.clients) {
      client.close(1001, 'Server shutting down');
    }
  },
});

await app.register(registerRoutes, { prefix: '/api' });
```

**Copy pattern — module augmentation for decorator types** (`packages/server/src/app.ts` lines 100-105):
```typescript
declare module 'fastify' {
  interface FastifyInstance {
    emailTransport: EmailTransport;
    agentRegistry: Map<string, WebSocket>;   // Phase 8 addition
  }
}
```

---

### `packages/server/src/ws/handler.ts` (greenfield — WS handshake + routing)

**No analog in this repo.** Source pattern: RESEARCH §WS Handshake Protocol (server-side handler pseudocode, lines 654-691).

**Greenfield skeleton the planner must implement:**
```typescript
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { parseAgentFrame } from './frames.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { AgentFrameInvalidError, AgentHandshakeTimeoutError, AgentTokenInvalidError } from '../errors.js';

export async function handleAgentConnection(
  fastify: FastifyInstance,
  socket: WebSocket,
  request: FastifyRequest,
): Promise<void> {
  let authenticated = false;
  let agentId: string | null = null;
  const handshakeTimer = setTimeout(() => {
    if (!authenticated) socket.close(4005, 'handshake_timeout');
  }, 5000);

  socket.on('message', async (data) => { /* parse + route per frame.type */ });
  socket.on('close', async () => { /* clean up registry + DB state */ });
  socket.on('error', (err) => fastify.log.error({ err }, 'agent ws error'));
}
```

**Critical Pitfall 4:** `socket.on('message', ...)` MUST be registered synchronously at the top — NEVER inside an `await` block. Messages arriving during an await are dropped silently.

---

### `packages/server/src/ws/heartbeat.ts` (greenfield — ping/pong)

**No analog.** Source pattern: RESEARCH §Heartbeat Implementation (lines 694-732).

**Key constants from CONTEXT D-16:**
- `setInterval(ping, 25_000)` — 25s ping interval
- `setTimeout(close(4003, 'heartbeat_timeout'), 10_000)` — 10s pong timeout
- `socket.on('pong', ...)` updates `last_seen_at` via `forOrg(orgId).agents.recordHeartbeat(agentId)`

---

### `packages/server/src/ws/frames.ts` (greenfield — hand-rolled discriminated union parse)

**No analog.** Source pattern: CONTEXT D-15 (frame envelope schema) + CONTEXT "Claude's Discretion" note: "lean hand-rolled to avoid adding zod just for this".

**Pattern — hand-rolled narrowing:**
```typescript
import { AgentFrameInvalidError } from '../errors.js';
import type { AgentFrame } from './types.js';  // discriminated union

export function parseAgentFrame(raw: string): AgentFrame {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch (err) { throw new AgentFrameInvalidError('json'); }
  if (typeof obj !== 'object' || obj === null || typeof (obj as {type?: unknown}).type !== 'string') {
    throw new AgentFrameInvalidError('missing type');
  }
  const type = (obj as { type: string }).type;
  switch (type) {
    case 'register': { /* validate token:string + labels:Record<string,string> */ return ... }
    case 'reconnect': { /* validate credential:string + running_runs:RunState[] */ return ... }
    case 'goodbye': { /* validate running_runs */ return ... }
    default: throw new AgentFrameInvalidError(`unknown type: ${type}`);
  }
}
```

**ALL seven frame types from CONTEXT D-15 must be declared in `types.ts`; only `register`, `reconnect`, `goodbye` are parsed on the server side (the rest are server→agent).**

---

### `packages/xci/src/agent/index.ts` (entry / controller — lazy-loaded daemon)

**Partial analog:** `packages/xci/src/cli.ts` `main()` (lines 706-909) — entry-point concept (argv parsing → error-to-exit-code) only.

**Copy pattern — error-to-exit-code shape** (`packages/xci/src/cli.ts` lines 557-605, `handleError`):
```typescript
function handleError(err: unknown): number {
  if (err instanceof XciError) {
    process.stderr.write(`error [${err.code}]: ${err.message}\n`);
    if (err.cause) { ... }
    if (err.suggestion) process.stderr.write(`  suggestion: ${err.suggestion}\n`);
    return exitCodeFor(err);
  }
  // ...
}
```

**Greenfield parts (MOST of the file):** flag parsing, credential load/save via `envPaths`, reconnecting-websocket wiring, SIGINT/SIGTERM handlers. See RESEARCH §reconnecting-websocket Lifecycle Events + §Graceful Shutdown + §Cross-Platform Credential Storage.

**Exported entry for `cli.ts`:**
```typescript
export async function runAgent(argv: readonly string[]): Promise<number> { ... }
```

**Do NOT couple to xci's alias resolution, config loader, commands loader, or executor** — agent mode is daemon-only (D-06).

---

### `packages/xci/src/agent/client.ts` (greenfield — reconnecting-websocket wrapper)

**No analog.** Source pattern: RESEARCH §reconnecting-websocket Node.js Usage Pattern (lines 228-281).

**Key constants (from RESEARCH):**
```typescript
const rws = new ReconnectingWebSocket(url, [], {
  WebSocket: WS,                                  // Pitfall 2 — REQUIRED on Node.js
  minReconnectionDelay: 1000 + Math.random() * 500,  // 1.0–1.5s jittered first reconnect
  maxReconnectionDelay: 30_000,                    // 30s cap (AGENT-02)
  reconnectionDelayGrowFactor: 1.5,
  connectionTimeout: 5000,
  maxRetries: Infinity,
  startClosed: false,
});
```

**Lifecycle event listeners** — mirror RESEARCH lines 258-281: `open` → send handshake; `message` → dispatch; `close` → detect code 4001 and stop reconnecting; `error` → log.

---

### `packages/xci/src/agent/credential.ts` (greenfield — env-paths + TOFU)

**No analog.** Source pattern: RESEARCH §Cross-Platform Credential Storage (lines 414-462).

**Critical patterns:**
1. **env-paths with `suffix: ''`** (macOS picks `~/Library/Preferences/xci`, NOT `~/.config/xci` — RESEARCH Open Q #1 + Pitfall 5; override with `--config-dir`).
2. **`mode: 0o600`** on `fs.writeFile` (POSIX only; Windows silently ignores).
3. **TOFU check (D-09)**: if `agent.json` exists AND `--token` flag is also present → throw `AgentModeArgsError` with message "Agent already registered. Delete `<path>` and retry."
4. **Validate on load**: parse JSON, reject if `version !== 1`.

---

### `packages/xci/src/agent/labels.ts` (greenfield — small)

**No analog.** Source: RESEARCH §Phase Requirements AGENT-03.

**Trivial implementation:**
```typescript
import { hostname, arch } from 'node:os';
export function detectLabels(custom: string[]): Record<string, string> {
  const labels: Record<string, string> = {
    os: process.platform, arch, node_version: process.version, hostname: hostname(),
  };
  for (const entry of custom) {
    const eqIdx = entry.indexOf('=');
    if (eqIdx > 0) labels[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
  }
  return labels;
}
```

---

### `packages/xci/src/cli.ts` (MODIFIED — argv pre-scan + lazy import, D-02)

**Analog (same file):** existing `--get-completions` early exit at line 708 is the shape template.

**Copy pattern — early exit in `main()` before buildProgram()** (existing lines 706-715):
```typescript
async function main(argv: readonly string[]): Promise<number> {
  // Handle --get-completions early, before commander parsing
  if (argv[2] === '--get-completions') {
    const completions = await handleGetCompletions(argv);
    if (completions.length > 0) { process.stdout.write(completions.join('\n') + '\n'); }
    return 0;
  }
  // ...
}
```

**Mirror — insert BEFORE the `--get-completions` check, per RESEARCH §Argv Pre-Scan:**
```typescript
async function main(argv: readonly string[]): Promise<number> {
  // D-02: argv pre-scan for agent mode — MUST be first, before any heavy import
  if (argv.includes('--agent')) {
    // D-06 conflict guard: --agent + alias → non-zero
    const nonFlagArgs = argv.slice(2).filter((a) => !a.startsWith('-'));
    if (nonFlagArgs.length > 0) {
      process.stderr.write('error [AGENT_MODE_ARGS]: --agent is daemon-only. ' +
        'Remove the alias argument or do not use --agent.\n');
      return 60;  // new exit code; add to ExitCode enum in errors.ts
    }
    const { runAgent } = await import('./agent/index.js');
    return runAgent(argv);
  }
  // ... existing --get-completions check ...
}
```

**Pitfall 6 acceptance criterion (from RESEARCH):** The `await import('./agent/index.js')` MUST resolve to `dist/agent.mjs` (the separate tsup entry), NOT get bundled into `dist/cli.mjs`. Verify with the cold-start test (`packages/xci/src/__tests__/cold-start.test.ts`) + a build-artifact assertion that `dist/cli.mjs` does NOT contain the string `ReconnectingWebSocket`.

---

### `packages/xci/src/errors.ts` (MODIFIED — add agent-specific subclasses)

**Analog (same file):** existing `UnknownFlagError` / `NotImplementedError` subclasses (lines 204-221).

**Mirror exactly** (`packages/xci/src/errors.ts` lines 204-211):
```typescript
export class UnknownFlagError extends CliError {
  constructor(flag: string) {
    super(`Unknown flag: ${flag}`, {
      code: 'CLI_UNKNOWN_FLAG',
      suggestion: 'Run `xci --help` for available flags',
    });
  }
}
```

**Adapt for 4 new subclasses (all under `CliError`):**
- `AgentModeArgsError` — code `CLI_AGENT_MODE_ARGS`; when `--agent` conflicts with an alias
- `AgentRegistrationFailedError` — code `CLI_AGENT_REGISTRATION_FAILED`; when handshake rejected
- `AgentCredentialReadError` — code `CLI_AGENT_CREDENTIAL_READ`; with `cause`
- `AgentCredentialWriteError` — code `CLI_AGENT_CREDENTIAL_WRITE`; with `cause`

**D-10 secrets discipline (Phase 1 P02 `ShellInjectionError` pattern at lines 180-191):** NEVER accept token plaintext or credential plaintext in the constructor. If for API compat a value IS passed (e.g., `path`), keep the path (not a secret) but discard any credential value via `void credential`.

**ExitCode extension:** add `AGENT_ERROR: 60` to the `ExitCode` const (`packages/xci/src/errors.ts` lines 10-17) + a new category `'agent'` + corresponding exhaustive switch branch in `exitCodeFor` (lines 229-241) — OR keep in `'cli'` category (simpler; CLI exit code 50 covers all agent errors). **Planner decides**; leaning toward keeping in `cli` since agent errors are still CLI-invocation errors.

---

### `packages/xci/tsup.config.ts` (MODIFIED — multi-entry)

**Analog (same file):** existing single-entry config (35 lines).

**ONE change only:** `entry: ['src/cli.ts']` (line 7) → `entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' }`.

**Everything else — KEEP:**
- `external: ['ws', 'reconnecting-websocket']` (line 18) — unchanged ← Phase 6 D-16(a) stays
- `noExternal: [/^(?!ws$|reconnecting-websocket$).*/]` (line 17) — unchanged
- `splitting: false` (line 23) — unchanged (keeps entries independent)
- `banner` with shebang (lines 25-30) — still applies to both cli.mjs and agent.mjs per tsup default behavior
- `define: { __XCI_VERSION__: ... }` (line 32) — applies to both

**`outExtension: () => ({ js: '.mjs' })`** (line 11) — keep; both entries emit `.mjs`.

**Resulting dist:** `dist/cli.mjs` (unchanged size delta, ws/rws external) + NEW `dist/agent.mjs` (contains agent module + its bundled deps; ws and reconnecting-websocket STILL external and loaded from node_modules at runtime; env-paths MAY be bundled — RESEARCH Assumption A3, recommended to bundle).

**Pitfall 6 verification:** After `pnpm --filter xci build`, grep `dist/cli.mjs` for the string `ReconnectingWebSocket` — must NOT be present. Grep `dist/agent.mjs` for it — MUST be present (or, if tsup externals it, must be `await import('reconnecting-websocket')` style).

---

### `biome.json` (MODIFIED — fence narrowing, rule cleanup, repo restriction extension)

**Analog (same file):** existing three overrides (lines 47-127).

**Three changes (per RESEARCH §Phase 6 Fence Reversal Checklist + Open Q #6):**

**Change 1 — Narrow xci fence from package-wide to `cli.ts` only** (line 49):
```json
// BEFORE:
{ "includes": ["packages/xci/src/**/*.ts"], "linter": { "rules": { "style": { "noRestrictedImports": { ... ws + reconnecting-websocket restricted ... } } } } }
// AFTER:
{ "includes": ["packages/xci/src/cli.ts"], "linter": { "rules": { "style": { "noRestrictedImports": { ... same rule body ... } } } } }
```

**Pitfall 7 verification:** after the change, run `biome check packages/xci/src/cli.ts` (must still warn if ws is imported there) AND `biome check packages/xci/src/agent/client.ts` (must NOT warn — agent module is now OUTSIDE the include glob).

**Change 2 — REMOVE the entire second override block** (lines 70-91, the Phase 7 temporary guard):
```json
// DELETE ENTIRELY:
{
  "includes": ["packages/server/src/**/*.ts"],
  ...
    "paths": { "ws": {...}, "reconnecting-websocket": {...} }
  ...
}
```
Rationale: `@fastify/websocket@11` imports `ws` transitively — Phase 7's "Phase 7 does not use WebSockets" guard is now obsolete.

**Change 3 — EXTEND the third override's `paths` map** (lines 92-125) with the 3 new repo files (both relative variants `./repos/agents.js` / `../repos/agents.js` etc., mirror current entries at lines 106-119):
```json
"./repos/agents.js": { "message": "D-01: import { forOrg, admin } from '../repos/index.js' — never import a specific repo file. See 07-CONTEXT.md D-01." },
"./repos/agent-credentials.js": { "message": "D-01: use forOrg()/adminRepo from ../repos/index.js" },
"./repos/registration-tokens.js": { "message": "D-01: use forOrg()/adminRepo from ../repos/index.js" },
"../repos/agents.js": { "message": "D-01: use forOrg()/adminRepo from ../repos/index.js" },
"../repos/agent-credentials.js": { "message": "D-01: use forOrg()/adminRepo from ../repos/index.js" },
"../repos/registration-tokens.js": { "message": "D-01: use forOrg()/adminRepo from ../repos/index.js" },
```

**Canonical scope:** current third override `includes` is `["packages/server/src/routes/**/*.ts", "packages/server/src/plugins/**/*.ts", "packages/server/src/app.ts", "packages/server/src/server.ts"]`. Phase 8 does NOT need to extend this (the new `ws/` directory isn't in routes/plugins; if the planner adds it to routes, the rule applies automatically; if kept as a sibling, the planner may add `"packages/server/src/ws/**/*.ts"` to the includes).

---

### `.github/workflows/ci.yml` (MODIFIED — remove grep gate)

**Analog (same file):** existing `fence-gates` job (lines 45-102) is the shape template.

**ONE change:** DELETE the `WS-exclusion grep gate (D-16b)` step at lines 70-76:
```yaml
# DELETE THIS BLOCK:
- name: WS-exclusion grep gate (D-16b)
  run: |
    if grep -E "(reconnecting-websocket|['\"]ws['\"])" packages/xci/dist/cli.mjs; then
      echo "::error::Found ws/reconnecting-websocket in dist/cli.mjs - Phase 6 D-16 fence broken!"
      exit 1
    fi
    echo "OK: no ws/reconnecting-websocket strings in dist/cli.mjs"
```

**KEEP:**
- `fence-gates` job itself (Linux runner for cold-start gate D-17)
- "Install hyperfine" step (line 78-79)
- "Cold-start gate (D-17)" step (lines 81-95) — this is the heartbeat of D-29's cold-start preservation
- Hyperfine artifact upload (lines 97-102)
- `build-test-lint` matrix — unchanged
- `integration-tests` Linux-only job — unchanged (extends to include WS integration tests automatically since they live under `packages/server/src/**/*.integration.test.ts`)

**Planner acceptance criterion:** After fence reversal + agent module code, the cold-start gate must still pass at <300ms (D-29). Verify locally before committing.

---

### `packages/server/src/crypto/tokens.ts` (MODIFIED — add `compareToken` + `hashToken`; extend `generateId` prefix union)

**Analog (same file):** existing `generateToken` (lines 8-10) + `generateId` (lines 16-20).

**Mirror pattern — zero-dep Node.js crypto** (`packages/server/src/crypto/tokens.ts` lines 1-20):
```typescript
import { randomBytes } from 'node:crypto';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateId(
  prefix: 'org' | 'usr' | 'mem' | 'ses' | 'inv' | 'ver' | 'pwr' | 'plan',
): string {
  return `xci_${prefix}_${randomBytes(15).toString('base64url')}`;
}
```

**Extend** (from RESEARCH §crypto.timingSafeEqual Usage + Open Q #4):
1. Union extension: `'org' | ... | 'plan' | 'agt' | 'crd' | 'rtk'` (3 new prefixes per RESEARCH Open Q #4).
2. Add `hashToken(plaintext: string): string` — `createHash('sha256').update(plaintext, 'utf8').digest('hex')`.
3. Add `compareToken(provided: string, expected: string): boolean` with length pre-check (Pitfall 3):
```typescript
import { timingSafeEqual } from 'node:crypto';
export function compareToken(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.byteLength !== b.byteLength) return false;   // length leak acceptable — attacker knows expected length
  return timingSafeEqual(a, b);
}
```

**ATOK-06 discipline (from CONTEXT Specifics line 318):** every token/credential comparison in `adminRepo.findValidRegistrationToken` and `adminRepo.findActiveAgentCredential` goes through `compareToken(hashToken(provided), storedHash)` OR uses SQL `eq(stored_hash, sha256(provided))` — **no `===` on token variables anywhere**. Suggestion: add a CI grep step `grep -E "(token|credential|hash).*=== " packages/server/src/` to catch regressions.

---

## Shared Patterns

### A. Phase 7 D-01 forOrg Discipline (INHERITED — agents layer extends it unchanged)

**Source:** Existing `packages/server/src/repos/for-org.ts` (27 lines).

**Mirror exactly** (same file, lines 14-22):
```typescript
export function makeForOrg(db: PostgresJsDatabase) {
  return (orgId: string) => ({
    users: makeUsersRepo(db, orgId),
    sessions: makeSessionsRepo(db, orgId),
    emailVerifications: makeEmailVerificationsRepo(db, orgId),
    passwordResets: makePasswordResetsRepo(db, orgId),
    invites: makeOrgInvitesRepo(db, orgId),
    plan: makeOrgPlansRepo(db, orgId),
  });
}
```

**Extend with 3 new factories — keep alphabetical or logical grouping:**
```typescript
agents: makeAgentsRepo(db, orgId),
agentCredentials: makeAgentCredentialsRepo(db, orgId),
registrationTokens: makeRegistrationTokensRepo(db, orgId),
```

**Apply to:** every REST route under `packages/server/src/routes/agents/` — they MUST use `makeRepos(fastify.db).forOrg(orgId).agents` and `.agentCredentials`; NEVER import `makeAgentsRepo` directly (blocked by Biome third override).

---

### B. Error Contract Discipline (INHERITED from Phase 7 D-08 + Phase 1 P03)

**Source:** `packages/server/src/errors.ts` (271 lines — abstract base + area bases + concrete subclasses + exhaustive `httpStatusFor`).

**Apply to:** every new server error added in Phase 8 — sits under the appropriate area base (`AuthnError`, `ValidationError`). The `oneOfEachConcrete()` factory in `packages/server/src/__tests__/errors.test.ts` must list every new subclass. Code strings must be unique (auto-caught by the code-uniqueness test — Phase 7 PATTERNS lines 407-411).

**New codes to reserve (suggested):**
- `AUTHN_AGENT_TOKEN_INVALID` (AgentTokenInvalidError)
- `AUTHN_AGENT_REVOKED` (AgentRevokedError)
- `AUTHN_REGISTRATION_TOKEN_EXPIRED` (RegistrationTokenExpiredError)
- `AUTHN_HANDSHAKE_TIMEOUT` (AgentHandshakeTimeoutError)
- `VAL_AGENT_FRAME` (AgentFrameInvalidError)

---

### C. Secrets-Never-Logged Discipline (INHERITED from Phase 7 D-10 + Phase 1 P02)

**Source:** `packages/server/src/app.ts` `redact.paths` (lines 31-45) + `ShellInjectionError` pattern (`packages/xci/src/errors.ts` lines 180-191).

**Apply to Phase 8:**
1. **Extend `redact.paths` in `app.ts`** with the new body paths:
   - `'req.body.registrationToken'` (already present — line 37; covers agent-tokens route)
   - Add: `'req.body.credential'` (for any route that might accept it — not in D-19 list but defensive)
   - The `*.password`, `*.token` patterns (lines 42-43) already cover nested tokens.
2. **Never log WS frame payload bodies** — the WS handler's `fastify.log` calls must log `{ agentId, type }` only, NOT `{ frame: data }`. Planner acceptance criterion: grep server logs in tests for `eyJhbGciOi` / long base64url strings — should never appear.
3. **Error constructors** never accept `token`, `credential`, `password` plaintext arguments (mirror Phase 7 `InvalidCredentialsError` + Phase 1 `ShellInjectionError`).

---

### D. Per-Route CSRF Opt-in (INHERITED from Phase 7 D-34)

**Source:** `packages/server/src/routes/orgs/invites.ts` line 35: `onRequest: [fastify.csrfProtection]`.

**Apply to:** all 5 Phase 8 REST routes (POST/PATCH/DELETE — `agent-tokens`, `agents PATCH`, `agents revoke`, `agents DELETE`). GET `agents` list does NOT need CSRF (reads only).

**Explicitly DO NOT apply to:** WS endpoint at `/ws/agent`. Auth is via handshake frame, not session cookie — the `requireAuth` preHandler MUST be omitted from the WS route (see RESEARCH §Authentication Bypass Pattern lines 400-408).

---

### E. testcontainers + seedTwoOrgs Fixture (INHERITED from Phase 7 D-20..22)

**Source:** `packages/server/src/test-utils/two-org-fixture.ts` (exported `seedTwoOrgs(db)`), `db-harness.ts` (exported `getTestDb`, `resetDb`).

**Apply to all 3 new isolation tests:**
```typescript
// Copy verbatim from packages/server/src/repos/__tests__/users.isolation.test.ts lines 1-6:
import { beforeEach, describe, expect, it } from 'vitest';
import { getTestDb, resetDb } from '../../test-utils/db-harness.js';
import { seedTwoOrgs } from '../../test-utils/two-org-fixture.js';
import { makeAgentsRepo } from '../agents.js';
```

**Extension point:** `seedTwoOrgs` needs a **small extension** to optionally seed an agent per org. Planner decision: extend the fixture to return `{orgA: {id, ownerUser, agent?}, orgB: {id, ownerUser, agent?}}` where `agent` is undefined unless `seedTwoOrgs(db, { agents: true })` is called. Alternatively, each isolation test seeds its own agents inline via the freshly-seeded orgs. **Simpler: inline seeding.** Matches current `org-invites.isolation.test.ts` style.

---

### F. Auto-Discovery Meta-Test Enforces D-04 (INHERITED — NO code change required)

**Source:** `packages/server/src/repos/__tests__/isolation-coverage.isolation.test.ts` (59 lines, Phase 7).

**The meta-test is automatic** (lines 22-25 scan `REPOS_DIR = repos/`, exclude `index.ts`, `for-org.ts`, `admin.ts`). The 3 new repo files `agents.ts`, `agent-credentials.ts`, `registration-tokens.ts` are auto-included. For each file, the meta-test (lines 40-55):
1. Greps for `export function make\w+Repo` in the source → MUST find ≥1.
2. Asserts a matching `<name>.isolation.test.ts` file exists.
3. Asserts every exported `makeXxxRepo` name appears in the test file.

**Planner acceptance criterion:** running `pnpm --filter @xci/server test:integration` after Phase 8 repo files land (WITHOUT isolation tests yet) should FAIL loudly on the auto-discovery — this is the guard, no action needed beyond adding the tests.

---

### G. Test Conventions (INHERITED)

**Source:** Phase 1 P03 — `__tests__/` colocation, `.js` suffix relative imports (`verbatimModuleSyntax` + `moduleResolution: bundler`).

**Apply to every new Phase 8 test file:**
- Colocate in `<module-dir>/__tests__/`
- Import with `.js` suffix (e.g., `import { makeAgentsRepo } from '../agents.js'`)
- Use vitest describe/it/expect/beforeEach
- Naming: `*.test.ts` for unit (no DB), `*.isolation.test.ts` for two-org repo isolation (picked up by integration config), `*.integration.test.ts` for HTTP/WS + DB

---

## Phase 6 Fence Reversal Checklist (CRITICAL — ATOMIC WITH FIRST AGENT SCAFFOLD)

Per CONTEXT Specifics line 312: "lift fence + scaffold agent module skeleton must be atomic — the fence existed because there was no legitimate user. Lifting it without adding the user creates a window where regressions can land."

The planner MUST order Plan 01 such that ALL of the following land in the same commit/PR series, with the CI pipeline green at the end:

| # | File | Change | After-State Verification |
|---|------|--------|--------------------------|
| 1 | `packages/xci/package.json` (line 21 block) | Add `"ws": "8.20.0"`, `"reconnecting-websocket": "4.4.0"`, `"env-paths": "4.0.0"` to `dependencies` | `pnpm install` succeeds; `pnpm --filter xci list` shows all three |
| 2 | `packages/xci/tsup.config.ts` (line 7) | Change `entry` from `['src/cli.ts']` to `{ cli: 'src/cli.ts', agent: 'src/agent/index.ts' }` | `pnpm --filter xci build` emits BOTH `dist/cli.mjs` and `dist/agent.mjs` |
| 3 | `packages/xci/tsup.config.ts` (lines 17-18) | **NO CHANGE** — keep `external: ['ws', 'reconnecting-websocket']` and `noExternal` regex | `grep -c 'ReconnectingWebSocket' dist/cli.mjs` → `0` (verify); `grep -c 'ReconnectingWebSocket' dist/agent.mjs` → `>0` (verify) |
| 4 | `biome.json` (first override, line 49) | Narrow `includes` from `"packages/xci/src/**/*.ts"` to `"packages/xci/src/cli.ts"` | `biome check packages/xci/src/cli.ts` fires on `import 'ws'`; `biome check packages/xci/src/agent/client.ts` does NOT |
| 5 | `biome.json` (second override block, lines 70-91) | DELETE entirely | `biome check packages/server/src/app.ts` does NOT fire on `@fastify/websocket` (which imports ws) |
| 6 | `biome.json` (third override, lines 92-125) | EXTEND `paths` map with 6 new entries (`./repos/agents.js`, `./repos/agent-credentials.js`, `./repos/registration-tokens.js` + `../repos/` variants) | `biome check packages/server/src/routes/agents/tokens.ts` fires if it imports `'../repos/agents.js'` directly |
| 7 | `.github/workflows/ci.yml` (lines 70-76) | DELETE the "WS-exclusion grep gate" step | `fence-gates` job still runs cold-start gate; workflow parses clean |
| 8 | `packages/xci/src/cli.ts` (top of `main()`) | Add argv pre-scan + lazy `await import('./agent/index.js')` — SEE §`cli.ts` pattern | `xci` without `--agent` behavior unchanged (v1 tests still pass); `xci --agent wss://...` skips alias resolution |
| 9 | `packages/xci/src/agent/index.ts` | Scaffold `runAgent(argv)` — even just a stub that logs "agent mode" and exits | Build succeeds; separate tsup entry produces `dist/agent.mjs`; grep of `dist/cli.mjs` still shows no ws |
| 10 | `.changeset/*.md` | Add changeset (feat) describing fence reversal + agent mode | Fixed-versioning per Phase 6 D-11 — xci, @xci/server, @xci/web bump together |

**Acceptance gates after the atomic reversal (must all pass):**
- `pnpm --filter xci test` — 302 v1 tests green (BC-02)
- `pnpm --filter xci build` — produces `cli.mjs` + `agent.mjs`
- `grep -E "(reconnecting-websocket|['\"]ws['\"])" packages/xci/dist/cli.mjs` — empty output (strings are now in `agent.mjs`, not `cli.mjs`; CI grep gate removed but local verification still valuable)
- `hyperfine --runs 10 --warmup 3 'node packages/xci/dist/cli.mjs --version'` — mean <300ms (D-29)
- `pnpm turbo run typecheck lint build test` — all green

---

## Sequencing / Recommended Wave Order

Per RESEARCH §Sequencing (lines 1221-1243) and CONTEXT Specifics line 312:

1. **Wave 1 (atomic):** Phase 6 fence reversal (10-step checklist above) + agent module stub scaffold
2. **Wave 2:** Server schema extension + migration generation + relations + inferred types
3. **Wave 3:** Server repos (agents, agent-credentials, registration-tokens) + isolation tests + adminRepo extensions + crypto/tokens.ts extension
4. **Wave 4:** buildApp() plugin chain extension (agentRegistry decorator + @fastify/websocket) + WS handler + heartbeat + registry + frames
5. **Wave 5:** 5 REST routes (tokens, list, patch, revoke, delete) + CSRF wiring + integration tests + ATOK-03 URL-token-rejected test
6. **Wave 6:** Full agent module (client.ts, credential.ts, labels.ts, state.ts, types.ts) + SIGINT/SIGTERM + reconnection backoff
7. **Wave 7:** Agent-side unit + integration tests (mock server, credential, labels, client) + cold-start smoke test
8. **Wave 8:** E2E test (Linux-only, spawns xci as child process, asserts credential file written)
9. **Wave 9:** Changeset + final CI verification + documentation updates

**Planner discretion (CONTEXT):** collapse to 3-4 plans (e.g., Wave 1+2+3 = Plan 01 "fence-reversal + server foundation"; Wave 4+5 = Plan 02 "server WS + REST"; Wave 6+7+8 = Plan 03 "agent module + tests").

---

## Do NOT List (regressions the planner MUST encode as acceptance criteria)

Explicit anti-patterns — verify via tests or CI:

1. **Do NOT bundle agent module into `dist/cli.mjs`.** The tsup multi-entry split MUST keep them separate. Verify: `grep -c 'ReconnectingWebSocket' dist/cli.mjs === 0`. (Pitfall 6.)
2. **Do NOT require the token in WS URL.** ATOK-03 — token goes in the first frame body ONLY. Verify: `ws-url-token-rejected.integration.test.ts` opens a WS with `?token=X` and asserts close code 4002 or 4005.
3. **Do NOT compare tokens/credentials with `===`.** ATOK-06 — always `compareToken(hashToken(provided), storedHash)` OR SQL `eq(credential_hash, sha256(provided))`. Consider CI grep: `grep -rE "(token|credential|hash)\s*===\s*" packages/server/src/` should match nothing.
4. **Do NOT break Phase 7 D-01 forOrg discipline.** Routes import `makeRepos` from `../../repos/index.js` only; never `../../repos/agents.js` directly. Biome third override auto-catches this once extended (checklist item 6).
5. **Do NOT put agent business logic in `cli.ts`.** `cli.ts` only contains the 10-line argv pre-scan + `await import('./agent/index.js')`. All agent logic lives in `packages/xci/src/agent/**`.
6. **Do NOT register `requireAuth` as preHandler on `/ws/agent`.** WS route is unauthenticated until the first frame arrives (RESEARCH §Authentication Bypass Pattern).
7. **Do NOT log WS frame bodies.** Log metadata only (`{ agentId, type }`). Pino redact covers `*.password` / `*.token` but WS frames go through `socket.on('message')`, NOT HTTP requests — redact does NOT apply. Manual discipline required.
8. **Do NOT add zod as a new dep for frame validation.** Hand-rolled `switch(frame.type)` in `ws/frames.ts` — CONTEXT Claude's Discretion + RESEARCH Open Q #3.
9. **Do NOT accept token/credential plaintext in error constructors.** Mirror `InvalidCredentialsError` (server `errors.ts` lines 113-118) and `ShellInjectionError` (xci `errors.ts` lines 180-191). Any new `AgentTokenInvalidError` / `AgentRevokedError` / `AgentCredentialReadError` — NO secret args.
10. **Do NOT call `timingSafeEqual` without a length pre-check.** Pitfall 3 — throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` on different-length buffers. The `compareToken` helper handles this; all comparison code paths MUST go through the helper.
11. **Do NOT register `@fastify/websocket` BEFORE `app.decorate('agentRegistry', ...)`.** Pitfall 8 — decorator ordering.
12. **Do NOT forget `{ WebSocket: WS }` option on ReconnectingWebSocket on Node.js.** Pitfall 2 — fails with `ReferenceError: WebSocket is not defined` otherwise.
13. **Do NOT register `socket.on('message', ...)` inside an `await` block.** Pitfall 4 — messages arriving during the await are silently dropped. Register synchronously at top of handler; make the listener itself async.
14. **Do NOT hardcode `~/.config/xci/` on macOS.** Use `envPaths('xci', { suffix: '' }).config` which returns `~/Library/Preferences/xci` on macOS. D-07 wording is wrong about macOS; RESEARCH recommends env-paths as-is (Pitfall 5 + Open Q #1).
15. **Do NOT add `env-paths` to tsup `external`.** Bundle it (tiny, pure JS, zero transitive deps). RESEARCH Assumption A3.
16. **Do NOT skip the cold-start test.** `packages/xci/src/__tests__/cold-start.test.ts` is a unit-level guard in addition to the hyperfine CI gate (CONTEXT Specifics line 326). Use `child_process.spawnSync('node', [cliPath, '--version'])` and time the delta.
17. **Do NOT break BC-02.** All 302 Phase 1 xci tests must continue to pass unchanged. No edits to existing test files except additions (`__tests__/cold-start.test.ts`).

---

## No Analog Found — GREENFIELD modules

These files have NO existing repo code to mirror; their patterns come entirely from RESEARCH.md:

| File | Source Section in RESEARCH.md |
|------|-------------------------------|
| `packages/xci/src/agent/client.ts` | §reconnecting-websocket Node.js Usage Pattern |
| `packages/xci/src/agent/credential.ts` | §Cross-Platform Credential Storage (env-paths) |
| `packages/xci/src/agent/index.ts` (runAgent daemon body) | §Graceful Shutdown + §Argv Pre-Scan |
| `packages/xci/src/agent/labels.ts` | AGENT-03 — trivial, no ref |
| `packages/xci/src/agent/state.ts` | CONTEXT D-26 (stub in Phase 8) |
| `packages/xci/src/agent/types.ts` | CONTEXT D-15 (frame envelope) |
| `packages/xci/src/agent/__tests__/test-server.ts` | §Agent-Side Mock Server (D-32) |
| `packages/server/src/ws/handler.ts` | §WS Handshake Protocol (Server-Side Handler Pseudocode) |
| `packages/server/src/ws/heartbeat.ts` | §Heartbeat Implementation |
| `packages/server/src/ws/registry.ts` | §Connection Registry Decoration |
| `packages/server/src/ws/frames.ts` | CONTEXT D-15 (hand-rolled) |

---

## Metadata

**Analog search scope:** `packages/xci/src/**`, `packages/server/src/**`, root-level config files (`biome.json`, `tsup.config.ts`, `package.json`, `.github/workflows/ci.yml`), Phase 7 PATTERNS.md (the inherited pattern baseline).

**Files scanned:** 21 project files read (xci package.json + tsup.config.ts + cli.ts + errors.ts; server app.ts + errors.ts + repos/index.ts + repos/users.ts + repos/admin.ts + repos/org-invites.ts + repos/for-org.ts + db/schema.ts + db/relations.ts + plugins/auth.ts + routes/index.ts + routes/orgs/invites.ts + routes/orgs/index.ts + repos/__tests__/users.isolation.test.ts + repos/__tests__/isolation-coverage.isolation.test.ts + crypto/tokens.ts; biome.json; .github/workflows/ci.yml) + CONTEXT.md (Phase 8, 43 locked decisions) + RESEARCH.md (Phase 8, 1318 lines) + Phase 6 CONTEXT.md + Phase 7 CONTEXT.md + Phase 7 PATTERNS.md.

**Inheritance chain:** Phase 1 error/test discipline → Phase 6 fence → Phase 7 server foundation (forOrg, adminRepo, error hierarchy, testcontainers) → Phase 8 extends all three, reverses Phase 6 fence partially.

**Pattern extraction date:** 2026-04-18

---

## PATTERN MAPPING COMPLETE
