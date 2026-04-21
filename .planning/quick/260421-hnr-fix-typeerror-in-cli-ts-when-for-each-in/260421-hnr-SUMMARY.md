---
phase: quick-260421-hnr
plan: 01
subsystem: xci-cli
tags: [regression, for_each, cli-display, type-narrowing]
requires:
  - quick-260421-ewq (widened for_each.in type to readonly string[] | string)
provides:
  - for_each.in display paths tolerate both array and string forms
affects:
  - packages/xci/src/cli.ts
  - packages/xci/src/__tests__/cli.e2e.test.ts
tech_stack:
  added: []
  patterns:
    - "Array.isArray narrowing at display sites where the union type is observable"
key_files:
  created: []
  modified:
    - packages/xci/src/cli.ts
    - packages/xci/src/__tests__/cli.e2e.test.ts
decisions:
  - "Inline Array.isArray ternary at both sites rather than extract a shared helper — the two sites differ in output framing (push-to-array vs. stderr write with adjacent fields); inlining keeps the surrounding prose visible at the call site."
  - "Wrap each for_each case in braces ({ ... }) so the new const inDisplay has proper block scope and Biome doesn't flag a lexical declaration inside a bare case."
metrics:
  duration: "~10 min"
  completed: "2026-04-21T12:54:19Z"
  commit: 86ff3a3
---

# Phase quick-260421-hnr Plan 01: Fix TypeError in cli.ts when for_each.in is a string Summary

Restored xci startup, `--list`, and `--help` to non-crashing behavior when any `for_each` alias declares `in: "${VAR}"` (the string form added in quick-260421-ewq), while preserving the existing bracketed display for array-form `in`.

## What Changed

### `packages/xci/src/cli.ts` — two display sites

**Site 1: `buildAliasHelpText` (for_each branch, now lines 175–182)**

Before:
```ts
case 'for_each':
  lines.push(`  var: ${def.var}`);
  lines.push(`  in: [${def.in.join(', ')}]`);
  lines.push(`  mode: ${def.mode}`);
  ...
  break;
```

After:
```ts
case 'for_each': {
  const inDisplay = Array.isArray(def.in) ? `[${def.in.join(', ')}]` : def.in;
  lines.push(`  var: ${def.var}`);
  lines.push(`  in: ${inDisplay}`);
  lines.push(`  mode: ${def.mode}`);
  ...
  break;
}
```

This function runs at commander registration (cli.ts:357, `.addHelpText('after', buildAliasHelpText(alias, def))`) for every alias in commands.yml, so a single string-form `for_each` alias previously crashed xci before any argv parsing or dispatch.

**Site 2: `printAliasDetails` (for_each branch, now lines 241–247)**

Before:
```ts
case 'for_each':
  process.stderr.write(`  var: ${def.var}  in: [${def.in.join(', ')}]  mode: ${def.mode}\n`);
  ...
  break;
```

After:
```ts
case 'for_each': {
  const inDisplay = Array.isArray(def.in) ? `[${def.in.join(', ')}]` : def.in;
  process.stderr.write(`  var: ${def.var}  in: ${inDisplay}  mode: ${def.mode}\n`);
  ...
  break;
}
```

This path runs only on `--list`, so the failure was narrower than Site 1 but still user-visible.

### `packages/xci/src/__tests__/cli.e2e.test.ts` — 4 regression tests

Added a new describe block `quick-260421-hnr: for_each.in display (string + array forms)` with these cases:

1. `--list renders for_each.in string form without brackets` — asserts `stderr` contains `in: ${ITEMS}` (raw placeholder, no brackets) and no `TypeError`.
2. `per-alias --help renders for_each.in string form without brackets` — asserts `stdout` contains `in: ${ITEMS}` and no `TypeError` on either stream.
3. `startup does not crash when for_each.in uses string form (registration regression)` — the critical witness: project has both a string-form for_each alias and an unrelated `hello` alias; invoking `hello` exits 0 with `hi` in stdout, proving `buildAliasHelpText` no longer throws at registration.
4. `--list renders for_each.in array form with brackets (no over-fix)` — asserts `stderr` contains `in: [a, b, c]` exactly, guarding against regressing the existing format.

All four tests use the existing `runCliInDir`, `createTempProject`, and `trackDir` helpers — no new infrastructure.

## Verification

### Test suite result

`cd packages/xci && npx vitest run`:
- **503 passed**, 1 failed, 1 skipped (505 total).
- The single failure is the pre-existing `cold-start.test.ts` test documented as baseline-stable in the plan.
- No new regressions in `cli.e2e.test.ts` (46 pass), `commands.test.ts` (67 pass), `resolver.test.ts` (57 pass), or `output.test.ts` (32 pass).
- Test count baseline: **499 → 503** (exactly the 4 new regression tests).

### Scope discipline

`git diff --stat HEAD~1 HEAD`:
```
 packages/xci/src/__tests__/cli.e2e.test.ts | 86 ++++++++++++++++++++++++++++++
 packages/xci/src/cli.ts                    | 12 +++--
 2 files changed, 94 insertions(+), 4 deletions(-)
```

Exactly 2 files modified as required. No deletions.

### Done criteria

- `cli.ts:177` and `cli.ts:240` (original bug lines) no longer call `.join` on `def.in` unconditionally — both sites now go through `inDisplay`.
- `grep def\.in\.join packages/xci/src/cli.ts` returns only matches guarded by `Array.isArray(def.in)` (lines 176 and 242).
- 4 new regression tests exist with `quick-260421-hnr` in their names.
- Single atomic commit: `86ff3a3` — `fix(quick-260421-hnr): guard for_each.in display sites against string form`.

## Deviations from Plan

None — plan executed exactly as written. The plan's suggestion to "check first without braces, add only if lint errors" resolved in favor of braces because the `const inDisplay` declaration inside a bare case would require either braces or hoisting, and the braced variant is the standard workaround Biome expects for case-scoped lexical declarations.

## Known Stubs

None.

## Threat Flags

None — purely defensive fix restoring existing behavior for a new input variant.

## Self-Check

**Files verified:**
- `/home/developer/projects/loci/.claude/worktrees/agent-a7cb18e0/packages/xci/src/cli.ts` — FOUND
- `/home/developer/projects/loci/.claude/worktrees/agent-a7cb18e0/packages/xci/src/__tests__/cli.e2e.test.ts` — FOUND
- `/home/developer/projects/loci/.claude/worktrees/agent-a7cb18e0/.planning/quick/260421-hnr-fix-typeerror-in-cli-ts-when-for-each-in/260421-hnr-SUMMARY.md` — FOUND (this file)

**Commit verified:**
- `86ff3a3` — present in `git log --oneline`

## Self-Check: PASSED
