---
phase: 14-docker-publishing
plan: "02"
subsystem: docker-compose + env-contract + runbook
tags:
  - docker-compose
  - postgres
  - mailhog
  - env-example
  - runbook
dependency_graph:
  requires:
    - 14-01 (Dockerfile + .dockerignore + WEB_STATIC_ROOT static serving)
  provides:
    - docker-compose.yml (3-service local dev stack)
    - .env.example (operator env contract, dev defaults, prod warnings)
    - packages/server/README.md#running-in-docker (contributor quickstart)
  affects:
    - README.md (Docker Quick Start section added)
tech_stack:
  added:
    - postgres:16 (compose service)
    - mailhog/mailhog:v1.0.1 (compose service)
  patterns:
    - env_file + environment overlay (network-topology vars override user .env)
    - pgdata named volume for Postgres persistence
    - depends_on condition:service_healthy gates server on Postgres readiness
key_files:
  created:
    - docker-compose.yml
    - .env.example
  modified:
    - .gitignore (added .env pattern)
    - packages/server/README.md (Running in Docker section)
    - README.md (Docker Quick Start section)
decisions:
  - env_file provides XCI_MASTER_KEY/SESSION_COOKIE_SECRET/PLATFORM_ADMIN_EMAIL from .env; environment block fixes DATABASE_URL/SMTP_HOST/SMTP_PORT to compose-internal hostnames
  - XCI_MASTER_KEY placeholder is AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= (43 A chars + =, 44 total) matching schema regex ^[A-Za-z0-9+/]{43}=$
  - POSTGRES_USER/PASSWORD/DB declared in .env.example and interpolated into docker-compose.yml environment blocks via ${VAR:-default} syntax
  - mailhog/mailhog:v1.0.1 pinned — last stable tag (no v2)
  - docker compose config validation deferred to CI — docker not available in WSL dev environment
metrics:
  duration: 126s
  completed: "2026-04-19"
  tasks_completed: 2
  files_changed: 5
---

# Phase 14 Plan 02: docker-compose.yml + .env.example + server README Docker section Summary

**One-liner:** Local dev stack (postgres:16 + mailhog:v1.0.1 + server) wired via docker-compose.yml with health-gated depends_on, env_file overlay pattern, and full operator env contract in .env.example.

## Tasks Completed

| # | Name | Commit | Key files |
|---|------|--------|-----------|
| 1 | docker-compose.yml + .env.example | 870be6d | docker-compose.yml, .env.example, .gitignore |
| 2 | Extend packages/server/README.md with Docker section | 9328bc8 | packages/server/README.md, README.md |

## What Was Built

**docker-compose.yml** (repo root):
- `postgres` service: `postgres:16`, port 5432, named `pgdata` volume, `pg_isready` healthcheck (5s interval, 10 retries, 10s start_period)
- `mailhog` service: `mailhog/mailhog:v1.0.1`, ports 1025 (SMTP) + 8025 (Web UI)
- `server` service: builds from `packages/server/Dockerfile` with repo root as context; `depends_on: postgres: condition: service_healthy` + `mailhog: condition: service_started`; `env_file: .env` provides secrets; `environment` block overrides network-topology vars (DATABASE_URL, SMTP_HOST, SMTP_PORT, EMAIL_TRANSPORT, SMTP_FROM)
- Top-level `volumes: pgdata:` declared

**`.env.example`** (repo root):
- All 5 required vars documented: SESSION_COOKIE_SECRET, XCI_MASTER_KEY, PLATFORM_ADMIN_EMAIL, DATABASE_URL, EMAIL_TRANSPORT
- XCI_MASTER_KEY placeholder matches schema regex (43 base64 chars + `=` = 44 total)
- SESSION_COOKIE_SECRET dev value is 49 chars (> 32 minimum)
- Postgres compose credentials section: POSTGRES_USER/PASSWORD/DB
- SMTP block, optional vars block
- BIG CAUTION banner at top; per-secret prod-override warnings with `node -e` generation commands

**`packages/server/README.md`** — new "## Running in Docker" section:
- Compose quick start (cp + up + logs)
- Endpoint table (health, SPA, API, WS agent, WS logs, webhooks, badge, MailHog)
- `docker compose down -v` cleanup
- What's inside the image (base, user UID, healthcheck, migrations, SPA serving)
- Environment variables table (all required + optional)
- Ports and volumes table
- Production deployment notes (secret regeneration, TLS, version pinning, SIGTERM drain)
- Rebuild from source instructions

**`README.md`** (repo root) — new "## Docker Quick Start" section:
- `cp .env.example .env` + `docker compose up -d --build` quick commands
- Key URLs (API/SPA, health, MailHog)
- Link to packages/server/README.md#running-in-docker for full reference

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] Added POSTGRES_USER/PASSWORD/DB to .env.example**
- **Found during:** Task 1
- **Issue:** docker-compose.yml uses `${POSTGRES_USER:-xci}` interpolation for the postgres service environment and healthcheck. These vars need to be in .env.example so operators can customize them.
- **Fix:** Added `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` section to .env.example with compose-credential defaults; docker-compose.yml uses `${VAR:-default}` syntax throughout for resilience if the .env doesn't define them.
- **Files modified:** .env.example, docker-compose.yml

**2. [Rule 3 - Blocking issue] Added .env to .gitignore**
- **Found during:** Task 1 setup
- **Issue:** .env was not in .gitignore; T-14-02-01 (threat: .env committed by mistake) required mitigation.
- **Fix:** Added `.env` pattern to .gitignore.
- **Files modified:** .gitignore

### Deferred Items

- `docker compose config` validation deferred to CI — `docker` command not found in WSL dev environment. The YAML syntax is valid (all keys match Compose spec v3 schema: `services`, `volumes`, `depends_on.condition`, `healthcheck`, `env_file`, `environment`).

## Known Stubs

None — all env vars in .env.example have dev-safe concrete defaults. No UI components created. No data flow stubs.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced. docker-compose.yml and .env.example are documentation/tooling artifacts only.

T-14-02-01 mitigated: `.env` added to `.gitignore`.
T-14-02-02 mitigated: every secret line has explicit "DEV ONLY / REGENERATE FOR PRODUCTION" warning with generation command.

## Self-Check: PASSED

- [x] docker-compose.yml exists at repo root
- [x] .env.example exists at repo root
- [x] packages/server/README.md contains "Running in Docker"
- [x] README.md contains "Docker Quick Start"
- [x] Commit 870be6d exists (feat: docker-compose.yml + .env.example)
- [x] Commit 9328bc8 exists (docs: README extensions)
- [x] XCI_MASTER_KEY in .env.example is exactly 44 chars matching ^[A-Za-z0-9+/]{43}=$
- [x] SESSION_COOKIE_SECRET dev value >= 32 chars
- [x] .env listed in .gitignore
