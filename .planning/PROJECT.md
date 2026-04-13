# loci

## What This Is

`loci` è un tool CLI cross-platform (Windows, Linux, macOS) scritto in Node.js che esegue comandi da riga di comando definiti in file di configurazione del progetto. È una specie di "CI tool locale": definisci una volta gli alias dei comandi (con i loro parametri) in un file versionato, poi richiami quegli alias da terminale ovunque stia lavorando, e `loci` li esegue con i parametri risolti secondo una gerarchia di config a 4 livelli.

Serve a chi lavora su più progetti e vuole evitare di ricordare/digitare a mano lunghe sequenze di build, package, deploy, o altri comandi ripetitivi, condividendo le definizioni col team ma mantenendo locali i segreti e gli override per-macchina.

## Core Value

**Un alias → sempre lo stesso comando eseguito correttamente**, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.

## Requirements

### Validated

- [x] Carica e fonde config da 4 livelli con precedenza deterministica (machine < project < secrets < local) — Validated in Phase 2: Config System
- [x] Formato file di config: YAML (con semantica YAML 1.2 — yes/no/on/off sono stringhe) — Validated in Phase 2: Config System
- [x] Precedenza di merge (ultimo vince): machine → project → secrets → local — Validated in Phase 2: Config System
- [x] File secrets.yml protetto: warning stderr se tracciato da git, valori mai loggati — Validated in Phase 2: Config System
- [x] Errore chiaro con filename e riga per YAML malformato — Validated in Phase 2: Config System

### Active

- [ ] CLI Node.js basato su commander.js, installabile globalmente da npm (`npm i -g loci`)
- [ ] Funziona identicamente su Windows, Linux, macOS
- [ ] Carica e fonde config da 4 livelli con precedenza deterministica:
  1. **Machine** — path del file indicato dalla env var `LOCI_MACHINE_CONFIG`
  2. **Project** — `.loci/config.yml` nella root del progetto, committato
  3. **Secrets** — `.loci/secrets.yml` nella root del progetto, gitignored (token, password)
  4. **Local** — `.loci/local.yml` nella root del progetto, gitignored (override per-PC dei valori machine/project)
- [ ] Formato file di config: **YAML**
- [ ] Precedenza di merge (ultimo vince): machine → project → secrets → local
- [ ] File comandi `.loci/commands.yml` committato, mappa `alias → comando` (o catena/gruppo di comandi)
- [ ] Tipi di comando supportati:
  - Singolo comando shell
  - **Catena sequenziale** — lista di comandi eseguiti in ordine, con **stop al primo fallimento** (exit code ≠ 0)
  - **Gruppo parallelo** — lista di comandi eseguiti contemporaneamente
  - **Composizione** — un alias può riferire altri alias definiti nello stesso file (riuso)
- [ ] Interpolazione parametri nei comandi tramite placeholder `${NOME}` che risolve dal config unito
- [ ] Output dei comandi figli streamato su stdout/stderr in tempo reale
- [ ] Exit code del comando (o del primo fallito nella catena) propagato come exit code di `loci`
- [ ] Errore chiaro se un placeholder referenzia un parametro non definito in nessun livello
- [ ] Comando `loci` senza argomenti (o `loci --help`) elenca gli alias disponibili con loro descrizione

### Out of Scope

- **Esecuzione remota / runner SSH** — loci esegue sempre in locale. Se serve deploy remoto, il comando locale può invocare `ssh`/`rsync`, ma loci non gestisce connessioni.
- **Trigger automatici (file watcher, git hooks)** — loci si invoca a mano. Niente watch mode, niente hook automatici, almeno inizialmente.
- **UI grafica / dashboard** — solo CLI.
- **Sostituzione di npm scripts / Makefile** — loci non vuole rimpiazzarli, vive affianco. Gli alias possono comunque chiamare `npm run x` o `make x`.
- **Gestione segreti via vault / KMS** — il file `secrets.yml` è in chiaro, protetto solo da `.gitignore`. Integrazione con vault esterni non è nello scope iniziale.
- **Support per linguaggi di config diversi da YAML** (JSON, TOML, .env) — scelto YAML e basta, per coerenza.
- **Versioning / lock del tool per progetto** — versione unica globale installata. Niente `loci.lock` o auto-update per-progetto.

## Context

- **Utente target iniziale**: developer singolo che lavora su più progetti con stack diversi e vuole standardizzare il modo in cui lancia build/package/deploy.
- **Primo caso d'uso concreto** dichiarato: catena `build → package → deploy`.
- **Ecosistema**: Node.js moderno, npm pubblico come canale di distribuzione.
- **Stile comandi**: CLI in stile `commander.js` (sub-command, flag POSIX-style).
- **Cross-platform**: esecuzione comandi shell deve funzionare su `cmd.exe`/PowerShell su Windows e su `sh`/`bash`/`zsh` su Unix. Questo impone uso di librerie tipo `execa` / `cross-spawn` per lo spawn dei processi figli.
- **Filosofia**: "convention over configuration" dove ragionevole, ma la gerarchia di config a 4 livelli è esplicita perché rispecchia una reale separazione di responsabilità (defaults di sistema vs defaults di progetto vs segreti vs override locali).

## Constraints

- **Tech stack**: Node.js (runtime LTS supportato), TypeScript consigliato per DX e type-safety dei config parsing. Commander.js come base CLI.
- **Compatibility**: Windows 10+, Linux moderno, macOS moderno. Deve girare su tutti e tre con stesso comportamento osservabile.
- **Distribution**: pubblicato su npm pubblico, installazione tramite `npm i -g loci`. Nessun binario compilato (richiede Node installato sul sistema).
- **Dependencies**: minime. Principali candidate: `commander`, `js-yaml`, `execa` (o `cross-spawn`). Evitare dipendenze pesanti o con transitive troppo ampie.
- **Security**: il file `secrets.yml` deve essere letto solo se esiste; il tool deve emettere un warning (o errore configurabile) se viene trovato accidentalmente tracciato dal git. Loci NON deve mai loggare i valori dei secrets in output di debug.
- **Performance**: l'overhead di startup deve restare sotto la soglia percettibile (indicativo: < 300ms cold start su hardware moderno) perché verrà chiamato molte volte al giorno.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Nome `loci` | Gioco di parole "local CI", breve (4 lettere), pronunciabile, disponibile come nome npm da verificare | — Pending |
| YAML per i file di config | Leggibile, supporta commenti, struttura nested, libreria matura (`js-yaml`) | — Pending |
| Cartella `.loci/` con file separati (anziché file singoli in root) | Evita di affollare la root del progetto, tiene raggruppata la config, convenzione `.dotfolder` già familiare | — Pending |
| Env var `LOCI_MACHINE_CONFIG` punta al file (non a una cartella) | Esplicito, flessibile (puoi nominare il file come vuoi), nome chiaro sullo scopo | — Pending |
| Precedenza merge: machine → project → secrets → local | Local override deve vincere su tutto perché è "override per-PC"; secrets vince su project perché contiene i valori "reali" che altrimenti non ci sarebbero | — Pending |
| Interpolazione con placeholder `${NAME}` (no env var auto-injection) | Sintassi esplicita, valori risolti prima dello spawn, nessuna collisione con variabili di shell, errore immediato se manca un parametro | — Pending |
| Catene sequenziali con stop-on-first-failure | Semantica "CI pipeline" attesa dall'utente, stesso comportamento di `&&` in shell ma portabile | — Pending |
| Comandi paralleli supportati fin dall'inizio | Serve all'utente per il suo workflow (es. lanciare più servizi o più check) | — Pending |
| Composizione: un alias può referire altri alias | Riuso tra pipeline (es. `ci` chiama `lint`, `test`, `build` già definiti) | — Pending |
| `commander.js` come framework CLI | Scelto esplicitamente dall'utente | ✓ Good |
| Distribuzione via `npm i -g` (no binari standalone) | Target è developer che già hanno Node, riduce complessità build | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-13 after Phase 1 (Foundation) completion — project scaffold, error hierarchy, CLI binary, test suite, CI matrix all verified cross-platform*
