# Requirements: v2.1 Quality & Parity

**Milestone:** v2.1 — Quality & Parity
**Generated:** 2026-06-01
**Status:** Active

---

## In Scope

### Go CLI Parity

- [ ] **GOCLI-06**: User can see a colored run-header showing alias name and resolved params before execution begins (output.go foundation with fatih/color, isTTY detection, Windows VT support)
- [ ] **GOCLI-07**: User can define `for_each.in` with a `${VAR}` placeholder that resolves to a CSV list at runtime; each iteration runs the step with `${ITEM}` available
- [ ] **GOCLI-08**: User can set an optional `cwd` field on an alias; child steps inherit the parent's cwd when they don't define their own
- [ ] **GOCLI-09**: User can see the full breadcrumb in step headers (e.g. `build > compile > step1`) during nested execution
- [ ] **GOCLI-10**: User can see the effective cwd printed in dark yellow before each step spawn

### Agent Dispatch

- [ ] **DISP-01**: User can dispatch a sequential or parallel multi-step task to a remote agent; steps execute in order (sequential) or concurrently (parallel); log chunks are globally ordered across steps; cancel mid-sequence stops remaining steps

### Shell Completions

- [ ] **DX-01**: User can tab-complete xci alias names in bash, zsh, fish, and PowerShell; completions are loaded dynamically from `.xci/commands.yml` at completion time; `xci completion <shell>` prints the script, `xci completion install <shell>` writes it to the appropriate config file

### Security

- [ ] **SEC-01**: Session tokens are stored as SHA-256 hashes in the database (`sessions.token_hash`); plaintext tokens never persist beyond the response; existing sessions are backfilled via migration without user logout
- [ ] **SEC-02**: User-submitted passwords on signup and reset are checked against haveibeenpwned k-anonymity API; compromised passwords are rejected with a clear message; the check fails open on network error (3s timeout)

### Code Quality

- [ ] **QA-01**: All 68 pre-existing Biome style errors in `packages/xci/src/` are resolved using safe-fix (useTemplate, useLiteralKeys); no behavior change; CI Biome step passes clean
- [ ] **QA-02**: Bundle-size CI gate is wired in `ci.yml` with a realistic threshold reflecting the current monorepo; gate fails builds that regress bundle size beyond the threshold

### DevOps

- [ ] **OPS-01**: Main branch has required status checks configured (integration-tests, fence-gates, all 6 build-test-lint matrix jobs); PRs cannot merge without passing gates
- [ ] **OPS-02**: `NPM_TOKEN` secret is configured in the GitHub repo; npm publish pipeline can execute on release

---

## Future Requirements (Deferred to v3.0)

- Stripe integration + paid plans (FUT-01)
- Matrix runs and artifact passing (FUT-02)
- SSO / OIDC / 2FA (FUT-04)
- KMS real integration — AWS/GCP/Vault (FUT-07)
- Multi-region / HA deploy (FUT-08)
- Multi-instance agent scaling via Redis pub/sub
- Agent audit log (register/revoke events)

---

## Out of Scope

- **Go CLI agent mode** — Go port does not implement `xci --agent`; that remains TypeScript-only
- **Auto-install completions via postinstall** — hostile UX for CI environments; user opts in manually
- **Completion for flags/params** — only alias names from `.xci/commands.yml`
- **HIBP enterprise API** — free k-anonymity API only; no API key
- **Session token hashing with argon2** — SHA-256 matches existing `hashToken()` pattern; KDF overhead inappropriate for high-frequency lookups

---

## Traceability

| REQ-ID | Phase | Plan |
|--------|-------|------|
| GOCLI-06 | Phase 16 | — |
| GOCLI-07 | Phase 17 | — |
| GOCLI-08 | Phase 17 | — |
| GOCLI-09 | Phase 17 | — |
| GOCLI-10 | Phase 17 | — |
| DISP-01 | Phase 18 | — |
| DX-01 | Phase 18 | — |
| SEC-01 | Phase 19 | — |
| SEC-02 | Phase 19 | — |
| QA-01 | Phase 20 | — |
| QA-02 | Phase 20 | — |
| OPS-01 | Phase 20 | — |
| OPS-02 | Phase 20 | — |
