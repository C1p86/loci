---
phase: "05-init-distribution"
plan: "01"
subsystem: "init"
tags: ["cli", "scaffold", "init", "gitignore", "onboarding"]
dependency_graph:
  requires: []
  provides: ["loci-init-command", "scaffold-templates"]
  affects: ["src/cli.ts"]
tech_stack:
  added: []
  patterns: ["sync-fs-operations", "idempotent-scaffold", "commander-hook-postAction"]
key_files:
  created:
    - src/init/templates.ts
    - src/init/index.ts
    - src/__tests__/init.test.ts
  modified:
    - src/cli.ts
decisions:
  - "registerInitCommand called before findLociRoot so loci init works from any directory (no .loci/ required)"
  - "postAction hook on program detects when init subcommand ran; returns exit 0 in no-loci branch"
  - "All fs operations in init module are synchronous — avoids async complexity for simple scaffolding"
  - "CRLF-safe gitignore handling via .split('\\n').map(l => l.trim()) before entry check"
metrics:
  duration: "3m"
  completed: "2026-04-15"
  tasks: 2
  files: 4
---

# Phase 05 Plan 01: loci init Command — Summary

## One-liner

Idempotent `loci init` scaffold command creating `.loci/` with 4 template files and updating `.gitignore`, with commander postAction hook enabling exit-0 from directories without `.loci/`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create init module (templates + scaffolding logic) | 4321eb2 | src/init/templates.ts, src/init/index.ts |
| 2 | Wire init into CLI and add tests | 1548217 | src/cli.ts, src/__tests__/init.test.ts |

## What Was Built

### src/init/templates.ts
Four exported YAML template string constants:
- `CONFIG_YML` — project-level parameters scaffold
- `COMMANDS_YML` — command aliases scaffold with working `hello` alias
- `SECRETS_EXAMPLE_YML` — secrets template (gitignored, never committed)
- `LOCAL_EXAMPLE_YML` — per-machine overrides template (gitignored)

### src/init/index.ts
- `writeIfAbsent(filePath, content, baseDir, results)` — idempotent file writer using `existsSync` guard
- `ensureGitignore(projectDir, results)` — creates or appends `.loci/secrets.yml` + `.loci/local.yml` entries; CRLF-safe via `.map(l => l.trim())`
- `printInitSummary(results)` — columnar output via `process.stdout.write`
- `runInit(cwd)` — orchestrates directory creation + file scaffold + gitignore update
- `registerInitCommand(program)` — commander subcommand registration

### src/cli.ts changes
- Import `registerInitCommand` from `'./init/index.js'`
- Call `registerInitCommand(program)` immediately after `buildProgram()`, before `findLociRoot()`
- Added `program.hook('postAction', ...)` to detect when a subcommand (init) ran successfully in the no-loci branch → returns exit code 0 instead of 1

### src/__tests__/init.test.ts
8 tests total:
- 6 unit tests for `runInit()` covering: file creation, gitignore creation, idempotency, entry dedup, gitignore append, directory-absent case
- 2 E2E tests via `dist/cli.mjs`: first run exit 0 + file creation, second run exit 0 + skipped output

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] loci init returned exit code 1 when run from directory without .loci/**

- **Found during:** Task 2 TDD (E2E tests failed with status=1)
- **Issue:** The no-loci branch in `main()` returned `helpOrVersionDisplayed ? 0 : 1`. When `loci init` ran, the subcommand action executed correctly but `helpOrVersionDisplayed` stayed false, causing exit code 1.
- **Fix:** Added `program.hook('postAction', (_thisCommand, actionCommand) => { if (actionCommand !== program) subcommandRan = true; })` and changed return to `helpOrVersionDisplayed || subcommandRan ? 0 : 1`.
- **Files modified:** src/cli.ts
- **Commit:** 1548217

### Pre-existing Out-of-Scope Issues

Two pre-existing TypeScript errors exist in `src/cli.ts:217` and `src/executor/parallel.ts:46` (carried over from Phase 4). Not caused by this plan's changes; deferred per scope boundary rules.

## Known Stubs

None. All template content is complete scaffold content (not placeholder data).

## Threat Surface Scan

The threat model in this plan covered all relevant surfaces. No new security-relevant surface was introduced beyond what was planned (T-05-01 through T-05-04). The `.gitignore` append implementation satisfies T-05-01: entries are read before append, only the two known-safe entries are ever appended.

## Self-Check: PASSED

Files exist:
- src/init/templates.ts: FOUND
- src/init/index.ts: FOUND
- src/__tests__/init.test.ts: FOUND
- src/cli.ts (modified): FOUND

Commits exist:
- 4321eb2: FOUND
- 1548217: FOUND

All 212 tests pass. Build succeeds.
