# Phase 14: Docker & Publishing - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** auto-selected (user requested autonomous chain to milestone end)

<domain>
## Phase Boundary

Phase 14 is the MILESTONE CLOSER: packages the server + web as a Docker image, wires end-to-end smoke testing, and enables `npx changeset publish` for all 3 npm packages coordinated.

**Scope (PKG-04..08):**
- Multi-stage Dockerfile for `@xci/server` (base node:22-slim, NOT alpine — glibc needed for @node-rs/argon2 prebuilt binaries)
- Web SPA build artifacts (`packages/web/dist/`) bundled INTO the same server image — served via `@fastify/static`
- Non-root user, HTTP healthcheck, SIGTERM/SIGINT PID 1 handling
- Drizzle programmatic migrator at boot (NO drizzle-kit in prod image; devDep only)
- docker-compose.yml for local dev: server + postgres 16 + mailhog
- CI smoke-test: publish image to staging, pull, run migrations, execute signup → agent registration → task trigger → run → log fetch E2E, then tag release
- Changesets publish flow: `pnpm -r publish` coordinated across `xci`, `@xci/server`, `@xci/web` with fixed versioning (Phase 6 D-11)
- GitHub Actions workflow: tag-triggered release (tag → docker build → push to registry → smoke test → npm publish)

**NOT in scope:**
- Kubernetes manifests / Helm charts — out of scope v2.0 (docker-compose only)
- Multi-arch Docker builds (ARM64) — x86_64 only in v2.0; ARM deferred
- Observability stack (Prometheus/Grafana) — out of scope
- Log aggregation shipping (e.g., to Loki/CloudWatch) — only Pino stdout
- Multiple environment configs (dev/staging/prod) — single-env config via env vars
- Hot reload in Docker dev — use local pnpm dev
- Auto-update / rolling deploy logic — manual `docker pull` + restart

**Hard scope rule:** every requirement implemented here is PKG-04..08.

</domain>

<decisions>
## Implementation Decisions

### Dockerfile

- **D-01:** **Multi-stage Dockerfile** at `packages/server/Dockerfile`:
  - Stage 1 `builder`: node:22 (full; has build tools). Copies monorepo, runs `pnpm install --frozen-lockfile`, `turbo run build --filter=@xci/server --filter=@xci/web`. Outputs: `packages/server/dist/*`, `packages/server/drizzle/*` (migrations), `packages/web/dist/*`.
  - Stage 2 `runtime`: node:22-slim. COPY from builder: server dist + migrations + web dist + pruned `node_modules` (production only).
  - USER 10001:10001 (fixed non-root UID/GID; common choice).
  - WORKDIR /app
  - EXPOSE 3000
  - HEALTHCHECK: `CMD curl -f http://localhost:3000/healthz || exit 1` (interval=15s, timeout=5s, retries=3, start-period=20s)
  - CMD ["node", "dist/server.js"]

- **D-02:** **No drizzle-kit in runtime image** (PKG-07): `pnpm install --prod` in runtime stage OR copy only the specific required node_modules. The server uses `drizzle-orm/postgres-js/migrator` at boot, which is runtime-only — no CLI binary needed.

- **D-03:** **pnpm deploy for pruned node_modules** in builder stage: `pnpm deploy --filter=@xci/server --prod packages/server/deploy/`. Then COPY from builder `packages/server/deploy/node_modules` into runtime. This avoids bundling dev deps and keeps image lean.

- **D-04:** **Web static serving:** server registers `@fastify/static` in `app.ts` (NEW — conditional: only when `WEB_STATIC_ROOT` env var is set). Points at the bundled `packages/web/dist/` inside the image. Served at root `/`. API stays under `/api/*`, WS under `/ws/*`, badge under `/badge/*`. Router SHOULD 404-fallback ONLY on `/api/*` and `/ws/*`; other routes serve `index.html` (SPA fallback for client-side routing).

- **D-05:** **Env var contract in container:**
  - Required: `DATABASE_URL`, `SESSION_COOKIE_SECRET`, `EMAIL_TRANSPORT` (+ SMTP_* if transport=smtp), `XCI_MASTER_KEY`, `PLATFORM_ADMIN_EMAIL`
  - Optional: `PORT` (default 3000), `LOG_LEVEL` (default info), `WEB_STATIC_ROOT` (default `/app/web/dist` in the image), `LOG_RETENTION_INTERVAL_MS`
  - Server FAILS to boot on missing required (Phase 7 D-07 already enforces)

- **D-06:** **Signal handling (PKG-06):**
  - Server registers SIGTERM + SIGINT handlers that call `app.close()` → gracefully drain (close WS connections, flush log batcher, clear timers — already done in Phase 7/11)
  - Exit code 0 on graceful shutdown; 1 on forced exit
  - Dumb-init NOT used — node handles PID 1 signals correctly when process.on('SIGTERM') is wired
  - Already implemented in server.ts Phase 7; verify holds in Docker context

- **D-07:** **.dockerignore** in repo root: excludes `node_modules/`, `.planning/`, `*.md`, `.git/`, test files, `packages/xci/` (not needed in server image), web source (only dist needed after build).

### docker-compose.yml

- **D-08:** **`docker-compose.yml` at repo root** for local dev:
  - `postgres`: image `postgres:16`, port 5432, volume `pgdata`, password from env, healthcheck pg_isready
  - `mailhog`: image `mailhog/mailhog`, ports 1025 (SMTP) + 8025 (UI)
  - `server`: build: `packages/server`, depends_on postgres healthy, env vars pointing at postgres + mailhog, ports 3000, healthcheck curl /healthz
  - Default `XCI_MASTER_KEY` in `.env.example` (dev-only key with BIG WARNING; prod must override)
  - `docker compose up` brings entire stack online

- **D-09:** **`.env.example`** in repo root documents all env vars with dev defaults + safety comments for production.

### CI Smoke Test (PKG-08)

- **D-10:** **Tag-triggered release workflow** `.github/workflows/release.yml`:
  - Triggers on push of tag `v*.*.*` (Changesets action produces the tag)
  - Jobs:
    1. `build-image`: checkout, pnpm install, build docker image `xci/server:${GITHUB_REF_NAME}`
    2. `smoke-test`: runs after build-image; creates ephemeral Postgres + mailhog containers; starts the built image; runs a smoke script that: curl /healthz (wait until 200), POST /api/auth/signup, verify email via /api/auth/verify-email (token captured from mailhog UI API), POST /api/auth/login, create registration token, simulate agent register via WS (or skip — too complex for CI; alternative: just verify /api/orgs/:orgId/usage returns), trigger a simple task, assert run state reaches terminal within 30s, fetch /logs.log
    3. `publish-image`: pushes tagged image to GitHub Container Registry (ghcr.io/xci/server)
    4. `publish-npm`: runs `pnpm -r publish` with NPM_TOKEN (Changesets action actually owns this step via its own workflow — see D-11)
- **D-11:** **Changesets publish flow** in `.github/workflows/changesets.yml`:
  - Triggers on push to main
  - Uses `changesets/action@v1` with `publish: pnpm -r publish` and `NPM_TOKEN`
  - Opens/maintains "Version Packages" PR; when merged, action runs publish + creates git tag
  - Tag creation triggers the release.yml above
- **D-12:** **Smoke script** (`scripts/smoke-test.sh` or `packages/server/scripts/smoke.ts`): ~50-line node script using node:test or plain fetch. Fails fast with clear errors.

### Image Optimization

- **D-13:** **Target image size: <400MB** uncompressed. node:22-slim base is ~250MB; app + deps ~100-150MB. Measure in CI and alert if >500MB.
- **D-14:** **Layer caching:** builder stage installs deps BEFORE copying source (Docker layer caching reuses the install layer across builds when package.json unchanged).
- **D-15:** **Reproducible builds:** use `--frozen-lockfile` in pnpm install; specific pnpm version via corepack. Dockerfile uses digest-pinned base image if strict reproducibility needed (recommend: yes for production image; not required for local dev).

### Registry & Tagging

- **D-16:** **Registry:** ghcr.io (GitHub Container Registry) — free for public repos, integrated with GitHub Actions OIDC auth.
- **D-17:** **Tags:**
  - `xci/server:latest` (moves with each release)
  - `xci/server:v2.0.0` (semver exact)
  - `xci/server:v2.0` (minor)
  - `xci/server:v2` (major)
  - Tag `latest` is the floating pointer; users can pin to specific versions.
- **D-18:** **ARM64 build:** deferred. Docker Buildx multi-arch with `--platform linux/amd64` only in v2.0. ARM adds CI time and our primary test matrix is x86_64.

### npm Publishing

- **D-19:** **Pre-publish checks** in the release workflow:
  - `pnpm -r run build` (all 3 packages build)
  - `pnpm -r run test` (all tests pass)
  - `pnpm -r run typecheck`
  - `pnpm -r run lint`
  - Optional: `hyperfine` cold-start gate for xci
- **D-20:** **NPM_TOKEN** stored as GitHub secret (pending user setup per STATE pending todo — will be active before first publish).
- **D-21:** **Changesets fixed versioning** (Phase 6 D-11): all 3 packages release at the same version. Verified by existing `.changeset/config.json`.
- **D-22:** **First publish is manual** — run through the full release flow once on a prerelease tag (v2.0.0-rc.1 or similar) to verify all pieces before the real v2.0.0. Document this in the release runbook.

### Security

- **D-23:** **Distroless consideration: REJECTED.** node:22-slim is our base (not distroless). Rationale: @node-rs/argon2 prebuilt works on glibc; distroless debian-based works but adds complexity. Slim is sufficient.
- **D-24:** **Container scan:** add `trivy` or `grype` scan to CI; block release on HIGH/CRITICAL vulnerabilities in runtime dependencies. (Planner picks tool; trivy is simpler.)
- **D-25:** **Non-root user:** UID 10001 (uncommon, avoids collisions). All app files chown'd to this user in the Dockerfile COPY steps.
- **D-26:** **Read-only filesystem:** Dockerfile could add a `USER` + `VOLUME /tmp` for writable tmp; but Postgres data is external. Recommend: no read-only root FS in v2.0 (adds complexity for log writing, npm package cache). Compose can opt-in.

### Monorepo Build Coordination

- **D-27:** **Turbo integration for Docker build:** Dockerfile's builder stage runs `pnpm turbo run build --filter=@xci/server --filter=@xci/web`. Turbo cache used within build layer.
- **D-28:** **pnpm deploy** (D-03) produces a self-contained node_modules for the server package — critical for a lean runtime image.

### Testing the Docker Image

- **D-29:** **Unit/integration tests are NOT in the image.** They run in CI against the source tree. The image is production-only.
- **D-30:** **Smoke-test runs against the built image** (PKG-08) — not the source. This validates the image IS the source compiled correctly.

### Documentation

- **D-31:** **Repo root README.md** extended with:
  - Docker quick start: `docker compose up`
  - Production deployment guide: env vars, Postgres setup, SMTP, reverse proxy TLS, MEK rotation runbook link
  - npm install guide (3 packages)
  - Upgrade path from v1 → v2 (if any — v1 is CLI-only, v2 adds server; no migration needed)
- **D-32:** **`packages/server/README.md`** extended with Docker section.
- **D-33:** **CHANGELOG.md** generated via Changesets on each release.

### Release Runbook

- **D-34:** **`.github/RUNBOOK-RELEASE.md`** (NEW): operator checklist for first release:
  1. Verify all CI green on main
  2. Review pending changesets (`pnpm changeset status`)
  3. Merge "Version Packages" PR
  4. Watch release workflow
  5. Verify smoke test passed
  6. Verify image pushed to ghcr.io
  7. Verify npm packages published
  8. Announce release (manual)

### Backward Compat

- **D-35:** **v1 fence preserved through release:** `npm i -g xci@2.0.0` must install a working v2 CLI. v1 users keep their v1 CLI via `npm i -g xci@1` (npm keeps old versions). No breaking change to CLI behavior (new `--agent` mode is additive).

### Testing Strategy

- **D-36:** **Dockerfile builds locally and in CI** — tested by the image-build step.
- **D-37:** **Docker compose boots successfully** — tested by the smoke test step (stack up, healthcheck passes, basic flow works).
- **D-38:** **Release dry-run**: `pnpm changeset publish --dry-run` validates packages are publishable without actually pushing to npm. Include in CI.

### Claude's Discretion

- Exact base image digest pin (pick latest node:22-slim stable at release time)
- Whether to add a nginx reverse proxy for TLS termination (recommend: NO — deployers use their own ingress; doc this in README)
- Smoke test exact HTTP assertions (planner refines)
- Container scan tool (trivy recommended)
- Whether to sign container images with cosign (nice-to-have; defer to v2.1)

</decisions>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` §Packaging/Distribution (PKG-04..08) + §Backward Compatibility (BC-01..04)

### Roadmap
- `.planning/ROADMAP.md` §Phase 14 — 4 success criteria

### All Prior Phase Contexts
- Phase 6: Changesets fixed-versioning (D-11); `@xci/server` + `@xci/web` flip `private: false` (D-12) in Phases 7 + 13 — BOTH ALREADY FLIPPED before Phase 14
- Phase 7+: server app.close handles graceful shutdown
- Phase 13: web dist is the static bundle embedded into Docker image

### External Specs
- Docker Multi-stage builds (https://docs.docker.com/build/building/multi-stage/)
- pnpm deploy (https://pnpm.io/cli/deploy)
- Changesets (https://github.com/changesets/changesets)
- node:22-slim (debian bookworm slim)
- Trivy (https://trivy.dev)

</canonical_refs>

<code_context>
## Existing Code Insights
- `@xci/server` has `src/server.ts` with SIGTERM/SIGINT + `app.close()` (Phase 7)
- `@xci/web` has `dist/` after `pnpm --filter @xci/web build` (Phase 13) — 178KB gzip main + Monaco lazy chunk
- `packages/server/drizzle/` has 6 migration files (0001..0006) — copied into runtime image
- `.changeset/config.json` exists with fixed-versioning per Phase 6 D-11
- `.github/workflows/release.yml` exists from Phase 6 — Changesets publish already wired; Phase 14 EXTENDS with Docker build + smoke test

## Integration Points
- `packages/server/Dockerfile` — NEW
- `docker-compose.yml` at repo root — NEW
- `.dockerignore` at repo root — NEW
- `.env.example` at repo root — NEW
- `packages/server/src/app.ts` — extend with @fastify/static (conditional on WEB_STATIC_ROOT env)
- `scripts/smoke-test.sh` or `packages/server/scripts/smoke.ts` — NEW
- `.github/workflows/release.yml` — EXTEND with Docker build + smoke test jobs (or create `.github/workflows/docker.yml` as separate workflow triggered by tag)
- `README.md` at repo root — extend with Docker quick start + production deployment

</code_context>

<specifics>
- **Multi-stage is non-negotiable**: single-stage image would be 1GB+ (includes full node + pnpm + build tools). Multi-stage gets us to <400MB.
- **glibc-based base (slim vs alpine)**: @node-rs/argon2 ships prebuilt for glibc. Alpine (musl) would require building from source — 10x slower build.
- **pnpm deploy** (D-03) is the key to lean runtime: copies only the resolved transitive deps for @xci/server — no dev deps, no sibling workspace files.
- **Fastify-static conditional on WEB_STATIC_ROOT env**: allows the same server to run WITH or WITHOUT the web bundle. Docker image ships both; a future K8s sidecar setup could disable.
- **Smoke test in CI MUST be reliable** — flaky smoke test kills release confidence. Keep it minimal (signup → trigger → log fetch); defer agent WS to a follow-up e2e test if complexity is too high.
- **First release is a dry-run** (D-22) — do a v2.0.0-rc.1 tag and ride it through the full pipeline before the real v2.0.0. Catches workflow bugs without affecting consumers.

</specifics>

<deferred>
- Kubernetes / Helm manifests → v2.1+
- Multi-arch Docker (ARM64) → deferred
- Distroless base image → stay slim v2.0
- Sidecar containers (e.g., Prometheus exporter) → out of scope
- Reverse proxy / TLS termination in the image → deployer responsibility
- Auto-update mechanism → manual `docker pull` + restart
- Container image signing (cosign) → v2.1 candidate
- Helm values.yaml / K8s Operator → out of scope
- Hot-reload dev Dockerfile → use local pnpm dev instead
- SBOM generation → nice-to-have, defer

### Reviewed Todos (not folded)
None.

</deferred>

---

*Phase: 14-docker-publishing*
*Context gathered: 2026-04-19*
*Mode: auto-selected*
