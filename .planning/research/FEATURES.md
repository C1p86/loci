# Feature Research — xci v2.0: Remote CI (Agents + Web Dashboard)

**Domain:** Distributed CI platform — agent-based remote task execution with SaaS server and web dashboard
**Researched:** 2026-04-16
**Confidence:** HIGH (core CI system patterns) / MEDIUM (xci-specific design decisions)
**Scope:** NEW features only — v1 CLI features (config loading, execution engine, secrets, init) are pre-existing

---

## Research Notes

All pattern comparisons drawn from: Buildkite v3 (agent/token/concurrency docs), GitHub Actions (self-hosted runner docs), CircleCI (concurrency/orgs), Jenkins (controller/agent model), Drone CI (secrets/logs), Concourse CI (resource types/triggers). Complexity ratings: 1=trivial, 2=moderate, 3=substantial, 4=large phase on its own.

---

## Category 1: Agent Lifecycle

Registration, health/heartbeat, online/offline state, version mismatch, graceful shutdown, reconnection, deregistration.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| One-command registration (`xci --agent <url> --token <T>`) | Every CI system registers in a single command. GHA: `./config.sh --url <url> --token <token>`. Buildkite: `buildkite-agent start --token <tok>`. Users expect zero-friction first run. | 2 | Handshake: agent sends token + hostname + labels → server returns session token. TOFU: first registration stores public identity; subsequent reconnects verify it. |
| Heartbeat / keepalive | Server must know if an agent dies silently. Buildkite marks agent "lost" after 3 missed heartbeats (3-minute window). GHA marks offline after ~1 minute. | 2 | Heartbeat over the same WebSocket (ping frames or explicit app-level message every 30s). If WS is already live, heartbeat is implicit. |
| Online / offline status visible in UI | Users want to see at a glance which agents are reachable before dispatching a task. | 1 | Three states minimum: `online`, `offline`, `draining` (no new work, finishing current). |
| Automatic reconnect with backoff | Network hiccups are inevitable. Buildkite agent retries with exponential backoff. GHA runner also retries. Without reconnect, a VM reboot kills the agent permanently. | 2 | Exponential backoff with jitter (starting at 2s, cap at ~5min). Max retry window configurable. Agent must NOT re-register on reconnect — resume existing identity. |
| Graceful shutdown (`SIGTERM` → finish current task, then exit) | Buildkite: `stop-agent-gracefully` sends SIGTERM then blocks. Users deploying to VMs with systemd expect `systemctl stop xci-agent` to work cleanly. | 2 | SIGTERM: agent stops accepting new tasks, finishes in-flight, sends `deregister` to server, exits 0. SIGKILL: abrupt — server marks agent lost after next missed heartbeat. |
| Deregistration (deliberate removal from UI) | Users need to clean up agents that no longer exist (decomm'd VM, CI config change). | 1 | REST endpoint: `DELETE /api/agents/:id`. Revokes session token, removes from dispatch pool. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Agent drain mode (stop dispatching, finish current) | Buildkite supports explicit drain so upgrades don't kill in-flight jobs. Useful for zero-downtime agent upgrades. | 2 | UI toggle: "Drain agent". Server stops dispatching to it; shows status as `draining`. When job count hits 0, agent auto-exits or returns to normal. |
| Version mismatch warning (not hard block) | Buildkite shows a warning if agent binary is far behind server protocol version. A hard block breaks existing installs silently. | 2 | Protocol has a `min_client_version` field. Server logs a warning for mismatched agents but still dispatches unless version is below `min_supported`. |
| Agent labels auto-detected (OS, arch) | Buildkite agents auto-report `os`, `arch`, `hostname` at registration. Reduces manual configuration. | 2 | At registration, agent sends `{ os: process.platform, arch: process.arch, hostname: os.hostname() }` + user-defined labels from local config. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Auto-update of agent binary | Sounds convenient — agent updates itself like a service daemon | Creates untested agent versions in production; a bad release silently breaks all agents simultaneously; requires agent to have write access to its own binary (security risk on shared machines). Buildkite explicitly does NOT do this. | Pin version in CI scripts; document update procedure; display badge in UI when agent is outdated. |
| Agent pools with auto-scaling via server API | Admins want the server to spin up more cloud VMs automatically | This is a platform-level concern (AWS, GKE autoscaler). Implementing it in v2.0 requires cloud provider integrations that each take weeks to do correctly. CircleCI cloud-runner autoscaling is a major separate feature. | Document Kubernetes CronJob / AWS ASG patterns for scaling; implement in v2.1. |
| Agent as a persistent background service installed by `xci agent install` | Nice DX but creates OS-specific service management (systemd, launchd, Windows SCM) | Three very different code paths; debugging is hard; installer scope-creep. GHA provides this but it's a significant chunk of their codebase. | Document a systemd unit file snippet in README; user owns their own service config. |

**Reconnection / network-partition behavior (explicit):**
- Agent MUST maintain a local state flag: "currently executing task: yes/no".
- On reconnect after partition: agent sends `{ agentId, sessionToken, currentTask: <id or null> }`.
- Server reconciles: if task was marked failed during partition, server sends `task_cancelled` — agent cleans up and marks it abandoned.
- If server has no record of the task (server restart), agent logs warning and emits orphan-task result locally.
- Never silently retry a completed task on reconnect — idempotency is the caller's problem.

**Dependency:** Agent lifecycle depends on Agent Auth (token issuance). Labels depend on Label-based Dispatch.

---

## Category 2: Task Dispatch

Queueing, label/tag matching, priority, concurrency control, cancellation, timeouts, retry policy.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Label-based dispatch (agent must match all required labels) | Buildkite uses agent tags: `queue=deploy`, `os=linux`. GHA uses `runs-on: [self-hosted, linux]`. Users with heterogeneous agents (Windows builder, Linux tester) must be able to route tasks correctly. | 3 | Labels: key=value pairs. Task spec: `requires: { os: linux, arch: x64 }`. Server filters `online` agents whose label set is a superset of requirements, then picks one (e.g. least-recently-used). |
| Task queuing when no matching agent is available | Tasks should not be silently dropped — they wait for an eligible agent. GHA queues indefinitely; Buildkite queues until job timeout. | 2 | Queue is a DB table (`task_runs`) with `status=queued`. Dispatcher polls or is triggered when agent connects. |
| Per-task timeout (max execution time) | Without timeout, a hung task locks an agent forever. Buildkite default: no timeout (bad); GHA default: 6 hours. Both let you set `timeout-minutes`. | 2 | Config field `timeout_seconds` on task. Server tracks `started_at`; cron or event-driven check kills after timeout, sets `status=timed_out`, sends cancellation WS message to agent. |
| Task cancellation from UI | User triggered a wrong build, wants to stop it. Buildkite, GHA, CircleCI all have a cancel button. | 2 | Server sends `{ type: 'task_cancel', taskRunId }` over WS. Agent sends SIGTERM to execa subprocess, waits grace period (10s), then SIGKILL. Reports `status=cancelled`. |
| Queued task visible in UI (pending state) | Users want to see tasks waiting for an agent, not just running ones. | 1 | `task_runs` table state machine: `queued → assigned → running → {succeeded, failed, cancelled, timed_out}`. All states visible in UI. |
| Exit code propagation from agent to server | Same behavior as v1 CLI — exit code of the command IS the result. Buildkite and GHA both do this. | 1 | Agent reports `{ exitCode: N }` in final task result message. Server maps `exitCode == 0` → `succeeded`, else `failed`. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Per-org concurrency limit (max N simultaneous tasks across all agents) | Prevents one org from dominating shared infrastructure. CircleCI enforces this at plan level. Useful for the billing stub. | 2 | Quota entity: `org.maxConcurrentTasks`. Dispatcher checks count of `running` tasks for org before assigning. Over limit → stays queued. |
| Per-agent concurrency (spawn N) | Buildkite supports `--spawn 5` to run multiple jobs per agent process. Useful for lightweight tasks on powerful machines. | 2 | Agent config: `spawn: N` (default 1). Agent tracks N concurrent execa processes. Server dispatches N tasks to the same agent if labels match. |
| Retry policy on failure | CircleCI: `no_output_timeout`; Buildkite: manual retry from UI. Auto-retry with configurable max attempts is a common request. | 2 | Task spec: `retry: { maxAttempts: 3, on: [failed, timed_out] }`. Each retry is a new `task_run` linked to the original. Retry count visible in UI. |
| Queue depth metric in UI | Operators want to know if the queue is growing (need more agents). Buildkite shows queue metrics. | 1 | API endpoint: `GET /api/orgs/:id/queue-depth` returns count of `queued` tasks by label set. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Global task priority (integer priority field) | Teams want deploys to jump ahead of lint tasks | Priority queues require fair-scheduling algorithms. Getting it wrong causes starvation (low-priority tasks never run). Jenkins priority plugin is notoriously buggy. | Use separate label pools: `queue=fast` for deploys, `queue=default` for everything else. Simple and auditable. |
| Automatic retry on ALL failures | Save engineers from pressing "retry" | Silent retries for non-idempotent tasks (deploys, DB migrations) cause data corruption. Buildkite explicitly warns against auto-retry on deploys. | Opt-in retry per task with `retry.on: [failed]` only. Never retry by default. |
| Speculative execution (run on multiple agents, take first result) | Reduces tail latency | Doubles resource consumption; creates race conditions on shared state (DBs, file systems); hard to explain to users why a task ran twice. | Not for v2.0. |

**Dependency:** Dispatch depends on Agent Lifecycle (agents must be registered). Concurrency limit depends on Billing/Quota entities. Retry depends on task state machine being solid first.

---

## Category 3: Log Streaming

Realtime delivery, autoscroll, search, export, retention, size limits, sensitive data redaction.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Realtime log streaming to browser | The fundamental CI UX: you watch the build output appear live. Buildkite, GHA, CircleCI all do this. Absence makes the tool feel prehistoric. | 3 | Agent → server via WS (`{ type: 'log_chunk', taskRunId, seq, text }`). Server stores chunks. Server → browser via WS or SSE push. Browser appends to DOM. |
| Autoscroll with user-override | Default: scroll to bottom as new lines arrive. Click anywhere → stop autoscroll. Scroll to bottom → resume. Buildkite and CircleCI both have this behavior. | 2 | React state: `userScrolled = false`. `onScroll` handler: if not at bottom, set `userScrolled = true`. New chunk arrives: if not `userScrolled`, scroll. |
| Log persistence and replay (view after build completes) | Users review logs after the fact: debugging, audit, reporting. All CI tools persist logs. | 2 | Store log chunks in DB (or append to file per task run). On page load, stream all stored chunks then switch to live. |
| Log retention window (configurable per org, bounded by plan) | Long-lived log storage is expensive. Buildkite: 90 days on free, configurable on paid. CircleCI: 30 days. Users expect some retention. | 2 | `org.logRetentionDays` (default: 30 for free). Cron job deletes `log_chunks` older than retention window. UI shows retention policy in settings. |
| Sensitive data redaction (secrets never appear in logs) | This is a v1 feature for local execution. In remote mode, secrets travel over WS and are stored server-side — redaction is even more critical. GitHub Actions, Buildkite, CircleCI all mask registered secrets in logs. | 3 | Server maintains list of org secrets (plaintext values after decryption). Log chunks are scanned through a redaction filter before storage: replace matches with `[REDACTED]`. Masking hides display AND storage. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Log size limit per task run (hard cap) | Prevents runaway verbose tasks from filling the DB. Buildkite has per-job limits. | 2 | Hard cap: e.g. 10MB per task run. After cap: agent still executes, but log chunks beyond limit are discarded (with a "Log truncated" sentinel line stored). |
| Log line timestamps | Debugging slow builds requires knowing when each line was emitted. Buildkite, GHA both timestamp each line. | 1 | Each `log_chunk` carries `timestamp` (Unix ms). UI displays relative time (e.g. `+00:03.145`) per line. |
| Raw log download (plain text export) | Engineers pipe logs to grep, share with colleagues, store in incident reports. | 1 | `GET /api/task-runs/:id/logs?format=text` streams concatenated lines. No search or filtering — just the raw text. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full-text search across all logs (global search) | Teams want to find which build printed a specific error message | Full-text search on log data at scale requires Elasticsearch or pg_trgm indexes on a potentially very large table. Gets expensive fast. Buildkite only added this in Enterprise tier. | Offer per-run log search in the browser (client-side `Ctrl+F` analog in the log viewer). Global log search is a v2.1 concern. |
| Log folding / collapsible sections (like GHA `::group::`) | Makes long logs readable | Requires a log format protocol change (server must understand `::group::` markers). Adds parsing complexity server-side and rendering complexity client-side. | Plain text logs for v2.0. Document a `# --- Section Name ---` convention for visual separation in raw output. |
| ANSI color rendering in browser | Logs look better with color | Non-trivial: requires an ANSI-to-HTML parser (e.g. `ansi-to-html` npm package) run either server-side (storage bloat) or client-side (rendering cost). Risk of XSS if not sanitized. | Strip ANSI codes before storage (v2.0). Add rendering in v2.1 with proper sanitization (DOMPurify). |

**Dependency:** Log streaming depends on agent lifecycle (WS connection). Redaction depends on secrets management (server must know secret values to mask them). Retention depends on billing/quota entities (plan defines retention window).

---

## Category 4: Auth & Org Model

Signup, email verification, password reset, 2FA posture, SSO readiness, roles, invitations, org deletion.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Email + password signup / login | Every SaaS has this. Without it there is no product. | 2 | bcrypt password hashing. Fastify session or JWT (short-lived access + refresh token). CSRF protection on all mutating endpoints. |
| Email verification on signup | Prevents spam accounts, required for password reset to work safely. CircleCI, Buildkite all require it. | 2 | On signup, send verification link (JWT-signed, 24h TTL). Unverified accounts can log in but cannot create orgs or dispatch tasks (or show a persistent banner). |
| Password reset via email | Users forget passwords. Absence is a support liability. | 2 | "Forgot password" flow: send reset link (JWT-signed, 1h TTL). One-time use (invalidated after use). |
| Org isolation (all data scoped to org) | Multi-tenant fundamental: org A cannot see org B's agents, tasks, logs, secrets. Buildkite, CircleCI both use org as the tenancy boundary. | 3 | Every DB entity has `orgId`. Row-level security or query-level filter. Middleware validates that the authenticated user belongs to the org in the URL. |
| Role-based access: owner, admin, member | Minimum roles for a team product. Buildkite: admin controls agents/tokens. CircleCI: org admins manage settings. Without roles, every member can delete everything. | 2 | Three roles: `owner` (can delete org, manage billing), `admin` (manage agents, secrets, members), `member` (trigger tasks, view logs). `viewer` is a differentiator. |
| Org invitation by email | Teams need to add colleagues without them self-signing-up with the right org. | 2 | Invite creates a signed JWT link (72h TTL). Recipient signs up (or logs in) and is added to the org with specified role. Invites list in settings UI with revoke option. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `viewer` role (read-only: see logs, agent status, no trigger) | Stakeholders, PMs want visibility without the ability to accidentally trigger deploys. | 1 | Middleware check on mutating endpoints: `member` or above required. `viewer` can only GET. |
| SSO-ready architecture (OIDC hook in auth flow) | Enterprises will ask for SSO before paying. Building the auth layer without OIDC support means a painful retrofit later. WorkOS pattern: org has `ssoProvider` and `domain`; if set, redirect to IdP. | 3 | v2.0: don't implement SSO, but design the `User` and `OrgMembership` tables to support an `externalIdentityProvider` column. Document the OIDC integration point. |
| Personal access tokens (PAT) for API/CLI automation | Engineers scripting against the API need a long-lived token scoped to their user, not a session cookie. GitHub's personal token model. | 2 | `user_tokens` table: created by user, shown once (store hash only), revocable, scoped to org. Used in `Authorization: Bearer <pat>` header. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| 2FA enforcement in v2.0 | Security-conscious users want 2FA mandatory | TOTP implementation + backup codes + recovery flow is ~2 weeks of work. Getting it wrong locks users out. Buildkite ships this in a mature, well-tested form that took years. | Design auth so 2FA can be added (don't store raw passwords; use proper password module with bcrypt). Document that 2FA is roadmapped for v2.1. |
| GitHub / Google OAuth as primary auth | Lowers signup friction | Creates hard dependency on third-party OAuth. If GitHub is down, users can't log in. More importantly: it ties org membership to VCS account, which is not appropriate for all xci use cases (Perforce users, non-GitHub teams). | Email/password for v2.0. Add OAuth as an additional login method (not replacement) in v2.1. |
| Org deletion with immediate data purge | Owners want a "delete everything" button | If done synchronously, a large org can timeout the request. If bugs in deletion cascade, data leaks across orgs. | Soft-delete org (mark `deletedAt`), schedule async data purge job. Show confirmation with "your data will be purged in 24h". |

**Dependency:** Org model is the foundation — every other category (agents, tasks, secrets, billing) requires `orgId` to exist. Role checks depend on org membership table.

---

## Category 5: Agent Auth

Token issuance model, token scope, revocation UI, suspected-compromise workflow.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-agent token issued once at registration (TOFU model) | Buildkite: cluster-level token used for registration; server returns a per-agent session token. GHA: registration token expires in 1 hour, config.sh exchanges it for credentials stored on disk. Users expect a secure but simple enrollment flow. | 3 | TOFU flow: user generates a registration token in UI (org-scoped, one-time or reusable for a pool). Agent uses it to `POST /api/agents/register` with hostname + labels. Server returns a long-lived `agentSecret` (shown once, stored as bcrypt hash). Agent stores it in `.xci/agent.yml` (chmod 600, in .gitignore). |
| Token revocation from UI (per-agent) | If an agent machine is decommissioned or compromised, the token must be killed immediately. Buildkite: per-token revoke via GraphQL. | 1 | `DELETE /api/agents/:id/token` invalidates the stored hash. Agent's next heartbeat or reconnect fails auth → agent process logs error and exits. |
| Visible token fingerprint (not full value) | Users need to identify which token is which without exposing the secret. GitHub shows last 4 chars. | 1 | Store SHA256 of token. Show first 8 chars of hex as `fingerprint`. Display in UI as `xci_...a3f2`. |
| Agent token scope limited to one org | A compromised agent cannot access other orgs' tasks. | 1 | `agentTokens` table has `orgId`. Dispatch and WS upgrade handler validates `token.orgId == requestedOrg`. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Registration token (short-lived, for enrollment only) separate from agent credential | The registration token is used once and can be safely checked into CI scripts. The long-lived agent credential never leaves the server except during that single exchange. GHA uses this pattern. | 2 | `registrationTokens` table: `orgId`, `expiresAt` (1h), `usedAt` (single-use or multi-use for pools). Separate from `agentCredentials`. |
| Rotate agent credential without deregistering | Token rotation that doesn't require deleting and re-adding the agent preserves agent history (past runs, labels). | 2 | `POST /api/agents/:id/token/rotate` issues new credential, invalidates old one within a grace window (30s) to allow the agent to pick up the new value. |
| Suspected-compromise workflow | If an agent is flagged, one-click: revoke token + cancel all in-flight tasks from that agent + notify org owner via email. | 2 | `POST /api/agents/:id/quarantine`: sets `status=quarantined`, revokes token, cancels running task_runs, sends email. Quarantined agents appear with red badge in UI. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Org-wide shared agent token (all agents use one token) | Simpler setup, only one secret to manage | One leaked token = all agents revoked simultaneously or all agents potentially compromised. Buildkite supports org-level tokens but recommends cluster tokens for isolation. | Per-agent tokens as default. Optionally allow a pool registration token (for auto-scaling pools) that is distinct from the per-agent credential. |
| Agent token embedded in agent binary / installer | DX improvement — download a pre-configured binary | Embedding a secret into a downloadable binary leaks the secret to anyone who downloads it (public S3 presigned URLs, build artifacts). | Keep token as a CLI argument or env var (`XCI_AGENT_TOKEN`). Document systemd `EnvironmentFile` pattern for secure storage. |
| IP allowlist as sole auth mechanism | Simpler for known static infrastructure | Dynamic cloud instances, VPNs, and IPv6 make IP allowlisting brittle. Jenkins suffered real compromises when IP lists were managed manually. | Token auth as the primary mechanism. IP allowlist as an additional optional layer (v2.1). |

**Dependency:** Agent auth depends on org model (tokens scoped to org). Quarantine workflow depends on log streaming (must cancel in-flight tasks) and email (user notification).

---

## Category 6: Secrets Management

Secret scopes, masking in logs, expiration, read/edit access, audit trail, per-agent override semantics.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Org-level secrets (key-value, encrypted at rest) | Teams share secrets (deploy keys, API tokens) across tasks. Buildkite, CircleCI, Drone all have org/project-level secrets. Without this, teams put secrets in YAML files (wrong). | 3 | Envelope encryption: generate a data-encryption key (DEK) per org, encrypt DEK with a master key (server-level key from env var or KMS in future). Store encrypted DEK + encrypted secret values in DB. Decrypt on task dispatch only. |
| Secrets injected as environment variables at task runtime | Standard CI pattern: Buildkite, GHA, CircleCI all inject secrets as `env` vars. Tasks access them via `process.env`. | 2 | Server decrypts org secrets, sends them to agent in `task_start` WS message as `{ env: { KEY: value } }`. Agent passes them to execa via `env` option. Never logged. |
| Secrets masked in log output (server-side, before storage) | Secrets appear in logs if a command accidentally echoes them. GHA uses `::add-mask::`. CircleCI and Buildkite both mask registered secrets. | 3 | After decryption at dispatch time, server maintains an in-memory set of secret values for the task run. Log chunks pass through a redactor that replaces exact matches with `[REDACTED]`. Also mask base64-encoded variants (common in Docker config patterns). |
| Per-agent local secrets override (v1 `.xci/secrets.yml`) | This is the v1 hybrid model. Agent-local secrets win over org-level secrets for the same key. Useful for per-machine overrides (different API endpoint per deploy target). | 2 | Agent merges local `.xci/secrets.yml` over server-provided env. Local secrets are never sent to server (same guarantee as v1). Server-side masker only knows about org secrets; local secrets are the agent's responsibility not to log. |
| `admin`-only secret write access | Anyone being able to update a deploy key is a liability. Buildkite restricts secret management to org admins. | 1 | Role check: `admin` or `owner` to create/update/delete secrets. `member` can see secret names but not values. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Secret access audit trail | Who changed a secret, when? Critical for compliance (SOC 2 Type II). Infisical, Doppler both provide this. | 2 | `secret_audit_events` table: `secretId`, `actorUserId`, `action` (created/updated/deleted/viewed), `timestamp`. No secret values ever stored in audit log. |
| Secret expiration (TTL with UI warning) | Rotating secrets is a security best practice. Expired secrets surface prominently so they don't silently fail. | 2 | `secrets.expiresAt` nullable field. Cron job: flag secrets expiring within 7 days. UI: yellow badge on expiring secrets, red on expired. Expired secrets are still injected (don't break builds silently) but show a UI warning. |
| Task-scoped secrets (a secret only injectable into specific tasks) | Reduce blast radius: a secret for `deploy-production` shouldn't be available to `run-tests`. | 3 | `secret_task_bindings` table linking secrets to task definitions. Dispatcher only injects secrets whose `taskIds` include the current task (or `taskIds = null` meaning org-wide). Defer to v2.1 unless the use case is clear. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Secret values visible to admins in UI | Admins need to "check" a secret value | Once secrets are visible in UI, they appear in browser history, screenshots, screen shares, log files. Doppler shows values but with an explicit click-to-reveal + audit event. This surface area is much harder to secure. | Never show secret values in UI. Provide a "test" endpoint that injects a secret into a dummy task run and shows pass/fail without revealing the value. If admins truly need to see it, require 2FA confirmation (v2.1). |
| Automatic secret rotation (server calls external API to rotate) | Fully automated rotation sounds great | Requires integrating with each secret provider (AWS IAM, GitHub App, database password rotation). Each integration takes significant work and breaks in subtle ways. Buildkite doesn't do this; neither does CircleCI. | Expose a `POST /api/secrets/:id` update endpoint with a webhook you can call from your rotation script. The tool updates the stored value; rotation logic stays external. |
| Secret versioning (history of previous values) | Rollback to old secret if something breaks | Storing previous secret values multiplies the attack surface. If the DB is breached, all previous secrets are exposed. | Store only current value. On rotation, the previous value is permanently overwritten. Document "if you need rollback, keep the previous value in your password manager". |

**Dependency:** Secrets management depends on org model. Log masking depends on log streaming. Per-agent override depends on v1 config loading (pre-existing).

---

## Category 7: Trigger Plugins

Plugin manifest, installation/config, signature verification, event normalization, retry, dead-letter.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Stable plugin interface: `verify → parse → map-to-task` | Without a stable interface, each trigger is bespoke code in the server. Concourse uses a similar three-method contract (`check`, `in`, `out`) per resource type. The interface allows plugins to be developed independently and tested in isolation. | 3 | Plugin interface (TypeScript): `interface TriggerPlugin { name: string; verify(req: RawRequest): boolean; parse(req: RawRequest): ParsedEvent; mapToTask(event: ParsedEvent, cfg: PluginConfig): TaskDispatchRequest }`. Plugins are loaded at server startup from a plugins directory. |
| HMAC signature verification (GitHub webhook) | GitHub sends `X-Hub-Signature-256: sha256=<hex>`. Without verification, anyone can trigger your builds. Buildkite's HMAC implementation was added specifically because of this attack vector. | 2 | `verify()` computes `HMAC-SHA256(secret, rawBody)` and compares to header value using constant-time comparison (`timingSafeEqual`). Reject with 401 if mismatch. Reject if timestamp in payload is >5 minutes old (replay prevention). |
| Event normalization to `{ taskName, params, triggeredBy }` | Each plugin speaks its own event format. The dispatch engine must work from a normalized form. | 2 | `mapToTask()` returns `{ taskName: string, params: Record<string,string>, triggeredBy: { plugin, eventId } }`. Server validates `taskName` exists in org config before dispatch. |
| Plugin configuration stored per org (not hardcoded) | GitHub webhook secret and Perforce server URL vary per org. | 2 | `plugin_configs` table: `orgId`, `pluginName`, `configJson` (encrypted like secrets). Admin configures via Settings UI. |
| Incoming webhook endpoint per org | GHA has org-level webhook delivery. Buildkite has pipeline-specific webhooks. xci needs at minimum `POST /webhooks/:orgId/:pluginName`. | 1 | Route: `POST /api/webhooks/:orgId/:plugin`. Loads plugin by name, calls `verify()` then `parse()` then `mapToTask()`, enqueues task run. Returns `202 Accepted` immediately. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dead-letter queue for failed trigger events | If a webhook arrives but no matching task exists (config mismatch), don't silently drop it. Store it for inspection. | 2 | `webhook_events` table: raw payload, plugin, status (`processed`, `failed`, `dead_letter`), error message. UI shows recent webhook events with status. Admin can retry a dead-letter event manually. |
| Perforce trigger script generator | xci generates a `xci-trigger.py` (or shell script) that Perforce admins paste into `p4 triggers`. This is a significant DX differentiator vs "write your own trigger". | 3 | `GET /api/orgs/:id/plugins/perforce/trigger-script` generates a script that POSTs to the org's webhook URL with HMAC signature. Includes install instructions. |
| Scheduled trigger (cron expression per task) | Many CI tasks run on a schedule (nightly builds, daily reports). GHA has `on: schedule`. Buildkite has scheduled builds. | 3 | `scheduled_triggers` table: `orgId`, `taskName`, `cron` (e.g. `0 2 * * *`), `timezone`. Server-side cron runner (node-cron or pg_cron) evaluates expressions and enqueues task runs. Not strictly a "plugin" but same dispatch path. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Dynamic plugin installation from npm at runtime | Admins want to install new trigger types without redeploying | npm install at runtime means untrusted code runs in the server process. Security nightmare. Also breaks reproducibility (server restarts pick up different plugin versions). Plugin installs could block the event loop. | Plugins are bundled at build time. Adding a new plugin type = update `@xci/server` package. This is acceptable for v2.0 with only 2 trigger types. |
| Trigger fan-out (one event triggers N tasks simultaneously) | A push to main could trigger lint + test + deploy in parallel | Fan-out amplification: a single malformed webhook triggers N concurrent tasks, potentially saturating agents. Without proper quotas, this is a DoS vector. | A webhook triggers exactly one named task. That task can internally compose (sequential/parallel) using the v1 execution engine. Keep dispatch 1:1. |
| GitHub App (vs webhook) for tighter integration | GitHub App gets repo-level permissions, checks API, status badges | GitHub App requires OAuth App registration, callback URL, private key management, and the Checks API. This is ~3 weeks of work. CircleCI's GitHub App integration took significant engineering time. | Webhook (with HMAC) for v2.0. Document GitHub App migration path for v2.1. |

**Dependency:** Trigger plugins depend on task dispatch (plugins produce task dispatch requests). Scheduled trigger depends on task definitions. Dead-letter queue depends on webhook_events table and basic UI.

---

## Category 8: Pipeline / Task Definitions

YAML schema, variable/placeholder resolution, composition, artifacts between steps, matrix runs.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Same YAML DSL as v1 CLI (alias, single/sequential/parallel, `${NAME}` placeholders) | Backward compatibility is non-negotiable. v1 users expect their existing `.xci/config.yml` to work server-side. v1 DSL already covers the core execution model. | 2 | Server stores task definitions as YAML strings. On dispatch, server parses YAML using same `yaml` (eemeli) library as CLI, resolves placeholders from merged config (org-level params + dispatch-time params), hands structured command to agent. |
| Task definition YAML editor in web UI | Users need to create/edit tasks without access to the filesystem. Buildkite has a pipeline editor; GHA has a `workflow_dispatch` UI. | 2 | Monaco editor (VS Code-based) with YAML syntax highlighting. `Save` → `PUT /api/orgs/:id/tasks/:taskName`. Validation: parse YAML server-side, return errors with line numbers before saving. |
| Placeholder resolution at dispatch time (server-side) | Params vary per trigger event (branch name, commit SHA). Server must resolve `${BRANCH}` from dispatch request before sending to agent. | 2 | Merge order: org-level params → task defaults → dispatch-time params (from trigger plugin or manual trigger UI). Fail-fast if any `${NAME}` unresolved (same semantics as v1). |
| Task listing and versioning (current + past definitions) | What was the task definition when run #42 was triggered? Buildkite stores pipeline snapshots at build time. | 2 | Store task definition YAML snapshot in `task_runs.definitionSnapshot` at dispatch time. View historical definition from the task run detail page. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Task composition (alias referencing other tasks) | v1 already supports alias composition. Extending this to server-side task definitions enables shared "library" tasks (e.g. a shared `checkout` step). | 2 | Same resolution logic as v1 (pre-existing code). Server-side: tasks can reference other tasks in the same org's task registry. Circular reference detection required. |
| Manual trigger with param override UI | Users want to trigger a task with non-default params (e.g. deploy a specific branch). GHA `workflow_dispatch` with `inputs`. Buildkite "New Build" with env var overrides. | 2 | "Run Task" modal in UI: shows `${NAME}` placeholders with current default values as editable fields. Submit → dispatch with overridden params. |
| Import task definition from local `.xci/config.yml` | Teams already have v1 task definitions. Importing them avoids re-typing. | 1 | `POST /api/orgs/:id/tasks/import` accepts a YAML file upload or paste. Server parses it, extracts alias definitions, creates task records. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Matrix runs (run same task across N variable combinations) | Very popular: run tests across Node 18/20/22, or deploy to staging/prod. GHA `strategy.matrix`, Buildkite build matrix. | Complexity explosion: N tasks × M variables = N×M runs. With retry enabled, could be 2×N×M runs. State management, UI display, and quota enforcement all become significantly harder. Real risk of agent saturation. | Defer matrix to v2.1. For v2.0, document a workaround: create separate named tasks (`test-node18`, `test-node20`). |
| Artifact passing between steps via server storage | GHA `actions/upload-artifact` / `download-artifact`. Useful for build → test → deploy chains where one step produces a binary. | Requires a file storage layer (S3 or local volume), artifact metadata table, upload/download URLs, retention enforcement. This is a substantial feature on its own. Buildkite notes artifacts as a first-class concept requiring separate storage infrastructure. | For v2.0: agents run on the same machine, so artifacts are naturally on disk (same as v1). Cross-machine artifact passing is explicitly v2.1 scope. |
| Task templates / inheritance | Teams want a base task that other tasks extend | Template resolution adds another layer of indirection during dispatch. Debugging "where did this param come from?" becomes hard. Jenkins Job DSL template inheritance is notoriously difficult to debug. | Use alias composition (task A calls task B) for reuse. Explicit is better than inherited. |

**Dependency:** Task definitions depend on org model (org owns tasks). Placeholder resolution depends on secrets management (secrets are params). Server-side definitions are required by task dispatch and trigger plugins.

---

## Category 9: Billing / Quota Entities

Free plan shape, over-quota behavior, hidden counters vs visible UI, audit log.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Org plan entity (Free / future paid tiers) | Billing stub requires a plan concept so quotas can be enforced and the upgrade path is clear. Buildkite free tier: 3 agents, 90-day retention. CircleCI free: 30 concurrent jobs. | 2 | `plans` table (static, seeded): `{ name: 'free', maxAgents: 3, maxConcurrentTasks: 5, logRetentionDays: 30, maxLogBytesPerRun: 10_485_760 }`. Org has `planId`. On v2.0 launch, all orgs are on Free. |
| Quota enforcement: max connected agents | Over-quota behavior must be deterministic. Buildkite: over-limit agents can connect but don't receive jobs. | 1 | On agent register: count connected agents for org. If count >= plan.maxAgents: return `403 { error: 'agent_quota_exceeded' }`. Agent logs clear message and exits. |
| Quota enforcement: max concurrent tasks | Same as agent quota but for dispatch. | 1 | Dispatcher: before assigning task, count `running` task_runs for org. If count >= plan.maxConcurrentTasks: leave task in `queued` state. Do not reject — it will be dispatched when a slot opens. |
| Quota visibility in settings UI | Users need to see their current usage vs limits. GitHub shows "X of Y minutes used". CircleCI shows concurrent job count. Without this, users don't know why tasks are queued. | 2 | Settings → Plan page: shows current values vs plan limits: agents connected (N / maxAgents), tasks running today (N / maxConcurrentTasks), log retention (30 days), storage used. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Quota warnings before hitting the limit | Show "You're at 80% of agent quota" before the user hits the wall. Better UX than a hard error. | 1 | Banner in agent list when `connectedAgents >= 0.8 * maxAgents`. |
| Audit log for quota events | Who triggered the over-quota condition? Useful for debugging and future compliance. | 1 | Log to `audit_events` table: `{ orgId, event: 'quota_exceeded', resource: 'agent', actorAgentId, timestamp }`. No UI for v2.0 — just the DB record. |
| Usage counters visible (tasks run today, total log bytes stored) | Transparency builds trust. Users understand what they're consuming before they hit limits. | 2 | `org_usage_stats` materialized view or periodic aggregation job. Refreshed every 5 minutes. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Hard block on task dispatch when over retention quota | Prevent future data from accumulating past limit | Silently blocking task dispatch because of a background storage concern (log bytes) is confusing and alarming. Users expect task dispatch failures to be about agent availability, not billing. | When over retention limit: accept new tasks, but start dropping oldest log chunks beyond the limit. Silently degrade logging rather than block execution. Show a warning in UI. |
| Usage-based billing counter visible in real-time | Users want to track costs | Real-time billing counter requires a metrics pipeline (counters, aggregations). v2.0 has no Stripe; building the counter without the payment system creates a misleading UI. | Static plan limits only. Stripe + usage metering is v2.1. |
| Overage charges (auto-upgrade plan when quota exceeded) | SaaS revenue model | Without Stripe integration, there is no payment method to charge. Silently upgrading a plan and showing an invoice later is a legal/trust liability. | Hard quota on Free. Clear "Upgrade plan" CTA button (leads to contact form for now). |

**Dependency:** Billing/quota depends on org model. Quota enforcement depends on agent lifecycle (connected agent count) and task dispatch (running task count). Log retention enforcement depends on log streaming.

---

## Category 10: Dashboard UX

Status indicators, live updates, empty states, error surfacing, keyboard navigation.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Agent list with online/offline/draining status | The first thing an operator checks: "are my agents running?" Buildkite, Drone, Concourse all have this as the landing page. | 2 | React component: `AgentList`. Each agent card shows: hostname, status indicator (green/grey/yellow dot), labels, last seen timestamp, current task or "idle". Updates via WS push. |
| Task run list with status (queued/running/succeeded/failed) | The second thing: "what's running?" Status is color-coded (green/grey/blue/red). | 2 | `TaskRunList` component. Live updates via WS. Click → detail page with log viewer. |
| Live log viewer with autoscroll + history | Core CI UX (see Category 3). React component using WS for live chunks. | 3 | `LogViewer` component: virtualized list (react-window or similar) for performance with large logs. Autoscroll toggle. "Scroll to top" / "Scroll to bottom" buttons. |
| Empty states with actionable guidance | First-time user lands on agent list and sees nothing. Without guidance, they leave. Buildkite's empty state says "Start your first agent" with a command snippet. | 1 | Empty states for: no agents ("Run `xci --agent <url> --token <T>` to connect your first agent"), no tasks ("Create a task to get started"), no runs ("No task runs yet"). Each has a primary CTA. |
| Error surfacing (toast notifications for API errors) | When a task fails or an agent disconnects, the user should know immediately, not on refresh. | 1 | WS events: `agent_disconnected`, `task_failed`. React context dispatches a toast notification. Toast shows for 5s, stackable, dismissable. |
| Responsive layout (usable on a tablet for monitoring) | Dashboard monitoring happens on non-desktop screens. Buildkite's dashboard is responsive. | 2 | Tailwind CSS breakpoints. Card layout on small screens, table layout on desktop. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| WS push for all live data (not polling) | Polling introduces latency and server load at scale. Buildkite v3.120 added streaming WS for agents. For a small v2.0 install, polling works, but WS is the right architecture. | 3 | Single WS connection per browser tab, authenticated with session. Server broadcasts events by org: `agent_status_changed`, `task_run_update`, `log_chunk`. React context subscribes and updates state. |
| Keyboard shortcut to cancel running task | Power users keyboard-navigate CI dashboards. GHA: no keyboard shortcuts. Buildkite: limited. Simple shortcuts are a low-effort differentiator. | 1 | `c` to cancel the selected task run. `r` to trigger a re-run. `j`/`k` to navigate the run list. Documented in a `?` modal. |
| Agent hostname rename (UI editable) | Hostnames auto-detected from the machine may be cryptic (e.g. `ip-10-0-0-4`). Renaming to `prod-deploy-1` makes dashboards readable. | 1 | Inline edit: click hostname in agent detail page → text input → `PATCH /api/agents/:id` with `{ displayName }`. |
| Build badge (SVG endpoint for README) | Teams embed CI status badges in README. Buildkite, CircleCI, GHA all provide this. Low-effort, high visibility. | 1 | `GET /api/orgs/:id/tasks/:taskName/badge.svg` returns an SVG with status color and last run result. No auth required (public by design or opt-in). |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Dashboard analytics and charts (success rate trends, avg duration) | Engineering managers want metrics | Requires time-series aggregation, potentially a separate analytics store. React charting libraries (recharts, victory) add significant bundle size. This is a distraction from the core execution UX. | v2.0: show last 10 runs with status icons (implicit trend). v2.1: add a dedicated insights page. |
| Notification integrations (Slack, PagerDuty, email per task) | Teams want Slack alerts on build failure | Each integration requires OAuth, webhook delivery, retry logic, and per-user configuration. Three separate integrations is a medium sprint. | v2.0: webhook-out endpoint (`POST /api/orgs/:id/notifications/webhook`) — one URL, you write the Slack integration yourself. |
| Dark mode | Visual preference | Not zero cost — requires consistent CSS variable usage, testing, and ongoing maintenance. Can be added in a day if the CSS is well-structured, but it's easy to ship half-done dark mode that looks broken. | Build with CSS variables from day one (don't hardcode colors). Dark mode toggle is then a theme class swap. But don't ship it in v2.0 unless trivial. |

**Dependency:** Dashboard UX depends on all backend categories (agents, tasks, logs). Live updates via WS depend on the server WS infrastructure (shared with agent WS endpoint, but browser-facing connections must be separate/authenticated differently). Log viewer depends on log streaming persistence.

---

## Feature Dependencies (Cross-Category)

```
[Org Model] (Category 4)
    └──required-by──> [Agent Lifecycle] (C1)
    └──required-by──> [Task Dispatch] (C2)
    └──required-by──> [Log Streaming] (C3)
    └──required-by──> [Agent Auth] (C5)
    └──required-by──> [Secrets Management] (C6)
    └──required-by──> [Trigger Plugins] (C7)
    └──required-by──> [Task Definitions] (C8)
    └──required-by──> [Billing/Quota] (C9)

[Agent Auth] (C5)
    └──required-by──> [Agent Lifecycle] (C1, WS handshake)
    └──required-by──> [Task Dispatch] (C2, agent must be authenticated)

[Agent Lifecycle] (C1)
    └──required-by──> [Task Dispatch] (C2, agents must be registered before dispatch)
    └──required-by──> [Dashboard UX] (C10, agent list)

[Task Dispatch] (C2)
    └──required-by──> [Log Streaming] (C3, logs are attached to task runs)
    └──required-by──> [Trigger Plugins] (C7, triggers produce task dispatch requests)

[Task Definitions] (C8)
    └──required-by──> [Task Dispatch] (C2, dispatcher resolves task definition)
    └──required-by──> [Trigger Plugins] (C7, triggers reference task names)

[Secrets Management] (C6)
    └──required-by──> [Log Streaming] (C3, masking depends on knowing secret values)
    └──enhances──> [Task Dispatch] (C2, secrets injected at dispatch)

[Log Streaming] (C3)
    └──required-by──> [Dashboard UX] (C10, log viewer)

[Billing/Quota] (C9)
    └──enhances──> [Agent Lifecycle] (C1, max-agents enforcement)
    └──enhances──> [Task Dispatch] (C2, max-concurrent enforcement)
    └──enhances──> [Log Streaming] (C3, retention enforcement)
```

### Dependency Notes

- **Org model must ship first**: it is the foreign key for everything. No other category can be implemented without it.
- **Agent Auth must ship before Agent Lifecycle**: the WS upgrade requires authentication.
- **Task Definitions must ship before Task Dispatch**: dispatcher needs to resolve task YAML.
- **Log Streaming masking depends on Secrets Management**: the redactor needs decrypted secret values at task dispatch time.
- **Trigger Plugins depend on Task Dispatch being stable**: plugins are useless if dispatch is broken.

---

## MVP Definition for v2.0

### Must Ship (Table Stakes — all 10 categories have their table stakes in v2.0)

- [ ] Agent registration, TOFU handshake, heartbeat, online/offline state, reconnect, graceful shutdown — C1
- [ ] Label-based dispatch, queuing, timeout, cancellation, exit code propagation — C2
- [ ] Realtime log streaming (WS), persistence, retention window, secrets redaction — C3
- [ ] Email/password auth, email verification, password reset, org isolation, 3 roles, invitations — C4
- [ ] Per-agent token (TOFU), revocation, org-scoped — C5
- [ ] Org-level encrypted secrets, env injection, log masking, admin-only write — C6
- [ ] Stable plugin interface, HMAC verification, event normalization, GitHub plugin, Perforce plugin — C7
- [ ] v1 YAML DSL server-side, YAML editor in UI, placeholder resolution at dispatch — C8
- [ ] Free plan entity, agent quota enforcement, concurrent task quota, quota UI in settings — C9
- [ ] Agent list, task run list, live log viewer, empty states, error toasts — C10

### Explicit Defers to v2.1

- Matrix runs (C8) — complexity explosion without agent saturation protection
- Task-scoped secrets (C6) — additional table + dispatch logic, not urgent
- Artifacts between steps across machines (C8) — requires storage layer
- Global log search (C3) — requires full-text index
- SSO / OIDC (C4) — design tables for it, implement in v2.1
- 2FA (C4) — design auth layer for it, implement in v2.1
- GitHub App (C7) — webhook sufficient for v2.0
- Agent auto-scaling (C1) — cloud-provider dependency
- Dashboard analytics / charts (C10) — post-product-market-fit
- Notification integrations (Slack, PagerDuty) (C10) — webhook-out stub sufficient
- Stripe / paid plans (C9) — billing stub only in v2.0
- Dark mode (C10) — trivial to add later if CSS variables used from day one

---

## Complexity Summary

| Category | Overall Complexity | Largest Single Item |
|----------|--------------------|---------------------|
| C1: Agent Lifecycle | 3 | WebSocket agent protocol + reconnect semantics |
| C2: Task Dispatch | 3 | Label matching engine + concurrency enforcement |
| C3: Log Streaming | 3 | WS → server → browser pipeline + redaction |
| C4: Auth & Org Model | 3 | Org isolation middleware + invitation flow |
| C5: Agent Auth | 2 | TOFU handshake + token storage |
| C6: Secrets Management | 3 | Envelope encryption + log masking |
| C7: Trigger Plugins | 3 | Plugin interface + HMAC + Perforce script |
| C8: Task Definitions | 2 | YAML editor + server-side dispatch resolution |
| C9: Billing/Quota | 2 | Plan entity + enforcement in dispatch/agent paths |
| C10: Dashboard UX | 3 | WS push to browser + live log viewer |

**Total: All 10 categories at complexity 2-3. No single category is trivial. Suggested phase grouping:**

- Phase A: Org model + Auth (C4 foundation) + Agent Auth (C5) — enables all downstream categories
- Phase B: Agent Lifecycle (C1) + WS infrastructure
- Phase C: Task Definitions (C8) + Task Dispatch (C2)
- Phase D: Log Streaming (C3) + Secrets Management (C6, basic injection)
- Phase E: Trigger Plugins (C7) — GitHub webhook first, Perforce second
- Phase F: Dashboard UX (C10) — can be parallelized with D/E once C and D are underway
- Phase G: Billing/Quota (C9) + Secrets encryption + Log masking (remaining C3/C6 hardening)

---

## Sources

- [Buildkite Agent Lifecycle](https://buildkite.com/docs/agent/lifecycle) — heartbeat timing, lost-agent detection (3 min), drain mode
- [Buildkite Agent Tokens](https://buildkite.com/docs/agent/v3/tokens) — cluster tokens, session token exchange, revocation
- [Buildkite Controlling Concurrency](https://buildkite.com/docs/pipelines/configure/workflows/controlling-concurrency) — concurrency groups, per-step limits
- [Buildkite Queues Overview](https://buildkite.com/docs/agent/queues) — label/tag-based dispatch model
- [Buildkite Platform Limits](https://buildkite.com/docs/platform/limits) — log sizes, artifact retention
- [Buildkite Pricing](https://buildkite.com/pricing/) — Free plan: 3 agents, 90-day retention, 3 concurrent jobs, 1 user
- [Buildkite HMAC Signed Webhooks](https://buildkite.com/resources/changelog/128-hmac-signed-webhooks/) — HMAC-SHA256 with timestamp for replay prevention
- [GitHub Actions Self-Hosted Runners](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners) — registration token model, 1-hour expiry, RSA key exchange
- [GitHub Actions Runner Auth Design](https://github.com/actions/runner/blob/main/docs/design/auth.md) — TOFU-style public key handshake
- [CircleCI Concurrency](https://circleci.com/docs/concurrency/) — plan-based concurrency caps, serial groups
- [CircleCI Users and Organizations](https://circleci.com/docs/guides/permissions-authentication/users-organizations-and-integrations-guide/) — org isolation, role model
- [Drone CI Secrets](https://docs.drone.io/secret/) — per-repo secrets, PR isolation, masking patterns
- [Concourse CI Resource Types](https://concourse-ci.org/resource-types.html) — three-method plugin contract: check/in/out
- [WorkOS SaaS Multi-tenant Architecture](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture) — org-as-tenant pattern, SSO-ready design
- [Buildkite Agent Graceful Shutdown Issues](https://github.com/buildkite/agent/issues/922) — SIGTERM handling gotchas, cancel grace period
- [Buildkite Streaming Job Dispatch v3.120](https://buildkite.com/releases) — WS-based job dispatch reducing latency
- [Drone CI Log Masking Feature Request](https://ideas.harness.io/feature-request/p/drone-ci-masking-secrets-in-the-execution-logs-after-they-are-base64-encoded) — base64-encoded secret masking gap (known industry gotcha)

---

*Feature research for: xci v2.0 Remote CI — Agents + Web Dashboard*
*Researched: 2026-04-16*
