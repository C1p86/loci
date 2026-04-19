# Phase 12 Discussion Log

**Mode:** Auto-selected — 38 locked decisions for plugin system + webhooks + DLQ.

Key calls:
- 3-method TriggerPlugin interface (verify / parse / mapToTask); 2 bundled plugins (github, perforce); no runtime install
- Per-org webhook tokens stored hashed + per-plugin secret (GitHub HMAC) encrypted via Phase 9 envelope
- Token-in-URL for hooks is legitimate (machine identity, not user auth)
- Idempotency via webhook_deliveries unique index + 90d retention
- Scrubbing: deny-list (Authorization, X-Hub-Signature*, X-Xci-Token, Cookie) stripped pre-DLQ-persist
- DLQ retry SKIPS signature verify (admin-conscious bypass; PLUG-08 forbids storing signature)
- Explicit per-task trigger_configs JSONB (no naming convention)
- Perforce trigger emitted via xci CLI to curl+PowerShell scripts (Node-free on Perforce server)
- mapToTask returns all matching tasks (single event → multiple runs OK)
- param extraction: git.ref/git.sha/git.repository for GitHub; p4.change/p4.user for Perforce
- 3 new tables (webhook_tokens, webhook_deliveries, dlq_entries) + tasks.trigger_configs extension

See CONTEXT.md for full detail.
