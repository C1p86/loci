# Phase 9: Task Definitions & Secrets Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-04-18
**Mode:** Auto-selected by Claude per user authorization for autonomous chain to milestone end

| Decision | Choice | Why |
|----------|--------|-----|
| Shared YAML parser location | Subpath export from xci package (`xci/dsl`), NOT separate workspace package | Roadmap text says "sub-module di xci"; avoids 4th workspace + Changesets fixed-versioning churn |
| DSL extraction approach | Re-export facade in `packages/xci/src/dsl/` over existing commands/resolver modules | Zero behavior change to v1; BC-01 fence preserved |
| tsup multi-entry | Add 3rd entry `dsl` alongside cli + agent | Subpath export needs its own bundle |
| Cross-package imports | xci/dsl → @xci/server allowed; reverse forbidden via Biome | Phase 6 fence formally lifted in Phase 8; this adds controlled sharing |
| Task entity storage | yaml_definition stored as text (preserves comments + formatting) | Re-parse on demand; dispatch + display both work |
| Task validation | Save-time: parse → structure → cycle → unknown alias (with Levenshtein suggestion); placeholder syntax only, NO resolution at save | Placeholders may legitimately reference dispatch-time params |
| Envelope encryption | MEK from XCI_MASTER_KEY env (32-byte base64), per-org DEK in DB wrapped under MEK, secret values under DEK; AES-256-GCM throughout | Standard envelope; SEC-01 spec; AAD binding for defense-in-depth |
| AAD for secrets | `<orgId>:<name>` — binds ciphertext to its location | Prevents cross-org decryption even if DEK leaks |
| IV per call | Random 12-byte CSPRNG (NIST SP 800-38D) | SEC-02 mandate |
| Secrets API surface | NO endpoint EVER returns plaintext value; only metadata | Architectural invariant verifiable by grep |
| Secret audit log | Org-scoped table, written in same transaction as the action | SEC-07 + atomicity guarantee |
| MEK rotation | Single Postgres transaction over all DEKs; mek_version tracking for idempotency on retry | Atomicity + retry safety; SEC-08 |
| Platform admin gate | env var `PLATFORM_ADMIN_EMAIL` matches user.email | Single-user platform admin in v2.0; KMS auto-rotation deferred |
| Plaintext value handling | Zero-fill buffer after encryption; never persisted in plaintext | Defense-in-depth |
| Pino redaction extension | secret-route-scoped redact for `req.body.value`, `*.value`, `*.ciphertext`, `*.dek`, `*.mek` | SEC-04 spirit + Phase 7 D-10 pattern |
| Audit log retention | Manual; no auto-cleanup in Phase 9 | Defer until growth becomes an issue |
| Dispatch resolver | Pure function in `services/dispatch-resolver.ts`; Phase 9 builds, Phase 10 calls | Separates resolution from dispatch logic |
| Tests | Unit (no Docker): crypto roundtrip, IV uniqueness, AAD validation, tag tampering. Integration (Linux+Docker): CRUD + isolation + MEK rotation roundtrip + audit log | Standard Phase 7 split |

## Deferred Ideas

See CONTEXT.md `<deferred>` section. Highlights:
- KMS backend → post-v2.0
- Automatic MEK rotation schedule → v2.1+
- Task version history / audit → out of scope
- Per-secret ACL → org-scoped only
- Audit log retention/cleanup → defer
