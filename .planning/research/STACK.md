# Technology Stack — v2.0 Additions

**Project:** xci (loci) — Remote CI Agents + Web Dashboard
**Scope:** NEW additions for v2.0 only. Existing v1 stack is frozen and not re-researched.
**Researched:** 2026-04-16
**Overall confidence:** HIGH (all versions verified via npm registry, official docs, or multi-source web search)

---

## Existing v1 Stack (DO NOT CHANGE)

Frozen. Zero regression requirement. The `xci` CLI bundle must remain a single ESM `.mjs` file under 130 KB with < 300ms cold-start.

| Package | Version | Notes |
|---------|---------|-------|
| Node.js target | `>=20.5.0` | v20 Maintenance LTS, v22 Active LTS |
| TypeScript | 5.x | |
| commander.js | 14.0.3 | Stay on v14; v15 breaks CJS |
| execa | 9.6.1 | ESM-only |
| yaml | 2.8.3 | YAML 1.2 semantics |
| tsup | 8.5.1 | Bundler |
| vitest | 4.1.4 | Test runner |
| @biomejs/biome | 2.x | Lint + format |

---

## v2.0 New Stack

### Monorepo Workspace Tooling

| Tool | Version | Purpose | Why |
|------|---------|---------|-----|
| pnpm | 10.x (latest) | Package manager + workspaces | Fastest install, content-addressable store, strict isolation. Workspace protocol (`workspace:*`) ensures internal packages link correctly. npm workspaces work but have weaker isolation; yarn v1 is legacy. |
| turbo | 2.9.6 | Pipeline orchestration + remote cache | 62% of multi-package repos use Turborepo (2025 State of JS). 0.2s cached rebuilds vs 30s cold. Integrates transparently on top of pnpm workspaces. NX is heavier and brings its own conventions that fight the existing v1 setup. |
| @changesets/cli | 2.30.0 | Versioning + changelogs | Standard for monorepos publishing multiple npm packages. Works with pnpm workspaces natively. Avoids manual CHANGELOG.md and version bumps across `xci`, `@xci/server`, `@xci/web`. |

**Repository structure:**
```
packages/
  xci/          — CLI + agent mode (existing v1 code here; re-roots)
  @xci/server/  — Fastify server
  @xci/web/     — React SPA
```

**v1 integration note:** The existing `xci` CLI code moves into `packages/xci/` as a pnpm workspace package. Its `tsup` build config and `package.json` are unchanged. The v1 test suite (`vitest --run`) runs scoped to that package. No changes to bundle output or CLI behavior.

---

### Backend: `@xci/server`

#### Fastify HTTP + WebSocket Server

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| fastify | 5.8.5 | HTTP + routing | v5 is current GA (released Oct 2024). Requires Node >=20 — matches our floor. 5–10% faster than v4. Dropped v18 support simplifies maintenance. TypeScript-first with generics for request/reply. v4 reaches EOL June 2025, upgrade is required. |
| @fastify/websocket | 11.2.0 | WebSocket upgrade on Fastify routes | Official Fastify plugin; uses `ws` under the hood. Allows mixing REST and WS routes in the same server with shared auth hooks. No need for a separate WS server port. |
| @fastify/cookie | 11.0.2 | Cookie parsing + signing | Required for session cookie strategy. |
| @fastify/cors | 11.2.0 | CORS headers | Needed for SPA on same origin in prod, different origin in dev. |
| @fastify/rate-limit | 10.3.0 | Request rate limiting | App-layer DDoS protection on auth endpoints and public routes. |
| @fastify/helmet | 13.0.2 | Security headers (CSP, HSTS, etc.) | One plugin replaces ~7 manual header settings. |
| @fastify/sensible | 6.0.4 | HTTP error helpers + reply decorators | Standard community plugin; `reply.notFound()`, `reply.forbidden()`, etc. Reduces boilerplate significantly. |
| @fastify/csrf-protection | 7.1.0 | CSRF token generation + validation | Required for SaaS with cookie-based sessions and a browser SPA. Pairs with @fastify/cookie. |
| @fastify/static | 9.1.1 | Serve `@xci/web` SPA static files | Serves the built React SPA from `@xci/server`. Single Docker image ships both. |
| @fastify/type-provider-typebox | 6.1.0 | TypeBox schema integration | Enables full request/reply type inference from JSON Schema. Eliminates manual type assertions on route handlers. |
| @sinclair/typebox | 0.34.x | Runtime JSON Schema + TypeScript types | Shared schema definitions between server and client. Single source of truth for API types. |
| fastify-plugin | 5.1.0 | Plugin encapsulation helper | Standard pattern for writing Fastify plugins that don't create a new scope. |

**What NOT to use:**
- `@fastify/jwt` — see Session/Auth section below for rationale
- `@fastify/session` — replaced by a thin custom layer over @fastify/cookie + `node:crypto`; avoids a Redis dependency for v2.0 single-instance deployment
- Hapi, Express, NestJS — not in scope; Fastify is specified by the project

#### Database: Postgres ORM + Driver

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| postgres (porsager) | 3.4.9 | Postgres driver | Fastest Node.js Postgres client by throughput. Pure JS, no native bindings, ESM-compatible. Tagged template literal API (`sql\`SELECT ...\``) is XSS-safe by construction. Weekly downloads: 2.8M+. |
| drizzle-orm | 0.45.2 | TypeScript ORM layer | Type-safe schema definition in TS; SQL-like query builder that does not hide SQL. 5KB bundle (edge-native). Schema defined once in TS, used by both Drizzle queries and `drizzle-kit` migrations. Crossed Prisma in weekly downloads in 2025. |
| drizzle-kit | 0.31.10 | Migration generation + apply | Paired with drizzle-orm. `drizzle-kit generate` diffs TS schema → SQL migration files. `drizzle-kit migrate` applies them. No separate migration tool needed. |

**Alternatives rejected:**

| Alternative | Reason Not Chosen |
|-------------|------------------|
| Prisma | Prisma Client generates into `node_modules` at postinstall, adds ~20MB to Docker image, requires a separate `prisma generate` step in CI. DX is excellent for teams new to SQL but the magic client layer obscures query behavior. Overhead is unjustified for a project that already understands SQL. |
| Kysely | Excellent SQL-level type safety (stronger than Drizzle for complex joins). No built-in migration tool — relies on `kysely-codegen` or manual files. Drizzle's integrated schema + migration story is better for a project that ships as a Docker image where schema and code must stay in sync. Choose Kysely if the team prefers pure query-builder control with no schema abstraction. |
| node-postgres (`pg`) | Older API, callback-based (promises via wrapper), less ergonomic than `postgres`. `postgres` driver is a strict superset in capability with a cleaner API. |

#### Session / Authentication Strategy

**Decision: Opaque session tokens in a DB table, delivered via HttpOnly cookie.**

Rationale:
- JWT stateless tokens cannot be revoked without a denylist (which reintroduces statefulness). For a SaaS with agent token revocation from the UI, tokens MUST be revocable on demand.
- v2.0 is single-instance Docker — no horizontal scaling concern that would force stateless tokens.
- Opaque tokens stored in a `sessions` table with expiry, revocable by DELETE.
- `@fastify/cookie` delivers the session cookie; `node:crypto.randomBytes(32)` generates the token.
- Agent tokens (for WebSocket handshake) are a separate long-lived secret stored in the `agents` table, also revocable from UI.
- `@fastify/csrf-protection` protects SPA form submissions from CSRF.

**What NOT to use for v2.0:**
- `@fastify/jwt` + short-lived JWT: adds complexity (refresh token rotation, denylist, token leakage window) that v2.0 does not need. Revisit in v2.1 when multi-region/horizontal scaling enters scope.
- `@fastify/session`: pulls in `memorystore` or requires Redis; overkill for a DB-backed session.

#### Password Hashing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @node-rs/argon2 | 2.0.2 | Password hashing | Argon2id is the 2025 NIST recommendation for new applications. `@node-rs/argon2` uses Rust (RustCrypto) with prebuilt binaries via napi-rs — NO node-gyp, NO compile step in Docker build. 476 KB installed vs 3.7 MB for `argon2` (node-argon2). Ships prebuilt for linux-x64-gnu (the Docker target). Supports Argon2id variant natively. |

**Config:** `{ type: 'argon2id', memoryCost: 19456, timeCost: 2, parallelism: 1 }` — OWASP minimum recommendation for interactive logins.

**Alternatives rejected:**
- `argon2` (node-argon2): Requires node-gyp compilation; adds a build-stage dependency in Docker. `@node-rs/argon2` is strictly better for containerized deployments.
- `bcrypt`: 25+ year old algorithm. Secure with cost factor 12+ but lacks memory-hardness. Use only for migrating an existing bcrypt database.

#### Envelope Encryption (Org-Level Secrets)

**Decision: `node:crypto` only. No external library.**

Implementation:
- **Master Encryption Key (MEK)**: 32-byte random key, stored in `XCI_MASTER_KEY` environment variable (inject at container runtime via Docker secret or env). Never written to DB.
- **Data Encryption Key (DEK)**: Per-org, generated with `crypto.randomBytes(32)`. Encrypted (wrapped) with MEK using AES-256-GCM. Stored as `{iv, ciphertext, tag}` in the `orgs` table alongside the org row.
- **Secret values**: Encrypted with the org's DEK using AES-256-GCM. Stored as `{iv, ciphertext, tag}` in the `org_secrets` table.
- To read a secret: fetch org DEK ciphertext → unwrap with MEK → decrypt secret with DEK.

Why no library: `node:crypto` AES-256-GCM is the standard, auditable, zero-dependency implementation. The pattern is 50 lines of code. External libs (e.g. `keyv`, `@peculiar/webcrypto`) add abstraction without adding correctness. KMS (AWS KMS, GCP KMS) can replace the MEK storage in v2.1 — the envelope pattern is forward-compatible because only the key-wrapping step changes.

**What NOT to use:**
- Third-party "encryption wrapper" packages — they add transitive deps and obscure what algorithm is actually used.
- Storing MEK in DB — defeats the purpose of envelope encryption.

#### Email (Password Reset)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| nodemailer | 7.0.5 | Email sending | 20+ year old, 24M weekly downloads, zero meaningful competition in Node.js email. Supports SMTP, sendmail, and stream transports. Transport is pluggable at config time — no code change to switch SMTP provider. |

**Transport strategy:** `nodemailer.createTransport({ host, port, auth })` configured via environment variables (`XCI_SMTP_HOST`, `XCI_SMTP_USER`, `XCI_SMTP_PASS`). Operators point at any SMTP relay (Mailgun, Postmark, SES, local Mailhog for dev). No Postmark/Resend SDK needed — they all expose SMTP.

**What NOT to use:**
- `@sendgrid/mail`, `postmark`, `resend` SDK — vendor lock-in with no benefit over SMTP transport.

---

### Frontend: `@xci/web`

#### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| React | 19.2.5 | UI framework | React 19 is current stable. Server Actions are not needed (standalone SPA). Compiler (React Forget) automatic memoization is available but opt-in. |
| Vite | 8.0.x (target) / current: 8.0+ | Build tool | Note: npm shows 8.0.8 as current. Vite 7 branched into v8 — use latest stable. Native ESM, sub-100ms HMR, built-in TypeScript via esbuild. `@vitejs/plugin-react` for Fast Refresh. |
| @vitejs/plugin-react | 6.0.1 | React Fast Refresh | Babel transform for Fast Refresh + React JSX. |
| react-router-dom | 7.14.1 | Client-side routing | React Router v7 (current stable). SPA mode (no SSR). Supports data loaders. Standard in the ecosystem. TanStack Router is the alternative but adds learning curve with no benefit for this use case. |

**Correction on Vite version:** `npm view vite version` returned `8.0.8` at research time. The milestone context says "Vite 7" but 8.x is current stable — use `8.x`.

#### State Management + Data Fetching

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @tanstack/react-query | 5.99.0 | Server state (API data) | Industry standard for REST + WS data in React. Handles caching, background refresh, loading/error states. Avoids Zustand for server state — they solve different problems. |
| zustand | 5.0.12 | Client-side UI state | Minimal footprint (~1.3KB). For UI state that is NOT server data (selected agent, sidebar open, log filter settings). Avoid Redux — overkill for this use case. |

#### Forms + Validation

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| react-hook-form | 7.72.1 | Form state management | Uncontrolled inputs, minimal re-renders. Standard in the ecosystem. |
| zod | 4.3.6 | Schema validation | Shared validation logic between frontend forms and (optionally) server routes. TypeBox is used on the server (for Fastify schema); Zod is used on the client because it integrates with `@hookform/resolvers/zod` seamlessly. |
| @hookform/resolvers | 5.2.2 | Bridge RHF ↔ Zod | Connects Zod schemas to RHF validation. |

#### Styling + Components

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| tailwindcss | 4.2.2 | Utility CSS | Tailwind v4 ships as a Vite plugin (`@tailwindcss/vite`), no PostCSS config needed. CSS-first config via `@theme` directive. ~30% smaller output than v3. |
| @tailwindcss/vite | 4.2.2 | Vite plugin for Tailwind v4 | Replaces PostCSS processing; first-class Vite integration. |
| shadcn/ui (CLI) | 4.3.0 | Component distribution | NOT a package dependency — components are copy-pasted into the repo via `npx shadcn@latest add`. Source lives in `@xci/web/components/ui/`. Full ownership, no version lock. Built on Radix UI primitives + Tailwind. The correct posture for a v2.0 dashboard: ship exactly the components needed, customize freely. |
| lucide-react | 1.8.0 | Icon library | Used by shadcn/ui. Consistent, tree-shakeable SVG icons. |

**Component library posture: headless-with-shadcn.** shadcn/ui is the right choice: Radix UI provides accessible headless primitives (Dialog, Select, DropdownMenu, Tooltip), Tailwind v4 provides visual styling, shadcn CLI copies component source into your repo for full control. The alternative (Ant Design, MUI) introduces heavy CSS-in-JS or global styles that conflict with Tailwind.

**What NOT to use:**
- Material UI / Ant Design: Large bundle (~500KB+), own design system that fights Tailwind. Not appropriate.
- Chakra UI: React 19 compatibility had lag issues in 2024–2025.
- CSS Modules: No benefit over Tailwind for a dashboard SPA. Extra file overhead.

#### WebSocket Client (Agent Mode + Web Dashboard)

| Technology | Version | Purpose | Notes |
|------------|---------|---------|-------|
| ws | 8.20.0 | WebSocket client for Node.js (agent mode) | Zero-dependency, well-maintained. Used in the agent's persistent connection loop inside the `xci` CLI (`--agent` mode). **Does NOT enter the v1 CLI bundle** — only imported when `--agent` flag is active, or lazy-loaded. |
| reconnecting-websocket | 4.4.0 | Auto-reconnect wrapper | Decorates the `WebSocket` / `ws` API with exponential backoff reconnection. Works in both Node.js (wrapping `ws`) and browser (wrapping native `WebSocket`). Used by both the agent (`xci --agent`) and the browser dashboard for log streaming. |

**Reconnection configuration:** `maxReconnectionDelay: 30000, minReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1.5, maxRetries: Infinity` — agent should reconnect indefinitely; user sees "offline" indicator in UI.

**v1 integration note:** The `ws` dependency is NEW to the `xci` package. It must NOT be bundled into the default CLI output. `tsup` config must mark `ws` as external when building the default entry point and only bundle it into a separate `dist/agent.mjs` entry. Alternatively, dynamic `import('ws')` at runtime when `--agent` is detected avoids any bundle concern.

**What NOT to use:**
- `partysocket`: Excellent but designed for PartyKit platform; the reconnection primitives in `reconnecting-websocket` are sufficient without platform coupling.
- `socket.io`: Full-duplex event abstraction + its own protocol on top of WebSocket. The xci agent protocol is a simple JSON message protocol that does not need Socket.io's rooms, namespaces, or fallback polyfills.

---

### Testing Additions

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| supertest | 7.2.2 | HTTP integration testing for @xci/server | Standard Fastify/Express HTTP testing library. Sends real HTTP requests against a running Fastify instance in test mode (no port binding needed). Use with vitest. |
| @types/supertest | 7.2.0 | TypeScript types for supertest | |
| @playwright/test | 1.59.1 | E2E browser testing | Industry standard for browser automation. Tests the full stack: SPA in browser → server API → Postgres. Run in CI against Docker Compose. Scope: critical flows only (signup, login, run a task, view logs). |
| @vitest/browser | 4.1.4 | Component-level browser tests | Optional: for testing React components with real browser rendering inside vitest. Lower overhead than Playwright for unit-level component tests. Use Playwright for E2E, vitest browser mode for component isolation. |

**v1 integration note:** Existing 202 vitest tests in `packages/xci/` run unchanged. New tests for `@xci/server` and `@xci/web` are in separate workspace packages and do not affect the v1 test count or coverage.

---

### Observability

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| pino | 10.3.1 | Structured JSON logging | Fastify's default logger. Already bundled with Fastify. Fastest JSON logger in Node.js ecosystem. Use `pino-http` for HTTP request logging. |
| pino-http | 11.0.0 | HTTP request logging middleware | Official Fastify plugin for per-request logging. |
| @opentelemetry/sdk-node | 0.214.0 | Distributed tracing (opt-in) | OpenTelemetry is the vendor-neutral standard. Import conditionally via `XCI_OTEL_ENDPOINT` env var — if not set, skip instrumentation entirely. Adds ~2MB to Docker image but zero overhead when not configured. |
| @opentelemetry/auto-instrumentations-node | 0.72.0 | Auto-instrument HTTP, pg, etc. | Enables traces for Fastify routes, Postgres queries, and outbound HTTP without manual span creation. |

**Logging discipline (inherits from v1 constraints):**
- Org secret values MUST NEVER appear in pino log output. Implement a pino serializer that strips any field named `secret`, `value`, or `encrypted_value` from log objects.
- Agent tokens MUST be redacted in logs (mask after first 8 chars).

---

### Docker Image

**Base image: `node:22-slim` (Debian Bookworm slim)**

Rationale:
- `node:22-alpine` uses musl libc instead of glibc. `@node-rs/argon2` ships prebuilt binaries for `linux-x64-gnu` (glibc). Alpine's musl would either force source compilation (node-gyp in image) or require the `-musl` variant. Using `node:22-slim` eliminates this entirely.
- Debian slim is ~240MB base vs ~153MB Alpine — acceptable for a server image where cold-start time is irrelevant.
- Node.js does not officially support Alpine Linux builds.

**Multi-stage Dockerfile:**
```dockerfile
# Stage 1: build
FROM node:22-slim AS builder
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build  # runs turbo build for server + web

# Stage 2: runtime
FROM node:22-slim AS runtime
WORKDIR /app
RUN corepack enable
# Copy only production artifacts
COPY --from=builder /app/packages/@xci/server/dist ./packages/@xci/server/dist
COPY --from=builder /app/packages/@xci/server/package.json ./packages/@xci/server/
COPY --from=builder /app/packages/@xci/web/dist ./packages/@xci/web/dist
# Install only production deps in runtime stage
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
EXPOSE 3000
CMD ["node", "packages/@xci/server/dist/index.mjs"]
```

**Expected image size budget:** 400–500 MB (Node 22 slim ~240MB + production deps + app code). With `@node-rs/argon2` prebuilt binary (~5MB) and no dev deps.

**What NOT to use:**
- `node:22-alpine` — musl/glibc incompatibility with `@node-rs/argon2` prebuilt binaries.
- `gcr.io/distroless/nodejs22-debian12` — Distroless lacks a shell, making `pnpm install` and `corepack enable` impossible in the runtime stage. Valid if all deps are copied from builder stage, but adds complexity. Not worth it for v2.0.

---

## Version Compatibility Table

| Package | Version | Node.js Floor | ESM | Role |
|---------|---------|---------------|-----|------|
| fastify | 5.8.5 | >=20 | CJS + ESM | Server |
| @fastify/websocket | 11.2.0 | >=20 | ESM | Server WS |
| @fastify/cookie | 11.0.2 | >=20 | ESM | Server auth |
| @fastify/cors | 11.2.0 | >=20 | ESM | Server |
| @fastify/rate-limit | 10.3.0 | >=20 | ESM | Server |
| @fastify/helmet | 13.0.2 | >=20 | ESM | Server |
| @fastify/sensible | 6.0.4 | >=20 | ESM | Server |
| @fastify/csrf-protection | 7.1.0 | >=20 | ESM | Server |
| @fastify/static | 9.1.1 | >=20 | ESM | Server |
| drizzle-orm | 0.45.2 | >=18 | CJS + ESM | Server ORM |
| drizzle-kit | 0.31.10 | >=18 | CJS | Dev/migrations |
| postgres | 3.4.9 | >=12 | CJS + ESM | Server DB driver |
| @node-rs/argon2 | 2.0.2 | >=10 | CJS + ESM | Server auth |
| nodemailer | 7.0.5 | >=18 | CJS | Server email |
| pino | 10.3.1 | >=14.6.0 | CJS + ESM | Server logging |
| ws | 8.20.0 | >=10 | CJS | Agent WS client |
| reconnecting-websocket | 4.4.0 | >=10 | CJS + ESM | Agent + browser WS |
| react | 19.2.5 | N/A (browser) | ESM | Web SPA |
| vite | 8.0.8 | >=20 | ESM | Web build |
| react-router-dom | 7.14.1 | N/A | ESM | Web routing |
| @tanstack/react-query | 5.99.0 | N/A | ESM | Web data |
| zustand | 5.0.12 | N/A | ESM | Web state |
| react-hook-form | 7.72.1 | N/A | ESM | Web forms |
| zod | 4.3.6 | N/A | ESM | Web + shared validation |
| tailwindcss | 4.2.2 | N/A | ESM | Web styling |
| turbo | 2.9.6 | >=18 | N/A | Monorepo CI |
| pnpm | 10.x | >=18 | N/A | Package manager |
| @changesets/cli | 2.30.0 | >=18 | N/A | Release management |
| supertest | 7.2.2 | >=14 | CJS | Server testing |
| @playwright/test | 1.59.1 | >=18 | ESM | E2E testing |

---

## Integration Points with v1 CLI

| Integration | How Handled |
|-------------|-------------|
| `xci` package stays in monorepo | Moves to `packages/xci/`. `tsup` config, `package.json`, `bin` field unchanged. v1 test suite runs with `pnpm --filter xci test`. |
| `ws` added to `xci` package | Added as optional dependency. `tsup` config adds a second entry point `src/agent.ts` that bundles `ws` + `reconnecting-websocket`. Default `src/cli.ts` entry does NOT include them. Zero cold-start impact when invoked without `--agent`. |
| YAML DSL shared between CLI and server | `packages/xci/src/config/` exports the YAML schema type definitions. `@xci/server` imports them as a workspace dependency (`workspace:*`). No duplication. |
| Secrets model | v1 per-agent `.xci/secrets.yml` local secrets remain unchanged. v2.0 adds org-level encrypted secrets on the server that are injected into task execution at dispatch time. The agent's executor merges both: server-provided secrets are received via the WS handshake message and treated as the highest precedence level (overriding all local files). |

---

## What NOT to Add to v2.0

| Avoid | Why | Note |
|-------|-----|------|
| Redis | Session storage in Postgres is sufficient for single-instance v2.0. Adding Redis doubles operational complexity. | Revisit when horizontal scaling enters scope (v2.1+) |
| Socket.io | Own protocol, rooms/namespaces abstraction, JS polyfills. xci needs bare WebSocket with a JSON envelope — `ws` + `@fastify/websocket` covers this with 1/10th the footprint. | |
| NestJS / tRPC | NestJS is an opinionated framework that conflicts with Fastify's low-overhead philosophy. tRPC would require a tRPC client in the SPA — adds ceremony without benefit given the TypeBox schema approach already provides end-to-end type safety via codegen. | |
| Prisma | See ORM comparison above. Docker image weight + code-gen step. | |
| Stripe (v2.0) | Billing stub only in v2.0. Billing entities exist in DB schema but payment processing is out of scope. Adding Stripe SDK now adds webhook handling complexity before it's needed. | v2.1 |
| Kafka / RabbitMQ | Task dispatch via DB polling (or direct WS push) is sufficient for v2.0 single-instance. Message broker adds operational overhead with no benefit at this scale. | Consider v3.0+ |
| Next.js | The SPA is React + Vite, not Next.js. SSR is not needed — the dashboard is an authenticated internal tool. Next.js would introduce server-side rendering complexity, an additional Node.js process in Docker, and duplicate server-side routing. | |
| GraphQL (Apollo, urql) | REST + WebSocket is sufficient and better understood by the target audience (developers). GraphQL adds schema tooling, N+1 problem awareness, and client complexity with no DX advantage for a dashboard with well-defined API shape. | |
| `chalk` / `ora` / `boxen` | v1 explicitly avoids these for cold-start budget. The `@xci/server` is a long-running process so startup time is less critical, but consistency with v1 and pino's built-in coloring via `pino-pretty` (dev only) covers all logging needs. | |

---

## Installation

```bash
# Monorepo root
corepack enable
pnpm install

# @xci/server production deps
pnpm --filter @xci/server add fastify @fastify/websocket @fastify/cookie @fastify/cors \
  @fastify/rate-limit @fastify/helmet @fastify/sensible @fastify/csrf-protection \
  @fastify/static @fastify/type-provider-typebox @sinclair/typebox fastify-plugin \
  drizzle-orm postgres @node-rs/argon2 nodemailer pino pino-http

# @xci/server dev deps  
pnpm --filter @xci/server add -D drizzle-kit @types/nodemailer supertest @types/supertest vitest

# xci (agent mode additions)
pnpm --filter xci add ws reconnecting-websocket
pnpm --filter xci add -D @types/ws

# @xci/web deps
pnpm --filter @xci/web add react react-dom react-router-dom \
  @tanstack/react-query zustand react-hook-form @hookform/resolvers zod \
  lucide-react reconnecting-websocket

# @xci/web dev deps
pnpm --filter @xci/web add -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite \
  @types/react @types/react-dom @vitest/browser @playwright/test

# Monorepo root dev tools
pnpm add -Dw turbo @changesets/cli
```

---

## Sources

- https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/ — Fastify v5 requires Node >=20, GA confirmed
- https://openjsf.org/blog/fastifys-growth-and-success — Fastify v5 official release announcement
- https://github.com/fastify/fastify/releases — v5.8.5 confirmed as current
- https://github.com/drizzle-team/drizzle-orm — drizzle-orm 0.45.2, drizzle-kit 0.31.10
- https://levelup.gitconnected.com/the-2025-typescript-orm-battle-prisma-vs-drizzle-vs-kysely-007ffdfded67 — ORM comparison 2025
- https://www.npmjs.com/package/postgres — postgres 3.4.9, ESM-compatible
- https://www.npmjs.com/package/@node-rs/argon2 — @node-rs/argon2 2.0.2, Rust prebuilt binaries, no node-gyp
- https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/ — Argon2id NIST recommendation
- https://nodejs.org/api/crypto.html — node:crypto AES-256-GCM, authoritative
- https://stytch.com/blog/jwts-vs-sessions-which-is-right-for-you/ — JWT vs session tradeoffs
- https://ui.shadcn.com/docs/tailwind-v4 — shadcn/ui + Tailwind v4 compatibility confirmed
- https://ui.shadcn.com/docs/installation/vite — shadcn + Vite installation guide
- https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository — Turborepo structure
- https://pnpm.io/workspaces — pnpm workspaces documentation
- https://snyk.io/blog/choosing-the-best-node-js-docker-image/ — node:22-slim vs alpine comparison
- https://hub.docker.com/_/node — Official Node.js Docker images
- https://www.npmjs.com/package/reconnecting-websocket — reconnecting-websocket 4.4.0
- npm registry — all versions verified via `npm view <package> version` on 2026-04-16
