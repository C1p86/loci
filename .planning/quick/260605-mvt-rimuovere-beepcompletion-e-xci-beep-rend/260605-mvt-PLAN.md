---
phase: quick
plan: 260605-mvt
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/executor/output.ts
  - packages/xci/src/executor/index.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "beepCompletion function does not exist in output.ts"
    - "XCI_BEEP env var is no longer referenced anywhere in packages/xci"
    - "notifyCompletion runs unconditionally (no XCI_NOTIFY guard)"
    - "pnpm run build in packages/xci passes with no errors"
  artifacts:
    - path: "packages/xci/src/executor/output.ts"
      provides: "output utilities without beepCompletion"
    - path: "packages/xci/src/executor/index.ts"
      provides: "executor without beepCompletion import/call"
  key_links:
    - from: "packages/xci/src/executor/index.ts"
      to: "packages/xci/src/executor/output.ts"
      via: "named import — beepCompletion must NOT appear after change"
      pattern: "beepCompletion"
---

<objective>
Remove beepCompletion (and its XCI_BEEP guard) entirely, and make notifyCompletion always run without the XCI_NOTIFY=1 guard.

Purpose: Clean up the beep feature and unconditionally enable OS desktop notifications.
Output: Two modified source files; build passes cleanly.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove beepCompletion from output.ts and drop XCI_NOTIFY guard</name>
  <files>packages/xci/src/executor/output.ts</files>
  <action>
    Two targeted edits to output.ts:

    1. DELETE the entire beepCompletion function (lines 125-128):
       ```
       export function beepCompletion(exitCode: number): void {
         if (process.env['XCI_BEEP'] !== '1' || !process.stderr.isTTY) return;
         process.stderr.write(exitCode === 0 ? '\x07' : '\x07\x07\x07');
       }
       ```
       Remove these 4 lines completely. Do not replace with anything.

    2. In notifyCompletion, DELETE the guard line (currently the first line of the function body):
       ```
       if (process.env['XCI_NOTIFY'] !== '1') return;
       ```
       Remove this single line. Leave everything else in notifyCompletion unchanged.

    No other changes. No reformatting.
  </action>
  <verify>
    <automated>cd packages/xci && grep -n "beepCompletion\|XCI_BEEP\|XCI_NOTIFY" src/executor/output.ts; echo "exit:$?"</automated>
  </verify>
  <done>grep returns no matches for beepCompletion, XCI_BEEP, XCI_NOTIFY in output.ts</done>
</task>

<task type="auto">
  <name>Task 2: Remove beepCompletion import and call from index.ts, then verify build</name>
  <files>packages/xci/src/executor/index.ts</files>
  <action>
    Two targeted edits to index.ts:

    1. In the named import from './output.js' (line 9), remove `beepCompletion,` from the list.
       Current:
       ```
       import { beepCompletion, notifyCompletion, printCaptureResult, printStepHeader, printStepPreview, printStepResult, resetTerminalTitle, setTerminalTitle } from './output.js';
       ```
       After:
       ```
       import { notifyCompletion, printCaptureResult, printStepHeader, printStepPreview, printStepResult, resetTerminalTitle, setTerminalTitle } from './output.js';
       ```

    2. DELETE the call site (currently line 109):
       ```
       beepCompletion(result.exitCode);
       ```
       Remove this line completely. Leave `await notifyCompletion(result.exitCode);` on the next line untouched.

    After both edits, run the build to confirm no TypeScript errors:
    ```
    cd packages/xci && pnpm run build
    ```
  </action>
  <verify>
    <automated>cd packages/xci && grep -n "beepCompletion" src/executor/index.ts; pnpm run build 2>&1 | tail -5</automated>
  </verify>
  <done>grep returns no matches for beepCompletion in index.ts and pnpm run build exits 0</done>
</task>

</tasks>

<verification>
After both tasks:
- grep -rn "beepCompletion\|XCI_BEEP" packages/xci/src/ returns no matches
- grep -n "XCI_NOTIFY" packages/xci/src/executor/output.ts returns no matches
- pnpm run build in packages/xci exits 0
</verification>

<success_criteria>
- beepCompletion function deleted from output.ts, not exported
- XCI_BEEP env var check gone from output.ts
- XCI_NOTIFY guard line removed from notifyCompletion — function body starts directly with `const message = ...`
- index.ts import list and call site no longer reference beepCompletion
- Build passes
</success_criteria>

<output>
After completion, create `.planning/quick/260605-mvt-rimuovere-beepcompletion-e-xci-beep-rend/260605-mvt-SUMMARY.md`
</output>
