# Roadmap: loci

## Overview

loci is built as a strict pipeline: Foundation -> Config -> Commands/Resolver -> Executor/CLI -> Polish. Each phase delivers a self-contained, testable capability. Security contracts (secrets redaction, git-tracked secrets warning) are locked into Phase 2 before any other phase can accidentally log config values. Cross-platform CI comes online in Phase 1 so every subsequent phase is Windows-verified from day one.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Project scaffold, shared types, error hierarchy, CI matrix on Windows/Linux/macOS
- [x] **Phase 2: Config System** - 4-layer YAML loader with deterministic merge, secrets redaction contract, gitignore safety check (completed 2026-04-13)
- [ ] **Phase 3: Commands & Resolver** - commands.yml parser, alias composition with cycle detection, `${VAR}` interpolation
- [ ] **Phase 4: Executor & CLI** - cross-platform command execution, parallel groups, full commander.js frontend wired end-to-end
- [ ] **Phase 5: Init & Distribution** - `loci init` scaffolding, README, npm publish

## Phase Details

### Phase 1: Foundation
**Goal**: The project skeleton exists: runnable binary, typed error hierarchy, CI passing on all three platforms
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, FND-06
**Success Criteria** (what must be TRUE):
  1. `npm i -g .` installs a `loci` binary that runs on Windows 10+, Linux, and macOS without modification
  2. `loci --version` exits in under 300ms cold on a modern laptop
  3. `npm test` and `npm run lint` pass on a fresh clone with no manual setup
  4. GitHub Actions CI runs build + test + lint on a Windows / Linux / macOS matrix and all checks are green
**Plans**: 4 plans
- [x] 01-01-PLAN.md — Repository scaffolding (package.json, tsconfig, tsup/vitest/biome configs, hygiene files, D-05 directory skeleton)
- [x] 01-02-PLAN.md — Core source (errors.ts full LociError hierarchy, types.ts pipeline contracts, version.ts, cli.ts commander wiring, feature stubs)
- [x] 01-03-PLAN.md — Test suite (errors.test.ts instanceof/code-uniqueness/exit-code-mapping, types.test.ts expectTypeOf, cli.e2e.test.ts spawn smoke)
- [x] 01-04-PLAN.md — GitHub Actions CI matrix (ubuntu/windows/macos x Node 20/22, build->test->lint->smoke)

### Phase 2: Config System
**Goal**: The 4-layer YAML config merges correctly, secrets are tagged for redaction from this moment forward, and safety guards (git tracking warning, YAML error messages) are in place
**Depends on**: Phase 1
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-06, CFG-07, CFG-08, CFG-09, CFG-10
**Success Criteria** (what must be TRUE):
  1. A key defined in machine config is overridden by project config, which is overridden by secrets, which is overridden by local — the merged value is always the last-defined one
  2. If `secrets.yml` is accidentally committed to git, loci prints a visible warning before running (does not block)
  3. Running `loci` in a directory with a malformed YAML file shows the filename and line number of the parse error, then exits non-zero
  4. Missing config files do not cause a crash — loci runs with whatever files are present
  5. `yes`, `no`, `on`, `off`, and `0123` in YAML files are treated as strings, not booleans or octals
**Plans**: 1 plan
- [x] 02-01-PLAN.md — Config loader implementation (readLayer, flattenToStrings, mergeLayers, git secrets check) + comprehensive test suite

### Phase 3: Commands & Resolver
**Goal**: `commands.yml` is fully parsed, alias composition is flattened with cycle detection at load time, and all `${VAR}` placeholders are resolved before any process is spawned
**Depends on**: Phase 2
**Requirements**: CMD-01, CMD-02, CMD-03, CMD-04, CMD-05, CMD-06, CMD-07, CMD-08, CMD-09, INT-01, INT-02, INT-03, INT-04, INT-05
**Success Criteria** (what must be TRUE):
  1. An alias referencing `${DEPLOY_HOST}` (defined in any config layer) resolves to the correct value before the command runs; if the variable is missing, loci prints which alias and which placeholder is undefined and exits without running anything
  2. A circular alias chain (`A -> B -> A`) is detected at startup and reported with the full cycle path — the command never runs
  3. An alias that references another alias (`ci: [lint, test, build]`) executes each constituent alias correctly
  4. Values from `secrets.yml` injected as env vars do not appear in any verbose or debug output — they show as `***` or are omitted
**Plans**: 2 plans
- [x] 03-01-PLAN.md — Commands loader (YAML parser, tokenizer, normalizer, DFS cycle detection, eager validation)
- [x] 03-02-PLAN.md — Resolver (platform selection, ${VAR} interpolation, env var builder, secrets redaction utility)

### Phase 4: Executor & CLI
**Goal**: Users can run any defined alias end-to-end: single commands, sequential chains, and parallel groups execute correctly cross-platform; the full commander.js interface (`--list`, `--dry-run`, `--verbose`, pass-through args) is wired and working
**Depends on**: Phase 3
**Requirements**: EXE-01, EXE-02, EXE-03, EXE-04, EXE-05, EXE-06, EXE-07, CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08, CLI-09
**Success Criteria** (what must be TRUE):
  1. `loci <alias>` runs the command, streams stdout/stderr in real time, and exits with the same exit code as the child process (or the first failing step in a chain)
  2. `loci <alias> --dry-run` prints the fully-resolved command (or chain/group) with secrets replaced by `***`, without executing anything
  3. Running a parallel group shows each command's output prefixed by its alias name; if one command fails, all remaining commands are killed and loci exits non-zero
  4. Pressing Ctrl+C during execution kills the child process and exits cleanly — no orphaned processes remain
  5. `loci --list` (or `loci` with no arguments) shows all available aliases with their descriptions
  6. `loci <alias> -- --some-flag value` passes `--some-flag value` through to the underlying command without loci interpreting the flags
**Plans**: 2 plans
- [x] 04-01-PLAN.md — Executor engine (types/failMode extension, output formatting, single/sequential/parallel execution with AbortController cancellation)
- [ ] 04-02-PLAN.md — CLI frontend (commander.js dynamic alias registration, walk-up discovery, --list/--dry-run/--verbose/pass-through, E2E tests)

### Phase 5: Init & Distribution
**Goal**: `loci init` scaffolds a new project, documentation is complete, and the package is published to npm under the `loci` name
**Depends on**: Phase 4
**Requirements**: INIT-01, INIT-02, INIT-03, INIT-04, INIT-05, INIT-06, DOC-01, DOC-02, DOC-03, DOC-04, DOC-05
**Success Criteria** (what must be TRUE):
  1. Running `loci init` in a project directory creates `.loci/config.yml`, `.loci/commands.yml`, `.loci/secrets.yml.example`, and `.loci/local.yml.example`, and adds the real secrets/local files to `.gitignore` — subsequent runs skip existing files and print what was skipped
  2. A developer following only the README quickstart can install loci, run `loci init`, define one alias, and execute it successfully with no other guidance
  3. `npm i -g loci` installs the published package and `loci --version` works immediately
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/4 | Not started | - |
| 2. Config System | 1/1 | Complete   | 2026-04-13 |
| 3. Commands & Resolver | 0/2 | Not started | - |
| 4. Executor & CLI | 1/2 | In Progress|  |
| 5. Init & Distribution | 0/? | Not started | - |
