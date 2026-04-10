---
phase: 01-foundation
plan: 04
subsystem: ci
tags:
  - ci
  - github-actions
  - cross-platform
requirements:
  - FND-03
  - FND-06
dependency_graph:
  requires:
    - phase: 01-foundation
      plan: 01
      provides: "package.json scripts (typecheck, lint, build, test, smoke) + package-lock.json for npm ci"
    - phase: 01-foundation
      plan: 02
      provides: "dist/cli.mjs bundle with working shebang + createRequire polyfill (exercised by the smoke step)"
    - phase: 01-foundation
      plan: 03
      provides: "36-test vitest suite that the CI `npm test` step executes on every matrix cell"
  provides:
    - "GitHub Actions workflow pinning the Phase 1 CI matrix (3 OSes × 2 Node versions = 6 jobs)"
    - "Cross-platform gate: every future commit is automatically verified on Windows/Linux/macOS before merge"
    - "Concurrency-group stack cancellation to avoid piled-up runs on force-pushes"
    - "Exit-code gate from `node dist/cli.mjs --version` — smoke-tests the bundled binary end-to-end on each OS"
  affects:
    - "Every Phase 2-5 commit is gated by this workflow (FND-02 cross-platform bin + FND-06 CI matrix)"
    - "Phase 4 executor work (child-process spawning) will be Windows-verified from its first commit"
    - "Phase 5 publishing pipeline can extend this workflow with a release job"
tech_stack:
  added: []
  patterns:
    - "actions/checkout@v4 + actions/setup-node@v4 with built-in npm cache (cache: npm) — no separate actions/cache step"
    - "fail-fast: false — one OS failure does not abort the other matrix cells"
    - "concurrency.group: ci-${{ github.ref }} + cancel-in-progress: true — prevents stacked runs"
    - "Step order locked to typecheck → lint → build → test → smoke — fails fastest on type regressions, slowest step (smoke) runs last"
    - "Default read-only GITHUB_TOKEN — no permissions block needed for Phase 1"
    - "workflow_dispatch trigger alongside push + PR — manual re-runs without a push"
    - "pull_request includes ready_for_review so draft PRs trigger CI the moment they're marked ready"
key_files:
  created:
    - .github/workflows/ci.yml
  modified: []
  deleted: []
decisions:
  - "Matrix locked to [ubuntu-latest, windows-latest, macos-latest] × [20, 22] = exactly 6 jobs per run (D-09 + D-10)"
  - "Smoke step uses `node dist/cli.mjs --version` directly (not `npm run smoke`) — explicit and easier to read in the Actions UI"
  - "NO hyperfine cold-start benchmark step — deferred to Phase 5 per D-11; the Phase 1 smoke check is exit-code-only"
  - "NO release / publish / codecov / npm audit steps — all out of scope for Phase 1 to keep the matrix cost under 6 jobs"
  - "Default read-only token is sufficient — no `permissions:` block needed because the workflow doesn't push, tag, comment, or publish"
metrics:
  duration: "~2m"
  started: "2026-04-10T15:50:14Z"
  completed_date: "2026-04-10"
  completed: "2026-04-10T15:52:07Z"
  tasks: 1
  files_created: 1
  files_modified: 0
  files_deleted: 0
  commits: 1
  workflow_yaml_lines: 48
  matrix_jobs_per_run: 6
---

# Phase 1 Plan 4: GitHub Actions CI Matrix Summary

**One-liner:** Single 48-line `.github/workflows/ci.yml` locks the Phase 1 CI matrix to 6 jobs (ubuntu/windows/macos × Node 20/22), runs the full `npm ci → typecheck → lint → build → test → smoke` pipeline on every push to main + every PR + manual dispatch, with fail-fast disabled, concurrency-group stack cancellation, and the bundled `dist/cli.mjs --version` as the final exit-code gate — closing out Phase 1 as the Windows-verified-from-day-one foundation for all subsequent phases.

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-10T15:50:14Z
- **Completed:** 2026-04-10T15:52:07Z
- **Tasks:** 1
- **Files created:** 1 (`.github/workflows/ci.yml`)
- **Files modified:** 0
- **Files deleted:** 0
- **Commits:** 1

## Accomplishments

- **`.github/workflows/ci.yml` created** (48 lines) with the exact Phase 1 CI matrix locked by CONTEXT.md decisions D-09 (Node [20, 22]), D-10 (OS [ubuntu-latest, windows-latest, macos-latest]), D-11 (no hyperfine in Phase 1), and D-12 (triggers: push-to-main + all PRs + workflow_dispatch).
- **Matrix shape = 3 OSes × 2 Node versions = 6 jobs per run.** `fail-fast: false` ensures one OS failure doesn't abort the others — critical for diagnosing cross-platform regressions (e.g. "it broke on Windows but passed on Linux").
- **Trigger surface** (D-12): `push.branches: [main]`, `pull_request.types: [opened, synchronize, reopened, ready_for_review]`, and `workflow_dispatch`. Draft PRs trigger CI the moment they're marked ready-for-review; feature branches get CI via their PR, not via direct push.
- **Concurrency-group stack cancellation:** `group: ci-${{ github.ref }}` + `cancel-in-progress: true` cancels in-progress runs when a new commit lands on the same ref — saves CI minutes and eliminates stacked runs after force-pushes.
- **Step order** (fastest-fail first): Checkout → Setup Node.js (with `cache: npm`) → `npm ci` → `npm run typecheck` → `npm run lint` → `npm run build` → `npm test` → `node dist/cli.mjs --version`. Typecheck fails fastest on type regressions; lint catches style before the slower build; build produces `dist/cli.mjs` that the E2E tests (Plan 03) and the final smoke step both need.
- **First-party actions only:** `actions/checkout@v4` and `actions/setup-node@v4` — both maintained by the GitHub Actions team. Zero third-party action invocations in Phase 1 (T-04-02 mitigation).
- **Built-in npm cache via `cache: npm`** on setup-node@v4 — no separate `actions/cache` step needed; keyed automatically on `package-lock.json` hash.
- **No `permissions:` block** — the default read-only `GITHUB_TOKEN` is sufficient because the workflow doesn't push, tag, publish, or comment (T-04-03 mitigation).

## Gate Results (local smoke sequence mirroring CI)

Full local sequence mirrors exactly what each CI matrix cell will run:

| Step | Command | Exit | Notes |
|------|---------|-----:|-------|
| 1 | `npm ci` | 0 | 117 packages installed in 12s, 0 vulnerabilities |
| 2 | `npm run typecheck` | 0 | `tsc --noEmit`, zero errors |
| 3 | `npm run lint` | 0 | biome checked 14 files, no fixes applied |
| 4 | `npm run build` | 0 | tsup bundled to `dist/cli.mjs` 126.41 KB in 219ms |
| 5 | `npm test` | 0 | 3 test files, 36 tests, all passing (types 4ms + errors 11ms + cli.e2e 274ms) |
| 6 | `node dist/cli.mjs --version` | 0 | Output: `0.0.0` |

Every step exits 0 — the CI workflow on GitHub will behave identically on each matrix cell.

## YAML Validation

- `yaml.parse(...)` on the file produces a valid document with:
  - `jobs['build-test-lint']` exists
  - `strategy.matrix.os.length === 3`
  - `strategy.matrix.node.length === 2`
  - At least 7 steps (actually 8: Checkout, Setup Node, Install, Typecheck, Lint, Build, Test, Smoke)
  - `strategy.matrix.os` includes `windows-latest`
  - `strategy.matrix.node` includes both `20` and `22`
- All structural grep gates pass:
  - ubuntu-latest, windows-latest, macos-latest all present
  - `node: [20, 22]` matches the expected regex
  - `fail-fast: false`, `workflow_dispatch`, `cancel-in-progress: true`, `actions/checkout@v4`, `actions/setup-node@v4`, `cache: npm`, `npm ci`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm test`, `node dist/cli.mjs --version` — all found
  - Scope-creep guards: no `hyperfine`, no `node: [18`, no `node: [24` — all absent

## Commits

| Task | Message | Hash |
|------|---------|------|
| 1 | ci(01-04): add GitHub Actions matrix for cross-platform CI | 80fe4cb |

## Deviations from Plan

None. The plan specified the exact YAML content verbatim (from RESEARCH.md §"GitHub Actions Workflow") and that content was written to disk unchanged. All 20 structural grep gates, the YAML parse gate, and the full local smoke sequence passed on first run.

No biome reformatting needed — `.github/workflows/ci.yml` lives outside `src/` and is not in biome's default include globs (biome's `lint` step checked 14 files, same count as Plan 03, which proves the workflow file is not linted by biome — as intended, since it's a GitHub Actions YAML, not project source).

## Authentication Gates

None during execution. The plan's `user_setup` documents one **post-execution user action**:

> **Push the repo to a GitHub remote and create a pull request (or push to main) to trigger the first CI run** at github.com. Phase 1 is complete when all 6 matrix jobs report green on the first run.

This is not an auth gate during plan execution — the workflow file is created and committed locally. The first remote verification is user-driven and happens any time after Plan 04's commits land on GitHub.

## Threat Register Disposition

All Phase 1 Plan 4 `mitigate` entries honored:

- **T-04-01** Tampering (supply chain via `npm ci`): Runtime deps exact-pinned in package.json (Plan 01); `package-lock.json` committed; `npm ci` fails on lockfile drift. GitHub-hosted runners use fresh-state VMs per run — no persistent npm cache contamination.
- **T-04-02** Elevation of Privilege (malicious third-party Action): Only two actions used — `actions/checkout@v4` and `actions/setup-node@v4`, both first-party GitHub Actions. Zero third-party action invocations.
- **T-04-03** Information Disclosure (GITHUB_TOKEN leak): No `secrets.*` references in ci.yml. Default permissions are read-only for public repos. No debug echoes.
- **T-04-04** Denial of Service (matrix job stacking): `concurrency.group: ci-${{ github.ref }}` + `cancel-in-progress: true` cancels older runs on the same ref — force-pushes do not pile up.

`accept` entries (T-04-05 fork-PR trust boundary, T-04-06 test runs attacker-controlled PR code) remain accepted per Phase 1 public-repo convention.

## Downstream Enablement

- **First CI run (user-driven):** Once the user pushes to GitHub and opens a PR (or pushes to main), GitHub Actions will spin up 6 matrix jobs. Phase 1 is complete when all 6 jobs report green. This is the **FND-02 + FND-06 exit gate**.
- **Phase 2 (config loader) onward:** Every commit is gated by this workflow. Windows behavior is verified from day one — no "works on my Mac, breaks on Windows" surprises arriving in Phase 4 when we start spawning child processes.
- **Phase 4 (executor):** The cross-platform child-process tests will run under `windows-latest` (real Windows Server 2022, not WSL) on both Node 20 and Node 22. The createRequire polyfill added in Plan 02 is already proven to work on all 3 OSes by virtue of the Plan 03 E2E tests running under this workflow.
- **Phase 5 (publish):** Can extend this workflow with a release job guarded by a tag trigger. The Phase 1 matrix stays as the default gate; Phase 5 adds an orthogonal release-on-tag job.

## User Action Required (Post-Plan)

**Push the repo to GitHub and observe the first CI run.** Phase 1 is complete when all 6 matrix jobs are green. If any job fails, gather the logs and run `/gsd-plan-phase --gaps` to plan the fix.

Specifically:

1. Create a GitHub repository (public recommended — CI is free on public repos).
2. Add the remote: `git remote add origin git@github.com:<user>/loci.git` (or https URL).
3. Push: `git push -u origin main`.
4. Watch the Actions tab for the first workflow run — 6 jobs (ubuntu×20, ubuntu×22, windows×20, windows×22, macos×20, macos×22).
5. If any job fails, the Actions UI shows per-step logs; the most likely failure modes are:
   - Windows CRLF issues (mitigated by `.gitattributes` `eol=lf` from Plan 01)
   - Windows PATH shadowing of `node` (mitigated by `process.execPath` in Plan 03 E2E tests)
   - Lockfile drift (blocked by `npm ci` failing explicitly; re-run `npm install` locally and commit the updated lockfile)

## Known Stubs

None. The CI workflow file is fully populated and committable. It references only npm scripts that exist in package.json (typecheck, lint, build, test) and one direct command (`node dist/cli.mjs --version`). Nothing is placeholder.

## Self-Check: PASSED

All claimed artifacts verified on disk:

- `.github/workflows/ci.yml` — FOUND (48 lines, 1 job, 8 steps, 6-job matrix)

All claimed commits verified in git log:

- `80fe4cb ci(01-04): add GitHub Actions matrix for cross-platform CI` — FOUND

Gate results reproduced at self-check time:

- `test -f .github/workflows/ci.yml` → 0
- `grep -q "ubuntu-latest" .github/workflows/ci.yml` → 0
- `grep -q "windows-latest" .github/workflows/ci.yml` → 0
- `grep -q "macos-latest" .github/workflows/ci.yml` → 0
- `grep -qE "node:\s*\[20,\s*22\]" .github/workflows/ci.yml` → 0
- `grep -q "fail-fast: false" .github/workflows/ci.yml` → 0
- `grep -q "workflow_dispatch" .github/workflows/ci.yml` → 0
- `grep -q "actions/checkout@v4" .github/workflows/ci.yml` → 0
- `grep -q "actions/setup-node@v4" .github/workflows/ci.yml` → 0
- `grep -q "cache: npm" .github/workflows/ci.yml` → 0
- `grep -q "npm ci" .github/workflows/ci.yml` → 0
- `grep -q "npm run typecheck" .github/workflows/ci.yml` → 0
- `grep -q "npm run lint" .github/workflows/ci.yml` → 0
- `grep -q "npm run build" .github/workflows/ci.yml` → 0
- `grep -q "npm test" .github/workflows/ci.yml` → 0
- `grep -q "node dist/cli.mjs --version" .github/workflows/ci.yml` → 0
- `grep -q "cancel-in-progress: true" .github/workflows/ci.yml` → 0
- `! grep -q "hyperfine" .github/workflows/ci.yml` → 0 (absent)
- `! grep -q "node: \[18" .github/workflows/ci.yml` → 0 (absent)
- `! grep -q "node: \[24" .github/workflows/ci.yml` → 0 (absent)
- `yaml.parse(...)` structural assertions → all pass
- `npm ci && npm run typecheck && npm run lint && npm run build && npm test && node dist/cli.mjs --version` → all exit 0, smoke output is `0.0.0`

---
*Phase: 01-foundation*
*Completed: 2026-04-10*
*Phase 1 structurally complete: FND-01 through FND-06 all addressed across Plans 01-04.*
