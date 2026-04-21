---
phase: quick-260421-kbl
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/types.ts
  - packages/xci/src/resolver/index.ts
  - packages/xci/src/resolver/__tests__/resolver.test.ts
  - packages/xci/src/executor/sequential.ts
  - packages/xci/src/executor/__tests__/sequential.test.ts
  - packages/xci/src/__tests__/cli.e2e.test.ts
  - packages/xci/README.md
autonomous: true
requirements:
  - quick-260421-kbl
user_setup: []

must_haves:
  truths:
    - "Running `xci A` where A -> [A1, A2] and A1 -> [A1a, A1b] prints step headers with full breadcrumb path: `▶ A > A1 > A1a [1/3]`, `▶ A > A1 > A1b [2/3]`, `▶ A > A2 [3/3]`."
    - "A top-level single alias (non-nested) still prints `▶ A [N/M]` — backward compatible."
    - "`xci A --from A1a` still matches by leaf name (existing behavior preserved) AND also matches by full path string `A > A1 > A1a`."
    - "Inline commands under a sequential alias inherit the containing chain (no synthetic extra segment)."
    - "`for_each` with `run: sub-alias` stamps each expanded step with breadcrumb including the sub-alias name."
    - "Parallel group entries carry a breadcrumb on the entry shape (stored for future display — parallel output is unchanged in v1)."
    - "No new npm deps; cold-start budget unchanged; v1 302-test baseline still green (503 passing post-260421-hnr)."
  artifacts:
    - path: "packages/xci/src/types.ts"
      provides: "SequentialStep variants + parallel group entry shape carry optional readonly breadcrumb?: readonly string[]"
      contains: "breadcrumb?"
    - path: "packages/xci/src/resolver/index.ts"
      provides: "breadcrumb attached at every step/entry emit site, derived from the in-flight `chain` array"
      contains: "breadcrumb:"
    - path: "packages/xci/src/executor/sequential.ts"
      provides: "step header prints `chain.join(' > ')` when breadcrumb non-empty; --from matches leaf OR full path"
      contains: "breadcrumb"
    - path: "packages/xci/README.md"
      provides: "Sequential Commands section documents the nested step-header breadcrumb"
      contains: "release > build > compile"
  key_links:
    - from: "packages/xci/src/resolver/index.ts"
      to: "packages/xci/src/types.ts (SequentialStep.breadcrumb)"
      via: "every step emit site spreads `breadcrumb: [...chain]` (or `[...chain, entry]` for parallel sub-alias entries)"
      pattern: "breadcrumb:\\s*\\[\\.\\.\\.chain"
    - from: "packages/xci/src/executor/sequential.ts"
      to: "step.breadcrumb"
      via: "displayLabel = step.breadcrumb && step.breadcrumb.length > 0 ? step.breadcrumb.join(' > ') : leafLabel"
      pattern: "breadcrumb.*join"
    - from: "packages/xci/src/executor/sequential.ts fromStep match"
      to: "leafLabel + displayLabel"
      via: "(leafLabel === fromStep || displayLabel === fromStep)"
      pattern: "=== fromStep"
---

<objective>
During execution of nested sequential / for_each aliases, show the FULL path of
containing alias names in each step header instead of only the leaf.

Before: `▶ A1a [1/3]`
After:  `▶ A > A1 > A1a [1/3]`

The scope note already provides a file-by-file spec. This plan turns it into 3
atomic tasks that preserve:
- retrocompat of `--from <leaf-name>`
- the v1 302-test baseline (now 503 passing post-260421-hnr)
- cold-start budget (no new deps; field is a plain readonly string array)
- parallel output unchanged in v1 (field stored on entries for future use)

Purpose: the operator always knows which containing step group is running when
xci expands nested sequential aliases, which is currently invisible.

Output:
- Type-level breadcrumb field on every SequentialStep variant and on parallel
  group entries.
- Resolver attaches `[...chain]` (or `[...chain, entry]` for parallel sub-alias
  entries) at every emit site.
- Sequential executor formats the breadcrumb in the step header and in
  `printStepResult`; --from accepts both leaf and full-path match.
- Regression + positive test coverage at resolver level, unit-level executor
  level, and real-binary e2e.
- README section documenting the feature.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@packages/xci/src/types.ts
@packages/xci/src/resolver/index.ts
@packages/xci/src/executor/sequential.ts
@packages/xci/src/executor/index.ts
@packages/xci/src/executor/output.ts
@packages/xci/src/executor/parallel.ts

<interfaces>
<!-- Key contracts executors must conform to. Extracted from the codebase. -->

## SequentialStep (packages/xci/src/types.ts, lines 118-138) — CURRENT

```ts
export type SequentialStep =
  | {
      readonly kind?: 'cmd';                    // default — omit for backward compat
      readonly label?: string;                  // alias name for display in step headers
      readonly argv: readonly string[];
      readonly rawArgv?: readonly string[];
      readonly capture?: CaptureConfig;
      readonly cwd?: string;
    }
  | {
      readonly kind: 'ini';
      readonly file: string;
      readonly mode: 'overwrite' | 'merge';
      readonly set?: Readonly<Record<string, Readonly<Record<string, string>>>>;
      readonly delete?: Readonly<Record<string, readonly string[]>>;
      readonly cwd?: string;
    }
  | {
      readonly kind: 'set';
      readonly vars: Readonly<Record<string, string>>;
    };
```

## Parallel group entry (types.ts lines 143-150, inside ExecutionPlan) — CURRENT

```ts
| {
    readonly kind: 'parallel';
    readonly group: readonly {
      readonly alias: string;
      readonly argv: readonly string[];
      readonly cwd?: string;
    }[];
    readonly failMode: 'fast' | 'complete';
  }
```

## Resolver signature (resolver/index.ts)

- `function resolveToStepsLenient(aliasName, commands, config, depth, chain: string[], parentCwd?)`
- `function resolveAlias(aliasName, commands, config, depth, chain: string[], parentCwd?)`
- Top entry: `resolver.resolve(aliasName, ...)` calls `resolveAlias(aliasName, ..., 0, [aliasName], undefined)`.
  => `chain` always starts with `[aliasName]` at depth 0, and recursive calls
     append the next hop before recursing, so `chain` at every emit site is the
     full containment path from root alias down to the current alias.

## Sequential executor hotspots (packages/xci/src/executor/sequential.ts)

- Lines 114-118: current `stepLabel` derivation (leaf-only).
- Line 121: current `--from` match against `stepLabel`.
- Lines 127-128: skipped-step header + result.
- Line 134 / 148: `set` step header + result use `'set'`.
- Lines 154-175: `ini` step header + result use `ini:<mode>` (label only).
- Line 186: `stepCmd = step.label ?? finalArgv[0] ?? '(unknown)'` — feeds `printStepHeader` at 187 and `printStepResult` at 203/218/227/231.

All of these call sites need the breadcrumb-aware display string.

## Executor dispatcher (packages/xci/src/executor/index.ts)

- Line 27 (single plan) prints `printStepHeader(cmdName)` — NO change in v1 (top-level single already covered by `printRunHeader`).
- Line 66 (ini plan) prints `printStepHeader(iniLabel)` — NO change in v1.
- Only `kind: 'sequential'` delegates to `runSequential` — that is where breadcrumb is consumed.

## printStepHeader / printStepResult (packages/xci/src/executor/output.ts)

```ts
export function printStepHeader(stepName: string, stepNum?: number, totalSteps?: number): void
export function printStepResult(stepName: string, exitCode: number, durationMs?: number, statusOverride?: string): void
```

Signatures accept any string — no output.ts change required.
</interfaces>

<notes>
- `packages/xci/src/tui/dashboard.ts` already derives its own label from
  `step.label ?? step.argv[0]` (line 221) — adding `breadcrumb` is additive and
  harmless; the dashboard ignores unknown properties.
- Baseline before this plan: 503 passing / 1 cold-start fail / 1 skip (post
  quick task 260421-hnr). We must not regress.
- No new npm deps. The new field is a `readonly string[]` — zero runtime cost
  beyond a spread at each emit site.
</notes>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add breadcrumb to SequentialStep + parallel entries, wire it through the resolver, extend resolver tests</name>
  <files>
    packages/xci/src/types.ts,
    packages/xci/src/resolver/index.ts,
    packages/xci/src/resolver/__tests__/resolver.test.ts
  </files>
  <behavior>
    Tests to add at the END of packages/xci/src/resolver/__tests__/resolver.test.ts (append — do NOT create a new file). Use the existing `makeCommands` / `makeConfig` helpers in that file.

    All tests belong in a new top-level describe block: `describe('resolver.resolve - breadcrumb (quick-260421-kbl)', () => { ... })`.

    Test 1: Nested sequential single chain
      - Commands: A1a {single ['echo','a1a']}, A1b {single ['echo','a1b']}, A2 {single ['echo','a2']},
        A1 {sequential steps:['A1a','A1b']}, A {sequential steps:['A1','A2']}.
      - plan = resolver.resolve('A', commands, config)
      - Expect plan.kind === 'sequential' AND plan.steps.length === 3
      - Expect plan.steps[0].breadcrumb to deep-equal ['A', 'A1', 'A1a']
      - Expect plan.steps[1].breadcrumb to deep-equal ['A', 'A1', 'A1b']
      - Expect plan.steps[2].breadcrumb to deep-equal ['A', 'A2']

    Test 2: Inline step inside a sub-sequential inherits the chain of the containing alias (no synthetic segment for the inline string)
      - Commands: A1 {sequential steps:['echo hi']}, A {sequential steps:['A1']}.
      - Expect plan.steps[0].breadcrumb to deep-equal ['A', 'A1']

    Test 3: Top-level sequential alias with only inline commands — breadcrumb is ['A'] (just the root)
      - Commands: A {sequential steps:['echo one','echo two']}.
      - Expect both steps[i].breadcrumb to deep-equal ['A']

    Test 4: Top-level SINGLE alias resolves to `{ kind: 'single' }` and does NOT get a breadcrumb field (the ExecutionPlan single variant is untouched)
      - Commands: A {single cmd:['echo','hi']}.
      - plan = resolver.resolve('A', commands, config)
      - Expect plan.kind === 'single'
      - Expect (plan as Record<string, unknown>).breadcrumb === undefined

    Test 5: for_each with `run: sub-alias` stamps breadcrumb including the sub-alias name
      - Commands: greet {single cmd:['echo','hello ${name}']},
        A {for_each var:'name', in:['alice','bob'], mode:'steps', run:'greet'}.
      - Expect plan.kind === 'sequential', 2 steps
      - Expect both steps[i].breadcrumb to deep-equal ['A', 'greet']

    Test 6: for_each with inline cmd (no run) — breadcrumb = chain down to the for_each alias only
      - Commands: A {for_each var:'n', in:['1','2'], mode:'steps', cmd:['echo','${n}']}.
      - Expect both steps[i].breadcrumb to deep-equal ['A']

    Test 7: Parallel group with a sub-alias entry — the entry carries breadcrumb ['A', 'lint']
      - Commands: lint {single cmd:['npm','run','lint']},
                  test: {single cmd:['npm','run','test']},
                  A {parallel group:['lint','test']}.
      - plan = resolver.resolve('A', commands, config)
      - Expect plan.kind === 'parallel'
      - Expect plan.group[0].breadcrumb to deep-equal ['A', 'lint']
      - Expect plan.group[1].breadcrumb to deep-equal ['A', 'test']

    Test 8: Parallel group with an inline entry — breadcrumb = ['A']
      - Commands: A {parallel group:['echo one','echo two']}.
      - Expect plan.group[0].breadcrumb to deep-equal ['A']
      - Expect plan.group[1].breadcrumb to deep-equal ['A']

    Test 9: Regression for the existing 'expands nested sequential alias steps inline' test — argv still resolves exactly as today (breadcrumb is ADDITIVE)
      - Use the same fixture as the test at line 349 of resolver.test.ts ('ci' -> 'checks' -> 'lint'+'test', plus 'npm run build' inline).
      - Existing assertions stay. Append: expect(plan.steps.map(s => s.breadcrumb)).toEqual([
          ['ci','checks','lint'],
          ['ci','checks','test'],
          ['ci'],
        ]);
  </behavior>
  <action>
    Step A — types.ts:

    1. Extend every branch of the `SequentialStep` union (lines 118-138) with:
       `readonly breadcrumb?: readonly string[]; // path of containing alias names, e.g. ["release","build","compile"]`
       Add to all three variants (cmd/argv-step, ini, set). Keep it optional.

    2. Extend the parallel group entry shape in ExecutionPlan (line 145-149) with the same field:
       `readonly breadcrumb?: readonly string[];`
       DO NOT add breadcrumb to `kind: 'single'` / `kind: 'ini'` ExecutionPlan variants — v1 only decorates sequential steps and parallel entries (printRunHeader covers top-level single/ini).

    Step B — resolver/index.ts. Attach `breadcrumb: [...chain]` at every step / entry emit site. `chain` is already threaded and, at the top-level entry `resolver.resolve`, is seeded with `[aliasName]`, so a top-level non-nested single alias naturally produces a length-1 breadcrumb.

    Edit sites — include the spread INSIDE the existing object literals next to `...(def.capture ? ...)` etc. so the TypeScript `readonly` inference stays happy:

    * `resolveToStepsLenient` case 'single' (~line 70): add `breadcrumb: [...chain],` before the spread properties.
    * `resolveToStepsLenient` case 'sequential' — inline command branch (~line 93): add `breadcrumb: [...chain],`.
      (Alias-ref branch at ~line 87 does a recursive call whose returned sub-steps already carry their own breadcrumb — do NOT overwrite.)
    * `resolveToStepsLenient` case 'sequential' — `set` emit (~line 86): add `breadcrumb: [...chain],`.
      (Must be in ALL three step variants so --from and display work uniformly.)
    * `resolveToStepsLenient` case 'parallel' inline entry (~line 113): add `breadcrumb: [...chain],`. For the alias-ref branch (~line 106) the recursive call returns sub-steps that already carry their own breadcrumb — do NOT overwrite.
    * `resolveToStepsLenient` case 'for_each' inline cmd (~line 144): add `breadcrumb: [...chain],`.
    * `resolveToStepsLenient` case 'ini' (~line 166): add `breadcrumb: [...chain],`.

    * `resolveAlias` case 'sequential' — `set` emit (~line 222): add `breadcrumb: [...chain],`.
    * `resolveAlias` case 'sequential' — inline command branch (~line 231): add `breadcrumb: [...chain],`.
      (Alias-ref branch at ~line 225 recurses into `resolveToStepsLenient` which stamps its own breadcrumbs — do NOT overwrite.)
    * `resolveAlias` case 'parallel' alias-ref entry (~line 246-258): when pushing the group entry after `resolveAlias(entry, ..., [...chain, entry], ...)`, add `breadcrumb: [...chain, entry],` on the pushed object. (The sub-plan itself is a single-kind ExecutionPlan which has no breadcrumb field — we stamp it at the PARALLEL entry level.)
    * `resolveAlias` case 'parallel' inline entry (~line 263-268): add `breadcrumb: [...chain],`.
    * `resolveAlias` case 'for_each' parallel-mode alias-ref entry (~line 298-308): add `breadcrumb: [...chain, def.run],`.
    * `resolveAlias` case 'for_each' parallel-mode inline cmd (~line 309-316): add `breadcrumb: [...chain],`.

    No changes to the sequential-mode branch of `resolveAlias` for_each (~line 321-338) — it delegates to `resolveToStepsLenient` for the sub-alias case (which stamps its own breadcrumbs) and emits inline cmds via the same pattern as `resolveToStepsLenient`; add `breadcrumb: [...chain],` to the inline emit at line 331-335.

    Step C — append the 9 resolver tests described in <behavior>. Use the EXISTING helpers at the top of resolver.test.ts (`makeCommands`, `makeConfig`). Do not create a new file.

    Verification after edits:
      pnpm --filter @xci/* exec tsc --noEmit  (type-check)
      pnpm --filter xci test -- --run packages/xci/src/resolver  (unit run)

    Do NOT touch executor/sequential.ts in this task — only types + resolver + resolver tests. That keeps this task atomic and reviewable.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci test -- --run src/resolver/__tests__/resolver.test.ts</automated>
  </verify>
  <done>
    - SequentialStep 3 variants AND parallel group entry shape have `readonly breadcrumb?: readonly string[]`.
    - Every resolver emit site touched above includes `breadcrumb: [...chain]` (or `[...chain, entry]` for parallel sub-alias entries in resolveAlias).
    - All 9 new resolver tests pass.
    - The existing resolver.test.ts tests still pass (argv/kind assertions unchanged — breadcrumb is additive).
    - `pnpm --filter xci test -- --run src/resolver` exits 0.
    - No new dependencies in packages/xci/package.json.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Render breadcrumb in sequential executor step header; accept --from against leaf OR full path; unit tests</name>
  <files>
    packages/xci/src/executor/sequential.ts,
    packages/xci/src/executor/__tests__/sequential.test.ts
  </files>
  <behavior>
    Append these tests to the existing describe('runSequential', ...) block in packages/xci/src/executor/__tests__/sequential.test.ts (do NOT create a new file).

    Test A: breadcrumb is printed in the step header when present and has length > 1
      - Steps: [{ argv: [process.execPath, '-e', 'process.exit(0)'], label: 'A1a', breadcrumb: ['A','A1','A1a'] }]
      - Spy on process.stderr.write
      - After runSequential(steps, process.cwd(), {}) expect at least one call whose first arg includes 'A > A1 > A1a'
      - Also expect NO call whose first arg is exactly `▶ A1a [1/1]\n` (pure leaf must not be printed)

    Test B: single-segment breadcrumb prints as the leaf (backward compat)
      - Steps: [{ argv: [process.execPath, '-e', 'process.exit(0)'], label: 'A', breadcrumb: ['A'] }]
      - Expect some stderr call containing '▶ A '
      - Expect NO stderr call containing ' > ' (no breadcrumb separator)

    Test C: breadcrumb absent — falls back to leaf label (true legacy path, for safety)
      - Steps: [{ argv: [process.execPath, '-e', 'process.exit(0)'], label: 'legacy-step' }]
      - Expect some stderr call containing '▶ legacy-step '

    Test D: --from matches by leaf name (regression)
      - Steps:
          s1: { argv: [execPath,'-e','process.exit(0)'], label: 'A1a', breadcrumb: ['A','A1','A1a'] }
          s2: { argv: [execPath,'-e','process.exit(0)'], label: 'A1b', breadcrumb: ['A','A1','A1b'] }
          s3: { argv: [execPath,'-e','process.exit(0)'], label: 'A2',  breadcrumb: ['A','A2'] }
      - runSequential(steps, cwd, {}, undefined, true, undefined, 'A1b')
      - Expect s1 appears as SKIPPED (check for '⊘' or 'SKIPPED' in stderr calls)
      - Expect s2 and s3 ran (no SKIPPED marker for them)

    Test E: --from matches by FULL BREADCRUMB PATH (new)
      - Same 3 steps as D
      - runSequential(steps, cwd, {}, undefined, true, undefined, 'A > A1 > A1b')
      - Expect s1 SKIPPED, s2 and s3 ran

    Test F: --from with unknown value skips everything (current behavior preserved)
      - Same 3 steps, pass fromStep: 'does-not-exist'
      - All three steps should be SKIPPED

    Use `vi.spyOn(process.stderr, 'write').mockImplementation(() => true)`, assert via `.mock.calls`, then `.mockRestore()` — mirror the pattern already in this file at lines 44-52.
  </behavior>
  <action>
    Edit packages/xci/src/executor/sequential.ts.

    1. Add a helper near the top of the `runSequential` function, or inline inside the loop:

       For each step, compute:
         - `leafLabel`:
             step.kind === 'ini' ? `ini:${step.mode}`
           : step.kind === 'set' ? 'set'
           : (step.label ?? step.argv[0] ?? '(unknown)')

         - `displayLabel`:
             step.breadcrumb && step.breadcrumb.length > 0
               ? step.breadcrumb.join(' > ')
               : leafLabel

       `displayLabel` replaces every use of the current `stepLabel` / `stepCmd` / `iniLabel` when the string is passed to `printStepHeader` and `printStepResult`.

       Note on single-segment breadcrumb: when breadcrumb has exactly one segment (e.g. `['A']`), `displayLabel === 'A'` which equals `leafLabel` for a single-step alias — backward compatible. (Test B in <behavior> guards this.)

    2. Replace the existing `stepLabel` calculation at lines 116-118 with the new `leafLabel` + `displayLabel` derivation. Keep `stepLabel` as a local name if you prefer — just make its value equal to `displayLabel`.

    3. Change the --from comparison at line 121 from
         `if (skipping && stepLabel === fromStep) { skipping = false; }`
       to
         `if (skipping && (leafLabel === fromStep || displayLabel === fromStep)) { skipping = false; }`

    4. Update every call site inside the loop to pass `displayLabel` to both `printStepHeader` and `printStepResult`:
       - line 127 `printStepHeader(stepLabel, ...)` → `printStepHeader(displayLabel, ...)`
       - line 128 `printStepResult(stepLabel, ...)` → `printStepResult(displayLabel, ...)`
       - line 134 `printStepHeader('set', ...)` → `printStepHeader(displayLabel, ...)`
       - line 148 `printStepResult('set', 0, 0)` → `printStepResult(displayLabel, 0, 0)`
       - line 155 `printStepHeader(iniLabel, ...)` → `printStepHeader(displayLabel, ...)`
       - line 171 `printStepResult(iniLabel, 0, ...)` → `printStepResult(displayLabel, 0, ...)`
       - line 174 `printStepResult(iniLabel, 1, ...)` → `printStepResult(displayLabel, 1, ...)`
       - Below line 186 replace `stepCmd` computation with `const stepCmd = displayLabel;` and leave downstream uses at lines 187/203/218/227/231 untouched (they all already pass `stepCmd`).

       Keep the semantics for SET and INI steps consistent: when an ini/set step has a breadcrumb, use the joined path; otherwise fall back to `ini:${mode}` / `set` as today.

    5. Append the 6 tests described in <behavior> to packages/xci/src/executor/__tests__/sequential.test.ts (inside the existing describe block). Reuse the `stderrSpy` pattern already at line 44.

    Do NOT touch executor/index.ts, executor/parallel.ts, or executor/output.ts — v1 leaves parallel display + printStepHeader signature untouched.

    Verification:
      pnpm --filter xci test -- --run src/executor
      pnpm --filter xci test  (full suite, ensure no regression)
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci test -- --run src/executor/__tests__/sequential.test.ts</automated>
  </verify>
  <done>
    - `displayLabel` derived from `step.breadcrumb` when present; `printStepHeader` and `printStepResult` receive `displayLabel` at every call site inside `runSequential`.
    - --from accepts both `leafLabel` and `displayLabel`.
    - All 6 new executor tests pass.
    - Full `pnpm --filter xci test` suite is green (no regression against 503-passing baseline).
    - Cold-start test still passes (no new deps, no new require-time work).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: E2E test with real CLI binary + README documentation</name>
  <files>
    packages/xci/src/__tests__/cli.e2e.test.ts,
    packages/xci/README.md
  </files>
  <behavior>
    E2E test (append to cli.e2e.test.ts, gated on `existsSync(CLI)` like existing tests in that file).

    Add one `describe` block at the end of the file: `describe('breadcrumb step headers (quick-260421-kbl)', () => { ... })`.

    Test: `shows full breadcrumb path in nested sequential step headers`
      - Use `createTempProject` to write a `.xci/commands.yml` with:

          A1a: { cmd: ['echo', 'a1a'] }
          A1b: { cmd: ['echo', 'a1b'] }
          A2:  { cmd: ['echo', 'a2']  }
          A1:  { steps: [A1a, A1b]    }
          A:   { steps: [A1, A2]      }

        (Use the same YAML patterns already used elsewhere in cli.e2e.test.ts — sequential uses `steps:` list, single uses `cmd:` array.)

      - Run `runCliInDir(dir, ['A'])`. Env already sets NO_COLOR=1 via `runCli` helper; use the same convention in `runCliInDir`.
      - Assert code === 0
      - Assert stderr contains 'A > A1 > A1a'
      - Assert stderr contains 'A > A1 > A1b'
      - Assert stderr contains 'A > A2'
      - Assert stderr does NOT contain a pure-leaf header line for the nested cases: e.g. no occurrence of `▶ A1a ` exact-match (breadcrumb replaces leaf entirely when chain length > 1).
      - Clean up the tempdir in afterEach (pattern already present in this file).

    If the CLI dist file is missing, skip the test with `describe.skipIf(!existsSync(CLI))` to match existing conditional patterns.

    README update (packages/xci/README.md):

    Locate the "Sequential Commands" section (grep for 'Sequential' heading). Add a short subsection (~4 lines) after the existing sequential example. Example content:

      #### Nested step headers

      When a sequential alias references other aliases that are themselves
      sequential (or `for_each`), xci shows the full containing path in every
      step header during execution. For example, running an alias `release`
      whose steps expand to `release > build > compile` displays:

      ```
      ▶ release > build > compile [1/5]
      ```

      So you always know which outer alias the current step belongs to. The
      `--from` flag accepts either the leaf name (`compile`) or the full path
      (`release > build > compile`) for resuming mid-sequence.

    Keep the tone consistent with the rest of the README (existing code fences use `sh` or plain triple-backtick). No emoji.
  </behavior>
  <action>
    Step A — E2E test:

    1. Open packages/xci/src/__tests__/cli.e2e.test.ts.
    2. Append the describe block at the very bottom of the file.
    3. Model the temp-project YAML on the existing E2E tests in the same file — use `writeFileSync(path, yamlString)` via `createTempProject` with the proper `.xci/commands.yml` key.

    IMPORTANT: the existing e2e test file uses the CLI at `dist/cli.mjs`. The build step is a prerequisite (first lines of the file). Guard with `describe.skipIf(!existsSync(CLI))` so the test is skipped, not failed, when the dev environment has not built.

    Step B — README:

    1. Open packages/xci/README.md.
    2. Grep for the "Sequential Commands" section heading.
    3. Add the subsection as described in <behavior>, formatted with the same Markdown conventions as surrounding content.

    Verification:
      pnpm --filter xci build
      pnpm --filter xci test -- --run src/__tests__/cli.e2e.test.ts

    Do NOT modify any other README sections or other documentation — scope-limited to the new nested-step-headers note.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci build && pnpm --filter xci test -- --run src/__tests__/cli.e2e.test.ts</automated>
  </verify>
  <done>
    - New e2e test under describe('breadcrumb step headers (quick-260421-kbl)') runs against real dist/cli.mjs and passes, OR is properly skipped when dist is missing.
    - stderr assertions confirm 'A > A1 > A1a', 'A > A1 > A1b', 'A > A2' all appear.
    - README.md has a new "Nested step headers" subsection under Sequential Commands that documents the breadcrumb display and `--from` leaf-or-full-path matching.
    - Full `pnpm --filter xci test` suite still green (no regressions on the 503-passing baseline).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user's `.xci/commands.yml` → loci resolver | alias names come from the project's own YAML; already trusted elsewhere in the pipeline |
| loci resolver → terminal stderr | breadcrumb string is written to the operator's own stderr; no network, no filesystem, no child process |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kbl-01 | Information Disclosure | resolver emits breadcrumb string to stderr | accept | breadcrumb contains alias NAMES ONLY (YAML-declared identifiers), never config values or secrets. No value interpolation into breadcrumb. Alias names are already visible in `printRunHeader`, dry-run output, and verbose traces — no new surface. |
| T-kbl-02 | Tampering | malicious alias name containing control characters (e.g. `"\u001b[31mA"`) could inject ANSI into step header via `chain.join(' > ')` | accept | The same string already flows through `printStepHeader` today via `step.label ?? step.argv[0]`. Loci is a developer tool run against the user's own `.xci/commands.yml`. If an attacker controls the commands.yml they already own the box. No new attack surface. |
| T-kbl-03 | Denial of Service | deeply nested aliases → huge chain → huge stderr line | mitigate | Depth cap of 10 is already enforced in the resolver (lines 52-57 and 189-194 of resolver/index.ts). Max breadcrumb length = 10 short alias names ≈ well under a single terminal line. No new guard needed. |
</threat_model>

<verification>
Run the full xci test suite. Baseline before this plan: 503 passing / 1 cold-start fail / 1 skip. After this plan the breakdown must be: 503 + 9 resolver + 6 executor + 1 e2e = 519 passing (or 503 + 15 unit = 518 passing when e2e is properly skipped for missing dist) / 1 cold-start fail / 1 skip (or 2 skip when e2e is gated).

- `pnpm --filter xci test` exits 0.
- `pnpm --filter xci typecheck` exits 0.
- `pnpm --filter xci build` succeeds — bundle size must not increase beyond noise (<1KB).
- `pnpm --filter xci hyperfine` (if present) — cold-start budget preserved.

Smoke: temp project with nested aliases → `xci A` → stderr shows `▶ A > A1 > A1a [1/3]`, `▶ A > A1 > A1b [2/3]`, `▶ A > A2 [3/3]`.
</verification>

<success_criteria>
- [ ] `SequentialStep` (all 3 variants) and parallel group entry shape have `readonly breadcrumb?: readonly string[]`.
- [ ] Every resolver emit site attaches `breadcrumb: [...chain]` (or `[...chain, entry]` for parallel sub-alias entries).
- [ ] sequential executor renders `displayLabel = breadcrumb.join(' > ')` when breadcrumb is non-empty, else the leaf label.
- [ ] `--from <leaf>` still works; `--from "A > A1 > A1a"` also works.
- [ ] 9 new resolver tests + 6 new sequential executor tests + 1 e2e test — all green.
- [ ] Baseline v1 303-test + 503-post-260421-hnr suite still green — zero regressions.
- [ ] README.md documents the nested-step-headers behavior.
- [ ] No new npm dependencies.
- [ ] Cold-start test still passes.
</success_criteria>

<output>
After completion, create `.planning/quick/260421-kbl-show-full-breadcrumb-a-a1-a1a-in-step-he/260421-kbl-SUMMARY.md` per the quick-task summary template.
</output>
