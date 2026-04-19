# @xci/web

The xci web dashboard SPA — agents, tasks, runs, history, org settings, plugin settings, and build-status badges.

## Quick start

```bash
# 1. Install dependencies (from monorepo root)
pnpm install

# 2. Terminal 1: start the backend API
pnpm --filter @xci/server dev

# 3. Terminal 2: start the web dev server
pnpm --filter @xci/web dev

# 4. Open http://localhost:5173
```

Signup at `/signup`, then log in. The dev server proxies API calls to the server on port 3000 via the `VITE_API_URL` env var (defaults to same-origin in production).

## Tech stack

| Technology | Pinned version | Purpose |
|------------|---------------|---------|
| React | 19.1.0 | UI framework |
| Vite | 6.3.4 | Dev server + build tool |
| Tailwind CSS | 4.1.5 | Utility-first CSS |
| shadcn/ui (Radix) | various | Accessible component primitives |
| TanStack Query | 5.74.4 | Server state management + caching |
| Zustand | 5.0.5 | Client-side stores (auth, WS, UI) |
| React Router | 7.5.3 | Data-router SPA routing |
| Zod | 3.25.53 | Runtime schema validation |
| Monaco Editor | 4.7.0 | YAML task editor (lazy-loaded chunk) |
| TypeScript | 5.9.2 | Type safety |

## Architecture

### Routing

React Router v7 data-router mode. Routes are split into two groups:

- **Public routes** (no auth required): `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/accept-invite`
- **Authenticated shell** (`/`): loader calls `/api/auth/me`; on 401 redirects to `/login`. Child routes: `/agents`, `/tasks`, `/tasks/:taskId`, `/runs/:runId`, `/history`, `/settings/org`, `/settings/plugins`, `/settings/plugins/dlq`

### State management

| Store | Purpose |
|-------|---------|
| `authStore` (Zustand) | Current user, org, plan, role — hydrated from `/api/auth/me` on boot |
| `wsStore` (Zustand) | WebSocket connection state: `connected`, `reconnecting`, `disconnected` |
| `uiStore` (Zustand) | Toast notifications, global loading flag |
| TanStack Query | All server data: agents, tasks, runs, log chunks, org members, DLQ entries |

### Cross-package fence

`@xci/web` never imports from `xci` or `@xci/server`. Enforced by Biome `noRestrictedImports` in `packages/web/biome.json`. The fence is checked on every CI build.

## Features

| Requirement | Feature |
|-------------|---------|
| UI-01 | React 19 + Vite 6 + Tailwind 4 + shadcn/ui + TanStack Query 5 + Zustand 5 SPA |
| UI-02 | Agents list: status badge, labels, hostname rename (Owner/Member), drain toggle, last-seen |
| UI-03 | Tasks list + Monaco YAML editor with syntax highlighting, inline validation errors, save diff |
| UI-04 | Run detail: live log stream with autoscroll, timestamp toggle, download `.log` link |
| UI-05 | History: paginated table with status / task / date-range filters |
| UI-06 | Settings Org: members list, role management, invite by email, usage quota display |
| UI-07 | Settings Plugins: GitHub webhook token + HMAC secret config, Perforce script download |
| UI-08 | WS connection indicator (green/yellow/red) always visible in top nav |
| UI-09 | Empty state on Agents page: pre-populated `xci --agent ... --token ...` command with copy button |
| UI-10 | RoleGate: Viewer sees all mutation controls DISABLED with tooltip — never hidden |
| UI-11 | Responsive from 1024 px desktop and above (mobile out of scope for v2.0) |
| BADGE-01..04 | Build-status badge embedded in org settings per task (expose toggle + SVG preview) |

## Security UX invariants

- **Disabled-not-hidden (D-11):** Every mutation control (save, trigger, drain, invite, retry, create-token) is wrapped in `<RoleGate>`. A Viewer sees the button in the DOM with `disabled` attribute and a tooltip — never simply absent from the page. This is intentional: the UI communicates what a role upgrade would unlock.
- **httpOnly session cookie:** The `xci_sid` session cookie is not accessible from JavaScript. The SPA never reads or forwards it manually — the browser attaches it automatically on every request.
- **CSRF double-submit:** All mutation requests send a CSRF token via `X-CSRF-Token` header. The token is fetched once on mount from `/api/auth/csrf` and attached to every TanStack Query mutation.
- **No `dangerouslySetInnerHTML`:** Log chunks and all user-supplied strings are rendered as React text nodes (never raw HTML). Verified by Biome lint rule.
- **Log chunks as text:** The LogViewer renders each chunk as `<span>` text content. XSS via crafted log output is structurally prevented.

## Dev scripts

All commands run from the monorepo root with `pnpm --filter @xci/web <script>`:

| Script | What it does |
|--------|-------------|
| `dev` | Start Vite dev server at http://localhost:5173 |
| `build` | `tsc -b && vite build` → emit `dist/` |
| `preview` | Serve the production `dist/` with Vite preview (used by Playwright E2E) |
| `test` | Vitest unit suite (happy-dom + Testing Library + MSW) |
| `test:e2e` | Playwright E2E smoke against a running server + preview |
| `typecheck` | `tsc --noEmit` — no emit, just type-check |
| `lint` | `biome check .` — lint + format check |
| `lint:fix` | `biome check --write .` — auto-fix |

## Env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `` (empty — same origin) | Override the base URL for API calls. Set to `http://localhost:3000` in dev if the server runs on a different port than the Vite dev server. |

In production (Phase 14 Docker image), `@xci/server` serves the compiled `dist/` directory via `@fastify/static`, so all requests go to the same origin and `VITE_API_URL` is empty.

## Build output

Running `pnpm --filter @xci/web build` emits:

```
dist/
  index.html           — SPA entry point
  assets/
    index-*.css        — Tailwind styles (~6 KB gzip)
    index-*.js         — Main app bundle (~178 KB gzip)
    monaco-*.js        — Monaco editor lazy chunk (~8 KB gzip stub, full editor loaded on demand)
```

The `dist/` folder is served by `@fastify/static` in the Phase 14 production Docker image.

## License

MIT. See root `LICENSE`.

---

*v2.0 Phase 13 — part of the xci monorepo. See [packages/server](../server/README.md) for the backend API.*
