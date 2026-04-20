---
phase: 260420-llo
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/agent/index.ts
autonomous: true
requirements:
  - QUICK-260420-llo
must_haves:
  truths:
    - "When the xci agent processes a dispatch frame, each task stdout line written by the child process appears on the agent's local terminal stdout in real time."
    - "When the xci agent processes a dispatch frame, each task stderr line written by the child process appears on the agent's local terminal stderr in real time."
    - "The server still receives log_chunk frames with identical content (already-redacted data)."
    - "Redaction of agent-local secrets is preserved in the locally-echoed output (no plaintext secret leaks on agent terminal)."
  artifacts:
    - path: "packages/xci/src/agent/index.ts"
      provides: "handleDispatch onChunk callback that writes to process.stdout/process.stderr before sending log_chunk to server"
      contains: "process.stdout.write"
  key_links:
    - from: "packages/xci/src/agent/index.ts (onChunk callback)"
      to: "process.stdout / process.stderr"
      via: "direct write of already-redacted chunk data"
      pattern: "process\\.(stdout|stderr)\\.write\\(data\\)"
    - from: "packages/xci/src/agent/runner.ts (emitChunk)"
      to: "packages/xci/src/agent/index.ts (onChunk callback)"
      via: "redactLine applied upstream at runner.ts:161 — data delivered to onChunk is already redacted"
      pattern: "redactLine\\(data, sortedValues\\)"
---

<objective>
Echo task stdout/stderr to the agent's local terminal in addition to streaming log_chunk frames to the server.

Purpose: Operators running the xci agent in the foreground currently have no visibility into what a dispatched task is doing — output only flows to the remote server. Adding a local echo gives immediate, human-readable feedback while preserving the server-side log stream unchanged. Data is already redacted in `runner.ts` before reaching `onChunk`, so no secret-leak concern applies.

Output: Two lines added to the `onChunk` callback in `packages/xci/src/agent/index.ts` that write the chunk `data` to the appropriate local stream.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@packages/xci/src/agent/index.ts
@packages/xci/src/agent/runner.ts

<interfaces>
<!-- Extracted from packages/xci/src/agent/runner.ts -->
<!-- The onChunk callback type the plan's target callsite conforms to. -->

From packages/xci/src/agent/runner.ts:
```typescript
// Data passed to onChunk is already redacted via redactLine() at runner.ts:161
// and already split into <=MAX_CHUNK_BYTES pieces.
onChunk: (stream: 'stdout' | 'stderr', data: string, seq: number) => void
```

Current callsite in packages/xci/src/agent/index.ts (handleDispatch, ~line 284-293):
```typescript
onChunk: (stream, data, seq) => {
  client?.send({
    type: 'log_chunk',
    run_id: frame.run_id,
    seq,
    stream,
    data,
    ts: new Date().toISOString(),
  });
},
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task A: Echo task stdout/stderr locally in handleDispatch onChunk</name>
  <files>packages/xci/src/agent/index.ts</files>
  <action>
In `packages/xci/src/agent/index.ts`, locate the `handleDispatch` function's call to `spawnTask(...)` (currently around line 279). Inside the `onChunk: (stream, data, seq) => { ... }` arrow callback, BEFORE the existing `client?.send({ type: 'log_chunk', ... })` call, add a local echo:

```typescript
onChunk: (stream, data, seq) => {
  // Echo to agent's local terminal (data is already redacted in runner.ts:161)
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
```

Rules:
- NO prefix, NO timestamp, NO color, NO buffering — raw passthrough.
- NO newline added by us; `data` already contains the line terminators emitted by the child process.
- NO CLI flag or env-var toggle — behaviour is always on.
- Do NOT modify `runner.ts`, `client.ts`, `types.ts`, any server file, or any file outside `packages/xci/src/agent/index.ts`.
- Do NOT modify the existing `client?.send(...)` call; the server stream must remain byte-identical to before.
- If existing tests in `packages/xci/src/__tests__/agent/dispatch-handler.test.ts` break because they now observe writes on `process.stdout`/`process.stderr`, the fix is in the TEST (spy/suppress the writes) — NOT in `index.ts`. Adjust only the offending test file; do not weaken the production change.

After editing, commit with:
`feat(xci): agent echoes task stdout/stderr to local terminal`
  </action>
  <verify>
    <automated>cd packages/xci &amp;&amp; grep -n "process\.stdout\.write(data)" src/agent/index.ts &amp;&amp; grep -n "process\.stderr\.write(data)" src/agent/index.ts</automated>
  </verify>
  <done>
- `packages/xci/src/agent/index.ts` contains `process.stdout.write(data)` and `process.stderr.write(data)` inside the `onChunk` callback of `handleDispatch`.
- The subsequent `client?.send({ type: 'log_chunk', ... })` call is unchanged and still executes for every chunk.
- No other file in the repo has been modified (except possibly `dispatch-handler.test.ts` if a pre-existing test needed to spy/suppress the new writes).
- Commit `feat(xci): agent echoes task stdout/stderr to local terminal` exists on the current branch.
  </done>
</task>

<task type="auto">
  <name>Task B: Verify — typecheck, tests, build, regression guards</name>
  <files>(verification only — no files modified, no commit)</files>
  <action>
Run the verification suite from the repo root. Do NOT commit anything in this task. If any check fails, STOP and report — do not attempt to fix by loosening checks.

1. Typecheck, test, build:
   ```bash
   pnpm -C packages/xci typecheck
   pnpm -C packages/xci test
   pnpm -C packages/xci build
   ```
   All three must exit 0.

2. Regression guards (each must satisfy the stated condition):
   ```bash
   # a) CLI bundle still references the built agent entry (dynamic import survives tsup bundling)
   test "$(grep -c "'\./agent\.mjs'" packages/xci/dist/cli.mjs)" -ge 1

   # b) Redaction logic still present in built agent bundle (at least 2 occurrences of <redacted> token)
   test "$(grep -c "<redacted>" packages/xci/dist/agent.mjs)" -ge 2

   # c) Frame log formatter still bundled into agent
   test "$(grep -c "formatFrameForLog" packages/xci/dist/agent.mjs)" -ge 1

   # d) No stray error-frame sends introduced in agent/index.ts
   test "$(grep -cE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" packages/xci/src/agent/index.ts)" -eq 0

   # e) YAML parsing call path preserved in agent/index.ts
   test "$(grep -c "parseYaml" packages/xci/src/agent/index.ts)" -ge 1
   ```
   All five guards must pass.

3. Report results back to the orchestrator:
   - typecheck: pass/fail
   - test: pass/fail (and count of tests run)
   - build: pass/fail
   - Each regression guard: pass/fail with actual count

Do NOT create a commit for this task — it is verification only.
  </action>
  <verify>
    <automated>pnpm -C packages/xci typecheck &amp;&amp; pnpm -C packages/xci test &amp;&amp; pnpm -C packages/xci build &amp;&amp; test "$(grep -c "'\./agent\.mjs'" packages/xci/dist/cli.mjs)" -ge 1 &amp;&amp; test "$(grep -c "&lt;redacted&gt;" packages/xci/dist/agent.mjs)" -ge 2 &amp;&amp; test "$(grep -c "formatFrameForLog" packages/xci/dist/agent.mjs)" -ge 1 &amp;&amp; test "$(grep -cE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" packages/xci/src/agent/index.ts)" -eq 0 &amp;&amp; test "$(grep -c "parseYaml" packages/xci/src/agent/index.ts)" -ge 1</automated>
  </verify>
  <done>
- `pnpm -C packages/xci typecheck` exits 0.
- `pnpm -C packages/xci test` exits 0 with all tests passing.
- `pnpm -C packages/xci build` exits 0 and produces `packages/xci/dist/cli.mjs` and `packages/xci/dist/agent.mjs`.
- All 5 regression guards (a–e) pass with the stated counts.
- No commit created by this task.
  </done>
</task>

</tasks>

<verification>
**End-to-end manual smoke (optional, not gating):**
1. Start server: `pnpm -C packages/xci dev:server` (or equivalent).
2. Start agent in a foreground terminal: `pnpm -C packages/xci dev:agent`.
3. Dispatch a task whose child produces stdout and stderr (e.g. a task that runs `node -e "console.log('hi'); console.error('err')"`).
4. Expected: the agent terminal shows `hi` on its stdout and `err` on its stderr, in real time, and the server still receives `log_chunk` frames with the same content.

**Automated guards (gating, Task B):**
- typecheck/test/build all green
- 5 regression guards pass
</verification>

<success_criteria>
- `packages/xci/src/agent/index.ts` writes task stdout to `process.stdout` and task stderr to `process.stderr` from inside the `handleDispatch` `onChunk` callback.
- The pre-existing `client?.send({ type: 'log_chunk', ... })` call is preserved byte-for-byte.
- No file outside `packages/xci/src/agent/index.ts` is modified (except possibly `packages/xci/src/__tests__/agent/dispatch-handler.test.ts` if strictly required to keep tests green).
- Typecheck, tests, and build pass.
- All 5 regression guards in Task B pass.
- Exactly one commit added on the branch with message `feat(xci): agent echoes task stdout/stderr to local terminal`.
</success_criteria>

<output>
After completion, create `.planning/quick/260420-llo-agent-echoes-task-stdout-stderr-to-local/260420-llo-01-SUMMARY.md`.
</output>
