# Milestones

## v2.0 Remote CI — Agents + Web Dashboard (Shipped: 2026-04-19)

**Phases:** 6–14 (9 phases, 50 plans)
**Requirements:** 99/99 complete

**Key accomplishments:**

1. Monorepo restructured with pnpm workspaces + Turborepo + Changesets; 3-layer ws-exclusion fence + v1 backward-compat gate active from day one
2. Full multi-tenant auth stack (Fastify + Drizzle + Postgres): signup/login/sessions/invites, two-org isolation fixture enforces org_id filter on every repo function
3. Agent mode: TOFU registration, persistent WebSocket with 25s heartbeat, exponential backoff reconnect, full lifecycle (online/offline/drain/reconcile/shutdown)
4. Server-side task definitions using shared YAML DSL (xci/dsl subpath); org-level envelope encryption (AES-256-GCM MEK/DEK), no plaintext secret ever returned via API
5. Label-match dispatch pipeline with 8-state TaskRun machine, per-org quota enforcement (Free: 5 agents / 5 concurrent), timeout/cancel/orphan recovery
6. Real-time log chunk streaming: Postgres persistence, RunBuffer in-memory fanout, ordered replay, secret redaction pre-persist (server-side + agent-side)
7. GitHub + Perforce webhook plugins (HMAC/token verify, Dead Letter Queue, idempotency via delivery_id, header scrubbing before DLQ persistence)
8. React 19 + Vite + Tailwind 4 SPA: agents list, task YAML editor (Monaco), live log viewer, run history, org settings, plugin settings, build-status badges
9. Multi-stage Docker image (<400MB, non-root UID), docker-compose dev stack, CI smoke test (signup→agent→task→log), npm publish pipeline (Changesets)

Archive: [.planning/milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)

---

## v1.0 Local CLI (Shipped: 2026-04-15)

**Phases:** 1–5 (5 phases, 12 plans)
**Requirements:** 57/57 complete

**Key accomplishments:**

1. Cross-platform CLI (`xci`) as a single bundled ESM binary, installable via `npm i -g xci`, under 300ms cold start on all platforms
2. 4-layer YAML config system (machine/project/secrets/local) with deterministic merge, YAML 1.2 semantics, and explicit git-tracking warning for secrets
3. Commands resolver: alias composition with DFS cycle detection, `${VAR}` interpolation with explicit missing-placeholder errors, per-platform overrides
4. Executor engine: single/sequential/parallel command execution via execa, real-time stdout/stderr streaming, exit code propagation, SIGINT handling
5. `xci init` scaffolding, cross-platform CI matrix (Windows/Linux/macOS × Node 20/22), published to npm as `xci`

Archive: [.planning/milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

---
