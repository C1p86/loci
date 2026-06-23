---
phase: quick-260623-ipz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/executor/nesting.ts
  - packages/xci/src/types.ts
  - packages/xci/src/resolver/index.ts
  - packages/xci/src/executor/xci-delegate.ts
  - packages/xci/src/executor/index.ts
  - packages/xci/src/executor/sequential.ts
  - packages/xci/src/executor/output.ts
  - packages/xci/src/executor/__tests__/nesting.test.ts
  - packages/xci/src/resolver/__tests__/resolver.test.ts
  - packages/xci/src/executor/__tests__/xci-delegate.test.ts
  - packages/xci/src/__tests__/cli.e2e.test.ts
  - packages/xci/README.md
  - .changeset/xci-breadcrumb-propagate.md
autonomous: true
requirements: [quick-260623-ipz]

must_haves:
  truths:
    - "When a kind:xci step delegates, the inner xci's step headers and run header show the FULL path from the original alias down to the current step (e.g. outerAlias > innerAlias > step), not a fresh restart."
    - "Propagation is automatic across N nesting levels because each level passes its OWN accumulated breadcrumb (already seeded from the incoming prefix) to the next."
    - "When XCI_BREADCRUMB is absent (no delegation), behavior is byte-identical to today: the intra-process breadcrumb a > a1 > a1a (quick-260421-kbl) is unchanged."
    - "A long incoming breadcrumb prefix never falsely trips the inner process's alias-nesting depth cap (max 10)."
    - "getBreadcrumbPrefix is a pure helper: absent/empty -> []; 'a > b' -> ['a','b']; whitespace/empty segments are filtered."
    - "Secrets are never logged; --dry-run still spawns nothing; --list/--help unchanged; XCI_NESTING_DEPTH + attenuation intact."
  artifacts:
    - path: "packages/xci/src/executor/nesting.ts"
      provides: "XCI_BREADCRUMB_ENV constant + pure getBreadcrumbPrefix() helper"
      contains: "getBreadcrumbPrefix"
    - path: "packages/xci/src/resolver/index.ts"
      provides: "resolve() seeds the chain with the incoming breadcrumb prefix; plan-level xci variant carries breadcrumb; depth-cap counts only post-seed segments"
      contains: "getBreadcrumbPrefix"
    - path: "packages/xci/src/executor/xci-delegate.ts"
      provides: "buildDelegateInvocation injects XCI_BREADCRUMB into childEnv from fields.breadcrumb"
      contains: "XCI_BREADCRUMB_ENV"
    - path: "packages/xci/src/executor/output.ts"
      provides: "printRunHeader renders the breadcrumb prefix before the alias"
      contains: "getBreadcrumbPrefix"
  key_links:
    - from: "packages/xci/src/executor/index.ts"
      to: "runXciDelegate"
      via: "passes plan.breadcrumb as fields.breadcrumb"
      pattern: "breadcrumb"
    - from: "packages/xci/src/executor/sequential.ts"
      to: "runXciDelegate"
      via: "passes step.breadcrumb as fields.breadcrumb"
      pattern: "breadcrumb"
    - from: "packages/xci/src/executor/xci-delegate.ts"
      to: "child process env"
      via: "XCI_BREADCRUMB = breadcrumb.join(' > ')"
      pattern: "XCI_BREADCRUMB"
    - from: "packages/xci/src/resolver/index.ts"
      to: "step.breadcrumb arrays"
      via: "chain seeded with getBreadcrumbPrefix()"
      pattern: "getBreadcrumbPrefix"
---

<objective>
Propagate the breadcrumb across the `xci` delegate boundary so the inner xci (and every
nested level) shows the FULL path from the original alias down to the current step/kind,
instead of restarting from scratch.

Today the breadcrumb rendered in step headers (`step.breadcrumb.join(' > ')` in
sequential.ts) and the run header (`▶ running: <alias>` in output.ts) is the resolver's
`chain`, seeded with `[aliasName]` at resolve(). When a `kind: xci` step delegates to
another project, the inner xci is a NEW process whose resolver re-seeds from scratch — the
breadcrumb resets and the user loses cross-process context.

Purpose: give the operator one continuous path across the whole (cross-process) execution.
Output: a new `XCI_BREADCRUMB` env var carries the OUTER's accumulated path into the inner;
the inner seeds its resolver chain with it; the run header renders it. Absent the env var
(no delegation), behavior is byte-identical to today.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- Key contracts the executor needs. Use these directly — no codebase exploration needed. -->

From packages/xci/src/executor/nesting.ts (existing — mirror its style for the new helper):
```typescript
export const XCI_NESTING_DEPTH_ENV = 'XCI_NESTING_DEPTH';
export function getNestingDepth(): number; // absent/empty -> 0, NaN -> 0, clamps negatives to 0
export function isNested(): boolean;       // getNestingDepth() > 0
```

From packages/xci/src/executor/xci-delegate.ts:
```typescript
export interface XciDelegateFields {
  readonly alias: string;
  readonly project?: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
}
export function buildDelegateInvocation(
  fields: XciDelegateFields,
  effectiveCwd: string,
  env: Record<string, string>,
  entryScript: string,
  outputFlag: '--log' | '--verbose',
): DelegateInvocation; // builds childEnv with [XCI_NESTING_DEPTH_ENV]: String(getNestingDepth()+1)
```

From packages/xci/src/resolver/index.ts:
```typescript
// resolveAlias(aliasName, commands, config, depth, chain, parentCwd?) — depth is tracked
//   SEPARATELY from chain (depth++ on each recursion). The depth-cap check is `if (depth > 10)`.
//   `chain` only feeds step.breadcrumb (= [...chain]) and the cap error MESSAGE (chain.join(' -> ')).
// resolver.resolve() entry point (≈L629):
resolve(aliasName, commands, config) {
  return resolveAlias(aliasName, commands, config, 0, [aliasName], undefined);
}
// The plan-level `case 'xci'` (≈L608-624) currently returns { kind:'xci', alias, project?, args?, cwd? }
//   with NO breadcrumb field. The SEQUENTIAL xci STEP path (≈L365-384) DOES set breadcrumb:[...chain].
```

From packages/xci/src/types.ts:
```typescript
// SequentialStep xci variant ALREADY has: readonly breadcrumb?: readonly string[];
// The ExecutionPlan xci variant (≈L247-253) does NOT — it has only kind/alias/project?/args?/cwd?.
//   This plan ADDS readonly breadcrumb?: readonly string[]; to that ExecutionPlan xci variant.
```

From packages/xci/src/executor/index.ts (`case 'xci'` ≈L183-212):
```typescript
// This branch runs when the TOP-LEVEL alias is itself kind:xci. It calls
//   runXciDelegate({ alias, project?, args?, cwd? }, cwd, env, undefined, logFile, show, tailLines, isVerboseXci).
```

From packages/xci/src/executor/sequential.ts (`if (step.kind === 'xci')` ≈L244-284):
```typescript
// step.breadcrumb is populated by the resolver. displayLabel = step.breadcrumb.join(' > ').
// It calls runXciDelegate({ alias, project?, args?, cwd? }, delegateCwd, stepEnv, ...).
```

From packages/xci/src/executor/output.ts (printRunHeader ≈L342, title line ≈L357):
```typescript
// process.stderr.write(`${bold}${cyan}▶ running: ${alias}${reset}\n`);
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add XCI_BREADCRUMB env + pure getBreadcrumbPrefix() helper, and seed the resolver chain with it (RED-first)</name>
  <files>
    packages/xci/src/executor/nesting.ts,
    packages/xci/src/executor/__tests__/nesting.test.ts,
    packages/xci/src/resolver/index.ts,
    packages/xci/src/resolver/__tests__/resolver.test.ts
  </files>
  <behavior>
    getBreadcrumbPrefix() unit (new nesting.test.ts):
    - process.env.XCI_BREADCRUMB absent -> returns []
    - '' (empty string) -> []
    - 'a > b' -> ['a','b']
    - 'a > b > c' -> ['a','b','c']
    - whitespace/empty segments filtered: 'a >  > b' -> ['a','b']; '  a  >  b  ' -> ['a','b'] (segments trimmed, empties dropped)
    - MUST stub/restore process.env.XCI_BREADCRUMB per test (save ORIG in beforeEach/afterEach like xci-delegate.test.ts does for XCI_NESTING_DEPTH).
    Resolver seed (extend resolver.test.ts breadcrumb describe block):
    - With XCI_BREADCRUMB='outer > mid' set, resolver.resolve('A', ...) for a nested sequential A(steps A1(steps A1a)) produces step.breadcrumb arrays prefixed: ['outer','mid','A','A1','A1a'] etc.
    - With XCI_BREADCRUMB UNSET, the existing Tests 1–9 stay byte-identical (e.g. ['A','A1','A1a']) — do NOT change those assertions.
    - Depth-cap guard: with a LONG prefix (e.g. 20 segments) set via XCI_BREADCRUMB but only a shallow real nesting (depth 1–2), resolve() does NOT throw the "alias nesting exceeds maximum depth of 10" error — the cap counts only the inner process's own recursion depth, not the seed prefix.
  </behavior>
  <action>
    In nesting.ts (keep it PURE — no heavy imports, cold-start &lt;300ms): add
    `export const XCI_BREADCRUMB_ENV = 'XCI_BREADCRUMB';` and
    `export function getBreadcrumbPrefix(): string[]`. Implementation: read
    process.env[XCI_BREADCRUMB_ENV]; if undefined or '' return []; otherwise split on
    the literal `' > '` separator, map(trim), filter(seg =&gt; seg.length &gt; 0). Return a
    plain string[] (default []). Document it mirrors getNestingDepth's defensive style.

    In resolver/index.ts: import getBreadcrumbPrefix from '../executor/nesting.js'. In the
    resolver.resolve() entry point (≈L629-630) replace the seed `[aliasName]` with
    `[...getBreadcrumbPrefix(), aliasName]`. Leave `depth` starting at 0 unchanged.

    CRITICAL depth-cap reasoning to honor and comment in code: the depth-cap is `if (depth
    &gt; 10)` and `depth` is incremented on each recursion INDEPENDENTLY of chain length, so
    seeding the chain with an external prefix already does NOT consume the inner process's
    nesting budget — the cap counts only post-seed recursion. Do NOT add prefix.length to
    depth anywhere. Add a brief comment at the resolve() seed site explaining that the
    prefix only enriches breadcrumb display and the error message, never the depth budget.
    (The cap error message chain.join(' -&gt; ') will cosmetically include the prefix — that
    is acceptable and intentional; note it in the comment.)

    Write the failing tests FIRST (RED), then implement (GREEN). Reuse makeCommands/
    makeConfig helpers already in resolver.test.ts. For nesting.test.ts, mirror the
    ORIG-save / afterEach-restore pattern from xci-delegate.test.ts. NOTE: resolver.test.ts
    runs in the same vitest process — wrap the prefix tests so they delete XCI_BREADCRUMB in
    afterEach, otherwise a leaked env value would pollute the existing Tests 1–9.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest --run src/executor/__tests__/nesting.test.ts src/resolver/__tests__/resolver.test.ts</automated>
  </verify>
  <done>getBreadcrumbPrefix passes all unit cases; new resolver seed test passes with prefix and stays green without it; existing breadcrumb Tests 1–9 unchanged; long-prefix test does NOT trip the depth cap.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Carry breadcrumb on the plan-level xci variant, inject XCI_BREADCRUMB into childEnv, and forward breadcrumb from both call sites</name>
  <files>
    packages/xci/src/types.ts,
    packages/xci/src/resolver/index.ts,
    packages/xci/src/executor/xci-delegate.ts,
    packages/xci/src/executor/index.ts,
    packages/xci/src/executor/sequential.ts,
    packages/xci/src/executor/__tests__/xci-delegate.test.ts
  </files>
  <behavior>
    buildDelegateInvocation env (extend xci-delegate.test.ts):
    - With fields.breadcrumb = ['A','A1'] -> result.env.XCI_BREADCRUMB === 'A > A1'.
    - With fields.breadcrumb undefined or [] -> XCI_BREADCRUMB is NOT set in result.env (key absent) so no-delegation/no-breadcrumb path stays byte-identical.
    - XCI_NESTING_DEPTH behavior is unchanged (still parent depth + 1) in all the above.
    - 2-level accumulation: pass fields.breadcrumb=['root','A','A1'] (the resolver in a real nested outer would have ALREADY seeded chain from the incoming 'root', so the plan's breadcrumb already contains it) -> result.env.XCI_BREADCRUMB === 'root > A > A1'. Assert we pass breadcrumb.join(' > ') verbatim and do NOT re-read/re-concatenate process.env.XCI_BREADCRUMB on top (no 'root > root > ...').
  </behavior>
  <action>
    types.ts: add `readonly breadcrumb?: readonly string[];` to the ExecutionPlan xci
    variant (≈L247-253) so it matches the SequentialStep xci variant.

    resolver/index.ts plan-level `case 'xci'` (≈L608-624): add
    `...(chain.length > 0 ? { breadcrumb: [...chain] } : {})` to the returned object (chain
    is in scope; for the top-level-xci entry it equals [...getBreadcrumbPrefix(), aliasName]
    after Task 1, so the plan-level xci breadcrumb is the full incoming path + this alias).

    xci-delegate.ts: add `readonly breadcrumb?: readonly string[];` to the XciDelegateFields
    interface. In buildDelegateInvocation, after building childEnv with XCI_NESTING_DEPTH,
    conditionally add the breadcrumb: if
    `fields.breadcrumb !== undefined && fields.breadcrumb.length > 0`, set
    `childEnv[XCI_BREADCRUMB_ENV] = fields.breadcrumb.join(' > ')`. Import XCI_BREADCRUMB_ENV
    from './nesting.js'. Do NOT read process.env here and do NOT re-concatenate any incoming
    prefix — the breadcrumb passed in is already the full accumulated path (the outer's
    resolver seeded it from its own incoming XCI_BREADCRUMB).

    executor/index.ts `case 'xci'` (≈L194-208): add
    `...(plan.breadcrumb !== undefined ? { breadcrumb: plan.breadcrumb } : {})` to the
    runXciDelegate fields object alongside the existing alias/project/args/cwd spread.

    sequential.ts `if (step.kind === 'xci')` block (≈L263-277): add
    `...(step.breadcrumb !== undefined ? { breadcrumb: step.breadcrumb } : {})` to the
    runXciDelegate fields object.

    Write/extend the buildDelegateInvocation env assertions FIRST (RED), then implement.
    Keep the existing XCI_NESTING_DEPTH and argv tests green.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest --run src/executor/__tests__/xci-delegate.test.ts src/resolver/__tests__/resolver.test.ts</automated>
  </verify>
  <done>ExecutionPlan xci variant carries breadcrumb; resolver populates it for plan-level xci; buildDelegateInvocation sets XCI_BREADCRUMB=breadcrumb.join(' > ') when a non-empty breadcrumb is provided and omits the key otherwise; 2-level accumulation asserts pass; index.ts and sequential.ts forward plan.breadcrumb / step.breadcrumb; all existing xci-delegate + resolver tests green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Render the breadcrumb prefix in printRunHeader, add the full-path e2e, changeset + README</name>
  <files>
    packages/xci/src/executor/output.ts,
    packages/xci/src/__tests__/cli.e2e.test.ts,
    .changeset/xci-breadcrumb-propagate.md,
    packages/xci/README.md
  </files>
  <behavior>
    printRunHeader prefix (assert via the e2e — the inner process is spawned with
    XCI_BREADCRUMB set, and its run header must show the full path):
    - No prefix (XCI_BREADCRUMB absent): the title line is byte-identical to today
      `▶ running: <alias>` (no leading separator, no change).
    - With prefix present: title line shows `▶ running: <prefix> > <alias>`, e.g.
      `▶ running: run-child > inner-seq`.
    Full-path e2e (outer kind:xci -> inner sequential alias):
    - Build an OUTER project whose `run-child` is kind:xci delegating to a CHILD project's
      `inner-seq` (a sequential with at least one named sub-step that prints a known line).
    - Run the outer with --log (SHOW+SAVE so inner output tees into the outer's captured
      stdout/stderr — quick-260623-hp3 makes this reach the outer). Assert the outer's
      captured output contains the full-path run header `run-child > inner-seq` (and, if a
      step header is emitted, a full-path step header like
      `run-child > inner-seq > <step>`). At minimum the run header full path MUST appear.
  </behavior>
  <action>
    In output.ts printRunHeader (title line ≈L357): import getBreadcrumbPrefix from
    './nesting.js'. Before the title write, compute `const prefix = getBreadcrumbPrefix();`
    and build the display alias as
    `prefix.length > 0 ? prefix.join(' > ') + ' > ' + alias : alias`. Write that in place of
    the bare `${alias}`. Keep the no-prefix branch BYTE-IDENTICAL (same bold/cyan/reset
    wrapping, same `▶ running: ` text). Do NOT touch the variables/steps blocks.

    Add the e2e to cli.e2e.test.ts inside the existing xci E2E describe block. Reuse
    createTempProject + runCliInDir + trackDir (mirror the SHOW+SAVE delegate test ≈L1477).
    CHILD project: an `inner-seq` kind:sequential whose first step is a named sub-alias
    `inner-step` running e.g.
    `cmd: ["node", "-e", "process.stdout.write('INNER-LINE\\\\n')"]`. OUTER project:
    `run-child` kind:xci with `alias: inner-seq` and
    `project: "${childDir.replace(/\\/g, '/')}"`. Run `['run-child', '--log']`. Assert code 0
    and that combined stdout+stderr contains 'run-child > inner-seq' (and ideally the
    INNER-LINE so the tee path is exercised). The test name MUST contain the word
    "breadcrumb" so the `-t "breadcrumb"` filter in verify selects it. Keep NO_COLOR/CI from
    runCliInDir so output is plain.

    Add .changeset/xci-breadcrumb-propagate.md: frontmatter `"xci": patch`, body one line
    describing that kind:xci now propagates the breadcrumb across the delegate boundary so
    nested xci shows the full path from the original alias down to the current step.

    Update README.md xci-kind section: document that the breadcrumb is propagated to the
    delegated (inner) xci via the XCI_BREADCRUMB env var, so step headers and the run header
    show the full cross-process path; note it is byte-identical with no delegation and that
    secrets are never included (breadcrumb is alias names only).
  </action>
  <verify>
    <automated>cd packages/xci && npm run build && npx vitest --run src/__tests__/cli.e2e.test.ts -t "breadcrumb" && npx biome check src/executor/output.ts</automated>
  </verify>
  <done>printRunHeader shows the full path when XCI_BREADCRUMB is set and is byte-identical without it; the full-path e2e passes (outer captured output contains 'run-child > inner-seq'); changeset added; README xci section documents the propagated breadcrumb; biome clean (no --unsafe).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| outer xci → child env | XCI_BREADCRUMB string crosses the process boundary into the delegated child |
| process.env → resolver seed | the inbound XCI_BREADCRUMB value seeds the inner resolver chain (display only) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ipz-01 | Information disclosure | XCI_BREADCRUMB value | mitigate | Breadcrumb carries alias NAMES only (chain segments), never variable/secret values; resolver populates it from chain, not from config.values. No secret can enter it. |
| T-ipz-02 | Denial of service | inner depth cap | mitigate | Depth cap counts only post-seed recursion (depth is independent of chain length); a long inbound prefix cannot trip the cap — explicitly tested in Task 1. The MAX_NESTING_DEPTH=32 spawn cap (XCI_NESTING_DEPTH) remains the runaway-nesting guard. |
| T-ipz-03 | Tampering | getBreadcrumbPrefix parsing | accept | A hostile env value can only inject more display segments (split on ' > ', trimmed, empties dropped); no code execution, no path traversal — purely cosmetic breadcrumb text. |
| T-ipz-SC | Tampering | npm/pip/cargo installs | mitigate | No new dependencies added; nothing to install. No package-legitimacy checkpoint required. |
</threat_model>

<verification>
- `cd packages/xci && npm run build` succeeds (tsup bundles; cold-start path unchanged — nesting.ts stays pure).
- `cd packages/xci && npx vitest --run` — entire xci suite green, including all existing xci tests (nesting, delegation, dry-run, list, XCI_NESTING_DEPTH=1, SHOW+SAVE, ANTI-HANG) and the quick-260421-kbl intra-process breadcrumb tests (a > a1 > a1a unchanged).
- `cd packages/xci && npx biome check src` — clean, no --unsafe.
- Manual sanity (optional): outer kind:xci with --dry-run spawns nothing and exits as before.
</verification>

<success_criteria>
- Inner (delegated) xci shows the FULL path from the original alias down to the current step in step headers and the run header.
- N-level propagation works automatically (each level passes its own accumulated breadcrumb; no manual re-concatenation).
- No-delegation behavior is byte-identical to today (XCI_BREADCRUMB absent → prefix []).
- Long inbound prefix never trips the inner depth cap.
- Secrets never logged; --dry-run spawns nothing; --list/--help unchanged; XCI_NESTING_DEPTH + attenuation intact.
- Patch changeset added; README xci section documents the propagated breadcrumb.
- Context usage target ~35%.
</success_criteria>

<output>
Create `.planning/quick/260623-ipz-propagate-xci-delegate-breadcrumb-across/260623-ipz-SUMMARY.md` when done.
</output>
