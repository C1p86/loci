---
phase: quick-260618-h1d
plan: 01
subsystem: executor
tags: [uproject, unreal-engine, file-manipulation, command-kind, tdd]
dependency_graph:
  requires: [ini kind (structural reference)]
  provides: [uproject command kind, applyUprojectEdits, readUproject, writeUproject]
  affects: [types, normalize, resolver, resolver/params, executor/index, executor/sequential, executor/cwd, executor/output, cli, tui/dashboard]
tech_stack:
  added: []
  patterns:
    - "pure applyUprojectEdits function (deep-clone via JSON.parse/stringify, no mutation)"
    - "exactOptionalPropertyTypes-safe ops object construction (conditional assignment)"
    - "dynamic import for uproject module in TUI execSequential (lazy load)"
key_files:
  created:
    - packages/xci/src/executor/uproject.ts
    - packages/xci/src/executor/__tests__/uproject.test.ts
  modified:
    - packages/xci/src/types.ts
    - packages/xci/src/commands/normalize.ts
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/resolver/params.ts
    - packages/xci/src/executor/index.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/executor/cwd.ts
    - packages/xci/src/executor/output.ts
    - packages/xci/src/cli.ts
    - packages/xci/src/tui/dashboard.ts
    - packages/xci/src/__tests__/cli.e2e.test.ts
    - packages/xci/src/__tests__/types.test.ts
    - packages/xci/src/resolver/__tests__/resolver.test.ts
    - packages/xci/builtin-commands/commands.yml
decisions:
  - "applyUprojectEdits is a pure function — file I/O split into readUproject/writeUproject wrappers; all three exported for executor reuse"
  - "enable/disable/remove plugin semantics: absent-disable and already-enabled are warnings (not errors) — idempotency is correct behavior"
  - "Plugin names are literals (not interpolated); only file path and set values go through ${var} interpolation"
  - "exactOptionalPropertyTypes fix: build UprojectOps object with conditional assignment instead of object literal with possibly-undefined fields"
  - "TUI execSequential uses dynamic import('../executor/uproject.js') to preserve lazy-load pattern matching ini"
  - "Output format: JSON.stringify(json, null, 2) + '\\n' — 2-space indent, trailing newline, no extra blank line"
metrics:
  duration: ~90 min
  completed: "2026-06-18"
  tasks: 2
  files: 14
---

# Quick Task 260618-h1d: Add `uproject` Command Kind to xci DSL

**One-liner:** New `uproject` file-manipulation command kind adds Unreal Engine `.uproject` JSON editing (enable/disable/remove plugins, set top-level fields) end-to-end from pure core function through all executor paths, CLI help, TUI, and 8 e2e tests.

## What Was Done

### Task 1 — Pure core + types/normalize/resolver/params (TDD)

Created `packages/xci/src/executor/uproject.ts` with:
- `applyUprojectEdits(json, ops)` — pure function, deep-clones via `JSON.parse(JSON.stringify(json))`, returns `{ json, warnings }`
- `readUproject(filePath)` — reads and parses JSON file
- `writeUproject(filePath, json)` — serializes with `JSON.stringify(json, null, 2) + '\n'`

Plugin semantics:
- **enable**: set `Enabled: true`; warn if already enabled; create `Plugins` array if absent
- **disable**: set `Enabled: false`; warn if plugin not found
- **remove**: splice plugin from array; warn if not found
- **set**: assign top-level key; preserve key order

17 unit tests written first (RED), then implementation (GREEN). All pass.

Types wired into `CommandDef`, `SequentialStep`, and `ExecutionPlan` unions. `normalize.ts` validates the uproject object (file string required, at-least-one-op rule). `resolver/index.ts` resolves file path + set values (strict and lenient). `resolver/params.ts` tracks file + set placeholders.

Commit: `d786c6b`

### Task 2 — Executor dispatch + sequential + cwd + output + cli + tui + e2e tests

Wired `uproject` into all execution paths:

- **executor/index.ts**: `case 'uproject'` — readUproject → applyUprojectEdits → writeUproject, stderr warnings via `formatWarning`
- **executor/sequential.ts**: inline `if (step.kind === 'uproject')` block with captured-var re-interpolation for set values
- **executor/cwd.ts**: `case 'uproject'` in `resolveAbsoluteCwds` plan-level switch
- **executor/output.ts**: 6 additions — `printRunHeader`, `printDryRun`, `printVerboseCommand` (both plan-level and sequential), `topLevelCwd`, `collectReferencedPlaceholders`
- **cli.ts**: `buildAliasHelpText`, `printAliasDetails`, `appendExtraArgs` all handle uproject
- **tui/dashboard.ts**: `buildEntries` label/switch, `execSequential` inline handler with dynamic import

Example alias added to `builtin-commands/commands.yml` (`ue-enable-plugins`).

8 e2e tests added to `cli.e2e.test.ts`:
1. Enable/disable/set field → exit 0, file updated correctly
2. Absent-disable → stderr warning, exit 0
3. Already-enabled → idempotency warning on stderr, exit 0
4. `--dry-run` → file NOT modified
5. 2-space indent + trailing newline preserved
6. `--list` shows uproject type and file
7. `--help` shows `Command type: uproject` + file
8. No-ops uproject → schema error, non-zero exit

TypeScript fixes applied (deviation Rule 2):
- `exactOptionalPropertyTypes`-safe ops construction in index.ts, sequential.ts, dashboard.ts
- Added `'uproject'` to kind unions in types.test.ts
- Added `|| s.kind === 'uproject'` to rawArgv type guards in resolver.test.ts

Biome format pass: `npx @biomejs/biome format --write src` — 76 files formatted.

Commit: `08bbeac`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] TypeScript exactOptionalPropertyTypes errors**
- **Found during:** Task 2 (tsc --noEmit)
- **Issue:** Passing `{ plugins: plan.plugins, set: plan.set }` where `plugins` could be `undefined` — violates `exactOptionalPropertyTypes: true` in tsconfig
- **Fix:** Build `UprojectOps` object with conditional assignment (`if (x !== undefined) ops.x = x`) in executor/index.ts, executor/sequential.ts, and tui/dashboard.ts
- **Files modified:** executor/index.ts, executor/sequential.ts, tui/dashboard.ts
- **Commit:** 08bbeac

**2. [Rule 2 - Missing critical] TypeScript union types incomplete**
- **Found during:** Task 2 (tsc --noEmit)
- **Issue:** types.test.ts had `'single' | 'sequential' | 'parallel' | 'for_each' | 'ini'` and resolver.test.ts type guards missing `'uproject'` — both caused TS2344 and TS2339 errors
- **Fix:** Added `'uproject'` to type unions in types.test.ts; added `|| s.kind === 'uproject'` to rawArgv guards in resolver.test.ts
- **Files modified:** src/__tests__/types.test.ts, src/resolver/__tests__/resolver.test.ts
- **Commit:** 08bbeac

## Known Stubs

None — all plugin operations and set fields are fully wired end-to-end.

## Verification

- `npm run build` — passed (tsup ESM + DTS)
- `npx tsc --noEmit` — 0 errors
- `npx vitest --run src/executor/__tests__/uproject.test.ts` — 17/17 passed
- `npx vitest --run src/__tests__/cli.e2e.test.ts` — 8/8 uproject e2e tests passed (4 pre-existing unrelated failures unchanged)

## Self-Check: PASSED

- `d786c6b` exists: confirmed (`git log --oneline | grep d786c6b`)
- `08bbeac` exists: confirmed (current HEAD)
- `packages/xci/src/executor/uproject.ts` created: confirmed
- `packages/xci/src/executor/__tests__/uproject.test.ts` created: confirmed
- All 8 e2e tests pass: confirmed via vitest output
