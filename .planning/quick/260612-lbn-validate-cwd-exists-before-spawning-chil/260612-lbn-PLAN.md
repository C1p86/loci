---
phase: quick-260612-lbn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/errors.ts
  - packages/xci/src/executor/cwd.ts
  - packages/xci/src/executor/single.ts
  - packages/xci/src/executor/sequential.ts
  - packages/xci/src/executor/parallel.ts
  - packages/xci/src/executor/__tests__/cwd-exists.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "Running an alias whose resolved cwd does not exist fails with a clear CwdMissingError naming the missing directory (not a misleading EXE_SPAWN ENOENT)"
    - "Commands with an undefined/empty cwd still run normally (inherit process.cwd())"
    - "Commands with a valid existing cwd still run normally"
    - "The genuine 'executable not found with valid cwd' case still produces SpawnError (EXE_SPAWN) — unchanged"
  artifacts:
    - path: "packages/xci/src/errors.ts"
      provides: "CwdMissingError subclass under ExecutorError, code EXE_CWD_MISSING"
      contains: "class CwdMissingError"
    - path: "packages/xci/src/executor/cwd.ts"
      provides: "assertCwdExists(cwd) shared guard helper"
      contains: "export function assertCwdExists"
    - path: "packages/xci/src/executor/__tests__/cwd-exists.test.ts"
      provides: "Tests: missing cwd throws CwdMissingError, undefined cwd ok, valid cwd ok"
      contains: "CwdMissingError"
  key_links:
    - from: "packages/xci/src/executor/single.ts"
      to: "assertCwdExists"
      via: "call before execa in runSingle and runSingleCapture"
      pattern: "assertCwdExists"
    - from: "packages/xci/src/executor/sequential.ts"
      to: "assertCwdExists"
      via: "call before execa in runAndCapture"
      pattern: "assertCwdExists"
    - from: "packages/xci/src/executor/parallel.ts"
      to: "assertCwdExists"
      via: "call before execa per group entry"
      pattern: "assertCwdExists"
---

<objective>
Validate that a child process's working directory (cwd) exists BEFORE spawning, so the user
gets a clear, dedicated error naming the missing directory instead of the misleading
`error [EXE_SPAWN]: Failed to spawn command: <exe> ... spawn <exe> ENOENT`.

Root cause (empirically confirmed on Windows 11): when `execa(cmd, args, { cwd })` receives a
`cwd` that does not exist, Node/libuv reports ENOENT and attributes it to the executable, not the
directory. A real user hit this when an alias's resolved `cwd` (e.g. `F:/SolAndroidDev`) existed
on one machine but not another.

Purpose: turn a confusing, misattributed failure into an actionable one that names the missing
directory and hints the cwd likely comes from an alias `cwd:` and should be set per-machine.

Output: a new `CwdMissingError` (code `EXE_CWD_MISSING`), a shared `assertCwdExists(cwd)` guard
called at all four spawn sites, and vitest coverage.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

# Error hierarchy — CwdMissingError must follow this exact subclass style (ExecutorError base,
# code/suggestion via XciErrorOptions, public field for the path like MachineConfigInvalidError).
@packages/xci/src/errors.ts

# cwd resolution lives here — the shared guard belongs here and is already re-exported via index.ts.
@packages/xci/src/executor/cwd.ts

# Four spawn sites that pass cwd to execa:
@packages/xci/src/executor/single.ts
@packages/xci/src/executor/sequential.ts
@packages/xci/src/executor/parallel.ts

# Test style to match (vitest, tmpdir via mkdtempSync, process.execPath child probes):
@packages/xci/src/executor/__tests__/cwd.test.ts
@packages/xci/src/executor/__tests__/single.test.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from codebase — use directly, no exploration. -->

From src/errors.ts — base class to extend and the options shape:
```typescript
export abstract class ExecutorError extends XciError {
  public readonly category = 'executor' as const;
}
export interface XciErrorOptions {
  code: string;          // e.g. "EXE_CWD_MISSING" — must be unique
  suggestion?: string;
  cause?: unknown;
}
// Style reference — error that carries a path field + names it in the message:
export class MachineConfigInvalidError extends ConfigError {
  public readonly path: string;
  constructor(path: string) {
    super(`XCI_MACHINE_CONFIGS="${path}" is not a directory`, {
      code: 'CONFIG_MACHINE_INVALID',
      suggestion: '...',
    });
    this.path = path;
  }
}
// Existing spawn error — DO NOT change its behavior for the genuine exe-not-found case:
export class SpawnError extends ExecutorError {
  constructor(commandPath: string, cause: unknown) { /* code: 'EXE_SPAWN' */ }
}
```

From src/executor/cwd.ts — the file already imports node:path; it does NOT yet import node:fs.
The guard helper will be added here and is naturally part of cwd concerns.

Spawn-site cwd parameters (all typed `cwd: string`, but at runtime may be derived from an
optional plan/step cwd, so guard only when it is a non-empty string):
- single.ts:   `runSingle(argv, cwd, env, ...)`  and  `runSingleCapture(argv, cwd, env, ...)`  → `execa(cmd, args, { cwd, ... })`
- sequential.ts: `runAndCapture(argv, cwd, env, ...)`  → `execa(cmd, args, { cwd, ... })`  (the non-capture path calls runSingle, already guarded)
- parallel.ts: per entry `const effectiveCwd = entryCwd ?? cwd;` then `execa(cmd, args, { cwd: effectiveCwd, ... })`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add CwdMissingError + assertCwdExists guard</name>
  <files>packages/xci/src/errors.ts, packages/xci/src/executor/cwd.ts</files>
  <behavior>
    - assertCwdExists(undefined) → returns (no throw): undefined cwd means inherit process.cwd().
    - assertCwdExists('') → returns (no throw): empty string is treated as "not set".
    - assertCwdExists(existingDir) → returns (no throw) when the path exists and is a directory.
    - assertCwdExists(missingPath) → throws CwdMissingError whose message contains the missing path.
    - assertCwdExists(pathToAFile) → throws CwdMissingError (exists but not a directory).
    - new CwdMissingError(dir).code === 'EXE_CWD_MISSING' and .category === 'executor'.
    - The CwdMissingError message names the directory; .path field holds it.
  </behavior>
  <action>
    In packages/xci/src/errors.ts, add a new concrete subclass in the ExecutorError section
    (place it directly after SpawnError, keep the existing file-header/comment style):

    ```typescript
    export class CwdMissingError extends ExecutorError {
      public readonly path: string;
      constructor(cwd: string) {
        super(`Working directory does not exist: ${cwd}`, {
          code: 'EXE_CWD_MISSING',
          suggestion:
            'This directory likely comes from an alias `cwd:`. It exists on some machines but not this one — set it per-machine (e.g. in your machine/local config) or create the directory.',
        });
        this.path = cwd;
      }
    }
    ```
    Do NOT touch SpawnError — the genuine "exe not found with a valid cwd" case must still throw EXE_SPAWN unchanged.

    In packages/xci/src/executor/cwd.ts:
    - Add `import { existsSync, statSync } from 'node:fs';` alongside the existing node:path import (keep import ordering/style consistent with the file).
    - Import the new error: `import { CwdMissingError } from '../errors.js';` (note `.js` ESM extension, matching the codebase).
    - Export a small shared guard. It must be a no-op when cwd is undefined or empty, and use cross-platform node:fs only (no platform branches):

    ```typescript
    /**
     * Throw CwdMissingError if a defined, non-empty cwd does not exist (or is not a directory).
     * No-op when cwd is undefined/empty — an absent cwd inherits process.cwd(), always valid.
     * Cross-platform (node:fs); cheap enough to keep within the cold-start budget.
     */
    export function assertCwdExists(cwd: string | undefined): void {
      if (cwd === undefined || cwd === '') return;
      let isDir = false;
      try {
        isDir = statSync(cwd).isDirectory();
      } catch {
        isDir = false; // ENOENT or unreadable → treat as missing
      }
      if (!isDir) throw new CwdMissingError(cwd);
    }
    ```
    (existsSync is imported for parity/readability but statSync+try/catch is the single check; if Biome flags the unused import, drop existsSync and keep only statSync. Prefer no unused imports.)

    assertCwdExists is re-exported automatically? No — index.ts currently re-exports only
    resolveAbsoluteCwds from cwd.ts. The spawn sites import directly from './cwd.js', so no
    index.ts change is required. Do not add it to index.ts exports unless a spawn site needs it
    via index (it does not).
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run src/executor/__tests__/cwd.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>CwdMissingError exists with code EXE_CWD_MISSING and category 'executor'; assertCwdExists exported from cwd.ts; existing cwd.test.ts still passes; tsc clean.</done>
</task>

<task type="auto">
  <name>Task 2: Call assertCwdExists at all four spawn sites</name>
  <files>packages/xci/src/executor/single.ts, packages/xci/src/executor/sequential.ts, packages/xci/src/executor/parallel.ts</files>
  <action>
    Wire the shared guard in immediately BEFORE each `execa(...)` call that passes a cwd. Import
    from './cwd.js' in each file (ESM `.js` extension). Guard only the defined/non-empty case —
    assertCwdExists already short-circuits undefined/'' so just call it with the effective cwd.

    1) packages/xci/src/executor/single.ts
       - Add `import { assertCwdExists } from './cwd.js';` to the imports.
       - In `runSingleCapture`, after the empty-command check and before `const proc = execa(...)`
         (line ~71), insert `assertCwdExists(cwd);`.
       - In `runSingle`, after the empty-command check and before `const proc = execa(...)`
         (line ~135), insert `assertCwdExists(cwd);`.
       - IMPORTANT: place the call OUTSIDE the try/catch that wraps `await proc` so the thrown
         CwdMissingError is NOT caught and re-wrapped into SpawnError. (Both functions create
         `proc` before the try block, so inserting the guard right before `execa` is already
         outside the catch — confirm this.)

    2) packages/xci/src/executor/sequential.ts
       - Add `import { assertCwdExists } from './cwd.js';` to the imports.
       - In `runAndCapture`, after the empty-command check and before `const proc = execa(...)`
         (line ~35), insert `assertCwdExists(cwd);`. (The non-capture branch calls runSingle,
         which Task 2 already guards — do not double-guard there.)

    3) packages/xci/src/executor/parallel.ts
       - Add `import { assertCwdExists } from './cwd.js';` to the imports.
       - Inside the `group.map(...)` callback, after computing
         `const effectiveCwd = entryCwd ?? cwd;` (line ~74) and before building `execaOpts` /
         calling `execa`, insert `assertCwdExists(effectiveCwd);`.
       - Note: this throws synchronously inside the .map callback. A throw there propagates out of
         runParallel before Promise.allSettled — that is the desired fail-fast behavior (clear
         error, no spawn). Do NOT swallow it into a per-entry exitCode. If wrapping is needed to
         keep the map from aborting mid-iteration, prefer letting it throw (the whole run aborts
         with CwdMissingError, which is the goal). Keep it simple: a bare `assertCwdExists(effectiveCwd);`.

    Do not change any other logic, output, or SpawnError paths.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run src/executor/__tests__/cwd.test.ts src/executor/__tests__/single.test.ts && npx tsc --noEmit && npx biome check src/executor/single.ts src/executor/sequential.ts src/executor/parallel.ts src/executor/cwd.ts src/errors.ts</automated>
  </verify>
  <done>All four spawn sites call assertCwdExists before execa; existing executor tests still pass; tsc clean; Biome clean on touched files.</done>
</task>

<task type="auto">
  <name>Task 3: Tests for cwd-exists guard at spawn sites</name>
  <files>packages/xci/src/executor/__tests__/cwd-exists.test.ts</files>
  <action>
    Create packages/xci/src/executor/__tests__/cwd-exists.test.ts following the style of
    cwd.test.ts (vitest, mkdtempSync(join(tmpdir(), 'xci-...')) for a real existing dir, cleanup in
    afterEach, process.execPath child probes). Use a guaranteed-missing path:
    `const missing = join(tmpdir(), 'xci-does-not-exist-' + Date.now() + '-' + Math.random().toString(36).slice(2));`

    Cover at minimum:

    1) Unit — assertCwdExists (import from '../cwd.js') and CwdMissingError (from '../../errors.js'):
       - assertCwdExists(undefined) does not throw.
       - assertCwdExists('') does not throw.
       - assertCwdExists(existingTmpDir) does not throw.
       - assertCwdExists(missing) throws CwdMissingError; assert err.code === 'EXE_CWD_MISSING'
         and the message contains the missing path. Use:
         `expect(() => assertCwdExists(missing)).toThrow(CwdMissingError);`

    2) runSingle integration (import from '../single.js'):
       - Missing cwd → throws CwdMissingError, NOT SpawnError. Use a valid command so we prove the
         failure is attributed to the cwd, not the exe:
         ```
         await expect(
           runSingle([process.execPath, '-e', 'process.exit(0)'], missing, {}, undefined, false),
         ).rejects.toThrow(CwdMissingError);
         ```
       - Also assert it does NOT throw SpawnError for this case (it must be the dedicated error):
         catch the error and `expect(err).toBeInstanceOf(CwdMissingError)`.
       - Valid cwd still works: runSingle into existingTmpDir with `process.exit(0)` → exitCode 0.

    3) Regression guard — genuine exe-not-found with a VALID cwd still throws SpawnError:
       ```
       await expect(
         runSingle(['__xci_nonexistent_command_xyz__'], existingTmpDir, {}, undefined, false),
       ).rejects.toThrow(SpawnError);
       ```
       (Import SpawnError from '../../errors.js'.)

    4) Optional but preferred — executor.run sequential capture path: a sequential plan with a
       capture step whose cwd is `missing` rejects with CwdMissingError. If wiring the full plan is
       fiddly, the runSingle + assertCwdExists coverage above is sufficient; do not over-invest.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run src/executor/__tests__/cwd-exists.test.ts</automated>
  </verify>
  <done>New test file passes: missing cwd → CwdMissingError (not SpawnError); undefined/empty cwd ok; valid cwd ok; exe-not-found with valid cwd still SpawnError.</done>
</task>

</tasks>

<verification>
- `cd packages/xci && npx vitest run` — full suite green (no regressions in cwd.test.ts, single.test.ts).
- `cd packages/xci && npx tsc --noEmit` — zero type errors.
- `cd packages/xci && npx biome check src/errors.ts src/executor/cwd.ts src/executor/single.ts src/executor/sequential.ts src/executor/parallel.ts src/executor/__tests__/cwd-exists.test.ts` — clean on touched files.
- Manual sanity (optional): point an alias `cwd:` at a non-existent dir and run it; observe
  `error [EXE_CWD_MISSING]: Working directory does not exist: <dir>` instead of EXE_SPAWN ENOENT.
</verification>

<success_criteria>
- A missing/non-directory cwd at any spawn site (single, single-capture, sequential-capture,
  parallel) throws CwdMissingError (code EXE_CWD_MISSING) naming the directory — never the
  misleading EXE_SPAWN ENOENT.
- Undefined/empty cwd is unaffected (inherits process.cwd()).
- A valid existing cwd is unaffected.
- The genuine "exe not found with a valid cwd" path still throws SpawnError (EXE_SPAWN) — behavior
  unchanged.
- Cross-platform: implementation uses only node:fs (statSync) — no platform branches.
- No new dependencies; cold-start budget preserved (statSync is cheap, runs only when cwd is set).
</success_criteria>

<output>
After completion, create `.planning/quick/260612-lbn-validate-cwd-exists-before-spawning-chil/260612-lbn-SUMMARY.md`
</output>
