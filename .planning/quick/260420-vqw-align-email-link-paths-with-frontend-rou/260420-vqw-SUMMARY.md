---
phase: 260420-vqw
plan: 01
subsystem: server/email
tags: [server, email, auth, invites, bugfix]
dependency-graph:
  requires: []
  provides: []
  affects:
    - packages/server/src/email/link.ts
    - packages/server/src/email/__tests__/link.test.ts
    - packages/server/src/routes/auth/signup.ts
    - packages/server/src/routes/auth/request-reset.ts
    - packages/server/src/routes/orgs/invites.ts
tech-stack:
  added: []
  patterns:
    - "path-segment tokens in email links to match React Router path-param routes"
key-files:
  created: []
  modified:
    - packages/server/src/email/link.ts
    - packages/server/src/email/__tests__/link.test.ts
    - packages/server/src/routes/auth/signup.ts
    - packages/server/src/routes/auth/request-reset.ts
    - packages/server/src/routes/orgs/invites.ts
decisions:
  - "buildEmailLink simplified to (ctx, path); caller owns the full path — helper's sole job is base-URL resolution"
  - "invites.ts now uses the helper; the hand-rolled base-URL duplication and /accept suffix are both removed in one atomic change"
metrics:
  duration: 4m
  completed: 2026-04-20
requirements:
  - QUICK-260420-vqw
---

# Quick Task 260420-vqw: Align Email Link Paths with Frontend Routes Summary

Backend email-link emission now matches the React Router path-segment routes (`/verify-email/:token`, `/reset-password/:token`, `/invites/:token`) so users clicking signup / password-reset / invite links land on the correct pages instead of bouncing to `/login`.

## What Changed

`buildEmailLink(ctx, path)` — dropped the `queryKey` / `queryValue` parameters. The helper is now base-URL resolution only (`APP_BASE_URL` → `https://<headerHost>` → `https://localhost`) with path concatenation. All three callers build their path segment inline with `encodeURIComponent(token)`.

Three call sites updated:

| Route              | Before                                       | After                                                  |
| ------------------ | -------------------------------------------- | ------------------------------------------------------ |
| signup.ts          | `/verify-email?token=<tok>`                  | `/verify-email/<urlencoded-tok>`                       |
| request-reset.ts   | `/reset?token=<tok>`                         | `/reset-password/<urlencoded-tok>`                     |
| invites.ts         | `${base}/invites/<urlencoded-tok>/accept` (hand-rolled) | `/invites/<urlencoded-tok>` (via helper)  |

invites.ts gained the `buildEmailLink` import alongside the email-template imports; the hand-rolled `fastify.config.APP_BASE_URL ?? ...` resolution was removed (duplicate helper logic).

link.test.ts rewritten for the two-arg signature: 5 tests covering APP_BASE_URL / headerHost / localhost fallback branches + path-verbatim concatenation + caller-owned path encoding. Query-encoding assertions dropped (the helper no longer owns that concern).

Backend POST endpoints that the frontend pages call (`/reset` for password submit, `/invites/:token/accept` for invite accept) are left intact — those are API paths, distinct from the user-facing email-link paths.

## Verification

- `npx vitest run src/email/__tests__/link.test.ts` — 5/5 tests pass (worktree at `/home/developer/projects/loci/.claude/worktrees/agent-a32fe0cf`)
- `grep "buildEmailLink.*'token'" packages/server/src/routes/` — no matches (no legacy four-arg callers)
- `grep "/invites/.*/accept" packages/server/src/` — only backend POST endpoint `/api/invites/:token/accept` remains (intentional; distinct from email-link path)
- `grep "'/reset'" packages/server/src/routes/auth/` — only backend POST endpoint `/reset` remains (intentional; password submit API)

## Deviations from Plan

None - plan executed exactly as written.

## Commits

- `b1f889a` — fix(server): align email link paths with frontend routes

## Self-Check: PASSED

- FOUND: packages/server/src/email/link.ts (two-arg signature)
- FOUND: packages/server/src/email/__tests__/link.test.ts (5 tests)
- FOUND: packages/server/src/routes/auth/signup.ts (path-segment)
- FOUND: packages/server/src/routes/auth/request-reset.ts (path-segment)
- FOUND: packages/server/src/routes/orgs/invites.ts (path-segment, helper-based)
- FOUND commit: b1f889a
