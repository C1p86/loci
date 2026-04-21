---
phase: quick-260421-ewq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/types.ts
  - packages/xci/src/commands/normalize.ts
  - packages/xci/src/resolver/index.ts
  - packages/xci/src/resolver/params.ts
  - packages/xci/src/executor/output.ts
  - packages/xci/src/commands/__tests__/commands.test.ts
  - packages/xci/src/resolver/__tests__/resolver.test.ts
  - packages/xci/README.md
autonomous: true
requirements:
  - quick-260421-ewq
must_haves:
  truths:
    - "A user can write `for_each.in: \"${VAR}\"` (a scalar string containing a placeholder) and normalize accepts it without error."
    - "At resolve time the placeholder expands from config/CLI values, the result is CSV-split on `,`, entries are trimmed, empty entries are dropped, and the remaining values drive the loop iterations."
    - "Existing `for_each.in: [\"a\", \"b\"]` array syntax continues to work unchanged."
    - "A scalar `for_each.in` without any `${...}` placeholder is rejected at normalize time with a CMD_SCHEMA error."
    - "If the interpolated CSV string contains no usable entries after split+trim+filter, the resolver throws a CommandSchemaError with a message including `empty after CSV split`."
    - "`validateParams` recognises placeholders inside a string-form `for_each.in`, so a missing `${VAR}` surfaces as a MissingParamsError before execution."
    - "`printRunHeader`'s variables block shows the vars referenced by a string-form `for_each.in`."
  artifacts:
    - path: "packages/xci/src/types.ts"
      provides: "Updated CommandDef for_each shape: `readonly in: readonly string[] | string`"
      contains: "readonly in: readonly string[] | string"
    - path: "packages/xci/src/commands/normalize.ts"
      provides: "Accepts string-form for_each.in containing ${...}, rejects bare strings and non-string/non-array types"
    - path: "packages/xci/src/resolver/index.ts"
      provides: "CSV-splits interpolated for_each.in string into iteration values; throws on empty result"
    - path: "packages/xci/src/resolver/params.ts"
      provides: "Scans string-form for_each.in for ${...} placeholders during param validation"
    - path: "packages/xci/src/executor/output.ts"
      provides: "printRunHeader's placeholder scan handles string-form for_each.in"
    - path: "packages/xci/src/commands/__tests__/commands.test.ts"
      provides: "normalize-level tests for string-form for_each.in (accept + reject cases)"
    - path: "packages/xci/src/resolver/__tests__/resolver.test.ts"
      provides: "resolver-level tests for CSV split, trim, empty-filter, empty-after-split error, parallel-mode path"
    - path: "packages/xci/README.md"
      provides: "For-Each Loop section documents the new `in: \"${VAR}\"` form with a CLI invocation example"
  key_links:
    - from: "packages/xci/src/resolver/index.ts (both for_each branches)"
      to: "packages/xci/src/resolver/interpolate.ts (interpolateArgv / interpolateArgvLenient)"
      via: "single-element array round-trip: interpolateArgv([def.in], aliasName, values)[0]"
      pattern: "interpolateArgv(\\[def\\.in\\]|interpolateArgvLenient\\(\\[def\\.in\\]"
    - from: "packages/xci/src/resolver/params.ts (for_each branch)"
      to: "extractFromArgv helper"
      via: "extractFromArgv([def.in]) when typeof def.in === 'string'"
      pattern: "typeof def\\.in === 'string'"
    - from: "packages/xci/src/executor/output.ts (collectReferencedPlaceholders)"
      to: "scanString / scanArray helpers"
      via: "branch on typeof def.in"
      pattern: "typeof def\\.in === 'string'"
---

<objective>
Extend the `for_each.in` field so it accepts either the existing array of strings OR a single scalar string containing a `${VAR}` placeholder. At resolve time, the placeholder is interpolated and the resulting string is CSV-split (split on `,`, trimmed, empties filtered) to produce the iteration values. This lets a user feed a dynamic list through a CLI param or config value without having to pre-expand it in YAML.

Purpose: unblock `for_each: { in: "${regions}" }` style usage so CI/DX flows can pass a CSV list from the command line (`xci deploy-fleet regions=eu-west-1,us-east-1`) without editing `commands.yml` per-run.

Output: `for_each.in` supports both forms end-to-end (normalize -> param validation -> resolver -> run header), backed by new tests in the existing `commands.test.ts` and `resolver.test.ts` suites, and documented in the README.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@packages/xci/CLAUDE.md

<!-- Only the files this plan touches or directly consumes. No unrelated summaries. -->

<interfaces>
<!-- Extracted from current codebase. Executor should use these exactly. -->

From `packages/xci/src/types.ts` (current shape — to be modified):
```ts
| {
    readonly kind: 'for_each';
    readonly var: string;
    readonly in: readonly string[];          // <- change to: readonly string[] | string
    readonly mode: 'steps' | 'parallel';
    readonly cmd?: readonly string[];
    readonly run?: string;
    readonly description?: string;
    readonly failMode?: 'fast' | 'complete';
    readonly params?: Readonly<Record<string, ParamDef>>;
  }
```

From `packages/xci/src/resolver/interpolate.ts`:
```ts
export function interpolateArgv(
  argv: readonly string[],
  aliasName: string,
  values: Readonly<Record<string, string>>,
): readonly string[];

export function interpolateArgvLenient(
  argv: readonly string[],
  values: Readonly<Record<string, string>>,
): readonly string[];
```
Both accept `readonly string[]`. To interpolate a single string `s`, call with `[s]` and take index `[0]`.

From `packages/xci/src/errors.ts`:
```ts
export class CommandSchemaError extends CommandError { constructor(aliasName: string, message: string, ...) }
```
`CommandSchemaError` is the error the resolver and normalizer already throw for for_each shape problems.

From `packages/xci/src/resolver/params.ts` (current for_each branch at lines 184-189):
```ts
case 'for_each':
  if (def.cmd) trackUsage(extractFromArgv(def.cmd));
  if (def.run && commands.has(def.run)) {
    collectAll(def.run, commands, declared, usedBy, depth + 1, false);
  }
  break;
```
`extractFromArgv(readonly string[])` already exists in this file (line 87). Feed `[def.in]` to scan a single string.

From `packages/xci/src/executor/output.ts` (current for_each branch in `collectReferencedPlaceholders` at ~line 188-192):
```ts
case 'for_each':
  if (def.cmd) scanArray(def.cmd);
  if (def.run) scanString(def.run);
  for (const v of def.in) scanString(v);     // <- this iterates strings; breaks if def.in is a string
  break;
```
`def.in` iteration currently assumes array; after the type change we must branch on `typeof def.in === 'string'` and call `scanString(def.in)` instead.

From `packages/xci/src/dsl/validate.ts` (line 57):
```ts
if (def.kind === 'for_each') {
  return def.run ? [def.run] : [];
}
```
Only touches `def.run`, never `def.in`. No change required here — verify and move on.
</interfaces>

<!-- Full source references for the executor to open -->
@packages/xci/src/types.ts
@packages/xci/src/commands/normalize.ts
@packages/xci/src/resolver/index.ts
@packages/xci/src/resolver/params.ts
@packages/xci/src/resolver/interpolate.ts
@packages/xci/src/executor/output.ts
@packages/xci/src/dsl/validate.ts
@packages/xci/src/commands/__tests__/commands.test.ts
@packages/xci/src/resolver/__tests__/resolver.test.ts
@packages/xci/README.md
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Allow string-form for_each.in across types, normalize, resolver, params, and output</name>
  <files>
    packages/xci/src/types.ts,
    packages/xci/src/commands/normalize.ts,
    packages/xci/src/resolver/index.ts,
    packages/xci/src/resolver/params.ts,
    packages/xci/src/executor/output.ts
  </files>
  <behavior>
    Normalize:
    - `for_each.in: ["a", "b"]` -> accepted, stored as-is (existing behavior).
    - `for_each.in: "${VAR}"` -> accepted, stored as the original string (no coercion).
    - `for_each.in: "plain-string-no-placeholder"` -> CommandSchemaError: `for_each.in as string must reference a variable via ${...}`.
    - `for_each.in: 123` | `null` | `{ obj: true }` -> CommandSchemaError: `for_each.in must be an array of strings OR a "${var}" placeholder string`.

    Resolver (both branches — resolveToStepsLenient for_each at ~line 87 and resolveAlias for_each at ~line 200):
    - If `Array.isArray(def.in)` -> iterate `def.in` as today.
    - Else (string form):
      - Interpolate the single string with the same helper the branch already uses for `def.cmd`:
        - Lenient branch (`resolveToStepsLenient`): `interpolateArgvLenient([def.in], config.values)[0]`.
        - Strict branch (`resolveAlias`): `interpolateArgv([def.in], aliasName, config.values)[0]`.
      - CSV-split the interpolated result: `split(',').map(v => v.trim()).filter(v => v.length > 0)`.
      - If the resulting array is empty, throw `new CommandSchemaError(aliasName, \`for_each.in resolved from "${def.in}" is empty after CSV split\`)`.
      - Iterate the resulting string[] the same way the array form already iterates.

    Params:
    - In `collectAll`'s `for_each` branch (line 184), after the existing `if (def.cmd) trackUsage(extractFromArgv(def.cmd));`, add: `if (typeof def.in === 'string') trackUsage(extractFromArgv([def.in]));`.

    Output (collectReferencedPlaceholders in `executor/output.ts`, `for_each` case at ~line 188):
    - Replace `for (const v of def.in) scanString(v);` with:
      `if (typeof def.in === 'string') { scanString(def.in); } else { for (const v of def.in) scanString(v); }`.

    dsl/validate.ts:
    - Open the file, confirm `collectExplicitRefs` only touches `def.run` for `for_each`, and make NO change.
  </behavior>
  <action>
    Implement the above. Concrete edits:

    1) `packages/xci/src/types.ts` (~line 85):
       - Change `readonly in: readonly string[];` to `readonly in: readonly string[] | string;`.
       - Update the inline comment to: `// values to iterate over — array of strings OR a single "${VAR}" placeholder (CSV-split at resolve time)`.

    2) `packages/xci/src/commands/normalize.ts` (for_each branch, current lines 208-215 and the object-construction at 246-256):
       - Replace
         ```ts
         if (!Array.isArray(fe.in)) {
           throw new CommandSchemaError(aliasName, 'for_each.in must be an array of values');
         }
         for (const v of fe.in) {
           if (typeof v !== 'string') {
             throw new CommandSchemaError(aliasName, 'for_each.in must contain only strings');
           }
         }
         ```
         with a three-way branch:
         ```ts
         let inField: readonly string[] | string;
         if (Array.isArray(fe.in)) {
           for (const v of fe.in) {
             if (typeof v !== 'string') {
               throw new CommandSchemaError(aliasName, 'for_each.in must contain only strings');
             }
           }
           inField = fe.in as readonly string[];
         } else if (typeof fe.in === 'string') {
           if (!/\$\{[^}]+\}/.test(fe.in)) {
             throw new CommandSchemaError(aliasName, 'for_each.in as string must reference a variable via ${...}');
           }
           inField = fe.in;
         } else {
           throw new CommandSchemaError(aliasName, 'for_each.in must be an array of strings OR a "${var}" placeholder string');
         }
         ```
       - In the returned object, change `in: fe.in as string[]` to `in: inField`.

    3) `packages/xci/src/resolver/index.ts`:
       - At the top of the file (after the existing helpers), add a module-local helper:
         ```ts
         /** CSV-split helper for string-form for_each.in: split on ',', trim, drop empties. */
         function csvSplit(s: string): string[] {
           return s.split(',').map((v) => v.trim()).filter((v) => v.length > 0);
         }
         ```
       - In `resolveToStepsLenient`'s `case 'for_each'` (currently around lines 87-101):
         - Before the `for (const value of def.in)` loop, compute:
           ```ts
           const values: readonly string[] = Array.isArray(def.in)
             ? def.in
             : (() => {
                 const resolved = interpolateArgvLenient([def.in], config.values)[0] ?? '';
                 const split = csvSplit(resolved);
                 if (split.length === 0) {
                   throw new CommandSchemaError(
                     aliasName,
                     `for_each.in resolved from "${def.in}" is empty after CSV split`,
                   );
                 }
                 return split;
               })();
           ```
         - Replace the loop header with `for (const value of values) { ... }`.
       - In `resolveAlias`'s `case 'for_each'` (currently lines 200-238 — BOTH the parallel branch at 204-220 and the sequential branch at 225-236):
         - Before each `for (const value of def.in)` loop, compute the same `values` binding but with STRICT interpolation:
           ```ts
           const values: readonly string[] = Array.isArray(def.in)
             ? def.in
             : (() => {
                 const resolved = interpolateArgv([def.in], aliasName, config.values)[0] ?? '';
                 const split = csvSplit(resolved);
                 if (split.length === 0) {
                   throw new CommandSchemaError(
                     aliasName,
                     `for_each.in resolved from "${def.in}" is empty after CSV split`,
                   );
                 }
                 return split;
               })();
           ```
         - Replace the loop header with `for (const value of values) { ... }` in both parallel and sequential branches.
         - Note: If the IIFE pattern feels noisy, inline a `let values: readonly string[];` + `if/else` block before the loop — behaviour must be identical. Don't extract a shared helper across the two files/branches unless it collapses cleanly; duplication of ~6 lines is acceptable.

    4) `packages/xci/src/resolver/params.ts`, `collectAll` `case 'for_each'` (lines 184-189):
       - After `if (def.cmd) trackUsage(extractFromArgv(def.cmd));`, add on the next line:
         `if (typeof def.in === 'string') trackUsage(extractFromArgv([def.in]));`

    5) `packages/xci/src/executor/output.ts`, `collectReferencedPlaceholders` `case 'for_each'` (lines 188-192):
       - Replace `for (const v of def.in) scanString(v);` with:
         ```ts
         if (typeof def.in === 'string') {
           scanString(def.in);
         } else {
           for (const v of def.in) scanString(v);
         }
         ```

    6) `packages/xci/src/dsl/validate.ts`:
       - Open the file. Confirm that `collectExplicitRefs` for `for_each` only returns `[def.run]` (current line 57-58). No edit.

    Constraints:
    - DO NOT introduce a new interpolation helper — reuse `interpolateArgv` / `interpolateArgvLenient` from `./interpolate.js`, already imported in `resolver/index.ts`.
    - DO NOT add new npm dependencies.
    - Preserve the existing array-form code path byte-for-byte (no behavioural drift for existing configs).
    - The error message for the empty-after-split case MUST contain the literal substring `empty after CSV split` so tests and users can grep for it.
    - The error message for the no-placeholder scalar case MUST contain the literal substring `${...}` (unicode curly braces) so users understand the fix.
    - Secrets handling is unchanged: values flow through existing `redactArgv`/`redactSecrets` paths without modification.

    Do NOT create any new test files in this task — tests live in Task 2. Do NOT touch the README.

    After edits, run:
    ```bash
    cd packages/xci && npx tsc --noEmit
    cd packages/xci && npx vitest run --no-coverage
    ```
    Both must pass green (existing tests must not regress; no new tests expected at this stage).
  </action>
  <verify>
    <automated>cd packages/xci &amp;&amp; npx tsc --noEmit &amp;&amp; npx vitest run --no-coverage</automated>
  </verify>
  <done>
    - `types.ts` declares `readonly in: readonly string[] | string`.
    - `normalize.ts` accepts both forms, rejects bare strings and non-string/non-array.
    - Both for_each branches in `resolver/index.ts` CSV-split a string `def.in` after interpolation, using the SAME existing interpolation helpers already in scope, and throw `CommandSchemaError` with `empty after CSV split` when the split yields zero entries.
    - `resolver/params.ts` `for_each` branch scans `def.in` for placeholders when it's a string.
    - `executor/output.ts` `collectReferencedPlaceholders` branches on `typeof def.in === 'string'`.
    - `dsl/validate.ts` is unchanged (verified only).
    - `npx tsc --noEmit` clean.
    - Full existing vitest suite still green (no new tests added yet).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add tests for string-form for_each.in (normalize + resolver)</name>
  <files>
    packages/xci/src/commands/__tests__/commands.test.ts,
    packages/xci/src/resolver/__tests__/resolver.test.ts
  </files>
  <behavior>
    commands.test.ts — new `describe('for_each.in — string form', ...)`:
    - Accepts array form (`in: ["a", "b"]`) and normalizes it unchanged (regression guard).
    - Accepts string form `in: "${AwsLocations}"` without error; normalized `def.in` is the literal string `"${AwsLocations}"`.
    - Rejects `in: "plain-string-no-placeholder"` with `CommandSchemaError` whose message contains `${...}`.
    - Rejects `in: 123`, `in: null`, and `in: { obj: true }` with `CommandSchemaError` whose message contains `array of strings OR`.

    resolver.test.ts — new `describe('resolver — for_each string in', ...)`:
    - Sequential (`mode: steps`) with `in: "${AwsLocations}"` and `values: { AwsLocations: "eu-west-1,us-east-1" }` -> resulting plan is `kind: 'sequential'` with `steps.length === 2`, and each step's argv contains the corresponding region in place of `${region}`.
    - Trim + empty-filter: `values: { AwsLocations: " a , , b " }` -> 2 steps, argv contains `a` and `b` (not ` a ` / empty).
    - Empty after split: `values: { X: " , , " }`, `in: "${X}"` -> resolver throws `CommandSchemaError` with message matching `/empty after CSV split/`.
    - Parallel (`mode: parallel`) with `in: "${AwsLocations}"` and `values: { AwsLocations: "eu-west-1,us-east-1" }` -> plan is `kind: 'parallel'` with `group.length === 2` and failMode `'fast'` (default).
    - Placeholder undefined (no `AwsLocations` provided, no captured var, no loop var): calling `resolver.resolve` throws `UndefinedPlaceholderError` (surfaces the missing var cleanly via the strict `interpolateArgv` path).

    Do NOT add a printRunHeader test — keep this plan tight. The output-layer change is covered transitively by the existing run-header tests staying green.
  </behavior>
  <action>
    1) Append new tests to `packages/xci/src/commands/__tests__/commands.test.ts` at the end of the file (inside the file's top-level scope, after the last `describe`).

    Example structure to follow (match the existing YAML-driven tmpDir style):
    ```ts
    describe('for_each.in — string form', () => {
      it('accepts array form unchanged', async () => {
        writeCommands(
          'deploy:\n' +
          '  for_each:\n' +
          '    var: region\n' +
          '    in: ["a", "b"]\n' +
          '    cmd: ["echo", "${region}"]\n'
        );
        const result = await commandsLoader.load(tmpDir);
        const def = result.get('deploy');
        expect(def).toMatchObject({ kind: 'for_each', in: ['a', 'b'] });
      });

      it('accepts string form with ${...} placeholder', async () => {
        writeCommands(
          'deploy:\n' +
          '  for_each:\n' +
          '    var: region\n' +
          '    in: "${AwsLocations}"\n' +
          '    cmd: ["echo", "${region}"]\n'
        );
        const result = await commandsLoader.load(tmpDir);
        const def = result.get('deploy');
        expect(def).toMatchObject({ kind: 'for_each', in: '${AwsLocations}' });
      });

      it('rejects scalar string without any ${...} placeholder', async () => {
        writeCommands(
          'deploy:\n' +
          '  for_each:\n' +
          '    var: region\n' +
          '    in: "plain-string"\n' +
          '    cmd: ["echo", "${region}"]\n'
        );
        await expect(commandsLoader.load(tmpDir)).rejects.toThrow(CommandSchemaError);
        await expect(commandsLoader.load(tmpDir)).rejects.toThrow(/\$\{\.\.\.\}/);
      });

      it.each([
        ['number', '    in: 123\n'],
        ['null',   '    in: null\n'],
        ['object', '    in:\n      obj: true\n'],
      ])('rejects non-array non-string for_each.in (%s)', async (_label, inBlock) => {
        writeCommands(
          'deploy:\n' +
          '  for_each:\n' +
          '    var: region\n' +
          inBlock +
          '    cmd: ["echo", "${region}"]\n'
        );
        await expect(commandsLoader.load(tmpDir)).rejects.toThrow(CommandSchemaError);
        await expect(commandsLoader.load(tmpDir)).rejects.toThrow(/array of strings OR/);
      });
    });
    ```
    Notes:
    - `CommandSchemaError` is already imported at the top of `commands.test.ts`.
    - The `tmpDir` fixture and `writeCommands` helper are already defined at the top of the file — reuse them.
    - Do not change existing tests.

    2) Append new tests to `packages/xci/src/resolver/__tests__/resolver.test.ts` at the end of the file.

    Build a small `CommandMap` and `ResolvedConfig` in-memory (no YAML loading — keep these tests fast and isolated):
    ```ts
    describe('resolver — for_each with string in (CSV-split)', () => {
      function makeConfig(values: Record<string, string>): ResolvedConfig {
        return { values, provenance: {}, secretKeys: new Set() };
      }
      function makeMap(def: CommandDef, alias = 'deploy'): CommandMap {
        return new Map([[alias, def]]);
      }

      it('sequential mode: CSV-splits interpolated string into 2 steps', () => {
        const def: CommandDef = {
          kind: 'for_each',
          var: 'region',
          in: '${AwsLocations}',
          mode: 'steps',
          cmd: ['echo', '${region}'],
        };
        const plan = resolver.resolve('deploy', makeMap(def), makeConfig({ AwsLocations: 'eu-west-1,us-east-1' }));
        expect(plan.kind).toBe('sequential');
        if (plan.kind !== 'sequential') throw new Error('unreachable');
        expect(plan.steps).toHaveLength(2);
        // First step is a cmd-step (no kind tag or kind==='cmd'), argv ends with region token
        const s0 = plan.steps[0]!;
        const s1 = plan.steps[1]!;
        expect('argv' in s0 && s0.argv).toEqual(['echo', 'eu-west-1']);
        expect('argv' in s1 && s1.argv).toEqual(['echo', 'us-east-1']);
      });

      it('trims whitespace and drops empty entries', () => {
        const def: CommandDef = {
          kind: 'for_each',
          var: 'region',
          in: '${AwsLocations}',
          mode: 'steps',
          cmd: ['echo', '${region}'],
        };
        const plan = resolver.resolve('deploy', makeMap(def), makeConfig({ AwsLocations: ' a , , b ' }));
        if (plan.kind !== 'sequential') throw new Error('unreachable');
        expect(plan.steps).toHaveLength(2);
        const s0 = plan.steps[0]!;
        const s1 = plan.steps[1]!;
        expect('argv' in s0 && s0.argv).toEqual(['echo', 'a']);
        expect('argv' in s1 && s1.argv).toEqual(['echo', 'b']);
      });

      it('throws when CSV split yields zero entries', () => {
        const def: CommandDef = {
          kind: 'for_each',
          var: 'region',
          in: '${X}',
          mode: 'steps',
          cmd: ['echo', '${region}'],
        };
        expect(() =>
          resolver.resolve('deploy', makeMap(def), makeConfig({ X: ' , , ' })),
        ).toThrow(/empty after CSV split/);
      });

      it('parallel mode: CSV-splits into group entries with default failMode fast', () => {
        const def: CommandDef = {
          kind: 'for_each',
          var: 'region',
          in: '${AwsLocations}',
          mode: 'parallel',
          cmd: ['echo', '${region}'],
        };
        const plan = resolver.resolve('deploy', makeMap(def), makeConfig({ AwsLocations: 'eu-west-1,us-east-1' }));
        expect(plan.kind).toBe('parallel');
        if (plan.kind !== 'parallel') throw new Error('unreachable');
        expect(plan.group).toHaveLength(2);
        expect(plan.failMode).toBe('fast');
        expect(plan.group[0]?.argv).toEqual(['echo', 'eu-west-1']);
        expect(plan.group[1]?.argv).toEqual(['echo', 'us-east-1']);
      });

      it('throws UndefinedPlaceholderError when the referenced var is missing', () => {
        const def: CommandDef = {
          kind: 'for_each',
          var: 'region',
          in: '${AwsLocations}',
          mode: 'steps',
          cmd: ['echo', '${region}'],
        };
        expect(() =>
          resolver.resolve('deploy', makeMap(def), makeConfig({})),
        ).toThrow(UndefinedPlaceholderError);
      });
    });
    ```

    Notes:
    - `resolver`, `CommandDef`, `CommandMap`, `ResolvedConfig`, `CommandSchemaError`, `UndefinedPlaceholderError` are all already imported at the top of `resolver.test.ts` — verify and add any missing import.
    - If the sequential step shape differs from assumed (e.g., `kind: 'cmd'` vs untagged), read the existing assertions in `resolver.test.ts` for the pattern used on regular sequential plans and match that style. The authoritative shape is in `types.ts` `SequentialStep`: the cmd-variant has no `kind` OR `kind === 'cmd'`, and always has `argv`. Use `'argv' in step` or `step.kind !== 'ini' && step.kind !== 'set'` to narrow.
    - Do not change existing tests.

    After appending tests, run:
    ```bash
    cd packages/xci && npx vitest run --no-coverage
    ```
    Confirm ALL tests green (new + old).
  </action>
  <verify>
    <automated>cd packages/xci &amp;&amp; npx vitest run --no-coverage</automated>
  </verify>
  <done>
    - `commands.test.ts` contains 4 new test cases (array-form regression, string-form accept, no-placeholder reject, non-string/non-array reject via `it.each`).
    - `resolver.test.ts` contains 5 new test cases (sequential split, trim + empty filter, empty-after-split error, parallel mode, undefined placeholder).
    - Full xci vitest suite is green.
    - No other files touched.
  </done>
</task>

<task type="auto">
  <name>Task 3: Document the string-form for_each.in in the README</name>
  <files>packages/xci/README.md</files>
  <action>
    In `packages/xci/README.md`, locate the `### For-Each Loop` section (starts around line 221). After the existing two examples (`deploy-all` with `mode: parallel` and `build-all` / `build-single`), add a new sub-example BEFORE the closing of the section (i.e., before `### Split Commands Across Files`).

    Add this block:

    ```markdown
    You can also pass the list dynamically via a CLI param or config value. The string must contain at least one `${...}` placeholder; at resolve time it is CSV-split on `,`, entries are trimmed, and empties are dropped.

    ```yaml
    # Dynamic list via CLI param or config — CSV string split at resolve time
    deploy-fleet:
      for_each:
        var: region
        in: "${regions}"
        mode: steps
        cmd: ["aws", "deploy", "--region", "${region}"]
    ```

    ```bash
    xci deploy-fleet regions=eu-west-1,us-east-1,ap-northeast-1
    ```
    ```

    Do not rewrite the existing examples. Do not reflow unrelated sections. Do not renumber headings.

    After editing, do a quick sanity check: open the file and confirm the new block sits inside the `### For-Each Loop` section and the triple-backtick fences are balanced (README uses nested code fences — open with ` ```yaml ` / ` ```bash ` and close with ` ``` `).
  </action>
  <verify>
    <automated>cd packages/xci &amp;&amp; test -f README.md &amp;&amp; grep -q 'CSV string split at resolve time' README.md &amp;&amp; grep -q 'xci deploy-fleet regions=eu-west-1' README.md</automated>
  </verify>
  <done>
    - `README.md` has a new example under `### For-Each Loop` showing `in: "${regions}"` with a matching CLI invocation.
    - The short explanatory sentence mentions CSV split, trim, and empty-drop semantics.
    - No unrelated sections were reflowed or renumbered.
  </done>
</task>

</tasks>

<verification>
Phase-level verification:

1. Typecheck clean:
   ```bash
   cd packages/xci && npx tsc --noEmit
   ```
2. All xci tests green (existing + new):
   ```bash
   cd packages/xci && npx vitest run --no-coverage
   ```
3. Backwards-compat smoke: run any existing for_each-based fixture (none in test suite, but the typecheck + existing normalize tests with `in: [...]` arrays cover this).
4. README contains the new example block and CLI invocation line.
</verification>

<success_criteria>
- `for_each.in` accepts both `readonly string[]` and a `${...}`-bearing string in the TypeScript type, in normalize, in resolver (both branches), in params validation, and in run-header placeholder scanning.
- A user running `xci deploy-fleet regions=eu-west-1,us-east-1` against an alias with `for_each: { var: region, in: "${regions}", cmd: [...] }` gets two iterations, one per region.
- Empty-after-split and no-placeholder-in-string cases produce clear `CommandSchemaError`s with grep-friendly messages.
- The full xci vitest suite is green; no existing test was modified.
- The README's For-Each Loop section documents the new form with a runnable example.
</success_criteria>

<output>
After completion, create `.planning/quick/260421-ewq-allow-for-each-in-to-accept-a-var-placeh/260421-ewq-SUMMARY.md`.
</output>
