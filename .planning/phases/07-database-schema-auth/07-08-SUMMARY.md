---
phase: 07-database-schema-auth
plan: 08
subsystem: ci
tags: [ci, integration-tests, testcontainers, branch-protection]
dependency_graph:
  requires: [07-06, 07-07]
  provides: [CI integration-tests job, Linux-only Docker-backed test gate]
  affects: [.github/workflows/ci.yml, packages/server/package.json]
tech_stack:
  added: []
  patterns: [needs:, ubuntu-latest testcontainers, upload-artifact on failure]
key_files:
  created: []
  modified:
    - .github/workflows/ci.yml
    - packages/server/package.json
    - .planning/STATE.md
decisions:
  - packages/server test script narrowed to unit-only; integration only via explicit test:integration (D-23 Docker safety)
  - integration-tests job gates on needs:[build-test-lint] matrix; runs after all 6 OS×Node jobs pass
  - Branch-protection toggle is manual GitHub UI action — documented as pending todo in STATE.md
metrics:
  duration: ~5m
  completed: 2026-04-18
  tasks: 1
  files: 3
---

# Phase 07 Plan 08: CI Integration-Tests Job Summary

**One-liner:** Linux-only `integration-tests` CI job wired after 6-job matrix, calling `pnpm --filter @xci/server test:integration` on ubuntu-latest with Docker preinstalled (D-23).

## What Was Built

`.github/workflows/ci.yml` now has three jobs:

| Job | Runs-on | Needs | What it runs |
|-----|---------|-------|-------------|
| `build-test-lint` | 3 OS × Node [20, 22] matrix | — | `pnpm turbo run typecheck lint build test` |
| `fence-gates` | ubuntu-latest | — | ws-exclusion grep + hyperfine cold-start gate |
| `integration-tests` | ubuntu-latest | `[build-test-lint]` | `pnpm --filter @xci/server test:integration` |

The `integration-tests` job:
- Checks out → sets up pnpm (reads `packageManager` from root package.json) → Node 22 → `pnpm install --frozen-lockfile`
- Builds `@xci/server` → runs `test:integration`
- Uploads `packages/server/.vitest-output/` as `vitest-integration-results` artifact on failure (7-day retention)
- First run estimated ~30-45s (postgres:16-alpine pull + boot + full suite)

`packages/server/package.json` `test` script changed from:
```
"pnpm test:unit && pnpm test:integration"
```
to:
```
"pnpm test:unit"
```
This prevents `pnpm turbo run test` from invoking testcontainers on Windows/macOS matrix runners (which lack Docker).

## Deviations from Plan

None — plan executed exactly as written.

## Branch-Protection Manual Action (Pending)

The `integration-tests` job enforces AUTH-10 SC-4 (two-org isolation) only after it is added as a **required status check** on the `main` branch protection rule. This is a GitHub UI action that cannot be automated without a PAT with admin scope.

### Steps to complete (manual, GitHub UI)

**Prerequisites:** The CI run for the phase branch (or any PR containing Plans 07-01..07-08) must have completed successfully first — the `integration-tests` job must have a recorded run before GitHub allows selecting it as a required check.

1. Open: `https://github.com/<owner>/loci/settings/branches`
   (or: repo home → Settings → Branches)
2. Under "Branch protection rules", click the rule for `main` (create one if missing).
3. In **"Require status checks to pass before merging"** → **"Status checks that are required"**:
   - Confirm existing checks are selected:
     - `build-test-lint (ubuntu-latest, 20)`
     - `build-test-lint (ubuntu-latest, 22)`
     - `build-test-lint (windows-latest, 20)`
     - `build-test-lint (windows-latest, 22)`
     - `build-test-lint (macos-latest, 20)`
     - `build-test-lint (macos-latest, 22)`
     - `fence-gates`
   - **ADD:** `integration-tests`
4. Save the rule.

**Verification:** Branch protection settings show 8 required checks. On the next PR to `main`, the PR status box lists `integration-tests` as "Required".

**If deferred:** The STATE.md pending-todos already records this action. AUTH-10 SC-4 is not enforced as a merge gate until this step is completed. Phase 07 closes regardless.

## Verification Results

```
PASS: test script is unit-only
PASS: old combined test script removed
PASS: integration-tests job present
PASS: needs: [build-test-lint] present
PASS: test:integration command present
PASS: artifact upload step present
PASS: STATE.md updated
ci.yml: valid YAML
v1 fence (pnpm --filter xci test): 302 tests passed (13 files)
@xci/server test:unit: 60 tests passed (5 files)
```

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The new CI job runs in GitHub's sandbox with ephemeral Docker access. Artifact retention set to 7 days (T-07-08-03 accepted).

## Self-Check: PASSED

- `.github/workflows/ci.yml` modified — confirmed via grep and YAML parse
- `packages/server/package.json` modified — confirmed via grep
- `.planning/STATE.md` modified — confirmed via grep
- Commit `57be761` exists in git log
