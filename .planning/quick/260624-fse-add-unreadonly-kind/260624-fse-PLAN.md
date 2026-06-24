---
phase: quick-260624-fse
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/types.ts
  - packages/xci/src/commands/normalize.ts
  - packages/xci/src/resolver/index.ts
  - packages/xci/src/executor/cwd.ts
  - packages/xci/src/executor/sequential.ts
  - packages/xci/src/executor/index.ts
  - packages/xci/src/executor/unreadonly.ts
  - packages/xci/src/executor/__tests__/unreadonly.test.ts
autonomous: true
requirements: [QUICK-260624-FSE]
tags: [unreadonly, chmod, command-kind, cross-platform]

must_haves:
  truths:
    - "An alias with `unreadonly: ./file.txt` removes the readonly attribute from that file"
    - "An alias with `unreadonly: ./Binaries` + `recursive: true` clears readonly on the folder and every descendant"
    - "An alias with `unreadonly: project` clears readonly across the resolved project root"
    - "The unreadonly kind works as a standalone alias AND as a referenced step inside a sequential alias"
    - "removeReadonly is cross-platform (Windows + Linux/macOS) via fs.chmodSync"
  artifacts:
    - path: "packages/xci/src/executor/unreadonly.ts"
      provides: "removeReadonly(targetPath, recursive) using fs.chmodSync"
      contains: "export function removeReadonly"
    - path: "packages/xci/src/executor/__tests__/unreadonly.test.ts"
      provides: "Unit tests for removeReadonly (file, folder, recursive)"
      contains: "removeReadonly"
  key_links:
    - from: "packages/xci/src/commands/normalize.ts"
      to: "CommandDef kind:unreadonly"
      via: "Object.hasOwn(obj, 'unreadonly') detection block"
      pattern: "Object.hasOwn\\(obj, 'unreadonly'\\)"
    - from: "packages/xci/src/resolver/index.ts"
      to: "SequentialStep + ExecutionPlan kind:unreadonly"
      via: "case 'unreadonly' in resolveAlias and resolveToStepsLenient"
      pattern: "case 'unreadonly'"
    - from: "packages/xci/src/executor/index.ts"
      to: "removeReadonly"
      via: "case 'unreadonly' in top-level executor switch"
      pattern: "case 'unreadonly'"
    - from: "packages/xci/src/executor/sequential.ts"
      to: "removeReadonly"
      via: "step.kind === 'unreadonly' inline handler"
      pattern: "step.kind === 'unreadonly'"
---

<objective>
Add an `unreadonly` command kind to the xci DSL that removes the readonly file-system
attribute from a specific file, a folder (optionally recursive), or the entire project.

Purpose: Unreal/asset workflows frequently produce readonly files (Perforce-managed
binaries, generated artifacts). An `unreadonly` alias lets users clear those attributes
declaratively as part of a versioned command pipeline, cross-platform.

Output: A new `unreadonly` CommandDef/SequentialStep/ExecutionPlan kind wired through
all 5 pipeline stages (types → normalize → resolver → cwd → executor) plus a new
`removeReadonly` implementation module and its unit tests.

The implementation MUST mirror the existing `uproject` kind exactly — same detection,
resolution, cwd-rewrite, dual executor (top-level + inline sequential), and breadcrumb
handling — because `unreadonly` is structurally identical (a single-target file-system
edit step, not a spawned command).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# Pattern to mirror — the `uproject` kind already implements the identical shape.
# Read these to copy the exact conventions (detection, resolution, cwd-rewrite,
# dual executor, breadcrumb, displayLabel):
@packages/xci/src/types.ts
@packages/xci/src/commands/normalize.ts
@packages/xci/src/resolver/index.ts
@packages/xci/src/executor/cwd.ts
@packages/xci/src/executor/index.ts
@packages/xci/src/executor/sequential.ts
@packages/xci/src/executor/uproject.ts

<interfaces>
<!-- The three union types to extend. New members go AFTER the existing `uproject`
     member and BEFORE the `xci` member in each union, matching ordering convention. -->

CommandDef new member (types.ts):
```typescript
| {
    readonly kind: 'unreadonly';
    readonly path: string;          // file path, folder path, or the literal 'project'
    readonly recursive?: boolean;   // default: false
    readonly description?: string;
    readonly params?: Readonly<Record<string, ParamDef>>;
    readonly cwd?: string;
  }
```

SequentialStep new member (types.ts):
```typescript
| {
    readonly kind: 'unreadonly';
    readonly path: string;
    readonly recursive: boolean;    // resolved to concrete boolean at plan time
    readonly cwd?: string;
    readonly breadcrumb?: readonly string[];
  }
```

ExecutionPlan new member (types.ts):
```typescript
| {
    readonly kind: 'unreadonly';
    readonly path: string;
    readonly recursive: boolean;
    readonly cwd?: string;
  }
```

removeReadonly signature (executor/unreadonly.ts — NEW file):
```typescript
export function removeReadonly(targetPath: string, recursive: boolean): void;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add unreadonly to the three type unions and create removeReadonly implementation</name>
  <files>packages/xci/src/types.ts, packages/xci/src/executor/unreadonly.ts</files>
  <action>
In `packages/xci/src/types.ts`, add a new `unreadonly` member to each of the three
discriminated unions, inserting AFTER the existing `uproject` member and BEFORE the
`xci` member in each (preserving file ordering convention):
- `CommandDef`: kind 'unreadonly' with readonly `path: string`, optional `recursive?: boolean`,
  optional `description?`, `params?`, `cwd?` (use the exact shape from the `<interfaces>` block).
- `SequentialStep`: kind 'unreadonly' with `path: string`, `recursive: boolean` (concrete,
  not optional, since resolver defaults it), optional `cwd?`, optional `breadcrumb?`.
- `ExecutionPlan`: kind 'unreadonly' with `path: string`, `recursive: boolean`, optional `cwd?`.
Add a brief comment on the `path` field noting the special literal value `'project'`.

Create NEW file `packages/xci/src/executor/unreadonly.ts` exporting
`removeReadonly(targetPath: string, recursive: boolean): void`. Import only from
`node:fs` and `node:path` (no new runtime deps — cold-start budget). Logic:
- `statSync(targetPath)` to determine file vs directory. Let ENOENT / unreadable
  propagate as a thrown Error (caller catches and prints `error: <message>`, matching
  the uproject executor's try/catch).
- If it is a file: `chmodSync(targetPath, 0o666)` (clears readonly on Windows + POSIX).
- If it is a directory: `chmodSync(targetPath, 0o777)`. Then, when `recursive` is true,
  walk children with `readdirSync(dir, { withFileTypes: true })` and recurse into each
  entry (files → 0o666, dirs → 0o777). Use a private helper for the walk; `removeReadonly`
  remains the single exported entry point. Do NOT follow symlinks into other trees —
  apply chmod to the symlink target path as `readdirSync` yields it but do not recurse
  through Dirent entries whose `isSymbolicLink()` is true.
Header comment must explain the cross-platform chmod semantics (0o666 file / 0o777 dir
both remove the readonly bit) and that no new dependency is introduced.
  </action>
  <verify>
    <automated>cd packages/xci && npx tsc --noEmit</automated>
  </verify>
  <done>types.ts compiles with three new `unreadonly` union members; `executor/unreadonly.ts` exists exporting `removeReadonly`; `npx tsc --noEmit` passes with zero errors.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire unreadonly through normalize, resolver, and cwd stages</name>
  <files>packages/xci/src/commands/normalize.ts, packages/xci/src/resolver/index.ts, packages/xci/src/executor/cwd.ts</files>
  <behavior>
    - normalize: `{ unreadonly: './f.txt' }` → CommandDef kind 'unreadonly', path './f.txt', recursive omitted.
    - normalize: `{ unreadonly: './dir', recursive: true }` → recursive true preserved.
    - normalize: `{ unreadonly: 123 }` → throws CommandSchemaError ("unreadonly must be a string").
    - normalize: `{ unreadonly: './dir', recursive: 'yes' }` → throws CommandSchemaError ("recursive must be a boolean").
    - resolver: an `unreadonly` alias resolves to ExecutionPlan kind 'unreadonly' with interpolated path and concrete `recursive` boolean (default false).
    - resolver inside `steps:` → produces a SequentialStep kind 'unreadonly' with breadcrumb set.
    - cwd: a relative `cwd` on an unreadonly plan/step is rewritten to absolute against projectRoot; `path` is NOT rewritten here (path resolution happens in the executor against effective cwd, mirroring uproject's `file`).
  </behavior>
  <action>
In `packages/xci/src/commands/normalize.ts`, add a detection block in `normalizeObject`
immediately AFTER the `uproject` block (`if (Object.hasOwn(obj, 'uproject')) {...}`) and
before the `ini` block. Block: `if (Object.hasOwn(obj, 'unreadonly')) {`. Validate
`obj.unreadonly` is a string (else `throw new CommandSchemaError(aliasName, 'unreadonly
must be a string (file path, folder path, or "project")')`). Validate optional
`obj.recursive`: if present it must be a boolean (else CommandSchemaError "unreadonly
recursive must be a boolean"). Read description via the existing pattern, `params` via
`normalizeParams`, `cwd` via `parseCwd`. Return the CommandDef using the conditional-spread
style used by the uproject return (`...(recursive !== undefined ? { recursive } : {})`, etc.).

In `packages/xci/src/resolver/index.ts`, add a `case 'unreadonly':` to BOTH switch
statements — `resolveToStepsLenient` (returns SequentialStep[]) and `resolveAlias`
(returns ExecutionPlan). Mirror the `case 'uproject':` immediately above each. Interpolate
`def.path` (lenient in resolveToStepsLenient, strict via interpolateArgv in resolveAlias,
matching how `uproject` handles `def.file`). Set `recursive: def.recursive ?? false`.
In resolveToStepsLenient include `...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {})`
and `breadcrumb: [...chain]`. In resolveAlias include only `...(effectiveCwd !== undefined
? { cwd: effectiveCwd } : {})` (ExecutionPlan unreadonly has no breadcrumb field).

In `packages/xci/src/executor/cwd.ts`: add a `case 'unreadonly':` to the
`resolveAbsoluteCwds` switch that mirrors the `uproject` case (rewrite `plan.cwd` to
absolute via `toAbs`, return plan unchanged if undefined). In `resolveStepCwd`, the
existing generic tail (`const abs = toAbs(step.cwd, projectRoot); ... return { ...step,
cwd: abs }`) already covers the unreadonly step because it is not 'set'/'prompt'/'xci' —
confirm no change is needed there, OR if the function's narrowing requires it, add the
unreadonly step to the generic cwd-rewrite path. Do NOT rewrite `path`.

Add/extend unit tests:
- In `packages/xci/src/commands/__tests__/commands.test.ts`, add cases for the four
  normalize behaviors listed above (valid file, valid recursive folder, non-string path
  throws, non-boolean recursive throws).
- In `packages/xci/src/resolver/__tests__/resolver.test.ts`, add a case asserting an
  `unreadonly` alias resolves to ExecutionPlan kind 'unreadonly' with `recursive: false`
  default and the interpolated path.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run src/commands/__tests__/commands.test.ts src/resolver/__tests__/resolver.test.ts</automated>
  </verify>
  <done>normalize detects `unreadonly` and validates path/recursive; resolver produces both SequentialStep and ExecutionPlan unreadonly variants with default recursive=false; cwd.ts rewrites cwd to absolute; new normalize+resolver tests pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire unreadonly executor (top-level + inline sequential) and add removeReadonly tests</name>
  <files>packages/xci/src/executor/index.ts, packages/xci/src/executor/sequential.ts, packages/xci/src/executor/__tests__/unreadonly.test.ts</files>
  <behavior>
    - removeReadonly on a readonly FILE → file becomes writable (statSync mode has owner-write bit set after call).
    - removeReadonly on a readonly DIRECTORY (recursive=false) → only the directory itself is chmod'd; nested readonly file remains untouched.
    - removeReadonly on a DIRECTORY with recursive=true → directory AND nested files become writable.
    - removeReadonly on a non-existent path → throws (caller surfaces as `error:` line, exit 1).
    - top-level executor: ExecutionPlan kind 'unreadonly' runs removeReadonly against the effective cwd-resolved path and returns exitCode 0 on success, 1 on thrown error.
    - sequential executor: a referenced `unreadonly` step runs inline, prints a step header/result, and on thrown error returns exit 1 (stops the chain).
    - path === 'project' resolves to the effective cwd (project root), not a file literally named "project".
  </behavior>
  <action>
In `packages/xci/src/executor/index.ts`: import `removeReadonly` from `./unreadonly.js`.
Add a `case 'unreadonly':` to the top-level executor switch, modeled on the `case
'uproject':` block. Steps: compute `const effectiveCwd = plan.cwd ?? cwd;`. Resolve the
target path: if `plan.path === 'project'` use `effectiveCwd`; else
`isAbsolute(plan.path) ? plan.path : resolvePath(effectiveCwd, plan.path)`. Use label
`'unreadonly'`. setTerminalTitle / printStepHeader / startTime as uproject does. Inside
try: call `removeReadonly(targetPath, plan.recursive)`, write `  ${targetPath}\n` to
stderr (plus a one-line note like `  (recursive)` when plan.recursive), printStepResult
0, resetTerminalTitle, return exitCode 0. Catch: write `  error: ${(err as Error).message}\n`,
printStepResult 1, resetTerminalTitle, return exitCode 1. Do NOT log any secret value.

In `packages/xci/src/executor/sequential.ts`: import `removeReadonly` from
`./unreadonly.js`. Add `'unreadonly'` to the `leafLabel` computation (leaf label is the
literal `'unreadonly'`, mirroring the uproject branch). Add an inline handler block
`if (step.kind === 'unreadonly') { ... continue; }` placed alongside the existing
`if (step.kind === 'uproject')` block. Inside: setTerminalTitle with `(unreadonly)`
suffix, printStepHeader(displayLabel, stepNum, totalSteps), compute `stepCwd = step.cwd
?? cwd`, interpolate the path with `{ ...env, ...capturedVars }` via interpolateArgv,
then resolve to absolute exactly like the top-level case (handle the `'project'` literal
against stepCwd; otherwise isAbsolute/resolvePath against stepCwd). try → removeReadonly,
print path line, printStepResult 0; catch → print error, printStepResult 1, resetTerminalTitle,
return { exitCode: 1 }. Then `continue;`.

Create/extend `packages/xci/src/executor/__tests__/unreadonly.test.ts` with vitest unit
tests for `removeReadonly`, following the temp-dir + afterEach-cleanup pattern from
`uproject.test.ts` (mkdtempSync into tmpdir, push to a tempDirs array, rmSync in
afterEach). Cover: readonly file becomes writable; readonly dir non-recursive leaves
nested file readonly; recursive clears nested files; non-existent path throws. To make
a file readonly in setup use `chmodSync(p, 0o444)`; assert writability by checking
`(statSync(p).mode & 0o200) !== 0` after removeReadonly (owner-write bit set). Note in a
comment that on Windows the POSIX mode bits are emulated by Node; the owner-write-bit
assertion is the cross-platform-portable check.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run src/executor/__tests__/unreadonly.test.ts src/executor/__tests__/sequential.test.ts</automated>
  </verify>
  <done>Top-level and inline-sequential executors handle kind 'unreadonly'; `path: 'project'` resolves to the project root; removeReadonly unit tests (file, non-recursive dir, recursive dir, missing path) pass; full unreadonly + sequential suites green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| commands.yml → normalize | User-authored YAML defines `unreadonly` path/recursive; path is later passed to fs.chmodSync. |
| resolved path → fs.chmodSync | The (possibly interpolated) path determines which files lose the readonly bit. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-fse-01 | Tampering | removeReadonly recursive walk | accept | Operates only within the project workspace the operator already controls; xci runs with the user's own privileges. recursive walk does not follow symlinks into foreign trees (isSymbolicLink guard), preventing accidental traversal outside the intended subtree. |
| T-fse-02 | Information disclosure | executor stderr output | mitigate | Executor prints only the resolved path, never config/secret values — matches uproject executor; no secretValues are interpolated into the path output beyond what the operator authored. |
| T-fse-03 | Denial of service | bad/non-existent path | mitigate | statSync throws on ENOENT; caller catches, prints `error:` line, returns exit 1 — fails cleanly without crashing the process or the surrounding chain. |
| T-fse-SC | Tampering | npm/pip/cargo installs | mitigate | No new dependencies introduced — removeReadonly uses only `node:fs`/`node:path`. No package-install task exists, so the package legitimacy gate is not engaged. |
</threat_model>

<verification>
Run from `packages/xci`:
- `npx tsc --noEmit` — zero type errors across all 7 touched + 1 new file.
- `npx vitest run` — full suite green (new unreadonly tests + unchanged regressions).
- `npx @biomejs/biome check src/executor/unreadonly.ts src/types.ts` — new/edited files lint-clean (do not run --unsafe).

Manual smoke (optional, after build): an alias `unlock: { unreadonly: ./readme.md }`
clears the readonly attribute; `unlock-bin: { unreadonly: ./Binaries, recursive: true }`
clears it recursively; `unlock-all: { unreadonly: project }` clears it across the project root.
</verification>

<success_criteria>
- `unreadonly` is a first-class command kind across types → normalize → resolver → cwd → executor.
- Works standalone and as a referenced step inside a `steps:` sequential alias (breadcrumb + step header render correctly).
- File target uses chmod 0o666; directory uses 0o777; recursive walk clears descendants; symlinks are not traversed.
- `path: 'project'` resolves to the effective project root (cwd), not a literal file.
- No new runtime dependency; cold-start budget unaffected.
- `npx tsc --noEmit` and `npx vitest run` both pass.
</success_criteria>

<output>
Create `.planning/quick/260624-fse-add-unreadonly-kind/260624-fse-SUMMARY.md` when done.
</output>
