---
status: complete
phase: 04-executor-cli
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md]
started: 2026-04-15T09:00:00Z
updated: 2026-04-15T10:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Single Command Execution
expected: Create a `.loci/` project with a single alias (e.g., `greet` → `echo hello`). Run `node dist/cli.mjs greet`. Output shows `hello` on stdout, exit code 0.
result: pass

### 2. Exit Code Propagation
expected: Define an alias that runs a command which fails (e.g., `fail` → `node -e "process.exit(42)"`). Run it. The `loci` process should exit with the same code (42).
result: pass

### 3. Sequential Chain with Stop-on-Failure
expected: Define a sequential alias with 3 steps where step 2 fails. Run it. Steps 1 runs, step 2 fails, step 3 never runs. Exit code matches step 2's failure code.
result: pass

### 4. Parallel Group Execution
expected: Define a parallel alias with 2+ commands. Run it. All commands start simultaneously and their output appears interleaved with colored prefix labels (one color per alias name).
result: pass

### 5. Alias List (no args / --list)
expected: Run `node dist/cli.mjs` with no arguments, or with `--list` / `-l`. A list of available aliases appears with their descriptions and command kinds (single/sequential/parallel).
result: pass

### 6. Dry Run Mode
expected: Run an alias with `--dry-run`. No command actually executes. Instead, the resolved command(s) are printed to stderr showing what would run. stdout remains empty. Secret values in arguments appear as `***`.
result: pass

### 7. Verbose Mode
expected: Run an alias with `--verbose`. Before execution, a trace is printed showing: config file paths loaded, project root, and environment variables (with secret values shown as `***`).
result: pass

### 8. Pass-Through Arguments
expected: Define a single-command alias. Run it with extra args after `--` (e.g., `node dist/cli.mjs myalias -- --extra flag`). The extra args are appended to the child command's argv.
result: pass

### 9. Per-Alias Help
expected: Run `node dist/cli.mjs <alias> --help`. A help screen appears showing the alias name, command type, a preview of steps/members, and available flags (--dry-run, --verbose).
result: pass

### 10. Unknown Alias Error
expected: Run `node dist/cli.mjs nonexistent`. An error message appears and the process exits with code 50.
result: issue
reported: "Error message shows commander's 'too many arguments' before loci's 'Unknown flag' — confusing. Should show 'Unknown alias: nonexistent' cleanly."
severity: cosmetic

### 11. No .loci/ Directory Error
expected: Run `node dist/cli.mjs` from a directory with no `.loci/` anywhere in the parent chain. A friendly error message explains no project found, exit code non-zero.
result: issue
reported: "Message 'No .loci/ directory found' shows correctly but exit code is 0 instead of non-zero"
severity: major

## Summary

total: 11
passed: 9
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "Unknown alias shows a clean error message like 'Unknown alias: nonexistent'"
  status: failed
  reason: "User reported: Error message shows commander's 'too many arguments' before loci's 'Unknown flag' — confusing. Should show 'Unknown alias: nonexistent' cleanly."
  severity: cosmetic
  test: 10
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""

- truth: "No .loci/ directory found exits with non-zero exit code"
  status: failed
  reason: "User reported: Message 'No .loci/ directory found' shows correctly but exit code is 0 instead of non-zero"
  severity: major
  test: 11
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
