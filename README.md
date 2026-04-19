# xci monorepo

[![CI](https://github.com/ruggeri-andrea/loci/actions/workflows/ci.yml/badge.svg)](https://github.com/ruggeri-andrea/loci/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/xci)](https://www.npmjs.com/package/xci)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

This repository is a pnpm workspace containing three packages:

| Package | Path | Description |
|---------|------|-------------|
| `xci` | `packages/xci/` | Cross-platform CLI for local command alias running (v1.0 + v2.0 agent mode). Published on npm as [`xci`](https://www.npmjs.com/package/xci). |
| `@xci/server` | `packages/server/` | Remote CI server: multi-tenant auth, agent registration, task dispatch, log streaming, webhook plugins. |
| `@xci/web` | `packages/web/` | React 19 + Vite web dashboard SPA for the xci server. |

## Quickstart

**CLI only (v1 compatible — no server needed):**

```bash
npm i -g xci
xci --version
xci init          # scaffold .loci/ config in current project
xci <alias>       # run a defined command alias
```

See the full CLI docs in [`packages/xci/README.md`](./packages/xci/README.md).

## v2.0 — Remote CI

xci v2.0 adds a server-side mode: a persistent agent connects to `@xci/server`, receives task dispatches, streams logs back in real time, and reports run state to the web dashboard.

**What v2.0 adds:**
- **Agent mode:** `xci --agent <server-url> --token <reg-token>` registers your machine as a CI agent; subsequent restarts reconnect automatically.
- **Multi-tenant server:** organisations, signup/login/invite, role-based access (Owner / Member / Viewer).
- **Task DSL:** same YAML aliases you already use locally, defined server-side, triggered from the UI or webhooks.
- **Secrets management:** org-level secrets with envelope encryption (AES-256-GCM); agent-local `.xci/secrets.yml` wins at merge time.
- **Log streaming:** live log chunks streamed from agent → server → browser in real time; full Postgres persistence + daily retention cleanup.
- **Webhooks:** GitHub (`push`/`pull_request` with HMAC-SHA256) and Perforce (`change-commit`) trigger plugins; Dead Letter Queue in the UI.
- **Web dashboard:** agents, tasks, run history, live log viewer, org settings, plugin config, build-status badge endpoint.
- **Docker image:** `ghcr.io/<owner>/xci-server` — multi-stage, node:22-slim, non-root, migrations at boot.

**v1 CLI is fully preserved.** `xci` without `--agent` is observably identical to v1.0 (BC-01). Existing `.loci/` configs keep working with no migration.

## Docker Quick Start

Run the full server stack locally (Postgres 16 + MailHog + xci server):

```bash
cp .env.example .env
docker compose up -d --build
```

The server is ready when `docker compose ps` shows `server` status `healthy`.

- API / SPA: http://localhost:3000
- Health: http://localhost:3000/api/healthz
- MailHog (email inspector): http://localhost:8025

> **Note:** This is the development stack. For production, pull the published image (see below).

See [packages/server/README.md — Running in Docker](./packages/server/README.md#running-in-docker) for the full reference (env vars, ports, volumes, production notes).

## Production deployment

Pull the published image and run it with your own Postgres and SMTP service:

```bash
docker pull ghcr.io/<owner>/xci-server:v2.0.0   # pin to exact version in prod
```

**Required environment variables** (see [`.env.example`](./.env.example) for full reference):

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection URL (`postgres://user:pass@host:5432/db`) |
| `SESSION_COOKIE_SECRET` | Random 32+ byte string for session cookie signing |
| `XCI_MASTER_KEY` | 32-byte AES master encryption key, base64-encoded (`openssl rand -base64 32`) |
| `PLATFORM_ADMIN_EMAIL` | Email address of the platform administrator |
| `EMAIL_TRANSPORT` | `log` (dev), `smtp`, or `stub` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Required when `EMAIL_TRANSPORT=smtp` |

**Notes:**
- **Postgres:** supply an external managed Postgres 14+ instance. Migrations run automatically at boot (no `drizzle-kit` in the image).
- **TLS / reverse proxy:** the image listens on port 3000 without TLS. Terminate TLS at your ingress (nginx, Caddy, ALB, etc.) and proxy to port 3000.
- **MEK rotation:** rotate `XCI_MASTER_KEY` annually or after any suspected exposure. Use the `POST /api/admin/rotate-mek` endpoint; see [.github/RUNBOOK-RELEASE.md](./.github/RUNBOOK-RELEASE.md) for the security checklist.

## Upgrade path v1 → v2

No migration needed if you only used the `xci` CLI.

```bash
npm i -g xci@latest   # upgrades to 2.x; existing .loci/ configs keep working
xci --version         # prints 2.x.x
```

- All v1 commands, flags, and `.loci/` config format are unchanged (BC-01).
- Agent mode is opt-in via `xci --agent <url> --token <token>` — it does not affect local CLI invocations.
- `@xci/server` and `@xci/web` are new packages; install them only if you want to self-host the server.

## Working on the monorepo

Prerequisites: Node.js `>=20.5.0`, [Corepack](https://github.com/nodejs/corepack) enabled (ships with Node).

```bash
# Clone and install. Corepack picks up pnpm@10.33.0 from package.json packageManager field.
git clone <this-repo>
cd loci
corepack enable
pnpm install

# Run all tasks (typecheck, lint, build, test) across the workspace via Turbo:
pnpm typecheck
pnpm lint
pnpm build
pnpm test

# Or target a single package:
pnpm --filter xci test
pnpm --filter xci build
pnpm --filter xci size-limit
```

## Releasing

Versioning is coordinated by [Changesets](https://github.com/changesets/changesets) in fixed-versioning mode: `xci`, `@xci/server`, and `@xci/web` always release at the same version.

```bash
# Record a change:
pnpm changeset
# (answer the prompts, commit the generated file)

# On merge to main, the "Release" GitHub Actions workflow opens/updates a Version PR.
# Merging the Version PR publishes all three packages to npm.
```

## License

MIT — see [`LICENSE`](./LICENSE).
