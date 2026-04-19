---
phase: 12-plugin-system-webhooks
plan: "02"
subsystem: plugins-trigger
tags: [plugins, github-webhook, perforce-webhook, hmac, signature-verification, plugin-registry, tdd]
dependency_graph:
  requires:
    - 12-01  # DB schema (webhook_tokens, dlq_entries, trigger_configs column)
  provides:
    - TriggerPlugin interface (consumed by Plan 12-03 shared webhook route handler)
    - GitHub plugin (HMAC-SHA256 verify + push/PR parse + mapToTask)
    - Perforce plugin (X-Xci-Token verify + JSON parse + mapToTask)
    - pluginRegistry Map + getPlugin() function
    - matchGlob() utility
  affects:
    - packages/server/src/db/schema.ts (TriggerConfig now imported from plugins-trigger/types.ts)
tech_stack:
  added: []
  patterns:
    - TDD (RED/GREEN per task; 3 RED → 3 GREEN cycles)
    - Static plugin registry (no dynamic import, no runtime install — PLUG-02 anti-feature)
    - Timing-safe HMAC comparison via compareToken (timingSafeEqual wrapper, ATOK-06)
    - Hand-rolled * wildcard glob (no picomatch; D-36 discretion)
key_files:
  created:
    - packages/server/src/plugins-trigger/types.ts
    - packages/server/src/plugins-trigger/glob.ts
    - packages/server/src/plugins-trigger/github.ts
    - packages/server/src/plugins-trigger/perforce.ts
    - packages/server/src/plugins-trigger/index.ts
    - packages/server/src/plugins-trigger/__tests__/glob.test.ts
    - packages/server/src/plugins-trigger/__tests__/github.test.ts
    - packages/server/src/plugins-trigger/__tests__/perforce.test.ts
    - packages/server/src/plugins-trigger/__tests__/contract.test.ts
  modified:
    - packages/server/src/db/schema.ts
decisions:
  - "errors.ts already had 6 Phase 12 error classes from Plan 12-01 work; no additions needed"
  - "schema.ts: replaced inline GitHubTriggerConfig/PerforceTriggerConfig/TriggerConfig definitions with import+re-export from plugins-trigger/types.ts (canonical move per plan)"
  - "Perforce plugin's verify() ignores pluginSecret (D-13): token identity checked at route layer (Plan 12-03); plugin enforces X-Xci-Token header presence as defense-in-depth only"
  - "GitHub action type cast: used string narrowing + includes() check before assigning action field to avoid complex conditional type gymnastics while keeping TS clean"
  - "matchGlob uses .+  (one-or-more) for * expansion rather than .* (zero-or-more) to match D-10 behavior: 'acme/*' requires at least one char after the slash"
metrics:
  duration_minutes: 9
  completed_date: "2026-04-19"
  tasks_completed: 3
  files_created: 9
  files_modified: 1
  tests_added: 78
---

# Phase 12 Plan 02: TriggerPlugin Interface + GitHub + Perforce Plugins + Registry Summary

**One-liner:** Static plugin registry with TriggerPlugin<E> interface, GitHub HMAC-SHA256 + Perforce X-Xci-Token plugins, and hand-rolled glob matcher — 78 tests green.

## What Was Built

### TriggerPlugin Interface (`types.ts`)
3-method generic interface:
```ts
interface TriggerPlugin<E = unknown> {
  name: 'github' | 'perforce';
  verify(req: FastifyRequest, pluginSecret: Buffer | null): VerifyResult;
  parse(req: FastifyRequest): E | null;
  mapToTask(event: E, candidates: Array<{ taskId: string; configs: TriggerConfig[] }>): TaskTriggerMatch[];
}
```
Also defines `VerifySuccess/VerifyFailure/VerifyResult`, `GitHubPushEvent`, `GitHubPullRequestEvent`, `GitHubEvent`, `PerforceEvent`, `GitHubTriggerConfig`, `PerforceTriggerConfig`, `TriggerConfig`, `TaskTriggerMatch`.

`schema.ts` was refactored to import+re-export these types from `plugins-trigger/types.ts` (canonical location) instead of duplicating them.

### Error Classes (`errors.ts`)
6 new classes were already present from Plan 12-01:
- `WebhookSignatureInvalidError` (AuthnError, 401, `AUTHN_WEBHOOK_SIGNATURE_INVALID`)
- `WebhookTokenNotFoundError` (NotFoundError, 404, `NF_WEBHOOK_TOKEN`)
- `WebhookPluginNotFoundError` (NotFoundError, 404, `NF_WEBHOOK_PLUGIN`)
- `WebhookDuplicateDeliveryError` (ConflictError, 409, `CONFLICT_WEBHOOK_DUPLICATE_DELIVERY`)
- `DlqEntryNotFoundError` (NotFoundError, 404, `NF_DLQ_ENTRY`)
- `DlqRetryFailedError` (InternalError, 500, `INT_DLQ_RETRY_FAILED`)

### Glob Helper (`glob.ts`)
Hand-rolled `matchGlob(pattern, value): boolean`. Translates `*` to `.+` (requires at least 1 char), escapes all other regex metacharacters. Handles Perforce depot paths (e.g., `//depot/infra/*`) correctly. No nested quantifiers → no catastrophic backtracking (T-12-02-04).

### GitHub Plugin (`github.ts`)
- **verify**: checks `X-GitHub-Delivery` (→ `header_missing` if absent), `X-Hub-Signature-256` with `sha256=` prefix (→ `signature_missing`), computes `HMAC-SHA256(pluginSecret, rawBody)`, compares via `compareToken` (timingSafeEqual, T-12-02-01). Returns `signature_mismatch` if `rawBody` absent — fail-closed (T-12-02-05).
- **parse**: `push` → `GitHubPushEvent` with `ref/repository/sha/pusher/message`; `pull_request` → `GitHubPullRequestEvent` with `action/repository/number/headRef/baseRef/title`; all other events (issues, ping, workflow_run) → `null`; malformed bodies → throws.
- **mapToTask**: filters by `plugin:'github'`, `events[]`, optional `repository` glob, optional `branch` glob (push: extracted from `refs/heads/` prefix; tag pushes → `branch=''`), optional `actions[]` for PRs. Returns `git.*` or `pr.*` params per D-11.

### Perforce Plugin (`perforce.ts`)
- **verify**: checks `X-Xci-Token` header present and non-empty (→ `header_missing` otherwise). Uses `body.delivery_id` or auto-generates UUID (D-24). Does NOT check token value — route layer (Plan 12-03) handles token identity via hash lookup.
- **parse**: validates `{change, user, client, root, depot}` as required string fields; throws on missing/wrong-type fields or non-object body; auto-generates `deliveryId` if absent.
- **mapToTask**: filters by `plugin:'perforce'` + optional `depot/user/client` globs; returns `p4.*` params per D-15.

### Plugin Registry (`index.ts`)
```ts
export const pluginRegistry: ReadonlyMap<'github'|'perforce', TriggerPlugin> = new Map([...]);
export function getPlugin(name: string): TriggerPlugin | undefined;
export * from './types.js';
```
Static imports only — bundled at build time (PLUG-02 anti-feature). `getPlugin('gitlab')` → `undefined`.

## Test Coverage

| File | Tests | Key Cases |
|------|-------|-----------|
| glob.test.ts | 15 | literals, `*` wildcard, two-segment, Perforce depot, regex-char escape, empty pattern |
| github.test.ts | 23 | verify: 7 cases (missing sig, malformed, wrong HMAC, correct, missing delivery, null secret, missing rawBody); parse: 7 cases; mapToTask: 9 cases |
| perforce.test.ts | 18 | verify: 4 cases; parse: 6 cases; mapToTask: 8 cases |
| contract.test.ts | 22 | 8 structural assertions × 2 plugins + 6 registry assertions |
| **Total** | **78** | All green |

## Subtleties for Plan 12-03

### rawBody capture (Plan 12-03 must wire this)
`githubPlugin.verify()` reads `(req as any).rawBody` — a `Buffer` that must be captured BEFORE Fastify parses the JSON body. Plan 12-03's route handler must install a `preParsing` or `onSend` hook (or a custom content-type parser) that stashes the raw bytes on `req.rawBody`. If `rawBody` is absent, `verify` returns `{ok:false, reason:'signature_mismatch'}` (fail-closed). This is documented in T-12-02-05.

### `pluginSecret: Buffer | null` convention
- **GitHub**: `pluginSecret` is the per-org GitHub webhook secret (AES-256-GCM decrypted at route time from `webhook_tokens.plugin_secret_encrypted`). Must be `Buffer` (not null) or verify returns `header_missing`.
- **Perforce**: Plan 12-03 passes `pluginSecret=null` — the Perforce plugin ignores it entirely. Token identity verification is done at the route layer via `adminRepo.findWebhookTokenByPlaintext(urlToken)`.

## Deviations from Plan

None — plan executed exactly as written. The 6 error classes were already present in `errors.ts` from Plan 12-01 work (deviation: tasks completed faster, not slower; no new work required).

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced by this plan. The only surface change is the `plugins-trigger/` module which is consumed internally by Plan 12-03's route handler — not directly exposed.

## Known Stubs

None. All plugin methods are fully wired. The only external dependency is `rawBody` on `req`, which Plan 12-03 must provide (documented above).

## Self-Check: PASSED
