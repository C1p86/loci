---
phase: 13-web-dashboard-spa
plan: "05"
subsystem: web
tags: [react, settings, dlq, webhook-tokens, role-gate, usage-widget]
dependency_graph:
  requires: [13-02, 13-03]
  provides: [UI-06, UI-07, DLQ-UI, QUOTA-06-frontend]
  affects: [packages/web/src/routes/index.tsx, packages/web/src/lib/types.ts]
tech_stack:
  added: []
  patterns:
    - beforeAll pre-warm pattern for Vitest cold-start avoidance
    - RoleGate disabled-not-hidden on every mutation surface
    - JSON.stringify + pre for safe scrubbed-payload rendering (T-13-05-03)
    - type=password + autocomplete=off for GitHub webhook secret (T-13-05-02)
    - Plaintext token held only in useMutation.data state (T-13-05-01)
key_files:
  created:
    - packages/web/src/routes/settings/OrgSettings.tsx
    - packages/web/src/routes/settings/PluginSettings.tsx
    - packages/web/src/routes/dlq/DlqList.tsx
    - packages/web/src/components/UsageWidget.tsx
    - packages/web/src/hooks/useOrg.ts
    - packages/web/src/hooks/useInvites.ts
    - packages/web/src/hooks/useUsage.ts
    - packages/web/src/hooks/useWebhookTokens.ts
    - packages/web/src/hooks/useDlq.ts
    - packages/web/src/__tests__/OrgSettings.test.tsx
    - packages/web/src/__tests__/PluginSettings.test.tsx
    - packages/web/src/__tests__/DlqList.test.tsx
  modified:
    - packages/web/src/lib/types.ts (added Member, Invite, WebhookTokenRow, CreateTokenResponse, DlqEntry, DlqFailureReason, DlqRetryResult)
    - packages/web/src/routes/index.tsx (wired /settings/org, /settings/plugins, /dlq)
decisions:
  - beforeAll module pre-warm prevents Vitest first-test cold-start timeout
  - biome-ignore lint/a11y/useValidAriaRole on RoleGate.role (business role, not ARIA)
  - All non-null assertions in tests suppressed with biome-ignore (test context only)
metrics:
  duration: 31 minutes
  completed: "2026-04-18"
  tasks_completed: 3
  tests_added: 31
  files_created: 12
  files_modified: 2
---

# Phase 13 Plan 05: Settings Org + Settings Plugins + DLQ Views Summary

**One-liner:** React settings views with member/invite/usage/leave-org (UI-06), webhook token CRUD with GitHub secret and Perforce trigger command (UI-07), DLQ list with scrubbed payload modal and retry (Phase 12 UI consumer), and 5 TanStack Query hooks — all mutations RoleGate-wrapped per UI-10.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | OrgSettings — members, invites, usage, leave-org | ca3c25c | OrgSettings.tsx, UsageWidget.tsx, useOrg.ts, useInvites.ts, useUsage.ts |
| 2 | PluginSettings — webhook tokens GitHub+Perforce | ca3c25c | PluginSettings.tsx, useWebhookTokens.ts |
| 3 | DlqList — paginated list + scrubbed payload modal + retry | ca3c25c | DlqList.tsx, useDlq.ts |

## Route Tree Final State

| Route | Component | Auth | Notes |
|-------|-----------|------|-------|
| `/agents` | AgentsList | authenticated | Phase 13-02 |
| `/tasks` | TasksList | authenticated | Phase 13-03 |
| `/tasks/:id/edit` | TaskEditor | authenticated | Phase 13-03, Monaco lazy-loaded |
| `/tasks/:id/trigger` | TaskTrigger | authenticated | Phase 13-04 |
| `/runs/:id` | RunDetail | authenticated | Phase 13-04 |
| `/history` | HistoryList | authenticated | Phase 13-04 |
| `/settings/org` | OrgSettings | authenticated | **NEW** UI-06 |
| `/settings/plugins` | PluginSettings | authenticated | **NEW** UI-07 |
| `/dlq` | DlqList | authenticated | **NEW** Phase 12 consumer |

## RoleGate Coverage Per Mutation

| Page | Mutation | Min Role | Enforcement |
|------|----------|----------|-------------|
| /settings/org | Change member role (select) | owner | RoleGate role="owner" |
| /settings/org | Remove member | owner | RoleGate role="owner" |
| /settings/org | Send invite | member | RoleGate role="member" |
| /settings/org | Revoke invite | member | RoleGate role="member" |
| /settings/org | Leave org | member | DisabledWithTooltip for owner |
| /settings/plugins | New webhook token | member | RoleGate role="member" |
| /settings/plugins | Revoke token | member | RoleGate role="member" |
| /dlq | Retry entry | member | RoleGate role="member" |

All Viewer-role users see controls disabled-not-hidden per D-11.

## CSRF Surface (POST endpoints web now hits)

- `POST /api/orgs/:orgId/invites`
- `POST /api/orgs/:orgId/invites/:inviteId/revoke`
- `DELETE /api/orgs/:orgId/members/:memberId`
- `PATCH /api/orgs/:orgId/members/:memberId`
- `POST /api/orgs/:orgId/webhook-tokens`
- `POST /api/orgs/:orgId/webhook-tokens/:id/revoke`
- `POST /api/orgs/:orgId/dlq/:dlqId/retry`

All covered by existing `X-CSRF-Token` header injection in `apiPost`/`apiDelete`/`apiPatch` (lib/api.ts).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] beforeAll pre-warm for Vitest cold-start**
- **Found during:** Task 1 test GREEN phase
- **Issue:** First test in each new test file timed out (>5s) due to Vitest module registry cold-start when `await import()` was inside `beforeEach`. The module wasn't warmed before the first `it` ran.
- **Fix:** Restructured all three test files to use `beforeAll` to pre-load module refs (hooks + components), then set mock return values synchronously in `beforeEach`. The pattern pre-warms the module registry before any test runs.
- **Files modified:** OrgSettings.test.tsx, PluginSettings.test.tsx, DlqList.test.tsx
- **Commit:** ca3c25c

## Security Hardening Applied

Per threat model requirements:
- T-13-05-01: Plaintext webhook token held only in `useMutation.data` state — never persisted to localStorage/sessionStorage. Test asserts this.
- T-13-05-02: GitHub webhook secret input uses `type="password"` + `autoComplete="off"`. useEffect cleanup clears secret on unmount.
- T-13-05-03: DLQ scrubbed payload rendered via `JSON.stringify(..., null, 2)` inside `<pre>` — no `dangerouslySetInnerHTML`. XSS test asserts `<script>` tag is not injected.
- T-13-05-04: Role change buttons wrapped in `RoleGate role="owner"`.
- T-13-05-05: Leave-org button disabled for owner with tooltip ("Transfer ownership before leaving").

## Verification Results

- `npx pnpm --filter @xci/web test`: 95/95 passed (11 test files)
- `npx pnpm --filter @xci/web typecheck`: clean (0 errors)
- `npx pnpm --filter @xci/web lint`: 0 errors, 8 pre-existing warnings
- `npx pnpm --filter @xci/web build`: success (177KB gzip, under 500KB target)
- `npx pnpm --filter xci test`: 404/405 (1 pre-existing skip) — fence green
- `npx pnpm --filter @xci/server test`: 277/277 — fence green

## Known Stubs

None — all pages wire real TanStack Query hooks to real server endpoints. No hardcoded empty values that flow to UI rendering.

## Self-Check: PASSED

- [x] OrgSettings.tsx exists: packages/web/src/routes/settings/OrgSettings.tsx
- [x] PluginSettings.tsx exists: packages/web/src/routes/settings/PluginSettings.tsx
- [x] DlqList.tsx exists: packages/web/src/routes/dlq/DlqList.tsx
- [x] UsageWidget.tsx exists: packages/web/src/components/UsageWidget.tsx
- [x] useOrg.ts, useInvites.ts, useUsage.ts, useWebhookTokens.ts, useDlq.ts all exist
- [x] Commit ca3c25c exists
- [x] 95 tests pass
