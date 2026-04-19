# Phase 14 Discussion Log

**Mode:** Auto-selected — 38 locked decisions for Docker image + docker-compose + smoke test + Changesets release flow.

Key calls:
- Multi-stage Dockerfile with node:22-slim base (glibc for argon2 prebuilts)
- pnpm deploy for pruned runtime node_modules
- Web dist bundled in same server image; served via @fastify/static conditional on WEB_STATIC_ROOT
- Non-root UID 10001, HTTP healthcheck, SIGTERM/SIGINT (Phase 7 server.ts already handles)
- docker-compose stack: server + postgres16 + mailhog for dev
- Changesets publish flow already wired (Phase 6 release.yml); Phase 14 extends with Docker image build + tag + smoke + publish
- Smoke test in CI: signup → create registration token → trigger task → log fetch (agent WS deferred to separate E2E)
- x86_64 only in v2.0; ARM64 deferred
- ghcr.io as registry (free for public GH repos)
- Trivy vuln scan on image
- First release is rc.1 dry-run
- 0 new migrations in Phase 14 (all schema done by Phase 13); only adds static serving to app.ts

See CONTEXT.md for detail.
