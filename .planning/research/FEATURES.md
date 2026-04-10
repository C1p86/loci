# Feature Research

**Domain:** Cross-platform CLI command runner / local CI tool (Node.js)
**Researched:** 2026-04-10
**Confidence:** HIGH (core table stakes), MEDIUM (differentiators — verified across multiple sources), LOW (anti-features — based on ecosystem observation)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete. Competitors listed are the tool that established the expectation.

| Feature | Why Expected | Complexity | Competitor Reference | Notes |
|---------|--------------|------------|---------------------|-------|
| List available commands (`loci` / `loci --list`) | Every tool in the space has this. `just --list` is its killer discovery feature — new contributors run it immediately to understand a project. | LOW | `just --list`, `task --list` / `task --list-all`, `mise run` | Show name + description. Hidden/internal commands (underscore prefix in `just`) are a nice-to-have refinement. |
| Per-command description in listing | Without it, `--list` is just names. Users don't know what `deploy-staging` does. | LOW | `just` (doc comments above recipe), `task` (`desc:` field) | Description as a first-class field in `commands.yml`. |
| Pass-through args to underlying command | Users constantly do `loci test -- --watch` or `loci build -- --target=prod`. Broken arg forwarding is a hard blocker. | LOW | `just` (positional args in recipe), `task` (`.CLI_ARGS` via `--`), `concurrently` (resolved #33 after user pain) | Use `--` separator convention. Append to interpolated command string. |
| Env var injection into child process | All tools do this. Without it, commands can't reference credentials or paths. | LOW | `task` (`env:` per-task), `just` (`.env` load + `$VAR`), `make` | loci's `${VAR}` interpolation already covers this at command resolution time, but child process env must also carry the merged config values as actual env vars for subprocesses that read them directly. |
| Working directory control per command | Monorepo users run `npm install` in a subdirectory. `task` has `dir:` per task. Missing this forces ugly `cd && ...` workarounds. | LOW | `task` (`dir:` field), `just` (auto-discovers justfile dir and can `cd`) | A `cwd:` field in `commands.yml` per alias. Default to project root (`.loci/` parent). |
| Exit code propagation | CI systems break if a task reports 0 when a child failed. Every serious tool propagates exit codes. | LOW | All competitors. `task` has explicit exit-code docs. `make` propagates by default. | In sequential chains: exit on first non-zero, forward that code. In parallel groups: exit non-zero if any child exits non-zero. |
| Clear error output when a chain step fails | Users need to know *which* step failed and *why*. Silent failures or swallowed stderr are infuriating. | LOW | `task` (prints failing task name + command), `just` ("error: recipe X failed on line N") | Print: step name, the resolved command that ran, and the exit code. Do not suppress child stderr. |
| Variable interpolation (`${VAR}`) | Expected by anyone who has used Taskfile, Makefile, or shell. Without it the tool is barely more useful than hardcoded aliases. | MEDIUM | `task` (Go template `{{.VAR}}`), `just` (`{{var}}`), `make` (`$(VAR)`) | loci already specifies `${NAME}` syntax. Fail fast with a named error if a placeholder is unresolved — this is a differentiator over `just` (which silently expands to empty) and `make` (same). |
| `--help` flag with usage info | Commander.js provides this for free. Users expect it. | LOW | Every CLI tool | Commander.js auto-generates this. Ensure sub-commands and flags are documented. |
| Secrets file never logged | Users trust the tool not to print their API keys in `--verbose` or error output. This is a correctness/safety expectation. | MEDIUM | No competitor currently has explicit "redact secrets" semantics. `mise` added `redact = true` per-env-var in 2024. | Values from `secrets.yml` must be tracked and redacted from all output paths. See PITFALLS.md. |

---

### Differentiators (Competitive Advantage)

Features that create loci's reason to exist. Grounded in gaps in existing tools.

| Feature | Value Proposition | Complexity | Competitor Gap | Notes |
|---------|-------------------|------------|----------------|-------|
| 4-layer config hierarchy (machine / project / secrets / local) | No mainstream task runner has explicit machine-level config + project-level + gitignored secrets + local override in a single deterministic merge. `just` has `.env` files only. `task` has `dotenv:` but no machine-level concept. Users on multiple machines with per-machine paths (Docker socket, cloud auth paths) have no good story today. | MEDIUM | `just`: one `.env` file; `task`: `dotenv:` at task level only, no machine config; `make`: env vars only; `mise`: env per-project, no machine-defaults-separate-from-project | The 4-layer model is loci's core differentiator. Must be explicit in `--verbose` output ("resolved ${REGISTRY} from secrets.yml"). |
| `${VAR}` fails loudly on undefined | `just` silently expands undefined vars to empty string. `make` expands to empty. Both cause silent misconfiguration bugs. loci errors immediately with "placeholder ${DOCKER_REGISTRY} not defined in any config level" | LOW | `just`, `make` (silent empty expansion); `task` catches some via template errors | Explicit undefined-is-error semantics. Huge DX win in debugging broken configs. |
| Composable aliases (alias referencing aliases) | `ci` that calls `lint`, `test`, `build` as defined aliases without re-specifying commands. `task` supports `deps:` which is similar but requires knowing the dependency graph. `just` allows recipe dependencies. loci's composition lets users build vocab gradually. | MEDIUM | `task`: `deps:` only runs prerequisites, not a clean "call this alias"; `just`: recipe dependencies exist but are pre-run hooks, not re-usable command sequences; `npm scripts`: `npm run lint && npm run test` requires re-specifying inline | Enables "vocabulary-first" config: define `deploy` once, reference in `release`, `ci`, `hotfix`. |
| Sequential chains with stop-on-first-failure (semantic CI pipeline) | Shell `&&` chains are fragile cross-platform and obscure what's happening. loci makes the chain explicit and cross-platform. | LOW | `npm scripts`: `&&` breaks on Windows cmd.exe; `just`: each step is a separate shell invocation; `task`: `deps:` runs in parallel unless `--parallel=false` | Document as "CI pipeline semantics." The cross-platform guarantee of `&&` equivalence is the value. |
| Parallel groups with structured output (prefixed per-source) | `concurrently` prefixes output per-process but is a separate tool with no config file integration. `npm-run-all` (`run-p`) gives no output distinction. Interleaved output is the #1 complaint about running parallel scripts. | HIGH | `concurrently`: works but is disconnected from a config file; `npm-run-all`/`npm-run-all2`: no output prefixing in parallel mode; `task`: has `interleaved`/`group`/`prefixed` output modes (good model to follow) | Prefix each parallel output line with `[alias-name]` in a distinct color. `task`'s output modes are the right model. Implement `prefixed` mode as default for parallel groups. |
| Gitignore safety check for secrets.yml | No current tool actively warns you if `secrets.yml` is tracked by git. Users have accidentally committed secrets because `.gitignore` wasn't set up before the first `git add`. | LOW | No competitor has this. | On startup: if `secrets.yml` or `local.yml` exists AND is tracked by git (detectable via `git ls-files`), emit a clear warning. Non-blocking but loud. |
| `--dry-run` resolves and prints commands without executing | `task` has `--dry` mode. `just` does not have a built-in dry-run. Users building complex pipelines need to verify interpolation without side effects. | LOW | `just`: no dry-run; `task`: has `--dry`; `make`: no dry-run for .PHONY | Print the fully-resolved command string for each step, in order. In parallel groups, print all. Label each with its alias. |
| `--verbose` shows config resolution trace | Users are confused when the wrong value is resolved. Showing "project.yml: REGISTRY=docker.io → overridden by local.yml: REGISTRY=localhost:5000" is invaluable for debugging. | MEDIUM | No competitor shows merge resolution trace. | Verbose should show: which config files were found, merge order, final resolved values (redacting secrets), and the full command string before execution. |

---

### Anti-Features (Commonly Requested, Often Problematic)

Things to deliberately NOT build in v1. Justified against the project's scope and complexity constraints.

| Feature | Why Requested | Why Problematic | What to Do Instead |
|---------|---------------|-----------------|-------------------|
| Watch mode / file watcher | "Re-run tests on file change" is a common dev workflow. Nodemon, entr, watchexec already do this well. | Adds a long-running process management concern that is orthogonal to the core "alias runner" concept. TTY handling, signal forwarding, debouncing, and cross-platform file system events are each independently complex. Out of scope per PROJECT.md. | Document that `loci watch-test` can invoke `nodemon --exec 'loci test'`. loci runs the alias; the watcher is the outer wrapper. |
| Plugin / extension system | Users want to add custom steps (Slack notification, S3 upload). | A plugin API requires a stable public API surface, versioning, sandboxing, and documentation burden. Plugins introduce breaking change risk for every internal refactor. Grunt's plugin ecosystem is cited as the canonical "too much" example. | Built-in commands can call any executable. The extension model is "write a script and reference it as a command." No plugin API needed in v1. |
| Remote execution / SSH runner | "Run deploy on the server" is a natural next step from "build locally". | Out of scope per PROJECT.md. SSH session management, credential forwarding, and output streaming over remote connections are each full features. | `loci deploy` can call `ssh user@host "cmd"` — the alias is local, the effect is remote. Document this pattern. |
| Vault / KMS secrets integration | Teams want to pull secrets from Vault, AWS SSM, 1Password. | Each backend has a different SDK, auth model, and failure mode. Supporting three backends means three implementations to maintain. Secrets-in-file is a deliberate simplicity choice. | Document: `secrets.yml` values can be populated by a pre-step `loci init-secrets` that calls `vault kv get ...` and writes the file. loci itself stays simple. |
| Templating language (loops, conditionals, functions) | "If environment is prod, use this registry" seems natural in a config. | A templating language (Jinja2, Handlebars, Go templates) in YAML configs rapidly becomes a programming language embedded in a config file. `task`'s Go templates are frequently cited as confusing. Complexity scales superlinearly with template features. | Use config-level values (different `local.yml` per environment) for environment switching. Shell conditionals in the command string are the escape hatch for truly conditional logic. |
| Dependency graph / incremental builds (timestamp/checksum based) | Make-style "only rebuild if source changed." `task` has this with checksums. | loci is not a build system — PROJECT.md is explicit. Incremental build logic requires tracking state across runs, understanding input/output relationships, and cache invalidation. Scope explosion. | If users need incremental builds, `task` or `make` are the right tools. loci's value is alias standardization and config layering, not build optimization. |
| GUI / web dashboard | "A visual task runner would be nice." | CLI-only per PROJECT.md. A GUI requires a web server, frontend assets, and auth, which is a separate product. | The `--list` output is the UI. Make it scannable and informative. |
| Multiple config file formats (JSON, TOML, .env) | "I prefer TOML." | Supporting multiple formats creates parser maintenance burden, ambiguity about precedence when two formats exist, and user choice paralysis. YAML is already chosen. | Single format: YAML. Consistent with PROJECT.md's "YAML only" decision. |
| Auto-update / version pinning per project | "Ensure CI uses same loci version as devs." | A version pinning system requires a lockfile format, a resolution algorithm, and a download mechanism. This is `nvm`/`fnm` territory for the tool itself. | Document: pin loci version in CI with `npm install -g loci@X.Y.Z`. No per-project lockfile in v1. |
| `loci init` project scaffolding wizard | Lowers onboarding friction. | Interactive scaffolding is a separate UX concern. A bad wizard is worse than no wizard (users get stuck or generate incorrect config). | Ship with a minimal example in the README. A `loci init` that creates a `.loci/commands.yml` stub with comments is a v1.x addition once the config schema is stable. |

---

## Feature Dependencies

```
[List available commands]
    └──requires──> [Per-command description field in commands.yml schema]

[Parallel groups with prefixed output]
    └──requires──> [Process spawning abstraction (execa/cross-spawn)]
    └──requires──> [TTY detection] (prefix only when not raw TTY, or always in parallel)
    └──enhances──> [Colored output] (per-alias color assignment)

[Sequential chains with stop-on-first-failure]
    └──requires──> [Exit code propagation]
    └──requires──> [Clear error output when step fails]

[Composable aliases]
    └──requires──> [Circular dependency detection] (A → B → A is a runtime error)

[4-layer config merge]
    └──requires──> [${VAR} interpolation]
    └──requires──> [Secrets redaction from output]

[--verbose config resolution trace]
    └──requires──> [4-layer config merge]
    └──requires──> [Secrets redaction from output] (cannot print secrets even in verbose)

[Gitignore safety check]
    └──requires──> [git CLI available] (gracefully skip if not in a git repo)

[--dry-run]
    └──requires──> [${VAR} interpolation] (must resolve before printing)
    └──requires──> [4-layer config merge] (dry-run needs the merged config to resolve vars)
```

### Dependency Notes

- **Parallel groups requires structured output:** Without prefixing, interleaved output from parallel processes is unreadable. This is the #1 complaint about `concurrently`'s earlier versions and `npm-run-all`'s `run-p`. Do not ship parallel execution without prefixed output — they are a single feature.
- **Secrets redaction is a prerequisite for `--verbose`:** Verbose output is useless if it can never be shown to anyone. Redaction enables safe sharing of debug output.
- **Composable aliases requires cycle detection:** A naive implementation that recursively expands aliases will hang or stack-overflow on circular references. Detect cycles at load time (static analysis of the command graph), not at runtime.
- **TTY detection enhances but does not block colored output:** When stdout is piped (CI log), strip ANSI codes. When connected to a TTY, use colors. This is standard practice (`chalk` handles it via `supports-color`).

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the core value proposition.

- [ ] `loci` with no args (or `loci --list`) — lists aliases with descriptions. Primary discoverability.
- [ ] `loci <alias>` — executes a single command alias with `${VAR}` interpolation from merged 4-layer config.
- [ ] 4-layer config merge (machine / project / secrets / local) with deterministic precedence.
- [ ] `${VAR}` fails loudly on undefined placeholder — named error, not silent empty expansion.
- [ ] Sequential chain execution with stop-on-first-failure and clear error output (which step, which command, which exit code).
- [ ] Parallel group execution with prefixed output (alias name prefix per line).
- [ ] Composable aliases with cycle detection at load time.
- [ ] Exit code propagation.
- [ ] Pass-through args via `--` separator.
- [ ] Working directory (`cwd:` field) per alias, defaulting to project root.
- [ ] Env var injection: merged config values available both as interpolated `${VAR}` and as actual env vars in the child process environment.
- [ ] Gitignore safety warning if `secrets.yml` or `local.yml` is tracked.
- [ ] Secrets never logged (redaction from all output paths).
- [ ] `--dry-run`: print resolved commands without executing.
- [ ] `--verbose`: show config resolution trace (which file each value came from), redacting secrets.
- [ ] Colored output with TTY detection (strip ANSI when piped).

### Add After Validation (v1.x)

Features to add once core config model and command execution are stable.

- [ ] Shell completions (bash / zsh / fish / PowerShell) — commander.js has `generateCompletion` support; add once command surface is stable.
- [ ] Command timing output (elapsed ms per step) — low effort, high observability value.
- [ ] `loci init` — creates stub `.loci/` directory with example `commands.yml` and `config.yml` including gitignore guidance.
- [ ] `loci validate` — parse and lint `commands.yml` + config files without executing; report undefined vars, cycles, missing files.
- [ ] Output grouping mode for parallel groups (buffer per-alias, print on completion) — alternative to prefixed streaming, useful for CI logs.

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] `loci run --env=prod` — environment selector that loads an env-specific override layer. Needs schema design before implementation.
- [ ] Remote secret backend adapters (Vault, AWS SSM, 1Password CLI) — each requires individual integration; only viable after user demand is demonstrated.
- [ ] Interactive prompt within a command alias (`${{ input: "Enter target host" }}`) — see `just`'s `@question` and `mise`'s prompt support; requires TTY stdin handling.
- [ ] Per-alias timeout with configurable failure behavior.
- [ ] `loci --format=json` machine-readable list output — useful for IDE integrations.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| 4-layer config merge | HIGH | MEDIUM | P1 |
| `${VAR}` undefined = loud error | HIGH | LOW | P1 |
| Sequential chain + stop-on-first-failure | HIGH | LOW | P1 |
| Parallel group + prefixed output | HIGH | MEDIUM | P1 |
| List aliases with descriptions | HIGH | LOW | P1 |
| Exit code propagation | HIGH | LOW | P1 |
| Pass-through args (`--`) | HIGH | LOW | P1 |
| Secrets redaction from output | HIGH | MEDIUM | P1 |
| Gitignore safety warning | MEDIUM | LOW | P1 |
| `--dry-run` | HIGH | LOW | P1 |
| `--verbose` config trace | HIGH | MEDIUM | P1 |
| Composable aliases + cycle detection | MEDIUM | MEDIUM | P1 |
| Working directory (`cwd:`) per alias | MEDIUM | LOW | P1 |
| Colored output + TTY detection | MEDIUM | LOW | P1 |
| Shell completions | MEDIUM | LOW | P2 |
| Command timing | LOW | LOW | P2 |
| `loci init` scaffolding | MEDIUM | LOW | P2 |
| `loci validate` (lint mode) | MEDIUM | LOW | P2 |
| Environment selector (`--env=`) | MEDIUM | HIGH | P3 |
| Remote secrets backends | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch — without these, the tool does not deliver its core value promise
- P2: Should have, add in v1.x after core is working
- P3: Nice to have, defer to v2+ or after validated demand

---

## Competitor Feature Analysis

| Feature | `just` | `task` (go-task) | `npm-run-all2` / `concurrently` | `zx` | loci approach |
|---------|--------|-----------------|--------------------------------|------|---------------|
| Config format | Custom DSL (`justfile`) | YAML (`Taskfile.yml`) | `package.json` scripts | JavaScript/TypeScript | YAML (`.loci/commands.yml`) |
| Variable interpolation | `{{var}}`, silently empty if undefined | Go templates `{{.VAR}}`, errors on missing | `$npm_config_*` env vars only | JS template literals | `${VAR}`, error on undefined |
| Layered config | `.env` file only (single layer) | `dotenv:` per task, no machine layer | None (npm scripts only) | None built-in | 4 layers: machine / project / secrets / local |
| Secrets management | `.env` file, no gitignore check | `dotenv:` file, no gitignore check | None | None | Dedicated `secrets.yml`, gitignore warning, redaction |
| Sequential chains | Recipe dependencies (pre-run) | `deps:` + `--parallel=false` | `run-s` (sequential runner) | `await` in JS | First-class `chain:` type with stop-on-first-failure |
| Parallel execution | `[parallel]` attribute (recent) | `deps:` (parallel by default) | `run-p` / `concurrently` | `Promise.all()` | First-class `group:` type |
| Parallel output | N/A (single recipes) | `interleaved` / `group` / `prefixed` modes | `concurrently`: color-prefixed; `npm-run-all`: none | Interleaved (user manages) | `prefixed` mode as default |
| Pass-through args | Positional recipe args | `.CLI_ARGS` via `--` | Not natively; requires wrapper | Function args | `--` appended to resolved command |
| `--list` discovery | `just --list` (excellent, with descriptions) | `task --list` / `task --list-all` | None | None | `loci` or `loci --list` |
| Shell completions | Yes (bash/zsh/fish/elvish/nushell) | Yes (was experimental, now in deprecation discussion) | No | No | v1.x (post-launch) |
| `--dry-run` | No | `task --dry` | No | No | Yes, v1 |
| Verbose / resolution trace | No | No | No | Partial (echo mode) | Yes, v1 |
| Gitignore safety check | No | No | No | No | Yes, v1 |
| Cross-platform | Yes (Rust binary) | Yes (Go binary) | Yes (Node) but tied to npm scripts | Yes (Node) | Yes (Node + `execa`) |
| Install | Binary (brew/cargo/scoop) | Binary (brew/go/scoop) | `npm i -D` (project-local) | `npm i -g` | `npm i -g` |
| Maintenance status | Active (Casey, frequent releases) | Active | `npm-run-all` abandoned; `npm-run-all2` is maintained fork | Active (Google) | Greenfield |

---

## Config Ergonomics Notes

### How existing tools handle layered config

- **`just`**: Single `.env` file (dotenv-path/dotenv-filename settings). No concept of machine-level or project-vs-secrets separation. Environment vars set outside justfile are inherited but not structured.
- **`task`**: `dotenv:` list at global or task level. First file wins. No machine-level concept. Can include other Taskfiles via `includes:`, which gives partial layering but not for variables.
- **`make`**: Inherits shell env. No config file concept for variables beyond the Makefile itself. Workaround: `include .env.make` at top of Makefile.
- **`mise`**: Project-level `mise.toml` with `[env]` section. Supports `redact = true` per variable. No machine-level separate file — machine config is in `~/.config/mise/config.toml`.

**The gap loci fills**: No tool separates machine defaults (the path to your Docker socket, your cloud CLI profile) from project defaults (image names, version tags) from secrets (tokens, passwords) from local overrides (your specific port bindings). This four-way separation is novel in the category and directly reflects real team workflows where different developers have different machine configs but share a project config.

### How interpolation is typically done

- **`just`**: `{{var}}` syntax (Handlebars-inspired). Variables defined with `:=`. Undefined vars silently expand to empty.
- **`task`**: Go template syntax `{{.VAR}}`. Supports dynamic vars via `sh:`. Has `vars:` priority order (CLI > task > global > OS env).
- **`make`**: `$(VAR)` syntax. Undefined vars expand to empty.
- **`zx`**: JavaScript template literals — full JS power but requires writing code, not config.

**loci's choice** (`${VAR}`) is familiar to shell users, JSON users, and many CI systems. The deliberate "fail loud on undefined" is the differentiating correctness guarantee.

### How secrets are kept out of committed files

- **`just`**: `.env` file loaded via `dotenv-load` setting. User is responsible for `.gitignore`. No enforcement.
- **`task`**: Same pattern — `dotenv:` file, user manages `.gitignore`. No enforcement.
- **`mise`**: `redact = true` per variable in `mise.toml`. Still user-managed.
- **`dotenvx`** (not a task runner, but adjacent): Encrypts `.env` files so they can be committed safely — a different approach, out of scope for loci.

**loci's approach**: Ship with a documented `.gitignore` template for `.loci/secrets.yml` and `.loci/local.yml`. On startup, actively check `git ls-files --error-unmatch .loci/secrets.yml` and warn if it exits 0 (file is tracked). This is the only tool in the space that actively enforces the contract.

---

## Sources

- `just` manual: https://just.systems/man/en/
- `just` GitHub: https://github.com/casey/just
- `task` (go-task) GitHub: https://github.com/go-task/task
- `task` usage docs: https://taskfile.dev/usage/
- `concurrently` passthrough args issue #33: https://github.com/open-cli-tools/concurrently/issues/33
- `npm-run-all2` (maintained fork): https://github.com/bcomnes/npm-run-all2
- Task Runner Census 2025: https://aleyan.com/blog/2025-task-runners-census/
- Task Runner Census HN discussion: https://news.ycombinator.com/item?id=44559375
- `mise` tasks: https://mise.jdx.dev/tasks/
- "I've tried the just task runner" (2024 review): https://twdev.blog/2024/06/just/
- Grunt/Gulp complexity analysis: https://blog.logrocket.com/node-js-task-runners-vs-module-bundlers/

---

*Feature research for: cross-platform CLI command runner / local CI tool (Node.js) — loci*
*Researched: 2026-04-10*
