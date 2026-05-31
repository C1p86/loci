# Pitfalls Research

**Domain:** v2.1 feature additions to xci/go-xci (Go CLI + Node server + TypeScript CLI)
**Researched:** 2026-06-01
**Confidence:** HIGH (codebase read, verified against official docs and community sources)

---

## Critical Pitfalls

### Pitfall 1: Completion script printing diagnostics to stdout corrupts the completion engine

**What goes wrong:**
Every shell completion invocation (`xci __complete ...`) launches a full `go-xci` process via a hidden `__complete` cobra subcommand. If any code that runs during that invocation writes diagnostic text, warnings, or log lines to **stdout**, the shell's completion parser receives garbage mixed with real candidates and silently produces zero completions — or worse, inserts a warning string as a tab candidate.

**Why it happens:**
The `go-xci` startup path calls `discovery.FindXciRoot`, then `commands.LoadCommands`, then `config.Load`. `config.Load` already has a non-fatal `fmt.Fprintf(os.Stderr, ...)` warning path (visible in `root.go` `printList()`), but any `fmt.Println` or `fmt.Printf` calls (stdout) — including debug traces added during `for_each` or `cwd` development — will poison the completion script. Cobra's `__complete` mode does not suppress arbitrary stdout.

**How to avoid:**
- All diagnostics, warnings, and debug output in go-xci **must** use `os.Stderr` or `fastify.log` — never `os.Stdout` / `fmt.Println` — in code paths that run during completion invocation (config loading, command discovery, resolver).
- Write an integration test that runs `go-xci __complete xci ""` and asserts the output is exactly the newline-separated alias list with no extra lines.
- The `ValidArgsFunction` callback receives a `toComplete` prefix — filter alias names by that prefix to avoid sending the whole list on every TAB.

**Warning signs:**
- TAB completion inserts `[xci] config warning:` as a candidate.
- Completion list empty even though `.xci/commands.yml` is present and valid.
- Running `go-xci __complete xci ""` manually produces non-alias lines.

**Phase to address:** Shell completions phase (DX-01).

---

### Pitfall 2: Dynamic YAML alias completions are slow (full startup per TAB)

**What goes wrong:**
Cobra shell completions work by re-running the binary with a hidden `__complete` subcommand each time TAB is pressed. If the completion handler loads `.xci/commands.yml` from disk, walks the directory tree looking for `.xci/`, and resolves config (reading up to 4 YAML files), the TAB response latency can reach 200–400 ms on a cold filesystem cache. In bash, this causes a visible pause before the candidate list appears; users abandon the feature.

**Why it happens:**
The alias list requires a cold disk read of `commands.yml` on every TAB because Go binaries have no persistent process state between invocations. The `FindXciRoot` tree walk adds I/O proportional to project directory depth.

**How to avoid:**
- In `ValidArgsFunction`, **only** read `.xci/commands.yml` — skip `config.Load` entirely (param values are irrelevant for listing alias names).
- Cache nothing (no persistent state available); optimize instead by stopping `FindXciRoot` at the first `.xci/` hit.
- Target < 50 ms for the completion path measured with `hyperfine 'go-xci __complete xci ""'`; add this measurement to the DX-01 acceptance criteria.
- Fish completions run a subprocess per line; generate a static `complete` stub if the dynamic path is too slow for Fish.

**Warning signs:**
- `hyperfine 'go-xci __complete xci ""'` mean > 100 ms.
- `config.Load` or secret git-tracking check is called inside `ValidArgsFunction`.

**Phase to address:** Shell completions phase (DX-01).

---

### Pitfall 3: Go ANSI codes break on Windows cmd.exe / older PowerShell without ENABLE_VIRTUAL_TERMINAL_PROCESSING

**What goes wrong:**
Windows 10+ supports ANSI escape sequences, but `cmd.exe` and old PowerShell consoles do not enable virtual terminal processing by default. Writing raw `\x1b[31m` sequences to stdout produces literal escape characters instead of color, making run headers unreadable. This is the most common "works on my machine (macOS/Linux), broken for users" issue for Go CLI color output.

**Why it happens:**
The TypeScript `packages/xci/src/tui/ansi.ts` already has an `isTTY()` guard (`process.stdout.isTTY === true`) that protects the Node CLI. Go has no built-in equivalent. Naively writing ANSI codes to `os.Stderr` without activating `ENABLE_VIRTUAL_TERMINAL_PROCESSING` via `windows.SetConsoleMode` produces garbage on unupgraded Windows 10 consoles and all Windows Server versions.

**How to avoid:**
- Use `fatih/color` (which internally uses `mattn/go-isatty` and calls `windows.SetConsoleMode(ENABLE_VIRTUAL_TERMINAL_PROCESSING)` on Windows) rather than writing raw `\x1b[` sequences by hand.
- Alternatively, call `golang.org/x/term.IsTerminal(int(os.Stderr.Fd()))` and skip color when false — but still need to activate VT processing on Windows.
- Respect `NO_COLOR` (see pitfall 4): check `os.Getenv("NO_COLOR") != ""` before enabling color.
- The CI matrix already includes `windows-latest`; add a test that verifies color output does not appear when stdout/stderr is piped (non-TTY).

**Warning signs:**
- `[ESC][31m` printed literally in Windows cmd.exe output.
- Color test passes on ubuntu-latest/macos-latest CI but Windows job shows escape characters.
- `fatih/color` not in `go.mod` but ANSI codes are written manually.

**Phase to address:** Go CLI colored output phase (GOCLI-06).

---

### Pitfall 4: NO_COLOR and CI/pipe detection not wired — colors in redirected output break scripts

**What goes wrong:**
When `go-xci` output is piped to a file, grepped, or consumed by another tool (e.g., `go-xci build 2>&1 | tee build.log`), ANSI escape codes appear in the captured output. This breaks pattern matching against `[xci] step`, interferes with log parsers, and fails the "no garbage in non-TTY output" requirement. Additionally, some CI systems (GitHub Actions specifically) support color via `TERM=xterm-256color` but are not a TTY; naively checking only `isatty` will disable color there.

**Why it happens:**
Two distinct environment cases need opposite behavior: piped-to-file wants no color; GitHub Actions with `FORCE_COLOR=1` wants color despite non-TTY. Without explicit env-var checks, the isatty heuristic mishandles both.

**How to avoid:**
- Check in priority order: `NO_COLOR` set -> no color; `FORCE_COLOR` set -> force color; `isatty(stderr)` -> color; else no color. `fatih/color` follows this order automatically when used correctly.
- Never write color codes to a non-stderr/non-stdout writer (e.g., log files).
- Add a test: run `go-xci --list | cat` (piped) and assert output contains no `\x1b[` sequences.

**Warning signs:**
- `ANSI escape codes in log` in any CI artifact.
- `[xci]` lines contain `\x1b[` characters when captured with `2>&1`.
- Color is absent in GitHub Actions even though `FORCE_COLOR` is set.

**Phase to address:** Go CLI colored output phase (GOCLI-06).

---

### Pitfall 5: Multi-step dispatch — seq numbers collide across steps, breaking log replay order

**What goes wrong:**
The existing `spawnTask` in `runner.ts` maintains a local `seq` counter starting at 0 for each task invocation. When multi-step dispatch is added (sequential or parallel steps each spawning their own `spawnTask`), each step resets `seq` to 0. The server persists chunks with a unique index on `(run_id, seq)` — duplicate `seq` values will cause DB unique constraint violations on the second step's first log line.

**Why it happens:**
The seq counter is local to each `spawnTask` call. Sequential multi-step dispatch calls `spawnTask` once per step; without a global seq accumulator passed across calls, every step starts at seq=0. The `log_chunks` schema enforces `uniqueIndex('log_chunks_run_seq_unique').on(t.runId, t.seq)` — this is not a soft uniqueness, it is a hard DB constraint.

**How to avoid:**
- Pass a `seqOffset: number` parameter into `spawnTask` (or accumulate a global seq counter in the agent's `client.ts` dispatch loop) so step N starts where step N-1 left off.
- Alternatively, use a per-run atomic counter managed by the calling client, not inside `spawnTask`.
- Test: dispatch a two-step sequential task, assert DB has monotonically increasing seq values with no gaps or duplicates.

**Warning signs:**
- Postgres `duplicate key value violates unique constraint "log_chunks_run_seq_unique"` errors in server logs.
- Second step produces no log output in the UI log viewer.
- Unit test for multi-step that checks seq values is absent.

**Phase to address:** Agent dispatch multi-step phase (DISP-01).

---

### Pitfall 6: Multi-step cancel mid-sequence leaves the run state machine in an intermediate state

**What goes wrong:**
When cancel arrives while step 2 of 3 is running, the agent must: (a) kill the current subprocess, (b) not start step 3, (c) send a `result` frame with `cancelled: true`. If the agent dispatches cancel handling at the task level but does not propagate it to the sequential executor loop, step 3 may start after the cancel frame has already been sent, causing the server to see a late `state` or `log_chunk` frame for a run already marked `cancelled`.

**Why it happens:**
The existing single-step runner uses an AbortController / `handle.cancel()` pattern inside `spawnTask`. Multi-step dispatch wraps multiple `spawnTask` calls in a loop in `client.ts`; the cancel signal needs to abort the outer loop, not just the current step. Without a shared cancellation flag passed to the loop, the cancel only kills the in-flight step — the next iteration starts a new step before the outer loop checks the cancelled flag.

**How to avoid:**
- Maintain a single `cancelled: boolean` flag at the task-dispatch level (above the step loop) set when a `cancel` WS frame is received.
- Check the flag at the start of every iteration of the sequential step loop before calling `spawnTask`.
- Write a test: dispatch a 3-step sequential task, send cancel mid-step-2, assert only 2 `log_chunk` frame groups appear and the result frame has `cancelled: true`.

**Warning signs:**
- Server logs show `state ack for non-dispatched run — CAS miss` after a cancel (step 3 tried to run).
- Log viewer shows step 3 output after cancel was requested.
- `result` frame arrives with `exit_code: 0` (step 3 succeeded) but run state is already `cancelled`.

**Phase to address:** Agent dispatch multi-step phase (DISP-01).

---

### Pitfall 7: Parallel multi-step log interleaving makes the log viewer unreadable

**What goes wrong:**
For parallel task plans, multiple subprocesses write log chunks simultaneously. Without per-step prefixing in the log stream, the UI log viewer receives interleaved stdout/stderr from different steps with no way to separate them. The `linePrefixWriter` in `go-xci/internal/executor/parallel.go` already solves this for local execution, but the agent's `runner.ts` emits raw chunk data — the server receives chunks from parallel steps with the same `stream` field but no step label in the data. The log viewer cannot distinguish them.

**Why it happens:**
The `log_chunks` schema has `stream: 'stdout' | 'stderr'` but no `step_label` or `step_index` column. The server was designed for single-step tasks. Parallel steps share a `run_id` but have no per-step scoping in the current schema.

**How to avoid:**
- Option A (preferred, no schema change): prefix each chunk's `data` with `[stepname] ` on the agent side before emitting — mirrors what `linePrefixWriter` does in go-xci. The log viewer renders prefixed text directly.
- Option B (schema change): add `step_index integer` nullable column to `log_chunks`; requires a DB migration and UI updates. Deferred complexity.
- Adopt Option A for DISP-01; mark Option B as a future enhancement.
- Test: dispatch a 2-step parallel task and assert each log line in the DB starts with the expected step prefix.

**Warning signs:**
- Log viewer output has no way to distinguish which parallel step produced a line.
- `log_chunks` rows for a parallel run have no step prefix in `data` column.
- UI team reports "parallel run logs are unreadable."

**Phase to address:** Agent dispatch multi-step phase (DISP-01).

---

### Pitfall 8: Session token hashing migration invalidates all active sessions simultaneously (hard cutover)

**What goes wrong:**
The `sessions` table currently stores the raw token as the primary key (`id: text('id').primaryKey()`). Adding a `token_hash` column and switching the lookup query from `eq(sessions.id, token)` to `eq(sessions.tokenHash, hash(token))` in a single deployment invalidates every active session — all users are logged out simultaneously. This is a breaking change with user-visible impact.

**Why it happens:**
The migration adds the new hash column and the code change switches the lookup to the hash column in the same deploy. Existing rows have `token_hash = NULL` (the new column was added with `ALTER TABLE ADD COLUMN`). The new lookup query finds no rows -> all sessions appear invalid -> all users log out.

**How to avoid:**
- Two-phase migration is required:
  - Phase A (this milestone): add `token_hash text` column (nullable), add index on it, backfill all existing rows (`UPDATE sessions SET token_hash = encode(sha256(decode(id, 'base64')), 'hex')`), then switch the lookup to prefer `token_hash` while keeping `id` as fallback for un-backfilled rows (dual-read period). Do NOT drop the raw token as primary key yet.
  - Phase B (next milestone): once all rows have `token_hash` populated, enforce NOT NULL, drop the raw-token primary key lookup fallback, rotate stored tokens to hashed-only.
- The backfill must happen in the same migration transaction as the column addition to avoid a window where the column exists but rows are not backfilled.
- Test: create a session in the old format, run the migration, verify the session is still valid via the new lookup code.

**Warning signs:**
- Migration adds the column but no `UPDATE sessions SET token_hash = ...` backfill statement.
- Code change and migration are in the same PR with no dual-read fallback.
- `sessions_active_idx` partial index is not updated to cover `token_hash`.

**Phase to address:** Session token hashing phase (SEC-01).

---

### Pitfall 9: haveibeenpwned network failure blocks signup entirely (wrong failure mode)

**What goes wrong:**
The Pwned Passwords k-anonymity API (`api.pwnedpasswords.com/range/{prefix}`) is a third-party network call. If the call times out, returns a non-200 status, or HIBP's CDN returns a 503, the signup/reset handler will either: (a) throw an unhandled error that Fastify returns as a 500 to the client, or (b) reject the signup because "we couldn't verify it's safe." Both outcomes are wrong — users should be able to sign up even when HIBP is temporarily unavailable.

**Why it happens:**
Developers implement the HIBP check as a required step in the signup handler: if it throws, the outer handler throws too. The correct behavior is: HIBP unavailable -> log warning + allow signup (fail open). The security value of HIBP is probabilistic, not absolute; blocking 100% of signups because of a third-party outage trades availability for no meaningful security gain.

**How to avoid:**
- Wrap the HIBP call in a try/catch with a short timeout (e.g., 3 seconds via `AbortSignal.timeout`). On any non-200 response or timeout: log a warning at `warn` level, increment a metric, and allow the signup to proceed.
- Only reject the signup if HIBP returns HTTP 200 and the password hash suffix is present in the response (confirmed breach).
- Test the failure path explicitly: mock HIBP to return 503 and verify signup succeeds with a warning logged.
- The Pwned Passwords API has no rate limit and requires no API key, so the main failure mode is network/CDN, not rate limiting.

**Warning signs:**
- HIBP call is `await`ed without a timeout and without a try/catch around the `fetch`.
- Integration test only covers the "password found" path, not the "HIBP unreachable" path.
- `signup.integration.test.ts` has no test case for HIBP timeout.

**Phase to address:** Security debt phase (SEC-02).

---

### Pitfall 10: haveibeenpwned response parsing leaks partial SHA-1 hash prefix into logs

**What goes wrong:**
The k-anonymity call sends the first 5 hex characters of the SHA-1 hash of the password. Logging the hash prefix (or the full SHA-1) for debugging reveals partial password information. While 5 hex chars alone have low entropy, the project's existing security invariant is that no secret-adjacent values appear in logs. Logging even the prefix violates this invariant and creates audit findings.

**Why it happens:**
Developers log the outgoing request URL or the hash prefix for debugging when implementing the feature. The URL contains the prefix directly: `https://api.pwnedpasswords.com/range/A3BDE` — logging this URL exposes the first 5 chars of the SHA-1.

**How to avoid:**
- Never log the request URL for the HIBP range call. Log only the outcome: `pwned_check: ok|pwned|error` with no hash values.
- In tests, assert that no HIBP-related log entry contains hexadecimal strings that could be a hash prefix.

**Warning signs:**
- `fastify.log.debug({ url: hibpUrl }, ...)` present in the HIBP handler.
- Log output in tests shows `range/[0-9A-F]{5}`.

**Phase to address:** Security debt phase (SEC-02).

---

### Pitfall 11: bundle-size gate uses wrong baseline, permanently red or permanently green

**What goes wrong:**
The CI comment in `ci.yml` already documents the problem: the real bundle baseline is 760 KB but the original target was 200 KB (D-15). Wiring `size-limit` with the 200 KB target immediately breaks every PR. Alternatively, setting the limit to 800 KB (the current actual size) makes the gate useless — it will never fire. Either extreme defeats the purpose.

**Why it happens:**
The original target was set before Phases 2–5 added substantial features. The gate was deferred specifically because the baseline was not re-evaluated. Wiring without re-measuring and setting a meaningful regression threshold (not the original target) produces a gate that is either always red or permanently toothless.

**How to avoid:**
- Measure the actual bundle size on the current `main` HEAD (`pnpm --filter xci build && du -b packages/xci/dist/cli.mjs`).
- Set the `size-limit` limit to `actual_size + 50 KB` (or 10%) — this catches new regressions without failing on the existing baseline.
- Add a comment in `.size-limit.json` and `ci.yml` explaining the threshold and the date it was set so future reviewers have context.
- Use `size-limit` with `--json` output and a Node script to emit a pass/fail based on the computed threshold rather than hardcoding a byte count that goes stale.

**Warning signs:**
- `size-limit` config has `maxSize: 200 KB` (original target, not current baseline).
- CI gate permanently red after wiring.
- No comment in config explaining how the threshold was derived.

**Phase to address:** Bundle-size CI gate phase (QA-02).

---

### Pitfall 12: Biome `--write` auto-applies "unsafe" fixes and changes runtime behavior

**What goes wrong:**
Running `biome lint --write` on the 68 existing errors applies both safe and **unsafe** fixes depending on the flags used. Some unsafe fixes restructure code (e.g., changing `a ? a : b` to `a ?? b`) which changes behavior when `a` is an empty string or zero — falsy values that are valid in the xci config parsing context. Auto-applying these without review can silently introduce bugs in config loading or resolver logic.

**Why it happens:**
Biome distinguishes `safe` (formatting, trivial renames) from `unsafe` (semantic transformations) fixes. In Biome v2, `biome lint --write` applies safe fixes only; `biome lint --write --unsafe` applies both. Developers referencing v1 docs, or using `check --write` instead of `lint --write`, may apply unsafe fixes without realizing it. The 68 errors are concentrated in `packages/xci/src/` which includes config loading and resolver code.

**How to avoid:**
- Run `biome lint --write` (safe only) first and review the diff before committing.
- For the remaining errors after safe fixes, review each one manually. Do not batch-apply `--unsafe` across `packages/xci/src/` without reading every hunk.
- Run the full test suite (`pnpm --filter xci test`) after each batch of Biome fixes.
- Check that no fix touches `src/resolver/` or `src/config/` logic with `??` replacing `||` without confirming empty-string behavior is unchanged.

**Warning signs:**
- `biome lint --write --unsafe` used on the full source directory in one pass.
- Test suite failures in config/resolver tests after Biome cleanup.
- `??` replacing `||` in code that checks for empty strings (falsy but defined).

**Phase to address:** Biome cleanup phase (QA-01).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode HIBP timeout at 3s | Simple to implement | Too aggressive on slow networks, too lenient for signup UX | Use configurable via env var `HIBP_TIMEOUT_MS`; 3s is a safe default |
| Hash-only session migration in one phase | Ships faster | Logs out all active users on deploy | Never — dual-read migration is required |
| Static completion list (no YAML read) | Zero startup cost | Returns stale aliases after `commands.yml` edits until shell reload | Acceptable only if combined with a `xci completion --reload` hook |
| Apply all Biome unsafe fixes at once | Clears 68 errors fast | Risk of silent behavioral regressions in resolver/config | Never for resolver/config code; acceptable for test fixtures only |
| Skip `NO_COLOR` check in Go CLI | Faster implementation | Color escape garbage in piped output and CI logs | Never — `fatih/color` handles this automatically |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Pwned Passwords API | Logging request URL (exposes hash prefix) | Log only outcome: `pwned_check: ok|pwned|error` — no hash values |
| Pwned Passwords API | Blocking signup on network error | Fail open: log warning, allow signup if HIBP unreachable |
| Pwned Passwords API | Assuming rate-limiting is the main failure mode | No rate limit on Pwned Passwords API; failure mode is CDN/network (503) |
| Cobra completions | Writing to stdout inside `ValidArgsFunction` | All diagnostics go to `os.Stderr`; `ValidArgsFunction` returns only candidates |
| `fatih/color` on Windows | Raw `\x1b[` codes without VT processing activation | Use `fatih/color` library; it activates `ENABLE_VIRTUAL_TERMINAL_PROCESSING` automatically |
| `size-limit` in monorepo | Running against all packages or using stale threshold | Scope to `packages/xci/dist/cli.mjs`; set threshold to actual + 10% |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full config load in completion handler | TAB latency > 100 ms | Only load `commands.yml` in `ValidArgsFunction`, skip `config.Load` | First TAB press in any project |
| `spawnTask` called without seqOffset in multi-step | DB unique constraint violation on second step | Pass global seq accumulator across step calls | First 2-step sequential task dispatched |
| HIBP call without timeout | Signup hangs for 30+ seconds if CDN slow | `AbortSignal.timeout(3000)` on `fetch` | Any HIBP latency spike |
| Biome `--write --unsafe` on full src in one pass | Test suite failures hard to bisect | Apply in small batches, run tests after each | First PR that touches resolver after unsafe fix |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging HIBP hash prefix | Partial password information in log files | Never log request URL or hash values; log only `ok|pwned|error` |
| Hard cutover session token migration | All users logged out simultaneously | Two-phase migration: add column + backfill in same transaction, dual-read until full rollout |
| HIBP check on every login (not just signup/reset) | Adds 3s latency to every auth hot path on HIBP timeout | Check on signup and password-reset only; never on session-auth path |
| Storing raw token indefinitely after hash migration | Hash column wasted if raw-token lookup fallback never removed | Schedule Phase B to drop raw-token fallback once all rows backfilled |

---

## "Looks Done But Isn't" Checklist

- [ ] **Shell completions:** Generated script installs correctly — verify `xci completion bash > ~/.bash_completion.d/xci && source ~/.bash_completion.d/xci && xci <TAB>` produces alias list.
- [ ] **Shell completions:** PowerShell profile injection works on Windows — verify `xci completion powershell >> $PROFILE` and new shell produces completions in both PowerShell 5.1 and 7.x.
- [ ] **Go colored output:** `NO_COLOR=1 go-xci build 2>&1 | cat` produces no `\x1b[` characters.
- [ ] **Go colored output:** Windows CI job on `windows-latest` passes without escape character garbage in output.
- [ ] **Multi-step dispatch:** A 3-step sequential task with a failing step 2 leaves step 3 un-executed (not just unreported).
- [ ] **Multi-step dispatch cancel:** Cancel mid-step-2 of a 3-step task produces `cancelled: true` in the `result` frame and does not attempt step 3.
- [ ] **Multi-step seq:** DB `log_chunks` for a 2-step run has monotonically increasing `seq` values with no reset to 0 at step boundary.
- [ ] **Session token hashing:** After migration, existing sessions remain valid (dual-read backfill verified in integration test).
- [ ] **HIBP check:** Signup succeeds when HIBP returns 503 (fail-open verified with mock test in `signup.integration.test.ts`).
- [ ] **HIBP logging:** No HIBP-related log entry contains a hex string that could be a hash prefix.
- [ ] **Bundle-size gate:** Gate fails on a deliberately large dependency added in a test branch (threshold is not vacuously high).
- [ ] **Biome cleanup:** Full unit + integration test suite passes green after all 68 errors cleared.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Completion stdout pollution | LOW | Remove `fmt.Print*` from startup path, re-generate completion scripts |
| Session migration hard cutover | HIGH | Deploy rollback + manual `UPDATE sessions SET token_hash = ...` backfill + re-deploy with dual-read |
| HIBP blocks signup on outage | MEDIUM | Hot-patch handler to wrap in try/catch with fail-open; deploy hotfix |
| seq collision in multi-step logs | MEDIUM | Clean duplicate chunks from DB; fix seqOffset; re-deploy agent |
| Biome unsafe fix breaks resolver | MEDIUM | `git revert` the unsafe-fix commit; fix manually; re-run test suite |
| Bundle-size gate permanently red | LOW | Update `.size-limit.json` threshold to `actual + 10%`; document in comment |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Completion stdout pollution | DX-01 (Shell completions) | `go-xci __complete xci "" \| grep -v '^[a-z]' \| wc -l` = 0 |
| Dynamic completion latency | DX-01 (Shell completions) | `hyperfine 'go-xci __complete xci ""'` mean < 50 ms |
| ANSI without VT processing on Windows | GOCLI-06 (Colored output) | Windows CI job passes; `\x1b[` absent in piped output |
| NO_COLOR / FORCE_COLOR not wired | GOCLI-06 (Colored output) | `NO_COLOR=1` test asserts no escape chars in piped output |
| seq collision in multi-step | DISP-01 (Agent multi-step) | DB unique constraint never fires in integration test for 2-step run |
| Cancel mid-sequence | DISP-01 (Agent multi-step) | Cancel test asserts result.cancelled=true, step 3 absent in log chunks |
| Parallel log interleaving | DISP-01 (Agent multi-step) | Log viewer test asserts each line starts with expected step prefix |
| Session migration hard cutover | SEC-01 (Token hashing) | Pre-migration session valid post-migration in integration test |
| HIBP blocking signup on failure | SEC-02 (HIBP check) | Mock 503 test asserts signup succeeds with warning log |
| HIBP hash prefix in logs | SEC-02 (HIBP check) | Log assertion: no hex strings in HIBP-related log entries |
| Bundle-size wrong baseline | QA-02 (Bundle-size gate) | Gate fails on +100 KB test branch; passes on main |
| Biome unsafe fixes | QA-01 (Biome cleanup) | Full unit + integration test suite green after cleanup |

---

## Sources

- `go-xci/cmd/root.go` — stdout path in startup confirmed; `os.Stderr` usage in `printList()` verified
- `go-xci/internal/executor/parallel.go` — `linePrefixWriter` pattern for step prefixing confirmed
- `go-xci/internal/executor/sequential.go` — seq counter absent at this level; per-step in runner
- `packages/xci/src/agent/runner.ts` — `seq` counter local to each `spawnTask` call confirmed; single-step only comment confirmed
- `packages/server/src/db/schema.ts` — `log_chunks_run_seq_unique` hard constraint confirmed; `sessions.id` raw token as PK confirmed
- `packages/xci/src/tui/ansi.ts` — `isTTY()` guard pattern confirmed; Go equivalent absent
- `.github/workflows/ci.yml` — D-15 size-limit gate intentionally omitted; 760 KB vs 200 KB discrepancy confirmed in comments
- https://cobra.dev/docs/how-to-guides/shell-completion/ — `ValidArgsFunction` stdout pollution pitfall documented
- https://github.com/spf13/cobra/issues/1712 — `ValidArgsFunction` not always called edge case
- https://github.com/fatih/color — `NO_COLOR`, `FORCE_COLOR`, auto-detection behavior confirmed
- https://github.com/mattn/go-isatty/issues/59 — Windows Terminal vs cmd.exe VT processing detection issue
- https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences — `ENABLE_VIRTUAL_TERMINAL_PROCESSING` off by default in cmd.exe confirmed
- https://haveibeenpwned.com/api/v3 — Pwned Passwords: no rate limit, no API key, k-anonymity 5-char prefix, 503 on CDN failure
- https://no-color.org/ — `NO_COLOR` specification
- https://biomejs.dev/linter/ — safe vs unsafe fix distinction in Biome v2 confirmed
- https://github.com/ai/size-limit — size-limit exit code behavior and `--json` output mode

---
*Pitfalls research for: xci/go-xci v2.1 feature additions*
*Researched: 2026-06-01*
