---
phase: quick-260421-lhg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/resolver/index.ts
  - packages/xci/src/resolver/__tests__/resolver.test.ts
autonomous: true
requirements:
  - quick-260421-lhg
tags: [for_each, placeholders, resolver, bugfix]

must_haves:
  truths:
    - "for_each with inline cmd produces steps whose rawArgv has the loop variable already substituted"
    - "for_each with run: sub-alias produces steps whose rawArgv has the loop variable already substituted"
    - "captured-var placeholders (${CapturedVar}) in rawArgv are preserved intact for runtime re-interpolation"
    - "Nested for_each loops correctly bake outer then inner loop variables into rawArgv"
    - "Non-for_each sequential steps still carry rawArgv with ${CapturedVar} placeholders intact (no regression)"
    - "xci aws-auto-upload-and-setup-fleet BuildVersion=260 AwsLocations=MINIMAL no longer throws INT_UNDEFINED_PLACEHOLDER at runtime for ${AwsLocation}"
  artifacts:
    - path: "packages/xci/src/resolver/index.ts"
      provides: "Post-substitution of loop variable into rawArgv of every for_each-produced step (4 call sites + 1 helper)"
      contains: "bakeLoopVarIntoRawArgv"
    - path: "packages/xci/src/resolver/__tests__/resolver.test.ts"
      provides: "Regression tests for loop-var-baking + captured-var preservation"
      contains: "rawArgv"
  key_links:
    - from: "packages/xci/src/resolver/index.ts (for_each branches)"
      to: "interpolateArgvLenient"
      via: "bakeLoopVarIntoRawArgv helper, single-entry substitution map {[def.var]: value}"
      pattern: "interpolateArgvLenient\\([^,]+, \\{ ?\\[.*\\]: ?value ?\\}"
    - from: "packages/xci/src/executor/sequential.ts:186-187"
      to: "step.rawArgv"
      via: "interpolateArgv(step.rawArgv, '(step)', mergedValues) — consumes the baked rawArgv at runtime; only captured/env placeholders remain"
      pattern: "interpolateArgv\\(step\\.rawArgv"
---

<objective>
Fix the bug where `for_each` loop variables survive into runtime `rawArgv`, causing
`executor/sequential.ts:186-187` to throw `UndefinedPlaceholderError` when it
re-interpolates `rawArgv` with only `env + capturedVars`.

The resolver already substitutes the loop variable into the plan-time `argv`
(visible in plan preview), but leaves `rawArgv` untouched at raw `${def.var}`.
Root cause: 4 code paths in `resolver/index.ts` build steps with `rawArgv` but
never pre-bake the loop-var placeholder into `rawArgv`.

Fix: introduce a small local helper `bakeLoopVarIntoRawArgv(steps, loopVar, value)`
that uses `interpolateArgvLenient(rawArgv, { [loopVar]: value })` to substitute
ONLY the loop variable while leaving all other placeholders (captured vars, env,
future loop vars) intact for runtime re-interpolation to resolve.

Apply to all 4 for_each branches that produce rawArgv-bearing steps:
1. Lenient `for_each` + `def.cmd` sub-branch (index.ts:145-153)
2. Lenient `for_each` + `def.run` sub-branch (index.ts:141-144)
3. Strict sequential `for_each` + `def.cmd` sub-branch (index.ts:339-347)
4. Strict sequential `for_each` + `def.run` sub-branch (index.ts:335-338)

Purpose: unblock `xci aws-auto-upload-and-setup-fleet BuildVersion=260 AwsLocations=MINIMAL`
and any other `for_each` alias whose inner steps reference captured variables alongside
the loop variable.

Output: one production fix + regression tests in the resolver test file.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260421-ewq-allow-for-each-in-to-accept-a-var-placeh/260421-ewq-SUMMARY.md

Key locations:
- packages/xci/src/resolver/index.ts (the buggy file — has two for_each branches, one in `resolveToStepsLenient` and one in `resolveAlias`)
- packages/xci/src/resolver/interpolate.ts (exports `interpolateArgvLenient` — THE helper we reuse; do NOT modify it)
- packages/xci/src/executor/sequential.ts:186-187 (consumer: `interpolateArgv(step.rawArgv, '(step)', mergedValues)` at runtime)
- packages/xci/src/types.ts (SequentialStep is a 3-way discriminated union; `set` and `ini` step kinds do NOT have rawArgv — only the default `kind?: 'cmd'` step does)
- packages/xci/src/resolver/__tests__/resolver.test.ts:442 (existing `describe('resolver — for_each with string in (CSV-split)', …)` block — add NEW describe block for the baking behavior; reuse `makeConfig` and `makeCommands` helpers at lines 204-217)

<interfaces>
<!-- Already exported from resolver/interpolate.ts — the single helper we compose with: -->
```typescript
export function interpolateArgvLenient(
  argv: readonly string[],
  values: Readonly<Record<string, string>>,
): readonly string[];
// Lenient: replaces known ${key} with values[key]; leaves unknown ${key} as-is.
// Perfect for single-variable baking: pass values={[loopVar]: loopValue} and
// only the loop var is substituted; all other placeholders (captured vars) pass through.
```

<!-- SequentialStep discriminated union (from types.ts). Only the default variant has rawArgv: -->
```typescript
export type SequentialStep =
  | { kind?: 'cmd'; label?: string; argv: readonly string[]; rawArgv?: readonly string[]; capture?: CaptureConfig; cwd?: string; breadcrumb?: readonly string[] }
  | { kind: 'ini'; /* … no rawArgv */ }
  | { kind: 'set'; /* … no rawArgv */ };
```

<!-- Existing test helpers (reuse, do not redefine) at resolver.test.ts:204-217: -->
```typescript
function makeConfig(values: Record<string, string> = {}, secretKeys: string[] = []): ResolvedConfig;
function makeCommands(defs: Record<string, CommandDef>): CommandMap;
```
</interfaces>

Prior art from quick-260421-ewq (the feature that introduced the bug): the same 4 branches
were widened to accept a `${VAR}` string `for_each.in`. That task did not consider rawArgv's
survival across runtime re-interpolation because no test exercised a captured var inside
a for_each step.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix resolver to bake loop variable into rawArgv in all 4 for_each branches</name>
  <files>packages/xci/src/resolver/index.ts</files>
  <behavior>
    Once this task is complete the following is true for every step produced by a `for_each`
    with inline `cmd` OR a `for_each` with `run: sub-alias`, in both lenient
    (`resolveToStepsLenient`) and strict sequential (`resolveAlias` kind==='for_each',
    mode==='steps') paths:
    - `step.rawArgv` has the loop variable `${def.var}` substituted with the current iteration value
    - `step.rawArgv` preserves any other `${...}` placeholder byte-for-byte (captured vars,
      env vars, future/outer loop vars — all passed through untouched)
    - Nested for_each: outer loop-var is baked first; when inner loop runs, inner's
      helper invocation bakes inner's var on top of the already-baked rawArgv

    Parallel mode (def.mode === 'parallel') is NOT modified — its group entries don't
    carry rawArgv. Non-for_each sequential steps keep existing rawArgv semantics (no regression).

    Edge cases to handle:
    - `set` and `ini` step kinds do NOT have rawArgv — the helper must skip them without mutation
    - A step with `rawArgv === undefined` is left unchanged
    - The helper must return a NEW array (do not mutate inputs) so the readonly contract holds
  </behavior>
  <action>
    Open `packages/xci/src/resolver/index.ts`.

    Step A — Add a module-local helper after the existing `csvSplit` function (around line 21,
    before `computeEffectiveCwd`). The helper MUST be module-scope (not inside a function)
    so both `resolveToStepsLenient` and `resolveAlias` can share it:

    ```typescript
    /**
     * Bake a single loop-variable placeholder into each step's rawArgv using lenient
     * interpolation. Known `${loopVar}` becomes `loopValue`; all other placeholders
     * (captured vars, env vars, outer loop vars) are preserved untouched so the
     * runtime executor can resolve them against env + capturedVars.
     *
     * Steps without rawArgv (`set`, `ini`, or command steps with rawArgv=undefined)
     * are returned unchanged. Returns a new array; never mutates input.
     */
    function bakeLoopVarIntoRawArgv(
      steps: readonly SequentialStep[],
      loopVar: string,
      loopValue: string,
    ): SequentialStep[] {
      return steps.map((s) => {
        // Narrow to the command variant: only that variant has rawArgv.
        // `kind: 'set'` and `kind: 'ini'` discriminants exclude it.
        if ((s.kind === undefined || s.kind === 'cmd') && s.rawArgv !== undefined) {
          return { ...s, rawArgv: interpolateArgvLenient(s.rawArgv, { [loopVar]: loopValue }) };
        }
        return s;
      });
    }
    ```

    Note: `interpolateArgvLenient` is already imported at the top of the file (line 9).
    `SequentialStep` is already imported from `../types.js` (line 8). No new imports.

    Step B — Patch the 4 for_each call sites. For each site, apply `bakeLoopVarIntoRawArgv`
    to the steps produced for the current iteration BEFORE pushing them into `allSteps`.

    Site 1: `resolveToStepsLenient` for_each + def.cmd branch (currently lines ~145-153).
    Change from:
    ```typescript
    } else if (def.cmd) {
      const argv = interpolateArgvLenient(def.cmd, loopValues);
      allSteps.push({
        argv,
        rawArgv: def.cmd,
        ...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {}),
        breadcrumb: [...chain],
      });
    }
    ```
    To (bake inline without going through the helper — simpler and avoids array alloc for 1 step):
    ```typescript
    } else if (def.cmd) {
      const argv = interpolateArgvLenient(def.cmd, loopValues);
      const bakedRawArgv = interpolateArgvLenient(def.cmd, { [def.var]: value });
      allSteps.push({
        argv,
        rawArgv: bakedRawArgv,
        ...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {}),
        breadcrumb: [...chain],
      });
    }
    ```

    Site 2: `resolveToStepsLenient` for_each + def.run branch (currently lines ~141-144).
    Change from:
    ```typescript
    if (def.run && commands.has(def.run)) {
      const loopConfig: ResolvedConfig = { ...config, values: loopValues };
      const subSteps = resolveToStepsLenient(def.run, commands, loopConfig, depth + 1, [...chain, def.run], effectiveCwd);
      for (const s of subSteps) allSteps.push(s);
    }
    ```
    To:
    ```typescript
    if (def.run && commands.has(def.run)) {
      const loopConfig: ResolvedConfig = { ...config, values: loopValues };
      const subSteps = resolveToStepsLenient(def.run, commands, loopConfig, depth + 1, [...chain, def.run], effectiveCwd);
      const baked = bakeLoopVarIntoRawArgv(subSteps, def.var, value);
      for (const s of baked) allSteps.push(s);
    }
    ```

    Site 3: `resolveAlias` for_each sequential-mode + def.cmd branch (currently lines ~339-347).
    Same shape as Site 1 — add `const bakedRawArgv = interpolateArgvLenient(def.cmd, { [def.var]: value });`
    and change `rawArgv: def.cmd` to `rawArgv: bakedRawArgv`.

    Site 4: `resolveAlias` for_each sequential-mode + def.run branch (currently lines ~335-338).
    Same shape as Site 2 — wrap subSteps in `bakeLoopVarIntoRawArgv(subSteps, def.var, value)`
    before the `for (const s of ...) allSteps.push(s);` loop.

    DO NOT touch:
    - Parallel for_each branch (lines ~299-328) — its group entries don't carry rawArgv
    - The non-for_each `sequential` case in either function
    - interpolateArgvLenient itself
    - The executor
    - Any step with `kind: 'set'` or `kind: 'ini'` (the helper handles them correctly by narrowing)

    Important typing note: the Site 2 / Site 4 for-loop previously was `for (const s of subSteps) allSteps.push(s);`
    where subSteps is `readonly SequentialStep[]`. After baking we push from a `SequentialStep[]` (mutable),
    which widens cleanly into the `SequentialStep[]` accumulator. No cast needed.

    Verify no new TypeScript errors. Do NOT "fix" pre-existing `exactOptionalPropertyTypes`
    errors in this file (documented baseline per quick-260421-ewq SUMMARY).
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci/packages/xci &amp;&amp; npx tsc --noEmit 2>&amp;1 | grep -E 'src/resolver/index\.ts' | tee /tmp/lhg-tsc.log; test $(wc -l &lt; /tmp/lhg-tsc.log) -le 4</automated>
    Baseline has exactly 4 lines of pre-existing errors in resolver/index.ts (from quick-260421-ewq SUMMARY: lines 75-80 with exactOptionalPropertyTypes). Target ≤ 4 lines ensures no new errors added. If baseline has drifted, cross-check against `git stash && npx tsc --noEmit 2>&1 | grep -E 'src/resolver/index\.ts' | wc -l && git stash pop`.
  </verify>
  <done>
    - bakeLoopVarIntoRawArgv exists as module-local helper in resolver/index.ts
    - All 4 for_each branches (2 in resolveToStepsLenient, 2 in sequential mode of resolveAlias) now produce steps whose rawArgv has the loop variable substituted
    - Parallel for_each branch untouched (verified by diff scope)
    - `npx tsc --noEmit` introduces no new errors relative to pre-change baseline
    - Lint/format pass: `npx biome check packages/xci/src/resolver/index.ts` (run explicitly if needed)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add regression tests for loop-var baking and captured-var preservation</name>
  <files>packages/xci/src/resolver/__tests__/resolver.test.ts</files>
  <behavior>
    Add a new top-level `describe` block near the existing
    `describe('resolver — for_each with string in (CSV-split)', …)` at line 442
    (append the new block AFTER it, before the `describe('resolver — cwd field', …)` block):

      `describe('resolver — for_each bakes loop variable into rawArgv (runtime re-interpolation fix)', () => { ... })`

    Tests to include:

    1. **for_each with inline `cmd` — regression test for rawArgv baking.**
       A sequential-mode for_each whose `cmd` references BOTH `${region}` (loop var) and
       `${FleetId}` (simulating a captured var by leaving it unresolved in config values).
       Config provides `region` (nothing, since loop var is not in config) and NO `FleetId`.
       Use `in: ['eu-west-1', 'us-east-1']` (array form, not the `${VAR}` form — this isolates
       the rawArgv-baking concern from the CSV-split code path).

       Assertions on `plan.steps[0]` and `plan.steps[1]`:
       - `argv` is fully resolved for loop var AND still has `${FleetId}` preserved (lenient plan-time pass)
       - `rawArgv` has loop var substituted AND still has `${FleetId}` preserved ← THE NEW GUARANTEE

       Concrete expected values for step 0 with `cmd: ['deploy', '--region', '${region}', '--fleet', '${FleetId}']`:
         - `argv` → `['deploy', '--region', 'eu-west-1', '--fleet', '${FleetId}']`
         - `rawArgv` → `['deploy', '--region', 'eu-west-1', '--fleet', '${FleetId}']`

       Use `expect(...).toEqual([...])` — precise, not "does not throw".

    2. **for_each with `run:` sub-alias — regression test.**
       Two commands in the map:
       - `'deploy-one'`: kind: 'single', cmd: `['deploy', '--region', '${region}', '--fleet', '${FleetId}']`
       - `'deploy-all'`: kind: 'for_each', var: 'region', in: ['eu-west-1', 'us-east-1'], mode: 'steps', run: 'deploy-one'

       Resolve `'deploy-all'` with config providing neither `region` nor `FleetId`.
       Assert that `plan.steps[0].rawArgv` has `region` substituted to 'eu-west-1' AND
       `${FleetId}` still intact. Same assertion for `plan.steps[1]` with 'us-east-1'.

    3. **Non-for_each baseline — no regression.**
       A plain sequential alias whose `cmd` references `${FleetId}` (captured-var placeholder).
       Resolve with config providing no `FleetId`. Assert:
       - `plan.steps[0].rawArgv` still contains `'${FleetId}'` intact.
       - `plan.steps[0].argv` still contains `'${FleetId}'` intact (lenient pass leaves it).

       This guards against any unintended widening of the bake into non-for_each paths.

    4. **End-to-end runtime chain simulation.**
       Take the plan from test 1 (for_each with cmd), grab `plan.steps[0].rawArgv`, and feed it
       to `interpolateArgv(rawArgv, '(step)', { FleetId: 'fleet-abc' })`. Assert the result is
       `['deploy', '--region', 'eu-west-1', '--fleet', 'fleet-abc']`. This proves the
       executor will succeed at runtime: loop-var already baked, captured var filled at runtime,
       no UndefinedPlaceholderError.

    5. **Nested for_each (bonus — outer bakes first, inner bakes on top).**
       Two commands:
       - `'inner'`: kind: 'for_each', var: 'env', in: ['dev', 'prod'], mode: 'steps',
         cmd: `['deploy', '--region', '${region}', '--env', '${env}', '--fleet', '${FleetId}']`
       - `'outer'`: kind: 'for_each', var: 'region', in: ['eu', 'us'], mode: 'steps', run: 'inner'

       Resolve `'outer'` (no FleetId in config). Expect 4 steps. Verify `rawArgv` on each:
       - step 0: region=eu, env=dev, FleetId preserved → `['deploy', '--region', 'eu', '--env', 'dev', '--fleet', '${FleetId}']`
       - step 1: region=eu, env=prod → `['deploy', '--region', 'eu', '--env', 'prod', '--fleet', '${FleetId}']`
       - step 2: region=us, env=dev → `['deploy', '--region', 'us', '--env', 'dev', '--fleet', '${FleetId}']`
       - step 3: region=us, env=prod → `['deploy', '--region', 'us', '--env', 'prod', '--fleet', '${FleetId}']`

    Use the existing `makeConfig` and `makeCommands` helpers at lines 204-217 — do NOT redefine.
    Use the same import style as the rest of the file (`import { resolver } from '../index.js'`,
    `import { interpolateArgv } from '../interpolate.js'` — already imported at the top).

    All 5 tests must pass on the fixed code. Run them against the pre-fix code ONLY if you
    want to confirm red→green (optional; bake-fix is in Task 1).
  </behavior>
  <action>
    Open `packages/xci/src/resolver/__tests__/resolver.test.ts`.

    Locate the closing `});` of the `describe('resolver — for_each with string in (CSV-split)', …)`
    block (the one starting at line 442, ending around line 534). Insert the new describe block
    IMMEDIATELY AFTER that closing `});` and BEFORE the `describe('resolver — cwd field', …)`
    block at line 540.

    New block skeleton (fill in the 5 tests per the behavior spec above):

    ```typescript
    /* ============================================================
     * resolver — for_each bakes loop variable into rawArgv
     * (regression test for quick-260421-lhg: runtime re-interpolation
     * was throwing UndefinedPlaceholderError for the loop var because
     * rawArgv retained the raw ${loopVar} placeholder)
     * ============================================================ */

    describe('resolver — for_each bakes loop variable into rawArgv (runtime re-interpolation fix)', () => {
      it('inline cmd: bakes loop var into rawArgv, preserves captured-var placeholder', () => {
        const def: CommandDef = {
          kind: 'for_each',
          var: 'region',
          in: ['eu-west-1', 'us-east-1'],
          mode: 'steps',
          cmd: ['deploy', '--region', '${region}', '--fleet', '${FleetId}'],
        };
        const plan = resolver.resolve('deploy-all', makeCommands({ 'deploy-all': def }), makeConfig({}));
        expect(plan.kind).toBe('sequential');
        if (plan.kind !== 'sequential') throw new Error('unreachable');
        expect(plan.steps).toHaveLength(2);
        const s0 = plan.steps[0];
        const s1 = plan.steps[1];
        if (!s0 || !s1) throw new Error('unreachable');
        // Both argv and rawArgv have loop var substituted; ${FleetId} survives untouched
        expect('argv' in s0 ? s0.argv : null).toEqual(['deploy', '--region', 'eu-west-1', '--fleet', '${FleetId}']);
        expect('rawArgv' in s0 ? s0.rawArgv : null).toEqual(['deploy', '--region', 'eu-west-1', '--fleet', '${FleetId}']);
        expect('argv' in s1 ? s1.argv : null).toEqual(['deploy', '--region', 'us-east-1', '--fleet', '${FleetId}']);
        expect('rawArgv' in s1 ? s1.rawArgv : null).toEqual(['deploy', '--region', 'us-east-1', '--fleet', '${FleetId}']);
      });

      it('run: sub-alias: bakes outer loop var into sub-step rawArgv, preserves captured-var placeholder', () => {
        const commands = makeCommands({
          'deploy-one': {
            kind: 'single',
            cmd: ['deploy', '--region', '${region}', '--fleet', '${FleetId}'],
          },
          'deploy-all': {
            kind: 'for_each',
            var: 'region',
            in: ['eu-west-1', 'us-east-1'],
            mode: 'steps',
            run: 'deploy-one',
          },
        });
        const plan = resolver.resolve('deploy-all', commands, makeConfig({}));
        if (plan.kind !== 'sequential') throw new Error('unreachable');
        expect(plan.steps).toHaveLength(2);
        const s0 = plan.steps[0];
        const s1 = plan.steps[1];
        if (!s0 || !s1) throw new Error('unreachable');
        expect('rawArgv' in s0 ? s0.rawArgv : null).toEqual(['deploy', '--region', 'eu-west-1', '--fleet', '${FleetId}']);
        expect('rawArgv' in s1 ? s1.rawArgv : null).toEqual(['deploy', '--region', 'us-east-1', '--fleet', '${FleetId}']);
      });

      it('non-for_each sequential step keeps ${CapturedVar} in rawArgv intact (no regression)', () => {
        const commands = makeCommands({
          'prep': {
            kind: 'sequential',
            steps: ['deploy --fleet ${FleetId}'],
          },
        });
        const plan = resolver.resolve('prep', commands, makeConfig({}));
        if (plan.kind !== 'sequential') throw new Error('unreachable');
        const s0 = plan.steps[0];
        if (!s0 || !('rawArgv' in s0)) throw new Error('unreachable');
        // rawArgv comes from tokenize('deploy --fleet ${FleetId}', ...)
        // — three tokens, last one unchanged ${FleetId}
        expect(s0.rawArgv).toEqual(['deploy', '--fleet', '${FleetId}']);
        expect('argv' in s0 ? s0.argv : null).toEqual(['deploy', '--fleet', '${FleetId}']);
      });

      it('end-to-end: baked rawArgv + captured vars at runtime produces final argv without throwing', () => {
        const def: CommandDef = {
          kind: 'for_each',
          var: 'region',
          in: ['eu-west-1'],
          mode: 'steps',
          cmd: ['deploy', '--region', '${region}', '--fleet', '${FleetId}'],
        };
        const plan = resolver.resolve('deploy-all', makeCommands({ 'deploy-all': def }), makeConfig({}));
        if (plan.kind !== 'sequential') throw new Error('unreachable');
        const s0 = plan.steps[0];
        if (!s0 || !('rawArgv' in s0) || s0.rawArgv === undefined) throw new Error('unreachable');
        // Simulate executor/sequential.ts:186-187
        const finalArgv = interpolateArgv(s0.rawArgv, '(step)', { FleetId: 'fleet-abc' });
        expect(finalArgv).toEqual(['deploy', '--region', 'eu-west-1', '--fleet', 'fleet-abc']);
      });

      it('nested for_each: outer then inner loop vars baked, captured var preserved', () => {
        const commands = makeCommands({
          'inner': {
            kind: 'for_each',
            var: 'env',
            in: ['dev', 'prod'],
            mode: 'steps',
            cmd: ['deploy', '--region', '${region}', '--env', '${env}', '--fleet', '${FleetId}'],
          },
          'outer': {
            kind: 'for_each',
            var: 'region',
            in: ['eu', 'us'],
            mode: 'steps',
            run: 'inner',
          },
        });
        const plan = resolver.resolve('outer', commands, makeConfig({}));
        if (plan.kind !== 'sequential') throw new Error('unreachable');
        expect(plan.steps).toHaveLength(4);
        const expected = [
          ['deploy', '--region', 'eu', '--env', 'dev', '--fleet', '${FleetId}'],
          ['deploy', '--region', 'eu', '--env', 'prod', '--fleet', '${FleetId}'],
          ['deploy', '--region', 'us', '--env', 'dev', '--fleet', '${FleetId}'],
          ['deploy', '--region', 'us', '--env', 'prod', '--fleet', '${FleetId}'],
        ];
        for (let i = 0; i < 4; i++) {
          const s = plan.steps[i];
          if (!s || !('rawArgv' in s)) throw new Error('unreachable');
          expect(s.rawArgv).toEqual(expected[i]);
        }
      });
    });
    ```

    Notes:
    - Use `'argv' in s0 ? s0.argv : null` and `'rawArgv' in s0 ? s0.rawArgv : null` patterns
      to narrow the `SequentialStep` union without `as` casts (matches surrounding test style
      at line 462-463).
    - Do NOT modify any existing test. Do NOT extract a shared helper just for these 5 tests —
      inline commands are fine (matches convention of the surrounding for_each CSV-split block).
    - `interpolateArgv` is already imported at line 10 — no new imports needed.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci/packages/xci &amp;&amp; npx vitest run --no-coverage src/resolver/__tests__/resolver.test.ts 2>&amp;1 | tail -30</automated>
    All 5 new tests in `describe('resolver — for_each bakes loop variable into rawArgv (runtime re-interpolation fix)', …)` pass. Pre-existing 456+ tests in the file stay green (no regression). The `packages/xci/src/__tests__/cold-start.test.ts` baseline failure from quick-260421-ewq is NOT in this test file, so the output should be 100% green for `resolver.test.ts`.
  </automated>
  </verify>
  <done>
    - New describe block added with exactly 5 `it(...)` blocks covering: inline cmd, run: sub-alias, non-for_each regression baseline, end-to-end runtime chain, nested for_each
    - All 5 tests pass via `npx vitest run --no-coverage src/resolver/__tests__/resolver.test.ts`
    - No other test modified
    - No `as` casts or other type-safety escapes added
    - `npx tsc --noEmit` on the test file introduces no new errors
  </done>
</task>

</tasks>

<verification>
Final phase-level checks after both tasks complete:

1. `cd packages/xci && npx vitest run --no-coverage src/resolver/__tests__/resolver.test.ts` — all tests pass (existing + 5 new).
2. `cd packages/xci && npx tsc --noEmit 2>&1 | grep -c "src/resolver/index.ts"` — count ≤ pre-change baseline (4 lines).
3. (Optional manual smoke) `xci aws-auto-upload-and-setup-fleet BuildVersion=260 AwsLocations=MINIMAL` no longer throws `INT_UNDEFINED_PLACEHOLDER: Undefined placeholder ${AwsLocation} in alias "(step)"`. Prefers captured `FleetId` resolves at runtime, loop var `AwsLocation` already baked at resolve time.

Scope guardrail verification (from bug_context):
- Prod fix limited to `packages/xci/src/resolver/index.ts` — diff grep-check: `git diff --name-only` lists only the 2 expected files.
- Parallel for_each branch untouched — `git diff packages/xci/src/resolver/index.ts` shows no changes between lines ~299-328.
- `interpolateArgvLenient` body unchanged — `git diff packages/xci/src/resolver/interpolate.ts` is empty.
- Executor untouched — `git diff packages/xci/src/executor/sequential.ts` is empty.
</verification>

<success_criteria>
- All 5 new regression tests pass on the fixed resolver.
- All pre-existing resolver tests remain green.
- TypeScript errors on `resolver/index.ts` ≤ pre-change baseline (no new errors).
- Runtime `xci aws-auto-upload-and-setup-fleet BuildVersion=260 AwsLocations=MINIMAL` progresses past the resolve stage without the `INT_UNDEFINED_PLACEHOLDER` for `${AwsLocation}`.
- Diff is minimal: 1 new helper + 4 call-site patches in `resolver/index.ts`, 1 new describe block with 5 `it` blocks in `resolver.test.ts`.
</success_criteria>

<output>
After completion, create `.planning/quick/260421-lhg-fix-for-each-loop-variable-lost-during-r/260421-lhg-SUMMARY.md`
</output>
