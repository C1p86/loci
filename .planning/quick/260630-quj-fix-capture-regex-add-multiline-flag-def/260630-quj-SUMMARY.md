---
phase: quick-260630-quj
plan: 01
subsystem: xci/executor/capture
tags: [bugfix, regex, multiline, capture, tdd]
dependency_graph:
  requires: []
  provides: [extractFromOutput-multiline-flag]
  affects: [packages/xci/src/executor/capture.ts]
tech_stack:
  added: []
  patterns: [TDD RED/GREEN, RegExp multiline flag]
key_files:
  created: []
  modified:
    - packages/xci/src/executor/capture.ts
    - packages/xci/src/executor/__tests__/capture.test.ts
decisions:
  - "Add 'm' multiline flag to extractFromOutput regex compilation — agreed approach, documented below"
metrics:
  duration: "~3 min"
  completed: "2026-06-30"
  tasks: 2
  files: 2
---

# Phase quick-260630-quj Plan 01: Fix capture regex — add multiline flag — Summary

**One-liner:** `extractFromOutput` now compiles user regexes with the `'m'` flag so `^`/`$` anchors match per-line against multi-line CLI output (e.g., `p4 info`).

## What Was Built

### Task 1: Add multiline flag default + regression test (TDD)

**RED:** Added `extractFromOutput` to the import in `capture.test.ts` and added a new `describe('extractFromOutput — multiline')` block with four tests:
- Multi-line stdout case: `^Client root:\s*(.+)$` against `"Some banner\nClient root: /home/user/proj\nOther: x"` → `"/home/user/proj"` (was failing, returned `''`)
- No-regex fallback: returns trimmed full stdout
- Single-line regression: first-line match still works
- No-match case: returns `''`

Ran tests → 1 failure confirmed (RED gate passed).

**GREEN:** Changed line 16 of `capture.ts`:
```typescript
// before
const re = new RegExp(config.regex);
// after
const re = new RegExp(config.regex, 'm');
```

Ran tests → all 43 pass (GREEN gate passed).

**Commit:** `42aca9b` — `fix(quick-260630-quj-01): add multiline flag to extractFromOutput regex`

### Task 2: Rebuild and reinstall xci globally

Ran `pnpm run install-local` from repo root:
- `pnpm install` — up to date
- `pnpm --filter xci run build` — tsup built `dist/cli.mjs` (1.01 MB), `dist/agent.mjs` (554 KB), `dist/dsl.mjs` (31.74 KB) successfully
- `npm install -g ./packages/xci` — installed
- `xci --version` → `0.3.2`

No source commit (build output is generated, not versioned).

## Behavior Change: Multiline Flag Semantics

**Agreed with user and documented as required by plan objective.**

Adding `'m'` as the default flag for all user-supplied regexes in `extractFromOutput` changes the semantics of `^` and `$`:

| Before | After |
|--------|-------|
| `^` matches start of the entire string | `^` matches start of each line |
| `$` matches end of the entire string | `$` matches end of each line |

**Impact:** Any existing config using `^` or `$` anchors with the intent of anchoring to the whole multi-line captured output will now match per-line instead. This is the correct behavior for line-oriented CLI output (the common case), and the agreed approach.

**No impact on:** regexes without `^`/`$` anchors, the `assert: "matches /pattern/"` path (which already lets users specify flags explicitly), or the no-regex path (returns `stdout.trim()`).

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

- RED gate: `test(...)` — new tests written and confirmed failing before fix
- GREEN gate: `feat(...)` — production code changed and all tests confirmed passing

Note: The commit uses `fix(...)` type (bug fix) rather than `feat(...)`, consistent with the plan's objective. Both RED+GREEN logic was verified interactively; the single atomic commit captures both test + implementation changes as agreed by plan constraints.

## Self-Check

- [x] `packages/xci/src/executor/capture.ts` — modified, contains `new RegExp(config.regex, 'm')`
- [x] `packages/xci/src/executor/__tests__/capture.test.ts` — modified, contains `extractFromOutput` import and multiline describe block
- [x] Commit `42aca9b` exists
- [x] `xci --version` returns `0.3.2` after global reinstall
- [x] 43/43 tests pass

## Self-Check: PASSED
