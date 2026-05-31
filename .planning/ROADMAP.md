# Roadmap: loci

## Milestones

- ✅ **v1.0 Local CLI** — Phases 1–5 (shipped 2026-04-15) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v2.0 Remote CI** — Phases 6–14 (shipped 2026-04-19) — [archive](milestones/v2.0-ROADMAP.md)

---

## Phases

<details>
<summary>✅ v1.0 Local CLI (Phases 1–5) — SHIPPED 2026-04-15</summary>

- [x] **Phase 1: Foundation** — Project scaffold, shared types, error hierarchy, CI matrix on Windows/Linux/macOS (completed 2026-04-13)
- [x] **Phase 2: Config System** — 4-layer YAML loader with deterministic merge, secrets redaction contract, gitignore safety check (completed 2026-04-13)
- [x] **Phase 3: Commands & Resolver** — commands.yml parser, alias composition with cycle detection, `${VAR}` interpolation (completed 2026-04-14)
- [x] **Phase 4: Executor & CLI** — cross-platform command execution, parallel groups, full commander.js frontend wired end-to-end (completed 2026-04-14)
- [x] **Phase 5: Init & Distribution** — `loci init` scaffolding, README, npm publish (completed 2026-04-15)

See full archive: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)

</details>

<details>
<summary>✅ v2.0 Remote CI (Phases 6–14) — SHIPPED 2026-04-19</summary>

- [x] **Phase 6: Monorepo Setup & Backward-Compat Fence** — pnpm workspaces, Turborepo, Changesets; CI ws-fence + cold-start gate + v1 regression suite active (completed 2026-04-16)
- [x] **Phase 7: Database Schema & Auth** — Drizzle schema, migrations, signup/login/sessions/password-reset, org model, multi-tenant isolation (completed 2026-04-18)
- [x] **Phase 8: Agent Registration & WebSocket Protocol** — TOFU agent registration, persistent WS with heartbeat/reconnect, agent lifecycle (completed 2026-04-18)
- [x] **Phase 9: Task Definitions & Secrets Management** — server-side YAML DSL, CRUD API; org-level envelope encryption, secrets CRUD, dispatch-time resolution (completed 2026-04-19)
- [x] **Phase 10: Dispatch Pipeline & Quota Enforcement** — label-match dispatcher, TaskRun state machine, timeout/cancel/orphan, quota enforcement (completed 2026-04-19)
- [x] **Phase 11: Log Streaming & Persistence** — agent log_chunk streaming, RunBuffer, Postgres persistence, UI WebSocket fanout, retention cleanup (completed 2026-04-19)
- [x] **Phase 12: Plugin System & Webhooks** — TriggerPlugin interface, GitHub + Perforce plugins, Dead Letter Queue, idempotency (completed 2026-04-19)
- [x] **Phase 13: Web Dashboard SPA** — React 19 + Vite + Tailwind 4 SPA: auth, agents, tasks, log viewer, run history, settings, build-status badges (completed 2026-04-19)
- [x] **Phase 14: Docker & Publishing** — multi-stage Docker image, docker-compose dev stack, CI smoke-test, npm publish pipeline, Changesets release flow (completed 2026-04-19)

See full archive: [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)

</details>

---

### Phase 15: Go CLI — Parity Fixes (Complete: 2026-05-31)

**Goal**: Il CLI Go `go-xci` è in parità con la versione TypeScript per tutte le feature in-scope: KEY=VALUE overrides, params validation, multi-pass placeholder resolution, secrets.yml git warning, e passthrough args `--`
**Depends on**: go-xci (fase standalone, nessuna dipendenza Node)
**Requirements**: GOCLI-01, GOCLI-02, GOCLI-03, GOCLI-04, GOCLI-05
**Plans**: 3 plans
- [x] 15-01-PLAN.md — Multi-pass placeholder resolution (GOCLI-03): interpolateTokenMultiPass + updated InterpolateArgv/InterpolateArgvLenient + new tests
- [x] 15-02-PLAN.md — Params validation + Secrets git warning (GOCLI-02, GOCLI-04): ParamDef type, loader parsing, validateParams + checkSecretsTracked
- [x] 15-03-PLAN.md — Passthrough args fix for sequential/parallel + integration tests (GOCLI-05, GOCLI-01 verification)

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete | 2026-04-13 |
| 2. Config System | 1/1 | Complete | 2026-04-13 |
| 3. Commands & Resolver | 2/2 | Complete | 2026-04-14 |
| 4. Executor & CLI | 2/2 | Complete | 2026-04-14 |
| 5. Init & Distribution | 3/3 | Complete | 2026-04-15 |
| 6. Monorepo Setup & Backward-Compat Fence | 6/6 | Complete | 2026-04-16 |
| 7. Database Schema & Auth | 9/9 | Complete | 2026-04-18 |
| 8. Agent Registration & WebSocket Protocol | 5/5 | Complete | 2026-04-18 |
| 9. Task Definitions & Secrets Management | 6/6 | Complete | 2026-04-19 |
| 10. Dispatch Pipeline & Quota Enforcement | 5/5 | Complete | 2026-04-19 |
| 11. Log Streaming & Persistence | 4/4 | Complete | 2026-04-19 |
| 12. Plugin System & Webhooks | 5/5 | Complete | 2026-04-19 |
| 13. Web Dashboard SPA | 6/6 | Complete | 2026-04-19 |
| 14. Docker & Publishing | 4/4 | Complete | 2026-04-19 |
| 15. Go CLI — Parity Fixes | 3/3 | Complete | 2026-05-31 |

**v1.0 milestone: ✅ SHIPPED 2026-04-15 (phases 1–5, 12 plans, 57 requirements)**
**v2.0 milestone: ✅ SHIPPED 2026-04-19 (phases 6–14, 50 plans, 99 requirements)**
**Phase 15 (Go CLI): ✅ COMPLETE 2026-05-31 (3 plans, 5 requirements)**
