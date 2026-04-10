---
status: partial
phase: 01-foundation
source: [01-VERIFICATION.md]
started: 2026-04-10T16:10:00Z
updated: 2026-04-10T16:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. First GitHub Actions CI run on the 3×2 matrix
expected: All 6 matrix jobs (ubuntu-latest × [20, 22], windows-latest × [20, 22], macos-latest × [20, 22]) report green. Each job runs `npm ci → typecheck → lint → build → test → smoke`, all exit 0.
steps: Push the repo to a GitHub remote and open a PR (or push to main / trigger `workflow_dispatch`). Observe the first run of `.github/workflows/ci.yml`.
why_human: The workflow file is structurally correct and every step passes locally, but the 3×2 matrix has never been observed running on GitHub-hosted runners. Windows Server 2022 + Apple-Silicon macOS behaviour cannot be verified from Linux/WSL2 — especially (a) Windows PATHEXT + shebang handling of `dist/cli.mjs`, (b) Windows CRLF/.gitattributes interaction on checkout, (c) `npm ci` reproducibility from `package-lock.json` on non-Linux runners.
result: [pending]

### 2. Genuine Windows global install via npm .cmd/.ps1 shim
expected: `loci --version` prints `0.0.0` and exits 0 from both PowerShell and cmd.exe, using npm's generated `.cmd`/`.ps1` shim.
steps: On a modern Windows 10+ machine with Node >=20.5.0 installed, run `npm i -g <path-to-tarball-or-repo>` then invoke `loci --version` from both PowerShell and cmd.exe.
why_human: Local verification installed the package into a prefix on Linux (symlink-based bin), not as a Windows cmd-shim. The tsup banner (shebang + createRequire polyfill) is designed to work through npm's Windows shim, but the first genuine Windows install has not been performed. This is the empirical confirmation of FND-02 SC-1 on Windows.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
