# xci monorepo

This repository is a pnpm workspace containing three packages:

| Package | Path | Status |
|---------|------|--------|
| `xci` | `packages/xci/` | Cross-platform CLI for local command alias running (v1.0 shipped, ongoing). Published on npm as [`xci`](https://www.npmjs.com/package/xci). |
| `@xci/server` | `packages/server/` | Remote CI server (stub in Phase 6; real implementation in Phase 9+). |
| `@xci/web` | `packages/web/` | Web dashboard SPA (stub in Phase 6; real implementation in Phase 13+). |

## Quickstart

Install the published CLI globally:

```bash
npm i -g xci
xci --version
```

See the full CLI docs in [`packages/xci/README.md`](./packages/xci/README.md).

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

See [packages/server/README.md — Running in Docker](./packages/server/README.md#running-in-docker) for the full reference (env vars, ports, volumes, production notes).

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
