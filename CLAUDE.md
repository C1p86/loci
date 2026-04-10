<!-- GSD:project-start source:PROJECT.md -->
## Project

**loci**

`loci` è un tool CLI cross-platform (Windows, Linux, macOS) scritto in Node.js che esegue comandi da riga di comando definiti in file di configurazione del progetto. È una specie di "CI tool locale": definisci una volta gli alias dei comandi (con i loro parametri) in un file versionato, poi richiami quegli alias da terminale ovunque stia lavorando, e `loci` li esegue con i parametri risolti secondo una gerarchia di config a 4 livelli.

Serve a chi lavora su più progetti e vuole evitare di ricordare/digitare a mano lunghe sequenze di build, package, deploy, o altri comandi ripetitivi, condividendo le definizioni col team ma mantenendo locali i segreti e gli override per-macchina.

**Core Value:** **Un alias → sempre lo stesso comando eseguito correttamente**, su qualunque sistema operativo, con i parametri giusti per quel progetto e per quella macchina, senza mai esporre token/password nel versioning.

### Constraints

- **Tech stack**: Node.js (runtime LTS supportato), TypeScript consigliato per DX e type-safety dei config parsing. Commander.js come base CLI.
- **Compatibility**: Windows 10+, Linux moderno, macOS moderno. Deve girare su tutti e tre con stesso comportamento osservabile.
- **Distribution**: pubblicato su npm pubblico, installazione tramite `npm i -g loci`. Nessun binario compilato (richiede Node installato sul sistema).
- **Dependencies**: minime. Principali candidate: `commander`, `js-yaml`, `execa` (o `cross-spawn`). Evitare dipendenze pesanti o con transitive troppo ampie.
- **Security**: il file `secrets.yml` deve essere letto solo se esiste; il tool deve emettere un warning (o errore configurabile) se viene trovato accidentalmente tracciato dal git. Loci NON deve mai loggare i valori dei secrets in output di debug.
- **Performance**: l'overhead di startup deve restare sotto la soglia percettibile (indicativo: < 300ms cold start su hardware moderno) perché verrà chiamato molte volte al giorno.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x (Active LTS) | Runtime | v22 is current Active LTS (maintenance through Apr 2027). v24 just entered Active LTS but ecosystem adoption lags. Target `engines: ">=20.5.0"` to cover v20/v22/v24. |
| TypeScript | 5.x (latest) | Language | Type-safety for config shape, placeholder resolution, and command tree. All YAML parser and CLI libraries have first-class TS support. |
| commander.js | 14.0.3 | CLI argument parsing | User has pre-selected this. v14 requires Node >=20, is stable CJS+ESM, receives security fixes until May 2027. v15 (pre-release) drops CJS — do NOT upgrade to v15 yet. |
| execa | 9.6.1 | Child-process execution | ESM-only since v6. Best cross-platform Windows support: handles shebangs, PATHEXT, graceful termination. Promise-based, streams stdout/stderr in real-time, propagates exit codes cleanly. Requires Node `^18.19.0 \|\| >=20.5.0` — matches our target. |
| yaml | 2.8.3 | YAML parsing | Full YAML 1.1 + 1.2 spec, passes yaml-test-suite, TypeScript support built-in (min TS 5.9). Ships with correct YAML 1.2 boolean semantics (`yes`/`no` are strings, not booleans — avoids a major footgun in js-yaml 4.x). |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/node | latest | Node.js type definitions | Always — needed for `process`, `fs`, `path` types |
| tsup | 8.5.1 | Build/bundle TypeScript → ESM output | Single-pass build: TypeScript → bundled ESM `.mjs`, generates `.d.ts`. Zero-config for CLIs. |
| vitest | 4.1.4 | Testing | Native ESM + TypeScript, no transform config needed. Node.js environment mode, no browser overhead. |
| @biomejs/biome | 2.x (latest stable) | Lint + format | Single Rust binary, zero npm transitive deps, 97% Prettier-compatible, type-aware lint in v2. Perfect for greenfield. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| tsup | Build tool | Config: single `tsup.config.ts`, outputs `dist/cli.mjs` + `dist/cli.d.ts`. Set `noExternal: []` to bundle all deps into a single file for minimal cold-start overhead. |
| biome | Lint + format | `npx @biomejs/biome init` generates `biome.json`. No `.eslintrc`, no `.prettierrc`. One config file. |
| vitest | Test runner | `vitest.config.ts` with `environment: 'node'`. Run with `vitest --run` in CI. |
## Installation
# Runtime deps (bundled into output by tsup, but declared as dependencies for npm install fallback)
# Dev dependencies
## Alternatives Considered
| Recommended | Alternative | Why Not / When Alternative Applies |
|-------------|-------------|-------------------------------------|
| yaml (eemeli) | js-yaml 4.1.1 | js-yaml uses YAML 1.1 semantics by default (e.g. `yes`/`on` parse as boolean `true`), causing unexpected behavior when reading user config files. `yaml` supports YAML 1.2 (fixed semantics) out of the box. js-yaml has 180M+ weekly downloads (wider ecosystem) but for a new project the stricter parsing of `yaml` is safer. Use js-yaml only if you need drop-in replacement for an existing codebase already using it. |
| execa | cross-spawn | cross-spawn is a drop-in for Node's `child_process.spawn` — you wire everything manually (streams, exit codes, promise handling). execa gives all that for free, plus verified Windows PATHEXT/shebang handling. Use cross-spawn only if you need zero-overhead and are writing your own process abstraction layer. |
| execa | zx | zx is a scripting tool — it launches a shell (bash/sh/PowerShell depending on OS) and runs the entire command string through it. This means shell quoting, shell-specific behavior, and different behavior on Windows. `loci` must interpolate `${VAR}` before spawn and guarantee consistent exit codes; using zx adds a shell indirection layer and a much larger dependency surface. Not appropriate for a programmatic command runner. |
| tsup | plain tsc | `tsc` compiles file-by-file with no bundling. For a CLI with several source files, unbundled output means Node.js must resolve and load multiple files on startup — measurable cold-start penalty. tsup bundles to a single `.mjs` file, reducing disk reads on startup. |
| tsup | rollup | Rollup is more configurable but requires significant plugin setup for TypeScript CLIs. tsup wraps esbuild (fastest transform) with sensible defaults. No advantage for a CLI tool. |
| vitest | jest | Jest requires `ts-jest` or `babel-jest` transform to handle TypeScript + ESM — extra config, slower. Vitest understands TypeScript natively. For a new ESM project there is no reason to choose Jest. Use Jest only on projects that already have a large Jest test suite or use React Native. |
| vitest | node:test | node:test (built-in) lacks watch mode, snapshot testing, rich matchers, and structured coverage. Viable for simple utilities but insufficient for a tool with parallel execution logic, YAML parsing edge cases, and cross-platform behavior tests. |
| biome | eslint + prettier | eslint + prettier requires 4+ config files, 127+ npm packages, and plugin coordination. Biome v2 covers TypeScript type-aware rules without needing the TypeScript compiler at lint time, and formats at 20-25x Prettier's speed. For a greenfield project there is no reason to use eslint+prettier. Use eslint only if you need niche community plugins (Vue, Angular, custom AST transforms) not yet in Biome. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| commander v15 (pre-release) | ESM-only, requires Node >=22.12.0, breaks CJS consumers still on older tooling. Not yet stable. | commander 14.0.3 |
| shelljs | Last meaningfully updated 2019, has known Windows incompatibilities, uses synchronous `exec` under the hood (blocks event loop), not maintained for modern ESM. | execa |
| cross-env | Sets env vars for scripts — that is not what loci does. loci reads env vars (`LOCI_MACHINE_CONFIG`) from `process.env` directly; no helper lib needed. | `process.env` directly |
| dotenv | loci does not use `.env` files — it reads `.yml` files. Loading YAML with `yaml` covers the use case. dotenv adds a dependency solving a different problem. | `fs.readFileSync` + `yaml.parse` |
| yamljs | Unmaintained (last release 2016), fails on many valid YAML documents, no YAML 1.2 support. | yaml or js-yaml |
| pkg / nexe | Compiles Node.js binary — the project explicitly targets developers who already have Node installed. Adds significant build complexity for no benefit. | Standard `npm i -g` |
| zx | Launches a shell process (bash/powershell), so shell-specific quoting rules apply. For a cross-platform command runner where `loci` must control the exact argument list before spawn, zx's shell intermediary is a liability. | execa |
| inquirer / prompts | Interactive prompts — not in scope for loci v1. Would add startup overhead for a non-interactive tool. | N/A |
## Publishing Workflow (2025 Gotchas)
### ESM vs CJS decision for loci
### bin field + shebang
#!/usr/bin/env node
### File permissions on Unix
### package.json exports
### files field
### prepublishOnly
## Node.js Version Targeting
- v20 is Maintenance LTS until April 2026 — users may still be on it
- v22 is Active LTS (April 2024 – October 2026 active, maintenance until April 2028)
- v24 just entered Active LTS (May 2025) — not yet widely adopted
- v18 reached End-of-Life March 2025 — do not support
- execa 9.x requires `^18.19.0 || >=20.5.0` — this is our effective floor
## Cold-Start Budget (< 300ms)
- **Bundle everything with tsup** (`bundle: true`, `noExternal: []`). A single file means Node.js performs one disk read instead of traversing node_modules.
- **execa** is a pure-ESM library with no native bindings — loads fast.
- **yaml** is pure JS — loads fast.
- **commander** is small (< 50KB minified).
- **Avoid heavy deps**: no chalk (use ANSI codes directly or `util.styleText` from Node >=20), no ora spinner, no boxen.
- **Measure**: Add `console.time('startup')` + `console.timeEnd('startup')` during development and run `hyperfine 'loci --help'` on each PR.
## Config Loading: env var path on Windows
## Parallel Command Execution
## Version Compatibility
| Package | Version | Node.js Minimum | ESM |
|---------|---------|-----------------|-----|
| commander | 14.0.3 | >=20 | CJS + ESM |
| execa | 9.6.1 | ^18.19.0 \|\| >=20.5.0 | ESM only |
| yaml | 2.8.3 | (unspecified, TS >=5.9) | CJS + ESM |
| tsup | 8.5.1 | (build tool, dev only) | — |
| vitest | 4.1.4 | >=20 | ESM |
| @biomejs/biome | 2.x | N/A (Rust binary) | — |
## Sources
- https://github.com/tj/commander.js/releases — commander v14.0.3 confirmed, v15 ESM-only warning verified
- https://github.com/sindresorhus/execa/blob/main/package.json — execa 9.6.1, Node `^18.19.0 || >=20.5.0`, ESM-only confirmed
- https://github.com/eemeli/yaml — yaml 2.8.3, YAML 1.1+1.2, TS >=5.9 confirmed
- https://github.com/nodeca/js-yaml — js-yaml 4.1.1, requires `@types/js-yaml`, YAML 1.1 semantics (footgun noted)
- https://github.com/egoist/tsup — tsup 8.5.1 confirmed
- https://vitest.dev/guide/ — vitest 4.1.4, Node >=20 confirmed
- https://biomejs.dev/blog/biome-v2/ — Biome v2 released June 2025, type-aware lint, no TS compiler dependency
- https://nodejs.org/en/about/previous-releases — Node.js v20 Maintenance LTS, v22 Active LTS, v24 Active LTS; v18 EOL Mar 2025
- https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing — dual publish analysis, tsup recommendation confirmed
- https://antfu.me/posts/move-on-to-esm-only — ESM-only for CLI tools rationale (MEDIUM confidence, opinion piece)
- https://2ality.com/2025/02/typescript-esm-packages.html — bin field + shebang + chmod workflow confirmed
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
