---
phase: 12-plugin-system-webhooks
plan: "03"
subsystem: webhooks
tags: [routes, webhooks, dlq, idempotency, scrubbing, signature-verification, rate-limit]
dependency_graph:
  requires: ["12-01", "12-02"]
  provides: ["webhook-ingress-routes", "shared-handler-pipeline", "scrub-helpers"]
  affects: ["app.ts", "task-runs-repo", "tasks-repo"]
tech_stack:
  added: []
  patterns:
    - "rawBody capture via encapsulated Fastify contentTypeParser (JSON→Buffer parseAs, then re-parse)"
    - "DLQ insert as best-effort helper (writeDlq) — failure logged, not rethrown"
    - "Delivery dedup via onConflictDoNothing + inserted flag check"
    - "Plugin secret resolved once per request via webhookTokens.resolvePluginSecret(tokenId)"
    - "triggerSource='webhook' on task_runs; triggeredByUserId=null accepted by audit log FK"
key_files:
  created:
    - packages/server/src/routes/hooks/scrub.ts
    - packages/server/src/routes/hooks/index.ts
    - packages/server/src/routes/hooks/shared-handler.ts
    - packages/server/src/routes/hooks/__tests__/scrub.test.ts
    - packages/server/src/routes/hooks/__tests__/hooks.integration.test.ts
  modified:
    - packages/server/src/app.ts
    - packages/server/src/repos/tasks.ts
    - packages/server/src/repos/task-runs.ts
decisions:
  - "rawBody captured inside encapsulated registerHookRoutes scope (not app.ts root) — all /hooks routes share same scope, HMAC verify works; /api routes unaffected"
  - "Pino redact paths extended for x-hub-signature, x-hub-signature-256, x-github-token, x-xci-token (both req.headers and req.raw.headers variants)"
  - "DLQ writes are best-effort: writeDlq helper catches insert errors, logs them, never rethrows — a DLQ failure must not convert a 401 into a 500"
  - "Secrets resolved for webhook-triggered runs with actorUserId=null (audit log schema accepts null FK per D-21)"
  - "Unknown plugin returns 404 immediately, BEFORE any DB lookup — DLQ not written for malformed URLs (T-12-03-07)"
  - "listTriggerable() added to tasks repo using jsonb_array_length > 0 filter; returns only tasks with configured triggers"
metrics:
  duration: ~35min
  completed: "2026-04-18"
  tasks_completed: 3
  files_created: 5
  files_modified: 3
---

# Phase 12 Plan 03: Webhook Routes + Idempotency + Scrubbing + DLQ Pipeline Summary

Delivered the full webhook ingress surface: two HTTP endpoints (`/hooks/github/:orgToken` and `/hooks/perforce/:orgToken`) wired to a shared handler implementing the 9-step verify→dedup→parse→mapToTask→dispatch→DLQ pipeline. Completed SC-1 (signature + DLQ), SC-3 (delivery dedup), and SC-5 (header scrubbing before persist).

## POST /hooks/:plugin/:token Full Handler Flow

The shared handler (`handleIncomingWebhook`) implements these steps:

1. **Plugin lookup** — `getPlugin(pluginName)` from static registry; unknown name → `WebhookPluginNotFoundError` (404). NOT written to DLQ (URL itself is malformed).
2. **URL token → orgId** — `adminRepo.findWebhookTokenByPlaintext(orgToken)` via sha256 hash lookup; missing/revoked → `WebhookTokenNotFoundError` (404). Also validates plugin name in URL matches plugin name stored for the token (T-12-03-07 mitigation).
3. **Plugin secret** — `forOrg(orgId).webhookTokens.resolvePluginSecret(tokenId)` — returns `Buffer` (GitHub HMAC secret) or `null` (Perforce, no HMAC).
4. **Verify** — `plugin.verify(req, pluginSecret)` returns `{ok: true, deliveryId}` or `{ok: false, reason}`. On failure: `writeDlq('signature_invalid', ...)` + `WebhookSignatureInvalidError` (401).
5. **Dedup** — `forOrg(orgId).webhookDeliveries.recordDelivery({pluginName, deliveryId})` using `onConflictDoNothing`. If `inserted === false` → `pino.warn` + `200 {status:'duplicate', deliveryId}`. No DLQ on duplicate.
6. **Parse** — `plugin.parse(req)`. Throws → `writeDlq('parse_failed', ...) + 202`. Returns `null` (ignored event) → `202 {ignored:true}` (no DLQ — legitimate skip).
7. **Candidates** — `forOrg(orgId).tasks.listTriggerable()` (scoped to resolved org; T-12-03-04 isolation invariant).
8. **mapToTask** — `plugin.mapToTask(event, candidates)`. Zero matches → `writeDlq('no_task_matched', ...) + 202`.
9. **Dispatch loop** — for each match: `resolveTaskParams → taskRuns.create(triggerSource='webhook', triggeredByUserId=null) → buildRedactionTable → dispatchQueue.enqueue`. Returns `202 {dispatched: N, runIds, deliveryId}`.

Any unhandled error: `writeDlq('internal', ...) + 500` (best-effort; DLQ failure logged and swallowed).

## rawBody Capture Approach

Content-type parser registered inside `registerHookRoutes` (encapsulated Fastify scope, NOT wrapped in `fastify-plugin`). This means:
- Parser applies only to `/hooks/*` routes — all `/api/*` routes continue using Fastify's default JSON parser unaffected.
- Parser reads body `as 'buffer'`, attaches raw bytes to `(req as any).rawBody`, then calls `JSON.parse(buf.toString('utf8'))`.
- GitHub plugin reads `req.rawBody` in `verify()` to compute HMAC over exact bytes the sender signed.

## scrubHeaders Deny-List Implementation

```ts
export const SENSITIVE_HEADER_DENYLIST: readonly string[] = [
  'authorization', 'x-hub-signature', 'x-hub-signature-256',
  'x-github-token', 'x-xci-token', 'cookie', 'set-cookie',
];
```

- `scrubHeaders(headers)` iterates `Object.entries` and rebuilds a new object, skipping any key where `key.toLowerCase()` is in the `Set` built from the deny-list.
- Returns new object (no mutation).
- `scrubBody<T>(body: T): T` is identity pass-through (D-26: no body scrub in Phase 12).

## SC-5 Test Assertion Pattern

Applied in Test 2 (invalid signature path) and Test 10 (all denied headers + no_task_matched path):

```ts
const headers = dlqRows[0].scrubbedHeaders as Record<string, unknown>;
const headerKeysLower = Object.keys(headers).map((k) => k.toLowerCase());
for (const denied of ['authorization', 'x-hub-signature', 'x-hub-signature-256', ...]) {
  expect(headerKeysLower).not.toContain(denied);
}
```

Post-insert DB query verifies the final persisted state, not just in-memory — catches any path that bypasses scrubHeaders.

## Integration Test Count + SC Coverage

| Test | Description | SCs |
|------|-------------|-----|
| 1 | Valid HMAC → 202 dispatched:1, trigger_source='webhook' | SC-1 |
| 2 | Invalid HMAC → 401 + DLQ + scrubbed_headers checked | SC-1, SC-5 |
| 3 | Same delivery ID twice → 200 duplicate, 1 run | SC-3 |
| 4 | issues event → 202 ignored, no run, no DLQ | — |
| 5 | Non-matching repo → 202 no_task_matched + DLQ | SC-6 |
| 6 | Unknown plugin → 404, no DLQ | — |
| 7 | Unknown token → 404, no DLQ | — |
| 8 | Perforce valid token → 202 dispatched:1, p4.* params | SC-2 partial |
| 9 | orgA token → orgB tasks NOT dispatched | T-12-03-04 |
| 10 | All 7 denied headers → none in dlq scrubbed_headers | SC-5 comprehensive |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `exactOptionalPropertyTypes` incompatibility in writeDlq**
- **Found during:** Task 2 typecheck
- **Issue:** `deliveryId: string | undefined` not assignable to optional `deliveryId?: string` with strict optional property types
- **Fix:** Built `dlqParams` object and conditionally set `deliveryId` only when defined
- **Files modified:** `packages/server/src/routes/hooks/shared-handler.ts`
- **Commit:** a9f43f5

**2. [Rule 2 - Missing critical functionality] Added `listTriggerable()` to tasks repo**
- **Found during:** Task 2 implementation
- **Issue:** Context notes noted this might not exist from Plan 12-01; it was indeed missing
- **Fix:** Added `listTriggerable(): Promise<Array<{id, triggerConfigs}>>` using `jsonb_array_length > 0` filter
- **Files modified:** `packages/server/src/repos/tasks.ts`
- **Commit:** a9f43f5

**3. [Rule 2 - Missing critical functionality] Added `triggerSource` param to `taskRuns.create`**
- **Found during:** Task 2 implementation
- **Issue:** Plan 12-03 requires `trigger_source='webhook'` on webhook runs but `create()` had no `triggerSource` param
- **Fix:** Added optional `triggerSource?: 'manual' | 'webhook'` with default `'manual'` (backward-compat)
- **Files modified:** `packages/server/src/repos/task-runs.ts`
- **Commit:** a9f43f5

### Integration Tests (CI-only)

Integration tests (`hooks.integration.test.ts`) require a Postgres testcontainer (Docker). This environment has no Docker runtime — tests are written and committed but can only be executed in Linux CI (ubuntu-latest with Docker). This matches the existing integration test pattern documented in STATE.md Phase 7 decisions.

## Known Stubs

None. All pipeline branches are wired: scrubHeaders applied in writeDlq, all 5 DLQ failure reasons covered, listTriggerable() returns live DB data, dispatch path identical to Plan 10-04 trigger.ts pattern.

## Threat Flags

None beyond what is already in the plan's threat register (T-12-03-01 through T-12-03-08, all mitigated).

## Self-Check: PASSED

Files exist:
- packages/server/src/routes/hooks/scrub.ts: FOUND
- packages/server/src/routes/hooks/index.ts: FOUND
- packages/server/src/routes/hooks/shared-handler.ts: FOUND
- packages/server/src/routes/hooks/__tests__/scrub.test.ts: FOUND
- packages/server/src/routes/hooks/__tests__/hooks.integration.test.ts: FOUND

Commits exist:
- a9f43f5 (feat(12-03): scrub helpers + rawBody + route skeleton + rate-limit): FOUND
- a99df7c (test(12-03): add webhook ingress integration tests): FOUND

Unit tests: 275 passed (255 pre-existing + 20 scrub tests)
Typecheck: clean
Build: clean
