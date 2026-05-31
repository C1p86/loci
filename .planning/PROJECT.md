# loci / xci

## What This Is

`xci` è un sistema CI distribuito cross-platform composto da tre parti:

1. **CLI `xci`** (Node.js, pubblicato su npm): esegue alias di comandi definiti in file YAML versionati, con config a 4 livelli (machine/project/secrets/local), interpolazione placeholder `${VAR}`, catene sequenziali e gruppi paralleli. Funziona standalone su Windows/Linux/macOS.

2. **Server `@xci/server`** (Fastify + Postgres, Docker image): backend multi-tenant SaaS che riceve connessioni da agenti xci, gestisce task definitions, dispatcha run sugli agenti via WebSocket, persiste log, gestisce secrets con envelope encryption, supporta trigger via plugin webhook.

3. **Web `@xci/web`** (React 19 + Vite, SPA): dashboard per gestire agenti, definire task YAML, triggerare run, vedere log live, gestire segreti org, configurare plugin webhook, e visualizzare badge di stato build.

**Distribuito come:** `npm i -g xci` per il CLI; Docker image per server+web.

## Core Value

**Un alias → sempre lo stesso comando eseguito correttamente**, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.

*Il server estende questo: un alias può ora essere eseguito su agenti remoti, dispatchato dalla UI, con secrets gestiti centralmente.*

## Current Milestone: v2.1 Quality & Parity

**Goal:** Completare la parità Go CLI, abilitare il dispatch multi-step sull'agente, aggiungere shell completions, chiudere il debito di sicurezza e qualità accumulato in v2.0.

**Target features:**
- Go CLI parity — colored output, `for_each ${VAR}`, campo `cwd` + ereditarietà, breadcrumb step, stampa cwd
- Agent dispatch multi-step — sequence/parallel nei task remoti (deferred da Phase 10)
- Shell completions — bash/zsh/fish/PowerShell
- Security debt — session token hashing at rest, `haveibeenpwned` su signup/reset
- Code quality — 68 Biome errors cleanup, bundle-size CI gate wiring
- DevOps — branch protection required checks, `NPM_TOKEN` secret

## Current State (post-v2.0)

- **v1.0 shipped:** 2026-04-15 — CLI standalone, 57 requirements
- **v2.0 shipped:** 2026-04-19 — Remote CI (9 phases, 99 requirements), archived
- **Phase 15 shipped:** 2026-05-31 — Go CLI parity (5 requirements), `go-xci/` in repo
- **v2.1 in progress:** 2026-06-01 — Quality & Parity milestone started

## Requirements

### Validated

**v1.0 (CLI standalone)**

- ✓ Carica e fonde config da 4 livelli con precedenza deterministica (machine < project < secrets < local) — v1.0
- ✓ Formato file di config: YAML con semantica YAML 1.2 — v1.0
- ✓ File secrets.yml protetto: warning stderr se tracciato da git, valori mai loggati — v1.0
- ✓ Tipi di comando: singolo, catena sequenziale (stop al primo fallimento), gruppo parallelo — v1.0
- ✓ Output dei comandi figli streamato su stdout/stderr in tempo reale — v1.0
- ✓ Exit code propagato — v1.0
- ✓ `xci` senza argomenti / `--list` elenca alias con descrizione — v1.0
- ✓ `xci init` scaffolda .loci/ con template dimostrativi, aggiorna .gitignore — v1.0
- ✓ README completo con quickstart, config reference, commands reference — v1.0
- ✓ Package pubblicato come `xci` su npm (MIT license) — v1.0

**v2.0 (Remote CI)**

- ✓ Monorepo pnpm workspaces + Turborepo + Changesets; 3 npm packages — v2.0
- ✓ Docker image multi-stage node:22-slim, non-root, healthcheck, SIGTERM — v2.0
- ✓ Multi-tenant auth: signup/login/sessions/invites, CSRF, rate-limit, org isolation — v2.0
- ✓ Agent mode: TOFU registration, persistent WS, heartbeat/reconnect, drain/shutdown — v2.0
- ✓ Server-side task definitions (shared YAML DSL); org secrets AES-256-GCM envelope encryption — v2.0
- ✓ Label-match dispatch pipeline, 8-state TaskRun machine, quota enforcement — v2.0
- ✓ Real-time log streaming (agent → Postgres → UI WS), ordered replay, secret redaction — v2.0
- ✓ Webhook plugins: GitHub (HMAC-SHA256), Perforce (token); Dead Letter Queue, idempotency — v2.0
- ✓ React 19 + Vite + Tailwind 4 SPA: agents, task editor, log viewer, history, settings, badges — v2.0
- ✓ CI smoke test (signup → agent → task → run → log) before Docker release tag — v2.0

**Go CLI (Phase 15)**

- ✓ `go-xci` Go port with cobra: 4-layer config, executor (single/sequential/parallel), resolver, CLI — Phase 15
- ✓ KEY=VALUE CLI parameter overrides win over all YAML layers — Phase 15
- ✓ Required params validation (`params: { TOKEN: { required: true } }`) — Phase 15
- ✓ Multi-pass placeholder resolution (max 10 iterations, nested `${VAR}` support) — Phase 15
- ✓ secrets.yml git-tracking warning (best-effort, silent if git unavailable) — Phase 15
- ✓ Passthrough args `--` for sequential/parallel plans — Phase 15

### Active (v2.1)

- Go CLI: colored output + run-header recap — GOCLI-06
- Go CLI: `for_each.in` con `${VAR}` placeholder — GOCLI-07
- Go CLI: campo `cwd` opzionale con ereditarietà parent→child — GOCLI-08
- Go CLI: breadcrumb completo negli step header — GOCLI-09
- Go CLI: stampa cwd effettivo prima di ogni step — GOCLI-10
- Agent dispatch sequence/parallel multi-step — DISP-01
- Shell completions bash/zsh/fish/PowerShell — DX-01
- Session token hashing at rest — SEC-01
- `haveibeenpwned` check su signup/reset — SEC-02
- Biome style errors cleanup (68 errori in `packages/xci/src/`) — QA-01
- Bundle-size CI gate wiring — QA-02
- Branch protection + required status checks — OPS-01
- `NPM_TOKEN` secret setup — OPS-02

### Out of Scope

- ~~Esecuzione remota / runner SSH~~ — **Invertito in v2.0** (agent WebSocket)
- ~~Trigger automatici~~ — **Invertito in v2.0** (webhook plugins GitHub/Perforce)
- ~~UI grafica / dashboard~~ — **Invertito in v2.0** (React SPA)
- **Sostituzione npm scripts / Makefile** — convive, non rimpiazza
- **Support per config non-YAML** — un solo formato per coerenza
- **Versioning/lock del tool per progetto** — versione globale installata
- **Stripe / pagamenti in v2.0** — billing stub-only; Stripe a FUT-01
- **Multi-region / HA del server** — single-region single-instance in v2.0; HA a FUT-08
- **Plugin system dinamico runtime** — anti-feature per sicurezza (PLUG-02)
- **Auto-update agent binary** — security risk; utente aggiorna con `npm i -g xci@latest`

## Context

- **Utente target:** developer singolo o team che lavora su più progetti con stack diversi; vuole standardizzare build/package/deploy senza ricordare sequenze di comandi
- **Primo caso d'uso:** catena `build → package → deploy`
- **Ecosistema:** Node.js moderno, npm pubblico; server opzionale via Docker
- **v2.0 codebase:** ~115,000 LOC added (564 files). TypeScript 5.x + Fastify 5 + Drizzle + React 19 + Vite + Tailwind 4
- **Go port:** `go-xci/` directory — single-binary Go alternative for the CLI (cobra), feature-parity with TypeScript xci for GOCLI-01..05
- **Known tech debt:** bundle-size CI gate not wired (D-15 omitted Phase 6); session token not hashed at rest (D-12 deferred); 68 pre-existing Biome style errors in packages/xci/src/

## Constraints

- **Tech stack:** Node.js ≥20.5, TypeScript 5.x, commander.js v14, execa 9.x, yaml 2.x, tsup, vitest, biome. Server: Fastify 5, Drizzle-ORM, Postgres. Web: React 19, Vite, Tailwind 4, TanStack Query 5, Zustand 5.
- **Compatibility:** Windows 10+, Linux, macOS — identical observable behavior
- **Distribution:** `npm i -g xci` (CLI); Docker image for server+web; Go binary for go-xci
- **Dependencies:** minimal; ws/reconnecting-websocket external from cli.mjs bundle
- **Security:** secrets.yml git-tracking warning; no secret values ever logged; AES-256-GCM envelope encryption for org secrets; timingSafeEqual for all token comparisons
- **Performance:** cold start `xci --version` < 300ms (BC-04 active gate on CI)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Nome `loci` / package `xci` | `loci` taken on npm; `xci` is the published name (D-01) | ✓ Good |
| YAML per i file di config | Leggibile, YAML 1.2 semantics (yaml eemeli), commenti supportati | ✓ Good |
| commander.js v14 | Scelto esplicitamente; v15 ESM-only dropped — stay on v14 | ✓ Good |
| execa vs cross-spawn | execa: Promise-based, real-time streaming, PATHEXT on Windows, AbortController | ✓ Good |
| tsup bundle (noExternal) | Single-file output minimizes cold-start disk reads | ✓ Good |
| `forOrg(orgId)` as sole scoped-repo entry point | Structural enforcement prevents missing org_id filters; Biome noRestrictedImports reinforces | ✓ Good |
| AES-256-GCM envelope encryption (MEK/DEK) | Industry standard; rotation without re-encrypting all values; KMS-ready (FUT-07) | ✓ Good |
| CSRF per-route (not global) | Signup/login have no session — exempt by design; avoids double-CSRF on auth flow | ✓ Good |
| WS auth via first frame (not URL) | Token in URL appears in proxy logs/access logs — frame body is WS-TLS encrypted only | ✓ Good |
| Agent credential stored locally via env-paths | OS-appropriate config dir (not ~/.config on macOS); --config-dir override | ✓ Good |
| node:22-slim base (not Alpine) | @node-rs/argon2 prebuilt binaries require glibc | ✓ Good |
| Drizzle tsc -b for @xci/server | Servers have no cold-start pressure; tsc produces better error messages for server code | ✓ Good |
| Bundle-size gate deferred (D-15) | Baseline 760KB vs 200KB target (pre-dates Phase 2-5 additions); re-evaluate in v3.x | ⚠️ Revisit |
| Go port as separate go-xci/ directory | Go single-binary is useful for environments without Node; keeps TypeScript as canonical | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
5. Move shipped requirements to Validated

---
*Last updated: 2026-06-01 — v2.1 milestone started. Focus: Go CLI parity, agent multi-step dispatch, shell completions, security debt, code quality, DevOps todos.*
