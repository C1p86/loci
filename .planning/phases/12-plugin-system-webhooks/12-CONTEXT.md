# Phase 12: Plugin System & Webhooks - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** auto-selected (user requested autonomous chain to milestone end)

<domain>
## Phase Boundary

Phase 12 delivers the webhook trigger system: a stable 3-method plugin interface + two bundled plugins (GitHub + Perforce) + DLQ + idempotency + scrubbing.

- TypeScript plugin interface: `verify(request) → parse(event) → mapToTask(event, taskConfig)` (PLUG-01)
- 2 bundled plugins: GitHub (HMAC-SHA256 signature, push + pull_request events) and Perforce (JSON POST from `change-commit` trigger)
- Plugins bundled AT BUILD TIME only; NO dynamic runtime install (PLUG-02 anti-feature)
- Per-org endpoint routes: `/hooks/github/:orgToken` + `/hooks/perforce/:orgToken` (unauth — token-in-URL is OK here since it's a webhook sender identity, not user auth)
- Explicit per-task trigger config (no naming convention): `task.trigger_config` JSONB specifies which events match
- DLQ: entities for unprocessed events (parse fail, task not found, signature invalid); UI listable; manual retry
- Idempotency: `delivery_id` (X-GitHub-Delivery or Perforce event GUID) deduped; duplicate logged + dropped
- Scrubbing: Authorization / X-Hub-Signature / X-GitHub-Token headers stripped BEFORE DLQ persist
- CLI helper: `xci agent-emit-perforce-trigger <url> <token>` writes `.sh`/`.bat` script for Perforce machine (Node-free on that end)

This phase does NOT deliver:
- UI for DLQ retry (Phase 13 consumes the list + retry endpoint)
- GitLab / Bitbucket plugins (out of scope v2.0)
- Slack/Discord notification plugins (out of scope)
- Any scheduled/cron triggers (out of scope)

**Hard scope rule:** every requirement implemented here is one of PLUG-01..08.

</domain>

<decisions>
## Implementation Decisions

### Plugin Interface (PLUG-01)

- **D-01:** **`TriggerPlugin` TypeScript interface** exported from `packages/server/src/plugins-trigger/types.ts`:
  ```ts
  export interface TriggerPlugin<E = unknown> {
    name: string;  // 'github' | 'perforce' (unique across bundled plugins)
    verify(req: FastifyRequest, orgSecret: Buffer): { ok: true, deliveryId: string } | { ok: false, reason: string };
    parse(req: FastifyRequest): E;  // parses the body into a typed event; throws on malformed
    mapToTask(event: E, taskConfigs: TaskTriggerConfig[]): Array<{ taskId: string, params: Record<string,string> }>;
  }
  ```
  Each plugin owns its event type. Server has one shared webhook route handler that looks up the plugin by name and orchestrates verify→parse→mapToTask.

- **D-02:** **Plugins bundled at build time (PLUG-02):** `packages/server/src/plugins-trigger/github.ts`, `.../perforce.ts`, each a module exporting a default TriggerPlugin. Imported statically in `plugins-trigger/index.ts` registry. NO dynamic import, NO filesystem scan, NO npm install at runtime.

- **D-03:** **Plugin registry:** `packages/server/src/plugins-trigger/index.ts` exports `Map<string, TriggerPlugin>` with bundled plugins keyed by name. Unknown plugin name in URL → 404.

### Route Shape

- **D-04:** **Endpoints:**
  - `POST /hooks/github/:orgToken` — unauth (token-in-URL identifies org); body is GitHub webhook event
  - `POST /hooks/perforce/:orgToken` — unauth; body is Perforce JSON from trigger script
  - `POST /api/orgs/:orgId/dlq/:dlqId/retry` — Owner/Member + CSRF; replays event through verify→parse→mapToTask
  - `GET /api/orgs/:orgId/dlq` — any member; paginated DLQ listing

- **D-05:** **`orgToken`** = per-org random token stored in `webhook_tokens` table. Generated via UI (`POST /api/orgs/:orgId/webhook-tokens` Owner/Member); separate from agent registration tokens. Single-use is NOT required (webhooks reuse the same URL for every delivery); rotation via revoke+regenerate.

- **D-06:** **Token lookup is cross-org (adminRepo):** server doesn't know the org until the URL is parsed. `adminRepo.findWebhookTokenByPlaintext(token)` returns `{orgId, tokenId}` via sha256 hash lookup (never log the token).

- **D-07:** **Rate limit on hook endpoints** (`@fastify/rate-limit` scoped): 60/min per IP to prevent flood. Legitimate webhook senders well under this.

### GitHub Plugin (PLUG-03)

- **D-08:** **HMAC-SHA256 signature verification:**
  - Header: `X-Hub-Signature-256` (format: `sha256=<hex>`)
  - Compute: `hmac(secret, rawBody).hex()` where `secret` is a per-org GitHub webhook secret (stored in `webhook_tokens.plugin_secret` column, encrypted via Phase 9 org DEK — reuse envelope encryption for symmetry)
  - Compare with `crypto.timingSafeEqual` (Phase 8 ATOK-06 discipline; reuse `compareTokens` helper)
  - Missing / malformed header → verify() returns `{ok: false, reason: 'signature_missing'}`
  - Mismatch → `{ok: false, reason: 'signature_mismatch'}`

- **D-09:** **Events supported:** `push` and `pull_request` (per PLUG-03). Header `X-GitHub-Event` carries the type.
  - `push`: event has `ref` (e.g., `refs/heads/main`), `repository.full_name`, `commits[]`, `pusher.name`, `head_commit.message`.
  - `pull_request`: `action` (opened, synchronize, closed, reopened), `pull_request.head.ref`, `pull_request.base.ref`, `pull_request.number`.
  - Other events (issues, workflow_run, etc.): Phase 12 ignores (parse returns null; DLQ with reason `event_not_supported`).

- **D-10:** **`mapToTask` matching rules** — per-task config shape:
  ```ts
  interface GitHubTriggerConfig {
    plugin: 'github';
    events: Array<'push' | 'pull_request'>;
    repository?: string;  // glob e.g., 'acme/*' or 'acme/infra'
    branch?: string;  // glob e.g., 'main', 'release/*'
    actions?: Array<'opened' | 'synchronize' | 'closed' | 'reopened'>;  // PR only
  }
  ```
  `mapToTask` scans `taskConfigs` filtering for `plugin === 'github'`, event in config.events, repository glob match, branch glob match, action match (PR). Returns all matches (a single event can fire multiple tasks).

- **D-11:** **Param extraction:** GitHub plugin populates `params` with `git.ref`, `git.sha`, `git.repository`, `git.pusher`, `git.message` (for push) or `pr.number`, `pr.action`, `pr.head_ref`, `pr.base_ref`, `pr.title` (for PR). These become `${VAR}` substitutions the task YAML can reference.

### Perforce Plugin (PLUG-04)

- **D-12:** **`xci agent-emit-perforce-trigger <url> <token>` CLI subcommand** (new xci feature — extends Commander in cli.ts):
  - Writes `.sh` (POSIX) and `.bat` (Windows) scripts to the current directory
  - Script uses `curl` (universally available) to POST JSON `{"change": "${P4_CHANGE}", "user": "${P4_USER}", "client": "${P4_CLIENT}", "root": "${P4_ROOT}", "depot": "${P4_DEPOT_PATH}"}` to the configured URL with `Content-Type: application/json` and `X-Xci-Token: <token>` header.
  - NO Node required on the Perforce server (cURL is standard on Linux, PowerShell has Invoke-WebRequest on Windows — emit `.ps1` as secondary option).
  - xci agent is lazy-loaded; this subcommand adds to the CLI entry but does NOT trigger agent mode lazy-load (it's a one-shot emit, not daemon).

- **D-13:** **Verify: token in `X-Xci-Token` header** (not HMAC — Perforce's change-commit trigger doesn't easily do HMAC in shell). Per-org webhook token reused. `timingSafeEqual` compare.

- **D-14:** **Perforce event schema:** `{change, user, client, root, depot}` — plugin parses to typed event.

- **D-15:** **Perforce `mapToTask` config:**
  ```ts
  interface PerforceTriggerConfig {
    plugin: 'perforce';
    depot?: string;  // glob e.g., '//depot/infra/...'
    user?: string;  // glob
    client?: string;  // glob
  }
  ```
  Matches on depot path glob, user, client. Params: `p4.change`, `p4.user`, `p4.client`, `p4.root`, `p4.depot`.

### Task Trigger Config (PLUG-05)

- **D-16:** **Extend `tasks` table** with `trigger_configs jsonb DEFAULT '[]'` column. Array of TriggerConfig (GitHub or Perforce or future). A task can have MULTIPLE trigger configs (e.g., "on push to main OR on PR opened").
- **D-17:** **Explicit config, no naming convention.** No "task name = GitHub repo" magic. User must add the trigger config explicitly via PATCH /tasks/:id (extend Phase 9 endpoint).
- **D-18:** **Schema validation on save:** when tasks are created/updated (Phase 9 routes), validate `trigger_configs` entries against the union type. Invalid → TaskValidationError.

### DLQ (PLUG-06, PLUG-08)

- **D-19:** **`dlq_entries` table** (org-scoped via webhook_token join):
  - `id text PK` (xci_dlq_*)
  - `org_id text FK orgs ON DELETE CASCADE`
  - `plugin_name text NOT NULL` ('github' | 'perforce')
  - `delivery_id text NULLABLE` (X-GitHub-Delivery or Perforce custom ID; null if parse failed before ID extraction)
  - `failure_reason text NOT NULL` (enum: 'signature_invalid', 'parse_failed', 'no_task_matched', 'task_validation_failed', 'internal')
  - `scrubbed_body jsonb NOT NULL` — request body with sensitive headers STRIPPED per PLUG-08
  - `scrubbed_headers jsonb NOT NULL` — headers with Authorization/X-Hub-Signature/X-GitHub-Token/Cookie REMOVED
  - `http_status int NULLABLE` (the status we returned to the sender — 401, 404, 202, etc.)
  - `received_at timestamptz NOT NULL DEFAULT now()`
  - `retried_at timestamptz NULLABLE`
  - `retry_result text NULLABLE` ('succeeded' | 'failed_same_reason' | 'failed_new_reason')
  - `created_at`, `updated_at`
  - Index: `(org_id, received_at DESC)` for listing
  - Index: `(plugin_name, delivery_id) WHERE delivery_id IS NOT NULL` for duplicate detection

- **D-20:** **Retry endpoint (`POST /api/orgs/:orgId/dlq/:dlqId/retry`):** replays the full verify→parse→mapToTask pipeline using the SCRUBBED body. Since sensitive headers (like the signature) are stripped, we can't re-verify the original signature. Two interpretations of PLUG-06:
  - (A) On retry, skip verify (it failed last time — retry forces acceptance)
  - (B) On retry, re-verify using a stored signature hash (requires storing the original signature — but PLUG-08 forbids persisting X-Hub-Signature)
  - **DECISION: (A) — retry skips verify.** Retry is an explicit admin action; the admin is consciously bypassing the signature check. The retry handler logs this clearly and the UI shows "Retry (signature not re-checked)".

- **D-21:** **DLQ list endpoint** (`GET /api/orgs/:orgId/dlq`): paginated, cursor-based, filtered by `plugin_name`, `failure_reason`, `since`.

### Idempotency (PLUG-07)

- **D-22:** **`delivery_id` dedup table** `webhook_deliveries`:
  - `id text PK`
  - `org_id text FK orgs`
  - `plugin_name text NOT NULL`
  - `delivery_id text NOT NULL`
  - `received_at timestamptz NOT NULL DEFAULT now()`
  - Unique index: `(plugin_name, delivery_id)` — INSERT fails = duplicate
  - Retention: 90 days (cleanup daily like log_chunks)

- **D-23:** **On incoming webhook:** BEFORE verify, extract delivery ID from headers. INSERT attempt into webhook_deliveries; if unique violation → return 200 with `{status:'duplicate', deliveryId}` + pino.warn log. Does NOT dispatch a task. Does NOT land in DLQ (it's a legitimate duplicate, not a failure).

- **D-24:** **If plugin can't extract delivery_id:** GitHub always has X-GitHub-Delivery; Perforce script includes a generated UUID. If absent → assume non-idempotent (rare legitimate case) and process normally; log warning.

### Scrubbing (PLUG-08)

- **D-25:** **Header stripping before DLQ insert:** remove `Authorization`, `X-Hub-Signature`, `X-Hub-Signature-256`, `X-GitHub-Token`, `X-Xci-Token`, `Cookie`, `Set-Cookie` (case-insensitive). Keep the rest (useful for debugging).
- **D-26:** **Body pass-through (no body scrub in Phase 12):** GitHub/Perforce webhook bodies don't typically contain secret values at the layer we control. If a task YAML interpolates a secret as a param derived from payload, that's Phase 9/11's redaction concern at dispatch/log time — not Phase 12's.
- **D-27:** **SC-5 test:** exhaustive integration test that inspects persisted dlq_entries and asserts scrubbed_headers does NOT contain any of the stripped header names (case-insensitive grep).

### Webhook Token Management

- **D-28:** **`webhook_tokens` table** (org-scoped):
  - `id text PK` (xci_whk_*)
  - `org_id text FK orgs ON DELETE CASCADE`
  - `plugin_name text NOT NULL` ('github' | 'perforce')
  - `token_hash text NOT NULL` (sha256 hex of plaintext)
  - `plugin_secret_encrypted bytea NULLABLE` (GitHub webhook secret for HMAC verify — encrypted via org DEK reusing Phase 9 crypto helpers; NULL for Perforce)
  - `plugin_secret_iv bytea NULLABLE`
  - `plugin_secret_tag bytea NULLABLE`
  - `created_by_user_id text FK users`
  - `created_at`, `revoked_at NULLABLE`
  - Index: `(token_hash) WHERE revoked_at IS NULL`

- **D-29:** **Routes** (`/api/orgs/:orgId/webhook-tokens`):
  - POST create (Owner/Member + CSRF) — returns plaintext token ONCE + endpoint URL
  - GET list (any member) — metadata only
  - POST /:id/revoke (Owner/Member + CSRF)
  - DELETE /:id (Owner + CSRF) — hard delete

### Dispatch Integration

- **D-30:** **Webhook-triggered runs:** after `mapToTask` returns `{taskId, params}[]`, server creates task_runs with `trigger_source='webhook'`, `triggered_by_user_id=null`, `param_overrides=params`. Uses the same dispatch-resolver as manual runs (Phase 10 D-04).

### New Errors

- **D-31:** `WebhookSignatureInvalidError` (401), `WebhookTokenNotFoundError` (404), `WebhookPluginNotFoundError` (404), `WebhookDuplicateDeliveryError` (200 — not really an error but flows through), `DlqEntryNotFoundError` (404), `DlqRetryFailedError` (500).

### Plugin Interface Unit Tests

- **D-32:** **Contract test harness:** a generic `contractTest(plugin: TriggerPlugin)` factory verifies each plugin:
  - `verify` returns correct shape on valid + invalid inputs
  - `parse` throws on malformed, returns typed event on valid
  - `mapToTask` filters correctly; returns [] when no match
  Both plugins run through the harness.

### Schema Migration

- **D-33:** **Migration `0005_plugins_dlq.sql`** — 3 new tables (webhook_tokens, webhook_deliveries, dlq_entries) + tasks.trigger_configs column extension. [BLOCKING] gate.

### xci CLI — Perforce Trigger Emitter

- **D-34:** **New top-level subcommand** `xci agent-emit-perforce-trigger <url> <token> [--output <dir>]`:
  - Resolved via Commander in cli.ts (NOT via --agent flag; it's a one-shot emit, not agent mode)
  - Writes 3 files: `trigger.sh`, `trigger.bat`, `trigger.ps1` (cross-platform)
  - No Node execution on the Perforce server — scripts use native `curl` / Invoke-WebRequest
  - Usage: Perforce admin adds the script as a change-commit trigger
- **D-35:** **Command lives in xci, not server** — the emission is done once by the user on their laptop; the script is then deployed to the Perforce server.

### Testing Strategy

- **D-36:** **Unit tests:** plugin contract tests (D-32), header scrubbing, delivery dedup, param extraction per plugin, trigger config matching (globs).
- **D-37:** **Integration tests:** full GitHub webhook flow (valid → dispatched run; invalid signature → 401 + DLQ); Perforce flow (valid JSON → dispatched run); duplicate delivery → 200 dup log; DLQ retry happy path; org isolation.
- **D-38:** **Scrub audit test (SC-5):** insert DLQ entry via a failed webhook with Authorization + X-Hub-Signature headers; query dlq_entries; assert these keys absent from scrubbed_headers.

### Claude's Discretion (planner picks)

- Exact glob library or hand-rolled (minimatch / picomatch — recommend picomatch, small and fast; or hand-rolled for just `*` wildcards since patterns are simple)
- DLQ retention (30 days? 90 days? — recommend 90; configurable via env)
- Whether to retry automatically on specific failure reasons (recommend NO — manual only in v2.0)

</decisions>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` §Plugin System (PLUG-01..08)
- `.planning/REQUIREMENTS.md` §Backward Compatibility (BC-01..04)

### Roadmap
- `.planning/ROADMAP.md` §Phase 12 — 5 success criteria

### Prior Phase Context
- `.planning/phases/07-database-schema-auth/07-CONTEXT.md` — forOrg/adminRepo/CSRF patterns
- `.planning/phases/08-agent-registration-websocket-protocol/08-CONTEXT.md` D-11 — timingSafeEqual discipline
- `.planning/phases/09-task-definitions-secrets-management/09-CONTEXT.md` — envelope encryption reused for webhook secrets; `trigger_configs` JSONB extends tasks table
- `.planning/phases/10-dispatch-pipeline-quota-enforcement/10-CONTEXT.md` — trigger_source='webhook' on task_runs; dispatch-resolver used for param resolution

### External Specs
- GitHub Webhooks (https://docs.github.com/en/webhooks) — X-Hub-Signature-256, delivery ID header, event types
- Perforce change-commit trigger (https://www.perforce.com/manuals/cmdref/Content/CmdRef/triggers.html) — script contract
- RFC 2104 HMAC — hmac-sha256 signature computation

</canonical_refs>

<code_context>
## Integration Points
- `packages/server/src/plugins-trigger/` — NEW directory
- `packages/server/src/routes/hooks/` — NEW (github, perforce, shared handler)
- `packages/server/src/routes/dlq/` — NEW (list, retry)
- `packages/server/src/routes/webhook-tokens/` — NEW (CRUD)
- `packages/server/src/db/schema.ts` — extend with webhook_tokens, webhook_deliveries, dlq_entries + tasks.trigger_configs
- `packages/server/src/repos/index.ts` — add new repos
- `packages/server/src/repos/admin.ts` — add findWebhookTokenByPlaintext, cleanupDeliveries
- `packages/xci/src/cli.ts` — add agent-emit-perforce-trigger subcommand
- `packages/xci/src/perforce-emitter.ts` — NEW (script template generation)

</code_context>

<specifics>
- Token-in-URL is safe for webhook routes since the sender is a machine identity, not a user. TLS protects transport; webhook secret (GitHub) provides the real verify layer.
- Explicit trigger_configs (no naming convention) matches the overall xci philosophy: configuration over convention.
- DLQ retry skips signature verify (D-20) — admin action, logged clearly. This is a pragmatic call; the alternative (storing signature) violates PLUG-08.
- `xci agent-emit-perforce-trigger` does NOT require the xci agent daemon on Perforce server — just curl. Node-free constraint honored.
- Scrub list is DENY-LIST style (remove sensitive known headers) + KEEP-REST. Easier to reason about than allow-list (which would lose debugging info).

</specifics>

<deferred>
- GitLab / Bitbucket / Gitea plugins → v2.1
- Slack / Discord / PagerDuty notification plugins → out of scope
- Scheduled (cron) triggers → out of scope
- Custom user-defined plugins (runtime install) → explicitly anti-feature (PLUG-02)
- GitHub App mode (vs webhook mode) → deferred
- Perforce depot-level ACL beyond glob → out of scope
- Auto-retry on transient failures → manual only in v2.0
- Webhook payload signing verification for retry → would require storing signature; violates PLUG-08

### Reviewed Todos (not folded)
None.

</deferred>

---

*Phase: 12-plugin-system-webhooks*
*Context gathered: 2026-04-19*
*Mode: auto-selected*
