# xci Release Runbook

This runbook is for release operators — the human who decides to cut a release. Follow it **in order**. Assume a fresh clone of main.

## Prerequisites (one-time setup per operator)

- [ ] Write access to the `loci` repo
- [ ] You are able to merge PRs on main
- [ ] `NPM_TOKEN` is set as a repo secret (Settings → Secrets and variables → Actions)
- [ ] Repo Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests" is enabled
- [ ] Branch protection on main: `build-test-lint` (6 matrix jobs), `fence-gates`, `integration-tests`, `web-e2e` are Required Status Checks

## First release (v2.0.0) — mandatory dry-run via release candidate

The first release **must** ride through the full pipeline as a release candidate before the real v2.0.0 tag. This catches workflow bugs without affecting consumers who pin to `latest`.

1. [ ] On a branch `rc/v2.0.0-rc.1`, run `pnpm changeset` and describe the milestone in one line (e.g. `"Remote CI milestone: server + web + Docker"`). Commit and push.
2. [ ] Open PR for the branch. CI (build-test-lint, fence-gates, integration-tests, web-e2e) must be green before merge.
3. [ ] Merge PR to main.
4. [ ] Changesets action opens a **"Version Packages"** PR targeting main. Review the generated version bump — should be `2.0.0-rc.1` for `xci`, `@xci/server`, `@xci/web` (fixed versioning).
5. [ ] Merge the Version Packages PR (CI must be green).
6. [ ] Changesets action runs the real publish step and creates git tag `v2.0.0-rc.1`.
7. [ ] The new tag triggers `.github/workflows/docker.yml`:
   - Watch the workflow run at https://github.com/&lt;owner&gt;/loci/actions
   - Verify **smoke step** passes: log line `[smoke:PASS] all 13 steps green`
   - Verify **Trivy step** passes: no HIGH/CRITICAL findings (or all suppressed with justification)
   - Verify image pushed as `ghcr.io/<owner>/xci-server:v2.0.0-rc.1` (only versioned tag, not `latest`, for pre-release)
8. [ ] Verify npm pre-release publication:
   - `npm view xci version` → should show `2.0.0-rc.1` (with `--tag next` if configured in `.changeset/config.json`)
   - `npm view @xci/server version` → `2.0.0-rc.1`
   - `npm view @xci/web version` → `2.0.0-rc.1`
9. [ ] Test install on a throwaway machine or container:
   - `npm i -g xci@next` (or `xci@2.0.0-rc.1`) → `xci --version` prints `2.0.0-rc.1`
   - `docker pull ghcr.io/<owner>/xci-server:v2.0.0-rc.1 && docker run --rm ghcr.io/<owner>/xci-server:v2.0.0-rc.1 id -u` → prints `10001`
10. [ ] If any step failed, fix the issue and tag `v2.0.0-rc.2` — repeat from step 1.
11. [ ] Once `rc.N` is confirmed clean end-to-end, proceed with the **Subsequent release** flow below for `v2.0.0`.

## Subsequent release

1. [ ] Ensure main is green — visit https://github.com/&lt;owner&gt;/loci/actions and confirm CI badge passing.
2. [ ] Review pending changesets locally:
   ```bash
   pnpm changeset status
   ```
3. [ ] If no pending changeset for this release, run `pnpm changeset` to record the change.
4. [ ] Merge the Changesets **"Version Packages"** PR (opened automatically on every push to main that includes new `.changeset/*.md` files). CI must be green before merging.
5. [ ] Watch `.github/workflows/release.yml` — pre-publish validation runs (typecheck + lint + build + test + dry-run publish), then Changesets action publishes all three packages to npm.
6. [ ] Changesets creates tag `vX.Y.Z` on merge.
7. [ ] Tag push triggers `.github/workflows/docker.yml`:
   - Build → smoke → Trivy → push to ghcr.io with tags `latest`, `vX.Y.Z`, `vX.Y`, `vX`
   - Confirm all four tags appear in the ghcr.io package page
8. [ ] Post-release smoke (5-minute manual check):
   - [ ] `npm i -g xci@latest && xci --version` → new version string
   - [ ] `docker pull ghcr.io/<owner>/xci-server:latest` succeeds
   - [ ] `docker run --rm ghcr.io/<owner>/xci-server:latest node -e "console.log('ok')"` prints `ok`
9. [ ] Announce the release (channel / format is out of runbook scope; see your team's release template).

## If a release breaks

- **npm:** `npm deprecate <pkg>@<version> "broken; please upgrade to <X.Y.Z+1>"` (cannot unpublish after 72 h)
- **ghcr.io:** Delete the bad image tag from the ghcr.io package UI; consumers pinned to the bad tag should re-pin to the patched version.
- **Strategy:** Cut a patch release immediately — do not leave `latest` pointing at broken. Prefer forward-fix over rollback (Changesets is forward-only).
- **Rollback (server):** `docker pull ghcr.io/<owner>/xci-server:<prev-version>` and restart the service with the prior tag. Update your compose/deployment file to pin the prior version.

## Security checklist (each release)

- [ ] `NPM_TOKEN` has not leaked — GitHub automatically masks secrets in CI logs, but double-check the last 30 days of release job logs for any unexpected token prints.
- [ ] No new HIGH/CRITICAL Trivy findings were suppressed. Review the `--ignore-unfixed` bypass list if added; each entry needs a justification comment.
- [ ] MEK rotation cadence: document when the production MEK was last rotated. Rotate annually or after any suspected secret exposure. See production env docs for the rotation endpoint (`POST /api/admin/rotate-mek`).
- [ ] Confirm the published `xci` CLI cold-starts in under 300 ms (`hyperfine 'xci --version'`) — BC-04 non-negotiable.

## Links

- Dev stack: [`docker-compose.yml`](../docker-compose.yml)
- Dockerfile: [`packages/server/Dockerfile`](../packages/server/Dockerfile)
- Smoke script: [`scripts/smoke.mjs`](../scripts/smoke.mjs)
- Phase 14 context + decisions: [`.planning/phases/14-docker-publishing/14-CONTEXT.md`](../.planning/phases/14-docker-publishing/14-CONTEXT.md)
- Server package docs: [`packages/server/README.md`](../packages/server/README.md)
- Milestone closeout: [`.planning/phases/MILESTONE-v2.0-SUMMARY.md`](../.planning/phases/MILESTONE-v2.0-SUMMARY.md)
