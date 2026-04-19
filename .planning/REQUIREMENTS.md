# Requirements: loci

**Defined:** 2026-04-10 (v1.0) / Updated 2026-04-16 (v2.0)
**Core Value:** Un alias → sempre lo stesso comando eseguito correttamente, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.

## Milestone v2.0 Requirements — Remote CI (Agents + Web Dashboard)

### Backward Compatibility (non-negotiable)

- [x] **BC-01**: `xci` senza `--agent` è osservabilmente identico a v1.0: config loading a 4 livelli, esecuzione (single/sequential/parallel), exit code, flag `--list` / `--dry-run` / `--verbose`, pass-through args.
- [x] **BC-02**: La suite di test v1 (202 test) passa invariata come required check CI su ogni PR che tocchi `packages/xci/`.
- [x] **BC-03**: Il bundle `packages/xci/dist/cli.mjs` resta sotto 200KB (attualmente ~130KB); `ws` e `reconnecting-websocket` sono `external[]` per l'entry CLI e non entrano mai in `cli.mjs`. Check di bundle-size nella CI.
- [x] **BC-04**: Cold-start `xci --version` senza `--agent` resta sotto 300ms su hardware moderno.

### Packaging & Distribution (PKG)

- [ ] **PKG-01**: Monorepo con pnpm workspaces; 3 package npm pubblicati: `xci`, `@xci/server`, `@xci/web`.
- [ ] **PKG-02**: Build orchestrato da Turborepo (pipeline caching locale e CI).
- [ ] **PKG-03**: Versioning coordinato via `@changesets/cli` per release dei 3 package.
- [ ] **PKG-04**: Docker image `xci/server` pubblicata, basata su `node:22-slim` (non Alpine), multi-stage build.
- [ ] **PKG-05**: Docker image include `@xci/server` + build statico di `@xci/web` servito da `@fastify/static`.
- [ ] **PKG-06**: Docker image gira come utente non-root, ha healthcheck HTTP, gestisce SIGTERM/SIGINT come PID 1.
- [ ] **PKG-07**: Migrazioni Drizzle applicate con programmatic migrator al boot del server (o init container); `drizzle-kit` resta devDep, non finisce nell'image di prod.
- [ ] **PKG-08**: CI smoke-test dell'image pubblicata (boot, healthcheck, migrazione, signup end-to-end) prima di tag release.

### Auth & Org Model (AUTH)

- [x] **AUTH-01**: Signup utente via email + password; hashing password con `@node-rs/argon2` (Argon2id, parametri current NIST).
- [x] **AUTH-02**: Verifica email al signup: token single-use con expiry 24h inviato via email.
- [x] **AUTH-03**: Login email+password → sessione DB-side (token opaque `randomBytes(32)`); cookie `httpOnly + secure + sameSite=strict`.
- [x] **AUTH-04**: Password reset: richiesta via email con token single-use, expiry 1h.
- [x] **AUTH-05**: CSRF protection (`@fastify/csrf-protection` o double-submit cookie) su tutte le route mutation.
- [x] **AUTH-06**: Rate limiting (`@fastify/rate-limit`) su signup, login, password-reset, webhook ingress.
- [x] **AUTH-07**: Ogni utente appartiene ad almeno un Org; Org personale creata automaticamente al signup.
- [x] **AUTH-08**: Ruoli per Org: **Owner** (unique, non-removable), **Member**, **Viewer** (read-only).
- [x] **AUTH-09**: Owner può invitare membri via email con ruolo Member o Viewer; invito ha token expiry 7g.
- [x] **AUTH-10**: Isolation multi-tenant: ogni entity tenant-scoped ha FK `org_id`; repository layer enforcea filtro `org_id` su ogni query; test fixture multi-org copre tutte le repo function.
- [x] **AUTH-11**: Email transport pluggable (nodemailer abstract transport); default SMTP configurabile via env var; template email in source.
- [x] **AUTH-12**: Logout invalida la sessione DB-side; nessuna riusabilità del cookie dopo logout.

### Agent Authentication (ATOK)

- [x] **ATOK-01**: Owner/Member-con-permission può generare Registration Token dalla UI; token single-use, expiry 24h, scoped all'org.
- [x] **ATOK-02**: `xci --agent <url> --token <registration-token>` usa il token nell'handshake; server emette Agent Credential permanente (TOFU) e lo restituisce all'agente che lo persiste locale.
- [x] **ATOK-03**: Agent Credential (reg-token e credential permanente) trasmessa nel body del frame WS di handshake, mai nella URL di connessione.
- [x] **ATOK-04**: Owner/Member può revocare l'Agent Credential di un agente specifico dalla UI; revoke immediato (chiude WS attiva).
- [x] **ATOK-05**: Ad ogni reconnect il server verifica la Agent Credential; se revocata, WS chiusa con reason "revoked".
- [x] **ATOK-06**: Tutte le comparazioni di token/HMAC usano `crypto.timingSafeEqual()`; mai `===`.

### Agent Lifecycle (AGENT)

- [x] **AGENT-01**: Agente apre WS persistente al server dopo registrazione; keepalive ping ogni 25s, pong timeout 10s.
- [x] **AGENT-02**: Auto-reconnect con exponential backoff (min 1s, max 30s, jitter) via `reconnecting-websocket`.
- [x] **AGENT-03**: Agente pubblica label all'handshake: `os`, `arch`, `node_version`, `hostname` (default) + custom via flag `--label key=value` (ripetibile).
- [x] **AGENT-04**: Hostname default = `os.hostname()`; overridable dalla UI (soft-override lato server, no cambio sistemico).
- [x] **AGENT-05**: UI mostra stato agente: **online** (heartbeat < 60s), **offline** (heartbeat stale), **draining**.
- [x] **AGENT-06**: Drain mode: admin segna l'agente "draining" → server non dispatcha nuove task → task correnti completano → agente può spegnersi senza orphaning.
- [x] **AGENT-07**: Task-state reconciliation al reconnect: agente dichiara run_id in esecuzione; server confronta con DB e sincronizza (se agente dice "finita" e server dice "dispatched", applica il result dell'agente).
- [x] **AGENT-08**: Graceful shutdown (SIGINT/SIGTERM): invia `goodbye` frame, completa run correnti o li marca come terminati, chiude WS, exit 0.

### Task Definitions (TASK)

- [x] **TASK-01**: Task server-side usa lo stesso YAML DSL di xci: alias + single / sequential / parallel + placeholder `${NAME}` + blocchi `linux:` / `windows:` / `macos:`.
- [x] **TASK-02**: Parser YAML condiviso tra `xci` e `@xci/server` (estratto in sub-module di `xci` importato da `@xci/server`), per garantire parità di semantica.
- [x] **TASK-03**: Task ha: `name`, `description`, `yaml_definition`, `label_requirements` (lista `key=value`), `org_id` (FK).
- [x] **TASK-04**: Task validata al salvataggio: YAML parseable, composizione ciclica rilevata (stesso engine v1 CMD-06), placeholder resolution al dispatch-time (stesso engine v1 INT-02).
- [x] **TASK-05**: Editor task nella UI con syntax highlighting YAML e validation error inline (nome, riga, suggerimento).
- [x] **TASK-06**: Risoluzione `${VAR}` al dispatch-time con precedenza: 1) param override del run (UI), 2) org-level secrets, 3) agent-local `.xci/secrets.yml` (precedenza più alta, applicata dall'agente).

### Task Dispatch (DISP)

- [x] **DISP-01**: Task triggerata (manuale UI o webhook plugin) entra in dispatch queue in-memory sul server.
- [x] **DISP-02**: Selezione agente idoneo: `online` + tutte le `label_requirements` soddisfatte; tra idonei sceglie least-busy; fallback round-robin.
- [x] **DISP-03**: Frame `dispatch` all'agente contiene: `run_id`, task definition snapshot, params risolti (org secrets decifrati in plaintext, OK su WS-over-TLS).
- [x] **DISP-04**: `TaskRun` persisto con stati: `queued → dispatched → running → (succeeded | failed | cancelled | timed_out | orphaned)`.
- [x] **DISP-05**: Concurrency per-agent default 1 (configurabile); per-org limit dal Plan (Free: `maxConcurrentTasks`).
- [x] **DISP-06**: Timeout: default 1h per task, configurabile per-task; scaduto → frame `cancel` all'agente + run marcato `timed_out`.
- [x] **DISP-07**: Cancellazione manuale dalla UI → frame `cancel` all'agente → task killed → run marcato `cancelled`.
- [x] **DISP-08**: Startup reconciliation: al boot server, TaskRun in stato `queued`/`dispatched` senza agente session vengono ri-queued (o marcati `orphaned` se non recuperabili).
- [x] **DISP-09**: "Run con param override" dalla UI: form per modificare i valori `${VAR}` prima del dispatch, senza persistere sulla task.

### Log Streaming (LOG)

- [x] **LOG-01**: Agente stream stdout/stderr in frame `log_chunk` con sequence number per ordering deterministico.
- [x] **LOG-02**: Server persiste chunk in Postgres (jsonb, compressione), retention configurabile; default Free plan **30 giorni**.
- [x] **LOG-03**: UI sottoscrive WS per log live con autoscroll pausabile; indicatore connessione WS (connected / reconnecting / disconnected); reconnect trasparente.
- [ ] **LOG-04**: Ogni chunk ha timestamp assoluto (origine agente); UI mostra/nasconde timestamp con toggle.
- [x] **LOG-05**: Download log completo di un run come file `.log` plaintext (endpoint autenticato, org-scoped, `Content-Disposition: attachment`).
- [x] **LOG-06**: Redazione pre-persist: valori di org secrets + agent-local secrets sostituiti da `***`; coprire varianti base64 (`Buffer.from(value).toString('base64')`); pino-http non logga request body contenente params.
- [x] **LOG-07**: Backpressure: subscriber UI lento non blocca stream agente; buffer drop-head per subscriber.
- [x] **LOG-08**: Retention cleanup job giornaliero cancella chunk più vecchi del retention del Plan dell'org.

### Secrets Management (SEC)

- [x] **SEC-01**: Org-level secrets cifrati con envelope encryption: MEK dal process env (`XCI_MASTER_KEY`, 32 bytes base64) cifra DEK per-org; DEK cifra il valore con AES-256-GCM.
- [x] **SEC-02**: IV random per ogni encrypt call (mai riusato); unit test verifica `notDeepEqual(encrypt(k,"x").iv, encrypt(k,"x").iv)`.
- [x] **SEC-03**: Auth tag AES-GCM validato al decrypt; fallimento → errore esplicito, no partial read.
- [x] **SEC-04**: UI Owner/Member per CRUD secrets (Viewer non può); nessun ruolo vede i valori decifrati in UI, solo metadata (nome, created_at, last_used_at).
- [x] **SEC-05**: Per-agent secrets restano locali in `.xci/secrets.yml` come v1 (nessuna modifica a quel percorso).
- [x] **SEC-06**: Dispatch: server decifra org secrets → invia nel param bundle all'agente (WS-TLS) → agente merge con `.xci/secrets.yml` locale (agent-local wins su collision).
- [x] **SEC-07**: Audit log org-scoped: create / update / rotate / delete di ogni secret (solo metadata, mai valori).
- [x] **SEC-08**: Endpoint admin per rotate MEK senza cambio DEK (ri-cifra i DEK con nuova MEK); gancio per KMS integration in v2.1.

### Trigger Plugins (PLUG)

- [ ] **PLUG-01**: Interfaccia plugin stabile a 3 metodi: `verify(request) → parse(event) → mapToTask(event, config)` con TypeScript interface esportata.
- [ ] **PLUG-02**: Plugin bundled at build time in `@xci/server`; nessun install dinamico runtime (anti-feature).
- [ ] **PLUG-03**: Plugin GitHub: endpoint `/hooks/github/:orgToken`, signature HMAC-SHA256 verificata con `timingSafeEqual`; supporta eventi `push` e `pull_request`.
- [ ] **PLUG-04**: Plugin Perforce: endpoint `/hooks/perforce/:orgToken` riceve POST JSON da script `change-commit` trigger; xci CLI emette lo script con `xci agent-emit-perforce-trigger <url> <token>` (Node-free sulla macchina Perforce: emette `.sh`/`.bat`).
- [ ] **PLUG-05**: Mapping event → task **config esplicita per-task** (no naming convention): su ogni task l'utente configura i trigger applicabili (es. "push su `main` di `acme/infra`").
- [ ] **PLUG-06**: Dead Letter Queue: eventi webhook non processati (parse fail, task non trovata, signature invalida) in DLQ; UI li elenca; retry manuale dalla UI.
- [ ] **PLUG-07**: Idempotency: `delivery_id` (es. `X-GitHub-Delivery`) tracciato per evitare replay; duplicate delivery ignorato con log warning.
- [ ] **PLUG-08**: Scrubbing: request body webhook scrubbato di token/header sensibili (Authorization, X-Hub-Signature, X-GitHub-Token) prima della persistenza in DLQ.

### Dashboard UX (UI)

- [ ] **UI-01**: SPA React 19 + Vite 8 + Tailwind 4 + shadcn/ui + TanStack Query + Zustand.
- [ ] **UI-02**: Vista "Agents": lista con stato, labels, hostname (rename inline per Owner/Member), azione "Drain", last-seen.
- [ ] **UI-03**: Vista "Tasks": lista + editor YAML con syntax highlighting, validation inline, save con diff.
- [ ] **UI-04**: Vista "Run": stato corrente, log live con autoscroll pausabile, link download raw log, timestamp toggle.
- [ ] **UI-05**: Vista "History" run: tabella paginata con filtri (status, task, date range).
- [ ] **UI-06**: Settings Org: members + ruoli + inviti (email).
- [ ] **UI-07**: Settings Plugin: config per-org per GitHub (webhook URL + HMAC secret) e Perforce (endpoint + script generato scaricabile).
- [ ] **UI-08**: Indicatore connessione WS (connected / reconnecting / disconnected) sempre visibile.
- [ ] **UI-09**: Empty states first-run: istruzioni per registrare il primo agente (comando `xci --agent ...` con token copiabile).
- [ ] **UI-10**: Role Viewer: UI read-only state-driven (bottoni disabled con tooltip, non nascosti).
- [ ] **UI-11**: Responsive layout: funziona da 1024px desktop in su (mobile out of scope v2.0).

### Billing / Quota Stub (QUOTA)

- [x] **QUOTA-01**: Entity `OrgPlan` con fields: `plan_name`, `max_agents`, `max_concurrent_tasks`, `log_retention_days`, `created_at`, `updated_at`.
- [x] **QUOTA-02**: Plan "Free" di default per ogni org: `max_agents=5`, `max_concurrent_tasks=5`, `log_retention_days=30`.
- [x] **QUOTA-03**: Enforcement registrazione agente: tentativo oltre `max_agents` → registration rifiutata con errore esplicito user-visible.
- [x] **QUOTA-04**: Enforcement concurrent: dispatch oltre `max_concurrent_tasks` → task in coda standard; se coda > threshold → error UI "quota exceeded, retry later".
- [x] **QUOTA-05**: Retention cleanup (LOG-08) usa `log_retention_days` del Plan corrente dell'org.
- [x] **QUOTA-06**: Settings Org mostra uso corrente: `agents N/5`, `concurrent X/5`, `retention Y days`.
- [x] **QUOTA-07**: Nessuna integrazione Stripe in v2.0; nessuna UI di upgrade; piano "Free" è l'unico disponibile.

### Build-Status Badge (BADGE)

- [ ] **BADGE-01**: Endpoint pubblico (non autenticato) `/badge/:orgSlug/:taskSlug.svg` → SVG `passing` / `failing` / `unknown`, basato sull'ultimo run terminale.
- [ ] **BADGE-02**: `Cache-Control: public, max-age=30` sulla risposta.
- [ ] **BADGE-03**: Task non esistente o org privata: badge "unknown" (200 con SVG grigio), no 404.
- [ ] **BADGE-04**: Toggle per-task "Expose badge" (default: off) — solo task con toggle ON sono raggiungibili via endpoint pubblico.

---

## v1.0 Validated Requirements (shipped, preserved by BC-01)

Requirements del milestone v1.0 — tutti shipped e validati. La milestone v2.0 deve **preservarli tutti** senza regressioni osservabili (vedi BC-01 / BC-02).

### Foundation

- [x] **FND-01**: Il progetto è un package Node.js ESM-only, TypeScript, bundled con tsup in un singolo `.mjs`, pubblicabile su npm pubblico come `xci`
- [x] **FND-02**: Il bin `xci` è installabile globalmente (`npm i -g xci`) e funziona identicamente su Windows 10+, Linux moderno, macOS moderno
- [x] **FND-03**: Cold start del comando `xci --version` inferiore a 300ms su hardware moderno
- [x] **FND-04**: Gerarchia di errori tipati (`LociError` + sottoclassi per categoria) definita e usata in tutto il codebase
- [x] **FND-05**: Test runner (vitest) e linter/formatter (biome) configurati e funzionanti fin dal primo commit di codice
- [x] **FND-06**: Pipeline CI su GitHub Actions con matrice Windows / Linux / macOS che esegue build + test + lint ad ogni push

### Config System

- [x] **CFG-01**: Utente può definire un file YAML di config a livello machine; il path è letto dalla env var `LOCI_MACHINE_CONFIG`
- [x] **CFG-02**: Utente può definire `.loci/config.yml` nella root del progetto (committato) con defaults di progetto
- [x] **CFG-03**: Utente può definire `.loci/secrets.yml` nella root del progetto (gitignored) con token/password
- [x] **CFG-04**: Utente può definire `.loci/local.yml` nella root del progetto (gitignored) con override per-PC
- [x] **CFG-05**: Il config loader fonde i 4 livelli in un unico oggetto con precedenza deterministica `machine → project → secrets → local` (ultimo vince)
- [x] **CFG-06**: Il config loader tagga la provenienza di ogni chiave (quale dei 4 file l'ha fornita), necessario per redaction e per `--verbose`
- [x] **CFG-07**: Il config loader emette un errore esplicito se un file esiste ma è YAML invalido, con nome file e riga dell'errore
- [x] **CFG-08**: Il config loader non fallisce se uno o più dei 4 file mancano (solo il machine è opzionale a priori; gli altri sono opzionali in assenza)
- [x] **CFG-09**: Se `secrets.yml` è presente, xci verifica con `git ls-files --error-unmatch` che NON sia tracciato dal repo; se lo è, emette un warning esplicito (non blocca l'esecuzione)
- [x] **CFG-10**: Parser YAML usato garantisce semantica YAML 1.2 (nessuna coercion di `no`/`yes`/`on`/`off` come boolean, nessuna interpretazione di `0123` come ottale)

### Commands System

- [x] **CMD-01**: Utente può definire `.loci/commands.yml` (committato) con mapping `alias → definizione comando`
- [x] **CMD-02**: Una definizione comando può essere un singolo comando (string o argv array)
- [x] **CMD-03**: Una definizione comando può essere una **sequenza** (stop-on-first-failure)
- [x] **CMD-04**: Una definizione comando può essere un **gruppo parallelo** (kill-remaining-on-fail)
- [x] **CMD-05**: Composizione: alias può riferire altri alias
- [x] **CMD-06**: Cycle detection al load-time con catena completa
- [x] **CMD-07**: Blocchi per-platform `linux:` / `windows:` / `macos:`
- [x] **CMD-08**: `description` opzionale usata in `--list` e `--help`
- [x] **CMD-09**: Alias referenziato non esistente → errore al load

### Interpolation & Env Injection

- [x] **INT-01**: Placeholder `${NOME}` risolto dal merged config prima dello spawn
- [x] **INT-02**: Placeholder mancante → errore esplicito, comando NON eseguito
- [x] **INT-03**: Valori interpolati come argv token separati (no shell string)
- [x] **INT-04**: Parametri merged config iniettati come env vars del processo figlio
- [x] **INT-05**: Secrets esclusi da debug/verbose, sostituiti da `***` in `--dry-run`

### Execution

- [x] **EXE-01**: `execa` con `shell: false` di default
- [x] **EXE-02**: stdout/stderr streamati in tempo reale senza buffering
- [x] **EXE-03**: Exit code propagato (0 / primo fallito)
- [x] **EXE-04**: Kill-remaining cross-platform su fallimento parallelo
- [x] **EXE-05**: Output prefissato per comandi paralleli
- [x] **EXE-06**: cwd = root del progetto (`.loci/`)
- [x] **EXE-07**: SIGINT propaga, no orfani

### CLI Frontend

- [x] **CLI-01**: commander.js v14 con registrazione dinamica
- [x] **CLI-02**: `xci` senza args mostra alias
- [x] **CLI-03**: `xci --list` / `-l`
- [x] **CLI-04**: `xci --help` + `xci <alias> --help`
- [x] **CLI-05**: `xci <alias> -- <extra args>` passthrough
- [x] **CLI-06**: `xci <alias> --dry-run` con secrets mascherati
- [x] **CLI-07**: `xci <alias> --verbose`
- [x] **CLI-08**: `xci --version`
- [x] **CLI-09**: Errori categorizzati con exit code dedicato

### Init Command

- [x] **INIT-01**: `xci init` scaffolda `.loci/`
- [x] **INIT-02**: `.loci/config.yml` di esempio
- [x] **INIT-03**: `.loci/secrets.yml.example` + `.loci/local.yml.example`
- [x] **INIT-04**: `.loci/commands.yml` con alias dimostrativi
- [x] **INIT-05**: `.gitignore` gestito per secrets/local
- [x] **INIT-06**: Idempotente + riepilogo

### Documentation & Distribution

- [x] **DOC-01**: README con quickstart, config reference, commands reference
- [x] **DOC-02**: Default `shell: false` documentato
- [x] **DOC-03**: Blocchi per-platform documentati
- [x] **DOC-04**: LICENSE (MIT)
- [x] **DOC-05**: Pubblicato su npm come `xci`

---

## Deferred / Future Requirements (post-v2.0)

Candidati per v2.1+. Non vincolanti su v2.0.

### DX enhancements

- **DX-V2-01**: Shell completions per bash / zsh / fish / PowerShell
- **DX-V2-02**: `xci <alias> --timing` mostra durata comandi della catena
- **DX-V2-03**: Colorazione output configurabile (`NO_COLOR` / `FORCE_COLOR`)
- **DX-V2-04**: `xci config` ispeziona merged config con provenance

### Extended commands

- **CMD-V2-01**: `shell: true` opt-in con warning
- **CMD-V2-02**: Comandi condizionali (file exists / env var set)
- **CMD-V2-03**: `workingDir:` per-comando

### Watch & trigger (locale, non v2.0 remoto)

- **WATCH-V2-01**: Watch mode locale

### v2.1+ CI features

- **FUT-01**: Stripe integration + piani paid (Pro / Team)
- **FUT-02**: Matrix runs e artifact passing tra step
- **FUT-03**: Global log search
- **FUT-04**: SSO / OIDC / 2FA
- **FUT-05**: Plugin trigger aggiuntivi (GitLab, Bitbucket, Slack incoming, cron native)
- **FUT-06**: Scheduled tasks (cron) come plugin trigger interno
- **FUT-07**: KMS real integration (AWS KMS / GCP KMS / Vault) sostituisce MEK da env
- **FUT-08**: Multi-region / HA deploy
- **FUT-09**: Task chaining (onSuccess / onFailure)
- **FUT-10**: Agent auto-update

---

## Out of Scope

Escluso esplicitamente. Documentato per evitare scope creep.

| Feature | Status v2.0 | Reason |
|---------|-------------|--------|
| Esecuzione remota / runner SSH | ~~Out of Scope v1~~ → **IN v2.0 via agent WS** | Invertito: dispatch via agent WebSocket |
| Watch mode / file watchers | Out of Scope | Anti-feature locale (resta fuori scope anche v2.0) |
| Trigger automatici locali | Out of Scope | v2.0 ha trigger remoti via plugin; locali restano manuali |
| UI grafica / dashboard | ~~Out of Scope v1~~ → **IN v2.0** | Invertito: SPA `@xci/web` |
| Sostituzione npm scripts / Makefile | Out of Scope | Convive, non rimpiazza |
| Integrazione vault / KMS completa | Out of Scope v2.0 | Hybrid: envelope encryption server-side (SEC-01..08) + per-agent local; KMS reale rimandato a FUT-07 |
| Formati config non-YAML | Out of Scope | Un solo formato per coerenza |
| Dependency graph / incremental builds | Out of Scope | Anti-feature (esplosione complessità) |
| Templating linguistico nel YAML | Out of Scope | Anti-feature (diventa linguaggio) |
| Plugin system dinamico runtime | Out of Scope | Plugin bundled at build time (PLUG-02) — anti-feature per sicurezza |
| Versioning/lock per-progetto | Out of Scope | Versione globale installata |
| `shell: true` default | Out of Scope | Rompe il cross-platform core value |
| Esecuzione come utente diverso (sudo wrap) | Out of Scope | Fuori scope security |
| Notifiche desktop | Out of Scope | Fuori scope |
| Stripe / pagamenti reali | Out of Scope v2.0 | Billing stub-only (QUOTA-*); Stripe a FUT-01 |
| Multi-region / HA server | Out of Scope v2.0 | Single-region single-instance Docker; HA a FUT-08 |
| Matrix runs / artifact passing | Out of Scope v2.0 | Complessità grande; a FUT-02 |
| SSO / OIDC / 2FA | Out of Scope v2.0 | Email+password only; a FUT-04 |
| Auto-update agent binary | Out of Scope (anti-feature) | Security risk; utente aggiorna con `npm i -g xci@latest` |
| Dynamic plugin install from npm at runtime | Out of Scope (anti-feature) | Security risk (supply-chain, arbitrary code) |
| Log search globale | Out of Scope v2.0 | Solo filtri per-run in v2.0; global search a FUT-03 |
| Mobile responsive UI | Out of Scope v2.0 | Desktop ≥1024px only (UI-11) |

---

## Traceability

Quali fasi coprono quali requirement.

### v1.0 (complete)

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01..06 | 01-foundation | Complete |
| CFG-01..10 | 02-config-system | Complete |
| CMD-01..09, INT-01..05 | 03-commands-resolver | Complete |
| EXE-01..07, CLI-01..09 | 04-executor-cli | Complete |
| INIT-01..06, DOC-01..05 | 05-init-distribution | Complete |

**v1.0 coverage:** 57 requirement → 57 mapped.

### v2.0

| Requirement | Phase | Status |
|-------------|-------|--------|
| BC-01 | 06-monorepo-setup | Complete |
| BC-02 | 06-monorepo-setup | Complete |
| BC-03 | 06-monorepo-setup | Complete |
| BC-04 | 06-monorepo-setup | Complete |
| PKG-01 | 06-monorepo-setup | Pending |
| PKG-02 | 06-monorepo-setup | Pending |
| PKG-03 | 06-monorepo-setup | Pending |
| AUTH-01 | 07-database-auth | Complete |
| AUTH-02 | 07-database-auth | Complete |
| AUTH-03 | 07-database-auth | Complete |
| AUTH-04 | 07-database-auth | Complete |
| AUTH-05 | 07-database-auth | Complete |
| AUTH-06 | 07-database-auth | Complete |
| AUTH-07 | 07-database-auth | Complete |
| AUTH-08 | 07-database-auth | Complete |
| AUTH-09 | 07-database-auth | Complete |
| AUTH-10 | 07-database-auth | Complete |
| AUTH-11 | 07-database-auth | Complete |
| AUTH-12 | 07-database-auth | Complete |
| QUOTA-01 | 07-database-auth | Complete |
| QUOTA-02 | 07-database-auth | Complete |
| QUOTA-07 | 07-database-auth | Complete |
| ATOK-01 | 08-agent-ws-protocol | Complete |
| ATOK-02 | 08-agent-ws-protocol | Complete |
| ATOK-03 | 08-agent-ws-protocol | Complete |
| ATOK-04 | 08-agent-ws-protocol | Complete |
| ATOK-05 | 08-agent-ws-protocol | Complete |
| ATOK-06 | 08-agent-ws-protocol | Complete |
| AGENT-01 | 08-agent-ws-protocol | Complete |
| AGENT-02 | 08-agent-ws-protocol | Complete |
| AGENT-03 | 08-agent-ws-protocol | Complete |
| AGENT-04 | 08-agent-ws-protocol | Complete |
| AGENT-05 | 08-agent-ws-protocol | Complete |
| AGENT-06 | 08-agent-ws-protocol | Complete |
| AGENT-07 | 08-agent-ws-protocol | Complete |
| AGENT-08 | 08-agent-ws-protocol | Complete |
| TASK-01 | 09-task-definitions-secrets | Complete |
| TASK-02 | 09-task-definitions-secrets | Complete |
| TASK-03 | 09-task-definitions-secrets | Complete |
| TASK-04 | 09-task-definitions-secrets | Complete |
| TASK-05 | 09-task-definitions-secrets | Complete |
| TASK-06 | 09-task-definitions-secrets | Complete |
| SEC-01 | 09-task-definitions-secrets | Complete |
| SEC-02 | 09-task-definitions-secrets | Complete |
| SEC-03 | 09-task-definitions-secrets | Complete |
| SEC-04 | 09-task-definitions-secrets | Complete |
| SEC-05 | 09-task-definitions-secrets | Complete |
| SEC-06 | 09-task-definitions-secrets | Complete |
| SEC-07 | 09-task-definitions-secrets | Complete |
| SEC-08 | 09-task-definitions-secrets | Complete |
| DISP-01 | 10-dispatch-quota | Complete |
| DISP-02 | 10-dispatch-quota | Complete |
| DISP-03 | 10-dispatch-quota | Complete |
| DISP-04 | 10-dispatch-quota | Complete |
| DISP-05 | 10-dispatch-quota | Complete |
| DISP-06 | 10-dispatch-quota | Complete |
| DISP-07 | 10-dispatch-quota | Complete |
| DISP-08 | 10-dispatch-quota | Complete |
| DISP-09 | 10-dispatch-quota | Complete |
| QUOTA-03 | 10-dispatch-quota | Complete |
| QUOTA-04 | 10-dispatch-quota | Complete |
| QUOTA-05 | 10-dispatch-quota | Complete |
| QUOTA-06 | 10-dispatch-quota | Complete |
| LOG-01 | 11-log-streaming | Complete |
| LOG-02 | 11-log-streaming | Complete |
| LOG-03 | 11-log-streaming | Complete |
| LOG-04 | 11-log-streaming | Pending |
| LOG-05 | 11-log-streaming | Complete |
| LOG-06 | 11-log-streaming | Complete |
| LOG-07 | 11-log-streaming | Complete |
| LOG-08 | 11-log-streaming | Complete |
| PLUG-01 | 12-plugin-webhooks | Pending |
| PLUG-02 | 12-plugin-webhooks | Pending |
| PLUG-03 | 12-plugin-webhooks | Pending |
| PLUG-04 | 12-plugin-webhooks | Pending |
| PLUG-05 | 12-plugin-webhooks | Pending |
| PLUG-06 | 12-plugin-webhooks | Pending |
| PLUG-07 | 12-plugin-webhooks | Pending |
| PLUG-08 | 12-plugin-webhooks | Pending |
| UI-01 | 13-web-dashboard | Pending |
| UI-02 | 13-web-dashboard | Pending |
| UI-03 | 13-web-dashboard | Pending |
| UI-04 | 13-web-dashboard | Pending |
| UI-05 | 13-web-dashboard | Pending |
| UI-06 | 13-web-dashboard | Pending |
| UI-07 | 13-web-dashboard | Pending |
| UI-08 | 13-web-dashboard | Pending |
| UI-09 | 13-web-dashboard | Pending |
| UI-10 | 13-web-dashboard | Pending |
| UI-11 | 13-web-dashboard | Pending |
| BADGE-01 | 13-web-dashboard | Pending |
| BADGE-02 | 13-web-dashboard | Pending |
| BADGE-03 | 13-web-dashboard | Pending |
| BADGE-04 | 13-web-dashboard | Pending |
| PKG-04 | 14-docker-publishing | Pending |
| PKG-05 | 14-docker-publishing | Pending |
| PKG-06 | 14-docker-publishing | Pending |
| PKG-07 | 14-docker-publishing | Pending |
| PKG-08 | 14-docker-publishing | Pending |

**v2.0 coverage:** 99 requirements → 99 mapped. No orphans.

---

*v1.0 requirements defined: 2026-04-10 · Last updated: 2026-04-16 after adding milestone v2.0 requirements and traceability*
