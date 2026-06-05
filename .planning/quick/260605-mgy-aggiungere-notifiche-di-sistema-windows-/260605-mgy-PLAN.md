---
phase: quick-260605-mgy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/package.json
  - packages/xci/src/executor/output.ts
  - packages/xci/src/executor/index.ts
autonomous: true
requirements: []
must_haves:
  truths:
    - "When XCI_NOTIFY=1 and command succeeds, OS toast appears with title 'xci' and message 'xci: completato ✓'"
    - "When XCI_NOTIFY=1 and command fails with exit N, OS toast appears with message 'xci: errore (exit N)'"
    - "When XCI_NOTIFY is unset or not '1', no notification is triggered"
    - "When node-notifier is unavailable or OS does not support notifications, xci runs silently without error"
  artifacts:
    - path: "packages/xci/package.json"
      provides: "node-notifier runtime dependency"
      contains: "node-notifier"
    - path: "packages/xci/src/executor/output.ts"
      provides: "notifyCompletion() function"
      exports: ["notifyCompletion"]
    - path: "packages/xci/src/executor/index.ts"
      provides: "notifyCompletion call after execution"
  key_links:
    - from: "packages/xci/src/executor/index.ts"
      to: "notifyCompletion"
      via: "import from output.ts, called alongside beepCompletion at line 109"
---

<objective>
Add cross-platform OS desktop notifications on xci command completion, controlled by XCI_NOTIFY=1.

Purpose: Operators running long builds in a background terminal want an ambient signal when xci finishes — without polling the terminal. This is opt-in (env var) and completely silent if node-notifier fails.

Output: New `notifyCompletion(exitCode)` function in output.ts, called in executor/index.ts alongside the existing `beepCompletion` call. node-notifier added as a runtime dependency.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@packages/xci/src/executor/output.ts
@packages/xci/src/executor/index.ts
@packages/xci/package.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add node-notifier dependency and install</name>
  <files>packages/xci/package.json</files>
  <action>
Add `"node-notifier": "^10.0.1"` to the `dependencies` section of packages/xci/package.json (after the "yaml" entry, maintaining alphabetical order is not required — add after existing entries for minimal diff).

Then run `pnpm install` from the monorepo root (not packages/xci) so the lockfile is updated correctly:

```
pnpm install
```

node-notifier 10.x is pure JS, no native bindings, cross-platform (Windows toast via PowerShell/SnoreToast, macOS via osascript, Linux via notify-send). It is an optional runtime dep — the code will dynamic-import it and swallow errors, so it does NOT need to be in tsup's `noExternal` or treated as a hard dependency. However it must be in `dependencies` (not `devDependencies`) so it is available when `xci` is installed globally via npm.

Do NOT add `@types/node-notifier` — the type is accessed only via dynamic import with a typed interface cast, so no TS types package is needed.
  </action>
  <verify>
    <automated>node -e "const p = JSON.parse(require('fs').readFileSync('packages/xci/package.json','utf8')); process.exit(p.dependencies['node-notifier'] ? 0 : 1)"</automated>
  </verify>
  <done>packages/xci/package.json contains node-notifier in dependencies and pnpm install succeeds</done>
</task>

<task type="auto">
  <name>Task 2: Implement notifyCompletion in output.ts and wire into executor/index.ts</name>
  <files>packages/xci/src/executor/output.ts, packages/xci/src/executor/index.ts</files>
  <action>
**In packages/xci/src/executor/output.ts**, add the `notifyCompletion` function in the "Terminal title" section (after `beepCompletion`, around line 128). The function must:

1. Check `process.env['XCI_NOTIFY'] !== '1'` — return immediately if not set.
2. Determine message:
   - exitCode === 0 → `'xci: completato ✓'`
   - exitCode !== 0 → `'xci: errore (exit ' + exitCode + ')'`
3. Dynamic import node-notifier with try/catch — if import fails, return silently:

```typescript
export async function notifyCompletion(exitCode: number): Promise<void> {
  if (process.env['XCI_NOTIFY'] !== '1') return;
  const message = exitCode === 0
    ? 'xci: completato ✓'
    : `xci: errore (exit ${exitCode})`;
  try {
    const { default: notifier } = await import('node-notifier');
    notifier.notify({ title: 'xci', message });
  } catch {
    // node-notifier unavailable or OS unsupported — silent fallback
  }
}
```

Place the function immediately after `beepCompletion` (line ~128) to keep the notification helpers co-located.

**In packages/xci/src/executor/index.ts**, update two places:

1. Import: Add `notifyCompletion` to the named import from `./output.js` (line 9). The existing import is:
   ```typescript
   import { beepCompletion, printCaptureResult, printStepHeader, printStepPreview, printStepResult, resetTerminalTitle, setTerminalTitle } from './output.js';
   ```
   Becomes:
   ```typescript
   import { beepCompletion, notifyCompletion, printCaptureResult, printStepHeader, printStepPreview, printStepResult, resetTerminalTitle, setTerminalTitle } from './output.js';
   ```

2. Call site (line 109, after `beepCompletion`):
   ```typescript
   beepCompletion(result.exitCode);
   await notifyCompletion(result.exitCode);
   return result;
   ```
   
   The `run` method is already `async`, so `await` is valid here. `notifyCompletion` is async because of the dynamic import; awaiting it ensures the notification fires before the process can exit in short-lived runs.

Do NOT add `notifyCompletion` to the barrel re-export on line 14 — it is an internal side-effect function not needed by callers of the executor module.
  </action>
  <verify>
    <automated>cd packages/xci && pnpm typecheck</automated>
  </verify>
  <done>
TypeScript compiles clean. `notifyCompletion` exported from output.ts, imported and awaited in executor/index.ts. When XCI_NOTIFY=1 is set in terminal and a short command runs (e.g. `XCI_NOTIFY=1 xci --version`), an OS toast appears. When XCI_NOTIFY is unset, no notification occurs and no error is thrown.
  </done>
</task>

</tasks>

<verification>
After both tasks complete:
1. `pnpm typecheck` in packages/xci passes with no errors
2. `pnpm build` in packages/xci succeeds (tsup bundles node-notifier via dynamic import — since it uses `await import(...)`, tsup will not bundle it statically, so the runtime install from node_modules is used)
3. Manual smoke: set `XCI_NOTIFY=1` in shell, run `xci <any alias>`, observe OS toast on completion
4. Without `XCI_NOTIFY=1`, running `xci <alias>` produces no notification and no error
</verification>

<success_criteria>
- node-notifier in packages/xci/package.json dependencies
- `notifyCompletion(exitCode: number): Promise<void>` exported from output.ts
- Function is a no-op when XCI_NOTIFY !== '1'
- Function swallows all errors from node-notifier (try/catch around dynamic import)
- executor/index.ts awaits notifyCompletion after beepCompletion
- `pnpm typecheck` passes
- `pnpm build` passes
</success_criteria>

<output>
After completion, create `.planning/quick/260605-mgy-aggiungere-notifiche-di-sistema-windows-/260605-mgy-SUMMARY.md`
</output>
