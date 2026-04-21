---
phase: quick-260421-nmx
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/executor/output.ts
  - packages/xci/src/executor/sequential.ts
  - packages/xci/src/executor/__tests__/output.test.ts
autonomous: true
requirements:
  - quick-260421-nmx
must_haves:
  truths:
    - "Before a sequential cmd step spawns, stderr shows `  cwd: <abs>` in dark yellow when step.cwd is set"
    - "When step.cwd is undefined, no cwd line is printed (no noise in default case)"
    - "When color is disabled (NO_COLOR or non-TTY) the cwd line appears without ANSI"
    - "When logFile is provided, the cwd line is appended to the log file BEFORE the `raw:`/`run:` lines, always plain text (no ANSI)"
    - "Existing `raw:`/`run:` de-dup, dim styling, and secret redaction behavior are preserved unchanged"
  artifacts:
    - path: "packages/xci/src/executor/output.ts"
      provides: "printStepPreview with optional cwd option, emits yellow cwd line before raw/run"
      contains: "cwd: "
    - path: "packages/xci/src/executor/sequential.ts"
      provides: "Call site passes step.cwd through printStepPreview options (spread-if pattern)"
      contains: "printStepPreview"
    - path: "packages/xci/src/executor/__tests__/output.test.ts"
      provides: "Unit tests covering color-on, no-cwd, color-off, logFile, raw!=run ordering cases for cwd preview"
      contains: "cwd:"
  key_links:
    - from: "packages/xci/src/executor/sequential.ts"
      to: "packages/xci/src/executor/output.ts"
      via: "printStepPreview({ cwd: step.cwd }) call with spread-if pattern"
      pattern: "step\\.cwd !== undefined \\? \\{ cwd: step\\.cwd \\}"
    - from: "packages/xci/src/executor/output.ts"
      to: "stderr + logFile"
      via: "Yellow ANSI to stderr (gated by shouldUseColor), plain text to logFile"
      pattern: "cwd: \\$\\{options\\.cwd\\}"
---

<objective>
Print a dark-yellow `  cwd: <absolute-path>` line on stderr before the existing `raw:`/`run:` preview for sequential cmd steps whose effective `cwd` is set. Silent (no line) when cwd is undefined. Also appended to logFile (plain text) when provided. Respects `shouldUseColor()`.

Purpose: When diagnosing failures — especially for_each iterations — operators need to see where a command actually ran. Today the executor honors `cwd` silently.

Output: Modified `printStepPreview` + one call-site update in sequential.ts + unit tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- Current printStepPreview contract (packages/xci/src/executor/output.ts ~line 594) -->

```typescript
export function printStepPreview(
  rawArgv: readonly string[] | undefined,
  resolvedArgv: readonly string[],
  secretValues?: ReadonlySet<string>,
  options?: { verbose?: boolean; logFile?: string },
): void
```

New contract after this plan:

```typescript
export function printStepPreview(
  rawArgv: readonly string[] | undefined,
  resolvedArgv: readonly string[],
  secretValues?: ReadonlySet<string>,
  options?: { verbose?: boolean; logFile?: string; cwd?: string },
): void
```

Relevant constants already exported from output.ts:

```typescript
export const YELLOW = '\x1b[33m';
export const RESET = '\x1b[0m';
export const DIM = '\x1b[2m';
export function shouldUseColor(): boolean;  // honors NO_COLOR / FORCE_COLOR / TTY
```

Current call site (packages/xci/src/executor/sequential.ts ~line 192):

```typescript
printStepPreview(step.rawArgv, finalArgv, undefined, { verbose: env['XCI_VERBOSE'] === '1', logFile });
```

New call site (spread-if required by `exactOptionalPropertyTypes: true` — established by prior quick 260421-ewq):

```typescript
printStepPreview(step.rawArgv, finalArgv, undefined, {
  verbose: env['XCI_VERBOSE'] === '1',
  logFile,
  ...(step.cwd !== undefined ? { cwd: step.cwd } : {}),
});
```

SequentialStep discriminated union already has `cwd?: string` on cmd/ini steps (set steps do not carry cwd by contract) — no type changes required in packages/xci/src/types.ts.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add cwd preview tests (RED), extend printStepPreview option type (compile-time scaffold)</name>
  <files>packages/xci/src/executor/__tests__/output.test.ts, packages/xci/src/executor/output.ts</files>
  <behavior>
    Five unit tests appended under a new `describe('printStepPreview — cwd preview')` block in output.test.ts:

    1. **Color on + cwd set**: FORCE_COLOR=1, cwd '/abs/dir' → stderr contains `\x1b[33m  cwd: /abs/dir\x1b[0m` BEFORE `run:` line.
    2. **No cwd option**: same call without cwd → stderr does NOT contain `cwd:` substring.
    3. **Color off + cwd set**: NO_COLOR=1, cwd '/abs/dir' → stderr contains `  cwd: /abs/dir\n`, does NOT contain `\x1b` anywhere in output.
    4. **logFile + cwd**: tmpfile via mkdtempSync, options={ cwd: '/abs/dir', logFile: tmpFile } → file contents contain `  cwd: /abs/dir\n` appearing BEFORE `  run: ...\n`; file contents must NOT contain any `\x1b` byte.
    5. **raw != run + cwd**: call with rawArgv=['npm','run','${TASK}'] and resolvedArgv=['npm','run','build'] plus { cwd: '/abs/dir' } with FORCE_COLOR=1 → stderr order is `cwd:` → `raw:` → `run:` (assert by indexOf ordering in captured output).

    Stderr-capture pattern: monkey-patch process.stderr.write in beforeEach, restore in afterEach (matches existing pattern used elsewhere in the repo — see capture.test.ts / printRunHeader tests if present; otherwise use vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { captured.push(String(chunk)); return true; })). Env via vi.stubEnv for FORCE_COLOR/NO_COLOR; vi.unstubAllEnvs in afterEach. Tmpfile cleanup via rmSync({ recursive: true, force: true }) on the mkdtemp directory in afterEach.

    Place tests in output.test.ts (NOT cwd.test.ts — cwd.test.ts tests cwd routing through executors, not output formatting).

    To make tests type-check AND fail at runtime (true RED): extend the options parameter type of printStepPreview in output.ts in this same task to `{ verbose?: boolean; logFile?: string; cwd?: string }` but do NOT yet implement the emission logic. Tests that assert output contains `cwd:` will FAIL because the new option is silently ignored; tests that assert absence (case 2) will PASS trivially. This is the RED step.
  </behavior>
  <action>
    1. Open `packages/xci/src/executor/output.ts`. In `printStepPreview` (around line 594-598), extend the options parameter type ONLY to add `cwd?: string`:

       `options?: { verbose?: boolean; logFile?: string; cwd?: string }`

       Do NOT yet add any emission logic — leave the function body unchanged. This is a pure type extension to allow tests and the sequential.ts call site to compile.

    2. Open `packages/xci/src/executor/__tests__/output.test.ts`. Add `printStepPreview` to the named imports (it is not currently imported). Also import any node stdlib needed for tmpfile: `import { mkdtempSync, rmSync, readFileSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join as pathJoin } from 'node:path';`

    3. Append a new `describe('printStepPreview — cwd preview', () => { ... })` block at end of the file with the 5 test cases described in `<behavior>`.

       Stderr capture helper pattern (inline or as a beforeEach setup):
       ```ts
       let captured: string[];
       let writeSpy: ReturnType<typeof vi.spyOn>;
       beforeEach(() => {
         captured = [];
         writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
           captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
           return true;
         });
       });
       afterEach(() => {
         writeSpy.mockRestore();
         vi.unstubAllEnvs();
       });
       ```

       For the logFile test, create a unique tmp dir via `mkdtempSync(pathJoin(tmpdir(), 'xci-nmx-'))`, build `const tmpFile = pathJoin(dir, 'log.txt')`, pass as options.logFile, then `readFileSync(tmpFile, 'utf8')` to assert contents. Clean up with `rmSync(dir, { recursive: true, force: true })` in afterEach (scoped to this describe via a local `let dir` variable).

       ANSI assertions use exact strings `\x1b[33m` (yellow), `\x1b[0m` (reset), and the absence check uses `.not.toContain('\x1b')` against the joined captured array.

       Ordering assertion (case 5): `const joined = captured.join(''); expect(joined.indexOf('cwd:')).toBeLessThan(joined.indexOf('raw:')); expect(joined.indexOf('raw:')).toBeLessThan(joined.indexOf('run:'));`

    4. Do NOT modify `sequential.ts` in this task — the call site change happens in Task 2 together with the real implementation.

    5. Run the tests and confirm RED: the 4 emission-assertion tests fail (no cwd line written) and the 1 absence test passes. Capture baseline for Task 2 to flip to GREEN.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run --no-coverage src/executor/__tests__/output.test.ts 2>&1 | tail -40</automated>
  </verify>
  <done>
    - output.ts `printStepPreview` options type includes `cwd?: string` (type-level only, no emission).
    - output.test.ts contains a new `describe('printStepPreview — cwd preview')` with exactly 5 tests.
    - Running the test file shows: 4 failing tests (cwd emission missing), 1 passing test (absence case).
    - TypeScript still compiles: `npx tsc --noEmit` executor-file error count not worse than pre-edit baseline.
  </done>
</task>

<task type="auto">
  <name>Task 2: Implement cwd emission (GREEN) — output.ts body + sequential.ts call site</name>
  <files>packages/xci/src/executor/output.ts, packages/xci/src/executor/sequential.ts</files>
  <action>
    1. Open `packages/xci/src/executor/output.ts`, find `printStepPreview` (~line 594).

    2. Inside the `if (options?.verbose !== false)` block, BEFORE the existing `raw:`/`run:` writes, add a cwd-preamble emission:

       ```ts
       if (options?.cwd !== undefined) {
         const yellow = useColor ? YELLOW : '';
         const yReset = useColor ? RESET : '';
         process.stderr.write(`${yellow}  cwd: ${options.cwd}${yReset}\n`);
       }
       ```

       Use the already-computed `useColor` from `shouldUseColor()` at the top of the verbose block. When color is off, the line is emitted plain (no ANSI). `YELLOW` and `RESET` are already imported at the top of output.ts — no new imports needed.

    3. In the `if (options?.logFile)` block (below the stderr block), BEFORE the existing appendFileSync of `raw:`/`run:`, prepend a cwd line (plain text, no ANSI) when cwd is set:

       ```ts
       if (options?.cwd !== undefined) {
         appendFileSync(options.logFile, `  cwd: ${options.cwd}\n`);
       }
       ```

       Place this BEFORE the existing if/else that writes `raw:`/`run:` — ordering must be `cwd:` → `raw:` → `run:` in the log file too.

    4. Preserve all existing behavior: raw/run de-dup when rawStr === resStr, dim styling on raw/run, secret redaction via redactArgv. Do NOT change the existing blocks; only prepend the new cwd block.

    5. Open `packages/xci/src/executor/sequential.ts` (~line 192) and update the call site:

       From:
       ```ts
       printStepPreview(step.rawArgv, finalArgv, undefined, { verbose: env['XCI_VERBOSE'] === '1', logFile });
       ```
       To:
       ```ts
       printStepPreview(step.rawArgv, finalArgv, undefined, {
         verbose: env['XCI_VERBOSE'] === '1',
         logFile,
         ...(step.cwd !== undefined ? { cwd: step.cwd } : {}),
       });
       ```

       The spread-if pattern is mandatory because tsconfig has `exactOptionalPropertyTypes: true` (established by quick 260421-ewq). Passing `cwd: step.cwd` unconditionally when `step.cwd: string | undefined` fails type-check against `cwd?: string`.

       Do NOT touch the `ini` step path earlier in sequential.ts (it prints its own filePath feedback) and do NOT touch set steps (they do not carry cwd).

    6. Do NOT modify parallel.ts — out of scope per feature spec.

    7. Re-run the tests from Task 1 and confirm GREEN (5/5 pass). Run full xci suite to verify no regressions in cwd.test.ts, sequential.test.ts, or other executor tests.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run --no-coverage src/executor/__tests__/output.test.ts && npx vitest run --no-coverage 2>&1 | tail -10</automated>
  </verify>
  <done>
    - All 5 new `printStepPreview — cwd preview` tests pass.
    - Full `cd packages/xci && npx vitest run --no-coverage` shows no new failures vs pre-change baseline (same pass count for all other test files; any pre-existing failures unchanged).
    - `cd packages/xci && npx tsc --noEmit 2>&1 | grep -c "src/executor"` returns a number less-than-or-equal to the pre-change baseline for executor files.
    - Manual smoke (optional): `echo 'aliases:\n  test:\n    cwd: /tmp\n    steps:\n      - ["node","-e","0"]' > /tmp/xci-nmx-check.yml` and run a quick xci invocation against a project with a cwd-bearing step → stderr shows `  cwd: /tmp` in yellow before `  run: ...`.
    - parallel.ts untouched (`git diff --stat packages/xci/src/executor/parallel.ts` empty).
    - sequential.ts ini-step and set-step paths untouched.
  </done>
</task>

</tasks>

<verification>
- New tests: `cd packages/xci && npx vitest run --no-coverage src/executor/__tests__/output.test.ts` — 5/5 new cases pass.
- Full regression: `cd packages/xci && npx vitest run --no-coverage` — no new failures vs main.
- Type check: `cd packages/xci && npx tsc --noEmit 2>&1 | grep -c "src/executor"` does not exceed pre-existing baseline for executor files.
- Files untouched: `git diff --stat packages/xci/src/executor/parallel.ts` and same for types.ts — both empty.
- Visual smoke (informal): running any real sequential alias with `cwd:` set emits the yellow cwd line on stderr before the dim `run:` line; running one without `cwd:` shows no cwd line (silent default).
</verification>

<success_criteria>
- `printStepPreview` options extended with `cwd?: string`; emits `  cwd: <path>` in YELLOW to stderr when set (plain when color off).
- LogFile path: when logFile+cwd are both provided, the log file contains `  cwd: <path>\n` BEFORE `  raw:`/`  run:` lines, plain text only.
- sequential.ts call site passes `cwd: step.cwd` using the spread-if pattern required by exactOptionalPropertyTypes.
- Zero changes outside the three listed files.
- All 5 new unit tests pass; full xci suite baseline preserved.
- Raw/run de-dup, dim styling, and secret redaction behavior unchanged.
</success_criteria>

<output>
After completion, create `.planning/quick/260421-nmx-print-step-cwd-in-dark-yellow-before-eac/260421-nmx-SUMMARY.md` following the standard quick-task summary template (what changed, files modified, tests added, regression status).
</output>
