---
phase: 260420-vqw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/server/src/email/link.ts
  - packages/server/src/email/__tests__/link.test.ts
  - packages/server/src/routes/auth/signup.ts
  - packages/server/src/routes/auth/request-reset.ts
  - packages/server/src/routes/orgs/invites.ts
autonomous: true
requirements:
  - QUICK-260420-vqw
must_haves:
  truths:
    - "Signup verification email contains a link whose path matches the frontend React route /verify-email/:token"
    - "Password reset email contains a link whose path matches the frontend React route /reset-password/:token"
    - "Org invite email contains a link whose path matches the frontend React route /invites/:token"
    - "buildEmailLink signature is (ctx, path): string with path fully owned by the caller (token baked into the path)"
    - "APP_BASE_URL / headers.host / 'localhost' fallback chain is preserved in the simplified helper"
    - "link.test.ts assertions cover all three fallback branches of the simplified helper and pass green"
  artifacts:
    - path: "packages/server/src/email/link.ts"
      provides: "Simplified buildEmailLink(ctx, path) — base-URL resolution only"
      contains: "export function buildEmailLink"
    - path: "packages/server/src/email/__tests__/link.test.ts"
      provides: "Unit tests for the simplified two-arg helper (APP_BASE_URL / headerHost / localhost branches)"
      contains: "buildEmailLink"
    - path: "packages/server/src/routes/auth/signup.ts"
      provides: "Signup route emitting /verify-email/${token} path-segment link"
      contains: "/verify-email/${encodeURIComponent"
    - path: "packages/server/src/routes/auth/request-reset.ts"
      provides: "Request-reset route emitting /reset-password/${token} path-segment link"
      contains: "/reset-password/${encodeURIComponent"
    - path: "packages/server/src/routes/orgs/invites.ts"
      provides: "Create-invite route emitting /invites/${token} path-segment link (no trailing /accept)"
      contains: "/invites/${encodeURIComponent"
  key_links:
    - from: "packages/server/src/routes/auth/signup.ts"
      to: "packages/server/src/email/link.ts"
      via: "buildEmailLink(ctx, `/verify-email/${encodeURIComponent(v.token)}`)"
      pattern: "buildEmailLink\\([^,]+,\\s*`/verify-email/"
    - from: "packages/server/src/routes/auth/request-reset.ts"
      to: "packages/server/src/email/link.ts"
      via: "buildEmailLink(ctx, `/reset-password/${encodeURIComponent(pr.token)}`)"
      pattern: "buildEmailLink\\([^,]+,\\s*`/reset-password/"
    - from: "packages/server/src/routes/orgs/invites.ts"
      to: "packages/server/src/email/link.ts"
      via: "buildEmailLink(ctx, `/invites/${encodeURIComponent(created.token)}`)"
      pattern: "buildEmailLink\\([^,]+,\\s*`/invites/"
---

<objective>
Align the backend email-link emission with the frontend React Router path-segment routes so that signup verification, password reset, and org invite emails lead to pages that successfully read the token instead of silently bouncing to /login.

Purpose: Users who click email links currently land on a URL shape React Router cannot match (query-param token on routes that expect path segments, or the wrong path entirely for reset and invites). The auth guard then sends them to /login with no explanation. The fix is backend-only — the frontend routes are the source of truth.

Output: Simplified `buildEmailLink` helper (base-URL resolution only), three call sites updated to path-segment URLs matching the frontend routes, and the unit tests for the helper rewritten to assert the new two-arg signature while preserving the APP_BASE_URL / headers.host / localhost fallback coverage.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@packages/server/src/email/link.ts
@packages/server/src/email/__tests__/link.test.ts
@packages/server/src/routes/auth/signup.ts
@packages/server/src/routes/auth/request-reset.ts
@packages/server/src/routes/orgs/invites.ts
@packages/web/src/routes/index.tsx

<interfaces>
Current (to be replaced) signature in packages/server/src/email/link.ts:

```typescript
export interface BuildEmailLinkCtx {
  appBaseUrl: string | undefined;
  headerHost: string | undefined;
}

export function buildEmailLink(
  ctx: BuildEmailLinkCtx,
  path: string,
  queryKey: string,
  queryValue: string,
): string;
```

Target signature (two args, path fully owned by caller):

```typescript
export interface BuildEmailLinkCtx {
  appBaseUrl: string | undefined;
  headerHost: string | undefined;
}

export function buildEmailLink(ctx: BuildEmailLinkCtx, path: string): string;
```

Frontend routes (source of truth — DO NOT modify, reference only):

```tsx
{ path: '/reset-password/:token', element: <ResetPassword /> },
{ path: '/verify-email/:token', element: <VerifyEmail /> },
{ path: '/invites/:token', element: <InviteAccept /> },
```

Existing call-site pattern in invites.ts (already bypasses the helper; must be normalized to use the new helper too):

```typescript
const base = fastify.config.APP_BASE_URL ?? `https://${req.headers.host ?? 'localhost'}`;
const link = `${base}/invites/${encodeURIComponent(created.token)}/accept`;
```

This current invites code has TWO defects: it hand-rolls the base-URL resolution (duplicating the helper logic) AND appends the frontend-incompatible `/accept` suffix. Both are removed in this plan.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Refactor buildEmailLink to (ctx, path) and realign all three call sites + rewrite link.test.ts</name>
  <files>packages/server/src/email/link.ts, packages/server/src/email/__tests__/link.test.ts, packages/server/src/routes/auth/signup.ts, packages/server/src/routes/auth/request-reset.ts, packages/server/src/routes/orgs/invites.ts</files>
  <action>
Atomic refactor — all five files change together so the repo is never in a broken state between commits.

1) packages/server/src/email/link.ts — simplify helper:
   Replace the file contents with the two-arg version. Keep `BuildEmailLinkCtx` identical. Body becomes base-URL resolution + concatenation only:

   ```typescript
   export interface BuildEmailLinkCtx {
     appBaseUrl: string | undefined;
     headerHost: string | undefined;
   }

   export function buildEmailLink(ctx: BuildEmailLinkCtx, path: string): string {
     const base = ctx.appBaseUrl ?? `https://${ctx.headerHost ?? 'localhost'}`;
     return `${base}${path}`;
   }
   ```

   The APP_BASE_URL / headers.host / 'localhost' fallback chain is preserved verbatim. No new behavior — the helper's sole remaining job is base resolution.

2) packages/server/src/routes/auth/signup.ts — update the call site at the current `buildEmailLink(...)` invocation (around line 43). Change from the four-arg form to:

   ```typescript
   const verifyLink = buildEmailLink(
     { appBaseUrl: fastify.config.APP_BASE_URL, headerHost: req.headers.host },
     `/verify-email/${encodeURIComponent(v.token)}`,
   );
   ```

   Matches frontend route `/verify-email/:token`. Everything else in the file stays.

3) packages/server/src/routes/auth/request-reset.ts — update the call site (around line 42). Change from the four-arg form to:

   ```typescript
   const link = buildEmailLink(
     { appBaseUrl: fastify.config.APP_BASE_URL, headerHost: req.headers.host },
     `/reset-password/${encodeURIComponent(pr.token)}`,
   );
   ```

   Two fixes here: path changes from `/reset` → `/reset-password` (matches the frontend route) AND query-param shape → path segment. Everything else in the file stays.

4) packages/server/src/routes/orgs/invites.ts — remove the hand-rolled base-URL + `/accept` suffix (lines 69-70) and use the helper with a path-segment token:

   ```typescript
   const link = buildEmailLink(
     { appBaseUrl: fastify.config.APP_BASE_URL, headerHost: req.headers.host },
     `/invites/${encodeURIComponent(created.token)}`,
   );
   ```

   Add `import { buildEmailLink } from '../../email/link.js';` at the top of the file alongside the other email-template imports (it is not currently imported there). Drop the trailing `/accept` — the frontend route is `/invites/:token`, no further segment. The rest of the invites file (revoke email, members routes, etc.) is untouched.

5) packages/server/src/email/__tests__/link.test.ts — rewrite the five existing tests to the new two-arg signature. Keep the `describe` title referencing the historical quick-task lineage but update it to reflect the current change:

   ```typescript
   import { describe, expect, it } from 'vitest';
   import { buildEmailLink } from '../link.js';

   describe('buildEmailLink (Quick 260420-vqw)', () => {
     it('uses APP_BASE_URL verbatim as prefix when set', () => {
       const link = buildEmailLink(
         { appBaseUrl: 'http://localhost:3000', headerHost: 'x' },
         '/verify-email/abc',
       );
       expect(link).toBe('http://localhost:3000/verify-email/abc');
     });

     it('falls back to https://<headerHost> when APP_BASE_URL is unset', () => {
       const link = buildEmailLink(
         { appBaseUrl: undefined, headerHost: 'example.com' },
         '/reset-password/xyz',
       );
       expect(link).toBe('https://example.com/reset-password/xyz');
     });

     it('falls back to https://localhost when both APP_BASE_URL and headerHost are unset', () => {
       const link = buildEmailLink(
         { appBaseUrl: undefined, headerHost: undefined },
         '/invites/abc',
       );
       expect(link).toBe('https://localhost/invites/abc');
     });

     it('does not re-encode the path (caller owns path-segment encoding)', () => {
       const encoded = encodeURIComponent('raw/tok');
       const link = buildEmailLink(
         { appBaseUrl: 'http://localhost:3000', headerHost: undefined },
         `/invites/${encoded}`,
       );
       expect(link).toBe('http://localhost:3000/invites/raw%2Ftok');
     });

     it('concatenates path verbatim (no extra separator, no implicit query)', () => {
       const link = buildEmailLink(
         { appBaseUrl: 'https://app.example.com', headerHost: undefined },
         '/verify-email/abc',
       );
       expect(link).toBe('https://app.example.com/verify-email/abc');
     });
   });
   ```

   The three valuable branches — APP_BASE_URL set, headerHost fallback, localhost fallback — are preserved. Query-param encoding assertions are removed (helper no longer owns that). Caller-owned path-encoding assertion remains (still important: the helper must not re-encode). The old test file references `/reset` and `/verify-email?token=...` — the rewrite replaces those with the new path-segment shapes.

Follow CLAUDE.md rules: no emojis, no explanatory comments added to code, no defensive coding (no try/catch around path concat), prefer Edit over Write where possible (use Write only for link.test.ts whole-file rewrite and link.ts whole-file rewrite — both are small and benefit from replacement over targeted edits).

Do NOT touch any other file. Do NOT modify packages/web/**. Do NOT change env schema. Do NOT change docker-compose.yml or .env.example.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter @xci/server typecheck && pnpm --filter @xci/server test:unit -- link</automated>
  </verify>
  <done>
- packages/server/src/email/link.ts exports `buildEmailLink(ctx, path)` (two args) with the APP_BASE_URL / headerHost / localhost fallback preserved
- Three call sites (signup.ts, request-reset.ts, invites.ts) all pass a path-segment URL matching the frontend routes: `/verify-email/${encodeURIComponent(token)}`, `/reset-password/${encodeURIComponent(token)}`, `/invites/${encodeURIComponent(token)}`
- invites.ts imports `buildEmailLink` and no longer hand-rolls base resolution; the `/accept` suffix is gone
- link.test.ts asserts the new two-arg signature across all three fallback branches plus the no-re-encode invariant; all tests pass under `pnpm --filter @xci/server test:unit`
- `pnpm --filter @xci/server typecheck` is green (signature change propagates cleanly — no stray three/four-arg callers remain)
- No changes under packages/web/, no changes to env schema, no changes to docker-compose
  </done>
</task>

</tasks>

<verification>
Server typecheck and the unit test subset covering link.ts pass green. A grep for the old query-param call-site shape returns zero hits in server routes:

```bash
grep -rn "buildEmailLink.*'token'" packages/server/src/routes/ || echo "OK: no legacy four-arg callers"
grep -rn "/invites/.*/accept" packages/server/src/ || echo "OK: no /accept suffix"
grep -rn "'/reset'" packages/server/src/routes/auth/ || echo "OK: no /reset path"
```

Manual sanity (optional, post-deploy): trigger signup / request-reset / invite-create against a running dev stack, inspect the MailHog-captured email body, confirm the rendered link path is `/verify-email/<token>`, `/reset-password/<token>`, `/invites/<token>` (no `?token=`, no `/accept`).
</verification>

<success_criteria>
- Signup verification email link path shape: `<base>/verify-email/<urlencoded-token>` — matches frontend route `/verify-email/:token`
- Password reset email link path shape: `<base>/reset-password/<urlencoded-token>` — matches frontend route `/reset-password/:token`
- Org invite email link path shape: `<base>/invites/<urlencoded-token>` — matches frontend route `/invites/:token`
- `buildEmailLink` has exactly two parameters: `(ctx, path)`; no call site passes `queryKey` / `queryValue` anywhere in packages/server/
- link.test.ts is green with the new signature; the three fallback branches (APP_BASE_URL, headerHost, localhost) remain covered
- No change under packages/web/
- No change to env schema, docker-compose.yml, or .env.example
</success_criteria>

<output>
After completion, create `.planning/quick/260420-vqw-align-email-link-paths-with-frontend-rou/260420-vqw-SUMMARY.md`
</output>
