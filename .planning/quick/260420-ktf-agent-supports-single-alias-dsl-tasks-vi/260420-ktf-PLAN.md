---
phase: 260420-ktf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/src/agent/index.ts
  - packages/xci/src/__tests__/agent/dispatch-handler.test.ts
autonomous: true
requirements:
  - KTF-01  # Agent parseYamlToArgv consumes shared DSL parser (single-alias, kind=single)

must_haves:
  truths:
    - "Server's single-alias YAML (e.g. 'hello:\\n  cmd: echo hi') dispatched by server parses on the agent and produces argv via the shared DSL parser"
    - "Multi-alias YAML (2+ top-level aliases) is rejected with a clear message; no spawn attempt"
    - "Non-single kinds (sequential/parallel/for_each/ini) are rejected with a clear 'kind=X not supported' message"
    - "Invalid YAML is rejected with the parser's error message (not a silent tokenize fallback)"
    - "All previous regression guards pass: 260420-ezf (agent.mjs dynamic import), 260420-k6m (redaction + formatFrameForLog + no outgoing type:'error'), 260420-j4r (ghost-cancel handler)"
  artifacts:
    - path: "packages/xci/src/agent/index.ts"
      provides: "parseYamlToArgv rewritten to call parseYaml from xci/dsl; tokenize import removed if unused"
      contains: "parseYaml"
    - path: "packages/xci/src/__tests__/agent/dispatch-handler.test.ts"
      provides: "Tests 1, 2, 3 updated to use alias-map YAML fixtures (e.g. '{hello: {cmd: echo hello}}')"
      contains: "cmd:"
  key_links:
    - from: "packages/xci/src/agent/index.ts"
      to: "packages/xci/src/dsl/parser.ts"
      via: "import { parseYaml } from '../dsl/index.js'"
      pattern: "import \\{ parseYaml \\} from '\\.\\./dsl/index\\.js'"
    - from: "packages/xci/src/agent/index.ts (parseYamlToArgv)"
      to: "handleDispatch caller"
      via: "returns { argv } | { unsupported: string } — unchanged public shape"
      pattern: "\\{ argv: readonly string\\[\\] \\} \\| \\{ unsupported: string \\}"
---

<objective>
Replace the agent's ad-hoc `parseYamlToArgv` (string → tokenize; array → direct; object → unsupported) with the shared DSL parser (`xci/dsl` `parseYaml`). The server validates all task YAML as an alias-map when saved, so the agent MUST consume the same shape the server ships. This aligns agent execution with the on-disk contract, fixes the mismatch the server→agent pipeline hit in 260420-k6m, and explicitly narrows scope to single-alias `kind=single` tasks.

Purpose: One parser, one shape, one source of truth between server and agent.
Output: `parseYamlToArgv` rewritten to call `parseYaml`; `kind=single` returns argv; everything else returns `{unsupported: string}`. Dispatch-handler tests updated to alias-map fixtures.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@packages/xci/src/agent/index.ts
@packages/xci/src/dsl/index.ts
@packages/xci/src/dsl/parser.ts
@packages/xci/src/types.ts
@packages/xci/src/__tests__/agent/dispatch-handler.test.ts

<interfaces>
<!-- Extracted contracts — executor uses these directly, no codebase spelunking needed. -->

From packages/xci/src/dsl/index.ts — `parseYaml` IS re-exported (confirmed):
```ts
export { parseYaml } from './parser.js';
```
Import path to use: `'../dsl/index.js'`.

From packages/xci/src/dsl/parser.ts — `parseYaml` signature:
```ts
export interface ParseResult {
  commands: CommandMap;              // ReadonlyMap<string, CommandDef>
  errors: ParseError[];              // { message: string; line?: number; column?: number }[]
}
export function parseYaml(text: string): ParseResult;
```

From packages/xci/src/types.ts — `CommandDef` union, `kind='single'` shape:
```ts
type CommandDef =
  | { readonly kind: 'single'; readonly cmd: readonly string[]; ... }   // NB: field is `cmd`, NOT `argv`
  | { readonly kind: 'sequential'; ... }
  | { readonly kind: 'parallel'; ... }
  | { readonly kind: 'for_each'; ... }
  | { readonly kind: 'ini'; ... };
type CommandMap = ReadonlyMap<string, CommandDef>;
```
**IMPORTANT:** The plan-constraint snippet used `def.argv` but the real field on `kind='single'` is `def.cmd`. Use `def.cmd` (see final code block below).

From packages/xci/src/agent/index.ts — current public shape of `parseYamlToArgv` (MUST PRESERVE):
```ts
function parseYamlToArgv(yamlDef: string): { argv: readonly string[] } | { unsupported: string };
```
Caller at line ~255 does `if ('unsupported' in parseResult) { ...reject... } const { argv: taskArgv } = parseResult;` — do not change the return shape.
</interfaces>

<regression_guards>
- 260420-ezf: `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` ≥ 1
- 260420-k6m redaction helper: `grep -c "<redacted>" packages/xci/dist/agent.mjs` ≥ 2
- 260420-k6m frame logger: `grep -c "formatFrameForLog" packages/xci/dist/agent.mjs` ≥ 1
- 260420-k6m crash fix (no outgoing type:'error' frames from agent): `grep -nE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" packages/xci/src/agent/index.ts` = 0
- Import present: `grep -n "parseYaml" packages/xci/src/agent/index.ts` ≥ 1
</regression_guards>
</context>

<tasks>

<task type="auto">
  <name>Task A: Rewrite parseYamlToArgv to use shared DSL parseYaml; update dispatch-handler tests to alias-map fixtures; commit</name>
  <files>packages/xci/src/agent/index.ts, packages/xci/src/__tests__/agent/dispatch-handler.test.ts</files>
  <action>
Edit `packages/xci/src/agent/index.ts`:

1. Add import near the top of the file, alongside the existing agent imports:
```ts
import { parseYaml } from '../dsl/index.js';
```
(`parseYaml` IS re-exported from `../dsl/index.js` — verified in the `<interfaces>` block above. Import from the barrel, not the parser, per D-02 public API surface.)

2. Remove the now-unused `tokenize` import:
```ts
// DELETE:
import { tokenize } from '../commands/tokenize.js';
```
Only `parseYamlToArgv` used `tokenize` (grep-verified: 3 matches, all in the function being replaced). `parse` from `yaml` must STAY — it is still used by `loadLocalSecrets` at ~line 115.

3. Replace the entire body of `parseYamlToArgv` (currently ~lines 133–168) with:
```ts
/**
 * Parse yaml_definition string into argv.
 * Consumes the shared DSL parser so the agent sees exactly what the server validated on save.
 * Phase 10 agent supports SINGLE-ALIAS tasks with kind=single only.
 */
function parseYamlToArgv(
  yamlDef: string,
): { argv: readonly string[] } | { unsupported: string } {
  const result = parseYaml(yamlDef);
  if (result.errors.length > 0) {
    const first = result.errors[0];
    return { unsupported: `invalid task YAML: ${first ? first.message : 'unknown parse error'}` };
  }
  if (result.commands.size === 0) {
    return { unsupported: 'task YAML has no alias defined' };
  }
  if (result.commands.size > 1) {
    return {
      unsupported: `task YAML has ${result.commands.size} aliases — agent runs single-alias tasks only`,
    };
  }
  const entry = result.commands.entries().next().value;
  if (!entry) {
    return { unsupported: 'task YAML has no alias defined' };
  }
  const [aliasName, def] = entry;
  if (def.kind !== 'single') {
    return {
      unsupported: `alias '${aliasName}' is kind=${def.kind} — agent supports kind=single only`,
    };
  }
  if (def.cmd.length === 0) {
    return { unsupported: `alias '${aliasName}' has empty cmd` };
  }
  return { argv: def.cmd };
}
```

Notes on the code above (addressing the plan-constraint snippet):
- The constraint text referenced `def.argv` — that's incorrect for `kind='single'`. The real field per `types.ts` is `def.cmd: readonly string[]`. Used `def.cmd` throughout.
- Phrase "Phase 10 agent" softened to "agent" — this refactor supersedes the Phase-10 comment in the old code; agent runs single-alias tasks because the DSL parser is the contract, not because of a phase marker.
- `.entries().next().value` picked over array-destructuring (`const [[aliasName, def]] = result.commands;`) because `Map.entries()` has no iterator-destructure type under `verbatimModuleSyntax` + strict tsc. Falsy guard (`if (!entry)`) is redundant after `size === 0`/`size > 1` narrowing but keeps tsc happy (noUncheckedIndexedAccess).

Edit `packages/xci/src/__tests__/agent/dispatch-handler.test.ts`:

The DSL parser now rejects plain strings (`'echo hello'`), bare JSON arrays (`'["node", "-e", ...]'`), and the `run:` sequence YAML — these are no longer valid top-level shapes. Update fixtures to alias-map YAML so the parser accepts them:

- **Test 1** (line ~175, `dispatch: string yaml_definition → ...`):
  - OLD fixture: `'echo hello'`
  - NEW fixture: `'hello:\n  cmd: echo hello'`
  - Rename describe text from `string yaml_definition` → `single-alias yaml_definition (string cmd)`
  - Body assertions unchanged (exit_code=0, run-1, log contains "hello")

- **Test 2** (line ~200, `dispatch: array yaml_definition → ...`):
  - OLD fixture: `'["node", "-e", "console.log(1)"]'`
  - NEW fixture: `'run:\n  cmd:\n    - node\n    - -e\n    - console.log(1)'`
  - Rename describe text from `array yaml_definition` → `single-alias yaml_definition (array cmd)`
  - Body assertions unchanged (exit_code=0)

- **Test 3** (line ~214, `dispatch: sequence yaml → ...`):
  - OLD fixture: `'run:\n  - echo step1\n  - echo step2'` (a sequence)
  - NEW fixture: `'a:\n  cmd: echo a\nb:\n  cmd: echo b'` (multi-alias — still unsupported)
  - Rename describe text from `sequence yaml → ... (unsupported)` → `multi-alias yaml → ... (unsupported)`
  - Body assertions unchanged (exit_code=-1, duration_ms=0, cancelled=undefined)

If other tests in the file feed plain strings (e.g. `'echo second'`, `'node -e "..."'`) and those shapes were relying on the old tokenize-string path, wrap them similarly: `'run:\n  cmd: echo second'`. Check tests 4 (concurrency), 5 (drain), 6 (cancel) — each makeDispatchFrame call needs its YAML wrapped in an alias-map. Apply the same pattern: one alias name (e.g. `run`) with a `cmd:` string or array.

**Scope guardrails (DO NOT violate):**
- Edit ONLY the two files listed in `<files>`. Server code, `packages/xci/src/dsl/**`, `types.ts`, `client.ts`, `runner.ts`, `tsup.config.ts` — off-limits.
- Do NOT widen support to sequential/parallel/for_each/ini/set — explicitly out of scope. Those return `{unsupported}` with `kind=X` in the message.
- Do NOT remove or weaken the redaction helper (`<redacted>`), the frame logger (`formatFrameForLog`), the ghost-cancel handler (stale `cancel` → synthetic result), or the no-outgoing-type:'error' invariant.
- Keep the public shape of `parseYamlToArgv` identical: `{ argv: readonly string[] } | { unsupported: string }`.

Build + typecheck + test locally, then commit:
```bash
pnpm --filter xci typecheck
pnpm --filter xci test
pnpm --filter xci build
```

Commit (single atomic commit) with:
```
feat(xci): agent supports single-alias DSL tasks via shared parseYaml
```

Body: one-line rationale — agent and server now consume the same parser; single-alias kind=single only, everything else rejected with a clear message.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci typecheck && pnpm --filter xci test && pnpm --filter xci build</automated>
  </verify>
  <done>
- `packages/xci/src/agent/index.ts` imports `parseYaml` from `../dsl/index.js`
- `tokenize` import removed from `agent/index.ts` (no remaining uses)
- `parseYamlToArgv` body replaced; returns `{argv}` only for `kind='single'`; returns `{unsupported: string}` for parse errors, 0 aliases, 2+ aliases, non-single kinds, empty cmd
- `parse` from `yaml` still imported (used by `loadLocalSecrets`)
- Dispatch-handler tests 1-3 (and 4-6 as needed) rewritten to alias-map fixtures; all green
- `pnpm --filter xci typecheck` clean
- `pnpm --filter xci test` all green
- `pnpm --filter xci build` success
- One atomic commit with subject `feat(xci): agent supports single-alias DSL tasks via shared parseYaml`
  </done>
</task>

<task type="auto">
  <name>Task B: Regression verification sweep (no commit)</name>
  <files></files>
  <action>
Run every regression guard from the `<regression_guards>` block. No edits, no commit — this task proves Task A did not break prior fixes.

Execute each command from the repo root (`/home/developer/projects/loci`) and confirm the expected outcome. If ANY check fails, STOP and report which check failed — do not proceed to declare completion.

```bash
# 1. Typecheck clean
pnpm --filter xci typecheck

# 2. All tests green
pnpm --filter xci test

# 3. Build succeeds
pnpm --filter xci build

# 4. 260420-ezf: agent.mjs dynamic-import marker preserved in cli.mjs
test "$(grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs)" -ge 1 && echo 'OK ezf'

# 5. 260420-k6m: redaction marker preserved in agent.mjs (expect ≥ 2 occurrences)
test "$(grep -c "<redacted>" packages/xci/dist/agent.mjs)" -ge 2 && echo 'OK k6m redaction'

# 6. 260420-k6m: frame-logger helper preserved in agent.mjs
test "$(grep -c "formatFrameForLog" packages/xci/dist/agent.mjs)" -ge 1 && echo 'OK k6m formatFrameForLog'

# 7. 260420-k6m: no outgoing type:'error' frames from agent source
test "$(grep -nE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" packages/xci/src/agent/index.ts | wc -l)" -eq 0 && echo 'OK k6m no-outgoing-error'

# 8. KTF import present: parseYaml in agent source
grep -n "parseYaml" packages/xci/src/agent/index.ts && echo 'OK ktf import'
```

All eight must print their `OK` marker (or pass silently for pnpm steps). Report the full transcript in the summary.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci typecheck && pnpm --filter xci test && pnpm --filter xci build && test "$(grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs)" -ge 1 && test "$(grep -c "<redacted>" packages/xci/dist/agent.mjs)" -ge 2 && test "$(grep -c "formatFrameForLog" packages/xci/dist/agent.mjs)" -ge 1 && test "$(grep -cE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" packages/xci/src/agent/index.ts)" -eq 0 && grep -q "parseYaml" packages/xci/src/agent/index.ts && echo ALL-REGRESSION-GUARDS-PASS</automated>
  </verify>
  <done>
- All 8 regression checks pass
- Final verify command prints `ALL-REGRESSION-GUARDS-PASS`
- No commit from this task (Task A's commit is the only one)
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| server → agent (WS dispatch frame) | `task_snapshot.yaml_definition` crosses here; previously consumed by ad-hoc parser, now by shared DSL parser. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ktf-01 | T (Tampering) | `parseYamlToArgv` return → `spawnTask(argv)` | mitigate | `parseYaml` → `normalizeCommands` validates alias-map structure server-side on save AND agent-side on dispatch; malformed or non-single kinds cannot reach spawn (returns `{unsupported}` branch which sends result exit_code=-1, no process spawn). |
| T-ktf-02 | D (Denial of Service) | parse-heavy YAML from server | accept | Same attack surface as before — the old `yaml.parse` was already exposed. No amplification; `parseYaml` is at worst slightly slower due to `normalizeCommands`, not unbounded. |
| T-ktf-03 | I (Information Disclosure) | error-message content in `{unsupported: ...}` | accept | Errors contain parser messages (YAML line/col) and alias names — no secrets, no env, no file paths beyond what was already in yaml_definition. Routed to stderr + result-frame only (no error-frame sent — 260420-k6m invariant preserved). |
</threat_model>

<verification>
After Task A commits and Task B verifies, confirm:

1. `git log -1 --oneline` shows `feat(xci): agent supports single-alias DSL tasks via shared parseYaml`
2. `git diff HEAD~1 HEAD --stat` shows exactly 2 files changed (agent/index.ts + dispatch-handler.test.ts)
3. Task B's verify command prints `ALL-REGRESSION-GUARDS-PASS`
</verification>

<success_criteria>
- Single-alias YAML with `kind=single` (string or array `cmd`) dispatches and runs; exit_code matches the child process.
- Multi-alias YAML, non-single kinds, and invalid YAML are rejected via a `result` frame with `exit_code=-1, duration_ms=0`; no `error` frame is sent from the agent (260420-k6m invariant).
- Shared parser (`parseYaml` from `xci/dsl`) is the SOLE parse path in the agent; no residual tokenize/ad-hoc fallback.
- `parse` from `yaml` remains imported (used by `loadLocalSecrets`); no other unused imports.
- One atomic commit; no changes outside the two declared files.
- All prior regression guards green.
</success_criteria>

<output>
After completion, create `.planning/quick/260420-ktf-agent-supports-single-alias-dsl-tasks-vi/260420-ktf-SUMMARY.md` capturing:
- Commit SHA
- Files changed (exact diff stat)
- Test transcript (typecheck + test + build)
- Regression guard transcript (all 8 checks)
- Any deviations from the plan and why
</output>
