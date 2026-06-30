---
gsd_state_version: 1.0
milestone: v2.1
milestone_name: Quality & Parity
status: Phase complete — ready for verification
stopped_at: Completed quick task 260630-quj — capture regex multiline flag default
last_updated: "2026-06-30T17:19:50.818Z"
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 5
  completed_plans: 5
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-01)

**Core value:** Un alias → sempre lo stesso comando eseguito correttamente, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.
**Current focus:** Phase 16 — go-cli-output-infrastructure

## Current Position

Phase: 16 (go-cli-output-infrastructure) — EXECUTING
Plan: 2 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 12 (v1.0) + 50 (v2.0) + 3 (Phase 15) = 65 total
- Average duration: ~8 min/plan (Phase 07 estimate; varies widely)
- Total execution time: tracked per plan below

**By Phase (v2.1 — in progress):**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 16 | TBD | - | - |
| 17 | TBD | - | - |
| 18 | TBD | - | - |
| 19 | TBD | - | - |
| 20 | TBD | - | - |

**Recent Trend (Phase 15):**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 15 P01 | 156s | 2 | 2 |
| Phase 15 P02 | 7s | 2 | 4 |
| Phase 15 P03 | 600s | 2 | 2 |

*Updated after each plan completion*
| Phase 16-go-cli-output-infrastructure P01 | 10 | 2 tasks | 4 files |
| Phase 16-go-cli-output-infrastructure P02 | 3 | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.1 Roadmap]: 5 phases (16–20), 13 requirements, all mapped with no orphans
- [v2.1 Roadmap]: GOCLI-06 is Phase 16 — creates output.go which all other Go parity phases depend on; must be first
- [v2.1 Roadmap]: GOCLI-07/08/09/10 grouped in Phase 17 (depends on Phase 16 output.go infrastructure)
- [v2.1 Roadmap]: DISP-01 + DX-01 grouped in Phase 18 — independent of Go feature phases; DX-01 Go part depends on Phase 16 (cobra completion infra), grouped together at coarse granularity
- [v2.1 Roadmap]: SEC-01 + SEC-02 grouped in Phase 19 — both server-side, independent of Go phases
- [v2.1 Roadmap]: QA-01 + QA-02 + OPS-01 + OPS-02 grouped in Phase 20 — quality/devops cleanup done last after all feature work; QA-02 bundle baseline more accurate after Phase 18 final TS bundle
- [v2.1 Roadmap]: OPS-01 + OPS-02 are GitHub repo configuration, not code — kept in Phase 20 rather than a separate phase at coarse granularity
- [Phase 15]: interpolateTokenMultiPass uses persistent escape sentinel across the entire multi-pass loop to prevent literal outputs from being re-expanded on subsequent passes
- [Phase 15]: checkSecretsTracked uses git ls-files --error-unmatch; exit 0 = tracked, any error = silently ignored
- [Phase 15]: validateParams error format: alias X: required parameter Y is not defined
- [Phase 15]: Passthrough switch replaces single-condition if block; KindSingle/KindSequential/KindParallel all handled with empty-slice guard
- [Phase 16-go-cli-output-infrastructure]: ShouldUseColor checks stderr TTY via go-isatty (not color.NoColor default which uses stdout) — prevents color regression when stdout is redirected
- [Phase 16-go-cli-output-infrastructure]: PrintStepCwd added in Phase 16 output package to prevent sequential.go cwd regression when step headers are upgraded (Phase 17 GOCLI-10 then extends it)
- [Phase 16-go-cli-output-infrastructure]: PrintRunHeader receives cmds[alias] (raw CommandDef) not plan — enables placeholder scanning without import cycle risk
- [Phase 16-go-cli-output-infrastructure]: InitColor placed in runAlias (cmd/run.go) not PersistentPreRun — run is only command path needing color; list/init/__complete unaffected

### Critical Pitfalls (v2.1 — from research)

1. **Completion stdout pollution (Go):** Any `fmt.Println` in startup path breaks `__complete`. All diagnostics must use `os.Stderr`. Test with `xci __complete xci "" "" ""`.
2. **seq collision (DISP-01):** DB unique constraint on `(run_id, seq)` — global counter object required, not per-step closures that reset to 0.
3. **Session migration cutover (SEC-01):** Hard cutover logs out all users. Two-phase migration with dual-read backfill is mandatory.
4. **Windows ANSI (Go):** Raw `\x1b[` codes fail in cmd.exe. Use `fatih/color` — handles `ENABLE_VIRTUAL_TERMINAL_PROCESSING` automatically.
5. **HIBP fail-open (SEC-02):** Use `AbortSignal.timeout(3000)` + try/catch. Block signup only on confirmed breach.
6. **Biome unsafe fixes (QA-01):** Do NOT run `--unsafe` on resolver/config code. Batch by package area; test files first.
7. **for_each loop variable re-interpolation (GOCLI-07):** TypeScript fix is 260421-lhg. Go port must replicate the same semantics.

### Pending Todos

- Branch protection on main (OPS-01) — Phase 20
- NPM_TOKEN secret setup (OPS-02) — Phase 20
- Bundle-size gate wiring (QA-02) — Phase 20; re-evaluate baseline threshold after Phase 18 final bundle
- 68 Biome style errors in packages/xci/src/ (QA-01) — Phase 20
- Session token hashing at rest (SEC-01) — Phase 19; two-phase migration required
- haveibeenpwned check on signup/reset (SEC-02) — Phase 19
- Agent multi-step dispatch (DISP-01) — Phase 18; deferred from Phase 10
- Shell completions bash/zsh/fish (DX-01 TS part) — Phase 18; PowerShell already done
- Go cobra completions (DX-01 Go part) — Phase 18; depends on Phase 16 output.go (startup-path cleanliness)

### Blockers/Concerns

None

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260630-quj | Fix capture regex — add `'m'` (multiline) flag default in `extractFromOutput` so `^`/`$` anchor per-line on multi-line command output; rebuilt + reinstalled xci | 2026-06-30 | 42aca9b | [260630-quj-fix-capture-regex-add-multiline-flag-def](./quick/260630-quj-fix-capture-regex-add-multiline-flag-def/) |
| 260624-fse | Add `unreadonly` command kind — removes readonly filesystem attributes via fs.chmodSync (file: 0o666, dir: 0o777, recursive walk) wired through all 5 pipeline stages | 2026-06-24 | 208852a | [260624-fse-add-unreadonly-kind](./quick/260624-fse-add-unreadonly-kind/) |
| 260623-k2w | Security fix: redact secret values as substrings in argv tokens and cwd strings (closes token=${SECRET} cleartext leak) | 2026-06-23 | 68e0eb9 | [260623-k2w-redact-secret-values-as-substrings-in-ar](./quick/260623-k2w-redact-secret-values-as-substrings-in-ar/) |
| 260623-jqc | Print bright-cyan delegation banner (target folder + redacted params) to stderr at both kind:xci call sites | 2026-06-23 | 11c84dc | [260623-jqc-print-cyan-delegation-banner-with-target](./quick/260623-jqc-print-cyan-delegation-banner-with-target/) |
| 260623-ipz | Propagate XCI breadcrumb across delegate boundary — full cross-process path in step headers and run header | 2026-06-23 | 25dead7 | [260623-ipz-propagate-xci-delegate-breadcrumb-across](./quick/260623-ipz-propagate-xci-delegate-breadcrumb-across/) |
| 260623-hp3 | Fix kind:xci delegated output not shown — tee to terminal + logfile, piped+exit-event anti-hang | 2026-06-23 | 3c90081 | [260623-hp3-fix-xci-kind-delegated-output-not-shown-](./quick/260623-hp3-fix-xci-kind-delegated-output-not-shown-/) |
| 260623-fr4 | Add xci command kind (delegate to a nested xci project) | 2026-06-23 | 3cd5c18 | [260623-fr4-aggiungere-command-kind-xci-delega-a-un-](./quick/260623-fr4-aggiungere-command-kind-xci-delega-a-un-/) |
| 260605-of7 | notify waiting for input on prompt step | 2026-06-05 | f6a3685 | [260605-of7-notify-waiting-for-input-on-prompt-step](.planning/quick/260605-of7-notify-waiting-for-input-on-prompt-step/) |
| 260415-j2u | Rename CLI command from loci to xci | 2026-04-15 | 3f37119 | [260415-j2u-rename-cli-command-from-loci-to-xci](./quick/260415-j2u-rename-cli-command-from-loci-to-xci/) |
| 260415-jxl | Add CLI KEY=VALUE parameter overrides | 2026-04-15 | 5a1fa83 | [260415-jxl-add-cli-key-value-parameter-overrides](./quick/260415-jxl-add-cli-key-value-parameter-overrides/) |
| 260418-lav | Add home-dir fallback for XCI_MACHINE_CONFIGS + hard-error on invalid env path | 2026-04-18 | 70ab4c1 | [260418-lav-add-home-dir-fallback-for-xci-machine-co](./quick/260418-lav-add-home-dir-fallback-for-xci-machine-co/) |
| 260420-ezf | Fix CLI agent dynamic import in bundled cli.mjs | 2026-04-20 | 2239202 | [260420-ezf-fix-cli-agent-dynamic-import-in-bundled-](./quick/260420-ezf-fix-cli-agent-dynamic-import-in-bundled-/) |
| 260420-ggj | Harden xci agent URL handling and connection UX | 2026-04-20 | 1d11d70 | [260420-ggj-harden-xci-agent-url-handling-and-connec](./quick/260420-ggj-harden-xci-agent-url-handling-and-connec/) |
| 260420-hcc | Fix web dashboard — Tailwind tokens, agent PATCH endpoints, persistent token button | 2026-04-20 | 7e04b8b | [260420-hcc-fix-web-dashboard-tailwind-tokens-agent-](./quick/260420-hcc-fix-web-dashboard-tailwind-tokens-agent-/) |
| 260420-hzy | Wire New Task flow + fix yamlDefinition camelCase mismatch | 2026-04-20 | ba692ce | [260420-hzy-wire-new-task-flow-fix-yamldefinition-ca](./quick/260420-hzy-wire-new-task-flow-fix-yamldefinition-ca/) |
| 260420-j4r | Auto-cleanup ghost cancel frames with synthetic result reply | 2026-04-20 | 63f4ab1 | [260420-j4r-auto-cleanup-ghost-cancel-frames-with-sy](./quick/260420-j4r-auto-cleanup-ghost-cancel-frames-with-sy/) |
| 260420-k6m | Fix agent dispatch-reject crash + log all WS frames | 2026-04-20 | e14a45a | [260420-k6m-fix-agent-dispatch-reject-crash-log-all-](./quick/260420-k6m-fix-agent-dispatch-reject-crash-log-all-/) |
| 260420-ktf | Agent supports single-alias DSL tasks via shared parseYaml | 2026-04-20 | 7db492d | [260420-ktf-agent-supports-single-alias-dsl-tasks-vi](./quick/260420-ktf-agent-supports-single-alias-dsl-tasks-vi/) |
| 260420-l9i | LogViewer fetches log history via WS for terminal runs | 2026-04-20 | 99ef099 | [260420-l9i-logviewer-fetches-log-history-via-ws-for](./quick/260420-l9i-logviewer-fetches-log-history-via-ws-for/) |
| 260420-llo | Agent echoes task stdout/stderr to local terminal | 2026-04-20 | 93be7cf | [260420-llo-agent-echoes-task-stdout-stderr-to-local](./quick/260420-llo-agent-echoes-task-stdout-stderr-to-local/) |
| 260420-lxj | Print error lines before show-log prompt on failure | 2026-04-20 | 5b86795 | [260420-lxj-print-error-lines-before-show-log-prompt](./quick/260420-lxj-print-error-lines-before-show-log-prompt/) |
| 260420-mqy | Detect nested placeholders in param validator | 2026-04-20 | ec737a5 | [260420-mqy-detect-nested-placeholders-in-param-vali](./quick/260420-mqy-detect-nested-placeholders-in-param-vali/) |
| 260420-t6q | Fix SMTP transport empty creds | 2026-04-20 | b7eff1c | [260420-t6q-fix-smtp-transport-empty-creds](./quick/260420-t6q-fix-smtp-transport-empty-creds/) |
| 260420-v15 | Make email link base URL configurable | 2026-04-20 | b5dc145 | [260420-v15-make-email-link-base-url-configurable](./quick/260420-v15-make-email-link-base-url-configurable/) |
| 260420-vqw | Align email link paths with frontend routes | 2026-04-20 | b1f889a | [260420-vqw-align-email-link-paths-with-frontend-rou](./quick/260420-vqw-align-email-link-paths-with-frontend-rou/) |
| 260421-d0r | Add colored xci output + run-header recap with variables and steps | 2026-04-21 | 9b4fb79 | [260421-d0r-aggiungere-colori-all-output-di-xci-e-un](./quick/260421-d0r-aggiungere-colori-all-output-di-xci-e-un/) |
| 260421-ewq | Allow for_each.in to accept ${VAR} placeholder (CSV-split at resolve time) | 2026-04-21 | 1362c77 | [260421-ewq-allow-for-each-in-to-accept-a-var-placeh](./quick/260421-ewq-allow-for-each-in-to-accept-a-var-placeh/) |
| 260421-g99 | Add optional cwd field to xci aliases with parent-child inheritance | 2026-04-21 | 2a57f05 | [260421-g99-add-optional-cwd-field-to-xci-aliases-wo](./quick/260421-g99-add-optional-cwd-field-to-xci-aliases-wo/) |
| 260421-hnr | Fix TypeError in cli.ts when for_each.in is a string (regression from 260421-ewq) | 2026-04-21 | 86ff3a3 | [260421-hnr-fix-typeerror-in-cli-ts-when-for-each-in](./quick/260421-hnr-fix-typeerror-in-cli-ts-when-for-each-in/) |
| 260421-kbl | Show full breadcrumb (A > A1 > A1a) in step headers during nested execution | 2026-04-21 | 18d8ea8 | [260421-kbl-show-full-breadcrumb-a-a1-a1a-in-step-he](./quick/260421-kbl-show-full-breadcrumb-a-a1-a1a-in-step-he/) |
| 260421-lhg | fix for_each loop variable lost during runtime re-interpolation of rawArgv | 2026-04-21 | 4c3e576 | [260421-lhg-fix-for-each-loop-variable-lost-during-r](./quick/260421-lhg-fix-for-each-loop-variable-lost-during-r/) |
| 260421-nmx | print step cwd in dark yellow before each spawn | 2026-04-21 | e6ff3bd | [260421-nmx-print-step-cwd-in-dark-yellow-before-eac](./quick/260421-nmx-print-step-cwd-in-dark-yellow-before-eac/) |
| 260422-dfh | Fix for_each loop variable not available during step re-interpolation in sequential executor | 2026-04-22 | d771b51 | [260422-dfh-fix-for-each-loop-variable-not-available](./quick/260422-dfh-fix-for-each-loop-variable-not-available/) |
| 260422-mxr | print effective cwd in dark yellow before every sequential step + verify nested cwd inheritance | 2026-04-22 | f1fd3f8 | [260422-mxr-print-effective-cwd-in-dark-yellow-befor](./quick/260422-mxr-print-effective-cwd-in-dark-yellow-befor/) |
| 260422-pnv | always print effective cwd for single/parallel commands and unconditionally in printRunHeader | 2026-04-22 | e79f2ac | [260422-pnv-always-print-cwd-single-parallel-and-run-head](./quick/260422-pnv-always-print-cwd-single-parallel-and-run-head/) |
| 260531-sgb | Create Go CLI go-xci project — single-binary Go port of xci with cobra, 4-layer config, executor | 2026-05-31 | bf52c12 | [260531-sgb-crea-progetto-go-cli-go-xci-nella-cartel](./quick/260531-sgb-crea-progetto-go-cli-go-xci-nella-cartel/) |
| 260605-mgy | Add cross-platform OS desktop notifications on xci completion via XCI_NOTIFY=1 | 2026-06-05 | c09d306 | [260605-mgy-aggiungere-notifiche-di-sistema-windows-](./quick/260605-mgy-aggiungere-notifiche-di-sistema-windows-/) |
| 260605-mvt | Remove beepCompletion/XCI_BEEP, make OS notification always-on | 2026-06-05 | 387483a | [260605-mvt-rimuovere-beepcompletion-e-xci-beep-rend](./quick/260605-mvt-rimuovere-beepcompletion-e-xci-beep-rend/) |
| 260605-n67 | Fix all TypeScript compilation errors in packages/xci (zero tsc errors) | 2026-06-05 | 7ba2dad | [260605-n67-fix-all-typescript-compilation-errors-in](./quick/260605-n67-fix-all-typescript-compilation-errors-in/) |
| 260605-of7 | Notify waiting for input on prompt step | 2026-06-05 | 8d41580 | [260605-of7-notify-waiting-for-input-on-prompt-step](./quick/260605-of7-notify-waiting-for-input-on-prompt-step/) |
| 260605-pg5 | Fix CTRL+C exit code 130 handling — skip toast and askShowLog on SIGINT | 2026-06-05 | f8f744e | [260605-pg5-fix-ctrl-c-exit-code-130-handling-skip-t](./quick/260605-pg5-fix-ctrl-c-exit-code-130-handling-skip-t/) |
| 260605-q1f | Add CLI-level multi-alias + composition (sequential and --parallel) | 2026-06-05 | 42448ae | [260605-q1f-add-cli-level-multi-alias-composition-wi](./quick/260605-q1f-add-cli-level-multi-alias-composition-wi/) |
| 260612-lbn | Validate cwd exists before spawning child process (CwdMissingError) | 2026-06-12 | aa9ff20 | [260612-lbn-validate-cwd-exists-before-spawning-chil](./quick/260612-lbn-validate-cwd-exists-before-spawning-chil/) |
| 260618-h1d | Add `uproject` command kind to xci DSL — Unreal Engine .uproject JSON editing (enable/disable/remove plugins, set fields) | 2026-06-18 | 08bbeac | [260618-h1d-aggiungere-command-kind-uproject-alla-ds](./quick/260618-h1d-aggiungere-command-kind-uproject-alla-ds/) |

## Session Continuity

Last session: 2026-06-30
Stopped at: Completed quick task 260630-quj — capture regex multiline flag default
Resume: Phase 16 — Go CLI Output Infrastructure (`/gsd:plan-phase 16`)
