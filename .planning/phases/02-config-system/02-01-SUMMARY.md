---
phase: 02-config-system
plan: "01"
subsystem: config-loader
tags: [yaml, config, merge, provenance, secrets, tdd]
dependency_graph:
  requires:
    - "src/errors.ts (YamlParseError, ConfigReadError, SecretsTrackedError)"
    - "src/types.ts (ConfigLoader, ResolvedConfig, ConfigLayer)"
  provides:
    - "configLoader.load(cwd) — full 4-layer YAML config merge"
    - "flattenToStrings — dot-notation flattening with type enforcement"
    - "mergeLayers — last-wins merge with per-key provenance and secretKeys"
  affects:
    - "Phase 3 (Commands & Resolver) depends on ResolvedConfig for ${VAR} interpolation"
    - "Phase 4 (Executor) uses secretKeys set for redaction in --dry-run output"
tech_stack:
  added: []
  patterns:
    - "Synchronous readFileSync for config files (async at interface level via load())"
    - "Object.freeze on all ResolvedConfig output for immutability"
    - "Final-provenance semantics for secretKeys (keys overridden by local not tagged)"
    - "git ls-files --error-unmatch for non-blocking secrets tracking check"
key_files:
  created:
    - src/config/__tests__/loader.test.ts
  modified:
    - src/config/index.ts
decisions:
  - "secretKeys uses final-provenance semantics (A1 from RESEARCH.md): only keys whose last write came from secrets.yml are tagged, preventing false redaction of local-overridden values"
  - "Dot-key collision detection: quoted YAML key 'a.b' colliding with nested path a.b throws YamlParseError rather than silently allowing last-writer-wins"
  - "process.env['LOCI_MACHINE_CONFIG'] bracket notation kept in implementation per plan acceptance criteria despite biome info suggestion"
  - "YamlParseError cause.message carries the detailed path/type info; outer message carries file+line per the error class contract from Phase 1"
metrics:
  duration: "~6 minutes"
  completed: "2026-04-13"
  tasks_completed: 3
  files_changed: 2
---

# Phase 2 Plan 1: Config Loader Implementation Summary

**One-liner:** 4-layer YAML config loader with dot-flatten, last-wins merge, per-key provenance, final-provenance secretKeys, and non-blocking git-tracked secrets warning.

## What Was Built

Replaced the `NotImplementedError` stub in `src/config/index.ts` with a full `configLoader` implementation consisting of four internal functions:

- **`isEnoent`**: checks for ENOENT filesystem errors (distinguishes missing files from permission errors)
- **`flattenToStrings`**: recursively flattens nested YAML objects to dot-notation string keys, enforcing string-only leaves (D-03/D-04) and detecting key collisions from quoted dot-keys
- **`readLayer`**: reads and parses one YAML file; handles ENOENT (null), empty files ({}), malformed YAML (YamlParseError with line), non-mapping root (YamlParseError), and permission errors (ConfigReadError)
- **`mergeLayers`**: iterates 4 layers in machine→project→secrets→local order, building `values` and `provenance` maps with last-wins semantics, then derives `secretKeys` from final provenance
- **`isSecretTrackedByGit`**: synchronous `git ls-files --error-unmatch` check; returns false on ENOENT (git not installed) or non-zero exit (not tracked / not a repo)
- **`configLoader.load(cwd)`**: orchestrates all layers, checks git tracking if secrets layer loaded, returns Object.freeze'd ResolvedConfig

A comprehensive test suite was written covering:
- 12 happy-path tests: empty dir, single-layer per type, 4-layer merge, leaf-level preservation, secretKeys override semantics, empty/comment files, nested flattening, frozen output
- 21 error/edge-case tests: YAML parse errors (filename, line number, code), non-string leaves (number/array/null/boolean), YAML 1.2 yes/no/on/off strings, 0123 as number, root array/scalar rejection, dot-key collision, git-tracking warning (tracked/not-tracked/non-git)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertions checked `err.message` but YamlParseError puts detail in `err.cause`**
- **Found during:** Task 3 test run (8 failing tests)
- **Issue:** The plan specified tests checking `err.message.includes('port: expected string, got number')` but `YamlParseError`'s constructor (defined in Phase 1 `src/errors.ts`, immutable) puts the outer message as `Invalid YAML in {filePath}` — the detailed cause is in `err.cause.message`.
- **Fix:** Updated test assertions to check `(err.cause as Error)?.message` for detail-containing assertions, while the outer `err.message` checks still correctly verify filename and line number.
- **Files modified:** `src/config/__tests__/loader.test.ts`
- **Commit:** ce29ce7

**2. [Rule 2 - Convention] Biome format fix applied to loader.test.ts**
- **Found during:** Task 3 lint check
- **Issue:** Biome formatter had differing multi-line expression preferences in one section of the test file.
- **Fix:** Applied `npx biome check --write` to fix the safe formatting issue. The `useLiteralKeys` infos for `process.env['LOCI_MACHINE_CONFIG']` were intentionally left as bracket notation per plan acceptance criteria.
- **Files modified:** `src/config/__tests__/loader.test.ts`

## Known Stubs

None. All stubs from Phase 1 that were the responsibility of this plan have been resolved. The `configLoader.load()` now returns real merged config data.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced beyond those documented in the plan's threat model. The `isSecretTrackedByGit` function uses `git ls-files` with `stdio: 'pipe'` to prevent stdout/stderr leakage, and the warning message references the file path but never reads or logs any key/value content (T-02-02 mitigated).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/config/index.ts | FOUND |
| src/config/__tests__/loader.test.ts | FOUND |
| 02-01-SUMMARY.md | FOUND |
| Commit b62e36d (feat: implement loader) | FOUND |
| Commit ce29ce7 (test: add unit tests) | FOUND |
