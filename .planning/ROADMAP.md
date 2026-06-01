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

<details>
<summary>✅ Phase 15: Go CLI — Parity Fixes (SHIPPED 2026-05-31)</summary>

- [x] **Phase 15: Go CLI — Parity Fixes** — Multi-pass placeholder resolution, params validation, secrets git warning, passthrough args fix (completed 2026-05-31)

</details>

---

### v2.1 Quality & Parity (Phases 16–20)

- [ ] **Phase 16: Go CLI Output Infrastructure** — Shared `output.go` with fatih/color, isTTY detection, Windows VT support, colored run-header
- [ ] **Phase 17: Go CLI Feature Parity** — `for_each.in` with `${VAR}` CSV-split, `cwd` field with inheritance, breadcrumb step headers, cwd-print before each step
- [ ] **Phase 18: Agent Multi-Step Dispatch & Shell Completions** — ExecutionPlan dispatch on agent with seq accumulator; bash/zsh/fish completion generators + Go cobra completion
- [ ] **Phase 19: Security Debt** — Session token SHA-256 hashing at rest with two-phase migration; haveibeenpwned k-anonymity check on signup/reset
- [ ] **Phase 20: Quality, CI Gates & DevOps** — 68 Biome style errors cleanup; bundle-size CI gate wired; branch protection required checks; NPM_TOKEN secret

---

## Phase Details

### Phase 15: Go CLI — Parity Fixes
**Goal**: The Go CLI `go-xci` achieves parity with the TypeScript version for all in-scope v2.1 base features
**Depends on**: go-xci foundation
**Requirements**: GOCLI-01, GOCLI-02, GOCLI-03, GOCLI-04, GOCLI-05
**Success Criteria** (what must be TRUE):
  1. Multi-pass placeholder resolution resolves nested `${VAR}` references across up to 10 iterations
  2. Required params validation rejects runs with missing values before any command executes
  3. Secrets git warning appears on stderr when secrets.yml is tracked
  4. Passthrough args `--` are forwarded correctly in sequential and parallel plans
**Plans**: 15-01-PLAN.md, 15-02-PLAN.md, 15-03-PLAN.md

### Phase 16: Go CLI Output Infrastructure
**Goal**: The Go CLI has a shared output foundation that enables colored, structured terminal output across all execution paths
**Depends on**: Phase 15
**Requirements**: GOCLI-06
**Success Criteria** (what must be TRUE):
  1. Running any alias prints a colored run-header showing the alias name and resolved params before execution begins
  2. The header uses bright cyan color on TTY-capable terminals; plain text on non-TTY (pipes, CI)
  3. Colors render correctly on Windows (VT processing enabled automatically via fatih/color + go-isatty)
  4. All diagnostic output from go-xci uses stderr; stdout remains clean for tab completion
**Plans**: TBD

### Phase 17: Go CLI Feature Parity
**Goal**: The Go CLI supports all remaining parity features: iterative execution, working directory control, and rich execution breadcrumbs
**Depends on**: Phase 16
**Requirements**: GOCLI-07, GOCLI-08, GOCLI-09, GOCLI-10
**Success Criteria** (what must be TRUE):
  1. A `for_each.in` field accepting a `${VAR}` placeholder runs the step once per CSV value, with `${ITEM}` available in each iteration
  2. An alias with `cwd: ./subdir` executes its steps in that directory; child steps without their own `cwd` inherit the parent's resolved value
  3. Step headers display the full breadcrumb path (e.g. `build > compile > step1`) during nested execution
  4. The effective working directory is printed in dark yellow before each step spawns
**Plans**: TBD

### Phase 18: Agent Multi-Step Dispatch & Shell Completions
**Goal**: Agents can execute multi-step sequential and parallel tasks dispatched from the server; users can tab-complete xci alias names in their shell
**Depends on**: Phase 11 (log streaming), Phase 16 (Go cobra completion infra)
**Requirements**: DISP-01, DX-01
**Success Criteria** (what must be TRUE):
  1. Dispatching a sequential task to a remote agent runs steps in order; a failed step stops remaining steps and marks the run failed
  2. Dispatching a parallel task to a remote agent runs all steps concurrently; log chunks across steps carry globally-ordered seq values with no collisions
  3. Cancelling a running multi-step task stops any in-progress step and skips all pending steps
  4. `xci completion bash` (and zsh, fish, PowerShell) prints a shell integration script; `xci completion install <shell>` writes it to the appropriate config file
  5. Tab-completing `xci <TAB>` in bash/zsh/fish/PowerShell lists alias names loaded live from `.xci/commands.yml`
**Plans**: TBD

### Phase 19: Security Debt
**Goal**: Session tokens are never stored as plaintext in the database; compromised passwords are rejected at signup and reset
**Depends on**: Phase 7 (sessions schema), Phase 8 (agent credential hashing pattern)
**Requirements**: SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. The `sessions` table stores only SHA-256 hashes of tokens; the plaintext token appears only in the login response body and never in the database
  2. Existing sessions continue to work after deployment without requiring users to log in again (backfill migration)
  3. Signing up with a password found in the haveibeenpwned database returns a clear rejection message
  4. Resetting a password to a compromised value is blocked with the same message
  5. A network error or timeout from the HIBP API does not block signup or reset (fail-open behavior)
**Plans**: TBD

### Phase 20: Quality, CI Gates & DevOps
**Goal**: The codebase is clean of known style errors, CI prevents bundle size regressions, and the GitHub repository is hardened for safe merges and publishing
**Depends on**: Phase 18 (final bundle snapshot for accurate baseline)
**Requirements**: QA-01, QA-02, OPS-01, OPS-02
**Success Criteria** (what must be TRUE):
  1. The Biome lint step in CI passes with zero errors on `packages/xci/src/`; no behavior change in any resolved or executed command
  2. The CI pipeline includes a bundle-size gate step that fails if `dist/cli.mjs` exceeds the configured threshold
  3. PRs targeting main cannot be merged unless all required CI checks pass (integration-tests, fence-gates, all 6 build-test-lint matrix jobs)
  4. The npm publish pipeline can execute successfully with the `NPM_TOKEN` secret configured in the repository
**Plans**: TBD

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
| 16. Go CLI Output Infrastructure | 0/? | Not started | - |
| 17. Go CLI Feature Parity | 0/? | Not started | - |
| 18. Agent Multi-Step Dispatch & Shell Completions | 0/? | Not started | - |
| 19. Security Debt | 0/? | Not started | - |
| 20. Quality, CI Gates & DevOps | 0/? | Not started | - |

**v1.0 milestone: ✅ SHIPPED 2026-04-15 (phases 1–5, 12 plans, 57 requirements)**
**v2.0 milestone: ✅ SHIPPED 2026-04-19 (phases 6–14, 50 plans, 99 requirements)**
**Phase 15 (Go CLI): ✅ COMPLETE 2026-05-31 (3 plans, 5 requirements)**
**v2.1 milestone: in progress — phases 16–20, 13 requirements**
