---
phase: 03-commands-resolver
plan: "01"
subsystem: commands-loader
tags: [yaml, commands, tokenizer, normalize, validate, cycle-detection, tdd]
dependency_graph:
  requires:
    - "src/errors.ts (CircularAliasError, UnknownAliasError, CommandSchemaError, YamlParseError)"
    - "src/types.ts (CommandDef, CommandMap, CommandsLoader, PlatformOverrides, CommandRef)"
    - "yaml 2.8.3 (already installed)"
  provides:
    - "commandsLoader.load(cwd) — full commands.yml parse, normalize, validate pipeline"
    - "tokenize(input, aliasName) — whitespace tokenizer with double-quote preservation"
    - "normalizeCommands(raw, filePath) — raw YAML to typed CommandDef normalization"
    - "validateGraph(commands) — DFS cycle detection with depth cap"
  affects:
    - "Phase 3 Plan 02 (resolver) depends on CommandMap produced by commandsLoader.load()"
    - "Phase 4 (Executor & CLI) will wire commandsLoader.load() into the run pipeline"
tech_stack:
  added: []
  patterns:
    - "TDD (RED/GREEN/REFACTOR) for all modules"
    - "DFS three-color marking for cycle detection (white/gray/black)"
    - "D-09 lookup-based alias detection: only CommandMap keys are alias edges"
    - "D-14: platform-only commands accepted with empty default cmd[]"
    - "Biome --unsafe auto-fix for useLiteralKeys rule"
key_files:
  created:
    - src/commands/tokenize.ts
    - src/commands/normalize.ts
    - src/commands/validate.ts
    - src/commands/__tests__/tokenize.test.ts
    - src/commands/__tests__/commands.test.ts
  modified:
    - src/commands/index.ts
decisions:
  - "D-09 lookup-based alias detection implemented in validate.ts getAliasRefs(): only step/group entries that exist as CommandMap keys are followed as graph edges; all others are inline commands with no validation"
  - "Depth cap (D-10) enforced in DFS at depth > 10, throws CommandSchemaError with expansion chain using path[0] as alias name"
  - "UnknownAliasError not thrown at load time for non-alias step entries — per D-09, unknown entries are inline commands not alias refs"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-13"
  tasks_completed: 2
  files_changed: 6
---

# Phase 3 Plan 1: Commands Loader Implementation Summary

**One-liner:** Commands.yml loader with character-by-character tokenizer, typed CommandDef normalization for all YAML shapes (string/array/object/steps/parallel/platform-overrides), and DFS three-color cycle detection with depth cap at 10.

## What Was Built

Replaced the `NotImplementedError` stub in `src/commands/index.ts` with a full `commandsLoader` implementation as a three-stage pipeline:

**Stage 1 — Tokenizer (`src/commands/tokenize.ts`):**
- Single function `tokenize(input, aliasName): readonly string[]`
- Character-by-character loop tracking `inQuotes` boolean
- Double-quoted segments preserved as single tokens (quotes stripped)
- Whitespace (space, tab, newline) acts as delimiter outside quotes
- Unclosed double quote throws `CommandSchemaError`
- Returns empty array for empty string

**Stage 2 — Normalizer (`src/commands/normalize.ts`):**
- `normalizeCommands(raw, filePath): CommandMap` — iterates all YAML entries
- `normalizeAlias()` dispatches by type: string → single (tokenized), array → single (validated), object → `normalizeObject()`
- `normalizeObject()` handles: `steps:` (sequential), `parallel:` (parallel group), or `cmd:` + optional platform overrides (single)
- Platform overrides (`linux:`, `windows:`, `macos:`) each require a `cmd` string or array
- D-14: `cmd` is optional when platform overrides are present; defaults to `[]`
- Throws `CommandSchemaError` for: null values, number values, non-array steps/parallel, non-string array elements, objects with no `cmd`/`steps`/`parallel`

**Stage 3 — Graph Validator (`src/commands/validate.ts`):**
- `validateGraph(commands): void` — DFS with three-color marking (white/gray/black)
- `getAliasRefs()` implements D-09: only step/group entries matching CommandMap keys are followed as edges
- Cycle detection: gray-node revisit extracts cycle path from the DFS path stack
- Depth cap: throws `CommandSchemaError` at depth > 10 with full expansion chain
- All aliases validated eagerly at load time (D-11)

**Loader entry point (`src/commands/index.ts`):**
- Reads `.loci/commands.yml` with `readFileSync`; ENOENT returns empty Map
- Parses YAML with `yaml` 2.8.3; `YAMLParseError` → `YamlParseError` with file path and line
- Array or scalar root → `YamlParseError`
- Null/empty document → empty Map
- Chains: `readCommandsYaml` → `normalizeCommands` → `validateGraph` → returns `CommandMap`

**Test suite:**
- `tokenize.test.ts`: 9 unit tests covering all tokenizer behaviors
- `commands.test.ts`: 33 integration tests covering normalization, YAML error cases, schema validation, cycle detection, and D-09 lookup semantics

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Convention] Biome useLiteralKeys and formatter fixes applied**
- **Found during:** Task 1 and Task 2 lint checks
- **Issue:** Biome flagged `obj['steps']` style as `useLiteralKeys` (info-level), plus formatter had line-length preferences for multi-property `toMatchObject()` calls, and `afterEach`/`UnknownAliasError` imports were unused in commands.test.ts
- **Fix:** Applied `npx biome check --write --unsafe` to auto-fix all issues. The `useLiteralKeys` fixes converted bracket notation to dot notation on `Record<string, unknown>` accesses; the formatter reformatted long object literals to multi-line; unused imports removed.
- **Files modified:** `src/commands/normalize.ts`, `src/commands/__tests__/commands.test.ts`
- **Commits:** e4e0493 (normalize), 1bae053 (commands.test.ts)

## Known Stubs

None. The `commandsLoader.load()` now returns real `CommandMap` data parsed from `.loci/commands.yml`. The `src/resolver/index.ts` stub (Phase 3 Plan 02) is separate and intentionally not touched by this plan.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced beyond those documented in the plan's threat model. All trust boundary mitigations from the plan are satisfied:

- **T-03-01 (DoS via cycle):** DFS with three-color marking terminates on any input; depth cap at 10 prevents deep recursion. Verified by cycle detection tests.
- **T-03-02 (Schema tampering):** All raw YAML values validated before constructing `CommandDef`; non-string/non-object/non-array values throw `CommandSchemaError`. Verified by schema validation tests.
- **T-03-03 (Secret disclosure in errors):** Error constructors receive only alias names and structural descriptions — never config values. Pattern follows Phase 1 `ShellInjectionError` precedent.
- **T-03-04 (Tokenizer injection):** Tokenizer splits on whitespace with quote preservation; no shell metacharacter interpretation. `shell:false` in Phase 4 ensures argv safety.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/commands/tokenize.ts | FOUND |
| src/commands/normalize.ts | FOUND |
| src/commands/validate.ts | FOUND |
| src/commands/index.ts (stub replaced) | FOUND |
| src/commands/__tests__/tokenize.test.ts | FOUND |
| src/commands/__tests__/commands.test.ts | FOUND |
| Commit cb725b5 (test: tokenize RED) | FOUND |
| Commit e4e0493 (feat: tokenize + normalize GREEN) | FOUND |
| Commit 7fe446d (test: commands integration RED) | FOUND |
| Commit 1bae053 (feat: validate + index + tests GREEN) | FOUND |
| npx vitest run src/commands/__tests__/ — 42 tests pass | PASS |
| npx biome check src/commands/ — clean | PASS |
| npx tsup — dist/cli.mjs 126.41 KB build success | PASS |
| index.ts does NOT contain NotImplementedError | PASS |
