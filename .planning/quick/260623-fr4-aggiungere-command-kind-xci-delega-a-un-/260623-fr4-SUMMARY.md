---
phase: quick
plan: 260623-fr4
subsystem: xci
tags: [command-kind, delegation, nesting, stdio-inherit, tdd]
dependency_graph:
  requires: []
  provides: [xci-command-kind]
  affects: [executor, resolver, normalize, cli, tui, types]
tech_stack:
  added: []
  patterns: [stdio-inherit-delegation, nesting-depth-attenuation, discriminated-union-expansion]
key_files:
  created:
    - packages/xci/src/executor/nesting.ts
    - packages/xci/src/executor/xci-delegate.ts
    - packages/xci/src/executor/__tests__/nesting.test.ts
    - packages/xci/src/executor/__tests__/xci-delegate.test.ts
    - .changeset/xci-command-kind.md
  modified:
    - packages/xci/src/types.ts
    - packages/xci/src/commands/normalize.ts
    - packages/xci/src/resolver/index.ts
    - packages/xci/src/resolver/params.ts
    - packages/xci/src/executor/index.ts
    - packages/xci/src/executor/single.ts
    - packages/xci/src/executor/output.ts
    - packages/xci/src/executor/sequential.ts
    - packages/xci/src/executor/cwd.ts
    - packages/xci/src/cli.ts
    - packages/xci/src/tui/dashboard.ts
    - packages/xci/src/__tests__/cli.e2e.test.ts
    - packages/xci/builtin-commands/commands.yml
    - packages/xci/README.md
decisions:
  - Use stdio:inherit (not pipes) to avoid stream-EOF hang and OSC/banner collision
  - XCI_NESTING_DEPTH env var as single attenuation chokepoint; soft cap at 32
  - buildDelegateInvocation is PURE (no side effects) — testable without spawning
  - Injectable spawnFn parameter in runXciDelegate for unit test isolation
  - XciInlineStepDef added to support kind:xci as inline sequential step objects
  - process.execPath + process.argv[1] for cross-platform Windows spawn
metrics:
  duration: ~120 minutes
  completed: 2026-06-23
  tasks_completed: 3
  files_changed: 14
---

# Phase quick Plan 260623-fr4: xci command kind — delegate to another project Summary

New `kind: xci` command kind for the xci CLI that delegates execution to another xci instance in a different project directory using `stdio: 'inherit'`, fixing two bugs caused by wrapping xci in a `cmd:` step.

## What Was Built

### Task 1: TDD — nesting chokepoint + delegate spawn + types/normalize/resolver/params

RED phase: failing tests written first for `nesting.ts` and `xci-delegate.ts`, confirmed failing. GREEN phase: implementation written, 21/21 tests passing.

- `executor/nesting.ts`: `getNestingDepth()` / `isNested()` reading `XCI_NESTING_DEPTH` env var
- `executor/xci-delegate.ts`: `buildDelegateInvocation` (PURE) + `runXciDelegate` (spawn with stdio:inherit, depth>=32 soft cap, SIGINT kill propagation)
- `types.ts`: `xci` union member added to `CommandDef`, `SequentialStep`, `ExecutionPlan`, plus new `XciInlineStepDef` interface for inline sequential step objects
- `commands/normalize.ts`: `kind: xci` branch as first check in `normalizeObject`; inline `kind: xci` step objects supported in sequential `steps` arrays
- `resolver/index.ts`: `case 'xci'` in both `resolveToStepsLenient` and `resolveAlias`
- `resolver/params.ts`: `case 'xci'` in `collectAll`

### Task 2: Wire xci into all dispatch/output/cli/tui sites

Every code site that handles `uproject` was given an adjacent `xci` equivalent:

- `executor/index.ts`: `case 'xci'` with delegation preview + `runXciDelegate` dispatch
- `executor/single.ts`: `isNested()` guard disables real-time tail cursor-move redraw when nested
- `executor/output.ts`: attenuation guards for `setTerminalTitle`, `resetTerminalTitle`, `notifyCompletion`, `notifyWaitingForInput`; `xci` rendering in all 5 output functions
- `executor/sequential.ts`: `leafLabel` ternary + inline xci step interpolation/delegation block
- `executor/cwd.ts`: `resolveStepCwd` and `resolveAbsoluteCwds` rewrite both `cwd` and `project` to absolute for xci steps
- `cli.ts`: `buildAliasHelpText`, `printAliasDetails`, `appendExtraArgs` all handle `xci` kind
- `tui/dashboard.ts`: `buildEntries` sequential label + plan-level `case 'xci'`; `execSequential` inline xci delegate block with dynamic import
- `builtin-commands/commands.yml`: `xci-delegate-example` alias added

### Task 3: e2e tests, README docs, changeset + bug fixes

- `src/__tests__/cli.e2e.test.ts`: 8 e2e tests covering --dry-run, --list, --help, exit-code propagation (0 and non-zero), XCI_NESTING_DEPTH=1 propagation, and xci as inline sequential step
- `README.md`: "Delegating to Another Project" section with field table, bug motivation, attenuation docs, exit code propagation, placeholder interpolation, sequential usage, dry-run/listing, and runaway nesting guard
- `.changeset/xci-command-kind.md`: minor changeset

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed runXciDelegate argv construction — entryScript was dropped**
- **Found during:** Task 3 (e2e test debugging)
- **Issue:** `runXciDelegate` constructed argv as `[entryScript, alias, ...args]` in `buildDelegateInvocation`, then in the production spawn path dropped `argv[0]` (entryScript), passing only `[alias, ...args]` to Node.js. Node tried to load the alias name as a module path, producing `MODULE_NOT_FOUND` errors.
- **Fix:** Remove the `const [, ...restArgv] = invocation.argv` destructure; pass `invocation.argv` directly to execa so Node receives `[cli.mjs, alias, ...args]`.
- **Files modified:** `packages/xci/src/executor/xci-delegate.ts`
- **Commit:** 3cd5c18

**2. [Rule 2 - Missing critical functionality] Added XciInlineStepDef for inline sequential xci steps**
- **Found during:** Task 3 (e2e test for sequential step)
- **Issue:** `SequentialCommandDef.steps` typed as `readonly (CommandRef | PromptStepDef)[]` — inline object steps with `kind: xci` were rejected by normalize with "inline step objects must have kind: `prompt`".
- **Fix:** Added `XciInlineStepDef` interface; updated `steps` type to include it; updated normalize to parse inline xci step objects; updated both resolver paths (lenient + strict) to emit `kind: 'xci'` SequentialStep entries for inline xci steps.
- **Files modified:** `packages/xci/src/types.ts`, `packages/xci/src/commands/normalize.ts`, `packages/xci/src/resolver/index.ts`
- **Commit:** 3cd5c18

**3. [Rule 1 - Bug] Fixed exactOptionalPropertyTypes call sites — project: string | undefined**
- **Found during:** Task 2 (tsc --noEmit)
- **Issue:** Three call sites passed `{ project: plan.project, ... }` where `plan.project` is `string | undefined`. With `exactOptionalPropertyTypes: true`, setting an optional property to `undefined` is a type error.
- **Fix:** Use conditional spread `...(plan.project !== undefined ? { project: plan.project } : {})` at all three call sites (executor/index.ts, executor/sequential.ts, tui/dashboard.ts).
- **Files modified:** `packages/xci/src/executor/index.ts`, `packages/xci/src/executor/sequential.ts`, `packages/xci/src/tui/dashboard.ts`
- **Commit:** b13e2fd

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 (TDD) | 5e20c74 | feat(xci): add xci command kind — nesting chokepoint, delegate spawn, types/normalize/resolver/params wiring |
| Task 2 (Wire) | b13e2fd | feat(xci): wire xci kind into executor dispatch, sequential, cwd, output, cli, tui + builtin example |
| Task 3 (E2E+docs) | 3cd5c18 | feat(xci): e2e tests, README docs, changeset + fix argv bug and inline sequential xci steps |

## Known Stubs

None. All delegation paths are fully wired. The `xci-delegate-example` in `builtin-commands/commands.yml` uses `${XCI.other_project}` which is an intentional placeholder that users replace with their actual project path — not a code stub.

## Threat Flags

None. The `xci` command kind spawns a subprocess that runs in a user-specified directory. The existing security model (no secret logging, secrets.yml warning if git-tracked) applies to both parent and child invocations. The `XCI_NESTING_DEPTH` cap at 32 prevents fork bomb patterns. No new network endpoints or trust boundaries introduced.

## Self-Check: PASSED

- `packages/xci/src/executor/nesting.ts` — FOUND
- `packages/xci/src/executor/xci-delegate.ts` — FOUND
- `packages/xci/src/executor/__tests__/nesting.test.ts` — FOUND
- `packages/xci/src/executor/__tests__/xci-delegate.test.ts` — FOUND
- `.changeset/xci-command-kind.md` — FOUND
- commit 5e20c74 — FOUND
- commit b13e2fd — FOUND
- commit 3cd5c18 — FOUND
