---
phase: quick-260623-k2w
plan: "01"
subsystem: xci/executor
tags: [security, redaction, secrets, argv, cwd, substring]
dependency_graph:
  requires: []
  provides: [redactSecretsInString, substring-argv-redaction, substring-cwd-redaction]
  affects: [printDelegationBanner, printRunHeader, printDryRun, printVerboseCommand]
tech_stack:
  added: []
  patterns: [split/join literal substring replacement, longest-first secret ordering]
key_files:
  created:
    - .changeset/redact-secret-substrings.md
  modified:
    - packages/xci/src/executor/output.ts
    - packages/xci/src/executor/__tests__/output.test.ts
    - packages/xci/src/__tests__/cli.e2e.test.ts
    - packages/xci/README.md
decisions:
  - "Use split/join (not regex) for literal substring replacement — secret values may contain regex metacharacters"
  - "Sort secrets longest-first before replacement — prevents fragment leaks when one secret is a prefix of another"
  - "Preserve **********  for whole-value matches in ini/uproject set: blocks — keeps existing test assertions green while adding substring safety for embedded occurrences"
  - "Empty/whitespace-only secrets skipped with trim().length === 0 guard — belt-and-suspenders even though buildSecretValues already excludes empty values"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-23"
  tasks_completed: 3
  files_changed: 4
---

# Quick Task 260623-k2w: Redact Secret Values as Substrings in argv/cwd

**One-liner:** Substring-based literal split/join redactor (longest-first sort) closes cleartext secret leak in delegation banner, run header, dry-run, and verbose output for `KEY=${SECRET}` arg patterns.

## What Was Done

### Problem Closed

`redactArgv` previously used `secretValues.has(token) ? '***' : token` — a whole-token exact-match check. When an alias used `args: [token=${DEPLOY_TOKEN}]`, the interpolated token `token=s3cr3t-abc123` did NOT equal the secret value `s3cr3t-abc123`, so it passed through unredacted in all output paths. This violated CLAUDE.md: "Loci NON deve mai loggare i valori dei secrets."

### Solution

Added module-private helper `redactSecretsInString(s, secretValues)` in `packages/xci/src/executor/output.ts`:

- Sorts secret values by **length descending** before iteration — longer secrets are replaced first, preventing fragment leaks when one secret is a prefix/substring of another (e.g. `abc123` vs `abc123xyz` on token `k=abc123xyz`).
- Uses **`result.split(secret).join('***')`** for each secret — literal replacement with no regex interpretation, replaces ALL occurrences in one pass, handles metacharacters safely.
- **Skips** any secret whose `trim().length === 0` — guards against an empty-string secret blanking entire tokens (belt-and-suspenders on top of `buildSecretValues` exclusion).
- Returns the original string unchanged when no secret matches (split/join on a non-substring is a no-op).

`redactArgv` now calls `redactSecretsInString` per token. `redactCwd` now calls it on the cwd string. All callers (`printDelegationBanner`, `printRunHeader`, `printDryRun`, `printVerboseCommand`) inherit the fix automatically.

The two `ini`/`uproject` `set:` masking spots preserve `**********` for whole-value matches (existing test assertion green) while routing through `redactSecretsInString` for embedded occurrences.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Write failing substring-redaction unit + e2e tests (RED) | 741792a | output.test.ts, cli.e2e.test.ts |
| 2 | Implement substring redactor (GREEN) | 68e0eb9 | output.ts |
| 3 | Document the fix — README + changeset | 2e294fd | README.md, .changeset/redact-secret-substrings.md |

## Test Coverage Added

### Unit tests (output.test.ts — new `describe('substring secret redaction')`)

- `token=SECRET` → `token=***` (embedded secret not leaked)
- Standalone `SECRET` → `***` (old whole-token behavior preserved)
- Secret in the MIDDLE: `pre-SECRET-post` → `pre-***-post`
- One token with TWO secrets: `a=S1val;b=S2val` → `a=***;b=***`
- Overlapping secrets (longer-first): `k=abc123xyz` with `{abc123, abc123xyz}` → `k=***`, NOT `k=***xyz`
- Regex metachar secret `a.b*c$`: literal match → `v=***`, non-literal `aXbYcZ` → unchanged
- Empty secret set → output unchanged
- Empty-string secret in set → `hello` unchanged (not blanked)
- All occurrences: `SECRET-mid-SECRET` → `***-mid-***`
- `cwd=/home/SECRET/proj` → `/home/***/proj` in dry-run output
- `undefined` cwd → no cwd line emitted

### E2E test (cli.e2e.test.ts)

- `token=${deploy_token}` in `args` renders `token=***` in `--dry-run` stderr; cleartext `s3cr3t-abc123` absent

## Threat Register Mitigation

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-k2w-01 | mitigate | Covered — embedded `token=SECRET` redacted via redactArgv |
| T-k2w-02 | mitigate | Covered — cwd substring redacted via redactCwd |
| T-k2w-03 | mitigate | Covered — overlapping-secrets test proves longest-first sort works |
| T-k2w-04 | mitigate | Covered — empty-secret guard test proves no DoS via blank replacement |
| T-k2w-05 | mitigate | Covered — regex-metachar test proves literal split/join behavior |
| T-k2w-SC | accept | No new dependencies — split/join is built-in |

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Files exist:
- packages/xci/src/executor/output.ts: FOUND (modified)
- packages/xci/src/executor/__tests__/output.test.ts: FOUND (modified)
- packages/xci/src/__tests__/cli.e2e.test.ts: FOUND (modified)
- packages/xci/README.md: FOUND (modified)
- .changeset/redact-secret-substrings.md: FOUND (created)

Commits verified:
- 741792a: test(quick-260623-k2w): add failing substring secret redaction tests
- 68e0eb9: fix(xci): redact secret values as substrings in argv tokens and cwd strings
- 2e294fd: docs(xci): document substring secret redaction and add patch changeset

Final gate: `npm run build && npx tsc --noEmit && npx vitest --run`
- Build: PASSED
- tsc --noEmit: CLEAN (zero errors)
- vitest --run: 659 passed; 7 pre-existing environmental failures (version mismatch, Windows path assertions, cold-start regex, SpawnError on Windows) — zero new failures introduced
