# Feature Research — xci v2.1: Quality & Parity

**Domain:** Task runner CLI + distributed CI — v2.1 quality-and-parity milestone
**Researched:** 2026-06-01
**Confidence:** HIGH (Go parity from TypeScript source) / MEDIUM (shell completions distribution) / HIGH (agent dispatch design)
**Scope:** NEW features only — all v1/v2.0 features are pre-existing and explicitly excluded

---

## Research Notes

Three feature areas investigated: (1) shell completions — how task-runner CLIs distribute dynamic completion scripts, and how cobra/commander handle them; (2) agent multi-step dispatch — what the existing single-command path looks like and what minimal changes enable sequence/parallel; (3) Go CLI parity — exact TypeScript behaviour to port for colored output, for_each, cwd inheritance, and breadcrumb.

Complexity scale: Low = isolated change in one file, Med = multiple files + tests, High = cross-cutting new subsystem.

---

## Area 1: Shell Completions (DX-01)

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `xci completion bash` emits installable bash completion script | Every modern CLI (kubectl, gh, task, just) ships `<tool> completion bash`. The bash script calls `xci --list` at completion time to get dynamic alias names. Users expect a one-liner install. | Med | Emit a bash script that calls `xci --list-raw` (new flag, see differentiators) and parses the alias names. Installed via `xci completion bash >> ~/.bashrc` or to `/etc/bash_completion.d/xci`. |
| `xci completion zsh` emits installable zsh completion script | Zsh is 68% of developer shells in 2025 (vs Bash 22%). Without zsh, the majority of users get no completions. | Med | Zsh script uses `_arguments` and calls back to `xci --list-raw` for dynamic alias list. Install: `xci completion zsh > ~/.zsh/completions/_xci` + `fpath` setup. |
| `xci completion fish` emits installable fish completion script | Fish is 7% of shells — non-trivial for a developer tool. Fish completions use a `complete -xa "(xci --list-raw)"` pattern matching go-task exactly. | Med | Single-file fish completion script. Install: `xci completion fish > ~/.config/fish/completions/xci.fish`. |
| `xci completion powershell` emits installable PowerShell completion script | xci is explicitly Windows 10+ compatible and the primary user persona uses PowerShell on Windows. Without PowerShell completions, Windows users get no tab completion. | Med | PowerShell completion via `Register-ArgumentCompleter`. Calls `xci --list-raw` and parses output. |
| Completion scripts complete `xci <TAB>` with alias names from `.xci/commands.yml` | This is the core value: `xci <TAB>` shows `build`, `test`, `deploy`, not flags. go-task does this by calling `task --list-all` at completion time. Dynamic because commands.yml varies per project. | Med | All scripts call `xci --list-raw` (or `xci --list`) and parse alias names from output. Not static. |
| `xci completion --help` shows install instructions per shell | Users discover completion without reading docs. `kubectl completion bash --help` shows the complete install workflow. | Low | Each subcommand prints multi-line usage string with platform-specific install path. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `xci --list-raw` flag (machine-readable alias list) | Completion scripts need parseable output, not the pretty table `--list` produces. `--list-raw` outputs one alias per line (no headers, no descriptions). Makes completion scripts trivially simple and doesn't break when `--list` output format changes. | Low | New flag on root command. Output: `build\ntest\ndeploy\n`. Parsed by all four completion scripts. |
| Alias descriptions shown in zsh/fish completions (tab shows `build — Build the project`) | go-task passes `name\tdescription` tab-separated for fish. Zsh `_describe` shows descriptions inline. Makes completions useful, not just functional. | Low | `--list-raw` can emit `name\tdescription` tab-separated for shells that support it (zsh, fish), vs plain names for bash/powershell. Or add `--list-raw --with-descriptions`. |
| Go CLI `go-xci completion <shell>` mirrors same subcommand structure | Users switching between Go and TypeScript CLIs expect the same interface. cobra's built-in `GenBashCompletion()` / `GenZshCompletion()` / `GenFishCompletion()` / `GenPowerShellCompletion()` functions handle the static frame; dynamic aliases require a `ValidArgsFunction` registration. | Med | cobra `rootCmd.ValidArgsFunction` calls `LoadCommands` and returns alias names as completions. cobra handles all four scripts via its built-in generators once `ValidArgsFunction` is wired. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| `postinstall` script that auto-installs completions to `~/.bashrc` or `~/.zshrc` | `postinstall` runs as the npm install user. Writing to shell rc files without consent is hostile; on some systems (CI, restricted paths) it will error and break `npm install`. The `shell-completion` npm package approach creates visible failures during CI installs. | Emit instructions during install if `process.stdout.isTTY`. User runs `xci completion bash >> ~/.bashrc` by choice. |
| Static completion script (hardcoded alias names) | Static scripts become wrong the moment `commands.yml` changes. Worst than no completion. | Always call back to `xci --list-raw` at completion time. Accept the minor latency of parsing YAML at tab press. |
| Distributing pre-generated completion files in the npm package | Files go stale. Users get wrong aliases if they run an old completion script against a new `commands.yml`. | Dynamic callback pattern only. |

### Dependencies

- `xci --list-raw` is a prerequisite for all four completion scripts (TypeScript CLI)
- `go-xci completion` depends on cobra `ValidArgsFunction` + `LoadCommands` — same function already used by `printList()`
- Go completion: cobra auto-generates the shell scripts once `ValidArgsFunction` is registered. No manual script writing needed for go-xci.
- TypeScript completion: completion scripts are static strings embedded in CLI source, calling `xci --list-raw` at runtime. No library dependency needed.

---

## Area 2: Agent Multi-Step Dispatch (DISP-01)

### Context: Current Single-Command Limitation

The agent `runner.ts` currently supports a single `execa` spawn per `dispatch` frame. The dispatch handler in `agent/index.ts` parses the `task_snapshot.yaml_definition` YAML, validates it has exactly one alias, extracts the single-alias `cmd` or array `cmd`, and calls `spawnTask()` with the resulting argv.

The block in `agent/runner.ts` line 7 explicitly says: "Supports single-command dispatch only (Phase 10). Sequential/parallel dispatch is deferred..."

The existing executor (`packages/xci/src/executor/`) already runs sequential/parallel locally for the TypeScript CLI. The question for DISP-01 is: how to wire the existing executor into the agent's dispatch path while preserving the `onChunk`/`onExit` streaming contract that the WS protocol depends on.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Agent dispatch accepts `sequential` command kind | The most common remote task is a multi-step build: checkout → build → test → deploy. Single-command dispatch forces every real task to be a shell script wrapper. Sequential is the natural representation. | High | Agent must run `runSequential()` (or equivalent inline) with a streaming wrapper that pipes each step's stdout/stderr to `onChunk`. The agent's `log_chunk` WS frames already carry `seq`, `stream`, `data` — they work equally well for multi-step output. |
| Agent dispatch accepts `parallel` command kind | Some tasks run independent steps concurrently: lint + typecheck + test-unit can all be parallel. | High | Same dependency as sequential. Agent runs `runParallel()` with per-step prefix lines to `onChunk`. Parallel results summary emitted at end. |
| Exit code semantics preserved for multi-step | Server stores `exit_code` from the `result` frame. For sequential: exit code = code of first failing step (or 0). For parallel fast-mode: code of first failing goroutine. Matching what local CLI already does. | Med | No protocol change needed — `result.exit_code` already covers this. |
| Cancellation during multi-step stops at current step and exits | The current single-command cancel (`RunHandle.cancel()`) kills the execa process. For sequential, cancellation should stop the in-flight step and not start the next. | Med | Add a `cancelled` flag that is checked between steps. On cancel: kill current step subprocess, break the step loop, emit `result` with `cancelled: true`. |
| `log_chunk` frames during multi-step include step-boundary markers | Operators watching logs need to see where step N ends and step N+1 begins. Without markers, the log stream is one undifferentiated blob. | Low | Emit a synthetic `log_chunk` (stream: `stderr`) before each step with content `▶ step N: <label>` — same as what `printStepHeader()` writes locally. This is already done by the existing executor's `printStepHeader()`. The agent only needs to capture stderr too. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Reuse existing `runSequential` / `runParallel` functions directly | The TypeScript executor is already battle-tested with 57+ requirements. Writing a new multi-step executor for the agent from scratch would duplicate logic and create divergence. | Med | Route the agent dispatch through the existing `executor.run()` function. The existing executor writes to `process.stderr`/`process.stdout` — the agent needs to intercept these (or pass a custom write function). The cleanest approach: the agent creates pipe-intercepted stdout/stderr streams and feeds the written bytes into `onChunk`. |
| Step-level cancellation feedback in log stream | When cancel arrives mid-sequence, the log should show `✗ step 3: deploy CANCELLED`. The UI then shows exactly where the run was stopped. | Low | After a cancel, emit a synthetic stderr chunk with cancellation message before closing with `result.cancelled: true`. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| New agent-specific sequential execution engine | Code duplication. Any fix to the local executor (cwd resolution, for_each loop, placeholder resolution) would need to be replicated. The local executor and the agent executor would drift. | Reuse `executor.run()`. Accept the cost of intercepting stdout/stderr. |
| Multi-alias YAML dispatch (dispatch frame contains a YAML with two+ top-level aliases) | Current contract: one alias per dispatch. Changing this requires server-side changes (task snapshot format), agent changes, and UI changes. The existing single-alias + sequential/parallel inside it is sufficient for all real use cases. | Keep the "one alias per dispatch" contract. Sequential/parallel lives inside that one alias, not as multiple dispatched aliases. |
| Per-step `result` frame (one result per step, not one per run) | This would require server protocol changes (new frame type), new DB tables, and UI updates. The current `result` frame maps cleanly to a single task run. Step-level status can be inferred from step-boundary markers in the log stream. | One `result` frame per dispatch, as today. Use step-header markers in log stream for step-level visibility. |

### Protocol Impact (DISP-01)

No new WS frame types needed. The `dispatch` frame already carries `yaml_definition` which can contain a `sequential` or `parallel` alias. The `result`, `log_chunk`, `state` frames are unchanged. The only change is in how the agent processes the dispatched alias after parsing.

### Dependencies

- DISP-01 depends on `packages/xci/src/executor/` being stable (it is, since Phase 4)
- The executor's stdout/stderr writes need to be redirectable. Currently `runSingle()` passes through to `process.stdout/process.stderr`. Agent can intercept via Node.js stream substitution or by wrapping in a child process with `stdio: 'pipe'`.
- DISP-01 depends on the existing `spawnTask` contract. The simplest approach: replace `spawnTask` with `spawnMultiStepTask` that wraps `executor.run()` and adapts its output to the `onChunk`/`onExit` callbacks.

---

## Area 3: Go CLI Parity (GOCLI-06 through GOCLI-10)

### Context: What Needs Porting

The TypeScript CLI has these behaviors not yet in go-xci:

1. **GOCLI-06 — Colored output + run-header recap**: `output.ts` prints a `▶ running: <alias>` header in bold cyan, variables block, cwd line in bright yellow, and steps list before execution starts. Step headers use `▶ stepname [N/M]` in bold cyan. Step results use `✓ stepname OK (ms)` / `✗ stepname FAILED (exit N)` in green/red.

2. **GOCLI-07 — `for_each.in` with `${VAR}` placeholder**: TypeScript `CommandDef` has a `for_each` kind with `var`, `in` (array or CSV string), `mode` (steps/parallel), and `cmd`/`run`. The resolver expands it into sequential steps (one per value) or a parallel group. The loop variable is injected as a placeholder.

3. **GOCLI-08 — `cwd` field with parent→child inheritance**: Already partially in go-xci (the `Cwd` field exists in `CommandDef` and `Plan`). What's missing: (a) run-header recap shows cwd in dark yellow before steps; (b) per-step cwd shown in dark yellow before each step executes; (c) `executor.go` `runSingle` and `runSequential` print `cwd: <path>` in yellow before spawn.

4. **GOCLI-09 — Breadcrumb in step headers**: TypeScript resolver adds a `breadcrumb` field to each `SequentialStep` — the chain of alias names that produced the step, e.g. `["release", "build", "compile"]`. The header displays `release > build > compile`. Currently go-xci shows `step N: <label>` without breadcrumb. The resolver needs to pass down a chain and embed it in `Step.Label`.

5. **GOCLI-10 — Print effective cwd before each step**: TypeScript `printStepPreview()` writes `  cwd: <path>` in dark yellow (SGR 33, not bright yellow SGR 93) to stderr before each step's `run:` line. go-xci currently does `(cwd: <path>)` inline in the step header, which is not the same UX.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Run-header in Go CLI (alias name, variables, cwd, steps preview) — GOCLI-06 | TypeScript CLI prints this before every run. Go CLI must match. Users switching between the two binaries expect identical pre-execution output. | Med | New `printRunHeader(alias, plan, cfg)` function in `go-xci/internal/executor/`. Outputs to `os.Stderr`. Respects `NO_COLOR`/`FORCE_COLOR` env vars and `os.Stderr` TTY check. Colors: bold cyan for alias name and step arrows, bright yellow for cwd, plain for variable values (redact secrets). |
| Step headers with count `▶ step N/M: <label>` in bold cyan — GOCLI-06 | Every step in a sequential chain should print a header. Currently go-xci prints `[xci] step N: <label>` without ANSI. | Low | Update `runSequential()` in `sequential.go` to use ANSI codes. Add `shouldUseColor()` check (same logic as TS). |
| Step result lines `✓ label OK (ms)` / `✗ label FAILED (exit N)` in green/red — GOCLI-06 | TypeScript `printStepResult()` prints these after each step completes. Go CLI currently has no post-step result line. | Low | Add result-printing to `runSequential()` after each `runSingle()` call. Time the step with `time.Now()`. |
| `for_each` kind support in loader and resolver — GOCLI-07 | Commands.yml may contain `for_each` aliases (teams already using TypeScript CLI). Go CLI silently errors on them with "not supported". | High | (1) Add `KindForEach` to `commands/types.go`. (2) Parse `for_each` block in `commands/loader.go` (lift the "not supported" error). (3) In `resolver/resolver.go`, expand for_each into sequential steps (one per `in` value) with loop variable substituted via `InterpolateArgvLenient`. CSV-split when `in` is a string (same as TS `csvSplit`). Parallel mode: expand into parallel group entries. |
| `cwd` dark yellow print before each step — GOCLI-08 / GOCLI-10 | TypeScript `printStepPreview()` outputs `  cwd: <path>` in dark yellow (SGR 33) as a distinct line before the `run:` line. Currently go-xci shows cwd inline in step header only. | Low | In `runSequential()`, print `  cwd: <path>` to stderr in yellow before printing the `run:` preview, when `cwd != ""`. In `runSingle()`, add the same before spawning. |
| Breadcrumb in step headers `release > build > compile` — GOCLI-09 | TypeScript resolver passes `breadcrumb []string` down into each step. Go resolver currently passes just a label string. Without breadcrumb, users debugging a 3-level alias chain can't tell which parent generated the failing step. | Med | Add `Breadcrumb []string` field to `resolver.Step`. In `resolveAlias()`, when inlining sub-alias steps, prepend the current alias name to the chain. In `runSequential()`, render label as `strings.Join(step.Breadcrumb + step.Label, " > ")` if breadcrumb is non-empty. |
| Color detection: respect `NO_COLOR` and `FORCE_COLOR`, fall back to TTY — GOCLI-06 | TypeScript `shouldUseColor()` checks `NO_COLOR`, `FORCE_COLOR`, then `process.stdout.isTTY`. Go must replicate exactly for consistent behavior in CI (piped output) vs terminal. | Low | New `shouldUseColor()` function in `go-xci/internal/executor/output.go`. Checks `os.Getenv("NO_COLOR") != ""` (disable), `os.Getenv("FORCE_COLOR") != ""` (enable), then `term.IsTerminal(int(os.Stderr.Fd()))` from `golang.org/x/term`. |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `for_each` CSV-split from `${VAR}` at resolve time | TypeScript resolver splits `${VAR}` placeholder via CSV when `in` is a string (e.g. `in: "${FILES}"` where `FILES=a.txt,b.txt`). Enables dynamic iteration over config-provided lists. Same semantic in Go avoids user confusion. | Low | After interpolating the `in` string, if it contains commas: split on `,`, trim whitespace, filter empty strings. Identical to TS `csvSplit()`. |
| Parallel `for_each` mode in Go | TypeScript supports `mode: parallel` for for_each, running all iterations concurrently via `runParallel`. Go parity means `for_each.mode: parallel` should expand to a parallel group and run concurrently. | Med | In resolver, when `for_each.mode == "parallel"`, produce a `KindParallel` plan with one `GroupEntry` per iteration value. `runParallel()` handles the concurrency. |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Custom color palette in Go (different from TypeScript) | Visual inconsistency between Go and TypeScript CLIs confuses users who run both. The TypeScript palette is already documented in `output.ts`. | Use the exact same ANSI codes: bold cyan (`\x1b[1m\x1b[36m`) for run headers and step arrows, bright yellow (`\x1b[93m`) for top-level cwd, dark yellow (`\x1b[33m`) for per-step cwd, green (`\x1b[32m`) for OK, red (`\x1b[31m`) for FAILED. |
| `ini` kind support in Go (out of scope for GOCLI-07) | `ini` is a complex feature with file parsing. The TypeScript loader already marks it as out-of-scope for Go. Including it in this milestone is scope creep. | Keep the "ini aliases are not supported in the Go port" error. Document that `ini` is TypeScript-only for now. |
| Capture (`capture:` field) in Go for_each | The TypeScript `capture` feature pipes step stdout into a named variable for subsequent steps. Implementing this in Go for_each would require a capture executor. Out of scope for v2.1. | Skip capture in Go for_each. Document it as a TypeScript-only feature. |

### Exact Color Codes for Go (from TypeScript source)

From `packages/xci/src/executor/output.ts`:

| Purpose | ANSI Code | SGR |
|---------|-----------|-----|
| Run header title (bold cyan) | `\x1b[1m\x1b[36m` | Bold + Cyan |
| Step arrow (`▶`) | `\x1b[1m\x1b[36m` | Bold + Cyan |
| OK result | `\x1b[32m` | Green |
| FAILED result | `\x1b[31m` | Red |
| Top-level cwd | `\x1b[93m` | Bright Yellow |
| Per-step cwd | `\x1b[33m` | Dark Yellow (distinct from run header) |
| dim prefix | `\x1b[2m` | Dim |
| Reset | `\x1b[0m` | Reset |

The dark-yellow vs bright-yellow distinction for per-step vs run-header cwd is intentional per source comment `quick-260422-mxr` in output.ts. The Go port must replicate this difference.

### for_each DSL Structure to Port

From `packages/xci/src/types.ts` `CommandDef` for_each kind:

```
for_each:
  var: ITEM           # loop variable name
  in:                 # array literal OR single "${VAR}" (CSV-split at resolve time)
    - a
    - b
  mode: steps         # "steps" = sequential, "parallel" = concurrent
  cmd: echo ${ITEM}   # inline command using ${var}
  # OR
  run: some-alias     # reference to another alias
  cwd: ./subdir       # optional, inherited
```

The Go `CommandDef` needs a new `KindForEach` with fields: `ForEachVar string`, `ForEachIn []string` (after parsing/normalization), `ForEachInRaw string` (if it was a placeholder like `${FILES}`), `ForEachMode string` (`"steps"` | `"parallel"`), `ForEachCmd []string` (from `cmd`), `ForEachRun string` (alias reference from `run`).

### Dependencies

- GOCLI-06 (color output): isolated to `go-xci/internal/executor/`, new `output.go` file. No dependency on other parity features.
- GOCLI-07 (for_each): depends on loader changes (`commands/loader.go` — lift the error guard), types changes (`commands/types.go` — new Kind), resolver changes (`resolver/resolver.go` — new expansion logic). Med complexity but well-isolated to existing packages.
- GOCLI-08 / GOCLI-10 (cwd print): depends on GOCLI-06 (needs `shouldUseColor()` and YELLOW constant). Low complexity once output.go exists.
- GOCLI-09 (breadcrumb): depends on resolver changes (add `Breadcrumb` to `Step`). Isolated to resolver + executor. Does not depend on GOCLI-07.

---

## Feature Dependencies (Cross-Area)

```
[Go output.go — shouldUseColor + ANSI constants] (GOCLI-06)
    └──required-by──> [Step cwd print in yellow] (GOCLI-08/10)
    └──required-by──> [Colored step result lines] (GOCLI-06)
    └──required-by──> [Run header recap] (GOCLI-06)

[xci --list-raw flag] (TypeScript)
    └──required-by──> [bash completion script] (DX-01)
    └──required-by──> [zsh completion script] (DX-01)
    └──required-by──> [fish completion script] (DX-01)
    └──required-by──> [powershell completion script] (DX-01)

[cobra ValidArgsFunction in go-xci] (DX-01)
    └──required-by──> [go-xci completion bash/zsh/fish/powershell]

[existing executor.run() in packages/xci/src/executor/]
    └──reused-by──> [agent multi-step dispatch] (DISP-01)

[for_each KindForEach in loader.go + types.go] (GOCLI-07)
    └──required-by──> [resolver for_each expansion] (GOCLI-07)
    └──required-by──> [parallel for_each mode] (GOCLI-07)
```

---

## MVP for v2.1 (these features)

### Must Ship

- Shell completions (bash + zsh + fish + powershell) via `xci completion <shell>` — DX-01
- Go CLI `xci --list-raw` for completion script backend
- Go CLI run-header (alias, vars, cwd, steps) with color — GOCLI-06
- Go CLI step headers with count and color, step result lines — GOCLI-06
- Go CLI `for_each.in` with `${VAR}` placeholder, both steps and parallel mode — GOCLI-07
- Go CLI `cwd` dark yellow per-step print — GOCLI-08/10
- Go CLI breadcrumb in step headers — GOCLI-09
- Agent dispatch sequential — DISP-01
- Agent dispatch parallel — DISP-01

### Explicit Defers Beyond v2.1

- `ini` kind in Go CLI — TypeScript-only, defer to v3
- `capture:` in Go CLI — TypeScript-only, defer to v3
- Go CLI `--from` step (resume from step N) — TypeScript-only, defer to v3
- Global log search — flagged in v2.0 as v2.1, but still out-of-scope here (separate feature)

---

## Complexity Summary

| Feature | Complexity | Key Risk |
|---------|------------|----------|
| DX-01: TypeScript `xci completion <shell>` | Med | `--list-raw` flag + 4 embedded script strings |
| DX-01: Go `go-xci completion <shell>` (cobra) | Med | `ValidArgsFunction` wiring + cobra built-in generators |
| GOCLI-06: colored output (run header, step header, step result) | Med | New `output.go` in go-xci, TTY detection, color detection |
| GOCLI-07: `for_each` in Go | High | New Kind, loader parsing, resolver expansion (steps + parallel), CSV-split |
| GOCLI-08/10: cwd dark-yellow print | Low | One-liner additions in sequential.go and single.go |
| GOCLI-09: breadcrumb in step headers | Med | Resolver breadcrumb propagation + Step struct change |
| DISP-01: agent sequential dispatch | High | stdout/stderr redirection from executor.run() to onChunk |
| DISP-01: agent parallel dispatch | Med | Leverages sequential path; parallel adds concurrency plumbing |

---

## Sources

- TypeScript source `packages/xci/src/executor/output.ts` — exact ANSI codes and color logic (HIGH confidence — primary source)
- TypeScript source `packages/xci/src/types.ts` — for_each CommandDef shape, breadcrumb field (HIGH confidence)
- TypeScript source `packages/xci/src/executor/sequential.ts` — step header / result / cwd print pattern (HIGH confidence)
- TypeScript source `packages/xci/src/resolver/index.ts` — CSV split, for_each expansion, breadcrumb propagation (HIGH confidence)
- TypeScript source `packages/xci/src/agent/runner.ts` — current single-command spawn contract (HIGH confidence)
- Go source `go-xci/internal/executor/sequential.go` — current sequential output format (HIGH confidence)
- Go source `go-xci/internal/commands/loader.go` — for_each and ini currently marked "not supported" (HIGH confidence)
- Go source `go-xci/cmd/root.go` — cobra root command; no ValidArgsFunction yet (HIGH confidence)
- [Cobra shell completion docs](https://cobra.dev/docs/how-to-guides/shell-completion/) — cobra `ValidArgsFunction`, `GenBashCompletion()`, `GenZshCompletion()`, `GenFishCompletion()`, `GenPowerShellCompletion()` (MEDIUM confidence — docs reviewed via WebFetch)
- [go-task zsh completion](https://github.com/go-task/task/blob/main/completion/zsh/_task) — `__task_list()` calls `task --list-all` at completion time; same pattern proposed for xci (MEDIUM confidence — reviewed via WebFetch)
- [go-task fish completion](https://github.com/go-task/task/blob/main/completion/fish/task.fish) — `complete -xa "(task --list-all)"` pattern (MEDIUM confidence — reviewed via WebFetch)
- Shell adoption stats 2025: Zsh 68.5%, Bash 22.3%, Fish 7.1%, PowerShell 2.1% (LOW confidence — single WebSearch result, unverified primary source)

---

*Feature research for: xci v2.1 — Quality & Parity*
*Researched: 2026-06-01*
