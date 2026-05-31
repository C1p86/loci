---
phase: 15-go-cli-parity-fixes
plan: "02"
subsystem: go-xci
tags: [go, cli, params-validation, secrets-tracking, parity-fix]
dependency_graph:
  requires: []
  provides: [GOCLI-02, GOCLI-04]
  affects: [go-xci/internal/commands, go-xci/cmd/run.go]
tech_stack:
  added: []
  patterns: [params-declaration, git-ls-files-check, validateParams-before-resolve]
key_files:
  created: []
  modified:
    - go-xci/internal/commands/types.go
    - go-xci/internal/commands/loader.go
    - go-xci/internal/commands/loader_test.go
    - go-xci/cmd/run.go
decisions:
  - "checkSecretsTracked uses exec.Command git ls-files --error-unmatch; exit 0 = tracked; any error = silently ignored"
  - "validateParams iterates def.Params and checks presence in values map; error format: alias \"X\": required parameter Y is not defined (alias quoted, param unquoted)"
  - "params parsing added only to normalizeObject (object-form aliases); string and array shorthand forms stay with Params: nil"
metrics:
  duration: "7m"
  completed_date: "2026-05-31T20:37:15Z"
  tasks: 2
  files: 4
---

# Phase 15 Plan 02: Params Validation + Secrets Tracking Warning Summary

Implemented two missing parity features in go-xci vs TypeScript xci: (1) required-params validation before alias execution, and (2) git-tracked secrets.yml warning.

## What Was Built

### Task 1: ParamDef + params parsing (2f79d2f)

**go-xci/internal/commands/types.go**
- Added `ParamDef` struct with `Required bool` and `Description string` fields
- Added `Params map[string]ParamDef` field to `CommandDef`

**go-xci/internal/commands/loader.go**
- Added params parsing block in `normalizeObject` after cwd parsing: reads `params:` YAML object, maps each entry to `ParamDef`; returns error if params block is not a map or a param entry is not a map
- Wired `Params: params` into all three CommandDef return sites: sequential, parallel, and single
- Updated function comment (params is now IN SCOPE, not out of scope)

### Task 2: Test + validateParams + checkSecretsTracked (bfaf4d1)

**go-xci/internal/commands/loader_test.go**
- Added `TestLoadCommands_paramsRequired`: loads YAML with TOKEN (required=true, description="API token") and ENV (required=false), verifies Params map is populated correctly

**go-xci/cmd/run.go**
- Added `"os/exec"` to imports
- Added `validateParams(alias, def, values)`: iterates `def.Params`, returns error for any required param missing from values. Error format: `alias "X": required parameter Y is not defined`
- Added `checkSecretsTracked(root)`: runs `git ls-files --error-unmatch .xci/secrets.yml` in project root; prints warning to stderr on exit 0; silently ignores any error
- Wired `checkSecretsTracked(root)` in `runAlias` after `commands.LoadCommands` (GOCLI-04)
- Wired `validateParams` in `runAlias` after mergedValues assembled, before `resolver.Resolve` (GOCLI-02)

## Test Evidence

```
=== RUN   TestLoadCommands_paramsRequired
--- PASS: TestLoadCommands_paramsRequired (0.00s)
PASS
ok      github.com/andrearuggeri/xci/internal/commands  0.055s
```

All 13 loader tests pass (including existing tokenize + normalizeAlias tests).

Build: `go build ./...` exits 0.

## Deviations from Plan

None — plan executed exactly as written.

Note: the worktree did not initially contain the `go-xci` directory (worktree branch was 32 commits behind main). The go-xci directory was copied from the main working tree before starting task execution. This was an environmental setup issue, not a deviation from plan scope or logic.

## Known Stubs

None — all features implemented and wired to production execution path.

## Self-Check: PASSED

- FOUND: go-xci/internal/commands/types.go
- FOUND: go-xci/internal/commands/loader.go
- FOUND: go-xci/internal/commands/loader_test.go
- FOUND: go-xci/cmd/run.go
- FOUND: .planning/phases/15-go-cli-parity-fixes/15-02-SUMMARY.md
- FOUND commit: 2f79d2f (feat(15-02): ParamDef + params parsing)
- FOUND commit: bfaf4d1 (feat(15-02): validateParams + checkSecretsTracked)
