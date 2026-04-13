# Phase 3: Commands & Resolver - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 delivers the **commands.yml parser, alias composition engine, and placeholder resolver** — everything between "config is loaded" (Phase 2) and "command is executed" (Phase 4):

- A commands loader (`src/commands/index.ts`) that reads `.loci/commands.yml`, parses alias definitions (single, sequential, parallel), validates schema, detects circular alias references, and resolves alias composition into a flat `CommandMap`.
- A resolver (`src/resolver/index.ts`) that takes an alias name, the `CommandMap`, and a `ResolvedConfig`, then interpolates `${VAR}` placeholders, selects platform-specific commands, and produces an `ExecutionPlan` ready for Phase 4's executor.
- Secrets redaction layer: values from `secretKeys` are replaced with `***` in any verbose/dry-run output representation (INT-05). Actual env var injection of secrets is permitted (12-factor model).

**Phase 3 does NOT deliver:** process spawning, stdout/stderr streaming, parallel process management, `--dry-run`/`--verbose`/`--list` CLI flags, `loci init`, or npm publication. Those are Phases 4-5.

</domain>

<decisions>
## Implementation Decisions

### YAML Schema Design
- **D-01: String shorthand for single commands.** A bare string value (`build: "npm run build"`) is the simplest way to define a command. An explicit object form (`build: { cmd: "npm run build", description: "..." }`) is also accepted for when description or platform overrides are needed.
- **D-02: `steps:` and `parallel:` keys for multi-command aliases.** Sequential chains use `steps:` key; concurrent groups use `parallel:` key. The key name explicitly declares the execution mode — no ambiguity.
- **D-03: Whitespace split for string commands.** String commands are split on whitespace into argv tokens, with quoted segments preserved as single tokens (`"echo \"hello world\""` → `["echo", "hello world"]`). Users can use array form (`cmd: ["echo", "hello world"]`) for edge cases where splitting is ambiguous.
- **D-04: Description on all command types.** Any alias — single, sequence, or parallel — can have an optional `description:` field. Used by `loci --list` (CLI-02) and `loci <alias> --help` (CLI-04).

### Placeholder Resolution
- **D-05: Inline expansion of placeholders.** Multiple `${VAR}` placeholders in one token expand in-place: `"scp ${USER}@${HOST}:/app"` → one argv token `"scp admin@server.com:/app"`. Placeholders reference config keys using dot notation (`${deploy.host}`).
- **D-06: `$${}` escape for literal dollar-brace.** `$${VAR}` in a command string produces the literal text `${VAR}` in the output. Double dollar sign escaping, familiar from Makefiles.
- **D-07: All config keys injected as env vars.** Every key from the merged config becomes an environment variable of the child process (INT-04). Sub-commands can read any config value via `process.env` without explicit `${VAR}` interpolation in the command string. Secrets in env vars are normal (12-factor); redaction (INT-05) applies only to loci's own `--verbose`/`--dry-run` output.
- **D-08: Dot-to-underscore uppercased env var names.** Config keys like `deploy.host` map to env var `DEPLOY_HOST`. Dots become underscores, entire name is uppercased. Placeholder syntax remains dot notation (`${deploy.host}`).

### Composition & Cycles
- **D-09: Mixed steps — inline commands and alias references.** Each entry in `steps:` or `parallel:` can be either a string command or an alias name. Loci uses lookup-based detection: if a step string matches a known alias name in `CommandMap`, it's expanded as an alias reference; otherwise it's treated as an inline command.
- **D-10: Nesting depth cap at 10.** Alias composition can nest up to 10 levels. Exceeding this limit produces an error with the full expansion chain. Prevents runaway recursion beyond what cycle detection catches.
- **D-11: Eager validation at load time.** When `commands.yml` is parsed, ALL aliases are validated immediately: cycle detection across the entire graph (CMD-06), unknown alias reference checks (CMD-09), and schema validation. Errors are reported before any command runs, even for aliases not being invoked.

### Platform Overrides
- **D-12: Full command replacement.** `linux:`, `windows:`, `macos:` blocks replace the entire command string for that platform — no partial merging of executable vs arguments. Simple mental model: "on Windows, run THIS instead."
- **D-13: Single commands only.** Platform overrides apply only to `single` type commands (those with `cmd:`). Sequences and parallel groups achieve per-platform behavior by composing aliases that individually have platform overrides.
- **D-14: Default cmd: is optional.** A command can have only platform overrides (no default `cmd:` field). Load-time validation accepts this. If the command is run on an OS with no matching override and no default `cmd:`, loci errors at run time with a message like: `"alias 'cleanup' has no command for linux (only windows defined)"`.

### Claude's Discretion

The planner/executor has flexibility on:
- Internal architecture of the commands loader (parser → validator → flattener pipeline vs monolithic function) as long as it implements `CommandsLoader` from `types.ts`.
- Exact whitespace-split implementation (custom tokenizer vs a lightweight library) — must handle double-quoted segments correctly.
- Whether cycle detection uses DFS with coloring, topological sort, or another algorithm — must report the full cycle path per CMD-06.
- Whether the resolver is a single `resolve()` function or a pipeline of transforms — must implement `Resolver` from `types.ts`.
- Test organization within `src/commands/__tests__/` and `src/resolver/__tests__/`.
- How `ExecutionPlan` represents the env vars to inject (separate field, or assumed from `ResolvedConfig` passed to executor).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Contracts (locked — do not modify)
- `src/types.ts` §CommandsLoader — `CommandDef`, `CommandMap`, `CommandsLoader` interface, `CommandRef`, `PlatformOverrides`
- `src/types.ts` §Resolver — `ExecutionPlan`, `Resolver` interface
- `src/errors.ts` — `CommandError`, `CircularAliasError`, `UnknownAliasError`, `CommandSchemaError`, `InterpolationError`, `UndefinedPlaceholderError` already declared
- `src/commands/index.ts` — Phase 3 landing point (currently stub, replace implementation)
- `src/resolver/index.ts` — Phase 3 landing point (currently stub, replace implementation)

### Phase 2 Contracts (locked — consume, do not modify)
- `src/config/index.ts` — `configLoader.load(cwd)` returns `ResolvedConfig` with `values`, `provenance`, `secretKeys`
- `src/types.ts` §ConfigLoader — `ResolvedConfig`, `ConfigValue`, `ConfigLayer`

### Project Instructions
- `CLAUDE.md` §Technology Stack — `yaml` 2.8.3 (YAML 1.2 semantics), version pinning rules
- `CLAUDE.md` §Constraints — security rules for secrets handling, no logging secret values

### Requirements
- `.planning/REQUIREMENTS.md` §Commands System — CMD-01 through CMD-09
- `.planning/REQUIREMENTS.md` §Interpolation & Env Injection — INT-01 through INT-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `yaml` package (2.8.3): Already installed and used by Phase 2's config loader. Same parser for `commands.yml`.
- `LociError` hierarchy: `CircularAliasError`, `UnknownAliasError`, `CommandSchemaError`, `UndefinedPlaceholderError` already exported from `src/errors.ts`. Phase 3 imports and throws.
- `configLoader`: Returns `ResolvedConfig` with flat `values` map (dot-notation keys), `secretKeys` set, and `provenance` map.

### Established Patterns
- Feature-folder layout: `src/commands/index.ts` and `src/resolver/index.ts` are the entry points. Tests go in `__tests__/` subdirectories.
- Stub pattern: current stubs export typed objects (`commandsLoader`, `resolver`) that throw `NotImplementedError`. Phase 3 replaces implementation in-place.
- Type contracts: `CommandsLoader.load(cwd): Promise<CommandMap>` and `Resolver.resolve(alias, commands, config): ExecutionPlan` are the interfaces to implement.
- Phase 2's `readLayer()` + `flattenToStrings()` pattern for YAML loading may inform the commands loader structure.

### Integration Points
- `src/cli.ts`: Currently does not call commands loader. Phase 4 will wire `commandsLoader.load()` and `resolver.resolve()` into the CLI pipeline.
- `ResolvedConfig.secretKeys`: Used by the resolver for redaction in `--dry-run` output representation.
- `ResolvedConfig.values`: Source for `${VAR}` placeholder resolution and env var injection.

</code_context>

<specifics>
## Specific Ideas

- User chose lookup-based alias detection (D-09): if a step string matches a known alias, expand it; otherwise treat as inline command. Edge case documented: an alias named "npm" shadows the system binary in step context — user uses quoted string or array form to force inline.
- User chose run-time error for platform-only aliases (D-14) over load-time validation — enables legitimate "windows-only" or "linux-only" aliases in multi-platform teams.
- Env var naming convention (D-08) means the same key has two access paths: `${deploy.host}` in commands.yml interpolation, and `DEPLOY_HOST` as env var in child processes. Both are documented.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-commands-resolver*
*Context gathered: 2026-04-13*
