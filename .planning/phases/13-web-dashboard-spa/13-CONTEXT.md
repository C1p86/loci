# Phase 13: Web Dashboard SPA - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning
**Mode:** auto-selected (user requested autonomous chain to milestone end)

<domain>
## Phase Boundary

Phase 13 delivers the `@xci/web` React SPA — the user-facing dashboard that ties every backend phase into a coherent UI. Also lands the Build-Status Badge server endpoint (BADGE-01..04).

**Scope (UI-01..11 + BADGE-01..04):**
- Vite 8 + React 19 + TypeScript SPA in `packages/web/` (currently Phase 6 stub)
- Stack lock: Tailwind 4, shadcn/ui, TanStack Query, Zustand
- Auth: login/signup/forgot-password pages consuming Phase 7 endpoints; session cookie auth; redirect-to-login guard
- Views: Agents, Tasks (+ YAML editor), Run detail (+ live log stream), History, Settings (Org members/roles/invites + Plugins + Usage)
- WS connection indicator (live agent-free — uses session cookie; connects to log WS for active runs only)
- Empty states for first-run UX (agent-register empty state with pre-populated xci command + registration token copy button)
- Role Viewer: mutation controls DISABLED (visibly, with tooltip) — NEVER hidden
- Responsive: 1024px desktop+ only (mobile explicitly out of scope v2.0)
- Build-Status Badge: public (unauth) endpoint `/badge/:orgSlug/:taskSlug.svg` with per-task expose toggle

**NOT in scope:**
- Mobile responsive (<1024px) — explicitly deferred v2.0
- i18n / l10n — English only
- Themes (dark/light toggle) — single theme v2.0 (shadcn/ui defaults)
- Admin-level dashboard (cross-org analytics) — out of scope
- User profile image upload — use initials/gravatar
- Notification preferences / email preferences — out of scope
- MEK rotation UI — platform admin does it via API directly
- Billing/upgrade UI (QUOTA-07 forbids Stripe integration)

**Hard scope rule:** every requirement implemented here is UI-01..11 or BADGE-01..04.

</domain>

<decisions>
## Implementation Decisions

### Stack & Tooling (UI-01)

- **D-01:** **Exact pinned versions** (RESEARCH will confirm — defaults):
  - `react@19.x`, `react-dom@19.x`
  - `vite@8.x`
  - `typescript@5.x` (inherits workspace base)
  - `tailwindcss@4.x` (v4 uses Vite plugin, not PostCSS; zero-config via `@tailwindcss/vite`)
  - `@tanstack/react-query@5.x`
  - `zustand@5.x`
  - `shadcn/ui` latest (copied components via CLI — not a package dep)
  - `react-router-dom@7.x` (nested routes, loader/action pattern)
  - `@monaco-editor/react` for YAML editor (UI-03) — heaviest dep; lazy-loaded only on task edit page
  - `zod@4.x` for client-side schema validation (shared types via `xci/dsl`? NO — Phase 9 D-37 fence, server uses xci/dsl only. Web uses its own zod schemas defined from OpenAPI or hand-maintained parallel types)
  - `biome` shared config from root

- **D-02:** **No CSS-in-JS.** Tailwind 4 utility classes + shadcn/ui components = styling surface. NO emotion, styled-components, etc.

- **D-03:** **Build output:** `packages/web/dist/` as static SPA assets (index.html + JS/CSS bundles). Phase 14 Docker image serves via fastify-static on the same server at path `/` (API stays under `/api/*`, WS under `/ws/*`, badge under `/badge/*`).

- **D-04:** **Vite config:** `vite.config.ts` with base `/` (server serves from root), `build.outDir: 'dist'`, `define: { 'import.meta.env.VITE_API_URL': JSON.stringify(...) }` for dev-mode API pointer.

- **D-05:** **Workspace dependency on backend types:** `@xci/server` source types are NOT importable from web (would mix Node types into browser). Instead, web maintains its own TypeScript interfaces matching the API response shapes. Rationale: browser bundle must stay lean; Node-specific types (Buffer, FastifyRequest) leak if we cross-import. Justification for duplication: types are small and stable (CRUD responses).

### Routing (all routes)

- **D-06:** **React Router v7 data-router mode** (loader/action pattern). Routes:
  - `/login` — public
  - `/signup` — public
  - `/forgot-password` + `/reset-password/:token` — public
  - `/verify-email/:token` — public (acknowledgment, redirect to login)
  - `/invites/:token` — public preview + auth-gated accept
  - `/` — authenticated layout (sidebar + main); redirects to `/agents` default
  - `/agents` — UI-02 agents list
  - `/tasks` — UI-03 tasks list
  - `/tasks/:id/edit` — UI-03 editor (lazy-load monaco)
  - `/tasks/:id/trigger` — UI-04 trigger form with param overrides
  - `/runs/:id` — UI-04 run detail with live logs
  - `/history` — UI-05 paginated history
  - `/settings/org` — UI-06 members + invites + usage (QUOTA-06)
  - `/settings/plugins` — UI-07 webhook tokens + trigger config UI hint
  - `/dlq` — DLQ list + retry (Phase 12 UI consumer)
  - `*` — 404 page

- **D-07:** **Auth guard:** root layout loader fetches `/api/auth/me` (new endpoint added in this phase — returns `{user, org, plan}`). On 401, redirect to `/login` preserving `?redirect=<original>`. On success, hydrate Zustand store.

### State Management

- **D-08:** **Zustand stores (thin):**
  - `authStore` — `{user, org, plan, isLoading}`; set on login/load; cleared on logout
  - `wsStore` — `{status: 'connected' | 'reconnecting' | 'disconnected', activeRunSubs: Map<runId, WS>}`; UI-08 indicator reads from this
  - `uiStore` — `{sidebarCollapsed, logTimestampVisible, logAutoscrollPaused}`; persisted to localStorage
- **D-09:** **TanStack Query for server state:** every GET endpoint wrapped in a useQuery hook; mutations via useMutation with optimistic updates + cache invalidation. Query keys follow `['resource', 'list' | 'detail', ...params]` convention.
- **D-10:** **No Redux / no Context API for server state** — TanStack Query handles caching, background refetch, stale-while-revalidate. Zustand for client-only state only.

### Role-Based UI (UI-10)

- **D-11:** **Disabled-not-hidden principle:** mutation controls render for EVERY role; Viewer sees them `disabled` with tooltip "Viewers cannot modify tasks". NEVER conditionally render them out. Rationale: predictable layout across roles, easier testing, consistent keyboard nav.
- **D-12:** **`<RoleGate>` component:** `<RoleGate role="member" fallback={<DisabledButton tooltip="..."/>}>{button}</RoleGate>`. Consumes authStore to check user role for current org. Wraps every mutation button.
- **D-13:** **Write test for SC-1:** playwright/cypress test that logs in as Viewer, navigates every page, asserts every mutation button is `disabled` (not missing from DOM).

### Live Log Streaming (UI-04, SC-3)

- **D-14:** **Run detail page `/runs/:id`:** components — RunStatus header, LogViewer (virtualized), DownloadRawButton, TimestampToggle.
- **D-15:** **LogViewer:** receives initial chunks via TanStack Query (`GET /logs.log` as Blob, parse server-sent events? NO — parse plain text chunks from the ws subscription). On mount, open `/ws/orgs/:orgId/runs/:runId/logs` with `{type:'subscribe', sinceSeq: 0}`. Append each `{type:'chunk'}` frame to local buffer.
- **D-16:** **Autoscroll (SC-3):** Intersection Observer on a "bottom sentinel" div. If visible → autoscroll on new chunk. If user scrolls up (sentinel not visible) → PAUSE autoscroll (set `uiStore.logAutoscrollPaused=true`). When user scrolls back to bottom (sentinel visible) → RESUME (set false). Render "autoscroll paused — click to resume" banner when paused.
- **D-17:** **WS connection indicator (UI-08):** badge in header that shows 🟢 Connected / 🟡 Reconnecting (1-30s backoff) / 🔴 Disconnected with reason. Driven by `wsStore.status`. Reconnect auto-resumes with `sinceSeq: lastSeq`.
- **D-18:** **Timestamp toggle (UI-04):** `uiStore.logTimestampVisible` persists preference. When OFF, hide `[<ts>]` prefix from display but keep in DOM for copy-paste if user selects.
- **D-19:** **Run state polling:** when live log WS is connected, get run state updates via WS `{type:'end'}` frame. When disconnected, fall back to TanStack Query with 5s refetch interval until run reaches terminal state.

### Task YAML Editor (UI-03, SC-4)

- **D-20:** **Monaco editor with YAML language:** lazy-loaded (separate bundle) — only the task edit page loads it. Reduces main bundle size.
- **D-21:** **Inline validation:** on save, POST to PATCH /tasks/:id; if 400 with TaskValidationError `errors[]`, display each error inline in Monaco via `editor.setModelMarkers()` with severity + line + column + message + suggestion (from Phase 9 validation).
- **D-22:** **NO client-side pre-validation** — all validation server-side (reuse xci/dsl validator is tempting but cross-package fence). Trust the server response. UI focuses on rendering errors well.
- **D-23:** **Save with diff:** before POST, show a diff view (monaco's built-in diff viewer) between current state and last-saved state. User confirms diff → POST. Diff is UX nicety; no server change.

### Trigger Form (UI-04 partial)

- **D-24:** **`/tasks/:id/trigger` page:** form with auto-detected `${VAR}` placeholders (from task YAML). User fills values (optional — can skip for defaults). Submit calls POST /tasks/:taskId/runs with `param_overrides`.
- **D-25:** **Missing-param hint:** server returns `missing_params: [...]` array in response; display as warning banner (not blocker — agent-local secrets may fill). Link to the run detail page on success.

### Settings Views

- **D-26:** **Org Settings (UI-06):** members list with role badges; invite form (email + role); pending invites with revoke action; usage widget showing `agents X/5`, `concurrent Y/5`, `retention Z days` (QUOTA-06); leave org button.
- **D-27:** **Plugin Settings (UI-07):** list of webhook_tokens per plugin (GitHub + Perforce); create form; revoke; view endpoint URL; GitHub shows "paste secret once" field; Perforce shows "download trigger script" link (uses Phase 12 `xci agent-emit-perforce-trigger` CLI instructions — web doesn't call xci, just documents the command with values).
- **D-28:** **DLQ view (`/dlq`):** paginated list; click to see scrubbed payload + failure reason; retry button (Owner/Member only; Viewer disabled). Consumes Phase 12 endpoints.

### Build-Status Badge (BADGE-01..04)

- **D-29:** **Server-side endpoint** (in `@xci/server`, NOT web):
  - `GET /badge/:orgSlug/:taskSlug.svg` — unauth
  - Returns SVG with 3 states: `passing` (green), `failing` (red), `unknown` (grey)
  - Uses shields.io-compatible style (label + message bg + value bg). Inline SVG template hardcoded in code.
  - Cache-Control: `public, max-age=30` (BADGE-02)
  - For non-existent org/task OR task with `expose_badge=false`: return "unknown" grey 200 SVG, NEVER 404 (BADGE-03/04)

- **D-30:** **`tasks.expose_badge boolean DEFAULT false`** column added in this phase's migration (Phase 9 tasks table extension). UI toggle on task detail page (Owner/Member, CSRF).

- **D-31:** **Org slug**: new `orgs.slug text UNIQUE` column (nullable during migration; backfill is `lower(replace(name, ' ', '-'))` per org). Task slug: already derivable from task.name (lowercase + hyphen); OR explicit `tasks.slug text UNIQUE WITHIN ORG` — cleaner; add column. Owner can edit slug; write-test for uniqueness.

- **D-32:** **Rate-limit on badge endpoint:** 120/min per IP (generous; badges embedded in many pages).

- **D-33:** **No auth required for badge.** That's the point — embeddable in public READMEs. The `expose_badge` toggle is the security control (default off).

### API Extensions Needed in This Phase (Minimal)

- **D-34:** Extensions to existing endpoints (add to Phase 7 auth or create new slim endpoints):
  - `GET /api/auth/me` — returns `{user, org, plan}` for UI hydration (NEW)
  - Extend `GET /api/orgs/:orgId/tasks/:taskId` response with `expose_badge` + `slug`
  - Extend `PATCH /api/orgs/:orgId/tasks/:taskId` to accept `expose_badge` + `slug`
  - Extend `POST /api/orgs/:orgId/agents/:agentId/revoke` to also return refreshed `agentCount` (for usage widget)

- **D-35:** **Badge endpoint and orgs.slug migration** added in Phase 13's 0006 migration. `expose_badge` + `tasks.slug` also.

### Testing Strategy

- **D-36:** **Unit (vitest + testing-library):** each reusable component (LogViewer, RoleGate, DisabledWithTooltip, etc.); hooks (auth store, ws store). Node environment with happy-dom.
- **D-37:** **Integration (Vitest with happy-dom + MSW):** each page as a black box — mock API with MSW, render page, assert content + interactions. Role-based test matrix (Viewer sees disabled, Member sees enabled).
- **D-38:** **E2E (Playwright, Linux CI only):** smoke flows — login → create task → trigger run → watch logs → logout. ONE E2E test for the happy path, not exhaustive.
- **D-39:** **Badge endpoint test** (server-side, Phase 7 testcontainer pattern): succeeded run → green SVG; failing run → red; unknown task → grey; expose_badge=false → grey.

### Backward Compat & Cross-Package

- **D-40:** **v1 fence:** `pnpm --filter xci test` still passes (web is a new package, no effect on xci).
- **D-41:** **No cross-package imports from web:** web has its own types; does NOT import `xci` or `xci/dsl` or `@xci/server`. Biome rule: `packages/web/src/**` forbids `from 'xci'` and `from '@xci/server'`.
- **D-42:** **`@xci/web` flips `private: false`** in this phase (parallel to Phase 7 D-12 where `@xci/server` flipped). Publishable to npm.

### Schema Migration

- **D-43:** **Migration `0006_badge_slugs.sql`** — adds `orgs.slug` (unique), `tasks.slug` (unique within org), `tasks.expose_badge`. Backfill slugs from name. [BLOCKING] gate.

### Claude's Discretion

- Exact component library breakdown (shadcn/ui component list — planner picks standard: Button, Dialog, Input, Label, Tabs, Table, Tooltip, Dropdown, Form, Toast)
- Routing layout shape (sidebar + main, top nav on small screens) — planner refines
- Icons library (lucide-react bundled with shadcn/ui default)
- Form library (react-hook-form recommended — ecosystem standard)
- YAML syntax highlighting in Monaco (built-in YAML language support — nothing extra)
- Badge SVG exact pixel dimensions (100x20 is shields.io standard)
- Login error UX (inline field error vs toast — planner picks)

</decisions>

<canonical_refs>
## Canonical References

### Requirements
- `.planning/REQUIREMENTS.md` §Dashboard UX (UI-01..11)
- `.planning/REQUIREMENTS.md` §Build-Status Badge (BADGE-01..04)
- `.planning/REQUIREMENTS.md` §Backward Compatibility (BC-01..04)

### Roadmap
- `.planning/ROADMAP.md` §Phase 13 — 5 success criteria

### All Prior Phase Contexts
- Phase 7: auth endpoints + session cookie + forOrg
- Phase 8: agent endpoints + registration tokens (empty state UI consumes)
- Phase 9: task CRUD + secrets + trigger_configs
- Phase 10: run trigger/list/cancel + usage + dispatch-resolver missing_params
- Phase 11: log WS subscribe + download endpoint
- Phase 12: webhook tokens CRUD + DLQ list/retry

### External Specs
- shadcn/ui (https://ui.shadcn.com) — component copy model; Button, Dialog, etc.
- Tailwind v4 (https://tailwindcss.com/docs/v4-beta) — new Vite plugin, utility classes
- React Router v7 data-router mode — loader/action patterns
- TanStack Query v5 — useQuery/useMutation API
- Monaco Editor — YAML language support built-in

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 6 Stub
- `packages/web/` is Phase 6 stub: just a package.json with echo-noop scripts; src/index.ts empty export
- Phase 13 replaces the stub with full Vite SPA

### Integration Points (server-side)
- `packages/server/src/routes/badge/` — NEW directory (badge SVG endpoint)
- `packages/server/src/routes/auth/me.ts` — NEW (GET /api/auth/me for UI hydration)
- `packages/server/src/db/schema.ts` — extend with orgs.slug + tasks.slug + tasks.expose_badge
- `packages/server/src/repos/tasks.ts` — extend with findBySlug

### Cross-Package Fence
- web is NEW — add Biome `noRestrictedImports` for `packages/web/src/**` forbidding `xci`, `xci/dsl`, `xci/agent`, `@xci/server`
- Existing Phase 9 D-37 fence (server: only xci/dsl) unchanged
- Phase 8 D-01 fence (xci: cli.ts narrowed) unchanged

### Bundle Size Awareness
- Main SPA bundle target: <500KB gzip (reasonable for a dashboard)
- Monaco YAML editor: lazy-loaded; ~1.5MB gzip in its own chunk, loaded only on task edit page
- Tailwind 4 with JIT: minimal CSS payload

</code_context>

<specifics>
- **Disabled-not-hidden for Viewers** is one of the most important UX principles here. Developers often hide controls and confuse users about capabilities. Showing-and-disabling makes role boundaries visible and the app more trustworthy.

- **Lazy-load Monaco** is critical. Otherwise every route loads a 1.5MB bundle on first paint. Dynamic import gated on `/tasks/:id/edit` keeps the dashboard snappy.

- **The WS indicator is a first-class citizen** — it answers "is my data fresh?" which is a constant user concern in a dashboard. Always-visible placement in the top nav, clear colors, recent activity hint.

- **Badge endpoint is MINIMAL — no content negotiation, no size variants.** Just SVG at 100x20. Shields.io-compatible keeps muscle memory for README embedding.

- **The login page is the ONLY place where we ship unverified plaintext input to a form field the user might reuse**. Password auto-fill works; no "show password" toggle in v2.0 (security default). Forgot-password flow is the recovery path.

- **Badge "unknown" instead of 404 for non-existent tasks** (BADGE-03) prevents information leak about which orgs/tasks exist. Attackers can't enumerate.

</specifics>

<deferred>
- Mobile / <1024px layout — v2.1+
- Dark mode toggle — v2.1+
- i18n — English only v2.0
- Admin cross-org dashboard — out of scope
- Profile images / gravatar — initials only
- Notification preferences — out of scope
- Custom themes / white-labeling — out of scope
- User activity log viewer — out of scope
- Cross-run comparison view — out of scope
- Custom badge colors / styles — shields.io default only
- Advanced search across all runs — paginated filters only in v2.0
- Real-time org member presence indicators — out of scope
- Offline mode / PWA — out of scope
- Screenshot/sharing for runs — out of scope
- Embed-able log viewer iframe — out of scope
- GitHub / GitLab integration UI beyond webhook config — out of scope

### Reviewed Todos (not folded)
None.

</deferred>

---

*Phase: 13-web-dashboard-spa*
*Context gathered: 2026-04-19*
*Mode: auto-selected*
