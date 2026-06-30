---
phase: quick-260630-quj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/executor/capture.ts
  - packages/xci/src/executor/__tests__/capture.test.ts
autonomous: true
requirements: [QUICK-260630-quj]
must_haves:
  truths:
    - "A user regex with ^/$ anchors matches per-line against multi-line command output"
    - "extractFromOutput returns the first capture group from a line in the middle of multi-line stdout"
    - "Existing single-line capture and validation behavior is unchanged"
    - "xci is rebuilt and reinstalled globally with the fix"
  artifacts:
    - path: "packages/xci/src/executor/capture.ts"
      provides: "extractFromOutput compiles regex with the 'm' (multiline) flag"
      contains: "new RegExp(config.regex, 'm')"
    - path: "packages/xci/src/executor/__tests__/capture.test.ts"
      provides: "Regression test for multi-line ^/$ matching via extractFromOutput"
      contains: "extractFromOutput"
  key_links:
    - from: "extractFromOutput"
      to: "RegExp 'm' flag"
      via: "regex compilation"
      pattern: "new RegExp\\(config\\.regex, 'm'\\)"
---

<objective>
Fix `extractFromOutput` in the xci capture module so that user-supplied regexes with `^`/`$` anchors match per-line against multi-line command output. Currently the regex is compiled with no flags, so `^`/`$` anchor to the whole string and a pattern like `^Client root:\s*(.+)$` never matches against multi-line `p4 info` output, returning an empty captured value.

Purpose: Make capture regexes behave the way users expect for line-oriented CLI output (the common case).
Output: One-line code change (add `'m'` flag), one regression test, and a rebuilt + locally reinstalled `xci`.

Behavior note: Adding the `'m'` flag by default changes semantics for anyone who relied on `^`/`$` anchoring to the whole multi-line string. This is the agreed approach (multiline by default) — proceed and document it in the SUMMARY.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@packages/xci/src/executor/capture.ts
@packages/xci/src/executor/__tests__/capture.test.ts
@packages/xci/package.json
@package.json

<interfaces>
From packages/xci/src/executor/capture.ts (functions the test will exercise):

```typescript
// Extracts a value from stdout using config.regex; returns first capture group
// (or full match), trimmed. Returns '' on no match, trimmed stdout if no regex.
export function extractFromOutput(stdout: string, config: CaptureConfig): string;
```

`CaptureConfig` (from packages/xci/src/types.js) minimally requires a `var` field;
`regex` is the optional pattern string consumed by `extractFromOutput`.

Root workspace script (package.json) for rebuild + global reinstall:
```
"install-local": "pnpm install && pnpm --filter xci run build && npm install -g ./packages/xci"
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add multiline flag default + regression test</name>
  <files>packages/xci/src/executor/capture.ts, packages/xci/src/executor/__tests__/capture.test.ts</files>
  <behavior>
    - extractFromOutput with regex `^Client root:\s*(.+)$` against multi-line stdout
      ("Some banner\nClient root: /home/user/proj\nOther: x") returns "/home/user/proj".
    - extractFromOutput still returns the trimmed full stdout when config.regex is unset.
    - extractFromOutput with a regex that matches on the first line of single-line
      output still returns the expected capture group (no regression).
  </behavior>
  <action>
    In packages/xci/src/executor/capture.ts, change the regex compilation in
    extractFromOutput from `new RegExp(config.regex)` to `new RegExp(config.regex, 'm')`
    so `^` and `$` anchor per-line. This is the only production code change; leave the
    rest of extractFromOutput (capture-group selection, trim, no-match returns '',
    try/catch fallback) untouched.

    In packages/xci/src/executor/__tests__/capture.test.ts, add `extractFromOutput`
    to the existing import from '../capture.js'. Add a new `describe('extractFromOutput
    — multiline')` block with at least: (1) a multi-line case proving `^...(.+)$`
    captures a value from a middle line, (2) a no-regex case returning trimmed stdout,
    (3) a single-line case confirming no regression. Follow the existing test style
    (vitest `it` + `expect(...).toBe(...)`).
  </action>
  <verify>
    <automated>cd packages/xci && npx vitest run src/executor/__tests__/capture.test.ts</automated>
  </verify>
  <done>capture.ts compiles the regex with the 'm' flag; the new multiline test and all existing capture tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: Rebuild and reinstall xci globally</name>
  <files>(no source changes — build + install only)</files>
  <action>
    Rebuild the xci package and reinstall it globally so the fix is live on this
    machine. From the repo root run the workspace script:
    `pnpm run install-local`
    (which runs `pnpm install`, `pnpm --filter xci run build` via tsup, then
    `npm install -g ./packages/xci`). If `pnpm run install-local` is unavailable,
    fall back to running `pnpm --filter xci run build` then `npm install -g ./packages/xci`
    from the repo root. Do NOT commit build output — dist is generated, not versioned.
  </action>
  <verify>
    <automated>xci --version</automated>
  </verify>
  <done>Build completes without error and the globally installed `xci --version` runs successfully.</done>
</task>

</tasks>

<verification>
- `cd packages/xci && npx vitest run src/executor/__tests__/capture.test.ts` passes (new multiline test + all existing).
- `grep -n "new RegExp(config.regex, 'm')" packages/xci/src/executor/capture.ts` returns the changed line.
- `xci --version` runs after the global reinstall.
</verification>

<success_criteria>
- extractFromOutput compiles user regexes with the 'm' flag, so `^`/`$` match per-line on multi-line output.
- A regression test covers the multi-line capture case and guards single-line + no-regex behavior.
- xci is rebuilt and reinstalled globally on this machine.
- SUMMARY documents the multiline-by-default semantics change.
</success_criteria>

<output>
Create `.planning/quick/260630-quj-fix-capture-regex-add-multiline-flag-def/260630-quj-SUMMARY.md` when done.
</output>
