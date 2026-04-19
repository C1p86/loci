---
phase: 14-docker-publishing
plan: "03"
subsystem: ci-release
tags: [ci, github-actions, ghcr, trivy, smoke-test, changesets, publish]
dependency_graph:
  requires: [14-01, 14-02]
  provides: [PKG-08, PKG-04-partial, PKG-07-partial]
  affects: [.github/workflows/docker.yml, .github/workflows/release.yml, scripts/smoke.mjs]
tech_stack:
  added: []
  patterns:
    - "Tag-triggered multi-job release pipeline (build→smoke→scan→push) in single job"
    - "Pre-release tag detection via semver -* suffix: push versioned tag only, no floating tags"
    - "Compose network re-use for smoke: manual docker run on loci_default network"
    - "Changesets action guarded by typecheck+lint+build+test+dry-run"
key_files:
  created:
    - scripts/smoke.mjs
    - .github/workflows/docker.yml
  modified:
    - .github/workflows/release.yml
    - packages/server/package.json
decisions:
  - "Single job (not multi-job) for docker.yml: eliminates artifact upload/download for smoke-candidate image; simpler and faster on ubuntu-latest"
  - "Trivy at aquasecurity/trivy-action@0.24.0 (pinned minor, not @master): predictable behavior"
  - "smoke.mjs uses Node 22 native fetch; zero npm deps — survives in CI without pnpm install step"
  - "usage.agents.limit type-checked (typeof === number) not value-checked: avoids hardcoding business logic in smoke"
  - "docker/build-push-action@v6 (latest stable at time of authoring)"
metrics:
  duration: "~12 minutes"
  completed: "2026-04-19T20:05:16Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 2
---

# Phase 14 Plan 03: CI Release Pipeline + Smoke Test + Trivy Scan Summary

**One-liner:** Tag-triggered GitHub Actions pipeline builds the Docker image, runs 13-step Node smoke test (signup→task→run→SPA), Trivy-scans for HIGH/CRITICAL CVEs, then pushes coordinated semver tags to ghcr.io; release.yml extended with typecheck+lint+build+test+dry-run gates before any npm publish.

## Tasks Completed

| # | Name | Commit | Key Files |
|---|------|--------|-----------|
| 1 | smoke.mjs + server smoke-test script | ff77bec | scripts/smoke.mjs, packages/server/package.json |
| 2 | docker.yml tag-triggered pipeline | 5438962 | .github/workflows/docker.yml |
| 3 | release.yml pre-publish validation | 00fd036 | .github/workflows/release.yml |

## Deliverables

### scripts/smoke.mjs
- 13-step ESM script (zero npm deps, Node 22 native fetch)
- Supports `SMOKE_BASE_URL` + `SMOKE_MAILHOG_URL` env vars (fallback to argv, then defaults)
- Steps: healthz poll → signup → mailhog token → verify-email → login → auth/me → csrf → registration-token → task create → run trigger → run state (queued/dispatched/running) → usage → SPA index
- Exits 0 on all pass, 1 with `[smoke:FAIL]` message on any failure
- Idempotent: random email + slug per run

### .github/workflows/docker.yml
- Trigger: `push.tags: ['v*.*.*']` + `workflow_dispatch`
- Single job `build-smoke-scan-push` (no cross-job artifact transfer)
- Image constraints check: size <400MB, UID=10001, no drizzle-kit in node_modules
- Smoke: starts postgres+mailhog via `docker compose up -d`, runs pre-built image on `loci_default` network, runs `node scripts/smoke.mjs`
- Trivy scan: `aquasecurity/trivy-action@0.24.0`, severity HIGH,CRITICAL, ignore-unfixed, exit-code 1
- Push: versioned tag always; `latest` + `vX.Y` + `vX` only for stable releases (D-17/D-22)
- Permissions: `contents: read`, `packages: write`, `id-token: write` (least-privilege per T-14-03-05)
- `concurrency.cancel-in-progress: false` — never cancel a release in flight

### .github/workflows/release.yml (extended)
- 5 new steps inserted between "Install dependencies" and "Create Release Pull Request or Publish":
  1. `pnpm turbo run typecheck`
  2. `pnpm turbo run lint`
  3. `pnpm turbo run build`
  4. `pnpm turbo run test`
  5. `pnpm -r publish --dry-run --access=public --no-git-checks`
- All existing steps, permissions, env block, and changesets/action `with:` inputs preserved

## Deviations from Plan

None — plan executed exactly as written. Minor implementation choices documented under decisions in frontmatter.

## User Setup Required (Pending)

| Item | Action | Location |
|------|--------|----------|
| NPM_TOKEN | Generate Automation token at npmjs.com scoped to `xci` + `@xci/*` | GitHub repo Settings → Secrets and variables → Actions |
| GHCR permissions | Verify Actions have `packages: write` (default ON for public repos) | GitHub repo Settings → Actions → General → Workflow permissions |

These are documented in 14-04 runbook (next plan).

## Known Stubs

None. smoke.mjs, docker.yml, and release.yml are fully wired. The smoke test's usage endpoint check verifies `typeof agents.limit === 'number'` rather than a hardcoded limit value — intentional to avoid encoding business logic in infrastructure tests.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced. Threat register T-14-03-01 through T-14-03-08 fully addressed in plan (see 14-03-PLAN.md threat_model section).

## Self-Check: PASSED

- scripts/smoke.mjs: FOUND
- .github/workflows/docker.yml: FOUND
- .github/workflows/release.yml: FOUND (extended)
- packages/server/package.json: FOUND (smoke-test script added)
- Commit ff77bec: FOUND
- Commit 5438962: FOUND
- Commit 00fd036: FOUND
