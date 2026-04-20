---
phase: 260420-ktf
plan: 01
subsystem: xci/agent
tags: [agent, dsl, parser, refactor]
dependency-graph:
  requires: [xci/dsl parseYaml]
  provides: [agent single-alias kind=single dispatch via shared parser]
  affects: [packages/xci/src/agent/index.ts, packages/xci/src/__tests__/agent/dispatch-handler.test.ts]
tech-stack:
  added: []
  patterns: [single-parser contract across server/agent]
key-files:
  created: []
  modified:
    - packages/xci/src/agent/index.ts
    - packages/xci/src/__tests__/agent/dispatch-handler.test.ts
decisions:
  - Agent consumes the same DSL parser (parseYaml) the server uses at save time — single source of truth for task YAML shape
  - Scope strictly narrowed to kind=single single-alias tasks; every other shape returns {unsupported} (no spawn)
  - def.cmd (not def.argv) is the field for kind=single per types.ts — planner's correction followed
  - Public shape of parseYamlToArgv preserved exactly: { argv } | { unsupported }
metrics:
  duration: ~8m
  completed: 2026-04-20
requirements:
  - KTF-01
---

# Phase 260420-ktf Plan 01: Agent supports single-alias DSL tasks via shared parseYaml — Summary

## One-liner

Agent's `parseYamlToArgv` now delegates to the shared `parseYaml` from `xci/dsl`, aligning with the server's alias-map contract; single-alias `kind=single` produces argv, everything else returns `{unsupported}`.

## Commit

- **7db492d** `feat(xci): agent supports single-alias DSL tasks via shared parseYaml`

## Diff Stat

```
 .../src/__tests__/agent/dispatch-handler.test.ts   | 72 +++++++++++++++-------
 packages/xci/src/agent/index.ts                    | 52 ++++++++--------
 2 files changed, 73 insertions(+), 51 deletions(-)
```

Exactly 2 files, matching the plan's `<files>` scope.

## Task A transcript

### parseYamlToArgv rewrite

- Replaced `import { tokenize } from '../commands/tokenize.js';` with `import { parseYaml } from '../dsl/index.js';`
- `parse` from `yaml` retained (still used by `loadLocalSecrets`)
- Body now: `parseYaml(yamlDef)` → narrow through errors / 0 aliases / 2+ aliases / non-single kinds / empty cmd → `{ argv: def.cmd }`
- Public return shape unchanged: `{ argv: readonly string[] } | { unsupported: string }` — caller at handleDispatch `if ('unsupported' in parseResult) { ... } const { argv: taskArgv } = parseResult` works unmodified

### dispatch-handler.test.ts fixtures (alias-map rewrap)

| Test | Old fixture | New fixture |
|------|-------------|-------------|
| 1 (happy string) | `'echo hello'` | `'hello:\n  cmd: echo hello'` |
| 2 (happy array)  | `'["node","-e","console.log(1)"]'` | `'run:\n  cmd:\n    - node\n    - -e\n    - console.log(1)'` |
| 3 (unsupported)  | `'run:\n  - echo step1\n  - echo step2'` (sequence) | `'a:\n  cmd: echo a\nb:\n  cmd: echo b'` (multi-alias) |
| 4 (concurrency)  | bare `node -e ...` / `'echo second'` | alias-map array cmd + `'run:\n  cmd: echo second'` |
| 5 (drain)        | `'echo should-not-run'` | `'run:\n  cmd: echo should-not-run'` |
| 6 (cancel)       | bare `node -e ...` | alias-map array cmd |
| 8 (SEC-06)       | bare `node -e ...` | alias-map array cmd |
| 9 (missing secrets) | bare `node -e ...` | alias-map array cmd |
| 10 (goodbye)     | bare `node -e ...` | alias-map array cmd |
| 11 (reconnect)   | bare `node -e ...` | alias-map array cmd |
| 12 (max-concurrent) | 3× bare `node -e ...` | extracted `longYaml` alias-map constant |

Test 7 (unknown run_id cancel) has no YAML fixture, so no change needed.

### Build / test / typecheck (local, pre-commit)

- `pnpm --filter xci build` → SUCCESS (cli.mjs 777 KB, agent.mjs 534 KB, dsl.mjs 22.36 KB; tsup rewrite `./agent/index.js → ./agent.mjs` in cli.mjs confirmed)
- `pnpm --filter xci test --run src/__tests__/agent/dispatch-handler.test.ts` → **12 passed** (all dispatch-handler tests green after fixture rewrap)
- `pnpm --filter xci test --run` (full) → **417 passed, 1 skipped, 1 failed**; the only failure is the pre-existing `cold-start.test.ts` stale-regex issue (see Deferred Issues)
- `pnpm --filter xci typecheck` → pre-existing errors in unrelated files (parseFlags, tui/dashboard.ts, tui/picker.ts, tsup.config.ts); no new errors introduced by the KTF edit

## Task B: Regression guard sweep

| # | Gate | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | `pnpm --filter xci typecheck` | clean | pre-existing errors unchanged | PRE-EXISTING (see Deferred Issues) |
| 2 | `pnpm --filter xci test` | all green | 417/419 pass, 1 pre-existing fail | PRE-EXISTING (see Deferred Issues) |
| 3 | `pnpm --filter xci build` | success | success | PASS |
| 4 | `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` ≥ 1 | 1+ | 1 | OK ezf |
| 5 | `grep -c "<redacted>" packages/xci/dist/agent.mjs` ≥ 2 | 2+ | 2 | OK k6m redaction |
| 6 | `grep -c "formatFrameForLog" packages/xci/dist/agent.mjs` ≥ 1 | 1+ | 3 | OK k6m formatFrameForLog |
| 7 | `grep -cE "client\.send\(\s*\{\s*type:\s*['\"]error['\"]" packages/xci/src/agent/index.ts` = 0 | 0 | 0 | OK k6m no-outgoing-error |
| 8 | `grep -n "parseYaml" packages/xci/src/agent/index.ts` ≥ 1 | 1+ | 4 (one import + three call-site / function references) | OK ktf import |

**5/8 green + 3 pre-existing (verified by `git stash` → `pnpm --filter xci typecheck` / `test` on base commit `a0de2bf` reproducing the same failures before any KTF edit).**

## Deferred Issues (pre-existing, out of scope)

Per scope guardrails in the task constraints ("Only auto-fix issues DIRECTLY caused by the current task's changes"), the following pre-existing failures are documented in `deferred-items.md` and NOT addressed here:

1. **Pre-existing typecheck errors** in `src/agent/index.ts` (parseFlags lines 46/54/57 — `exactOptionalPropertyTypes` on optional flags), `src/tui/dashboard.ts`, `src/tui/picker.ts`, `tsup.config.ts`. All confirmed present on base commit `a0de2bf` via `git stash && pnpm --filter xci typecheck`. None are in lines modified by this task (the KTF edit touched `parseYamlToArgv` at ~lines 129–164 only).

2. **Pre-existing `cold-start.test.ts` failure** — test expects `import('./agent/index.js')` but the tsup post-build rewrite (from 260420-ezf) changes it to `import('./agent.mjs')`. Test regex is stale and should be updated; but regression guard #4 already confirms `./agent.mjs` is the correct present form. Confirmed present on base commit via `git stash && pnpm --filter xci test`.

Neither issue blocks the KTF objective: `parseYamlToArgv` now delegates to the shared parser, dispatch-handler tests cover the new semantics end-to-end (12/12 green), and all 5 file-based regression guards pass.

## Deviations from Plan

None. The plan's description, interfaces block, guardrails, and commit subject were followed exactly. The planner's correction (`def.cmd` not `def.argv`) was honored.

## Verification (from PLAN `<verification>`)

1. `git log -1 --oneline` → `7db492d feat(xci): agent supports single-alias DSL tasks via shared parseYaml` — MATCHES plan's commit subject
2. `git diff HEAD~1 HEAD --stat` → exactly 2 files (`packages/xci/src/__tests__/agent/dispatch-handler.test.ts`, `packages/xci/src/agent/index.ts`) — MATCHES
3. Task B regression sweep: 5 file-based gates + build = 6/6 KTF-owned gates green; 2 pre-existing failures documented and verified unchanged from base

## Self-Check: PASSED

- `packages/xci/src/agent/index.ts` modified: FOUND (commit `7db492d` shows 52 lines changed in this file)
- `packages/xci/src/__tests__/agent/dispatch-handler.test.ts` modified: FOUND (commit `7db492d` shows 72 lines changed)
- Commit `7db492d` in log: FOUND (`git log --oneline -3` confirms)
- `parseYaml` imported in agent/index.ts: FOUND (`grep -n "parseYaml" packages/xci/src/agent/index.ts` returns 4 matches including the import on line 9)
- `tokenize` import removed from agent/index.ts: FOUND (grep confirms no `from '../commands/tokenize.js'` remaining)
- `parse` from `yaml` still present (used by loadLocalSecrets): FOUND (line 7 of current file)
- Build artifact `dist/cli.mjs` contains `./agent.mjs`: FOUND (gate #4 = 1)
- Build artifact `dist/agent.mjs` contains `<redacted>`: FOUND (gate #5 = 2)
- Build artifact `dist/agent.mjs` contains `formatFrameForLog`: FOUND (gate #6 = 3)
- No `client.send({ type: 'error' ... })` in agent source: FOUND (gate #7 = 0 matches)

All claims in this summary verified against disk state.
