# Phase 1: Foundation - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a **runnable but empty `loci` binary skeleton** plus the shared ground every later phase depends on:

- A TypeScript ESM package bundled by tsup to a single `dist/cli.mjs` with shebang, installable via `npm i -g .` on Windows 10+/Linux/macOS.
- The full `LociError` hierarchy (base + area bases + concrete failure subclasses), declared in Phase 1 even though only Phase 1 code instantiates them. Phases 2-5 just import and throw.
- All shared TypeScript types for downstream pipeline stages (`ResolvedConfig`, `CommandMap`, `ExecutionPlan`, etc.) defined in `src/types.ts`.
- Feature folders for Phases 2-5 pre-created with `index.ts` stubs that throw "Not implemented" — so every phase lands in a predictable location.
- vitest and biome wired from the first commit; tsup config bundling all deps into a single `.mjs`; shebang injection via tsup.
- GitHub Actions CI matrix (Ubuntu / Windows / macOS × Node 20 / Node 22) running `build + test + lint` on push-to-main and all PRs, plus a smoke check that `loci --version` exits 0 on every runner.
- Commander.js wired at `src/cli.ts` with `--version`, `--help`, and a graceful empty-state message — no alias sub-commands yet (those arrive with Phases 3+).

**Phase 1 does NOT deliver:** config loading, commands.yml parsing, alias resolution, process execution, `.loci/` scaffolding, or npm publication. Those are Phases 2-5.

</domain>

<decisions>
## Implementation Decisions

### Error Hierarchy (`src/errors.ts`)

- **D-01: Hybrid taxonomy.** `LociError` (abstract base) → per-area base classes (`ConfigError`, `CommandError`, `InterpolationError`, `ExecutorError`, `CliError`) → concrete failure subclasses that extend the area base (e.g. `YamlParseError extends ConfigError`, `SecretsTrackedError extends ConfigError`, `CircularAliasError extends CommandError`, `UndefinedPlaceholderError extends InterpolationError`, `ShellInjectionError extends ExecutorError`, `UnknownAliasError extends CliError`). Downstream code can catch either the specific failure or the area group.
- **D-02: Exit codes per category, stable ranges.** `0` = success, `10` = ConfigError, `20` = CommandError, `30` = InterpolationError, `40` = ExecutorError, `50` = CliError. Child-process exit codes from EXE-03 propagate unchanged (not mapped into the 40 range). Ranges documented in README and in a `ExitCode` const object.
- **D-03: Full taxonomy declared in Phase 1.** All area bases AND all concrete subclasses we can foresee from REQUIREMENTS.md + PITFALLS.md exist as exported classes in `src/errors.ts` from Phase 1's first commit. Phases 2-5 import and throw; they never add to the hierarchy unless a genuinely new failure mode emerges. Rationale: avoids scope creep on later phase commits and gives TypeScript stable type identities from day one.
- **D-04: Structured error shape.** `LociError` carries `{ code: string (machine id like 'CFG_YAML_PARSE'), category: string, suggestion?: string, cause?: unknown }` in addition to the standard `message` + `name`. `cause` uses the native Node 16+ `Error.cause` contract. Satisfies CLI-09 ("categoria, causa, suggerimento"). Tests assert `instanceof` chains, `code` uniqueness across the hierarchy, and category-to-exit-code mapping.

### Source Layout (`src/`)

- **D-05: Feature folders aligned to the ARCHITECTURE.md pipeline.** Structure:
  ```
  src/
    cli.ts                    # bin entry point (Phase 1: commander wired, empty)
    errors.ts                 # full LociError hierarchy (Phase 1)
    types.ts                  # shared types for all stages (Phase 1)
    version.ts                # re-exports __LOCI_VERSION__ for CLI
    config/
      index.ts                # throws NotImplemented stub (Phase 2 fills)
      __tests__/
    commands/
      index.ts                # throws NotImplemented stub (Phase 3 fills)
      __tests__/
    resolver/
      index.ts                # throws NotImplemented stub (Phase 3 fills)
      __tests__/
    executor/
      index.ts                # throws NotImplemented stub (Phase 4 fills)
      __tests__/
    __tests__/                # top-level tests for cli.ts, errors.ts, types.ts
  ```
  Rejected flat `src/` and layered `domain/infra/cli` structures.
- **D-06: Phase 1 pre-creates stub index.ts files** in each feature folder. Each stub exports a function (e.g. `export function loadConfig(): never { throw new LociError(...) }`) typed against the interface declared in `src/types.ts`. This gives Phase 2-5 commits a clean landing spot that does not touch unrelated files. `types.ts` is fully populated in Phase 1 — every interface downstream code will need is already declared.
- **D-07: Single entry point `src/cli.ts` → `dist/cli.mjs`.** `package.json` has `"bin": { "loci": "./dist/cli.mjs" }`. tsup injects the `#!/usr/bin/env node` shebang automatically. No `bin/` subfolder.
- **D-08: Co-located `__tests__/` folders per module.** vitest picks them up by default (`include: ['**/__tests__/**/*.test.ts']`). tsup entry glob excludes `__tests__` so tests never land in the bundle. Phase 1 adds tests for `errors.ts`, `types.ts` (type-level assertions via `expectTypeOf`), and `cli.ts` (E2E spawn).

### CI Matrix

- **D-09: Node matrix = [20, 22].** Node 20 is the engines floor (`engines.node: ">=20.5.0"` matches execa 9.x's floor); Node 22 is current Active LTS. Node 24 intentionally excluded — adoption still thin, 3×3 = 9 jobs is more than needed for a single-developer project at this stage.
- **D-10: OS matrix = [ubuntu-latest, windows-latest, macos-latest].** Real Windows (not WSL) is non-negotiable per PITFALLS.md §2 — WSL hides PATHEXT and `.cmd` shim failures. macos-latest runs on Apple silicon. All three OS × 2 Node versions = 6 jobs per workflow run.
- **D-11: Cold-start gate = smoke check only in Phase 1.** CI runs `node dist/cli.mjs --version` once and asserts exit 0 + expected stdout. **No `hyperfine` threshold in Phase 1** — the 300ms budget (FND-03) is trivially met by an empty commander Program (~50ms). A real `hyperfine --runs 10` gate with the <300ms assertion is deferred to **Phase 5 (Polish)**, when there is actual code whose startup cost is worth protecting. This avoids runner-noise flake while the codebase is tiny.
- **D-12: CI triggers = push to main + all PRs + workflow_dispatch.** Runs on every push to `main` (catches direct commits / merge-conflict rebases), on every PR including drafts, and on manual dispatch for re-runs. Feature-branch pushes without a PR do not trigger CI.

### Skeleton Runtime Behavior (`src/cli.ts`)

- **D-13: Commander.js wired from Phase 1, no sub-commands yet.** `src/cli.ts` instantiates a `Command()` program with name `loci`, `.version(__LOCI_VERSION__)`, `.description(...)`, `.helpOption('-h, --help')`, and a default action. Phases 2-5 extend this same program as they land rather than replacing it. Unknown flags / unknown aliases hit commander's built-in error path, producing `CliError` → exit 50 (per D-02).
- **D-14: `--version` value inlined at build time.** tsup replaces the literal `__LOCI_VERSION__` with `package.json.version` during the bundle step (tsup `define` option or equivalent). Zero fs reads at startup. `src/version.ts` declares `export const LOCI_VERSION: string = '__LOCI_VERSION__';` so TypeScript is happy; the string survives until tsup swaps it. Rejected runtime `fs.readFileSync('package.json')` (adds an fs call and is brittle to bundling paths).
- **D-15: Empty-args → commander help + phase-1 hint.** Running `loci` with no args prints the commander-generated usage banner followed by: `(no aliases defined yet — .loci/commands.yml will be loaded once Phase 2+ ships)`. Exit 0. This degrades gracefully: Phases 2-5 replace the hint with the actual alias list per CLI-02 without touching the surrounding plumbing.
- **D-16: Smoke tests = unit + E2E spawn.** Unit tests cover `errors.ts` (instanceof chains, per-class `code` uniqueness, category→exit-code mapping, `cause` propagation) and `types.ts` type-level assertions. E2E tests in `src/__tests__/cli.e2e.test.ts` spawn `node dist/cli.mjs` with `--version`, `--help`, unknown flag, no args, and assert stdout/stderr/exit code. E2E runs on all 3 OS via the CI matrix — this is the proof that the bundled `.mjs` is actually runnable cross-platform, which is exactly the FND-02 success criterion.

### Claude's Discretion

The planner/executor has flexibility on these details (not locked by the user):

- Exact `code` string format for each concrete error class (suggested: `UPPER_SNAKE_CASE_CATEGORY_FAILURE`, e.g. `CFG_YAML_PARSE`, `CMD_CIRCULAR_ALIAS`).
- biome config strictness — start with biome's recommended preset; loosen only if a specific rule proves noisy during Phase 1.
- vitest config options (pool, isolate, reporters) as long as the CI matrix stays green and tests run in under a few seconds on a cold cache.
- Whether `types.ts` is one file or a `src/types/` barrel — start with a single file, split only if it exceeds ~200 lines.
- Exact tsup options as long as: single `.mjs` output, shebang injected, all deps bundled (`noExternal: [/./]` or equivalent), no sourcemap in the published artifact (keeps publish size down), build completes in the CI budget.
- License choice — MIT unless user flags otherwise; LICENSE file lands in Phase 5 with the rest of distribution prep (not Phase 1).
- Whether CI caches npm or uses a lockfile-only install — `npm ci` with actions/setup-node's built-in cache is the standard choice.
- Repository hygiene files (`.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`) — include sensible defaults in Phase 1; not worth micro-discussion.
- `package.json` metadata fields (author, repository, bugs, homepage) — planner fills from project context; not a gray area.
- Whether the empty-state hint is printed via commander's `addHelpText('after', ...)` or via the default action callback — whichever keeps exit code 0 and integrates cleanly with commander's built-in help flag.

### Folded Todos

None — no pending todos matched this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Vision & Requirements
- `.planning/PROJECT.md` — loci's core value, constraints, key decisions (locked stack including commander 14 and YAML 1.2 via `yaml`).
- `.planning/REQUIREMENTS.md` §Foundation — FND-01 through FND-06 (the Phase 1 requirement set).
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — goal, depends-on, success criteria.
- `CLAUDE.md` §Technology Stack — version pins and "What NOT to Use" table.

### Research (bundled with this project under `.planning/research/`)
- `.planning/research/SUMMARY.md` §"Phase 1: Project Foundation" — phase rationale, delivers, avoids.
- `.planning/research/STACK.md` — version pins, publishing workflow, cold-start budget, ESM vs CJS decision.
- `.planning/research/ARCHITECTURE.md` — pipeline component boundaries (ConfigLoader → CommandsLoader → Resolver → Executor → CLI) that dictate D-05 feature folder layout.
- `.planning/research/PITFALLS.md` §13 (ESM vs CJS), §2 (Windows PATHEXT), §6 (YAML coercion — not Phase 1 but establishes the `yaml` library choice), §12 (secrets.yml gitignore) — the pitfalls that the taxonomy in D-01 is preparing to throw against.
- `.planning/research/FEATURES.md` — table-stakes features list (informs which CliError subclasses are worth declaring in Phase 1).

### External Specs / ADRs
No external specs or ADRs exist — requirements are fully captured in the files above.

### Build & Tooling Documentation
- tsup docs: https://tsup.egoist.dev/ (build config, shebang injection, `define` for build-time constants)
- commander.js v14 docs: https://github.com/tj/commander.js/tree/v14.0.3 (only the core `Command()`/`.version()`/`.helpOption()` API for Phase 1; `passThroughOptions` + dynamic registration are Phase 5 concerns)
- execa v9 docs (not imported in Phase 1, but the stub signature for `src/executor/index.ts` references its types): https://github.com/sindresorhus/execa
- biome v2 config reference: https://biomejs.dev/reference/configuration/
- vitest config reference: https://vitest.dev/config/

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
**None.** This is a greenfield project — no `src/`, no `package.json`, no `tsconfig.json` exists yet. Phase 1 is literally the first code commit.

### Established Patterns
**None yet.** Phase 1 establishes the patterns that Phases 2-5 will follow:
- Feature folder per pipeline stage (D-05)
- Every component exports through an `index.ts` barrel (D-06)
- Co-located tests in `__tests__/` (D-08)
- All errors extend area-base classes from `src/errors.ts` (D-01)
- Exit codes come from the central `ExitCode` const (D-02)

### Integration Points
New code in Phase 1 wires these scaffolding integration points for later phases:
- `src/cli.ts` is the commander Program that Phases 2-5 will attach sub-commands/flags to via `program.command(...)`.
- `src/types.ts` declares the interfaces (`ConfigLoader`, `CommandsLoader`, `Resolver`, `Executor`) that Phases 2-4 will implement.
- `src/errors.ts` is the single import target for every throw site in Phases 2-5.
- `dist/cli.mjs` is the bin target that `npm i -g .` will symlink — Phase 1 guarantees it exists and is runnable on all three OS.

</code_context>

<specifics>
## Specific Ideas

- User explicitly wants Phase 1's LociError hierarchy to be **declared even where unused**, so later phases don't have to extend the taxonomy — just throw. This is a deliberate trade: bigger Phase 1 diff, smaller Phase 2-5 surface area for errors.
- User rejected runtime `fs.readFileSync('package.json')` for `--version` because of the cold-start budget (FND-03) — even though the budget is trivially met today, the pattern is wrong on principle.
- User wants **real Windows** in CI (not WSL) for the exact reason PITFALLS.md §2 calls out. Even though Phase 1 has nothing to spawn yet, the matrix shape is locked here so Phases 2-5 inherit it.
- User was happy to defer the `hyperfine` threshold to Phase 5 after understanding the GitHub runner flake risk. The decision is documented under Deferred Ideas so Phase 5 planning surfaces it.

</specifics>

<deferred>
## Deferred Ideas

### Phase 5 (Polish & Distribution)
- **Cold-start `hyperfine` gate** (deferred from D-11): add `hyperfine --runs 10 'loci --version'` to the CI matrix on all 3 OS, fail build if mean exceeds 300ms. Defer until there is meaningful code to measure so the gate catches real regressions instead of runner noise.
- **LICENSE file + repository metadata population** — MIT suggested; lands with distribution prep.
- **`loci init` scaffolding command** — Phase 5 (`INIT-*` requirements), not Phase 1.
- **npm name availability verification** — `npm info loci` before first publish (already flagged in STATE.md as a blocker).

### Not in Current Roadmap
- Shell completions (DX-V2-01), `--timing` flag (DX-V2-02), colored output respecting `NO_COLOR` (DX-V2-03), `loci config` inspection (DX-V2-04) — all v2 per REQUIREMENTS.md.
- Plugin system, watch mode, remote execution — all Out of Scope per REQUIREMENTS.md.

### Reviewed Todos (not folded)
None reviewed — no matching todos for this phase.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-10*
