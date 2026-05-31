# Project Research Summary

**Project:** loci (npm: `xci`) / go-xci
**Milestone:** v2.1 — Quality & Parity
**Researched:** 2026-06-01

---

## Executive Summary

xci v2.1 is a focused quality-and-parity milestone. Only one new external package is added across all feature areas: `github.com/fatih/color v1.19.0` for Go terminal coloring. Every new capability maps to a verified extension point in the existing codebase.

**Stack delta:** `fatih/color v1.19.0` (Go only). All TypeScript/server capabilities use existing tools.

**Three critical risks:**
1. **Multi-step seq collision** — `log_chunks_run_seq_unique` index requires globally monotonic seq values; each `spawnTask()` currently resets seq to 0. Global accumulator must be designed in from the start.
2. **Session token migration hard cutover** — two-phase migration with dual-read backfill is mandatory; single-deploy flip logs out all active users.
3. **Cobra completion stdout pollution** — any `fmt.Println` in Go startup path silently corrupts tab completion output. Completion cleanliness test required.

---

## Stack Additions

| Addition | Version | Purpose | Notes |
|----------|---------|---------|-------|
| `github.com/fatih/color` | v1.19.0 | Go CLI terminal color | Only new dep. Handles Windows VT processing automatically via go-isatty. |
| HIBP API | — | k-anonymity breach check | No API key, no rate limit. Native `fetch()` + `node:crypto`. ~20 LOC. |
| `hashToken()` (existing) | — | Session token hashing | Already in `crypto/tokens.ts` for agent creds. Gap: sessions don't use it yet. |

---

## Feature Landscape

### Go CLI Parity (GOCLI-06..10)

**Table stakes:**
- Colored run-header (bright cyan) with alias + params
- Step headers with breadcrumb (dark cyan)
- CWD printed in dark yellow before each step
- `for_each.in` with `${VAR}` CSV-split at resolve time
- `cwd` field with parent→child inheritance

**Key complexity:** `for_each` touches 4 files (types, loader, resolver, executor). All other parity items depend on a shared `output.go` infrastructure file that should be created first.

### Shell Completions (DX-01)

**TypeScript CLI:** `--get-completions` mechanism already exists. Only bash/zsh/fish script generators are missing (PowerShell is done). Pattern: completion script calls `xci --get-completions xci "$@"` at TAB press time.

**Go CLI:** Cobra v1.10.2 (already in go.mod) has built-in `Gen*Completion` methods. Add `ValidArgsFunction` on rootCmd to enumerate alias names from `.xci/commands.yml`.

**Anti-feature:** Do NOT auto-install completions via `postinstall`. Emit instructions; user opts in.

### Agent Multi-Step Dispatch (DISP-01)

The executor (`packages/xci/src/executor/`) already handles sequential + parallel correctly. The agent must:
1. Replace `parseYamlToArgv()` (rejects non-single kinds) with an `ExecutionPlan`-based path
2. Route executor stdout/stderr into `onChunk` callbacks (not `process.stdout`)
3. Thread a global seq accumulator across all steps

Step boundary markers (synthetic `log_chunk` stderr lines) are recommended for UX.

### Security Debt (SEC-01, SEC-02)

**Session hashing (SEC-01):** `hashToken()` already exists. Gap is `sessions.id` stores raw token as PK. Migration: add `token_hash` column, backfill, switch lookups. Two-phase deploy required.

**HIBP (SEC-02):** `GET https://api.pwnedpasswords.com/range/{first5}` — no auth, no rate limit. Fail-open on 503/timeout. Never log the hash prefix.

---

## Architecture Integration Points

| Component | Change Type | Notes |
|-----------|------------|-------|
| `packages/xci/src/cli.ts` | Extend | Add bash/zsh/fish generators + `--list-raw` flag |
| `packages/xci/src/agent/index.ts` | Modify | Replace single-only dispatch path |
| `packages/xci/src/agent/runner.ts` | Modify | Add multi-step spawn with seq accumulator |
| `packages/server/src/db/schema.ts` | Extend | Add `tokenHash` column to sessions |
| `packages/server/src/repos/admin.ts` | Modify | Hash on createSession/revokeSession |
| `packages/server/src/plugins/auth.ts` | Modify | Lookup via tokenHash |
| `go-xci/cmd/root.go` | Extend | ValidArgsFunction + completion subcommand |
| `go-xci/cmd/output.go` | New | Shared color/print helpers (foundation for all Go parity) |
| `.github/workflows/ci.yml` | Extend | Bundle-size gate step |

---

## Critical Pitfalls

1. **Completion stdout pollution (Go):** Any `fmt.Println` in startup path breaks `__complete`. All diagnostics must use `os.Stderr`. Test with `xci __complete xci "" "" ""`.
2. **seq collision (DISP-01):** DB unique constraint on `(run_id, seq)` — global counter object required, not per-step closures.
3. **Session migration cutover:** Hard cutover logs out all users. Add dual-read fallback in auth plugin for the deploy window.
4. **Windows ANSI (Go):** Raw `\x1b[` codes fail in cmd.exe. `fatih/color` handles `ENABLE_VIRTUAL_TERMINAL_PROCESSING` automatically — use it, don't bypass it.
5. **HIBP fail-open:** Use `AbortSignal.timeout(3000)` + try/catch. Block signup only on confirmed breach, never on API error.
6. **Biome unsafe fixes (QA-01):** Do NOT run `--unsafe` on resolver/config code. Batch by package area; test files first.
7. **for_each loop variable re-interpolation:** TypeScript has a known fix for this (260421-lhg). Go port must replicate the same semantics.

---

## Suggested Phase Order

| # | Phase | Key Work | Dependencies |
|---|-------|---------|-------------|
| 16 | Go CLI Output Infrastructure | `output.go`, fatih/color, isTTY, run-header | none |
| 17 | Go CLI Parity (for_each + cwd + breadcrumb) | resolver + executor extension | Phase 16 |
| 18 | Shell Completions | TS bash/zsh/fish + Go cobra completion | Phase 16 (Go part) |
| 19 | Agent Multi-Step Dispatch | ExecutionPlan dispatch + seq accumulator | none |
| 20 | Security Debt | SEC-01 token hashing + SEC-02 HIBP | none |
| 21 | Quality & CI | QA-01 Biome cleanup + QA-02 bundle-size gate | Phase 18 (final bundle) |

DevOps (OPS-01/02) are GitHub configuration, not code — best handled as a quick task or pre-milestone checklist, not a full phase.
