---
phase: 260420-t6q
plan: 01
subsystem: server/email
tags: [smtp, transport, nodemailer, mailhog, bugfix]
requires:
  - packages/server/src/email/transport.ts
provides:
  - auth-less-smtp-transport-for-empty-credentials
affects:
  - signup email delivery
  - password-reset email delivery
  - dev docker-compose mailhog flow
tech-stack:
  added: []
  patterns:
    - "truthy-guard spread over strict !== undefined for string env vars that may ship empty"
key-files:
  created: []
  modified:
    - packages/server/src/email/transport.ts
    - packages/server/src/email/__tests__/transport.test.ts
decisions:
  - "Empty-string SMTP_USER treated identically to undefined; no auth spread into nodemailer options"
  - "Regression guard asserts both negative (empty → no auth) and positive (non-empty → auth wired) paths via vi.spyOn(nodemailer, 'createTransport')"
metrics:
  duration: 275s
  tasks: 1
  files: 2
  completed: 2026-04-20
---

# Quick 260420-t6q: Fix SMTP transport empty credentials — Summary

Replace `SMTP_USER !== undefined` guard with truthy check so `.env` shipping `SMTP_USER=` (empty) no longer wires `auth: { user: '', pass: '' }` into nodemailer — which caused `EAUTH PLAIN: Missing credentials for "PLAIN"` against mailhog and blocked signup / password-reset email delivery in the dev docker-compose stack.

## What Changed

### `packages/server/src/email/transport.ts`

Line 55 guard flipped from `cfg.SMTP_USER !== undefined` to `cfg.SMTP_USER`. Empty strings now behave identically to `undefined`: the `auth` key is omitted from the nodemailer options object, and nodemailer does not attempt SMTP AUTH. The `cfg.SMTP_PASS ?? ''` fallback is preserved for the populated-user case.

### `packages/server/src/email/__tests__/transport.test.ts`

Added two `it(...)` cases at the end of the existing `describe('createTransport (D-29) — smtp kind', ...)` block:

1. `does not configure auth when SMTP_USER is an empty string (mailhog / unauth relay)` — spies on `nodemailer.createTransport`, passes `SMTP_USER: ''`, asserts the captured options object has no `auth` property.
2. `configures auth when SMTP_USER is a non-empty string` — regression guard that the happy path still wires `auth: { user: 'u', pass: 'p' }`.

Added imports: `nodemailer` default import and `vi` from vitest.

## Commits

| Commit  | Message                                                       |
| ------- | ------------------------------------------------------------- |
| b5dc145 | fix(server): treat empty SMTP_USER as unset in email transport |

## Verification

```
cd packages/server && npx vitest run src/email/__tests__/transport.test.ts
```

Result: `Test Files 1 passed (1) | Tests 7 passed (7)` — 3 pre-existing smtp-kind tests, 2 new smtp-kind regression tests, 1 log-kind test, 1 stub-kind test, all green.

## Deviations from Plan

None — plan executed exactly as written.

## Deferred Issues

`pnpm --filter @xci/server typecheck` reports 4 pre-existing errors in `packages/server/src/routes/tasks/create.ts` (missing `xci/dsl` type declarations because the `@xci/xci` package's dist/ is not built in the worktree, and three implicit-any on `.map((e) => ...)` callbacks stemming from the same missing type import). These errors exist on the base commit `8e49f2f` independently of this task's changes (the file `src/routes/tasks/create.ts` was not touched). Per CLAUDE.md scope boundary ("Only auto-fix issues DIRECTLY caused by the current task's changes") they are out of scope for this quick task; fixing them would require either building `@xci` first or patching an unrelated file.

## Self-Check: PASSED

- packages/server/src/email/transport.ts — modified (truthy guard in place)
- packages/server/src/email/__tests__/transport.test.ts — modified (2 new it() cases + vi/nodemailer imports)
- Commit b5dc145 present on current branch
- Vitest run green (7/7 tests)
