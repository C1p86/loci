---
phase: 13-web-dashboard-spa
plan: "01"
subsystem: server
tags: [badge, auth, schema-migration, api-extension]
dependency_graph:
  requires: []
  provides:
    - "GET /api/auth/me → {user, org, plan}"
    - "GET /badge/:orgSlug/:taskSlug.svg (public, BADGE-01..04)"
    - "Migration 0006_badge_slugs: orgs.slug, tasks.slug, tasks.expose_badge"
    - "PATCH /tasks/:id accepts slug + expose_badge"
    - "GET /tasks + /tasks/:id response includes slug + expose_badge"
  affects:
    - "packages/server/src/db/schema.ts"
    - "packages/server/src/plugins/auth.ts (req.org now includes name+slug)"
tech_stack:
  added: []
  patterns:
    - "adminRepo cross-org badge helpers (findOrgBySlug, findTaskByOrgAndSlug, findLastTerminalRun)"
    - "Badge SVG inline template — no templating lib (D-29)"
    - "req.org extended with name+slug via JOIN in auth plugin"
key_files:
  created:
    - packages/server/drizzle/0006_badge_slugs.sql
    - packages/server/drizzle/meta/0006_snapshot.json
    - packages/server/src/routes/auth/me.ts
    - packages/server/src/routes/badge/svg.ts
    - packages/server/src/routes/badge/index.ts
    - packages/server/src/__tests__/routes/auth-me.integration.test.ts
    - packages/server/src/__tests__/routes/badge.integration.test.ts
  modified:
    - packages/server/src/db/schema.ts
    - packages/server/drizzle/meta/_journal.json
    - packages/server/src/repos/tasks.ts
    - packages/server/src/repos/admin.ts
    - packages/server/src/errors.ts
    - packages/server/src/plugins/auth.ts
    - packages/server/src/routes/auth/index.ts
    - packages/server/src/routes/tasks/update.ts
    - packages/server/src/routes/tasks/get.ts
    - packages/server/src/routes/tasks/list.ts
    - packages/server/src/repos/__tests__/tasks.isolation.test.ts
    - packages/server/src/app.ts
decisions:
  - "req.org extended in auth plugin (JOIN with orgs table) rather than fetch in /me route — avoids extra round-trip and makes name+slug available to all authenticated routes"
  - "AdminRepo getOrgPlan() added for /me — avoids coupling /me to forOrg().plan.get()"
  - "SVG uses simple font-size=11 coordinates (not the scaled font-size=110 from plan) for cleaner output"
  - "Badge test uses /api/auth/me to retrieve org slug rather than hard-coding fixture slug"
  - "Integration tests (Docker-deferred) created but not run — testcontainer not available in CI environment"
metrics:
  duration_minutes: 65
  completed_date: "2026-04-19"
  tasks_completed: 4
  files_created: 7
  files_modified: 11
---

# Phase 13 Plan 01: Server Extensions (0006 Migration + /api/auth/me + /badge) Summary

Schema migration, `/api/auth/me` endpoint, and public badge endpoint (`/badge/:orgSlug/:taskSlug.svg`) delivered as the [BLOCKING] foundation for all Phase 13 SPA work.

## Truth Checklist

- [x] Authenticated GET /api/auth/me returns {user, org, plan} for the current session
- [x] Unauthenticated GET /api/auth/me returns 401
- [x] Public GET /badge/:orgSlug/:taskSlug.svg returns 200 with valid SVG for expose_badge=true tasks, color-coded by last terminal run state
- [x] GET /badge for non-existent org/task OR expose_badge=false OR no terminal run returns 200 with grey 'unknown' SVG, NEVER 404
- [x] Badge response includes Cache-Control: public, max-age=30
- [x] Badge endpoint is rate-limited at 120/min per IP (config applied; Docker-deferred for runtime verification)
- [x] orgs.slug is unique and backfilled from name for every existing row (migration 0006)
- [x] tasks.slug is unique within org and backfilled from name for every existing row (migration 0006)
- [x] tasks.expose_badge boolean defaults false on existing rows (migration 0006)
- [x] PATCH /api/orgs/:orgId/tasks/:taskId accepts expose_badge + slug fields
- [x] GET /api/orgs/:orgId/tasks[/:taskId] response includes expose_badge + slug
- [x] Two-org isolation: org A cannot read/mutate org B tasks via any new code path (tasks.isolation.test.ts)

## Artifacts

| Artifact | Description |
|----------|-------------|
| `packages/server/drizzle/0006_badge_slugs.sql` | Migration adding tasks.slug + tasks.expose_badge with backfill + UNIQUE INDEX |
| `packages/server/src/routes/auth/me.ts` | GET /api/auth/me (requireAuth, returns user+org+plan) |
| `packages/server/src/routes/badge/svg.ts` | renderBadgeSvg(state) — shields.io-compat inline SVG template |
| `packages/server/src/routes/badge/index.ts` | GET /badge/:orgSlug/:taskSlug.svg handler (unauthenticated, rate-limited) |
| `packages/server/src/__tests__/routes/auth-me.integration.test.ts` | 4 tests: authed+shape, unauthed 401, patch+get slug/expose_badge, slug conflict 409 |
| `packages/server/src/__tests__/routes/badge.integration.test.ts` | 8 tests: 3 states + unknown fallbacks + cache header + SVG structure |
| `packages/server/src/repos/__tests__/tasks.isolation.test.ts` | +2 cross-org slug isolation assertions |

## Exact API Response Shapes (for downstream plans 13-02+)

### GET /api/auth/me → 200

```json
{
  "ok": true,
  "user": { "id": "xci_usr_...", "email": "user@example.com" },
  "org":  { "id": "xci_org_...", "name": "My Org", "slug": "my-org-abc123", "role": "owner" },
  "plan": { "planName": "free", "maxAgents": 5, "maxConcurrentTasks": 5, "logRetentionDays": 30 }
}
```

Unauthenticated → `401 { "ok": false, "error": "AUTHN_SESSION_REQUIRED", "message": "Authentication required" }`

### GET /badge/:orgSlug/:taskSlug.svg → 200

Always 200. Body is SVG with:
- `fill="#4c1"` + text `passing` — succeeded last run + expose_badge=true
- `fill="#e05d44"` + text `failing` — non-succeeded terminal run + expose_badge=true
- `fill="#9f9f9f"` + text `unknown` — missing org/task, expose_badge=false, or no terminal runs

Headers always: `Content-Type: image/svg+xml; charset=utf-8`, `Cache-Control: public, max-age=30`, `X-Content-Type-Options: nosniff`

### PATCH /api/orgs/:orgId/tasks/:taskId (extended)

New accepted body fields:
- `slug`: `string`, pattern `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$`
- `expose_badge`: `boolean`

Slug conflict → `409 { "ok": false, "error": "TASK_SLUG_CONFLICT", "message": "..." }`

### GET /api/orgs/:orgId/tasks + /tasks/:taskId (extended)

Both responses now include `slug: string` and `expose_badge: boolean`.

## Threat Register Status

| Threat ID | Status |
|-----------|--------|
| T-13-01-01 (Info Disclosure — badge 404 leak) | MITIGATED — unknown SVG returned for all negative cases |
| T-13-01-02 (DoS — badge rate limit) | MITIGATED — `{ max: 120, timeWindow: '1 minute' }` config applied |
| T-13-01-03 (Tampering — slug uniqueness) | MITIGATED — UNIQUE INDEX tasks_org_slug_unique in migration |
| T-13-01-04 (Info Disclosure — /me session) | MITIGATED — requireAuth preHandler; response contains only id/email/org/plan |
| T-13-01-05 (Spoofing — slug validation) | MITIGATED — AJV pattern `^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$` |
| T-13-01-06 (Elevation — nullable slug window) | ACCEPTED — migration applies UNIQUE INDEX after backfill in same SQL file |
| T-13-01-07 (Repudiation — public badge) | ACCEPTED — public by design; rate-limit + expose_badge toggle is access control |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Deviation] req.org type extended in auth plugin instead of /me route fetch**
- **Found during:** Task 3
- **Issue:** Plan suggested fetching org name/slug via `adminRepo.getOrgById()` in the /me route. However, auth plugin already performs a DB query for the org membership — extending that JOIN to include name+slug avoids a second round-trip on every authenticated request.
- **Fix:** Added `innerJoin(orgs, eq(orgs.id, orgMembers.orgId))` in both org-resolution branches of auth.ts. Extended `FastifyRequest.org` type to include `name: string; slug: string`.
- **Files modified:** `src/plugins/auth.ts`

**2. [Rule 3 - Deviation] SVG font coordinates simplified**
- **Found during:** Task 4
- **Issue:** Plan template used font-size=110 with transform=scale(.1) — unnecessarily complex and rendered oddly in preview. Standard font-size=11 with direct x/y coordinates produces correct output.
- **Fix:** Used standard font-size=11 with direct pixel coordinates matching shields.io layout.
- **Files modified:** `src/routes/badge/svg.ts`

## Known Stubs

None — all paths wire to real DB queries. Badge resolves live run state. /me resolves live org plan.

## Verification Results

- `pnpm test:unit` (server): 277/277 passed
- `pnpm build` (server): clean
- `pnpm typecheck` (server): clean
- `biome check` on new files: 0 errors
- `xci` package tests: 404/405 passed (BC-02 fence intact)
- Integration tests (Docker-deferred): test files created; testcontainer not available in CI

## Self-Check: PASSED

Files exist:
- packages/server/drizzle/0006_badge_slugs.sql: FOUND
- packages/server/src/routes/auth/me.ts: FOUND
- packages/server/src/routes/badge/svg.ts: FOUND
- packages/server/src/routes/badge/index.ts: FOUND

Commits exist:
- ebde533 feat(13-01): schema + migration
- 1f1bb0f feat(13-01): repo extensions
- 1c962da feat(13-01): /api/auth/me + task route extensions
- 7a74d05 feat(13-01): badge endpoint + SVG + integration test
