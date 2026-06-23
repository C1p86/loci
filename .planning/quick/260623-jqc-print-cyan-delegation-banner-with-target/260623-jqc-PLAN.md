---
phase: quick-260623-jqc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/executor/output.ts
  - packages/xci/src/executor/index.ts
  - packages/xci/src/executor/sequential.ts
  - packages/xci/src/executor/__tests__/output.test.ts
  - packages/xci/README.md
  - .changeset/cyan-delegation-banner.md
autonomous: true
requirements: [QUICK-260623-JQC]

must_haves:
  truths:
    - "When a kind:xci delegation runs (both top-level case 'xci' and sequential xci step), a bright-cyan separator line of dashes is printed to stderr before the delegate spawns."
    - "The banner names the target xci project/folder and the alias being invoked."
    - "The banner prints the invocation params, with any arg token matching a secret value redacted to *** (never cleartext)."
    - "When color is disabled (NO_COLOR or non-TTY), the banner prints plain dashes + text with no ANSI codes."
    - "--dry-run path is unchanged (no banner added there); existing xci unit + e2e tests stay green."
  artifacts:
    - path: "packages/xci/src/executor/output.ts"
      provides: "BRIGHT_CYAN constant + printDelegationBanner() function"
      contains: "printDelegationBanner"
    - path: "packages/xci/src/executor/__tests__/output.test.ts"
      provides: "Unit tests for printDelegationBanner (project/alias/args, secret redaction, color on/off)"
      contains: "printDelegationBanner"
  key_links:
    - from: "packages/xci/src/executor/index.ts"
      to: "printDelegationBanner"
      via: "case 'xci' replaces the plain `delegate → …` line"
      pattern: "printDelegationBanner\\("
    - from: "packages/xci/src/executor/sequential.ts"
      to: "printDelegationBanner"
      via: "xci step block, after printStepHeader, before runXciDelegate"
      pattern: "printDelegationBanner\\("
---

<objective>
Add a visually distinct cyan ("azzurro") delegation banner printed to stderr whenever a
`kind: xci` step/plan delegates to a child project. The banner is a separator line of
bright-cyan dashes followed by lines naming the target xci folder + alias and the params
it is invoked with (secrets redacted).

Purpose: Today the top-level call site (executor/index.ts case 'xci') prints a single plain
line `  delegate → <cwd> :: <alias> <args>` that does NOT redact secrets in args (latent
leak), and the sequential.ts xci step prints NO preview at all. Replace/augment both with a
single shared, secret-safe, colored banner so the operator always sees, prominently, WHERE a
delegation is going and WITH WHICH PARAMETERS.

Output: a `printDelegationBanner` function + `BRIGHT_CYAN` constant in output.ts, both xci
call sites wired to it, unit tests, README docs, and a patch changeset.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- All from packages/xci/src/executor/output.ts. Use directly — no exploration needed. -->

ANSI constants block (~L26-32) — add BRIGHT_CYAN next to these:
```typescript
export const RESET = '\x1b[0m';
export const DIM = '\x1b[2m';
export const YELLOW = '\x1b[33m';
export const BRIGHT_YELLOW = '\x1b[93m';
export const RED = '\x1b[31m';
export const CYAN = '\x1b[36m';
export const BOLD = '\x1b[1m';
```

Color detection (~L43):
```typescript
export function shouldUseColor(): boolean; // false on NO_COLOR / non-TTY, true on FORCE_COLOR
```

Private helper already in this file (~L543) — reuse directly (same module):
```typescript
function redactArgv(argv: readonly string[], secretValues: ReadonlySet<string>): readonly string[];
// maps each token: secretValues.has(token) ? '***' : token
```

Style reference — printStepHeader (~L217) writes ONE colored line to stderr:
```typescript
if (shouldUseColor()) {
  process.stderr.write(`${BOLD}${CYAN}▶ ${stepName}${counter}${RESET}\n`);
} else {
  process.stderr.write(`▶ ${stepName}${counter}\n`);
}
```
</interfaces>

<call_sites>
<!-- executor/index.ts case 'xci' (~L183-214). secretValues IS in scope:
     destructured at L38 `const { cwd, env, logFile, showOutput, tailLines, fromStep, secretValues } = options;`
     Lines to REPLACE (L189-191):
       // Delegation preview — secrets are redacted via redactArgv in output
       const argsDisplay = plan.args && plan.args.length > 0 ? ` ${plan.args.join(' ')}` : '';
       process.stderr.write(`  delegate → ${effectiveCwd} :: ${plan.alias}${argsDisplay}\n`);
     effectiveCwd = plan.project ?? plan.cwd ?? cwd (already computed at L186).
     printDelegationBanner is imported from './output.js' via the existing block at L20-29. -->

<!-- executor/sequential.ts xci block (~L244-286). runSequential signature has
     `secretValues?: ReadonlySet<string>` (L146). delegateCwd = resolvedProject ?? stepCwd (L260).
     resolvedAlias (L251) + resolvedArgs (L256) already interpolated.
     Add the banner AFTER printStepHeader(displayLabel, stepNum, totalSteps) (L246) and
     BEFORE runXciDelegate (L263). Import printDelegationBanner from './output.js' (block L20-29). -->
</call_sites>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add BRIGHT_CYAN + printDelegationBanner to output.ts with unit tests</name>
  <files>packages/xci/src/executor/output.ts, packages/xci/src/executor/__tests__/output.test.ts</files>
  <behavior>
    - color ON (FORCE_COLOR): the separator line contains `\x1b[96m` (BRIGHT_CYAN) and `\x1b[0m` (RESET); output contains the project string, the alias, and the (redacted) args.
    - color OFF (NO_COLOR): output contains the project, alias, and args but NO ANSI escape (`\x1b[`) anywhere.
    - secret redaction: given secretValues containing "s3cr3t", an args array containing "s3cr3t" renders `***` and the cleartext "s3cr3t" is NOT present in any written chunk.
    - no args (args undefined or empty): the params line reads `params: (none)`.
  </behavior>
  <action>
    In output.ts, add `export const BRIGHT_CYAN = '\x1b[96m';` to the ANSI constants block (next to CYAN/BRIGHT_YELLOW, ~L31).

    Add an exported function `printDelegationBanner(project: string, alias: string, args: readonly string[] | undefined, secretValues: ReadonlySet<string>): void` near printStepHeader (after printStepResult is fine). It writes to process.stderr only. Behavior:
    - Compute `useColor = shouldUseColor()`. Compute dash count as `Math.min(process.stderr.columns ?? 60, 80)`.
    - Separator line: a string of that many `-` chars. When useColor, wrap in BRIGHT_CYAN + RESET; else plain. Write with trailing `\n`.
    - Target line: `↳ xci → ${project} :: ${alias}` (the `↳ xci → <project> :: <alias>` form). When useColor, wrap the whole line in BRIGHT_CYAN + RESET; else plain. Trailing `\n`.
    - Params line: redact args first via the existing private `redactArgv` helper (same module — call it directly; no export needed). If args is present and non-empty, `params: ${redactArgv(args, secretValues).join(' ')}`; otherwise `params: (none)`. When useColor, wrap in BRIGHT_CYAN + RESET; else plain. Trailing `\n`.
    NEVER print raw secret values — only the redacted argv. Do not log secretValues themselves. Keep the function dependency-free (no new imports) to preserve the <300ms cold-start budget (per CLAUDE.md).

    In output.test.ts, add `printDelegationBanner` and `BRIGHT_CYAN` to the existing import from '../output.js'. Add a `describe('printDelegationBanner', …)` block mirroring the `printStepHeader color` / `printRunHeader` style: spy on `process.stderr.write` via `vi.spyOn(process.stderr, 'write').mockImplementation(...)`, collect chunks into an array, and stub env with `vi.stubEnv`. Cover the four behaviors above. Restore the spy and call `vi.unstubAllEnvs()` in afterEach.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run src/executor/__tests__/output.test.ts</automated>
  </verify>
  <done>printDelegationBanner exported; BRIGHT_CYAN ('\x1b[96m') exported; new tests pass covering color-on (96m present), color-off (no ANSI), secret arg → *** with no cleartext, and empty args → `params: (none)`.</done>
</task>

<task type="auto">
  <name>Task 2: Wire both xci call sites, document, changeset, full suite</name>
  <files>packages/xci/src/executor/index.ts, packages/xci/src/executor/sequential.ts, packages/xci/README.md, .changeset/cyan-delegation-banner.md</files>
  <action>
    index.ts (case 'xci', ~L189-191): add `printDelegationBanner` to the existing import block from './output.js' (L20-29). DELETE the three lines: the `// Delegation preview …` comment, the `argsDisplay` const, and the `process.stderr.write(\`  delegate → …\`)` line. Replace with a single call: `printDelegationBanner(effectiveCwd, plan.alias, plan.args, secretValues);` placed after `printStepHeader(xciLabel)` (L188) and before `const startTime = Date.now()` (L192). `secretValues` is already in scope (destructured at L38).

    sequential.ts (xci block, ~L244-286): add `printDelegationBanner` to the existing import block from './output.js' (L20-29). After `printStepHeader(displayLabel, stepNum, totalSteps)` (L246) and before the `runXciDelegate` call (L263), add: `printDelegationBanner(delegateCwd, resolvedAlias, resolvedArgs, secretValues ?? new Set());`. Note `delegateCwd` is defined at L260 (after the interpolation block) — place the banner call immediately after `const delegateCwd = …` (L260) and before `runXciDelegate`, so all three args are in scope. `secretValues` is the optional runSequential param (L146); fall back to `new Set()`.

    Do NOT touch the --dry-run path (printDryRun) — its existing xci preview stays as-is and the banner must not appear there.

    README.md (xci kind section): document that a kind:xci delegation now prints a bright-cyan banner to stderr — a dashed separator line, the target project/folder + alias (`↳ xci → <project> :: <alias>`), and a `params:` line with secrets redacted. Note it respects NO_COLOR / non-TTY (plain output) and goes to stderr.

    .changeset/cyan-delegation-banner.md: patch changeset for `xci`. Frontmatter `--- "xci": patch ---` then a one-line summary: kind:xci delegations now print a secret-safe cyan delegation banner (target folder + params) to stderr at both call sites.
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run && npx tsc --noEmit && npx @biomejs/biome check src</automated>
  </verify>
  <done>Both call sites call printDelegationBanner with effective/resolved values; old `delegate → …` line removed; dry-run path untouched; README + changeset added; full vitest suite (incl. cli.e2e xci, SHOW+SAVE, ANTI-HANG, breadcrumb) passes; tsc clean; biome clean (no --unsafe).</done>
</task>

</tasks>

<verification>
- `cd packages/xci && npx vitest run` — all tests green, including existing xci unit tests and cli.e2e xci block (SHOW+SAVE BUILD-LINE-STDOUT, ANTI-HANG, breadcrumb propagation). The banner is additive on stderr; SHOW+SAVE asserts the delegated line in combined stdout+stderr — do NOT weaken that assertion. If an exact-match e2e assertion genuinely breaks because of the added stderr lines, adapt only that assertion (use `.toContain`), never the SHOW+SAVE / ANTI-HANG / breadcrumb intent.
- `npx tsc --noEmit` — no type errors.
- `npx @biomejs/biome check src` — clean (no `--unsafe`).
- Manual sanity: a kind:xci run prints the dashed cyan separator + `↳ xci → … :: …` + `params: …` on stderr before the child spawns; with NO_COLOR set the same lines print plain.
</verification>

<success_criteria>
- printDelegationBanner exists in output.ts, writes a bright-cyan dashed separator + target (project + alias) + redacted params to stderr, respects shouldUseColor(), and never emits secret cleartext.
- Both kind:xci call sites (executor/index.ts case 'xci' and sequential.ts xci step) invoke it with effective/resolved, already-interpolated values; the legacy non-redacting `delegate → …` line is gone.
- Dry-run, --list, --help, nested attenuation (XCI_NESTING_DEPTH), breadcrumb, exit codes, and tee behavior are unchanged.
- Unit tests cover project/alias/args presence, secret redaction, and color on/off; full suite + tsc + biome pass.
- README xci section documents the banner; a patch changeset for `xci` is added.
- No new runtime dependency; cold-start budget (<300ms) unaffected.
</success_criteria>

<output>
Create `.planning/quick/260623-jqc-print-cyan-delegation-banner-with-target/260623-jqc-SUMMARY.md` when done
</output>
