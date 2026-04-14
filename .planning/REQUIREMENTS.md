# Requirements: loci

**Defined:** 2026-04-10
**Core Value:** Un alias → sempre lo stesso comando eseguito correttamente, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [x] **FND-01**: Il progetto è un package Node.js ESM-only, TypeScript, bundled con tsup in un singolo `.mjs`, pubblicabile su npm pubblico come `loci`
- [x] **FND-02**: Il bin `loci` è installabile globalmente (`npm i -g loci`) e funziona identicamente su Windows 10+, Linux moderno, macOS moderno
- [x] **FND-03**: Cold start del comando `loci --version` inferiore a 300ms su hardware moderno
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
- [x] **CFG-09**: Se `secrets.yml` è presente, loci verifica con `git ls-files --error-unmatch` che NON sia tracciato dal repo; se lo è, emette un warning esplicito (non blocca l'esecuzione)
- [x] **CFG-10**: Parser YAML usato garantisce semantica YAML 1.2 (nessuna coercion di `no`/`yes`/`on`/`off` come boolean, nessuna interpretazione di `0123` come ottale)

### Commands System

- [x] **CMD-01**: Utente può definire `.loci/commands.yml` (committato) con mapping `alias → definizione comando`
- [x] **CMD-02**: Una definizione comando può essere un singolo comando (string o argv array)
- [x] **CMD-03**: Una definizione comando può essere una **sequenza**: lista ordinata di comandi eseguiti in serie; la catena si interrompe al primo comando con exit code ≠ 0
- [x] **CMD-04**: Una definizione comando può essere un **gruppo parallelo**: lista di comandi eseguiti contemporaneamente; se uno fallisce, gli altri vengono terminati
- [x] **CMD-05**: Una definizione comando può riferire altri alias definiti nello stesso file (**composizione**), es. `ci` = `[lint, test, build]` dove ciascuno è a sua volta un alias
- [x] **CMD-06**: Il commands loader rileva cicli di composizione (`A → B → A`) al load time e emette errore con la catena completa del ciclo
- [x] **CMD-07**: Una definizione comando può includere blocchi opzionali `linux:` / `windows:` / `macos:` che sovrascrivono il comando di default per quella piattaforma
- [x] **CMD-08**: Una definizione comando può includere una `description` opzionale, usata in `loci --list` e `loci <alias> --help`
- [x] **CMD-09**: Il commands loader emette errore se un alias referenziato (in composizione) non esiste

### Interpolation & Env Injection

- [x] **INT-01**: I comandi supportano placeholder `${NOME}` che vengono risolti dal merged config prima dello spawn
- [x] **INT-02**: Se un placeholder referenzia un parametro non presente in nessun file di config, loci emette errore esplicito con nome del parametro e alias di origine — il comando NON viene eseguito
- [x] **INT-03**: I valori interpolati vengono inseriti come argv token separati (non concatenati in una shell string), così valori con spazi/quote/metacaratteri non rompono nulla e non permettono injection
- [x] **INT-04**: Tutti i parametri del merged config vengono iniettati automaticamente come variabili d'ambiente del processo figlio, così i sub-comandi possono leggerli con `process.env.X` senza bisogno di interpolazione esplicita
- [x] **INT-05**: I valori marcati come provenienti da `secrets.yml` sono esclusi dai log di debug/verbose (sanitization layer), e sostituiti da `***` in `--dry-run`

### Execution

- [x] **EXE-01**: I comandi vengono eseguiti con `execa` usando `shell: false` di default (argv array, cross-platform garantito, `PATHEXT` gestito)
- [x] **EXE-02**: stdout e stderr dei processi figli sono streamati in tempo reale allo stdout/stderr di loci (no buffering)
- [x] **EXE-03**: L'exit code di loci riflette l'esito del comando eseguito: 0 se successo; primo exit code non-zero nella catena se sequenza fallisce; exit code del primo fallito se gruppo parallelo fallisce
- [x] **EXE-04**: In un gruppo parallelo, quando un comando fallisce, i comandi ancora in esecuzione vengono terminati (kill cross-platform via `execa.kill()` + cleanup orfani con `tree-kill` o equivalente su Windows)
- [x] **EXE-05**: L'output dei comandi paralleli è prefissato con il nome/indice del comando per distinguerlo (stile `concurrently`)
- [x] **EXE-06**: Il working directory dei processi figli è la root del progetto (dove risiede `.loci/`)
- [x] **EXE-07**: SIGINT (Ctrl+C) propaga correttamente al processo figlio e loci esce pulitamente, senza lasciare orfani

### CLI Frontend

- [x] **CLI-01**: CLI basata su commander.js (v14 stabile), registra dinamicamente a runtime i comandi caricati da `.loci/commands.yml`
- [x] **CLI-02**: `loci` senza argomenti mostra la lista degli alias disponibili con le loro `description`
- [x] **CLI-03**: `loci --list` (o `-l`) mostra la stessa lista in formato compatto
- [x] **CLI-04**: `loci --help` mostra l'help generale; `loci <alias> --help` mostra l'help specifico dell'alias
- [x] **CLI-05**: `loci <alias> -- <extra args>` passa `<extra args>` al comando sottostante senza interpretarli (via `passThroughOptions` + `enablePositionalOptions`)
- [x] **CLI-06**: `loci <alias> --dry-run` risolve e stampa il comando (o la catena/gruppo) che verrebbe eseguito, con i secrets sostituiti da `***`, senza eseguirlo
- [x] **CLI-07**: `loci <alias> --verbose` stampa informazioni di debug: quali file di config sono stati letti, da dove proviene ogni chiave, comando finale risolto, valori NON secret
- [x] **CLI-08**: `loci --version` stampa la versione del package
- [x] **CLI-09**: Errori (config, placeholder mancante, alias sconosciuto, YAML invalido, ciclo di composizione) sono presentati con categoria, causa, e suggerimento quando possibile; exit code dedicati per categoria (≠ 0)

### Init Command

- [ ] **INIT-01**: `loci init` scaffolda la cartella `.loci/` nella root del progetto corrente
- [ ] **INIT-02**: `loci init` crea `.loci/config.yml` di esempio (committato) con commenti esplicativi
- [ ] **INIT-03**: `loci init` crea `.loci/secrets.yml.example` e `.loci/local.yml.example` (committabili come template) ma NON i file reali — l'utente li copia se servono
- [ ] **INIT-04**: `loci init` crea `.loci/commands.yml` di esempio con 2-3 alias dimostrativi (singolo, sequenza, parallelo)
- [ ] **INIT-05**: `loci init` aggiunge `.loci/secrets.yml` e `.loci/local.yml` al `.gitignore` del progetto (crea il file se non esiste; non duplica se già presenti)
- [ ] **INIT-06**: `loci init` è idempotente: non sovrascrive file esistenti, stampa un riepilogo di cosa ha creato e cosa ha saltato

### Documentation & Distribution

- [ ] **DOC-01**: README con quickstart (install, `loci init`, primo alias, esecuzione), spiegazione dei 4 livelli di config, esempio di `commands.yml`
- [ ] **DOC-02**: README documenta esplicitamente che il default è `shell: false` (niente pipe/redirect nei comandi) e mostra il pattern "wrap in script file" per chi ne ha bisogno
- [ ] **DOC-03**: README documenta i blocchi `linux:`/`windows:`/`macos:` per varianti di comando per piattaforma
- [ ] **DOC-04**: LICENSE file (MIT o simile) presente
- [ ] **DOC-05**: Package pubblicato su npm pubblico con nome disponibile; verifica `npm view loci` prima del primo publish (fallback: scegliere un altro nome se occupato)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### DX enhancements

- **DX-V2-01**: Shell completions per bash / zsh / fish / PowerShell (commander supporta la generazione, ma il command surface deve stabilizzarsi prima)
- **DX-V2-02**: `loci <alias> --timing` mostra la durata di ogni comando della catena
- **DX-V2-03**: Colorazione output configurabile e rispetto di `NO_COLOR` / `FORCE_COLOR`
- **DX-V2-04**: `loci config` per ispezionare il merged config (con redaction) e vedere da quale file arriva ogni chiave

### Extended commands

- **CMD-V2-01**: Supporto opt-in `shell: true` per singolo comando nel YAML, con warning esplicito sul rischio cross-platform
- **CMD-V2-02**: Comandi condizionali (esegui se file esiste / se env var settata)
- **CMD-V2-03**: `workingDir:` per-comando per override del cwd

### Watch & trigger

- **WATCH-V2-01**: Watch mode che riesegue un alias su modifica file (low priority, explicit anti-feature in v1)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Esecuzione remota / runner SSH | loci esegue sempre in locale; chi vuole deploy remoto invoca `ssh`/`rsync` da dentro un alias |
| Watch mode / file watchers in v1 | Anti-feature: storico di complessità in Grunt/Gulp/task; si può aggiungere dopo senza breaking |
| Trigger automatici via git hooks | Fuori scope: loci si invoca a mano |
| UI grafica / dashboard | Solo CLI |
| Sostituzione di npm scripts / Makefile | loci convive, non rimpiazza; gli alias possono chiamare `npm run x` o `make x` |
| Integrazione vault / KMS per secrets | `secrets.yml` è in chiaro protetto da `.gitignore`; vault esterni non nello scope iniziale |
| Formati config diversi da YAML (JSON/TOML/.env) | Un solo formato per coerenza; YAML scelto per leggibilità + commenti |
| Dependency graph / incremental builds | Anti-feature: complessità esplosiva (make, bazel, turborepo già lo fanno) |
| Templating linguistico (loop, condizionali) nel YAML | Anti-feature: diventa un linguaggio di programmazione; usare script esterni |
| Plugin system in v1 | Prematuro: stabilizzare il core prima |
| Versioning / lock di loci per-progetto | Una sola versione globale installata |
| `shell: true` come default | Rompe il core value cross-platform; opt-in per-comando rimandato a v2 |
| Esecuzione di comandi come utente diverso (sudo wrapping) | Fuori scope security |
| Notifiche / integrazione con desktop | Fuori scope |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Complete |
| FND-02 | Phase 1 | Complete |
| FND-03 | Phase 1 | Complete |
| FND-04 | Phase 1 | Complete |
| FND-05 | Phase 1 | Complete |
| FND-06 | Phase 1 | Complete |
| CFG-01 | Phase 2 | Complete |
| CFG-02 | Phase 2 | Complete |
| CFG-03 | Phase 2 | Complete |
| CFG-04 | Phase 2 | Complete |
| CFG-05 | Phase 2 | Complete |
| CFG-06 | Phase 2 | Complete |
| CFG-07 | Phase 2 | Complete |
| CFG-08 | Phase 2 | Complete |
| CFG-09 | Phase 2 | Complete |
| CFG-10 | Phase 2 | Complete |
| CMD-01 | Phase 3 | Complete |
| CMD-02 | Phase 3 | Complete |
| CMD-03 | Phase 3 | Complete |
| CMD-04 | Phase 3 | Complete |
| CMD-05 | Phase 3 | Complete |
| CMD-06 | Phase 3 | Complete |
| CMD-07 | Phase 3 | Complete |
| CMD-08 | Phase 3 | Complete |
| CMD-09 | Phase 3 | Complete |
| INT-01 | Phase 3 | Complete |
| INT-02 | Phase 3 | Complete |
| INT-03 | Phase 3 | Complete |
| INT-04 | Phase 3 | Complete |
| INT-05 | Phase 3 | Complete |
| EXE-01 | Phase 4 | Complete |
| EXE-02 | Phase 4 | Complete |
| EXE-03 | Phase 4 | Complete |
| EXE-04 | Phase 4 | Complete |
| EXE-05 | Phase 4 | Complete |
| EXE-06 | Phase 4 | Complete |
| EXE-07 | Phase 4 | Complete |
| CLI-01 | Phase 4 | Complete |
| CLI-02 | Phase 4 | Complete |
| CLI-03 | Phase 4 | Complete |
| CLI-04 | Phase 4 | Complete |
| CLI-05 | Phase 4 | Complete |
| CLI-06 | Phase 4 | Complete |
| CLI-07 | Phase 4 | Complete |
| CLI-08 | Phase 4 | Complete |
| CLI-09 | Phase 4 | Complete |
| INIT-01 | Phase 5 | Pending |
| INIT-02 | Phase 5 | Pending |
| INIT-03 | Phase 5 | Pending |
| INIT-04 | Phase 5 | Pending |
| INIT-05 | Phase 5 | Pending |
| INIT-06 | Phase 5 | Pending |
| DOC-01 | Phase 5 | Pending |
| DOC-02 | Phase 5 | Pending |
| DOC-03 | Phase 5 | Pending |
| DOC-04 | Phase 5 | Pending |
| DOC-05 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 57 total (FND×6, CFG×10, CMD×9, INT×5, EXE×7, CLI×9, INIT×6, DOC×5)
- Mapped to phases: 57
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-10*
*Last updated: 2026-04-10 after roadmap creation*
