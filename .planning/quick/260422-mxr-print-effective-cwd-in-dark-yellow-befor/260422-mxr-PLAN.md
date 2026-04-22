---
phase: quick-260422-mxr
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/executor/sequential.ts
  - packages/xci/src/executor/output.ts
  - packages/xci/src/executor/__tests__/output.test.ts
  - packages/xci/src/resolver/__tests__/resolver.test.ts
autonomous: true
requirements:
  - quick-260422-mxr
must_haves:
  truths:
    - "Every sequential cmd step prints '  cwd: <effective-cwd>' on stderr BEFORE the run:/raw: lines, regardless of whether step.cwd was explicitly set"
    - "The cwd preview line uses dark yellow (SGR 33 / YELLOW constant), not bright yellow (SGR 93 / BRIGHT_YELLOW) — honors user's literal 'giallo scuro' request and visually distinguishes pre-step preview from run-header banner"
    - "printStepPreview output.test.ts suite still passes with the single BRIGHT_YELLOW→YELLOW assertion update (5/5 cwd-preview tests green, 37/37 overall)"
    - "Resolver outputs step.cwd as authored: leaf inherits outer's cwd through a middle alias that has no cwd of its own (3-level inheritance)"
    - "When middle alias declares its own cwd, it overrides outer's cwd for downstream leaf steps"
    - "for_each without its own cwd inherits outer sequential's cwd for every iteration (both run-mode and inline-cmd mode)"
    - "for_each with its own cwd overrides outer sequential's cwd"
    - "No changes to resolver/index.ts, cwd.ts, types.ts, parallel.ts, single.ts, or printRunHeader — verification-only additions"
  artifacts:
    - path: "packages/xci/src/executor/sequential.ts"
      provides: "Sequential executor always passing effective spawn cwd to printStepPreview"
      contains: "cwd: stepSpawnCwd"
    - path: "packages/xci/src/executor/output.ts"
      provides: "printStepPreview emitting cwd line in YELLOW (not BRIGHT_YELLOW)"
      contains: "const yellow = useColor ? YELLOW : ''"
    - path: "packages/xci/src/executor/__tests__/output.test.ts"
      provides: "Updated SGR 33 assertion for cwd color"
      contains: "\\x1b[33m  cwd: /abs/dir\\x1b[0m"
    - path: "packages/xci/src/resolver/__tests__/resolver.test.ts"
      provides: "5 new resolver scenarios covering nested sub-alias + for_each cwd inheritance"
      contains: "cwd inheritance — nested sub-aliases and for_each"
  key_links:
    - from: "packages/xci/src/executor/sequential.ts"
      to: "packages/xci/src/executor/output.ts"
      via: "printStepPreview call passing cwd: stepSpawnCwd unconditionally"
      pattern: "cwd:\\s*stepSpawnCwd"
    - from: "packages/xci/src/executor/output.ts printStepPreview"
      to: "YELLOW constant (SGR 33)"
      via: "dark-yellow wrap on cwd preview line"
      pattern: "useColor\\s*\\?\\s*YELLOW\\s*:"
    - from: "packages/xci/src/resolver/__tests__/resolver.test.ts new describe"
      to: "resolver.resolve nested cwd propagation"
      via: "assertion on plan.steps[i].cwd for 3-level inheritance + for_each variants"
      pattern: "cwd inheritance — nested sub-aliases and for_each"
---

<objective>
Two-part quick task that makes the effective spawn cwd visible before every sequential step and locks in nested cwd-inheritance behavior with regression tests.

Part 1 (feature): Every sequential cmd step must print its effective cwd in dark yellow (SGR 33 / YELLOW) on stderr BEFORE raw:/run:, regardless of whether step.cwd was explicitly set. Today the line appears only when step.cwd is defined, so inherited cwds (from parent alias) are invisible. We fix this by passing `step.cwd ?? cwd` unconditionally to printStepPreview AND switching the color from BRIGHT_YELLOW (SGR 93) to YELLOW (SGR 33) per user's explicit "giallo scuro" wording. This also creates visual distinction between the plan-preview banner (printRunHeader, still BRIGHT) and the about-to-execute line (now DARK).

Part 2 (verification): Add 5 resolver tests that verify cwd inheritance through nested sub-aliases and for_each. These are behavior-confirmation tests — we expect them to pass against current code since Phase quick-260421-g99 already wired `computeEffectiveCwd` + `parentCwd` plumbing. If any fails, that's a bug to surface, not fix in this task.

Purpose: Operators running `xci` with multi-level aliases need to see where each step will actually spawn; the resolver test additions are permanent regression guards preventing future refactors from silently breaking cwd plumbing.

Output:
- Modified sequential.ts (2-line move), output.ts (1-constant swap), output.test.ts (1-assertion update)
- New `describe('cwd inheritance — nested sub-aliases and for_each')` block with 5 tests in resolver.test.ts
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@packages/xci/src/executor/sequential.ts
@packages/xci/src/executor/output.ts
@packages/xci/src/executor/__tests__/output.test.ts
@packages/xci/src/resolver/index.ts
@packages/xci/src/resolver/__tests__/resolver.test.ts
@packages/xci/src/types.ts

<interfaces>
<!-- Key existing APIs executor must honor. Extracted from codebase; do NOT re-explore. -->

From packages/xci/src/executor/output.ts (lines 27-28):
```typescript
export const YELLOW = '\x1b[33m';          // dark yellow — target for this task
export const BRIGHT_YELLOW = '\x1b[93m';   // bright yellow — stays in printRunHeader
```

From packages/xci/src/executor/output.ts (signature, line 596-601):
```typescript
export function printStepPreview(
  rawArgv: readonly string[] | undefined,
  resolvedArgv: readonly string[],
  secretValues?: ReadonlySet<string>,
  options?: { verbose?: boolean; logFile?: string; cwd?: string },
): void
```
Contract unchanged. `cwd` is already optional and already gates both stderr and logFile emission; we just change the color constant inside the function.

From packages/xci/src/executor/sequential.ts (current state, lines 184-203):
```typescript
const mergedValues = { ...env, ...capturedVars };
const finalArgv = step.rawArgv ? interpolateArgv(...) : step.argv;

const stepCmd = displayLabel;
printStepHeader(stepCmd, stepNum, totalSteps);
printStepPreview(step.rawArgv, finalArgv, undefined, {
  verbose: env['XCI_VERBOSE'] === '1',
  logFile,
  ...(step.cwd !== undefined ? { cwd: step.cwd } : {}),  // <-- spread-if (nmx pattern)
});

const stepEnv = { ...env, ...capturedVars };
const stepSpawnCwd = step.cwd ?? cwd;                   // <-- declared AFTER preview
```

From packages/xci/src/resolver/index.ts (cwd plumbing — do NOT modify):
- `computeEffectiveCwd(def, config, parentCwd)` at line 55-64: own cwd wins, else parent
- `resolveToStepsLenient(..., parentCwd?: string)` at line 71-210: propagates effectiveCwd into sub-calls
- for_each in resolveToStepsLenient passes `effectiveCwd` both to def.run recursion (line 170) and to inline def.cmd step (line 179)
- `resolveAlias(..., parentCwd?: string)` at line 215+ does the same for top-level sequential/parallel/for_each

From packages/xci/src/types.ts:
```typescript
// SequentialStep (command variant): optional cwd?: string
// SequentialStep variants: { kind?: 'cmd' } | { kind: 'set', vars } | { kind: 'ini', ... }
// All variants may carry optional cwd.
```

From packages/xci/src/resolver/__tests__/resolver.test.ts — test helpers (already defined):
```typescript
function makeConfig(values = {}, secretKeys = []): ResolvedConfig { ... }
function makeCommands(defs: Record<string, CommandDef>): CommandMap { ... }
// Usage pattern from existing tests at line 662+:
const plan = resolver.resolve('pipe', makeCommands({...}), makeConfig());
if (plan.kind === 'sequential') { const step = plan.steps[0]; expect(step.cwd).toBe('a'); }
```

Existing cwd tests already cover 2-level inheritance (pipe→child). New tests add 3-level (outer→middle→leaf) + for_each variants.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Always surface effective cwd in dark yellow before every sequential step</name>
  <files>packages/xci/src/executor/sequential.ts, packages/xci/src/executor/output.ts, packages/xci/src/executor/__tests__/output.test.ts</files>
  <action>
Three tightly-coupled edits that together fix the "inherited cwd is invisible" bug AND honor user's literal "giallo scuro" request.

**Edit 1 — `packages/xci/src/executor/sequential.ts` (lines ~184-203):**

Move the `stepSpawnCwd` declaration UP to before the `printStepPreview` call, and pass it unconditionally (dropping the spread-if gate). Also delete the now-duplicate declaration further down.

Before:
```typescript
const mergedValues = { ...env, ...capturedVars };
const finalArgv = step.rawArgv
  ? interpolateArgv(step.rawArgv, '(step)', mergedValues)
  : step.argv;

const stepCmd = displayLabel;
printStepHeader(stepCmd, stepNum, totalSteps);
printStepPreview(step.rawArgv, finalArgv, undefined, {
  verbose: env['XCI_VERBOSE'] === '1',
  logFile,
  // quick-260421-nmx: surface effective cwd in yellow before the run: line
  // when set; spread-if pattern required by exactOptionalPropertyTypes.
  ...(step.cwd !== undefined ? { cwd: step.cwd } : {}),
});

// Merge captured variables into env for this step
const stepEnv = { ...env, ...capturedVars };
// quick-260421-g99: per-step cwd override (absolute when set by resolveAbsoluteCwds).
const stepSpawnCwd = step.cwd ?? cwd;
```

After:
```typescript
const mergedValues = { ...env, ...capturedVars };
const finalArgv = step.rawArgv
  ? interpolateArgv(step.rawArgv, '(step)', mergedValues)
  : step.argv;

// quick-260421-g99: per-step cwd override (absolute when set by resolveAbsoluteCwds).
// quick-260422-mxr: declared before printStepPreview so preview always shows
// the EFFECTIVE spawn cwd (own override or inherited/default), never hides it.
const stepSpawnCwd = step.cwd ?? cwd;

const stepCmd = displayLabel;
printStepHeader(stepCmd, stepNum, totalSteps);
printStepPreview(step.rawArgv, finalArgv, undefined, {
  verbose: env['XCI_VERBOSE'] === '1',
  logFile,
  cwd: stepSpawnCwd,
});

// Merge captured variables into env for this step
const stepEnv = { ...env, ...capturedVars };
```

Note: `cwd` is the executor-level default (the outer `run(plan, cwd, env, ...)` param). If the root invocation has no cwd, `cwd` will be process.cwd() at call site — already populated upstream. `stepSpawnCwd` is always defined (never undefined), so the `options.cwd` gate inside printStepPreview always triggers.

**Edit 2 — `packages/xci/src/executor/output.ts` `printStepPreview` (~line 615):**

Change the color constant used by the cwd line from `BRIGHT_YELLOW` to `YELLOW`. One-line swap.

Before:
```typescript
if (options?.cwd !== undefined) {
  const yellow = useColor ? BRIGHT_YELLOW : '';
  const yReset = useColor ? RESET : '';
  process.stderr.write(`${yellow}  cwd: ${options.cwd}${yReset}\n`);
}
```

After:
```typescript
if (options?.cwd !== undefined) {
  // quick-260422-mxr: dark yellow (SGR 33) per user's "giallo scuro" request;
  // printRunHeader keeps BRIGHT_YELLOW (SGR 93) so the banner stays distinct.
  const yellow = useColor ? YELLOW : '';
  const yReset = useColor ? RESET : '';
  process.stderr.write(`${yellow}  cwd: ${options.cwd}${yReset}\n`);
}
```

**IMPORTANT scope guardrails:**
- Do NOT remove the `BRIGHT_YELLOW` import — it's still used by `printRunHeader` further up in the same file.
- Do NOT touch the logFile branch (plain-text, no ANSI) — already correct.
- Do NOT rename constants.

**Edit 3 — `packages/xci/src/executor/__tests__/output.test.ts` line 532:**

Update the single ANSI-code assertion from SGR 93 to SGR 33.

Before:
```typescript
expect(joined).toContain('\x1b[93m  cwd: /abs/dir\x1b[0m');
```

After:
```typescript
expect(joined).toContain('\x1b[33m  cwd: /abs/dir\x1b[0m');
```

The other 4 tests in the `'printStepPreview — cwd preview'` describe block (lines 502-588) do not assert on specific SGR codes — they check plain-text ordering (`joined.indexOf('cwd:')`, `logFile` plain-text contents, NO_COLOR stripping). They must still pass after the color change without further edits. If any of them spuriously fails, re-read the test to confirm — do NOT weaken assertions.

No other files should change. Do not touch `printRunHeader`. Do not touch constants. Do not touch `cwd.ts`, `parallel.ts`, `single.ts`, `types.ts`.
  </action>
  <verify>
    <automated>cd packages/xci &amp;&amp; npx vitest run --no-coverage src/executor/__tests__/output.test.ts 2>&amp;1 | tail -20</automated>
  </verify>
  <done>
- `sequential.ts` passes `cwd: stepSpawnCwd` unconditionally (no spread-if); `stepSpawnCwd` declared once, before `printStepPreview`.
- `output.ts` `printStepPreview` uses `YELLOW` (SGR 33) for the cwd line; `BRIGHT_YELLOW` import retained for `printRunHeader`.
- `output.test.ts` line 532 asserts `\x1b[33m` (dark yellow).
- `npx vitest run src/executor/__tests__/output.test.ts` shows 37/37 passing (or whatever the current total is, unchanged — we only updated one assertion and no behavior changed for any test).
- `npx tsc --noEmit` (run from packages/xci) shows no new errors in src/executor/.
- No other file modified.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add 5 resolver regression tests for nested sub-alias + for_each cwd inheritance</name>
  <files>packages/xci/src/resolver/__tests__/resolver.test.ts</files>
  <action>
Append a new `describe('cwd inheritance — nested sub-aliases and for_each', () => { ... })` block AFTER the existing `'resolver — cwd field'` block (which ends around line 770 — put the new block right after it, before any trailing `describe` blocks, or at end of file if the cwd-field block is last). Use the existing `makeConfig` / `makeCommands` helpers defined at lines 204-217. Assert on `plan.steps[i].cwd` directly after narrowing `plan.kind === 'sequential'`.

The resolver outputs cwd as-authored (relative or ${placeholder}) — absolute-path conversion happens later in `resolveAbsoluteCwds` in cli.ts. These tests must NOT call `resolveAbsoluteCwds` and must NOT expect absolute paths.

**Scenario A — 3-level inheritance through middle sequential with no cwd:**
```typescript
it('leaf inherits outer sequential cwd through middle sequential that has no own cwd', () =&gt; {
  const commands = makeCommands({
    outer: { kind: 'sequential', steps: ['middle'], cwd: '/top' },
    middle: { kind: 'sequential', steps: ['leaf'] },
    leaf: { kind: 'single', cmd: ['echo', 'hi'] },
  });
  const plan = resolver.resolve('outer', commands, makeConfig());
  expect(plan.kind).toBe('sequential');
  if (plan.kind === 'sequential') {
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].cwd).toBe('/top');
  }
});
```

**Scenario B — middle cwd overrides outer:**
```typescript
it('middle sequential cwd overrides outer cwd for downstream leaf', () =&gt; {
  const commands = makeCommands({
    outer: { kind: 'sequential', steps: ['middle'], cwd: '/top' },
    middle: { kind: 'sequential', steps: ['leaf'], cwd: '/mid' },
    leaf: { kind: 'single', cmd: ['echo', 'hi'] },
  });
  const plan = resolver.resolve('outer', commands, makeConfig());
  expect(plan.kind).toBe('sequential');
  if (plan.kind === 'sequential') {
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].cwd).toBe('/mid');
  }
});
```

**Scenario C — for_each (run mode) inherits outer's cwd for every iteration:**
```typescript
it('for_each without own cwd inherits outer sequential cwd for each iteration (run mode)', () =&gt; {
  const commands = makeCommands({
    outer: { kind: 'sequential', steps: ['loop'], cwd: '/top' },
    loop: { kind: 'for_each', in: ['a', 'b'], var: 'x', run: 'leaf' },
    leaf: { kind: 'single', cmd: ['echo', '${x}'] },
  });
  const plan = resolver.resolve('outer', commands, makeConfig());
  expect(plan.kind).toBe('sequential');
  if (plan.kind === 'sequential') {
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].cwd).toBe('/top');
    expect(plan.steps[1].cwd).toBe('/top');
  }
});
```

**Scenario D — for_each with its own cwd overrides outer:**
```typescript
it('for_each with own cwd overrides outer sequential cwd', () =&gt; {
  const commands = makeCommands({
    outer: { kind: 'sequential', steps: ['loop'], cwd: '/top' },
    loop: { kind: 'for_each', in: ['a'], var: 'x', run: 'leaf', cwd: '/loop' },
    leaf: { kind: 'single', cmd: ['echo', 'hi'] },
  });
  const plan = resolver.resolve('outer', commands, makeConfig());
  expect(plan.kind).toBe('sequential');
  if (plan.kind === 'sequential') {
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].cwd).toBe('/loop');
  }
});
```

**Scenario E — for_each inline cmd inherits outer's cwd:**
```typescript
it('for_each inline cmd inherits outer sequential cwd', () =&gt; {
  const commands = makeCommands({
    outer: { kind: 'sequential', steps: ['loop'], cwd: '/top' },
    loop: { kind: 'for_each', in: ['a'], var: 'x', cmd: ['echo', '${x}'] },
  });
  const plan = resolver.resolve('outer', commands, makeConfig());
  expect(plan.kind).toBe('sequential');
  if (plan.kind === 'sequential') {
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].cwd).toBe('/top');
  }
});
```

**Type notes for executor:**
- `CommandDef` types for for_each require `var`, `in` (string or string[]), and either `run` OR `cmd`. Keep the schema shape EXACTLY as written above — do NOT add extra fields; the schema rejects unknowns.
- All 5 tests wrap assertions in `if (plan.kind === 'sequential') { ... }` narrowing — Drizzle-style pattern already used elsewhere in this file (see lines 306-313).
- Do NOT add `const originalPlatform = process.platform` platform stubs — these tests are OS-agnostic.
- Keep the new describe block cohesive and contiguous; do NOT split across the file.

**If any scenario FAILS:**
This is verification-only — the expected outcome is all 5 pass against current code. If even one fails, DO NOT modify resolver source. Instead, document the failing scenario in the SUMMARY with:
- Which test failed
- Actual vs expected `plan.steps[i].cwd`
- A minimal suggestion of where in resolver/index.ts the plumbing appears to miss propagation

The user will investigate separately. Do NOT attempt to fix resolver in this task — it violates scope.
  </action>
  <verify>
    <automated>cd packages/xci &amp;&amp; npx vitest run --no-coverage src/resolver/__tests__/resolver.test.ts 2>&amp;1 | tail -15</automated>
  </verify>
  <done>
- New `describe('cwd inheritance — nested sub-aliases and for_each')` block exists in resolver.test.ts.
- Contains exactly 5 new `it(...)` tests (Scenarios A through E above).
- `npx vitest run src/resolver/__tests__/resolver.test.ts` shows prior test count + 5 new, all passing (or clear failure report per "If any scenario FAILS" fallback documented in SUMMARY).
- `npx tsc --noEmit` from packages/xci shows no new errors in src/resolver/__tests__/.
- No changes to resolver/index.ts, types.ts, or any non-test file.
  </done>
</task>

</tasks>

<verification>
Run the full regression set from `packages/xci`:

```bash
cd packages/xci
npx vitest run --no-coverage src/executor/__tests__/output.test.ts
# expect: all green, 37/37 (1 assertion updated, no behavior change)

npx vitest run --no-coverage src/resolver/__tests__/resolver.test.ts
# expect: existing tests + 5 new = all green

npx vitest run --no-coverage src/executor src/resolver
# broader safety net — no regressions in neighbors

npx tsc --noEmit 2>&1 | grep -E "src/(executor|resolver)/" | wc -l
# expect: 0 (no new TypeScript errors)
```

All four must return green. The vitest broader sweep catches unexpected coupling; tsc grep catches exactOptionalPropertyTypes regressions from the spread-if removal.

Manual sanity check (optional — operator may run after merge):
```bash
# With a .loci/config.yml containing nested aliases where outer has cwd: ./sub,
# and leaf step has no cwd:
xci outer  # stderr should show '  cwd: /abs/path/to/sub' in DARK yellow before run:
```
</verification>

<success_criteria>
- ✓ sequential.ts passes effective spawn cwd unconditionally to printStepPreview
- ✓ output.ts printStepPreview cwd line uses YELLOW (SGR 33), not BRIGHT_YELLOW (SGR 93)
- ✓ output.test.ts assertion updated to `\x1b[33m`
- ✓ resolver.test.ts gains 5 new cwd-inheritance regression tests (scenarios A-E)
- ✓ All vitest suites green (executor + resolver)
- ✓ No new tsc errors
- ✓ No modifications to resolver/index.ts, cwd.ts, parallel.ts, single.ts, types.ts, or printRunHeader
- ✓ Existing quick-260421-nmx + quick-260421-g99 behavior preserved (inherited cwd still flows, explicit cwd still wins)
</success_criteria>

<output>
After completion, create `.planning/quick/260422-mxr-print-effective-cwd-in-dark-yellow-befor/260422-mxr-SUMMARY.md` summarizing:
1. The 4 files modified + line counts
2. Whether all 5 new resolver tests passed (the expected outcome) OR if any failed, which one and what the actual behavior was (surface as a follow-up concern)
3. Confirmation that tsc is clean and no unrelated tests broke
4. Total test count delta (+5 resolver tests expected; output.test.ts count unchanged)
</output>
