---
task_id: 260420-mqy
description: Detect nested placeholders in param validator
status: complete
---

# Quick Task 260420-mqy

## Problem

`packages/xci/src/resolver/params.ts` extractPlaceholders used a naive regex `\$\{([^}]+)\}` that stopped at the first close brace. For nested placeholders like `${A.${B}|map:X}` it extracted zero names — validateParams never flagged B as missing, execution proceeded to runtime where the literal placeholder leaked into the command (e.g. into an AWS CLI call).

## Fix

Replace the regex with a brace-balanced scanner.
- `findMatchingClose(text, open)` — find the matching `}` respecting nested `{`/`}` pairs.
- `findTopLevelPipe(text)` — find `|` at depth 0 (strip modifier from inner).
- `extractPlaceholders(text)` — scan char-by-char. For `$${...}` skip the whole balanced group. For `${...}` use findMatchingClose to get the balanced content, then recurse if the key still contains `${`.

## Verification

- Added 6 new unit tests in `packages/xci/src/resolver/__tests__/params-nested-placeholders.test.ts`:
  - nested + map modifier → inner missing reported
  - nested fully provided → no throw
  - simple pipe modifier → missing reported without `|` in message
  - multiple top-level placeholders reported
  - unclosed brace → no crash
  - `$${...}` escape → no extraction
- All 44 resolver tests pass (38 existing + 6 new).

## Files

- Modified: `packages/xci/src/resolver/params.ts` (removed PLACEHOLDER_RE, added findMatchingClose + findTopLevelPipe, rewrote extractPlaceholders).
- New: `packages/xci/src/resolver/__tests__/params-nested-placeholders.test.ts`.

## Commit

`ec737a5` — fix(xci): detect nested placeholders in param validator
