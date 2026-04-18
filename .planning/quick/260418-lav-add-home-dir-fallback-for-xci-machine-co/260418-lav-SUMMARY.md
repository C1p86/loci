---
phase: quick-260418-lav
plan: 01
subsystem: config
tags: [config, machine-config, errors, ergonomics]
dependency_graph:
  requires: []
  provides:
    - "resolveMachineConfigDir() helper for machine-config layer resolution"
    - "MachineConfigInvalidError for typo'd / non-dir XCI_MACHINE_CONFIGS paths"
    - "~/.xci/ home-directory fallback as zero-config default"
  affects:
    - "src/config/index.ts (configLoader.load machine-dir branch)"
    - "src/commands/index.ts (commandsLoader.load machine-dir branch)"
    - "src/cli.ts (verbose trace)"
tech-stack:
  added: []
  patterns:
    - "DI-for-testability (env + isDirectoryFn args on resolveMachineConfigDir)"
    - "hoisted vi.mock('node:os') for libuv-cached homedir in worker threads"
key-files:
  created: []
  modified:
    - "src/errors.ts (+12 lines — MachineConfigInvalidError class)"
    - "src/config/index.ts (+37 insertions / -24 deletions — new helper + migrated configLoader.load)"
    - "src/commands/index.ts (+5 insertions / -8 deletions — migrated commandsLoader.load)"
    - "src/cli.ts (+24 insertions / -14 deletions — migrated verbose trace)"
    - "src/config/__tests__/loader.test.ts (+159 insertions / -3 deletions — 10 new test cases)"
decisions:
  - "Added a third optional homedirFn parameter to resolveMachineConfigDir during test iteration, then reverted: the plan's 2-arg signature is kept intact and vi.mock('node:os') + vi.hoisted handles the vitest worker-thread homedir caching issue without widening the production API."
  - "MachineConfigInvalidError message format locked to XCI_MACHINE_CONFIGS=\"<path>\" is not a directory per the plan's behavior spec; suggestion explicitly points the user at the new ~/.xci/ fallback."
  - "Home-fallback label in the zero-files NOTE uses '~/.xci/ (home fallback)' (not the resolved absolute path) so log output is stable across different user accounts."
metrics:
  duration: "~25m"
  completed: "2026-04-18"
  tasks: 3
  commits: 3
  files_modified: 5
  tests_added: 10
  tests_passing: "302 / 302"
---

# Quick Task 260418-lav: Home-dir fallback for XCI_MACHINE_CONFIGS + hard-error Summary

**One-liner:** Added `~/.xci/` home-directory fallback for the machine config layer plus `MachineConfigInvalidError` hard-error on typo'd env paths; centralised resolution through a single `resolveMachineConfigDir()` helper so the 3 previous call-sites stop reading `process.env` directly.

## What changed

### New surface (Task 1, commit `69941e1`)

1. **`src/errors.ts` — `MachineConfigInvalidError`**
   - Extends `ConfigError`, code `CONFIG_MACHINE_INVALID`
   - Carries `.path: string` field for test introspection
   - Message: `XCI_MACHINE_CONFIGS="<path>" is not a directory`
   - Suggestion: `Point XCI_MACHINE_CONFIGS at a real directory or unset it to use the home fallback (~/.xci/)`
   - `exitCodeFor(err)` returns `ExitCode.CONFIG_ERROR` (10) via the inherited `category='config'` arm of the existing switch — no edit to `exitCodeFor` itself.

2. **`src/config/index.ts` — `resolveMachineConfigDir()` helper**
   - Exported type: `MachineDirResolution = { dir: string; source: 'env' | 'home' } | { dir: null; source: 'none' }`
   - Signature: `(env?: NodeJS.ProcessEnv, isDirectoryFn?: (p: string) => boolean) => MachineDirResolution`
   - Resolution order: env (throw on invalid) → `~/.xci/` (fallback) → `null` (no machine layer)
   - DI params are test-only; production code always calls `resolveMachineConfigDir()` with no args.

### Call-site migrations (Task 2, commit `a1a4774`)

3. **`src/config/index.ts` (`configLoader.load`)** — Replaced the `process.env['XCI_MACHINE_CONFIGS']` read + soft stderr warning with `resolveMachineConfigDir()`. The zero-files NOTE now distinguishes `~/.xci/ (home fallback)` vs `XCI_MACHINE_CONFIGS="..."` based on `resolution.source`. The prior `[xci] WARNING: XCI_MACHINE_CONFIGS="..." is not a directory` stderr line is **deleted** — the helper throws instead, and the throw propagates to `cli.ts`'s top-level catch → `exitCodeFor` → exit 10.

4. **`src/commands/index.ts` (`commandsLoader.load`)** — Replaced `process.env` read + redundant `statSync` isDirectory check with `resolveMachineConfigDir()`. Dropped the `!` non-null assertions (TypeScript narrows `machineDir` to `string` inside `if (machineDir)`).

5. **`src/cli.ts` (verbose trace, lines ~444-480)** — Replaced `process.env['XCI_MACHINE_CONFIGS']` + `statSync` check with a defensive `try { resolveMachineConfigDir() } catch {}` block (the try is belt-and-braces — by this point `configLoader.load` has already succeeded, so the helper cannot throw in practice). Added a new stderr line when verbose mode has a machine dir in effect:
   ```
   [xci] NOTE: machine config source: [from env|from home fallback] <path>
   ```

### Tests (Task 3, commit `70ab4c1`)

6. **`src/config/__tests__/loader.test.ts`** — New top-level `describe('machine config resolution')` block with 10 test cases:
   - **5 integration tests** (through `configLoader.load`): home-fallback used, silent skip when home missing, hard error for file path, hard error for nonexistent path, env-over-home precedence
   - **5 unit tests** (`resolveMachineConfigDir` with injected `env` + `isDirectoryFn`): env branch, throw branch, empty-string fall-through, home branch, none branch

   All 5 `must_haves.truths` from the plan frontmatter are directly asserted.

## Why

- **Zero-config ergonomics:** Users on their own machines no longer need to export `XCI_MACHINE_CONFIGS` — a plain `mkdir ~/.xci` is enough. Bisect burden for new contributors drops by one env-var export.
- **Loud failure for typos:** `XCI_MACHINE_CONFIGS=/etc/hostnmae` (typo'd file) used to silently emit a stderr warning and fall through to loading project-layer only — behaviour that made "my secrets aren't being read" debugging painful. It now exits non-zero with a clear error code + suggestion.
- **Single source of truth:** The 3 call-sites previously duplicated the read + stat + isDirectory logic. Future additions of source precedence (e.g. a `$XDG_CONFIG_HOME/xci/` layer) now have one point of extension.

## Scoped exclusion (intentional, per plan)

`src/template/index.ts` ALSO reads `process.env['XCI_MACHINE_CONFIGS']`. It is NOT migrated in this plan because its semantics are *"snapshot the host-side machine files into a template archive"*, not runtime config resolution. Silently defaulting `~/.xci/` into a shared template archive would cross a secrets boundary (the user's private `~/.xci/secrets.yml` does not belong in an exported template). A future task should introduce a separate opt-in flag for template-side machine-dir inclusion; for now `src/template/` is unchanged (verified by `git diff --name-only 3573096..HEAD -- src/template/` showing empty output).

`src/cli.ts`'s `findXciRoot` / `.xci/` project-dir discovery is unrelated and untouched.

## Deviations from Plan

### Implementation decisions during execution

**1. [Rule 3 — Blocking] vitest worker-thread homedir caching**

- **Found during:** Task 3 (tests)
- **Issue:** The plan's test scaffold set `process.env['HOME'] = homeTmp` + `process.env['USERPROFILE'] = homeTmp` expecting `os.homedir()` to reflect the override. Under vitest's default `pool: 'threads'`, libuv's `uv_os_homedir` caches the real user's home dir at worker boot and does NOT re-read HOME/USERPROFILE. `os.homedir()` inside tests returned `/home/developer` regardless of the env mutation — the home-fallback integration test failed with `expected undefined to be 'fallback-value'`.
- **Fix:** Replaced the env-var swap with a `vi.mock('node:os')` + `vi.hoisted()` pattern that routes `homedir()` through a mutable `osMocks.homedirImpl` reference. Default impl delegates to the REAL `homedir` so the 45 pre-existing tests in the file are unaffected. Per-test `beforeEach` sets `osMocks.homedirImpl = () => homeTmp`; `afterEach` restores.
- **Commit:** `70ab4c1`
- **Fix-attempt count:** 2 (first tried `vi.spyOn(os, 'homedir')` — failed with `Cannot redefine property: homedir` because node:os properties are non-configurable; second attempt added a 3rd `homedirFn` DI param to the helper — reverted to keep plan's 2-arg signature intact; third attempt with `vi.mock` + hoisted ref succeeded)

**2. [Rule 1 — Bug] `cwd` variable leaking between tests**

- **Found during:** Task 3 (tests)
- **Issue:** `let cwd: string;` at the describe level persists across `beforeEach`; the `afterEach` cleanup of a stale `cwd` from a previous test caused `ENOENT: lstat '/tmp/xci-test-XXX'` errors in the 5 unit tests (which do NOT set `cwd`).
- **Fix:** Declared as `let cwd: string | undefined` and explicitly reset to `undefined` at start of each `beforeEach`. Cleanup already had the `if (cwd)` guard.
- **Commit:** `70ab4c1`

**3. [Rule 1 — Bug] Implicit-any parameters in test callback**

- **Found during:** Task 3 (tests)
- **Issue:** `stderrSpy.mock.calls.map((c) => ...)` and `stderrCalls.some((s) => ...)` triggered TS7006 (implicit-any) under the project's strict settings.
- **Fix:** Annotated `(c: unknown[])` and `(s: string)` explicitly, declared `const stderrCalls: string[]`.
- **Commit:** `70ab4c1`

### Minor plan adjustments (executor's discretion)

- Removed the `savedHome` / `savedUserProfile` save/restore logic from the test `beforeEach` — with `vi.mock` in place these env vars no longer steer behavior, so saving/restoring them is noise.
- The plan's test scaffold comment block about Windows USERPROFILE parity was removed; the `vi.mock` approach is OS-agnostic by construction, which the in-file comment now says explicitly.

## Authentication gates

None — this task is purely local code.

## Known Stubs

None. All flows wire through to real code; the new helper has no `TODO` or placeholder branches.

## TDD Gate Compliance

Plan type is `execute` (not `tdd`). Task 1 has `tdd="true"`, Task 3 has `tdd="true"`:

- **Task 1 (tdd="true"):** The plan's own `<done>` clause says *"No existing tests broken (vitest run is deferred to Task 3, but compile is green now)."* So Task 1 was *structural TDD*: tests for the new surface live in Task 3, and Task 1 was verified by compile + existing tests unchanged. Strict RED-GREEN-REFACTOR was not applied — but this matches the plan's explicit instruction.
- **Task 3 (tdd="true"):** This IS the test-writing task. Tests were written and verified passing against the already-committed implementation from Tasks 1 & 2 (so technically "GREEN-first" since the implementation preceded the tests by plan design). The deviation-rule fixes (homedir mocking, cwd leak, implicit-any) were real RED→GREEN iterations during test authorship.

Flagging this for the verifier: the plan explicitly deferred test writing to a dedicated task rather than enforcing test-first-per-function. No corrective action needed — this matches the plan.

## Verification evidence

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` error count | 100 (= baseline; my 5 files contribute 0 new type errors, only line-number shifts of pre-existing errors) |
| `npx vitest run` full suite | **302 passed / 302** (was 292 before Task 3; +10 new) |
| `npx vitest run src/config/__tests__/loader.test.ts` | **55 passed / 55** (45 pre-existing + 10 new) |
| `grep -rn "process\.env\[['\"]XCI_MACHINE_CONFIGS['\"]\]" src/ --include='*.ts' \| grep -v __tests__ \| grep -v template/` | **0 lines** (zero direct env reads in production code) |
| `git diff --name-only 3573096..HEAD -- src/template/` | empty (scoped exclusion honored) |
| `grep -n "WARNING: XCI_MACHINE_CONFIGS" src/config/index.ts` | **0 matches** (soft warning removed as planned) |

## Commits

| Task | Commit | Type | Summary |
|------|--------|------|---------|
| 1 | `69941e1` | `feat` | Add MachineConfigInvalidError + resolveMachineConfigDir helper |
| 2 | `a1a4774` | `refactor` | Migrate 3 call-sites to resolveMachineConfigDir() |
| 3 | `70ab4c1` | `test` | Add tests for home fallback + hard-error machine config |

## Self-Check: PASSED

- [x] `src/errors.ts` contains `MachineConfigInvalidError` at line 117 (verified via `grep`)
- [x] `src/config/index.ts` exports `resolveMachineConfigDir` at line 300 and `MachineDirResolution` type at line 285
- [x] `homedir` imported from `node:os` in `src/config/index.ts` at line 7
- [x] All 3 production call-sites use `resolveMachineConfigDir()` (`src/config/index.ts:324`, `src/commands/index.ts:152`, `src/cli.ts:452`)
- [x] Commits `69941e1`, `a1a4774`, `70ab4c1` all present in `git log --oneline`
- [x] 302/302 tests passing
- [x] Zero direct `process.env['XCI_MACHINE_CONFIGS']` reads in production files
- [x] `src/template/index.ts` NOT in the plan's diff
