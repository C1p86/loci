# Phase 13 Discussion Log

**Mode:** Auto-selected — 43 locked decisions for the web SPA + badge endpoint.

Key calls:
- Stack per UI-01: React 19 + Vite 8 + Tailwind 4 + shadcn/ui + TanStack Query + Zustand
- React Router v7 data-router mode
- Monaco editor lazy-loaded (YAML language); reduces main bundle
- Disabled-not-hidden for Viewer role (UI-10) — `<RoleGate>` wrapper
- WS connection indicator always visible (UI-08)
- Autoscroll pauses on scroll-up, resumes on scroll-to-bottom (SC-3)
- No cross-package imports from web (Biome fence for new package)
- Badge endpoint server-side (not in web); unknown=200 grey (no 404 info leak)
- `orgs.slug` + `tasks.slug` + `tasks.expose_badge` added via migration 0006
- `@xci/web` flips `private: false` in this phase
- New `/api/auth/me` endpoint for UI hydration
- E2E smoke flow via Playwright (Linux CI only)
- Mobile + dark mode + i18n explicitly deferred v2.1+

See CONTEXT.md for full decision list.
