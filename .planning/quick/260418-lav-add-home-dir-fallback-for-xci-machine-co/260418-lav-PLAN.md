---
phase: quick-260418-lav
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/errors.ts
  - src/config/index.ts
  - src/commands/index.ts
  - src/cli.ts
  - src/config/__tests__/loader.test.ts
autonomous: true
requirements:
  - QUICK-260418-LAV  # Home-dir fallback for XCI_MACHINE_CONFIGS + hard-error on invalid env path

must_haves:
  truths:
    - "Running xci with XCI_MACHINE_CONFIGS unset and ~/.xci/ present loads machine config from ~/.xci/"
    - "Running xci with XCI_MACHINE_CONFIGS pointing at a non-directory exits non-zero with MachineConfigInvalidError (exit code 10, CONFIG_ERROR)"
    - "Running xci with XCI_MACHINE_CONFIGS unset and ~/.xci/ absent behaves exactly as before (no machine layer, no warning)"
    - "XCI_MACHINE_CONFIGS pointing at a real directory is used verbatim (precedence over ~/.xci/ fallback)"
    - "src/template/index.ts is unchanged (out-of-scope carve-out documented in plan)"
  artifacts:
    - path: "src/errors.ts"
      provides: "MachineConfigInvalidError class (extends ConfigError, code CONFIG_MACHINE_INVALID)"
      contains: "class MachineConfigInvalidError"
    - path: "src/config/index.ts"
      provides: "resolveMachineConfigDir() exported helper with env + home fallback + invalid-path throw"
      contains: "export function resolveMachineConfigDir"
    - path: "src/commands/index.ts"
      provides: "CommandsLoader uses resolveMachineConfigDir() instead of reading process.env directly"
    - path: "src/cli.ts"
      provides: "Verbose trace uses resolveMachineConfigDir() and annotates source (env vs home fallback)"
    - path: "src/config/__tests__/loader.test.ts"
      provides: "5 new integration tests + 1 unit test for resolveMachineConfigDir()"
      contains: "machine config resolution"
  key_links:
    - from: "src/config/index.ts (configLoader.load)"
      to: "resolveMachineConfigDir()"
      via: "direct call"
      pattern: "resolveMachineConfigDir\\(\\)"
    - from: "src/commands/index.ts (commandsLoader.load)"
      to: "resolveMachineConfigDir()"
      via: "direct call replacing process.env read"
      pattern: "resolveMachineConfigDir\\(\\)"
    - from: "src/cli.ts (verbose trace block)"
      to: "resolveMachineConfigDir()"
      via: "direct call, wrapped in try to not re-throw during trace"
      pattern: "resolveMachineConfigDir\\(\\)"
    - from: "MachineConfigInvalidError"
      to: "ExitCode.CONFIG_ERROR (10)"
      via: "category='config' → exitCodeFor switch"
      pattern: "category.*config"
---

<objective>
Add a home-directory fallback (`~/.xci/`) for machine config resolution, and convert the
"XCI_MACHINE_CONFIGS points at a non-directory" soft warning into a hard
`MachineConfigInvalidError` that exits non-zero. Centralise the resolution in a single
helper (`resolveMachineConfigDir`) so the three current call-sites
(`src/config/index.ts`, `src/commands/index.ts`, `src/cli.ts` verbose trace) stop reading
`process.env['XCI_MACHINE_CONFIGS']` directly.

Purpose: Remove the need for the user to export `XCI_MACHINE_CONFIGS` on every machine —
a plain `~/.xci/` directory now works as a zero-config default. Also surface invalid env
var values as a real error instead of a silently-ignored stderr line (easier to diagnose
typo'd paths).

Output:
- New error class `MachineConfigInvalidError` in `src/errors.ts`
- New exported helper `resolveMachineConfigDir()` in `src/config/index.ts`
- 3 call-sites migrated off direct `process.env` reads
- 6 new/expanded vitest test cases covering the fallback, the hard error, and the precedence rule
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md

# Existing sources the tasks modify (read these before editing)
@src/errors.ts
@src/config/index.ts
@src/commands/index.ts
@src/cli.ts
@src/config/__tests__/loader.test.ts

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from the codebase. -->

From src/errors.ts:
```typescript
export const ExitCode = {
  SUCCESS: 0,
  CONFIG_ERROR: 10,      // <-- MachineConfigInvalidError maps here (category='config')
  COMMAND_ERROR: 20,
  INTERPOLATION_ERROR: 30,
  EXECUTOR_ERROR: 40,
  CLI_ERROR: 50,
} as const;

export type XciErrorCategory = 'config' | 'command' | 'interpolation' | 'executor' | 'cli';

export interface XciErrorOptions {
  code: string;           // machine ID, e.g. 'CONFIG_MACHINE_INVALID'
  suggestion?: string;
  cause?: unknown;
}

export abstract class XciError extends Error {
  public readonly code: string;
  public abstract readonly category: XciErrorCategory;
  public readonly suggestion?: string;
  constructor(message: string, options: XciErrorOptions);
}

export abstract class ConfigError extends XciError {
  public readonly category = 'config' as const;
}

// Existing ConfigError subclasses follow the two-arg / three-arg constructor pattern:
//   YamlParseError(filePath, line, cause, rawContent?)
//   ConfigReadError(filePath, cause)
//   SecretsTrackedError(filePath)
// MachineConfigInvalidError should follow the same single-arg (path) shape.

export function exitCodeFor(error: XciError): ExitCode {
  // switch on error.category — no edit needed when adding a ConfigError subclass,
  // the 'config' arm already returns CONFIG_ERROR = 10.
}
```

From src/config/index.ts (existing local helper — already used by the current code):
```typescript
function isDirectory(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
```

From src/config/index.ts (existing imports — add to these, do not duplicate):
```typescript
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
// Task 1 must add: import { homedir } from 'node:os';
```

From src/commands/index.ts (existing imports):
```typescript
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
// Task 2 must add: import { resolveMachineConfigDir } from '../config/index.js';
```

From src/cli.ts (existing imports):
```typescript
import { configLoader } from './config/index.js';
// Task 2 must add resolveMachineConfigDir to that same import line:
//   import { configLoader, resolveMachineConfigDir } from './config/index.js';
```

Contract for the NEW helper (Task 1 creates this, Tasks 2 and 3 consume it):
```typescript
export type MachineDirResolution =
  | { dir: string; source: 'env' | 'home' }
  | { dir: null; source: 'none' };

/**
 * Resolve which directory (if any) should be used as the machine-config layer.
 *
 *   XCI_MACHINE_CONFIGS set + is-directory           -> { dir, source: 'env' }
 *   XCI_MACHINE_CONFIGS set + NOT a directory        -> throws MachineConfigInvalidError
 *   XCI_MACHINE_CONFIGS unset/empty + ~/.xci/ exists -> { dir: '~/.xci', source: 'home' }
 *   XCI_MACHINE_CONFIGS unset/empty + no ~/.xci/     -> { dir: null, source: 'none' }
 *
 * env and isDirectoryFn are dependency-injected for test isolation.
 */
export function resolveMachineConfigDir(
  env?: NodeJS.ProcessEnv,
  isDirectoryFn?: (p: string) => boolean,
): MachineDirResolution;
```
</interfaces>

<scoped_exclusions>
- `src/template/index.ts` ALSO reads `process.env['XCI_MACHINE_CONFIGS']`. It is OUT OF
  SCOPE for this plan — its semantics ("copy host-side machine files into a template
  archive") differ from config loading, and the user asked specifically about the runtime
  machine-config lookup. Leave `src/template/index.ts` untouched.
- `findXciRoot` / `.xci/` project-dir discovery in `src/cli.ts` is unrelated. Do not touch.
- Project subdirectory logic (`$MACHINE_DIR/<projectName>/`) and layer priority
  (machine = lowest) must be preserved byte-for-byte.
</scoped_exclusions>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add MachineConfigInvalidError + resolveMachineConfigDir helper</name>
  <files>src/errors.ts, src/config/index.ts</files>
  <behavior>
    Error class contract (src/errors.ts):
    - `new MachineConfigInvalidError('/some/bad/path').message` === `'XCI_MACHINE_CONFIGS="/some/bad/path" is not a directory'`
    - `err.code` === `'CONFIG_MACHINE_INVALID'`
    - `err.category` === `'config'` (inherited from ConfigError)
    - `err.suggestion` === `'Point XCI_MACHINE_CONFIGS at a real directory or unset it to use the home fallback (~/.xci/)'`
    - `err instanceof ConfigError` === true, `err instanceof XciError` === true
    - `exitCodeFor(err)` === `ExitCode.CONFIG_ERROR` (10) — no edit to exitCodeFor needed

    Helper contract (src/config/index.ts) — unit tests with mocked env+isDirectoryFn:
    - env={XCI_MACHINE_CONFIGS:'/a'}, isDir=>true  → `{dir:'/a', source:'env'}`
    - env={XCI_MACHINE_CONFIGS:'/a'}, isDir=>false → throws MachineConfigInvalidError with path='/a'
    - env={XCI_MACHINE_CONFIGS:''},   isDir=>true  → treat empty-string as unset, falls through to home
    - env={},                         isDir=>true  → `{dir: join(homedir(),'.xci'), source:'home'}`
    - env={}, isDir for home-only=>false           → `{dir: null, source:'none'}`
    - env var wins even when both paths are valid directories (env precedence)
  </behavior>
  <action>
    Edit `src/errors.ts`:
    - Add, immediately after the `SecretsTrackedError` class (around line 115), a new
      concrete subclass of `ConfigError`:
      ```typescript
      export class MachineConfigInvalidError extends ConfigError {
        public readonly path: string;
        constructor(path: string) {
          super(`XCI_MACHINE_CONFIGS="${path}" is not a directory`, {
            code: 'CONFIG_MACHINE_INVALID',
            suggestion:
              'Point XCI_MACHINE_CONFIGS at a real directory or unset it to use the home fallback (~/.xci/)',
          });
          this.path = path;
        }
      }
      ```
    - Do NOT edit `exitCodeFor` — `category='config'` already maps to
      `ExitCode.CONFIG_ERROR` via the inherited base class.

    Edit `src/config/index.ts`:
    - Add `import { homedir } from 'node:os';` to the import block.
    - Add `MachineConfigInvalidError` to the existing named import from `'../errors.js'`:
      ```typescript
      import { ConfigReadError, MachineConfigInvalidError, YamlParseError } from '../errors.js';
      ```
    - Just BEFORE the `// ConfigLoader export` comment (around line 280) — i.e. keeping
      the helper in the private-helpers region but exporting it for cross-module use —
      add:
      ```typescript
      export type MachineDirResolution =
        | { dir: string; source: 'env' | 'home' }
        | { dir: null; source: 'none' };

      /**
       * Resolve which directory (if any) to use for the machine-config layer.
       *
       *   1. If XCI_MACHINE_CONFIGS is set AND points to a directory → use it.
       *   2. If XCI_MACHINE_CONFIGS is set AND does NOT point to a directory → throw.
       *   3. Otherwise, if ~/.xci/ is a directory → use it.
       *   4. Otherwise → no machine layer.
       *
       * env and isDirectoryFn are injected so unit tests can drive every branch
       * without touching process.env or the real filesystem.
       */
      export function resolveMachineConfigDir(
        env: NodeJS.ProcessEnv = process.env,
        isDirectoryFn: (p: string) => boolean = isDirectory,
      ): MachineDirResolution {
        const envPath = env['XCI_MACHINE_CONFIGS'];
        if (envPath !== undefined && envPath !== '') {
          if (!isDirectoryFn(envPath)) {
            throw new MachineConfigInvalidError(envPath);
          }
          return { dir: envPath, source: 'env' };
        }
        const homeDir = join(homedir(), '.xci');
        if (isDirectoryFn(homeDir)) {
          return { dir: homeDir, source: 'home' };
        }
        return { dir: null, source: 'none' };
      }
      ```
    - DO NOT change the existing `isDirectory` helper signature or the `configLoader`
      export yet — Task 2 migrates the call-sites. This task only adds the new surface.

    Sanity-build: `pnpm tsc --noEmit` (or `npx tsc --noEmit`) must pass after this task.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci &amp;&amp; npx tsc --noEmit 2>&amp;1 | tee /tmp/tsc-task1.log &amp;&amp; grep -q "class MachineConfigInvalidError" src/errors.ts &amp;&amp; grep -q "export function resolveMachineConfigDir" src/config/index.ts &amp;&amp; grep -q "export type MachineDirResolution" src/config/index.ts &amp;&amp; grep -q "from 'node:os'" src/config/index.ts</automated>
  </verify>
  <done>
    - `src/errors.ts` contains `class MachineConfigInvalidError extends ConfigError`.
    - The constructor stores `.path` and produces the exact message string specified above.
    - `src/config/index.ts` exports both `MachineDirResolution` (type) and
      `resolveMachineConfigDir` (function).
    - `homedir` is imported from `node:os` in `src/config/index.ts`.
    - `npx tsc --noEmit` exits 0 (no type errors).
    - No existing tests broken (vitest run is deferred to Task 3, but compile is green now).
  </done>
</task>

<task type="auto">
  <name>Task 2: Migrate the 3 call-sites off direct process.env reads</name>
  <files>src/config/index.ts, src/commands/index.ts, src/cli.ts</files>
  <action>
    Replace every direct read of `process.env['XCI_MACHINE_CONFIGS']` in source (non-test)
    code with a call to `resolveMachineConfigDir()`. Three call-sites:

    ---------------------------------------------------------------
    1) `src/config/index.ts`, inside `configLoader.load` (lines ~286-337)
    ---------------------------------------------------------------
    Replace the current block:
    ```typescript
    const machineDir = process.env['XCI_MACHINE_CONFIGS'];
    // ...
    if (machineDir) {
      if (!isDirectory(machineDir)) {
        process.stderr.write(`[xci] WARNING: XCI_MACHINE_CONFIGS="${machineDir}" is not a directory\n`);
      } else {
        const machineDirs = [machineDir];
        if (projectName) { ... }
        // ... machineFilesLoaded loop UNCHANGED ...
        if (machineFilesLoaded === 0) {
          process.stderr.write(`[xci] NOTE: XCI_MACHINE_CONFIGS="${machineDir}" — no config/secrets files found\n`);
        }
      }
    }
    ```

    With this shape (the invalid-path branch is now a hard throw done by the helper;
    the WARNING line is DELETED entirely):
    ```typescript
    const resolution = resolveMachineConfigDir(); // throws MachineConfigInvalidError on bad env
    const machineDir = resolution.dir;
    // ... projectPath / secretsPath / localPath / projectName logic UNCHANGED ...
    if (machineDir) {
      const machineDirs = [machineDir];
      if (projectName) {
        const projDir = join(machineDir, projectName);
        if (isDirectory(projDir)) {
          machineDirs.push(projDir);
        } else {
          process.stderr.write(`[xci] NOTE: machine project dir not found: ${projDir}\n`);
        }
      } else {
        process.stderr.write(`[xci] NOTE: "project" not set in config.yml — skipping project-specific machine config\n`);
      }
      let machineFilesLoaded = 0;
      for (const dir of machineDirs) {
        // ... UNCHANGED: readLayer(join(dir,'config.yml'),'machine'), secrets.yml, secrets/ recursion ...
      }
      if (machineFilesLoaded === 0) {
        const label = resolution.source === 'home'
          ? '~/.xci/ (home fallback)'
          : `XCI_MACHINE_CONFIGS="${machineDir}"`;
        process.stderr.write(`[xci] NOTE: ${label} — no config/secrets files found\n`);
      }
    }
    ```

    Rationale:
    - The `WARNING: ... is not a directory` stderr write DISAPPEARS — the helper throws
      instead. The throw propagates up through `configLoader.load` → cli.ts top-level
      catch → `exitCodeFor` → exit 10.
    - The zero-files NOTE is retained; just relabelled for the home-fallback case so the
      user sees which directory was scanned.
    - Machine-layer priority (lowest) and the project-subdir lookup are unchanged.

    ---------------------------------------------------------------
    2) `src/commands/index.ts`, inside `commandsLoader.load` (line ~151)
    ---------------------------------------------------------------
    Replace:
    ```typescript
    const machineDir = process.env['XCI_MACHINE_CONFIGS'];
    // ...
    let machineIsDir = false;
    try { machineIsDir = !!machineDir && statSync(machineDir).isDirectory(); } catch { /* */ }
    const commands: Map<string, CommandDef> = machineIsDir
      ? loadCommandsFromDir(machineDir!)
      : new Map();

    if (machineIsDir && projectName) {
      const machineProjectDir = join(machineDir!, projectName);
      // ...
    }
    ```

    With:
    ```typescript
    const { dir: machineDir } = resolveMachineConfigDir(); // throws on invalid env
    const commands: Map<string, CommandDef> = machineDir
      ? loadCommandsFromDir(machineDir)
      : new Map();

    if (machineDir && projectName) {
      const machineProjectDir = join(machineDir, projectName);
      let projDirExists = false;
      try { projDirExists = statSync(machineProjectDir).isDirectory(); } catch { /* */ }
      if (projDirExists) {
        const machineProjectCmds = loadCommandsFromDir(machineProjectDir);
        mergeCommandsSilent(commands, machineProjectCmds);
      }
    }
    ```

    Import: add `resolveMachineConfigDir` to the existing `'../config/index.js'` import
    path. If there is no existing import from that module (likely the case), add a new
    line near the top:
    ```typescript
    import { resolveMachineConfigDir } from '../config/index.js';
    ```
    The `!` non-null assertions on `machineDir!` go away because TypeScript narrows
    `machineDir` to `string` inside the `if (machineDir)` arm.

    The `machineIsDir` variable and its `try/catch`+`statSync` check are now redundant
    (the helper already verified the directory exists) — remove them.

    ---------------------------------------------------------------
    3) `src/cli.ts`, verbose trace block (lines ~440-485)
    ---------------------------------------------------------------
    Replace:
    ```typescript
    const machineConfigsDir = process.env['XCI_MACHINE_CONFIGS'];
    if (machineConfigsDir) {
      let isDir = false;
      try { isDir = statSync(machineConfigsDir).isDirectory(); } catch { /* ignore */ }
      if (isDir) {
        configFiles.push({ path: join(machineConfigsDir, 'commands.yml'), ... });
        // ... 4 more pushes UNCHANGED ...
      }
    }
    ```

    With (wrap the helper call in a try so a stale throw here never crashes the
    verbose-trace path — by the time verbose trace runs, configLoader.load has already
    succeeded, so the helper cannot throw in practice, but defensive try avoids a second
    error path):
    ```typescript
    let machineConfigsDir: string | undefined;
    let machineSource: 'env' | 'home' | undefined;
    try {
      const res = resolveMachineConfigDir();
      if (res.dir) {
        machineConfigsDir = res.dir;
        machineSource = res.source;
      }
    } catch {
      // configLoader.load would have thrown first; safe to swallow here.
    }
    if (machineConfigsDir) {
      const annotation = machineSource === 'env' ? '[from env]' : '[from home fallback]';
      process.stderr.write(`[xci] NOTE: machine config source: ${annotation} ${machineConfigsDir}\n`);
      configFiles.push({ path: join(machineConfigsDir, 'commands.yml'), found: existsSync(join(machineConfigsDir, 'commands.yml')) });
      configFiles.push({ path: join(machineConfigsDir, 'secrets.yml'), found: existsSync(join(machineConfigsDir, 'secrets.yml')) });
      const mSecretsDir = join(machineConfigsDir, 'secrets');
      if (existsSync(mSecretsDir)) {
        for (const f of listYamlFilesRecursive(mSecretsDir)) {
          configFiles.push({ path: f, found: true });
        }
      }
      const mCommandsDir = join(machineConfigsDir, 'commands');
      if (existsSync(mCommandsDir)) {
        for (const f of listYamlFilesRecursive(mCommandsDir)) {
          configFiles.push({ path: f, found: true });
        }
      }
    }
    ```

    Import: update the existing `import { configLoader } from './config/index.js';` to
    `import { configLoader, resolveMachineConfigDir } from './config/index.js';`.

    The redundant `isDir` / `statSync(machineConfigsDir).isDirectory()` pair is removed
    (the helper already guarantees it).

    ---------------------------------------------------------------
    After all three edits run:
    ```
    grep -n "process\.env\[['\"]XCI_MACHINE_CONFIGS['\"]\]" src/config/index.ts src/commands/index.ts src/cli.ts
    ```
    Must return ZERO matches. The only remaining direct env reads in the whole repo
    should be in the test file (expected) and in `src/template/index.ts` (OUT OF SCOPE —
    leave it alone).
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci &amp;&amp; npx tsc --noEmit 2>&amp;1 | tee /tmp/tsc-task2.log &amp;&amp; test "$(grep -c "process\.env\[['\"]XCI_MACHINE_CONFIGS['\"]\]" src/config/index.ts src/commands/index.ts src/cli.ts | awk -F: '{s+=$2} END {print s}')" = "0" &amp;&amp; grep -q "resolveMachineConfigDir" src/commands/index.ts &amp;&amp; grep -q "resolveMachineConfigDir" src/cli.ts &amp;&amp; ! grep -q "WARNING: XCI_MACHINE_CONFIGS" src/config/index.ts</automated>
  </verify>
  <done>
    - All three call-sites import and use `resolveMachineConfigDir()`.
    - Zero direct `process.env['XCI_MACHINE_CONFIGS']` reads remain in src/config/,
      src/commands/, src/cli.ts.
    - The `[xci] WARNING: ... is not a directory` line is GONE from src/config/index.ts
      (superseded by the thrown error).
    - The verbose trace emits a `[xci] NOTE: machine config source: [from env|home fallback] <path>`
      line when a machine dir is in effect.
    - `npx tsc --noEmit` exits 0. Existing tests not in this plan still compile.
    - `src/template/index.ts` untouched (confirmed by `git diff --name-only src/template/` showing no output).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Tests for home fallback, hard error, and precedence</name>
  <files>src/config/__tests__/loader.test.ts</files>
  <behavior>
    Six test cases under a new `describe('machine config resolution', ...)` block:

    (1) Home fallback used when env var unset + ~/.xci/ exists:
        - HOME=tmpdirA; USERPROFILE=tmpdirA (Windows parity); XCI_MACHINE_CONFIGS deleted
        - tmpdirA/.xci/config.yml contains `machine: "fallback-value"`
        - Expect resolvedConfig.values['machine'] === 'fallback-value'
        - Expect provenance['machine'] === 'machine'

    (2) Silent skip when env var unset + ~/.xci/ missing:
        - HOME=tmpdirB (no .xci/ inside); XCI_MACHINE_CONFIGS deleted
        - Spy on process.stderr.write
        - Expect no key with provenance 'machine' in result
        - Expect no stderr write matching /XCI_MACHINE_CONFIGS|home fallback/ (the NOTE
          for "no files found" only fires when a machine dir WAS resolved, so with
          source='none' there should be nothing)

    (3) Hard error when XCI_MACHINE_CONFIGS points at a file:
        - Create a plain file at tmpdir/not-a-dir.yml
        - process.env.XCI_MACHINE_CONFIGS = that file path
        - Expect `configLoader.load(cwd)` to reject with MachineConfigInvalidError
        - Expect err.path === that file path
        - Expect err.code === 'CONFIG_MACHINE_INVALID'
        - Expect exitCodeFor(err) === 10

    (4) Hard error when XCI_MACHINE_CONFIGS points at a nonexistent path:
        - process.env.XCI_MACHINE_CONFIGS = `/nonexistent/${Math.random()}`
        - Expect reject with MachineConfigInvalidError

    (5) Env var wins when both env var dir AND ~/.xci/ exist:
        - HOME=tmpdirA; tmpdirA/.xci/config.yml has `foo: "home"`
        - XCI_MACHINE_CONFIGS=tmpdirB; tmpdirB/config.yml has `foo: "env"`
        - Expect result.values['foo'] === 'env' (home is NOT merged as a second layer)

    (6) Unit test for resolveMachineConfigDir() with injected env + isDirectoryFn:
        - env={}, isDir=>true  → { dir: join(homedir(),'.xci'), source:'home' }
        - env={XCI_MACHINE_CONFIGS:'/x'}, isDir=>true  → { dir:'/x', source:'env' }
        - env={XCI_MACHINE_CONFIGS:'/x'}, isDir=>false → throws MachineConfigInvalidError
        - env={XCI_MACHINE_CONFIGS:''},   isDir=>true  → falls through to home branch
        - env={}, isDir=>false → { dir: null, source:'none' }
  </behavior>
  <action>
    Open `src/config/__tests__/loader.test.ts` and append a new top-level
    `describe('machine config resolution', ...)` block AFTER the existing blocks.

    Setup pattern (follow the existing `savedMachineConfig` + beforeEach/afterEach shape
    from lines 56-71 — extend to also save/restore HOME and USERPROFILE):

    ```typescript
    import { homedir } from 'node:os';
    import { MachineConfigInvalidError, exitCodeFor, ExitCode } from '../../errors.js';
    import { resolveMachineConfigDir } from '../index.js';
    // (Keep existing imports too.)

    describe('machine config resolution', () => {
      let cwd: string;
      let homeTmp: string;
      let savedMachineConfig: string | undefined;
      let savedHome: string | undefined;
      let savedUserProfile: string | undefined;
      let stderrSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(async () => {
        savedMachineConfig = process.env['XCI_MACHINE_CONFIGS'];
        savedHome = process.env['HOME'];
        savedUserProfile = process.env['USERPROFILE'];
        delete process.env['XCI_MACHINE_CONFIGS'];
        homeTmp = await mkdtemp(join(tmpdir(), 'xci-home-'));
        process.env['HOME'] = homeTmp;
        process.env['USERPROFILE'] = homeTmp; // Windows parity for os.homedir()
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      });

      afterEach(async () => {
        stderrSpy.mockRestore();
        if (cwd) await cleanup(cwd);
        await cleanup(homeTmp);
        // Restore all three env vars exactly
        if (savedMachineConfig === undefined) delete process.env['XCI_MACHINE_CONFIGS'];
        else process.env['XCI_MACHINE_CONFIGS'] = savedMachineConfig;
        if (savedHome === undefined) delete process.env['HOME'];
        else process.env['HOME'] = savedHome;
        if (savedUserProfile === undefined) delete process.env['USERPROFILE'];
        else process.env['USERPROFILE'] = savedUserProfile;
      });

      it('uses home fallback when env var is unset and ~/.xci/ exists', async () => {
        await mkdir(join(homeTmp, '.xci'));
        await writeFile(join(homeTmp, '.xci', 'config.yml'), 'machine: "fallback-value"', 'utf8');
        cwd = await setupFixture({});
        const result = await configLoader.load(cwd);
        expect(result.values['machine']).toBe('fallback-value');
        expect(result.provenance['machine']).toBe('machine');
      });

      it('skips silently when env var unset and ~/.xci/ missing', async () => {
        cwd = await setupFixture({ 'config.yml': 'project: demo' });
        const result = await configLoader.load(cwd);
        // No machine-provenance keys (other than builtins which are not 'machine' layer)
        for (const [, prov] of Object.entries(result.provenance)) {
          expect(prov).not.toBe('machine');
        }
        // No env-var or home-fallback NOTE in stderr
        const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
        expect(stderrCalls.some((s) => /XCI_MACHINE_CONFIGS|home fallback|~\/\.xci/.test(s))).toBe(false);
      });

      it('throws MachineConfigInvalidError when XCI_MACHINE_CONFIGS points at a file', async () => {
        cwd = await setupFixture({});
        const filePath = join(cwd, 'not-a-dir.yml');
        await writeFile(filePath, 'whatever: 1', 'utf8');
        process.env['XCI_MACHINE_CONFIGS'] = filePath;
        await expect(configLoader.load(cwd)).rejects.toBeInstanceOf(MachineConfigInvalidError);
        // Assert error shape
        try { await configLoader.load(cwd); } catch (e) {
          const err = e as MachineConfigInvalidError;
          expect(err.path).toBe(filePath);
          expect(err.code).toBe('CONFIG_MACHINE_INVALID');
          expect(exitCodeFor(err)).toBe(ExitCode.CONFIG_ERROR);
        }
      });

      it('throws MachineConfigInvalidError when XCI_MACHINE_CONFIGS points at a nonexistent path', async () => {
        cwd = await setupFixture({});
        process.env['XCI_MACHINE_CONFIGS'] = `/nonexistent-${Math.random().toString(36).slice(2)}`;
        await expect(configLoader.load(cwd)).rejects.toBeInstanceOf(MachineConfigInvalidError);
      });

      it('env var takes precedence over home fallback when both exist', async () => {
        // home dir has ~/.xci/config.yml with foo: home
        await mkdir(join(homeTmp, '.xci'));
        await writeFile(join(homeTmp, '.xci', 'config.yml'), 'foo: "home"', 'utf8');
        // env var points at a different dir with foo: env
        cwd = await setupFixture({});
        const envDir = join(cwd, 'env-machine-conf');
        await mkdir(envDir);
        await writeFile(join(envDir, 'config.yml'), 'foo: "env"', 'utf8');
        process.env['XCI_MACHINE_CONFIGS'] = envDir;

        const result = await configLoader.load(cwd);
        expect(result.values['foo']).toBe('env');
        expect(result.provenance['foo']).toBe('machine');
      });

      describe('resolveMachineConfigDir unit', () => {
        it('returns env source when var is set and path is a directory', () => {
          const res = resolveMachineConfigDir({ XCI_MACHINE_CONFIGS: '/x' }, () => true);
          expect(res).toEqual({ dir: '/x', source: 'env' });
        });

        it('throws MachineConfigInvalidError when env var set but not a directory', () => {
          expect(() =>
            resolveMachineConfigDir({ XCI_MACHINE_CONFIGS: '/x' }, () => false),
          ).toThrow(MachineConfigInvalidError);
        });

        it('treats empty string as unset and falls through to home', () => {
          const res = resolveMachineConfigDir({ XCI_MACHINE_CONFIGS: '' }, () => true);
          expect(res.source).toBe('home');
          expect(res.dir).toBe(join(homedir(), '.xci'));
        });

        it('returns home when env unset and home exists', () => {
          const res = resolveMachineConfigDir({}, () => true);
          expect(res).toEqual({ dir: join(homedir(), '.xci'), source: 'home' });
        });

        it('returns none when env unset and home missing', () => {
          const res = resolveMachineConfigDir({}, () => false);
          expect(res).toEqual({ dir: null, source: 'none' });
        });
      });
    });
    ```

    Notes on the test scaffold:
    - The file-level `setupFixture` and `cleanup` helpers already exist — reuse them.
    - `vi.spyOn(process.stderr, 'write')` replaces the real stderr so the "no NOTE"
      assertion in test (2) works without polluting test output.
    - Mock must be restored in afterEach.
    - Setting both HOME and USERPROFILE keeps tests OS-agnostic: `os.homedir()` reads
      USERPROFILE first on Windows, HOME first on Unix.
    - Test (5) relies on the fact that when resolution.source === 'env', the home
      directory is NOT merged — the existing machine loading loop only walks the
      resolved single dir, so this is already true; the test just pins the behavior.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci &amp;&amp; npx vitest run src/config/__tests__/loader.test.ts --reporter=verbose 2>&amp;1 | tee /tmp/vitest-task3.log &amp;&amp; grep -E "Tests.*passed" /tmp/vitest-task3.log &amp;&amp; ! grep -E "Tests.*failed" /tmp/vitest-task3.log</automated>
  </verify>
  <done>
    - New `describe('machine config resolution', ...)` block exists in loader.test.ts.
    - 5 integration tests (home fallback, silent skip, file path error, nonexistent
      path error, env-vs-home precedence) all pass.
    - 5 unit tests for `resolveMachineConfigDir()` with injected env+isDirectoryFn pass.
    - ALL pre-existing tests in loader.test.ts still pass (no regressions).
    - `npx vitest run src/config/__tests__/loader.test.ts` exits 0.
  </done>
</task>

</tasks>

<verification>
Whole-plan verification (run after all 3 tasks):

1. `npx tsc --noEmit` → exits 0.
2. `npx vitest run` → exits 0 (entire suite, not just loader.test.ts — confirms no
   regression elsewhere, e.g. commands tests, cli e2e tests).
3. `npx @biomejs/biome check src/errors.ts src/config/index.ts src/commands/index.ts src/cli.ts src/config/__tests__/loader.test.ts` → no errors.
4. Manual smoke (optional but recommended):
   ```
   # Home fallback active:
   mkdir -p ~/.xci && echo 'hello: "world"' > ~/.xci/config.yml
   unset XCI_MACHINE_CONFIGS
   cd /tmp/some-xci-project && xci --verbose somealias
   # Expect: "[xci] NOTE: machine config source: [from home fallback] /home/you/.xci"

   # Hard error:
   export XCI_MACHINE_CONFIGS=/etc/hostname   # a file, not a dir
   xci --help
   # Expect: exit code 10, message: XCI_MACHINE_CONFIGS="/etc/hostname" is not a directory
   ```
5. `grep -rn "process\.env\[['\"]XCI_MACHINE_CONFIGS['\"]\]" src/ --include='*.ts' | grep -v __tests__ | grep -v template/` → zero lines.
</verification>

<success_criteria>
This plan is complete when ALL of the following are true:

- [ ] `src/errors.ts` exports `MachineConfigInvalidError` extending `ConfigError` with code
      `'CONFIG_MACHINE_INVALID'`, message shape `XCI_MACHINE_CONFIGS="..." is not a directory`,
      a `.path` field, and the specified suggestion.
- [ ] `exitCodeFor(new MachineConfigInvalidError('/x'))` returns `ExitCode.CONFIG_ERROR` (10),
      verified without modifying the `exitCodeFor` function body.
- [ ] `src/config/index.ts` exports `resolveMachineConfigDir` and `MachineDirResolution`.
- [ ] The helper returns `{dir,source:'env'}` when the env var is a directory,
      `{dir,source:'home'}` when it falls through to `~/.xci/`, `{dir:null,source:'none'}`
      otherwise, and throws for an invalid env path.
- [ ] `src/config/index.ts`, `src/commands/index.ts`, `src/cli.ts` contain ZERO direct reads
      of `process.env['XCI_MACHINE_CONFIGS']`. (Test files and `src/template/index.ts` are
      intentionally untouched.)
- [ ] The pre-existing stderr warning `[xci] WARNING: XCI_MACHINE_CONFIGS="..." is not a directory`
      is DELETED from src/config/index.ts.
- [ ] The verbose trace in `src/cli.ts` emits a `[xci] NOTE: machine config source: [from env|home fallback] <path>`
      line when a machine config dir is in effect.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npx vitest run` exits 0. The 5 new integration tests + 5 new unit tests in
      loader.test.ts all pass. All pre-existing tests still pass.
- [ ] Layer priority (machine = lowest) and the `$MACHINE_DIR/<projectName>/` subdir lookup
      are unchanged — their existing tests continue to pass.
- [ ] `src/template/index.ts` is NOT in the commit's diff (scoped exclusion respected).
- [ ] `findXciRoot` / `.xci/` project-directory discovery in cli.ts is NOT touched.
</success_criteria>

<output>
After completion, create `.planning/quick/260418-lav-add-home-dir-fallback-for-xci-machine-co/260418-lav-SUMMARY.md`
documenting:
- What changed (new error class, new helper, 3 migrated call-sites, 10 new tests)
- Why (zero-config ergonomics via `~/.xci/` fallback; hard error for typo'd env paths)
- The scoped exclusion (template/ intentionally untouched) and its rationale
- Any decisions made during execution (e.g. if the NOTE label was tweaked)
- Test counts: 5 integration + 5 unit = 10 new test cases
</output>
