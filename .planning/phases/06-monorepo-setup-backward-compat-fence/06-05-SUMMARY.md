---
phase: 06-monorepo-setup-backward-compat-fence
plan: 05
subsystem: ci-release-workflows
tags: [ci, release, changesets, pnpm, turbo, fence-gates, hyperfine]
requires:
  - "packageManager field in root package.json (pnpm@10.33.0) - Plan 06-02"
  - "pnpm-workspace.yaml - Plan 06-02"
  - "turbo.json pipeline (typecheck, lint, build, test) - Plan 06-02"
  - "root package.json scripts.release = 'pnpm -r publish --access=public' - Plan 06-02"
  - ".changeset/config.json with fixed-versioning - Plan 06-02"
  - "packages/xci/tsup.config.ts with external: ['ws', 'reconnecting-websocket'] - Plan 06-04"
provides:
  - "Automated 6-job matrix CI (3 OS x Node [20, 22]) on every PR/push"
  - "Linux-only fence-gates job enforcing D-16b (grep) and D-17 (hyperfine)"
  - "Smoke check on all 6 matrix jobs (D-19) via node packages/xci/dist/cli.mjs --version"
  - "Release workflow wired for changesets/action@v1 with job-scoped permissions (Pitfall 4)"
  - "NPM_TOKEN + GITHUB_TOKEN env var contract for future publishes"
affects:
  - ".github/workflows/ci.yml (rewritten)"
  - ".github/workflows/release.yml (created)"
tech-stack:
  added:
    - "pnpm/action-setup@v4 (GitHub Action)"
    - "changesets/action@v1 (GitHub Action)"
    - "hyperfine 1.18.0 (Ubuntu 24.04 apt)"
  patterns:
    - "pnpm/action-setup BEFORE actions/setup-node (Pitfall 5 ordering)"
    - "Job-scoped permissions block (least privilege per Pitfall 4)"
    - "hyperfine --runs 10 --warmup 3 with JSON export + node assertion (Pitfall 3)"
key-files:
  created:
    - ".github/workflows/release.yml"
  modified:
    - ".github/workflows/ci.yml"
decisions:
  - "Size-limit gate (D-15) INTENTIONALLY OMITTED per user decision (real baseline 760KB, not 126KB)"
  - "Hyperfine installed via apt (5s install vs 60s cargo build)"
  - "Permissions scoped to job level, not workflow level (least privilege)"
  - "pnpm/action-setup invoked without explicit version input (reads packageManager field, keeps local/CI in lockstep)"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-18"
  tasks: 2
  files: 2
---

# Phase 6 Plan 5: CI workflow rewrite + release.yml Summary

Rewrote `.github/workflows/ci.yml` for pnpm+Turborepo monorepo and added `.github/workflows/release.yml` for Changesets-driven publishing. Four of the five planned CI gates (grep ws-exclusion, hyperfine cold-start, matrix test, smoke check) are now automated on every PR; the fifth (size-limit) is deferred per user decision.

## What Was Built

### `.github/workflows/ci.yml` (rewrite)

Diff from v1 shape:

| Aspect | Before (v1) | After (Phase 6) |
|---|---|---|
| Package manager setup | `cache: npm` on setup-node, `npm ci` | `pnpm/action-setup@v4` THEN `actions/setup-node@v4` with `cache: 'pnpm'`, `pnpm install --frozen-lockfile` |
| Build/test pipeline | 4 separate steps (`npm run typecheck`, `npm run lint`, `npm run build`, `npm test`) | Single `pnpm turbo run typecheck lint build test` |
| Smoke path | `node dist/cli.mjs --version` | `node packages/xci/dist/cli.mjs --version` (per D-05) |
| Matrix shape | 3 OS x Node [20, 22], fail-fast: false | Unchanged |
| Triggers & concurrency | push/PR/dispatch, `ci-${{ github.ref }}` cancel-in-progress | Unchanged |
| Fence-gates job | — (did not exist) | New Linux-only job: grep ws-exclusion (D-16b), hyperfine --runs 10 --warmup 3 with node -e assertion (<300ms mean), artifact upload on any outcome |

Jobs in final ci.yml: 2 logical (`build-test-lint` with 6-way matrix + `fence-gates` on ubuntu-latest only) = 7 total jobs in GitHub Actions UI.

### `.github/workflows/release.yml` (new)

- Triggers on `push: branches: [main]`
- Concurrency: `${{ github.workflow }}-${{ github.ref }}`
- Single `release` job on `ubuntu-latest`
- Job-scoped `permissions: { contents: write, pull-requests: write }` (Pitfall 4 — least-privilege, NOT workflow-level)
- Checkout with `fetch-depth: 0` (changesets needs full history for changelog)
- pnpm/action-setup@v4 before actions/setup-node@v4 (Pitfall 5)
- `pnpm install --frozen-lockfile` + `pnpm turbo run build` (fresh build before publish)
- `changesets/action@v1` with `version: pnpm changeset version` and `publish: pnpm release` (Pitfall 8 — version/publish are distinct lifecycle hooks)
- env: `GITHUB_TOKEN` (auto-provided) + `NPM_TOKEN` (must be added to repo secrets before first publish; expected — no changesets pending in Phase 6)

## Deviations from Plan

### Explicit user-directed deviations

**1. [User Decision — Scope Change] Size-limit gate (D-15) omitted from ci.yml**

- **Context:** Plan 06-05 prescribed a `pnpm --filter xci size-limit` step in the fence-gates job with a 200KB budget (derived from Phase 1 STATE.md baseline of 126.41KB).
- **Issue surfaced during execution:** The real bundle baseline after Phase 6 code migration measures ~760KB, roughly 6x the original 200KB budget. The original 126KB figure in Phase 1 notes reflected an earlier, much smaller codebase; the current bundle legitimately exceeds 200KB and no amount of ws-fence work will bring it under without major code restructuring.
- **User decision:** Ship Phase 6 CI fence gates WITHOUT a size-limit CI check. Defer the size-budget question to a future cycle (re-evaluate the number vs. actual bundle composition, potentially raise the threshold to a realistic value, then re-enable the gate).
- **What changed in ci.yml:**
  - No `pnpm --filter xci size-limit` step in the fence-gates job
  - The grep gate (D-16b), hyperfine gate (D-17), matrix test (D-18), and smoke check (D-19) are ALL still in place
- **What stays unchanged:**
  - `packages/xci/package.json` `size-limit` config field may remain (harmless — the script just isn't invoked in CI)
  - The 200KB number in 06-CONTEXT.md / 06-ROADMAP.md stays as-is (historical record); a future plan re-evaluates.
- **Files modified:** `.github/workflows/ci.yml` (fence-gates job has no size-limit step, has a comment explaining the omission)
- **Commit:** d6667cc
- **Impact on plan's acceptance criteria:** The plan's "fence-gates job contains `pnpm --filter xci size-limit`" criterion is NOT met by design. All other acceptance criteria pass.

### Auto-fixed issues

None. The two task files were produced and committed cleanly; the YAML parses; all non-size-limit acceptance greps exit 0.

## Verification Results

### ci.yml — positive checks (all PASS)

```
1 name: CI                                              OK
2 pnpm/action-setup@v4                                  OK
3 actions/setup-node@v4                                 OK
4 cache: 'pnpm'                                         OK
5 pnpm install --frozen-lockfile                        OK
6 pnpm turbo run typecheck lint build test              OK
7 node packages/xci/dist/cli.mjs --version              OK
8 fail-fast: false                                      OK
9 top-level concurrency: block                          OK
10 cancel-in-progress: true                             OK
11 matrix os [ubuntu, windows, macos]                   OK
12 matrix node: [20, 22]                                OK
13 fence-gates: job                                     OK
14 hyperfine --runs 10 --warmup 3                       OK
15 sudo apt-get install -y hyperfine                    OK
16 reconnecting-websocket (grep gate string)            OK
17 actions/upload-artifact@v4                           OK
```

### ci.yml — deviation check (expected)

```
size-limit step in fence-gates job: NOT PRESENT (only in an explanatory comment) — deviation applied as designed
```

### release.yml — positive checks (all PASS)

```
1 name: Release                                         OK
2 changesets/action@v1                                  OK
3 permissions: block (job-scoped)                       OK
4 contents: write                                       OK
5 pull-requests: write                                  OK
6 NPM_TOKEN env                                         OK
7 GITHUB_TOKEN env                                      OK
8 fetch-depth: 0                                        OK
9 pnpm release (publish: input)                         OK
10 pnpm changeset version (version: input)              OK
11 pnpm/action-setup@v4                                  OK
12 pnpm turbo run build step                            OK
13 root package.json scripts.release is pnpm -r publish --access=public  OK
```

### YAML validity

Both files parse cleanly via the `yaml` Node package (eemeli, YAML 1.2 semantics).

## Post-Merge Action Items

These are NOT part of this plan's scope but MUST happen before the release workflow is exercised for real:

1. **Add NPM_TOKEN to repo secrets** — required before any actual publish attempt. Phase 6's release workflow runs on every merge to main but short-circuits (no pending changesets), so missing NPM_TOKEN is harmless until Phase 14 authors a changeset.
2. **Configure branch protection on `main`** — mark `build-test-lint` (all 6 matrix legs) and `fence-gates` as REQUIRED status checks. Without this, a PR could merge without the fence passing.
3. **Enable "Allow GitHub Actions to create and approve pull requests"** — repo Settings > Actions > General > Workflow permissions. Required for changesets/action@v1 to open Version PRs.
4. **Re-evaluate size budget before enabling a size-limit gate** — the 200KB target in the original plan does not match the real bundle (~760KB). A future cycle should (a) measure bundle composition, (b) identify any unintentional growth vs. essential code, (c) set a realistic threshold, (d) re-introduce the CI gate.

## Known Stubs

None. Both workflows are fully-wired; no placeholder values or TODO markers.

## Threat Flags

None new. The threat register in 06-05-PLAN.md already covers:
- T-06-22 (supply-chain tampering — mitigated by frozen-lockfile + packageManager pin)
- T-06-23 (NPM_TOKEN info disclosure — mitigated via `${{ secrets.NPM_TOKEN }}` only, never logged)
- T-06-24 (elevation of privilege — mitigated by explicit job-scoped permissions)
- T-06-25 (hyperfine flake — accepted risk; artifact uploaded for post-mortem)
- T-06-26 (spoofed PR disabling fence — mitigated by review + branch protection action item)
- T-06-27 (accidental stub publish — mitigated by `"private": true` on stub packages)

## Commits

| Hash | Message |
|---|---|
| d6667cc | ci(06-05): rewrite ci.yml for pnpm+turbo with fence-gates job |
| 56ed8ea | ci(06-05): add release.yml for changesets publish flow |

## Next Plan

Per plan's `<output>` section, the next plan is `06-06` — verify the fence end-to-end with a fresh build + full test run locally. The CI workflows created here will exercise the same fence on GitHub's runners on the first PR.

## Self-Check: PASSED

- `.github/workflows/ci.yml` exists
- `.github/workflows/release.yml` exists
- `.planning/phases/06-monorepo-setup-backward-compat-fence/06-05-SUMMARY.md` exists
- Commit d6667cc (ci.yml rewrite) present in git log
- Commit 56ed8ea (release.yml creation) present in git log
- Both workflow files parse as valid YAML (eemeli yaml 2.x, YAML 1.2 semantics)
- All 17 ci.yml positive acceptance greps return exit 0
- All 13 release.yml positive acceptance greps return exit 0
- size-limit omission (user-directed deviation) confirmed — only present in explanatory comment, no step
