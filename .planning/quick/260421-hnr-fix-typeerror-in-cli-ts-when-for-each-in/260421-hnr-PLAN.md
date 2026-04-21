---
phase: quick-260421-hnr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/cli.ts
  - packages/xci/src/__tests__/cli.e2e.test.ts
autonomous: true
requirements:
  - QUICK-260421-hnr

must_haves:
  truths:
    - "`xci <alias> --list` does not throw TypeError when a `for_each` alias uses `in: \"${VAR}\"` (string form)."
    - "`xci <alias> --help` does not throw TypeError when a `for_each` alias uses string form for `in`."
    - "xci startup (commander registration) does not crash when any alias in commands.yml uses string form for `for_each.in` — regression against quick-260421-ewq."
    - "Array form (`in: [a, b, c]`) still renders as bracketed `[a, b, c]` — existing behavior unchanged."
    - "String form (`in: \"${VAR}\"`) renders as the raw placeholder (no brackets)."
    - "Full xci test suite (499+ baseline from 260421-g99) passes."
  artifacts:
    - path: "packages/xci/src/cli.ts"
      provides: "for_each display branches handle both array and string forms of `def.in`."
      contains: "Array.isArray(def.in)"
    - path: "packages/xci/src/__tests__/cli.e2e.test.ts"
      provides: "regression e2e tests for for_each.in string + array display forms."
  key_links:
    - from: "packages/xci/src/cli.ts (buildAliasHelpText, for_each branch)"
      to: "def.in (readonly string[] | string per types.ts:88)"
      via: "Array.isArray type narrowing before .join()"
      pattern: "Array\\.isArray\\(def\\.in\\)"
    - from: "packages/xci/src/cli.ts (printAliasDetails, for_each branch)"
      to: "def.in (readonly string[] | string per types.ts:88)"
      via: "Array.isArray type narrowing before .join()"
      pattern: "Array\\.isArray\\(def\\.in\\)"
---

<objective>
Fix a runtime regression introduced by quick-260421-ewq. When `for_each.in` was widened from `readonly string[]` to `readonly string[] | string`, two display sites in `cli.ts` were left calling `def.in.join(...)` unconditionally. One of those sites (`buildAliasHelpText`) runs at commander registration for every alias, so any user alias using the string form crashes xci at startup with `TypeError: def.in.join is not a function`.

Purpose: restore xci startup / --list / --help to non-crashing behavior when any `for_each` alias uses `in: "${VAR}"`, while preserving the existing bracketed display for the array form.

Output: ~4 lines of code changed in `cli.ts` (two sites) plus e2e regression tests; a single commit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md
@packages/xci/src/cli.ts
@packages/xci/src/types.ts
@packages/xci/src/__tests__/cli.e2e.test.ts

<interfaces>
<!-- Contract for `for_each.in` — widened in quick-260421-ewq. -->
<!-- Source: packages/xci/src/types.ts lines 86-96. -->

```typescript
{
  readonly kind: 'for_each';
  readonly var: string;
  readonly in: readonly string[] | string; // array of values OR a single "${VAR}" placeholder (CSV-split at resolve time)
  readonly mode: 'steps' | 'parallel';
  readonly cmd?: readonly string[];
  readonly run?: string;
  // ...
}
```

<!-- Existing e2e helpers in cli.e2e.test.ts: -->
<!--   function runCliInDir(dir, args): { stdout, stderr, code } -->
<!--   function createTempProject(files): string -->
<!--   function trackDir(dir): string -->
<!-- Pattern for per-alias --help / --list tests already established (see it('CLI-04, D-22' ...) at line 352 and it('CLI-03, D-21' ...) at line 164). -->
</interfaces>

<bug_sites>
Both in packages/xci/src/cli.ts, case 'for_each' branches:

**Site 1 — line 177, inside `buildAliasHelpText`:**
```ts
lines.push(`  in: [${def.in.join(', ')}]`);
```
This function is called at commander registration time (line 357: `.addHelpText('after', buildAliasHelpText(alias, def))`) for EVERY alias. So a single for_each alias with `in: "${VAR}"` crashes xci at startup — before argv parsing, before any user command dispatch.

**Site 2 — line 240, inside `printAliasDetails`:**
```ts
process.stderr.write(`  var: ${def.var}  in: [${def.in.join(', ')}]  mode: ${def.mode}\n`);
```
This runs only when the user passes `--list` / `-l`. Still crashes for string-form aliases, but the failure is localized to `--list`.
</bug_sites>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix both for_each display sites and add regression tests</name>
  <files>packages/xci/src/cli.ts, packages/xci/src/__tests__/cli.e2e.test.ts</files>
  <behavior>
    Acceptance (all via e2e with real `node dist/cli.mjs` using `runCliInDir` + `createTempProject`):

    1. **String-form `--list`:**
       - Config `items: { kind: for_each, var: ITEM, in: "${ITEMS}", mode: steps, cmd: ["echo", "${ITEM}"] }` plus `config.yml` defining `ITEMS: a,b,c`.
       - `runCliInDir(dir, ['--list'])` exits 0.
       - `stderr` contains `in: ${ITEMS}` (no brackets, raw placeholder).
       - `stderr` does NOT contain the substring `TypeError`.

    2. **String-form per-alias `--help`:**
       - Same string-form config as (1).
       - `runCliInDir(dir, ['items', '--help'])` exits 0.
       - `stdout` contains `in: ${ITEMS}` (no brackets).
       - No `TypeError` anywhere in stdout/stderr.

    3. **String-form startup no-crash (the critical regression):**
       - Same string-form config as (1), plus a second plain alias `hello: { cmd: ["echo", "hi"] }`.
       - `runCliInDir(dir, ['hello'])` exits 0 and stdout contains `hi`. (Proves commander registration for the string-form for_each alias no longer throws — if the bug were still present, xci would crash BEFORE dispatching `hello`.)

    4. **Array-form unchanged (regression guard against over-fixing):**
       - Config `loop: { kind: for_each, var: X, in: ["a","b","c"], mode: steps, cmd: ["echo", "${X}"] }`.
       - `runCliInDir(dir, ['--list'])` exits 0.
       - `stderr` contains `in: [a, b, c]` (bracketed, comma-space separated — exactly the existing format).
  </behavior>
  <action>
    **Step A — Fix packages/xci/src/cli.ts (two minimal edits):**

    At line 177, inside `buildAliasHelpText`, `case 'for_each':`, replace:
    ```ts
    lines.push(`  in: [${def.in.join(', ')}]`);
    ```
    with:
    ```ts
    const inDisplay = Array.isArray(def.in) ? `[${def.in.join(', ')}]` : def.in;
    lines.push(`  in: ${inDisplay}`);
    ```

    At line 240, inside `printAliasDetails`, `case 'for_each':`, replace:
    ```ts
    process.stderr.write(`  var: ${def.var}  in: [${def.in.join(', ')}]  mode: ${def.mode}\n`);
    ```
    with:
    ```ts
    const inDisplay = Array.isArray(def.in) ? `[${def.in.join(', ')}]` : def.in;
    process.stderr.write(`  var: ${def.var}  in: ${inDisplay}  mode: ${def.mode}\n`);
    ```

    Constraints:
    - Do NOT extract a shared helper — the two sites differ in output framing (one pushes to an array, one writes to stderr with additional fields on the same line) and inline `Array.isArray` is the clearest form for 2 sites.
    - Do NOT touch any other file or any other branch of the switch.
    - Do NOT refactor surrounding code.
    - Place the `const inDisplay` declaration inside the `case` block (case scoping is already used for local vars elsewhere in the function — add braces around the case body if TypeScript/Biome complains about lexical declarations in case; check first without braces, add only if lint errors).

    **Step B — Add regression e2e tests to packages/xci/src/__tests__/cli.e2e.test.ts:**

    Add a new `describe` block (or append 4 new `it(...)` tests into an appropriate existing describe) covering the 4 scenarios in `<behavior>`. Use the existing `runCliInDir`, `createTempProject`, `trackDir` helpers — do NOT introduce new helpers.

    Test IDs to use (follow the file's convention of `CLI-XX` / `D-XX` tags in `it(...)` names):
    - `it('quick-260421-hnr: --list renders for_each.in string form without brackets', ...)`
    - `it('quick-260421-hnr: per-alias --help renders for_each.in string form without brackets', ...)`
    - `it('quick-260421-hnr: startup does not crash when for_each.in uses string form (registration regression)', ...)`
    - `it('quick-260421-hnr: --list renders for_each.in array form with brackets (no over-fix)', ...)`

    For the config.yml that provides `ITEMS`, follow whatever format the existing e2e tests use (look at how other tests in this file provide `config.yml` values — search for `config.yml` usages in the same file and match the pattern).

    For the startup no-crash test, assert BOTH `code === 0` AND `stderr` does NOT match `/TypeError/i` — this is the direct witness of the regression being closed.

    **Step C — Run the full xci test suite:**
    ```bash
    cd packages/xci && npm test -- --run
    ```
    All tests must pass. Baseline from quick-260421-g99 was 499+ tests; new tests should bring it to 503+.

    Commit as a single unit (one commit for code + tests + any regenerated tsbuildinfo).
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci/packages/xci && npm test -- --run 2>&1 | tail -40</automated>
  </verify>
  <done>
    - `cli.ts:177` and `cli.ts:240` no longer call `.join` unconditionally on `def.in`.
    - `grep -n "def\.in\.join" packages/xci/src/cli.ts` returns ONLY matches guarded by `Array.isArray(def.in)` (ideally via the `inDisplay` ternary — no bare `def.in.join` calls remain).
    - 4 new regression tests exist in `cli.e2e.test.ts` with `quick-260421-hnr` in their names.
    - `cd packages/xci && npm test -- --run` passes with 0 failures; test count is 503+ (was 499+).
    - No other source file modified besides `cli.ts` + the e2e test file.
    - `git diff --stat` shows exactly 2 files changed (plus possibly `tsconfig.tsbuildinfo` artifacts, which are acceptable noise).
  </done>
</task>

</tasks>

<verification>
1. **Type-narrowing correctness:** Read the final cli.ts:175-181 and cli.ts:238-243 ranges. Confirm both use `Array.isArray(def.in)` to narrow before `.join`. Confirm the string branch emits the raw string (no brackets).

2. **Test suite green:**
   ```bash
   cd /home/developer/projects/loci/packages/xci && npm test -- --run
   ```
   Expect: 0 failures, test count >= 503.

3. **Direct reproduction of the original crash is now impossible:** The 3rd regression test (startup no-crash) provides this witness — it registers a string-form `for_each` alias and invokes a completely unrelated alias `hello`. If the fix were incomplete, commander's `.addHelpText('after', buildAliasHelpText(...))` at cli.ts:357 would throw during registration and `hello` would never run.

4. **Array-form unchanged:** Test 4 guards against over-fixing — bracketed format must be preserved byte-for-byte as `[a, b, c]`.

5. **Scope discipline:** `git diff --name-only` must show only `packages/xci/src/cli.ts` and `packages/xci/src/__tests__/cli.e2e.test.ts` (and any auto-generated `tsbuildinfo`). No other files.
</verification>

<success_criteria>
- xci no longer crashes at startup when `.xci/commands.yml` contains a `for_each` alias with `in: "${VAR}"`.
- `xci <alias> --list` and `xci <alias> --help` work for both string-form and array-form `for_each.in`.
- String form displays as raw placeholder (`in: ${VAR}`); array form displays as `in: [a, b, c]` (unchanged).
- 4 new e2e regression tests pass.
- Full xci test suite green (>= 503 tests, 0 failures).
- Exactly 2 source files modified (cli.ts + cli.e2e.test.ts).
- Single commit.
</success_criteria>

<output>
After completion, create `.planning/quick/260421-hnr-fix-typeerror-in-cli-ts-when-for-each-in/260421-hnr-01-SUMMARY.md` documenting:
- The two lines changed in cli.ts (with before/after snippets).
- The 4 regression tests added.
- Final test count (before: 499+, after: 503+).
- Confirmation that the startup registration path is now crash-free for string-form `for_each.in`.
</output>
