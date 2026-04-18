---
phase: 07-database-schema-auth
plan: "07"
subsystem: server-org-invite-routes
tags: [fastify, auth, invites, org-members, role-change, csrf, email-pinned, AUTH-08, AUTH-09]
dependency_graph:
  requires: [07-05, 07-06]
  provides:
    - packages/server/src/routes/orgs/invites.ts
    - packages/server/src/routes/orgs/index.ts
    - packages/server/src/routes/invites/accept.ts
    - packages/server/src/routes/invites/index.ts
    - packages/server/src/routes/orgs/__tests__/invites.integration.test.ts
    - packages/server/src/routes/invites/__tests__/accept.integration.test.ts
  affects: [07-08, 07-09]
tech_stack:
  added: []
  patterns:
    - owner-only-guard: "requireOwnerAndOrgMatch(req) — checks req.org presence, orgId URL match, and role === 'owner'; throws SessionRequiredError / OrgMembershipRequiredError / RoleInsufficientError"
    - email-pinned-accept: "invite.email.toLowerCase() === req.user.email.toLowerCase() else InviteEmailMismatchError (AUTHZ_INVITE_EMAIL_MISMATCH 403)"
    - invite-validity-no-leak: "acceptedAt || revokedAt || expiresAt <= now() all collapse to InviteNotFoundError — no enumeration of which condition failed"
    - owner-role-immutable: "changeRole checks current.role === 'owner' throws OwnerRoleImmutableError; newRole='owner' rejected by schema enum; PG 23505 also mapped to OwnerRoleImmutableError"
    - null-guard-after-prehandler: "Extract req.org?.id + req.user?.id into locals with explicit throw — avoids noNonNullAssertion lint while keeping TypeScript narrowed"
key_files:
  created:
    - packages/server/src/routes/orgs/invites.ts
    - packages/server/src/routes/orgs/index.ts
    - packages/server/src/routes/invites/accept.ts
    - packages/server/src/routes/invites/index.ts
    - packages/server/src/routes/orgs/__tests__/invites.integration.test.ts
    - packages/server/src/routes/invites/__tests__/accept.integration.test.ts
  modified:
    - packages/server/src/repos/admin.ts (added changeRole + findOrgById + markInviteAccepted)
    - packages/server/src/errors.ts (added InviteEmailMismatchError)
    - packages/server/src/__tests__/errors.test.ts (added InviteEmailMismatchError to oneOfEachConcrete)
    - packages/server/src/routes/index.ts (mounted registerOrgRoutes + registerInviteRoutes)
decisions:
  - "null-guard pattern after requireOwnerAndOrgMatch: extract req.org?.id and req.user?.id into const locals then throw SessionRequiredError if falsy — satisfies biome noNonNullAssertion while keeping TypeScript narrowed to string (not string|undefined)"
  - "InviteEmailMismatchError extends AuthzError (403) not NotFoundError (404) — leaking that the token is valid but email mismatches is acceptable given the token is already verified; the security boundary is the email pin not token opacity"
  - "markInviteAccepted in adminRepo (not forOrg) — invitee is not yet a member of the org at acceptance time; forOrg would scope incorrectly"
  - "changeRole: schema rejects role='owner' at validation layer; OwnerRoleImmutableError fires for current owner AND for PG 23505 (belt+suspenders for AUTH-08)"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-18"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 4
---

# Phase 07 Plan 07: Org Member + Invite Routes Summary

**One-liner:** Fastify org-invite CRUD (POST/GET/DELETE /api/orgs/:orgId/invites), member role-change (PATCH /api/orgs/:orgId/members/:userId), and email-pinned invite acceptance (POST /api/invites/:token/accept) with owner-only guards, CSRF protection, 7d expiry, single-use tokens, and 17 HTTP integration tests covering SC-3 end-to-end.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1+2 | admin.ts extensions + all route files + integration tests | e00f1e0 | admin.ts, errors.ts, errors.test.ts, routes/index.ts, orgs/invites.ts, orgs/index.ts, invites/accept.ts, invites/index.ts, 2 test files |

## Route Summary

| Route | Method | CSRF | Auth | Owner-only | Returns |
|-------|--------|------|------|------------|---------|
| /api/orgs/:orgId/invites | POST | Required | requireAuth | Yes | 201 {inviteId, token, expiresAt} + invite email |
| /api/orgs/:orgId/invites | GET | No | requireAuth | Yes | 200 [{id, email, role, expiresAt, createdAt}] |
| /api/orgs/:orgId/invites/:inviteId | DELETE | Required | requireAuth | Yes | 204 + revoked email |
| /api/orgs/:orgId/members/:userId | PATCH | Required | requireAuth | Yes | 200 {ok:true} + role-changed email |
| /api/invites/:token/accept | POST | Required | requireAuth | No | 200 {orgId, role} |

## Admin Repo Methods Added

Three new cross-org methods added to `makeAdminRepo` in `packages/server/src/repos/admin.ts`:

```typescript
findOrgById(orgId)                    // SELECT from orgs — for org name in email templates
changeRole({orgId, userId, newRole})  // UPDATE org_members.role; OwnerRoleImmutableError if current owner
markInviteAccepted({inviteId, acceptedByUserId})  // UPDATE org_invites set acceptedAt=now() with predicate guards
```

## SC-3 End-to-End Trace

SC-3 requirement: "owner invites member by email; invite expires 7d; invitee joins correct org with correct role"

Covered by `accept.integration.test.ts` first test:
1. Owner calls `POST /api/orgs/:orgId/invites` → 201, invite stored with 7d expiry, invite email sent
2. Invitee signs up (signupTx + markUserEmailVerified) + creates session
3. Invitee calls `POST /api/invites/:token/accept` → 200 {orgId, role:'member'}
4. DB assertion: `orgMembers` row for invitee in owner's org with `role='member'`
5. DB assertion: `orgInvites` row has `acceptedAt != null` + `acceptedByUserId = invitee.user.id`

## Security Properties Implemented

| Threat | Mitigation | Test |
|--------|-----------|------|
| T-07-07-01 Anyone-with-link invite acceptance | D-15 email pin: invite.email.toLowerCase() === user.email.toLowerCase() | "wrong email user → 403 AUTHZ_INVITE_EMAIL_MISMATCH" |
| T-07-07-02 Invitee self-elevates to owner | Role on invite locked at creation; schema enum rejects 'owner' in invite body | Schema validation |
| T-07-07-03 PATCH role sets second owner | OwnerRoleImmutableError if current role === 'owner'; schema enum rejects 'owner' in body | "PATCH role owner→viewer blocked → 409" |
| T-07-07-04 Replay of accepted invite | markInviteAccepted predicate: acceptedAt IS NULL | "same token accepted twice → 404" |
| T-07-07-05 Revoked invite accepted | Route pre-check: revokedAt IS NULL | "revoked invite → 404" |
| T-07-07-06 URL orgId differs from session org | requireOwnerAndOrgMatch throws OrgMembershipRequiredError | "orgId in URL does not match → 403 AUTHZ_NOT_ORG_MEMBER" |
| T-07-07-07 Viewer reads pending invites | GET requires owner role | "viewer attempts invite → 403 AUTHZ_ROLE_INSUFFICIENT" |
| T-07-07-10 CSRF on state-changing routes | onRequest: [fastify.csrfProtection] on POST/DELETE/PATCH + accept | "missing CSRF → 403" in both test suites |

## Integration Test Count

| Suite | Tests | Docker required |
|-------|-------|-----------------|
| orgs/invites.integration.test.ts | 8 | Yes |
| invites/accept.integration.test.ts | 8 | Yes |
| **TOTAL new integration** | **16** | Yes (CI Linux only per D-23) |
| **TOTAL prior integration** | 30 | Yes |
| **GRAND TOTAL integration** | **46** | Yes |
| **Unit tests (prior)** | 60 | No |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Lint/Format] biome unsafe fix converted req.user! → req.user? causing TypeScript errors**
- **Found during:** Task 1 lint pass (`biome check --write --unsafe`)
- **Issue:** biome `noNonNullAssertion` converted `req.org!.id` and `req.user!.email` to optional-chain `req.org?.id` (type `string | undefined`), breaking TypeScript since repo methods expect `string`
- **Fix:** Replaced `!` assertions with explicit local variable extraction + early-throw guards (`const orgId = req.org?.id; if (!orgId) throw new SessionRequiredError()`). Same pattern as `logout.ts` `req.session?.id` guard. No behavior change — requireAuth preHandler already guarantees non-null at runtime.
- **Files modified:** routes/orgs/invites.ts, routes/invites/accept.ts
- **Commit:** e00f1e0 (inline before commit)

**2. [Rule 1 - Format] biome formatter reformatted function signatures and chained queries in test files**
- **Found during:** Task 2 lint pass
- **Issue:** Multi-arg function signatures and chained drizzle queries formatted differently than biome's line-length rules expected
- **Fix:** `biome check --write` applied automatically; tests still functionally identical
- **Files modified:** orgs/__tests__/invites.integration.test.ts, invites/__tests__/accept.integration.test.ts
- **Commit:** e00f1e0 (inline before commit)

## Known Stubs

None — all routes perform real DB operations. No hardcoded empty values or placeholder responses.

## Threat Surface Scan

New network endpoints added in this plan:

| Endpoint | Trust Boundary | Mitigations Applied |
|----------|---------------|---------------------|
| POST /api/orgs/:orgId/invites | Authenticated owner → DB write + email | CSRF, requireAuth, owner-only guard, orgId-match guard, schema validation (email format, role enum) |
| GET /api/orgs/:orgId/invites | Authenticated owner → DB read | requireAuth, owner-only guard, orgId-match guard |
| DELETE /api/orgs/:orgId/invites/:inviteId | Authenticated owner → DB write + email | CSRF, requireAuth, owner-only guard, orgId-match guard |
| PATCH /api/orgs/:orgId/members/:userId | Authenticated owner → DB write + email | CSRF, requireAuth, owner-only guard, orgId-match guard, OwnerRoleImmutableError |
| POST /api/invites/:token/accept | Authenticated user → DB write | CSRF, requireAuth, email-pin (D-15), validity checks (expired/revoked/accepted) |

No new surface outside the plan's threat model.

## Self-Check: PASSED

All 15 file/commit checks passed: route files exist, repo methods present, error class defined, CSRF guards confirmed, commit e00f1e0 in git log.
