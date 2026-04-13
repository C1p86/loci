# Phase 2: Config System - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers the **4-layer YAML config loader** — the engine that every subsequent phase depends on for parameter resolution and secrets handling:

- A config loader (`src/config/index.ts`) that reads up to 4 YAML files, parses them with YAML 1.2 semantics, flattens nested keys to dot-notation, and merges them with deterministic precedence: `machine → project → secrets → local` (last wins).
- Provenance tracking: for each merged key, records which of the 4 layers provided the final value (needed for `--verbose` trace and secrets redaction in Phases 3-4).
- Secrets safety: warns at load time if `secrets.yml` is git-tracked; tags keys from `secrets.yml` in the `secretKeys` set so downstream code can redact them.
- Error handling: explicit errors for malformed YAML (file + line + message), non-string leaf values (path + expected/actual type), and graceful handling of missing files and empty files.

**Phase 2 does NOT deliver:** commands.yml parsing, placeholder interpolation, command execution, `loci init`, CLI flags (`--verbose`, `--dry-run`). Those are Phases 3-5.

</domain>

<decisions>
## Implementation Decisions

### Config File Structure
- **D-01: Nested YAML with dot-flatten.** Config files use nested YAML structure (e.g., `deploy.host` under `deploy:` object). The loader recursively flattens all nested objects into dot-separated keys before merge. Users write natural YAML; the system operates on flat `Record<string, string>`.
- **D-02: Leaf-level merge.** Each leaf key is independent in the merge. If `project` defines `deploy.host` and `deploy.user`, and `local` overrides only `deploy.host`, `deploy.user` is preserved from `project`. This is "flatten first, merge second" — not object-level replacement.
- **D-03: Strings only.** `ConfigValue = string` (already defined in `types.ts`). No arrays, no numbers, no booleans as native types. YAML 1.2 semantics already treats unquoted values as strings by default. This aligns with the env-var model (INT-04).
- **D-04: Non-string leaf = error.** If a nested value resolves to a non-string leaf (e.g., an array `[8080, 443]`), the loader throws `YamlParseError` with the full dot-notation path and the actual type found: `"deploy.ports: expected string, got array"`. No silent stringify, no skip.

### Secrets Detection
- **D-05: Check at load time, warning only.** When `secrets.yml` exists and is loaded, the loader runs `git ls-files --error-unmatch .loci/secrets.yml` synchronously. If the file IS tracked: emit a warning to stderr with remediation hint (`git rm --cached .loci/secrets.yml`). Does NOT block execution (CFG-09 explicitly says "non blocca"). If not inside a git repo: skip the check silently.

### Error UX
- **D-06: File + line + message.** YAML parse errors show: filename, line number, column number, and the parser's error message. No source snippet extraction — the `yaml` library already provides line/column in its error objects. Map to `YamlParseError` with `suggestion` field populated.
- **D-07: Empty file = empty config.** A file that exists but is empty (0 bytes, whitespace-only, or comments-only) is treated as an empty config layer (`{}`). No error, no warning. YAML parser returns `null` for empty documents — the loader normalizes to `{}`.
- **D-08: Missing files are normal.** If any of the 4 config files doesn't exist, that layer is silently skipped. Only the machine config path (from `LOCI_MACHINE_CONFIG` env var) is truly optional by design; the others are optional in practice (project might not have `.loci/` yet). No error for missing files (CFG-08).

### Claude's Discretion

The planner/executor has flexibility on these details:
- Internal architecture of the loader (single function vs class vs pipeline of transforms) — as long as it implements `ConfigLoader` from `types.ts`.
- Whether the flatten function is a separate exported utility or an internal helper.
- Test file organization within `src/config/__tests__/`.
- Whether to use `child_process.execSync` or `execa` for the `git ls-files` check (execSync is simpler for a sync boolean check; execa is already a dep but is async).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Contracts (locked — do not modify)
- `src/types.ts` §ConfigLoader — `ResolvedConfig`, `ConfigValue`, `ConfigLayer`, `ConfigLoader` interface
- `src/errors.ts` — `ConfigError`, `YamlParseError`, `SecretsTrackedError`, `MissingConfigError` already declared
- `src/config/index.ts` — Phase 2 landing point (currently stub, replace implementation)

### Project Instructions
- `CLAUDE.md` §Technology Stack — `yaml` 2.8.3 (YAML 1.2 semantics), version pinning rules
- `CLAUDE.md` §Constraints — security rules for secrets.yml handling, no logging secret values

### Requirements
- `.planning/REQUIREMENTS.md` §Config System — CFG-01 through CFG-10

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `yaml` package (2.8.3): Already installed and pinned. Full YAML 1.2 support, TypeScript types built-in. Parse errors include line/column natively.
- `execa` package (9.6.1): Available for subprocess execution (git ls-files check), but `child_process.execSync` may be simpler for a sync boolean check.
- `LociError` hierarchy: `ConfigError` base + `YamlParseError`, `SecretsTrackedError`, `MissingConfigError` concrete classes already exported from `src/errors.ts`. Phase 2 imports and throws — no new error classes needed.

### Established Patterns
- Feature-folder layout: `src/config/index.ts` is the entry point. Tests go in `src/config/__tests__/`.
- Stub pattern: current `index.ts` exports typed functions that throw `NotImplementedError`. Phase 2 replaces the implementation in-place.
- Type contracts: `ConfigLoader.load(cwd: string): Promise<ResolvedConfig>` is the interface to implement.

### Integration Points
- `src/cli.ts`: Currently does not call config loader. Phase 3+ will wire `loadConfig()` into the CLI pipeline.
- `ResolvedConfig.secretKeys`: Populated by the loader with keys from `secrets.yml`. Used by Phase 3 (interpolation) for redaction.
- `ResolvedConfig.provenance`: Populated by the loader with per-key layer tracking. Used by Phase 4 (`--verbose` flag).

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for the config loading pipeline.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-config-system*
*Context gathered: 2026-04-13*
