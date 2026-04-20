---
phase: 260420-lxj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/log-errors.ts
  - packages/xci/src/__tests__/log-errors.test.ts
  - packages/xci/src/cli.ts
  - packages/xci/src/agent/index.ts
autonomous: true
requirements:
  - QUICK-260420-lxj
must_haves:
  truths:
    - "When a local xci alias exits non-zero, error-matching lines (case-insensitive /error/i) from the captured log are printed to stderr BEFORE the askShowLog prompt appears"
    - "When an agent-dispatched task exits non-zero, error-matching lines from the captured onChunk output are printed to stderr inside handleDispatch's onExit before runningRuns.delete"
    - "The shared helper printErrorLines emits a header, up to 50 matching lines, a truncation footer when >50, and a closing separator — all to stderr via process.stderr.write"
    - "printErrorLines is a no-op (zero stderr writes) when input has no /error/i matches OR input is empty"
    - "outputBuffer in the agent is scoped inside handleDispatch (not module-level) so concurrent dispatches under --max-concurrent > 1 never share or cross-contaminate buffers"
    - "outputBuffer is bounded at 2MB: appends that would push past the cap trim from the head to keep the most recent output"
    - "All prior regression guards still pass (agent.mjs dynamic import, <redacted> count, formatFrameForLog, parseYaml, no error-frame shape), plus new printErrorLines guards in both built bundles"
  artifacts:
    - path: "packages/xci/src/log-errors.ts"
      provides: "Shared helper exporting printErrorLines(output: string, source?: string): void"
      exports: ["printErrorLines"]
    - path: "packages/xci/src/__tests__/log-errors.test.ts"
      provides: "Vitest spec covering empty/no-match/matches/mixed-case/truncation cases"
    - path: "packages/xci/src/cli.ts"
      provides: "Local CLI integration: read log file and call printErrorLines before askShowLog"
      contains: "printErrorLines"
    - path: "packages/xci/src/agent/index.ts"
      provides: "Agent daemon integration: buffered onChunk output + printErrorLines on non-zero exit"
      contains: "printErrorLines"
  key_links:
    - from: "packages/xci/src/cli.ts"
      to: "packages/xci/src/log-errors.ts"
      via: "import { printErrorLines } from './log-errors.js'"
      pattern: "printErrorLines\\("
    - from: "packages/xci/src/agent/index.ts"
      to: "packages/xci/src/log-errors.ts"
      via: "import { printErrorLines } from '../log-errors.js'"
      pattern: "printErrorLines\\("
    - from: "packages/xci/src/cli.ts line ~518"
      to: "logFile contents"
      via: "readFileSync(logFile, 'utf8') inside try/catch; pass to printErrorLines(content, logFile) BEFORE askShowLog"
      pattern: "printErrorLines\\(.*logFile"
    - from: "packages/xci/src/agent/index.ts handleDispatch onChunk"
      to: "outputBuffer (function-scoped let)"
      via: "outputBuffer += data BEFORE existing process.stdout/stderr.write + client?.send; trim from head if >2MB"
      pattern: "outputBuffer\\s*\\+=\\s*data"
    - from: "packages/xci/src/agent/index.ts handleDispatch onExit"
      to: "printErrorLines(outputBuffer, frame.run_id)"
      via: "Called AT THE TOP of onExit, only when exit_code !== 0, before runningRuns.delete + client?.send; then clear outputBuffer"
      pattern: "printErrorLines\\(outputBuffer"
---

<objective>
On failure (exit_code !== 0), extract lines matching /error/i from the captured output and print them to stderr BEFORE the askShowLog prompt (local CLI) or the result-frame send (remote agent daemon). A single shared helper lives at `packages/xci/src/log-errors.ts` and is consumed by both `packages/xci/src/cli.ts` and `packages/xci/src/agent/index.ts`.

Purpose: Give the user an immediate, scannable view of what went wrong without waiting for them to accept the show-log prompt (locally) or dig through log storage (remotely). Always on for failed commands; no flags, no env vars.

Output: One new source file + one new test file + two minimal edits to existing entry points. Behavior: on failure, up to 50 error-matching lines are dumped to stderr with a header and truncation footer; no writes at all on success or when no matches.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase. -->
<!-- Executor should use these directly — no codebase exploration needed. -->

From packages/xci/src/cli.ts (existing — the integration site):
```typescript
// Imports already present at top of file:
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
// NOTE: readFileSync is ALREADY imported — no new fs import needed.

// The integration site is inside registerAliases > sub.action, around line 518:
if (result.exitCode !== 0) {
  process.exitCode = result.exitCode;
  // On error, offer to show the log (if output was hidden)
  if (!showOutput) {
    const show = await askShowLog(logFile);
    if (show) printLogFile(logFile);
  }
}

// Nearby helper already in file (for reference — do NOT modify):
function printLogFile(logFile: string): void {
  try {
    const content = readFileSync(logFile, 'utf8');
    ...
  } catch { ... }
}
```

From packages/xci/src/agent/index.ts (existing — the integration site):
```typescript
// Runner callback contract (from runner.ts):
onChunk: (stream: 'stdout' | 'stderr', data: string, seq: number) => void;
onExit: (exitCode: number, durationMs: number, cancelled: boolean) => void;

// Data passed to onChunk is ALREADY REDACTED (per runner.ts line 161 via redactLine).
// Safe to buffer without re-redacting.

// Current handleDispatch spawn site (around line 279-309):
const handle = spawnTask(frame.run_id, {
  argv: taskArgv,
  cwd: process.cwd(),
  env: mergedEnv,
  redactionValues,
  onChunk: (stream, data, seq) => {
    if (stream === 'stdout') {
      process.stdout.write(data);
    } else {
      process.stderr.write(data);
    }
    client?.send({
      type: 'log_chunk',
      run_id: frame.run_id,
      seq,
      stream,
      data,
      ts: new Date().toISOString(),
    });
  },
  onExit: (exit_code, duration_ms, cancelled) => {
    state.runningRuns.delete(frame.run_id);
    client?.send({
      type: 'result',
      run_id: frame.run_id,
      exit_code,
      duration_ms,
      ...(cancelled ? { cancelled: true } : {}),
    });
  },
});
```

New module contract:
```typescript
// packages/xci/src/log-errors.ts
export function printErrorLines(output: string, source?: string): void;
// Splits output by /\r?\n/, filters /error/i matches, writes to process.stderr.
// No-op when zero matches OR empty input.
// Prints up to 50 matches; footer "(+N more — see full log)" if truncated.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task A: Create log-errors helper + tests + integrate both consumers</name>
  <files>
    packages/xci/src/log-errors.ts,
    packages/xci/src/__tests__/log-errors.test.ts,
    packages/xci/src/cli.ts,
    packages/xci/src/agent/index.ts
  </files>
  <behavior>
    Test 1 — empty input: `printErrorLines('')` writes nothing to stderr.
    Test 2 — no matches: `printErrorLines('ok\nfine\ndone')` writes nothing to stderr.
    Test 3 — 2 matches: `printErrorLines('ok\nerror: boom\nmore\nERROR!', 'task-123')` writes header
      containing "2 error line(s) in task-123", both error lines, and closing "---" separator.
    Test 4 — mixed case (ERROR, Error, error all match since /error/i): input with one of each
      produces exactly 3 matched lines in stderr output.
    Test 5 — 55 matches: input with 55 lines each containing "error" produces exactly 50 printed
      lines plus a footer line containing "(+5 more" in stderr output.
    Test 6 — no-source header variant: `printErrorLines('error: x')` (no source arg) header
      reads "--- 1 error line(s) ---" (no ` in ${source}` suffix).
  </behavior>
  <action>
    1. Create `packages/xci/src/log-errors.ts`:
       - Export `function printErrorLines(output: string, source?: string): void`.
       - Split: `const lines = output.split(/\r?\n/);`
       - Filter: `const matches = lines.filter((l) => /error/i.test(l));`
       - If `matches.length === 0` → return immediately (no stderr writes).
       - Use `process.stderr.write(...)` consistently (matches agent logging style).
       - Header: `--- ${matches.length} error line(s)${source ? ` in ${source}` : ''} ---\n`
       - Emit up to 50 lines: `for (const line of matches.slice(0, 50)) process.stderr.write(line + '\n');`
       - Truncation footer when `matches.length > 50`:
         `process.stderr.write(`(+${matches.length - 50} more — see full log)\n`);`
       - Closing separator: `process.stderr.write('---\n');`

    2. Create `packages/xci/src/__tests__/log-errors.test.ts` (vitest):
       - Import `printErrorLines` from `../log-errors.js`.
       - Use a stderr spy: `vi.spyOn(process.stderr, 'write').mockImplementation(() => true);`
         Restore with `spy.mockRestore()` in `afterEach`.
       - Assert `spy.mock.calls.flat().join('')` for content matchers and `spy.mock.calls.length`
         for count assertions.
       - Cover all 6 behaviors listed above.

    3. Integrate in `packages/xci/src/cli.ts`:
       - Add `import { printErrorLines } from './log-errors.js';` near existing imports
         (after the errors.js import block, alphabetical order is fine).
       - `readFileSync` is ALREADY imported from `node:fs` at line 2 — DO NOT add a duplicate.
       - Inside the `if (result.exitCode !== 0)` block (around line 518-524), BEFORE the
         `if (!showOutput) { const show = await askShowLog(logFile); ... }` branch, add:
         ```typescript
         try {
           const content = readFileSync(logFile, 'utf8');
           printErrorLines(content, logFile);
         } catch {
           // Missing/unreadable log file — silent fallback; askShowLog still offers the full log.
         }
         ```
       - Rationale for placement: print errors unconditionally on failure so the user sees them
         even when `--log`/`--verbose` already streamed output (redundant but harmless) and
         especially when output was hidden and the askShowLog prompt is about to appear.

    4. Integrate in `packages/xci/src/agent/index.ts` `handleDispatch`:
       - Add `import { printErrorLines } from '../log-errors.js';` near the top of the file
         (after the existing `import { normalizeAgentUrl } from './url.js';` line).
       - Inside `handleDispatch`, immediately before the `const handle = spawnTask(...)` call
         (i.e. after the `client.send({ type: 'state', state: 'running', ... })` line),
         declare a function-scoped buffer:
         ```typescript
         let outputBuffer = '';
         const MAX_OUTPUT_BUFFER = 2 * 1024 * 1024; // 2MB
         ```
       - In the existing `onChunk` callback, BEFORE the existing
         `if (stream === 'stdout') process.stdout.write(data); else process.stderr.write(data);`
         and BEFORE the `client?.send(...)`, append:
         ```typescript
         outputBuffer += data;
         if (outputBuffer.length > MAX_OUTPUT_BUFFER) {
           outputBuffer = outputBuffer.slice(-MAX_OUTPUT_BUFFER);
         }
         ```
       - In the existing `onExit` callback, AT THE TOP (before `state.runningRuns.delete(...)`
         and before `client?.send(...)`), add:
         ```typescript
         if (exit_code !== 0) {
           printErrorLines(outputBuffer, frame.run_id);
         }
         outputBuffer = ''; // release memory
         ```
       - HARD RULE: `outputBuffer` MUST be declared inside `handleDispatch` (as `let outputBuffer`
         inside the async function body). Do NOT hoist to module scope — concurrent runs under
         `--max-concurrent > 1` would share/corrupt the buffer. Per-dispatch isolation is
         part of the correctness contract.

    5. Commit everything together with message:
       `feat(xci): print error lines before show-log prompt on failure`
       Include all four files in the single commit.

    Strict prohibitions (enforced):
    - NO new files outside `packages/xci/src/log-errors.ts` and
      `packages/xci/src/__tests__/log-errors.test.ts`.
    - NO edits to `packages/server`, `packages/web`, `tsup.config.ts`, or any root config.
    - NO CLI flags, env vars, or runtime configuration — behavior is always on when
      exit_code !== 0.
    - DO NOT change the regex — it is `/error/i` per user spec.
    - DO NOT make `outputBuffer` module-level.
    - DO NOT re-redact in `printErrorLines` — agent data is already redacted upstream
      (runner.ts line 161), local log file is already the on-disk captured output.
    - DO NOT weaken earlier fixes — agent.mjs dynamic-import ref, <redacted> count,
      formatFrameForLog, parseYaml usage, and the no-error-frame-shape guard must still pass.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci test -- log-errors</automated>
  </verify>
  <done>
    - `packages/xci/src/log-errors.ts` exists and exports `printErrorLines`.
    - `packages/xci/src/__tests__/log-errors.test.ts` exists, all 6 cases green.
    - `packages/xci/src/cli.ts` imports `printErrorLines` from `./log-errors.js` and calls it
      inside the `if (result.exitCode !== 0)` block BEFORE the `askShowLog` prompt, wrapped
      in try/catch on the `readFileSync`.
    - `packages/xci/src/agent/index.ts` imports `printErrorLines` from `../log-errors.js`,
      declares `outputBuffer` INSIDE `handleDispatch`, appends in `onChunk` with 2MB trim,
      and calls `printErrorLines(outputBuffer, frame.run_id)` at the top of `onExit` when
      `exit_code !== 0` (before `runningRuns.delete` + `client?.send`), then clears the
      buffer.
    - Single atomic commit with message `feat(xci): print error lines before show-log prompt on failure`.
  </done>
</task>

<task type="auto">
  <name>Task B: Verify-only — typecheck, test, build, regression guards, new guards</name>
  <files>(no writes — verification only)</files>
  <action>
    Run the following checks from the repo root. NO commits, NO edits. Any failure means
    return to Task A to fix.

    1. Typecheck: `pnpm --filter xci typecheck` — MUST exit 0 with no errors.
    2. Full test suite: `pnpm --filter xci test` — MUST exit 0; the new `log-errors.test.ts`
       and all pre-existing tests green.
    3. Build: `pnpm --filter xci build` — MUST exit 0; produces `packages/xci/dist/cli.mjs`
       and `packages/xci/dist/agent.mjs`.

    4. Regression guards (pre-existing — same as quick task 260420-llo):
       - `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` MUST be >= 1
         (dynamic-import resolution intact).
       - `grep -c "<redacted>" packages/xci/dist/agent.mjs` MUST be >= 2
         (redaction markers present).
       - `grep -c "formatFrameForLog" packages/xci/dist/agent.mjs` MUST be >= 1
         (frame logging intact).
       - `grep -c "parseYaml" packages/xci/src/agent/index.ts` MUST be >= 1
         (shared DSL parser still used).
       - `grep -nE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" packages/xci/src/agent/index.ts`
         MUST return 0 matches (agent never emits error frames — dispatch rejects use
         `type: 'result'` with exit_code=-1).

    5. New guards (introduced by this plan):
       - `grep -c "printErrorLines" packages/xci/dist/cli.mjs` MUST be >= 1
         (helper bundled into local CLI).
       - `grep -c "printErrorLines" packages/xci/dist/agent.mjs` MUST be >= 1
         (helper bundled into agent daemon).
       - `grep -c "printErrorLines" packages/xci/src/log-errors.ts` MUST be >= 1
         (function exported from new source file; this is the source-of-truth check
         independent of whether tsup inlines or keeps the symbol under that name —
         the dist checks above are the runtime-presence proof).

    Report all 10 check results (3 build/test/typecheck + 5 regression + 3 new; note that
    the regression grep count adds to 5, so total distinct checks = 11) with pass/fail in
    the summary. On any failure, do NOT proceed — escalate back to Task A.

    No commit in this task.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci typecheck && pnpm --filter xci test && pnpm --filter xci build && grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs && grep -c "&lt;redacted&gt;" packages/xci/dist/agent.mjs && grep -c "formatFrameForLog" packages/xci/dist/agent.mjs && grep -c "parseYaml" packages/xci/src/agent/index.ts && ! grep -nE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" packages/xci/src/agent/index.ts && grep -c "printErrorLines" packages/xci/dist/cli.mjs && grep -c "printErrorLines" packages/xci/dist/agent.mjs && grep -c "printErrorLines" packages/xci/src/log-errors.ts</automated>
  </verify>
  <done>
    All 11 checks pass:
    - typecheck clean, test green, build success
    - 5 regression guards (agent.mjs ref count >=1, <redacted> count >=2, formatFrameForLog >=1, parseYaml >=1, no error-frame shape in src)
    - 3 new guards (printErrorLines present in dist/cli.mjs, dist/agent.mjs, src/log-errors.ts)
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| captured output → stderr | Output content (local log file OR remote agent onChunk stream) is echoed to the operator's stderr. Content originates from user-controlled command stdout/stderr. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260420-lxj-01 | I (Info Disclosure) | agent outputBuffer → printErrorLines | mitigate | Data passed to `onChunk` is already redacted by `redactLine` in `packages/xci/src/agent/runner.ts` line 161 (agent-local `.xci/secrets.yml` values, ≥4 chars, longest-first). `printErrorLines` consumes the already-redacted stream — no re-redaction needed, no new leak path. Buffer lives only in process memory, cleared on onExit. |
| T-260420-lxj-02 | I (Info Disclosure) | local cli.ts log file → printErrorLines | mitigate | Log file on disk is the captured stdout/stderr the user already sees when they accept `askShowLog`. No secret that wasn't already there is added to stderr; we are just surfacing a subset earlier. Secret redaction for local runs is D-08 server-side concern + D-24 agent-side; local CLI runs use executor redaction already baked into log file contents. |
| T-260420-lxj-03 | D (Denial of Service) | agent outputBuffer growth | mitigate | 2MB hard cap with head-trim: `if (outputBuffer.length > 2 * 1024 * 1024) outputBuffer = outputBuffer.slice(-2 * 1024 * 1024);` Prevents a runaway producer from exhausting agent memory over a long-running task. Buffer is scoped per-dispatch, cleared in onExit. |
| T-260420-lxj-04 | T (Tampering) | concurrent dispatches sharing buffer | mitigate | `outputBuffer` declared as `let` inside `handleDispatch` scope — JavaScript closure per invocation. Under `--max-concurrent > 1`, each dispatch gets its own buffer. Reviewer check: a grep for `let outputBuffer` outside handleDispatch must return 0. |
| T-260420-lxj-05 | D (DoS via large match set) | printErrorLines with millions of /error/ matches | accept | 50-line print cap already bounds stderr output. Filter step walks the full array once (O(n)); for 2MB input (≈bounded line count) this is microseconds. Not a realistic attack vector. |
</threat_model>

<verification>
Overall phase checks (executed in Task B):
- Unit tests: `pnpm --filter xci test` — new `log-errors.test.ts` + existing suite all green.
- Typecheck: `pnpm --filter xci typecheck` — clean.
- Build: `pnpm --filter xci build` — produces both dist bundles.
- 5 regression guards on dist bundles + source (agent.mjs ref, redacted marker, formatFrameForLog, parseYaml, no-error-frame).
- 3 new guards (printErrorLines in both dist bundles + in new source file).
- Cold-start budget unaffected: log-errors.ts is ~15 LOC pure JS, bundled into both entries; no new runtime deps.
</verification>

<success_criteria>
- Running `xci <alias>` where `<alias>` exits non-zero prints error-matching lines to stderr BEFORE the "Show log? [y/N]" prompt when output was hidden. No regression when output was streamed (extra printout is acceptable and expected).
- Running `xci --agent <url>` where a dispatched task exits non-zero prints error-matching lines to stderr on the agent host inside the onExit path, before the result frame reaches the server.
- `printErrorLines('')` and inputs with no `/error/i` matches produce zero stderr output.
- Truncation footer renders only when matches > 50.
- `outputBuffer` is never declared at module scope in `agent/index.ts` (grep: `^let outputBuffer` or `^const outputBuffer` at column 0 returns 0 matches).
- All 11 verification checks in Task B pass.
- Single atomic commit with message `feat(xci): print error lines before show-log prompt on failure` covering all four files.
</success_criteria>

<output>
After completion, create `.planning/quick/260420-lxj-print-error-lines-before-show-log-prompt/260420-lxj-SUMMARY.md`
</output>
