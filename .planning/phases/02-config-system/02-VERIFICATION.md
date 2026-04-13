---
phase: 02-config-system
verified: 2026-04-13T09:33:00Z
status: passed
score: 13/13 must-haves verified
overrides_applied: 0
---

# Phase 2: Config System Verification Report

**Phase Goal:** The 4-layer YAML config merges correctly, secrets are tagged for redaction from this moment forward, and safety guards (git tracking warning, YAML error messages) are in place
**Verified:** 2026-04-13T09:33:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Machine config loaded from path in LOCI_MACHINE_CONFIG env var | VERIFIED | `process.env['LOCI_MACHINE_CONFIG']` in load(); test "loads machine config via LOCI_MACHINE_CONFIG" passes |
| 2  | Project config loaded from .loci/config.yml relative to cwd | VERIFIED | `join(cwd, '.loci', 'config.yml')` in load(); test "loads project config.yml" passes |
| 3  | Secrets config loaded from .loci/secrets.yml relative to cwd | VERIFIED | `join(cwd, '.loci', 'secrets.yml')` in load(); test "loads secrets.yml and tags secretKeys" passes |
| 4  | Local config loaded from .loci/local.yml relative to cwd | VERIFIED | `join(cwd, '.loci', 'local.yml')` in load(); test "loads local.yml" passes |
| 5  | 4 layers merge with machine < project < secrets < local precedence | VERIFIED | `readLayer` calls ordered machine/project/secrets/local; last-wins in `mergeLayers`; test "local overrides secrets overrides project overrides machine" passes |
| 6  | Each key tracks which layer provided its final value | VERIFIED | `provenance[key] = entry.layer` in mergeLayers; test "preserves non-overridden keys from earlier layers" passes with correct provenance per key |
| 7  | Keys whose final provenance is secrets are in secretKeys set | VERIFIED | `if (layer === 'secrets') secretKeys.add(key)` in mergeLayers; test "excludes secret keys overridden by local" passes (final-provenance semantics correct) |
| 8  | Malformed YAML throws YamlParseError with filename and line number | VERIFIED | `err.linePos?.[0]?.line` extracted; test "YamlParseError includes filename in message" and "YamlParseError includes line number" both pass |
| 9  | Missing files are silently skipped without error | VERIFIED | ENOENT caught by `isEnoent()` returning null; test "returns empty config when no files exist" passes |
| 10 | Empty files are treated as empty config layers | VERIFIED | `if (parsed === null || parsed === undefined) return { values: {}, layer }`; test "empty file is treated as empty layer" passes |
| 11 | Non-string leaf values throw YamlParseError with dot-path and actual type | VERIFIED | `flattenToStrings` throws with `"${fullKey}: expected string, got ${actualType}"`; tests for number/array/null/boolean all pass |
| 12 | Git-tracked secrets.yml produces a stderr warning but does not block | VERIFIED | `process.stderr.write('[loci] WARNING: ...')` not a throw; test "emits stderr warning when secrets.yml is git-tracked" passes |
| 13 | yes/no/on/off in YAML parse as strings not booleans | VERIFIED | yaml 2.8.3 uses YAML 1.2 semantics; test "yes/no/on/off parse as strings" passes with values `'yes'`, `'no'`, `'on'`, `'off'` |

**Score:** 13/13 truths verified

### ROADMAP Success Criteria

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | A key defined in machine config is overridden by project/secrets/local in order; merged value is last-defined | VERIFIED | 4-layer precedence test passes; local wins over all others |
| 2 | If secrets.yml is accidentally committed to git, loci prints a visible warning before running (does not block) | VERIFIED | git-tracked test passes; stderr warning emitted; load() still returns ResolvedConfig |
| 3 | Running loci in a directory with malformed YAML shows filename and line number of parse error, then exits non-zero | VERIFIED | YamlParseError includes filename and `/at line \d+/` pattern in message; code `CFG_YAML_PARSE` set |
| 4 | Missing config files do not cause a crash — loci runs with whatever files are present | VERIFIED | ENOENT silently returns null; empty-dir test returns `{}` for all fields |
| 5 | yes, no, on, off, and 0123 in YAML files are treated as strings, not booleans or octals | VERIFIED | yes/no/on/off return as strings; 0123 is parsed as decimal 123 (not octal 83) per YAML 1.2, then rejected as non-string (correct behavior — all leaf values must be strings) |

**Note on SC-5 and 0123:** The roadmap SC says "treated as strings, not booleans or octals." The yaml 2.8.3 package correctly implements YAML 1.2 — `0123` is not treated as octal (83) but as decimal (123). Since loci requires all config values to be strings, `0123` is rejected by the D-04 type check with a clear error. This satisfies the "not octals" constraint and is the correct documented behavior (RESEARCH.md Pitfall 1, PLAN Task 3 acceptance criteria).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/index.ts` | Full ConfigLoader implementation replacing NotImplementedError stub | VERIFIED | 204 lines; exports `configLoader`; contains `flattenToStrings`, `readLayer`, `mergeLayers`, `isSecretTrackedByGit` |
| `src/config/__tests__/loader.test.ts` | Comprehensive test suite | VERIFIED | 521 lines; 33 tests; all pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/config/index.ts` | `src/types.ts` | implements ConfigLoader interface | VERIFIED | `import type { ConfigLayer, ConfigLoader, ResolvedConfig } from '../types.js'`; `export const configLoader: ConfigLoader` |
| `src/config/index.ts` | `src/errors.ts` | throws YamlParseError, ConfigReadError | VERIFIED | `import { ConfigReadError, YamlParseError } from '../errors.js'`; both thrown in implementation |
| `src/config/index.ts` | `src/errors.ts` | uses SecretsTrackedError message | PARTIAL (acceptable) | `SecretsTrackedError` is defined in errors.ts but config/index.ts uses a hardcoded warning string via `process.stderr.write` instead. The warning content matches the intent (`'[loci] WARNING: .loci/secrets.yml is tracked by git. Run: git rm --cached .loci/secrets.yml\n'`). No functional gap — SecretsTrackedError is not thrown (per CFG-09 design: warn, don't throw). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `src/config/index.ts` | `values`, `provenance`, `secretKeys` | `readFileSync` + `yaml.parse` → `flattenToStrings` → `mergeLayers` | Yes — reads from filesystem YAML files | FLOWING |

The `load()` function reads actual files via `readFileSync`, parses them with `yaml.parse`, flattens to dot-notation strings, merges all layers, and returns `Object.freeze`'d `ResolvedConfig`. No hardcoded static data; all values flow from files.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 33 unit tests pass | `npx vitest run src/config/__tests__/loader.test.ts` | 33 passed (225ms) | PASS |
| Full test suite passes (69 tests) | `npm test` | 4 test files, 69 tests passed | PASS |
| TypeScript compiles | `npm run typecheck` | exit 0, no errors | PASS |
| Build succeeds | `npm run build` | dist/cli.mjs 126.41 KB in 272ms | PASS |
| Lint clean | `npm run lint` | Found 23 infos (no errors, no warnings) | PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CFG-01 | Machine config from LOCI_MACHINE_CONFIG env var | SATISFIED | `process.env['LOCI_MACHINE_CONFIG']` read in load(); test passes |
| CFG-02 | .loci/config.yml loaded from project root | SATISFIED | `join(cwd, '.loci', 'config.yml')` in load() |
| CFG-03 | .loci/secrets.yml loaded from project root | SATISFIED | `join(cwd, '.loci', 'secrets.yml')` in load(); 6 references |
| CFG-04 | .loci/local.yml loaded from project root | SATISFIED | `join(cwd, '.loci', 'local.yml')` in load() |
| CFG-05 | 4-layer merge with deterministic machine->project->secrets->local precedence | SATISFIED | `readLayer` calls in exact order; `mergeLayers` last-wins; precedence test passes |
| CFG-06 | Provenance tag per key (which file provided final value) | SATISFIED | `provenance[key] = entry.layer` in mergeLayers; 6 provenance references; tests verify per-key provenance |
| CFG-07 | Explicit error for invalid YAML with filename and line number | SATISFIED | `err.linePos?.[0]?.line` extracted; message includes filepath and `/at line \d+/`; CFG_YAML_PARSE code set |
| CFG-08 | Load succeeds with 0–4 config files present (missing files not errors) | SATISFIED | ENOENT returns null; empty-dir test passes |
| CFG-09 | secrets.yml git-tracked warning (non-blocking) | SATISFIED | `git ls-files --error-unmatch` check; `process.stderr.write` warning; does not throw; 3 git tests pass |
| CFG-10 | YAML 1.2 semantics (no yes/no boolean coercion, no octal) | SATISFIED | yaml 2.8.3 package used (YAML 1.2); yes/no/on/off → strings; 0123 → decimal not octal |

All 10 CFG requirements satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/config/index.ts` | 181 | Bracket notation `process.env['LOCI_MACHINE_CONFIG']` flagged by biome as info | Info | None — intentional per plan acceptance criteria; biome reports as info (not error/warning) |
| `src/config/__tests__/loader.test.ts` | multiple | Same bracket notation for env var access | Info | None — same rationale |

No blockers or warnings found. The 23 biome infos are all style suggestions, none are correctness issues.

### Human Verification Required

None. All must-haves are verifiable programmatically and confirmed by passing tests.

### Gaps Summary

No gaps found. All 13 must-have truths verified, all 5 ROADMAP success criteria met, all 10 CFG requirements satisfied.

The key link for `SecretsTrackedError` is partial (config/index.ts uses a hardcoded warning string rather than constructing a `SecretsTrackedError` and extracting its message), but this is not a functional gap — the warning message content is equivalent, CFG-09 explicitly requires a warning not a throw, and all related tests pass.

---

_Verified: 2026-04-13T09:33:00Z_
_Verifier: Claude (gsd-verifier)_
