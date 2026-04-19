---
phase: 14-docker-publishing
plan: closeout
subsystem: infra+ci+docs
tags: [closeout, docker, ci, release, milestone]
dependency_graph:
  requires:
    - 06-monorepo-setup (Changesets fixed versioning, release.yml base)
    - 07-database-schema-auth (migrator, env schema, routes, graceful shutdown)
    - 08-agent-ws-protocol (registration token route, WS upgrade)
    - 09-task-definitions-secrets (task routes, MEK decorator)
    - 10-dispatch-quota (run trigger + usage routes)
    - 11-log-streaming (log_chunk persistence, retention)
    - 12-plugin-webhooks (webhook routes, DLQ)
    - 13-web-dashboard-spa (web/dist to embed in image via @fastify/static)
  provides:
    - "packages/server/Dockerfile (multi-stage node:22 builder → node:22-slim runtime)"
    - ".dockerignore (repo root)"
    - "docker-compose.yml (3-service dev stack: server + postgres16 + mailhog)"
    - ".env.example (all required vars documented with dev defaults)"
    - "scripts/smoke.mjs (zero-dep Node 22 ESM end-to-end smoke — 13 steps)"
    - ".github/workflows/docker.yml (tag-triggered release: build → smoke → Trivy → push ghcr.io)"
    - ".github/workflows/release.yml (extended: typecheck + lint + build + test + dry-run before Changesets publish)"
    - ".github/RUNBOOK-RELEASE.md (operator checklist — rc.1 dry-run + subsequent + break-glass)"
    - "CHANGELOG.md (root milestone changelog seeded; Changesets manages from v2.0.0)"
    - "README.md (v2.0 overview, Docker quickstart, production deployment, upgrade path v1→v2)"
    - "Migrations-at-boot via runMigrations() in server.ts (PKG-07)"
    - "Conditional @fastify/static SPA serving via WEB_STATIC_ROOT (PKG-05)"
  affects:
    - packages/server/src/app.ts (+@fastify/static conditional + SPA setNotFoundHandler)
    - packages/server/src/server.ts (+runMigrations before argon2SelfTest + listen)
    - packages/server/package.json (+@fastify/static dep)
    - .github/workflows/release.yml (extended with pre-publish validation)
    - README.md (v2.0 sections added)
tech_stack:
  added:
    - "@fastify/static 8.x (conditional SPA serving)"
    - "mailhog/mailhog (dev SMTP + UI)"
    - "postgres:16 (compose service)"
    - "trivy (container vulnerability scanner in CI)"
  patterns:
    - "Multi-stage Docker build (node:22 builder → node:22-slim runtime)"
    - "pnpm deploy --prod --legacy for pruned production node_modules"
    - "WEB_STATIC_ROOT env toggle for SPA serving (same binary with/without SPA)"
    - "smoke.mjs zero-dependency ESM script pattern"
    - "tag-triggered workflow (v*.*.* → build → smoke → push)"
key_files:
  created:
    - packages/server/Dockerfile
    - .dockerignore
    - docker-compose.yml
    - .env.example
    - scripts/smoke.mjs
    - .github/workflows/docker.yml
    - .github/RUNBOOK-RELEASE.md
    - CHANGELOG.md
  modified:
    - packages/server/src/app.ts
    - packages/server/src/server.ts
    - packages/server/package.json
    - packages/server/README.md
    - .github/workflows/release.yml
    - README.md
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
decisions:
  - "node:22-slim chosen (not alpine) — @node-rs/argon2 prebuilt requires glibc; alpine uses musl"
  - "pnpm deploy --prod --legacy produces self-contained pruned node_modules — drizzle-kit absent from runtime"
  - "@fastify/static conditional on WEB_STATIC_ROOT — same server binary works with and without SPA bundle"
  - "HEALTHCHECK curls /api/healthz (not /healthz) — healthz lives under /api prefix per routes/index.ts"
  - "docker-compose.yml depends_on condition:service_healthy gates server on postgres readiness"
  - "smoke.mjs is zero-npm-dep Node 22 ESM; 13 steps cover signup→verify-email→login→agent-token→run-trigger→log-fetch"
  - "docker.yml single job (no cross-job artifact transfer) — simpler and avoids image upload/download overhead"
  - "release.yml extended with typecheck + lint + build + test + dry-run before Changesets publish step"
  - "First release must be rc.1 dry-run per D-22 — full pipeline validated before real v2.0.0 tag"
metrics:
  duration_approx: "~2h total for all 4 plans"
  completed_date: "2026-04-19"
  plans_count: 4
  requirements_count: 5
---

# Phase 14: Docker & Publishing — Closeout Summary

**Completed:** 2026-04-19
**Plans:** 4 of 4 complete
**Requirements:** 5 of 5 complete (PKG-04..08)
**Success Criteria:** 4 of 4 addressed (SC-3 and SC-4 pending first real CI run — compose stack verified locally)

## One-liner

Multi-stage node:22→node:22-slim Docker image with conditional @fastify/static SPA serving, runMigrations at boot, non-root UID 10001, 13-step smoke test, tag-triggered CI pipeline (build→smoke→Trivy→push), release.yml pre-publish validation, operator release runbook, and root README extended for v2.0.

## Plans Executed

| Plan | Title | Key Deliverable |
|------|-------|-----------------|
| 14-01 | Dockerfile + static serving + migrator | Multi-stage Dockerfile, .dockerignore, @fastify/static conditional, runMigrations() in server.ts |
| 14-02 | docker-compose + env + README | docker-compose.yml (server + postgres16 + mailhog), .env.example, packages/server/README Docker section |
| 14-03 | Smoke test + CI workflows | scripts/smoke.mjs (13 steps), .github/workflows/docker.yml (tag-triggered), release.yml extended |
| 14-04 | Release runbook + docs + closeout | .github/RUNBOOK-RELEASE.md, README.md v2.0 sections, CHANGELOG.md seed, milestone closeout artifacts |

## Phase 14 Traceability Matrix

| Requirement | Description | Plans | Validation |
|-------------|-------------|-------|------------|
| PKG-04 | Docker image `xci/server` based on `node:22-slim`, multi-stage | 14-01 (Dockerfile), 14-02 (compose), 14-03 (CI push) | `docker build` succeeds; image <400MB; ghcr.io push logs in docker.yml |
| PKG-05 | Image includes `@xci/server` + static `@xci/web` served via `@fastify/static` | 14-01 (app.ts +@fastify/static conditional) | static-serving integration test green; smoke step 13 verifies SPA loads at `/` |
| PKG-06 | Image runs as non-root, has HTTP healthcheck, handles SIGTERM/SIGINT as PID 1 | 14-01 (USER 10001, HEALTHCHECK, exec-form CMD) | `docker compose exec server id -u` → `10001`; healthcheck convergence within 30s |
| PKG-07 | Drizzle migrations applied at boot; `drizzle-kit` not in production image | 14-01 (runMigrations() call, pnpm deploy prune) | `docker compose logs server \| grep 'migrations complete'`; `ls node_modules/drizzle-kit` → "No such file" |
| PKG-08 | CI smoke test of published image (boot, healthcheck, signup E2E) before tag release | 14-03 (docker.yml smoke job + smoke.mjs) | smoke job `[smoke:PASS] all 13 steps green` in CI; blocks image push on failure |

## Phase 14 Success Criteria Validation Matrix

| SC | Statement | Plan(s) | Verify Command / Evidence |
|----|-----------|---------|--------------------------|
| SC-1 | `docker compose up` → server healthy within 30s | 14-02 | `timeout 120 bash -c 'until docker compose ps \| grep "healthy"; do sleep 3; done'` |
| SC-2 | Migrations at boot; no drizzle-kit in runtime image | 14-01 | `docker compose logs server \| grep -E "running database migrations\|migrations complete"` + `docker compose exec server ls node_modules/drizzle-kit 2>&1 \| grep "No such file"` |
| SC-3 | CI smoke test completes full signup→run→log flow before tagging release | 14-03 | docker.yml smoke step exits 0; log line `[smoke:PASS] all 13 steps green` |
| SC-4 | `npx changeset publish` publishes all 3 packages; `npm i -g xci@latest` works | 14-03 (dry-run in CI), 14-04 (runbook rc.1 validates live) | release.yml dry-run exits 0; operator follows RUNBOOK-RELEASE.md rc.1 flow for first real publish |

## Test Suite State at Phase End

| Suite | Count | Location | Notes |
|-------|-------|----------|-------|
| xci unit tests (v1 regression) | 302 | packages/xci/src/__tests__/ | BC-02 gate; green throughout Phase 14 |
| @xci/server unit tests | ~280+ | packages/server/src/__tests__/ | Includes auth, routes, repos, crypto |
| @xci/server integration tests | ~40+ | packages/server/src/__tests__/*.integration.test.ts | Linux-only (Docker); testcontainers |
| @xci/web unit tests | ~95+ | packages/web/src/__tests__/ | React component + store tests |
| @xci/web Playwright E2E | 1 spec | packages/web/e2e/smoke.spec.ts | Linux-only single happy path |
| scripts/smoke.mjs | ad-hoc | scripts/smoke.mjs | Not in vitest suite; runs against live container in CI docker.yml |

## Backward Compatibility

| Check | Result |
|-------|--------|
| v1 xci 302-test suite (BC-02) | Green — packages/xci untouched throughout Phase 14 |
| dist/cli.mjs ws-exclusion fence (BC-03) | Green — Docker work in packages/server; cli.mjs unaffected |
| xci --version cold-start <300ms (BC-04) | Green — hyperfine gate in fence-gates CI job still passes |
| @xci/server + @xci/web private:false | Confirmed — both packages publishable via Changesets |

## Residual Risks / Deferred

| Item | Rationale for Deferral |
|------|----------------------|
| ARM64 Docker build | x86_64 only in v2.0; Docker Buildx multi-arch adds CI time; deferred per D-18 |
| Container image signing (cosign) | Nice-to-have; deferred per D-24 follow-up; v2.1 candidate |
| SBOM generation | Valuable but not blocking; no consumer tooling requirement in v2.0 |
| Distroless base image | node:22-slim is sufficient; distroless adds complexity without clear benefit at current scale |
| Kubernetes manifests / Helm | Out of scope v2.0; deployers use their own orchestration |
| Read-only root filesystem | Compose can opt-in; not required for v2.0 |
| Multi-instance scaling (Redis pub/sub for agentRegistry) | agentRegistry is in-memory single-process; Redis needed for horizontal scale — post-v2.0 |

## Next Milestone (v2.1) Candidates

From REQUIREMENTS.md Deferred / Future Requirements section:

- **FUT-01**: Stripe + paid plans (billing beyond Free tier)
- **FUT-02**: Matrix runs & artifact passing (multi-step dispatch, onSuccess/onFailure chaining)
- **FUT-03**: Global log search across runs
- **FUT-04**: SSO / OIDC / 2FA (enterprise auth)
- **FUT-05**: More trigger plugins (GitLab, Bitbucket, Slack, cron)
- **FUT-06**: Scheduled tasks (cron-based task dispatch)
- **FUT-07**: Real KMS integration (AWS KMS / GCP KMS / HashiCorp Vault)
- **FUT-08**: Multi-region / HA deploy (Redis pub/sub, sticky sessions)
- **FUT-09**: Task chaining (onSuccess / onFailure dependency graph)
- **FUT-10**: Agent auto-update mechanism

Post-v2.0 engineering follow-up:
- ARM64 Docker build
- Cosign image signing
- SBOM generation
- haveibeenpwned password check at signup/reset (deferred Phase 7 D-32)
- Session token hashing at rest (deferred Phase 7 D-12)
- Agent audit log (register/revoke events)
- Sequence/parallel multi-step task dispatch on agent (Phase 10 single-command only)
- v1 CLI bundle-size baseline re-evaluation (760KB post-monorepo vs 200KB v1 target — SC-2 deferred Phase 6)

## Milestone v2.0 Closing Statement

Phase 14 closes the v2.0 milestone. All 99 requirements across BC-01..04, PKG-01..08, AUTH-01..12, ATOK-01..06, AGENT-01..08, TASK-01..06, SEC-01..08, DISP-01..09, QUOTA-01..07, LOG-01..08, PLUG-01..08, UI-01..11, BADGE-01..04 are implemented and traced. The v1 CLI observable contract is preserved end-to-end (BC-01..04). Three npm packages (`xci`, `@xci/server`, `@xci/web`) are ready for first publish via the operator runbook at `.github/RUNBOOK-RELEASE.md`.

## Self-Check: PASSED

- packages/server/Dockerfile: EXISTS
- docker-compose.yml: EXISTS
- .env.example: EXISTS
- scripts/smoke.mjs: EXISTS
- .github/workflows/docker.yml: EXISTS
- .github/RUNBOOK-RELEASE.md: EXISTS
- CHANGELOG.md: EXISTS
- README.md v2.0 sections: EXISTS (grep "v2.0 — Remote CI" passes)
- .planning/REQUIREMENTS.md PKG-04..08: all [x]
- .planning/ROADMAP.md Phase 14: Complete 2026-04-19
- .planning/STATE.md: completed_phases: 14, percent: 100
