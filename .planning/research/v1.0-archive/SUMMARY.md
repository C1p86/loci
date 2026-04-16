# Project Research Summary

**Project:** loci
**Domain:** Cross-platform Node.js CLI command runner with layered YAML config
**Researched:** 2026-04-10
**Confidence:** HIGH

## Executive Summary

loci is a "local CI" tool: a Node.js CLI that resolves user-defined command aliases against a deterministic 4-layer YAML config hierarchy and executes them cross-platform via execa. The category (task runners / script launchers) is well-studied — `just`, `task`, `make`, `npm scripts`, `concurrently` all occupy adjacent space — but none of them separates machine-level defaults, project-level config, gitignored secrets, and per-PC overrides into an explicit 4-layer model. That gap is loci's reason to exist. The recommended build approach is a strict pipeline architecture: ConfigLoader → CommandsLoader → Resolver → Executor, with each stage producing a typed output and no component touching another's concern. This structure enables isolated testing of every stage and prevents the most common anti-patterns (lazy interpolation in the executor, config loading inside commander actions).

The critical risks are security and cross-platform correctness. Secrets from `secrets.yml` must never appear in any output path — not in `--verbose`, not in error messages, not in `--dry-run`. This redaction contract must be established in ConfigLoader and enforced at every display boundary. Cross-platform correctness hinges on a single decision in the Executor: never use `shell: true`. execa without shell handles PATHEXT, Windows `.cmd` shims, and shebangs automatically; switching to `shell: true` at any point breaks Windows determinism and opens a command injection vector. Both risks have HIGH recovery cost if addressed late — they must be designed in from Phase 1.

The recommended stack is fully resolved with high confidence: TypeScript 5.x, commander.js 14 (not v15 — it is ESM-only pre-release), `yaml` 2.x (not js-yaml — YAML 1.2 semantics avoid the Norway Problem), execa 9.x, tsup for bundling to a single `.mjs`, and vitest for tests. Cold-start budget of 300ms is comfortably achievable (expected 50-150ms) with the bundled-single-file approach. The MVP feature set is well-defined and all P1 features are confirmed against competitor analysis — missing any of them would make loci feel incomplete relative to tools already in the space.

---

## Key Findings

### Recommended Stack

The stack is ESM-only (`"type": "module"`, `engines: ">=20.5.0"`), bundled by tsup into a single `dist/cli.mjs` to minimize cold-start disk reads. All five runtime dependencies are small, fast-loading, and ESM-compatible. The critical version constraint is commander v14 — v15 is pre-release, ESM-only, and requires Node >=22.12; do not upgrade. The `yaml` package (not `js-yaml`) is mandatory because it defaults to YAML 1.2 semantics, where `no`/`yes`/`on`/`off` are strings, not booleans — js-yaml 4.x still defaults to YAML 1.1 for these coercion traps.

**Core technologies:**
- **Node.js >=20.5.0**: Active LTS target; execa 9.x floor matches this constraint exactly
- **TypeScript 5.x**: Type-safe config shape + command tree; first-class support in all chosen libs
- **commander.js 14.0.3**: User pre-selected; stable CJS+ESM, maintained through May 2027 — do NOT upgrade to v15
- **execa 9.6.1**: Cross-platform child-process execution; handles PATHEXT, Windows `.cmd` shims, graceful kill — the only spawn abstraction to use; never use `child_process.spawn` directly
- **yaml 2.8.3**: YAML 1.2 semantics (avoids boolean coercion traps present in js-yaml); full TypeScript support
- **tsup 8.5.1**: Bundles TypeScript to single `.mjs` + shebang injection; use `bundle: true, noExternal: []`
- **vitest 4.1.4**: Native ESM + TypeScript test runner; no transform config needed
- **@biomejs/biome 2.x**: Single-binary lint + format; replaces eslint + prettier with zero config sprawl

### Expected Features

**Must have (table stakes) — users expect these from any tool in this space:**
- `loci` / `loci --list` listing all aliases with descriptions — `just --list` established this as the standard discoverability pattern
- `${VAR}` interpolation from merged config — every competitor has it; loci's variant must error loudly on undefined (vs. silent empty expansion in `just`/`make`)
- Sequential chain execution with stop-on-first-failure and named-step error output
- Parallel group execution — must ship with prefixed-per-alias output; parallel without output prefixing is a known UX failure (the historical complaint about `npm-run-all run-p`)
- Pass-through args via `--` separator
- Exit code propagation — CI pipelines break silently if this is wrong
- `cwd:` per alias defaulting to project root
- Secrets never logged (redaction from all output paths)
- `--dry-run` mode — only `task` has this among competitors; absence is a differentiator gap
- `--verbose` config resolution trace — no competitor has this; high DX value for debugging layered config

**Should have (competitive differentiators) — these are why loci is worth building:**
- **4-layer config hierarchy** (machine / project / secrets / local): no competitor separates all four; this is loci's core identity
- **`${VAR}` undefined = loud error**: `just` and `make` silently expand to empty string; named error is a real debugging win
- **Composable aliases** with cycle detection at load time: enables `ci` that calls `lint` + `test` + `build` without re-specifying commands
- **Gitignore safety warning** if `secrets.yml` is tracked by git: no competitor does this actively

**Defer (v2+):**
- Shell completions (bash/zsh/fish/PowerShell) — stable command surface needed first
- `loci init` scaffolding wizard — README example is sufficient for v1
- `loci validate` lint mode — useful but not launch-blocking
- `--env=prod` environment selector — needs schema design; too open-ended for v1
- Remote secrets backends (Vault, AWS SSM) — only after validated demand

### Architecture Approach

The system is a linear pipeline: CLI Frontend (commander.js) → Orchestrator → ConfigLoader + CommandsLoader → Resolver → Executor → `process.exit`. Each stage is a class with a single public method, strict typed inputs/outputs, and zero cross-stage knowledge. Resolver handles all alias composition and `${VAR}` interpolation eagerly at load time before any process is spawned — this means `--dry-run` shows exactly what would run, cycle detection fires at startup, and the Executor receives only concrete `string[]` arrays. The Orchestrator is the single catch point for all `LociError` subtypes; no other component calls `process.exit`.

**Major components:**
1. **ConfigLoader** — reads 4 YAML files, merges with `machine → project → secrets → local` precedence, returns `ResolvedConfig: Record<string, string>`; tracks which keys came from `secrets.yml` for downstream redaction
2. **CommandsLoader** — parses `.loci/commands.yml`, validates schema, returns `CommandMap: Map<string, CommandDef>`
3. **Resolver** — flattens alias composition (DFS cycle detection), interpolates `${VAR}` into resolved strings, throws named errors on undefined placeholders, returns `ExecutionPlan`
4. **Executor** — spawns via execa (never `shell: true`), streams stdout/stderr, prefixes parallel output per alias, propagates exit codes, kills orphans via `process.on('exit')` handler
5. **CLI Frontend** — registers commands dynamically from `CommandMap`, handles `--list`/`--dry-run`/`--verbose`/`--help`, delegates to Orchestrator
6. **Orchestrator** — wires all components, catches `LociError`, calls `process.exit(code)` as the single exit point

### Critical Pitfalls

1. **`shell: true` destroys cross-platform compatibility** — parse command strings into `[executable, ...args]` before spawning; execa without `shell: true` handles PATHEXT, shebangs, and Windows `.cmd` shims. This decision must be made before writing any spawn call. Severity: CRITICAL.

2. **Secrets leaking into verbose/error output** — ConfigLoader must tag which keys came from `secrets.yml`; every display path (verbose trace, dry-run, error messages) must redact those values as `[REDACTED]`. Never pass the raw merged config object to any logging function. Write a dedicated test: run `--verbose` with a known secret value, grep stdout/stderr, assert the secret does not appear. Severity: CRITICAL.

3. **YAML type coercion (the Norway Problem)** — use `yaml` (eemeli, YAML 1.2) not `js-yaml`. In YAML 1.1, `no`/`yes`/`on`/`off` silently become booleans. With `yaml`, only `true`/`false` are booleans. Write tests that load YAML with `no`, `yes`, `0123`, `null` and assert string types. Severity: CRITICAL.

4. **Circular alias composition hangs the process** — detect cycles at load time using DFS with a visited set, fail with a named error before any execution begins. Never wait until runtime to discover a cycle. Severity: CRITICAL.

5. **Orphaned child processes on Ctrl+C** — register `process.on('exit')` and `process.on('SIGINT')` handlers that kill all tracked subprocess references. For parallel groups, use execa's `cleanup: true`. Windows has no POSIX process groups; accept this and document it, but ensure execa's `taskkill /F /T` covers the direct children. Severity: CRITICAL.

---

## Implications for Roadmap

The architecture research provides an explicit dependency graph. The build order below follows it strictly, with security and correctness constraints from PITFALLS.md embedded into the phase where they must be solved.

### Phase 1: Project Foundation
**Rationale:** Types + errors must exist before any other component can be written with type safety. ESM/CJS decision, shebang setup, and tsup config must be locked before any code is written — these are HIGH recovery cost if changed later (requires touching every file and a breaking npm publish).
**Delivers:** `errors.ts` (full `LociError` hierarchy), all shared TypeScript types (`ResolvedConfig`, `CommandDef`, `CommandMap`, `ExecutionPlan`), `package.json` with ESM-only config (`"type": "module"`, `engines: ">=20.5.0"`, `bin` field pointing to `dist/cli.mjs`), tsup config with shebang injection, vitest + biome configured.
**Avoids:** ESM/CJS pitfall (locked at scaffold, not patched later).

### Phase 2: ConfigLoader
**Rationale:** Self-contained and produces the most foundational data structure. All security contracts (secrets redaction, gitignore warning) must be established here — before any other phase can accidentally log config values.
**Delivers:** 4-layer YAML merge (machine/project/secrets/local), `ResolvedConfig` output, secrets key tracking (set of keys loaded from `secrets.yml`, passed to display layer for redaction), gitignore safety check via `git ls-files`, clear errors for unreadable files and malformed YAML.
**Implements:** ConfigLoader component
**Avoids:** Secrets-in-output pitfall, YAML coercion pitfall, secrets-already-tracked-by-git pitfall.

### Phase 3: CommandsLoader + Resolver
**Rationale:** CommandsLoader is self-contained. Resolver depends on both ConfigLoader and CommandsLoader output types and is the first integration point. Cycle detection must live here and fire at startup before any process is spawned.
**Delivers:** YAML schema validation for `commands.yml`, typed `CommandMap`, alias composition flattening, `${VAR}` interpolation with loud-error-on-undefined, DFS cycle detection, `ExecutionPlan` output (flat `string[]` for executor).
**Implements:** CommandsLoader + Resolver components
**Avoids:** Circular alias hang, command injection via interpolation (interpolation happens into argument slots resolved to `string[]`, not into a shell string).

### Phase 4: Executor
**Rationale:** Self-contained (no dependencies on other loci components). Must be built with the cross-platform spawn contract locked from the first line: execa without `shell: true`, PATHEXT handled automatically, orphan cleanup handler registered. Sequential and parallel execution, prefixed output for parallel groups, exit code propagation.
**Delivers:** Single-command spawn, sequential chain with stop-on-first-failure, parallel group with per-alias prefixed output, orphan cleanup via `process.on('exit')`, exit code propagation, streaming stdout/stderr with ANSI TTY detection.
**Implements:** Executor component
**Avoids:** `shell: true` pitfall, Windows PATHEXT pitfall, orphaned processes pitfall, interleaved parallel output pitfall, exit code propagation pitfall.

### Phase 5: Orchestrator + CLI Frontend
**Rationale:** Can only be built after all four pipeline components exist. Orchestrator wires them; CLI Frontend is a thin wrapper. Commander.js dynamic registration, `--list`, `--dry-run`, `--verbose`, and pass-through args (`--`) all live here. Commander flag vs. pass-through conflict must be resolved via `passThroughOptions()` and `enablePositionalOptions()`.
**Delivers:** End-to-end `loci <alias>` execution, `loci --list` with descriptions, `--dry-run` (prints resolved plan, redacting secrets), `--verbose` (config resolution trace, redacting secrets), `--help`, pass-through args via `--`, `process.exit` with correct code.
**Implements:** Orchestrator + CLI Frontend
**Avoids:** Commander flag/pass-through conflict, secrets in dry-run output.

### Phase 6: Polish + Distribution
**Rationale:** Publish-readiness, cross-platform verification, and documentation complete the tool. Must include integration tests on real Windows (not WSL) to catch PATHEXT issues invisible on macOS/Linux CI.
**Delivers:** Published npm package, README with usage examples and `.gitignore` template for `.loci/secrets.yml`, integration test suite covering the PITFALLS.md "Looks Done But Isn't" checklist (exit code 42 propagation, secrets absent from verbose output, parallel orphan cleanup, circular alias error, pass-through flags), Windows CI verification.
**Avoids:** PATHEXT issues silently passing on macOS CI, secrets.yml gitignore documentation gap.

### Phase Ordering Rationale

- Foundation must come first: shared types and the `LociError` hierarchy are the typed contract every other component depends on; building without them means `any` types proliferating and expensive retrofits.
- Security contracts are established at Phase 2 (ConfigLoader), not deferred to Phase 5 (CLI): if redaction is left for the display layer, there is meaningful risk of accidental secret logging during active development of Phases 3-4.
- Resolver after both loaders: it is the first integration point requiring types from two other components; building it third means those types are stable when it is written.
- Executor is independently buildable: it has zero dependencies on other loci components and can be built alongside Phases 2-3 if working in parallel, but must complete before Phase 5.
- CLI Frontend last: commander.js dynamic registration requires a stable `CommandMap`; this layer intentionally contains no business logic and should be the last thing written.

### Research Flags

Phases with standard, well-documented patterns (no deeper research needed before planning):
- **Phase 1 (Foundation):** tsup + TypeScript ESM CLI setup is fully documented with code examples in STACK.md.
- **Phase 2 (ConfigLoader):** YAML merge is a simple reduce; `yaml` library is well-documented; `git ls-files --error-unmatch` is a one-liner.
- **Phase 3 (Resolver):** DFS cycle detection is a textbook algorithm; `${VAR}` interpolation is a string replace with a lookup map.
- **Phase 6 (Distribution):** npm publish workflow for ESM CLI is fully documented in STACK.md with exact `package.json` fields.

Phases that may benefit from targeted research during planning:
- **Phase 4 (Executor):** Parallel group kill-on-first-failure with `AbortController` + `cancelSignal` in execa v9 has nuance — the code sample in ARCHITECTURE.md uses `Promise.allSettled` without cancellation, which waits for all processes rather than aborting survivors on first failure. The correct execa v9 abort pattern should be validated before writing this phase.
- **Phase 5 (CLI Frontend):** Commander.js `passThroughOptions()` + `enablePositionalOptions()` interaction with dynamically registered commands has edge cases noted in PITFALLS.md. Validate the exact call sequence against commander v14 docs before implementation.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against official GitHub release pages; compatibility matrix confirmed across all packages |
| Features | HIGH (table stakes), MEDIUM (differentiators) | Table stakes cross-referenced against 5 competitors with links; differentiators based on gap analysis of documented competitor behavior |
| Architecture | HIGH | Pipeline pattern well-established for Node.js CLIs; component boundaries and code examples verified against execa v9 and commander v14 APIs |
| Pitfalls | HIGH (cross-platform, YAML, security), MEDIUM (Windows signal behavior) | Cross-platform and security pitfalls verified against official execa docs and CVE references; Windows SIGINT behavior is a documented Node.js limitation |

**Overall confidence:** HIGH

### Gaps to Address

- **Parallel abort semantics in execa v9**: The `Promise.allSettled` pattern in ARCHITECTURE.md waits for all processes rather than killing survivors on first failure. The correct `AbortController` + `cancelSignal` pattern needs a concrete validated example before Phase 4 begins.
- **Commander v14 dynamic registration + passThroughOptions interaction**: Edge cases noted in PITFALLS.md are unproven against a real code example. Validate with a minimal reproduction before writing the CLI Frontend.
- **npm package name `loci` availability**: PROJECT.md marks this as pending. Verify `npm info loci` before starting Phase 6.

---

## Sources

### Primary (HIGH confidence)
- https://github.com/tj/commander.js/releases — commander v14.0.3, v15 ESM-only warning verified
- https://github.com/sindresorhus/execa — execa v9.6.1, Node requirement, ESM-only, Windows PATHEXT docs
- https://github.com/eemeli/yaml — yaml 2.8.3, YAML 1.2 semantics confirmed
- https://github.com/egoist/tsup — tsup 8.5.1, CLI bundling patterns, shebang injection
- https://nodejs.org/en/about/previous-releases — Node.js LTS schedule (v20 Maintenance, v22 Active, v18 EOL)
- https://biomejs.dev/blog/biome-v2/ — Biome v2 type-aware lint confirmed
- https://just.systems/man/en/ — just manual, feature reference for competitor analysis
- https://taskfile.dev/usage/ — task feature reference for competitor analysis
- https://ruudvanasseldonk.com/2023/01/11/the-yaml-document-from-hell — YAML 1.1 coercion traps documented
- https://github.com/sindresorhus/execa/blob/main/docs/windows.md — Windows spawn behavior, PATHEXT, SIGTERM
- https://github.com/sindresorhus/execa/blob/main/docs/termination.md — cleanup + kill patterns

### Secondary (MEDIUM confidence)
- https://aleyan.com/blog/2025-task-runners-census/ — task runner ecosystem overview 2025
- https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing — ESM/CJS decision for CLI tools
- https://antfu.me/posts/move-on-to-esm-only — ESM-only for CLI tools rationale
- https://twdev.blog/2024/06/just/ — just user review 2024, UX observations
- https://thehackernews.com/2024/04/aws-google-and-azure-cli-tools-could-leak-credentials-in-build-logs/ — LeakyCLI credential exposure in CI logs

### Tertiary (LOW confidence)
- https://news.ycombinator.com/item?id=44559375 — task runner census HN discussion (community sentiment)
- https://news.ycombinator.com/item?id=45160774 — secrets in logs HN discussion (community patterns)

---
*Research completed: 2026-04-10*
*Ready for roadmap: yes*
