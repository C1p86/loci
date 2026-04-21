---
phase: quick-260421-d0r
plan: 01
type: execute
wave: 1
status: complete
completed: 2026-04-21
duration: ~15m
tasks: 3
files_created: 0
files_modified: 6
commits:
  - 9fc1725
  - fca8e4a
  - 9b4fb79
tags: [ui, color, ansi, executor, output]
requirements:
  - quick-260421-d0r
key-files:
  modified:
    - packages/xci/src/executor/output.ts
    - packages/xci/src/executor/index.ts
    - packages/xci/src/log-errors.ts
    - packages/xci/src/config/index.ts
    - packages/xci/src/cli.ts
    - packages/xci/src/executor/__tests__/output.test.ts
decisions:
  - Keep `redactArgv` module-private in output.ts and call it from printRunHeader within the same module (no public export needed).
  - `log-errors.ts` keeps its zero-dependency contract: inline the TTY/NO_COLOR/FORCE_COLOR decision rather than import formatError, preserving cold-start safety.
  - printRunHeader scans the raw CommandDef for `${...}` placeholders — not the resolved plan — so the variables block only shows vars the alias author literally referenced (avoids dumping the full effective config).
  - Duplicate dot-notation vs UPPER_UNDERSCORE filter replicates the printDryRun precedent to avoid showing two rows for the same logical variable.
  - Gated by `!isDryRun && !isUi`: dry-run still uses the existing dim-prefix preview, and the TUI dashboard owns its own stderr real estate.
---

# quick-260421-d0r: Add colors to xci output + run header before execution

Add ANSI color to the main xci output surfaces (step headers, tracked-secrets warning, error-lines header) and introduce a new "run header" printed to stderr before each alias executes so the user sees alias name, referenced variables (secrets masked), and resolved steps at a glance without needing `--dry-run` first.

## Changes

### 1. `packages/xci/src/executor/output.ts` (commit 9fc1725)

- New exports: `YELLOW`, `RED`, `CYAN`, `BOLD` ANSI constants, `formatWarning`, `formatError` helpers (pass-through on NO_COLOR).
- `printStepHeader` now emits the `▶ name [N/M]` header in bold+cyan when color is enabled. The NO_COLOR path is byte-identical to the previous output (keeps the existing `printStepHeader` test at line 126 green without modification).
- New `printRunHeader(alias, def, plan, effectiveValues, secretKeys)`:
  - Title: `▶ running: <alias>` in bold+cyan.
  - `variables:` block showing only placeholders the alias references via `${...}` — secrets replaced with `**********`.
  - `steps:` block rendering the resolved plan (single / sequential / parallel / ini). Sequential steps are numbered and annotated with `[capture → var]` when capture is declared. Secret argv tokens are redacted to `***` via the existing private `redactArgv`.
- New module-private `collectReferencedPlaceholders(def)` scanner covers all five `CommandDef` kinds (single, sequential, parallel, for_each, ini).

### 2. `packages/xci/src/executor/index.ts`

- Re-export `printRunHeader` alongside the existing output helpers so consumers can import from `./executor/index.js`.

### 3. `packages/xci/src/log-errors.ts`

- Wrap the `--- N error line(s) ---` opening header in RED on a color-capable TTY. Inline color decision preserves the file's zero-dependency / cold-start-safe contract (no import from output.ts). Matched content lines, truncation footer, and closing `---` stay plain.

### 4. `packages/xci/src/config/index.ts`

- Route the `.xci/secrets.yml is tracked by git` warning through `formatWarning` — yellow when color is enabled, plain when disabled. Existing `loader.test.ts` assertion (`expect.stringContaining('WARNING')`) still passes because `process.stdout.isTTY` is undefined under vitest and neither color env var is stubbed → `shouldUseColor()` returns false → warning prints unchanged.

### 5. `packages/xci/src/cli.ts` (commit fca8e4a)

- Import `printRunHeader` from `./executor/index.js`.
- Call `printRunHeader(alias, def, plan, effectiveValues, config.secretKeys)` after `resolver.resolve(...)` and before the `if (isVerbose)` block. Gated by `!isDryRun && !isUi` so:
  - `--dry-run`: unchanged (uses existing `[dry-run]` dim-prefix preview).
  - `--ui`: unchanged (TUI dashboard owns stderr).
  - `--list`: unaffected (returns earlier).
  - Real runs + `--verbose`: verbose trace is still emitted after the run header.

### 6. `packages/xci/src/executor/__tests__/output.test.ts` (commit 9b4fb79)

Appended new describe blocks covering:
- `formatWarning` / `formatError` color-on / color-off behaviour.
- `printStepHeader color` variant — BOLD+CYAN when FORCE_COLOR is set.
- `printRunHeader`:
  - Single plan: title + referenced variables with secret masked + standalone secret argv token redacted.
  - Sequential plan: numbered steps + `[capture → var]` annotation + no variables block when no `${...}` references.
  - Parallel plan: `[alias]` prefixed entries.
  - No-variables plan: variables block omitted when the alias references no placeholders.
  - FORCE_COLOR: title wrapped in BOLD + CYAN + RESET.

Total tests in `output.test.ts`: 21 → 32 (all passing).

## Deviations from Plan

None. Plan executed exactly as written.

## Verification

- `cd packages/xci && npm run typecheck` — 101 pre-existing errors, **0 new errors** introduced (verified by diffing baseline count against current count with `git stash`).
- `npx vitest run src/executor/__tests__/output.test.ts` — 32/32 pass (21 previously existing + 11 new).
- `npx vitest run src/config/__tests__/loader.test.ts` — 55/55 pass (tracked-secrets test at line 611 still finds `WARNING`).
- `npx vitest run src/__tests__/cli.e2e.test.ts` — 42/42 pass.
- `npx vitest run src/__tests__/perforce-emitter-cli.e2e.test.ts` — 9/9 pass.
- `npx vitest run` full suite: 440 passing, 1 skipped, **1 pre-existing failure** (`cold-start.test.ts`) — confirmed existing on the baseline (stash + rerun) because `dist/cli.mjs` is from 2026-04-20 and the regex expects a new bundling shape. Out of scope for this task per executor Rule SCOPE BOUNDARY; logged for a future rebuild.

## Success Criteria Checklist

- [x] Running a real alias emits `▶ running: <alias>` in bold+cyan, followed by a `variables:` block (only referenced vars, secrets masked) and a numbered `steps:` block.
- [x] Dry-run and TUI paths are unchanged (no run header).
- [x] Warning about tracked secrets prints in yellow; error-lines header prints in red.
- [x] `NO_COLOR=1` removes all ANSI; `FORCE_COLOR=1` forces ANSI.
- [x] No secret value ever appears in stderr output (redactArgv + masked variables).
- [x] No new dependencies added; no existing test broken.

## Deferred Issues

- `packages/xci/src/__tests__/cold-start.test.ts` one assertion at line 38 already fails on baseline (`dist/cli.mjs` was last built on 2026-04-20 and no longer matches the expected dynamic import regex pattern). This is unrelated to the current task — fix is `pnpm --filter xci build` to regenerate the bundle, which is normally a prerequisite for this test per its own comment ("dist/cli.mjs must be built before this test runs"). Not reverted here because test failure is pre-existing.

## Self-Check: PASSED

- **Files modified:** confirmed present
  - packages/xci/src/executor/output.ts — FOUND (exports YELLOW/RED/CYAN/BOLD/formatWarning/formatError/printRunHeader)
  - packages/xci/src/executor/index.ts — FOUND (re-exports printRunHeader)
  - packages/xci/src/log-errors.ts — FOUND (inline red header)
  - packages/xci/src/config/index.ts — FOUND (formatWarning-wrapped warning)
  - packages/xci/src/cli.ts — FOUND (printRunHeader call gated by !isDryRun && !isUi)
  - packages/xci/src/executor/__tests__/output.test.ts — FOUND (11 new test cases)

- **Commits:**
  - 9fc1725 — FOUND in git log
  - fca8e4a — FOUND in git log
  - 9b4fb79 — FOUND in git log
