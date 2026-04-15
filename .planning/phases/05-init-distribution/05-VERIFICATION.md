---
phase: 05-init-distribution
verified: 2026-04-15T12:57:39Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 1
gaps: []
overrides:
  - id: DOC-05
    reason: "npm publish is intentionally deferred — package is verified publish-ready (npm publish --dry-run passes). User will bump version and publish when ready."
resolutions:
  - truth: "loci init creates commands.yml with 2-3 aliases demonstrating single, sequential, and parallel command types"
    status: resolved
    fix: "Added commented-out sequential (steps:) and parallel (group:) examples to COMMANDS_YML template in commit d839a76"
human_verification:
  - test: "Verify npm package xci has been published to the public registry (or confirm publish is intentionally deferred)"
    expected: "`npm view xci` returns package metadata for xci@0.0.0 (or later version)"
    result: "Intentionally deferred — npm publish --dry-run confirms readiness. User publishes when version is bumped."
---

# Phase 5: Init & Distribution Verification Report

**Phase Goal:** `loci init` scaffolds a new project, documentation is complete, and the package is ready for npm publication under the name `xci`
**Verified:** 2026-04-15T12:57:39Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running `loci init` creates `.loci/config.yml`, `commands.yml`, `secrets.yml.example`, `local.yml.example` and updates `.gitignore` | ✓ VERIFIED | Behavioral test confirmed: 4 files created, `.gitignore` created with `# loci` + both entries. Exit 0. |
| 2 | Subsequent `loci init` runs skip all existing files and print 'skipped' for each | ✓ VERIFIED | Second run behavioral test output contained `skipped` for all 5 items. Exit 0. |
| 3 | `loci init` works from a directory with no `.loci/` pre-existing | ✓ VERIFIED | `mkdirSync(lociDir, { recursive: true })` is called before any file ops; unit test confirms this explicitly. |
| 4 | `commands.yml` scaffold contains 2-3 aliases demonstrating single, sequential, and parallel types (INIT-04) | ✗ FAILED | `COMMANDS_YML` constant has only 1 alias (`hello`) using `cmd:` array. No `steps:` or `group:` examples present. |
| 5 | A developer following only the README quickstart can install loci, run `loci init`, define one alias, and execute it | ✓ VERIFIED | README has install (`npm i -g xci`), `loci init`, `loci hello` as sequential steps. Behavioral test confirms `loci hello` prints "hello from loci" after init. README is 267 lines with complete quickstart. |
| 6 | README documents all 4 config levels with precedence order | ✓ VERIFIED | README table documents machine/project/secrets/local layers with paths. Precedence line: "machine < project < secrets < local (last value wins per key)". |
| 7 | README documents commands.yml format (single, sequential, parallel) | ✓ VERIFIED | Sections: "Single command", "Sequential steps", "Parallel group" all present with copy-pasteable YAML examples. |
| 8 | README explains shell:false default and wrap-in-script pattern | ✓ VERIFIED | "Shell Behavior" section explains `shell: false`, no pipes/redirects, and shows bash/powershell wrap-in-script pattern. |
| 9 | README documents linux:/windows:/macos: platform overrides | ✓ VERIFIED | "Platform-Specific Commands" section present with `open-docs` example showing all 3 platform blocks. |
| 10 | LICENSE file exists with MIT text | ✓ VERIFIED | `LICENSE` at project root contains "MIT License" and "Permission is hereby granted". |
| 11 | package.json name is 'xci', files array includes 'LICENSE', bin stays 'loci' | ✓ VERIFIED | `"name": "xci"`, `"files": ["dist", "README.md", "LICENSE"]`, `"bin": { "loci": "./dist/cli.mjs" }` all confirmed. |

**Score:** 10/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/init/templates.ts` | Static YAML template strings for scaffold files | ✓ VERIFIED | Exports CONFIG_YML, COMMANDS_YML, SECRETS_EXAMPLE_YML, LOCAL_EXAMPLE_YML. CRLF-safe. 39 lines, substantive content. |
| `src/init/index.ts` | runInit + registerInitCommand | ✓ VERIFIED | 144 lines. Exports `runInit` and `registerInitCommand`. Contains `mkdirSync` with `recursive: true`, `existsSync` guard, `.map(l => l.trim())`, `process.stdout.write`. |
| `src/cli.ts` | registerInitCommand called before findLociRoot | ✓ VERIFIED | Line 250: `registerInitCommand(program)` appears before line 253: `findLociRoot(process.cwd())`. Import at line 13. |
| `src/__tests__/init.test.ts` | Unit and E2E tests, min 80 lines | ✓ VERIFIED | 136 lines. 8 tests: 6 unit tests for `runInit`, 2 E2E tests via `dist/cli.mjs`. Uses `mkdtempSync`. Imports `runInit` from `'../init/index.js'`. |
| `README.md` | Complete documentation, min 150 lines | ✓ VERIFIED | 267 lines. Contains all required sections. `npm i -g xci` present. |
| `LICENSE` | MIT license text | ✓ VERIFIED | Standard MIT text, "Copyright (c) 2026 loci contributors". |
| `package.json` | Updated for npm publication | ✓ VERIFIED | name "xci", LICENSE in files array, bin unchanged. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli.ts` | `src/init/index.ts` | `import { registerInitCommand }` + `registerInitCommand(program)` before `findLociRoot` | ✓ WIRED | Line 13 import, line 250 call, line 253 findLociRoot. Order correct. |
| `src/init/index.ts` | `src/init/templates.ts` | `import` template constants | ✓ WIRED | Line 9: `import { CONFIG_YML, COMMANDS_YML, LOCAL_EXAMPLE_YML, SECRETS_EXAMPLE_YML } from './templates.js'`. All 4 templates used in `runInit`. |

### Data-Flow Trace (Level 4)

Not applicable. Phase 5 artifacts are scaffolding logic (writes files) and documentation — no dynamic data rendering to trace.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `loci init` creates 4 files + .gitignore | `loci init` in fresh temp dir | 4 files created, .gitignore with `# loci` entries, exit 0 | ✓ PASS |
| Second `loci init` skips all existing files | `loci init` second run in same dir | Output contains "skipped" for all 5 items, exit 0 | ✓ PASS |
| `loci hello` works after init | `loci hello` in init'd dir | Prints "hello from loci", exit 0 | ✓ PASS |
| `npm publish --dry-run` succeeds | `npm publish --dry-run` | Package name `xci`, 4 files (LICENSE, README.md, dist/cli.mjs, package.json), exit 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| INIT-01 | 05-01 | `loci init` scaffolds `.loci/` directory | ✓ SATISFIED | `mkdirSync` + 4 files created in behavioral test |
| INIT-02 | 05-01 | Creates `.loci/config.yml` with explanatory comments | ✓ SATISFIED | CONFIG_YML has project-level params scaffold with comments |
| INIT-03 | 05-01 | Creates `secrets.yml.example` and `local.yml.example` (not real files) | ✓ SATISFIED | templates.ts has both `.example` constants; real files are not created |
| INIT-04 | 05-01 | Creates `commands.yml` with 2-3 aliases (single, sequential, parallel) | ✗ BLOCKED | COMMANDS_YML has only 1 alias (`hello`, single-command). No sequential (`steps:`) or parallel (`group:`) examples in scaffold. |
| INIT-05 | 05-01 | Adds secrets.yml + local.yml to .gitignore (creates if missing, no duplication) | ✓ SATISFIED | `ensureGitignore` handles all 3 cases; duplication check via CRLF-safe line comparison |
| INIT-06 | 05-01 | Idempotent: skips existing files, prints summary | ✓ SATISFIED | `writeIfAbsent` guard + second-run behavioral test confirms "skipped" output |
| DOC-01 | 05-02 | README with quickstart, 4 config levels, commands.yml example | ✓ SATISFIED | README has all sections; quickstart tested end-to-end |
| DOC-02 | 05-02 | README documents shell:false default and wrap-in-script pattern | ✓ SATISFIED | "Shell Behavior" section present with bash/powershell example |
| DOC-03 | 05-02 | README documents linux:/windows:/macos: overrides | ✓ SATISFIED | "Platform-Specific Commands" section with complete open-docs example |
| DOC-04 | 05-03 | LICENSE file (MIT) present | ✓ SATISFIED | `LICENSE` at project root with standard MIT text |
| DOC-05 | 05-03 | Package published on npm (name available, publish verified) | ? NEEDS HUMAN | `npm publish --dry-run` exits 0 and shows correct `xci` package contents. Actual publish requires npm login. SUMMARY 05-03 reports user approved the checkpoint but does not explicitly confirm publication. |

**Orphaned requirements:** None. All 11 requirements (INIT-01 through INIT-06, DOC-01 through DOC-05) are claimed by plans in this phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | No TODO/FIXME/placeholder anti-patterns found in init module, README, or LICENSE. |

Note: README lines containing "placeholders" (72, 81) refer to `${VAR}` syntax documentation, not stub indicators.

### Human Verification Required

#### 1. npm Package Publication Status (DOC-05)

**Test:** Run `npm view xci` or check https://www.npmjs.com/package/xci
**Expected:** Package xci is listed with version 0.0.0 (or later if bumped)
**Why human:** `npm publish --dry-run` confirms the package is ready with correct contents and exits 0. Actual publication to the npm registry requires `npm login` and an explicit `npm publish --access public`. The SUMMARY reports the human checkpoint Task 2 was "APPROVED by user 2026-04-15" but does not state whether the actual `npm publish` was executed.

### Gaps Summary

**1 gap blocking full INIT-04 compliance:**

**INIT-04 (COMMANDS_YML template content):** The requirement specifies that `loci init` should scaffold `commands.yml` with 2-3 demonstrative aliases covering single, sequential, and parallel command types. The actual `COMMANDS_YML` constant contains only 1 alias (`hello`) which demonstrates the single `cmd:` array type. There are no `steps:` (sequential) or `group:` (parallel) examples in the scaffolded file.

The plan's own acceptance criteria scoped this down to just `hello:` — so this was an intentional simplification during implementation, not an oversight. However, it diverges from the REQUIREMENTS.md text for INIT-04.

**Options to resolve:**
1. Add 1-2 commented-out example aliases to COMMANDS_YML showing sequential/parallel syntax
2. Accept the deviation with an override if the "hello only" approach is preferred for simplicity

**DOC-05 (npm publication):** Requires human confirmation that the package was actually published, or acknowledgment that it is intentionally deferred (publish-ready but not yet published).

---

_Verified: 2026-04-15T12:57:39Z_
_Verifier: Claude (gsd-verifier)_
