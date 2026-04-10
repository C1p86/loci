# Pitfalls Research

**Domain:** Cross-platform Node.js CLI command runner with layered YAML config
**Researched:** 2026-04-10
**Confidence:** HIGH (cross-platform, YAML, security pitfalls) / MEDIUM (some Windows-specific signal behavior)

---

## Critical Pitfalls

### Pitfall 1: shell:true Destroys Cross-Platform Compatibility

**What goes wrong:**
Using `shell: true` in execa (or `child_process.spawn`) routes the command through the system shell. On Unix this is `/bin/sh`; on Windows this is `cmd.exe`. The syntaxes are fundamentally different — redirections, quoting, environment variable expansion, and operators (`&&`, `||`, `|`) that work on bash will silently fail or behave wrong on `cmd.exe`. A command like `npm run build && npm run test` executed with `shell:true` will work on macOS/Linux but fail in Windows cmd.exe if `&&` is not supported in that context, or behave differently in PowerShell.

**Why it happens:**
The shell option feels like the easy path when commands contain operators or pipes. Developers coming from a Unix background write shell syntax without realizing it only works on their machine.

**How to avoid:**
Never use `shell: true` for commands sourced from user YAML config. Parse the command string into an executable + argv array before spawning (libraries like `shell-quote` parse a POSIX-style shell command string into tokens). Spawn with `execa(executable, args)` — no shell involved. For commands that genuinely require shell features (pipes, redirections), document this as a user responsibility: they must write platform-appropriate syntax or use a cross-platform wrapper.

The execa documentation explicitly states: "In almost all cases, plain JavaScript is a better alternative to shells. `sh` and `cmd.exe` syntaxes are very different. Therefore, [shell: true] is usually not useful."

**Warning signs:**
- Commands with `&&`, `||`, `|`, `>`, `<` operators in YAML
- Tests pass on macOS/Linux but fail on Windows CI
- Command parsing logic uses a single string rather than `[executable, ...args]`

**Phase to address:** Executor phase (process spawning). Must be decided before writing any spawn call.

**Severity:** CRITICAL

---

### Pitfall 2: Windows PATHEXT — .cmd/.bat Files Are Not Directly Spawnable

**What goes wrong:**
On Windows, many CLI tools installed via npm are `.cmd` shim files (e.g., `tsc.cmd`, `eslint.cmd`). Node's `child_process.spawn` does not consult `PATHEXT` on Windows, so `spawn('tsc', args)` throws `ENOENT` because there is no `tsc` executable — only `tsc.cmd`. This means every tool installed globally via npm on Windows fails to spawn unless the caller handles PATHEXT resolution explicitly.

**Why it happens:**
Developers test on macOS/Linux where `tsc` is a real executable (symlink). They never hit the issue locally. The PATHEXT problem only surfaces on real Windows (not WSL).

**How to avoid:**
Use `execa` (v6+) or `cross-spawn` — both handle PATHEXT resolution automatically. Never use `child_process.spawn` directly. Verify with an integration test that runs `npm run build` (or equivalent) inside a spawned process on Windows CI.

**Warning signs:**
- `ENOENT` errors on Windows for commands that definitely exist
- No Windows CI environment set up
- Direct use of `child_process.spawn` without a cross-platform wrapper

**Phase to address:** Executor phase. Choose the spawn library before writing any process execution code.

**Severity:** CRITICAL (Windows-only, but the primary platform where it shows up is also where users are most likely to be)

---

### Pitfall 3: Orphaned Child Processes on Parent Kill (Especially Parallel Groups)

**What goes wrong:**
When the user presses Ctrl+C or the loci process is killed, spawned child processes — especially those in a parallel group — continue running as orphans. The parent process exits but the children keep going, consuming CPU and holding ports. On Linux/macOS, sending `SIGINT` to the terminal propagates to the process group so children often die naturally. On Windows there is no POSIX process group model: killing the parent does nothing to its children.

**Why it happens:**
Node.js does not automatically kill child processes when the parent exits. Process group semantics are not cross-platform. The default behavior of `spawn` creates independent processes.

**How to avoid:**
- Register `process.on('exit')`, `process.on('SIGINT')`, `process.on('SIGTERM')` handlers that explicitly call `.kill()` on all tracked subprocess references.
- For deep process trees (e.g., `npm run build` spawns its own children), use the `tree-kill` npm package to kill the entire subtree, not just the direct child.
- execa v9 exposes a `cleanup: true` option (default true) that kills the child when the parent exits — verify this is active.
- Keep a registry of all running subprocesses; iterate and kill in the cleanup handler.

**Warning signs:**
- No `process.on('exit')` / `process.on('SIGINT')` handler in the executor
- Parallel group implementation that `Promise.all`s without abort logic
- Missing cleanup test: start a long-running command, kill loci, verify the child is gone

**Phase to address:** Executor phase (both sequential and parallel). Must handle cleanup before parallel execution is considered complete.

**Severity:** CRITICAL

---

### Pitfall 4: Secrets Values Appearing in Verbose Output / Error Messages

**What goes wrong:**
In `--verbose` or debug mode, loci logs the resolved config values before executing a command. The merged config includes secrets from `secrets.yml`. A `console.log('Resolved config:', mergedConfig)` or an error that says `Missing value for ${DEPLOY_TOKEN}` and then prints the full context object will expose database passwords, API tokens, and SSH keys to the terminal — and potentially to CI/CD build logs that are stored and world-readable.

**Why it happens:**
Debug logging is added during development with no thought to which fields are sensitive. The config merge is a plain object, so logging it logs everything.

**How to avoid:**
- Maintain a strict separation between the config layer and the display layer. Never pass the raw merged config to any logging function.
- Create a `sanitize(config, secretKeys)` function that replaces any key loaded from `secrets.yml` with `***REDACTED***` before display.
- In error messages about missing interpolation variables, show the variable name but never its value.
- Write a test: load a config with a known secret value, run in `--verbose` mode, assert the secret value does not appear in stdout/stderr.

**Warning signs:**
- `console.log(config)` or `JSON.stringify(mergedConfig)` anywhere in the codebase
- Verbose mode dumps the entire resolved context
- No sanitization layer between config loading and display

**Phase to address:** Config loader phase (establish the redaction contract when secrets.yml is loaded) and CLI output phase (enforce at the display boundary).

**Severity:** CRITICAL

---

### Pitfall 5: Command Injection via Interpolated Config Values

**What goes wrong:**
`${VAR}` placeholders are replaced with values from the merged config before the command is executed. If a config value contains shell metacharacters — `;`, `&&`, `$(...)`, backticks, `|` — and the final command string is passed to `shell:true` or `exec()`, the attacker (or a malicious `local.yml`) can inject arbitrary shell commands.

Even without a malicious actor, a value like `C:\Users\John Doe\project` (a path with a space) embedded in a command string without quoting will cause the command to break argument parsing.

**Why it happens:**
The simplest interpolation implementation does string replacement and then passes the result directly to the shell. This is the textbook command injection vector.

**How to avoid:**
- Do NOT pass the interpolated command string to a shell. Instead: parse the command string into `[executable, arg1, arg2, ...]` *before* interpolation; interpolate each argument independently as a complete token; spawn with `execa(executable, [arg1, arg2])`. This way, no argument can escape its own slot.
- If the command string is a single value (not parsed), use `execa`'s template literal API which handles escaping: `` execa`${cmd} ${arg}` `` — but understand its semantics.
- Reject or warn on config values that contain characters that would be dangerous if a shell were ever used: `; & | > < $( )`.

**Warning signs:**
- Interpolation result is used as a single string passed to `exec()` or `spawn({shell:true})`
- No argument-splitting step between interpolation and spawning
- Test suite has no test with a value containing spaces or special characters

**Phase to address:** Interpolation phase. The contract "interpolation happens into argument slots, not into a shell string" must be established before any command execution is written.

**Severity:** CRITICAL

---

### Pitfall 6: YAML Type Coercion Corrupting Config Values

**What goes wrong:**
js-yaml v3 (YAML 1.1 schema by default) silently coerces many unquoted strings to unexpected types:
- `no`, `off`, `n`, `false`, `No` → JavaScript `false`
- `yes`, `on`, `y`, `true`, `Yes` → JavaScript `true`
- `0123` → decimal `123` (YAML 1.1 octal)
- `0o123` → octal `83`
- `1:30` → base-60 number `90`
- `null`, `~` → JavaScript `null`

This means a user's config `REGION: no` (intending the string `"no"`) silently becomes `false`. The Norway Problem: country code `NO` becomes `false`. An environment name `on-prem` is fine but `on` alone becomes `true`.

js-yaml v4 switched to YAML 1.2 and fixed most of these (only `true`/`false` are booleans), but the **v3-to-v4 migration broke the API** (`yaml.safeLoad` was removed; use `yaml.load` which is safe by default).

**Why it happens:**
Developers write YAML intuitively without knowing the 1.1 schema's traps. They don't quote values because they look like strings. The coercion is silent.

**How to avoid:**
- Use js-yaml v4 (YAML 1.2 compliant) — most of the coercion traps disappear.
- Still quote ambiguous values in documentation and examples: `DEPLOY_ENV: "no"`, `REGION: "on"`.
- After parsing any YAML file, validate the resulting object with a JSON Schema or Zod schema. This surfaces type mismatches immediately at load time rather than at command execution time.
- Write tests that load YAML containing `no`, `yes`, `on`, `off`, `~`, `null`, `0123` and assert they produce the expected JavaScript types.

**Warning signs:**
- Using js-yaml v3
- No schema validation after YAML parse
- Test suite has no YAML type coercion coverage

**Phase to address:** Config loader phase.

**Severity:** CRITICAL

---

### Pitfall 7: Recursive Alias Composition Infinite Loop

**What goes wrong:**
loci supports alias composition: an alias can reference other aliases. If `build` references `compile`, which references `build`, the resolution recurses infinitely, eventually causing a stack overflow or hanging forever. This is easy to create accidentally when reorganizing commands.

**Why it happens:**
Graph traversal without cycle detection. The natural recursive implementation follows references without tracking which nodes have been visited.

**How to avoid:**
- During the command loading/validation phase (at startup, before any execution), build the alias dependency graph and run a cycle detection algorithm (DFS with a "visited" set and a "currently in stack" set).
- Report a clear error at startup: `Circular reference detected: build → compile → build`.
- Fail fast — never start execution if cycles are present.
- This can also apply to `${VAR}` interpolation if config values can reference other config values: detect `${A}` = `${B}` and `${B}` = `${A}` during the config loading phase.

**Warning signs:**
- No cycle detection in the alias resolution code
- Composition is implemented as pure recursion with no visited-node tracking
- No test with circular alias definitions

**Phase to address:** Config loader / command resolver phase (startup validation).

**Severity:** CRITICAL — a hang is worse than an error

---

## Important Pitfalls

### Pitfall 8: Interleaved stdout/stderr in Parallel Groups Making Output Unreadable

**What goes wrong:**
When running 3 commands in parallel, each writes to stdout and stderr independently. The output from all three streams is interleaved in real time: `[cmd-a] compiling...`, `[cmd-b] starting server...`, `[cmd-a] error: module not found`, `[cmd-c] done`. Without prefixing, the output is a useless jumble. This is the standard experience of parallel task runners that don't prefix output.

**Why it happens:**
Streaming output directly to `process.stdout`/`process.stderr` (pipe-through) is the simplest implementation. Prefixing requires buffering lines or wrapping the write stream.

**How to avoid:**
- For parallel groups, prefix each line with `[alias-name]` before writing to stdout/stderr.
- Use a line-buffering transform stream (`readline` interface or a `split2` stream) that emits complete lines, then prepend the prefix and write.
- The `execa` `lines` option (v9) emits output line by line, making this straightforward.
- Consider offering a `--no-prefix` flag for when the user wants raw output.

**Warning signs:**
- Parallel implementation uses `subprocess.stdout.pipe(process.stdout)` directly
- No line buffering in the parallel output path
- No manual test with two commands that produce overlapping output

**Phase to address:** Parallel execution phase.

**Severity:** IMPORTANT — breaks the UX of parallel commands entirely

---

### Pitfall 9: Exit Code Not Propagated Correctly

**What goes wrong:**
loci exits with code 0 even when the child command failed. This silently breaks CI pipelines — the user's `loci deploy` step shows green but deployment actually failed. Common causes: catching the error from execa without re-throwing, using `.catch(() => {})` to suppress rejections in parallel groups, or calling `process.exit()` without the correct code.

**Why it happens:**
Async error handling in Node.js swallows errors easily. A `try/catch` that logs but doesn't re-exit with the child's code is the typical mistake.

**How to avoid:**
- execa throws an `ExecaError` that includes `.exitCode` when a command fails. Catch it explicitly, extract the exit code, and call `process.exit(exitCode)`.
- For sequential chains: stop at first failure, propagate that exit code.
- For parallel groups: when any command fails, collect all exit codes, exit with the first non-zero (or a documented aggregate strategy, e.g., exit code 1 if any failed).
- Integration test: run `loci` with a command that exits with code 42, assert `process.exitCode` is 42.

**Warning signs:**
- No `process.exit(code)` call in the error path
- `catch` blocks that only log and don't re-exit
- No test that verifies exit code propagation

**Phase to address:** Executor phase.

**Severity:** IMPORTANT — silent failures in CI are a trust-destroying bug

---

### Pitfall 10: SIGINT on Windows Does Not Gracefully Terminate Subprocesses

**What goes wrong:**
On Windows, sending `SIGINT` to a child process created with Node's spawn causes it to **die instantly** — it cannot catch the signal to clean up. There is no equivalent of POSIX process groups. This means pressing Ctrl+C may kill loci but leave database connections, temporary files, or server ports open if the child process relied on a graceful shutdown handler.

Additionally, `forceKillAfterDelay` in execa has no effect on Windows.

**Why it happens:**
POSIX signal semantics do not exist on Windows. `SIGINT`, `SIGTERM`, and `SIGKILL` all cause immediate termination of the target process on Windows; there is no graceful path.

**How to avoid:**
- Accept this as a Windows platform limitation and document it.
- For processes that need graceful shutdown, recommend wrapping them in a Node.js script that handles cleanup itself (since Node does get a chance to run its own exit handlers on Windows via `process.on('exit')`).
- Use execa's `cleanup: true` option so at minimum the child is killed when the parent exits.
- Consider using `windowsHide: false` in edge cases where SIGINT propagation to a console subprocess is needed.

**Warning signs:**
- Tests assume Ctrl+C produces a clean exit on all platforms
- Documentation promises graceful shutdown without Windows caveat

**Phase to address:** Executor phase. Document the limitation; don't try to fully fix what the OS doesn't support.

**Severity:** IMPORTANT (Windows-specific)

---

### Pitfall 11: Commander.js Global Flags Conflicting with Pass-Through Flags

**What goes wrong:**
loci has its own flags like `--verbose`, `--dry-run`, `--config`. A user running `loci deploy --verbose` expects `--verbose` to control loci's verbosity. But what about `loci docker -- --verbose`? If commander.js parses arguments before the `--` separator, it will consume `--verbose` and never pass it to the underlying command. Conversely, if the user forgets `--`, loci's `--verbose` activates when they meant to pass it to docker.

**Why it happens:**
Commander.js processes all arguments eagerly by default. The `--` separator convention is POSIX-standard but many users don't know it.

**How to avoid:**
- Use commander's `.passThroughOptions()` and `.enablePositionalOptions()` on subcommands so that arguments after the alias name are passed through without being parsed as loci flags.
- Document the `--` separator clearly with examples.
- Consider whether loci's own flags (`--verbose`, `--dry-run`) should be global (before the alias name) vs. local (after). Choosing global-only positions simplifies this: `loci --verbose deploy` always means loci verbosity; `loci deploy --extra` always passes `--extra` to the command.

**Warning signs:**
- No test that runs `loci alias -- --flag` and verifies `--flag` reaches the subprocess
- No test that runs `loci --verbose alias` vs `loci alias --verbose` to verify different behavior

**Phase to address:** CLI scaffolding phase.

**Severity:** IMPORTANT — confusing UX that is hard to change after release

---

### Pitfall 12: secrets.yml Already Git-Tracked Before .gitignore Is Applied

**What goes wrong:**
If a developer creates `.loci/secrets.yml` and then adds the `.gitignore` rule, but the file was committed to git before that rule was added, `git status` will continue to show the file as tracked. `.gitignore` only prevents untracked files from being staged — it does not un-track files that git already knows about. The secrets file will be present in the repository indefinitely until explicitly removed with `git rm --cached`.

**Why it happens:**
Developers create files before configuring gitignore. This is a perennial git beginner mistake. The initial scaffold of the `.loci/` directory may create `secrets.yml` as a placeholder before the user sets up their repository.

**How to avoid:**
- At startup, if loci finds a `.loci/secrets.yml`, run `git ls-files --error-unmatch .loci/secrets.yml 2>/dev/null` to check if the file is tracked. If it is, emit a prominent warning: `WARNING: .loci/secrets.yml appears to be tracked by git. Your secrets may be exposed. Run: git rm --cached .loci/secrets.yml`.
- When loci is used to scaffold a project (if a scaffold command is added), write the `.gitignore` entries before creating the secrets file.
- Document this prominently in the README.

**Warning signs:**
- No git-tracked-secrets detection in the startup check
- loci scaffold creates `secrets.yml` without first writing `.gitignore`

**Phase to address:** Config loader phase (startup check) and distribution phase (documentation).

**Severity:** IMPORTANT — security issue, not just UX

---

### Pitfall 13: ESM vs CJS for the CLI Entry Point

**What goes wrong:**
Publishing an ESM-only package (`"type": "module"` in package.json) causes problems for users on older Node.js LTS versions that don't fully support ESM (Node 14, Node 16 had partial ESM support with quirks). Additionally, if loci's dependencies are CJS, an ESM entry point causes `require()` to fail for any internal usage. The dual-publish approach (both ESM and CJS) risks the "dual package hazard" where two instances of a singleton module exist at runtime.

For a CLI tool specifically, there is no downstream importer — nobody `require('loci')`. This makes the decision simpler than for a library.

**Why it happens:**
The Node.js ecosystem has been in a multi-year ESM migration. The "right" answer has changed repeatedly. In 2025, ESM is preferred for new code but the toolchain (tsup, esbuild) adds complexity.

**How to avoid:**
- For a CLI (no library exports), publish as **CJS** (default `"type": "commonjs"`) with TypeScript compiled by `tsc` or `tsup` targeting CommonJS. This works on all supported Node.js LTS versions (18, 20, 22) without any module interop issues.
- Alternatively, publish as ESM-only and set `engines.node: ">=20"` (Node 20+ has stable ESM). This is the modern choice but narrows the compatibility window.
- The 2025 community consensus from Liran Tal and others: for a new CLI, ESM-only with a minimum Node 20 requirement is the cleanest path. CJS is the safe fallback if you need Node 18 support.
- Never dual-publish a CLI — there are no importers, so there is no reason to.

**Warning signs:**
- `"type": "module"` in package.json with no `engines.node` restriction
- Using `import()` dynamic syntax alongside `require()` without a clear strategy
- Build output not tested on the minimum supported Node version

**Phase to address:** Project scaffolding phase (package.json setup before any code is written).

**Severity:** IMPORTANT — hard to change after publishing

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `shell: true` for all spawns | No need to parse command strings | Commands only work on the OS they were written on; command injection risk | Never — parse into argv array instead |
| Log raw merged config in verbose mode | Easy debugging | Secrets leak in CI logs; terminal output; bug reports | Never — always redact secrets layer |
| `exec()` (single string) instead of `spawn(executable, args[])` | Simpler for complex commands | Command injection vector; platform differences in shell | Never for user-supplied commands |
| Skip cycle detection in alias composition | Faster to implement | Infinite loop / hang on bad config | Never — runs once at startup, negligible cost |
| Hardcode `process.exit(1)` on all errors | Simple error handling | Loses the actual exit code from the failed child | Never — propagate the real exit code |
| No prefix on parallel output | Zero implementation work | Parallel output is unreadable | Only in MVP if parallel is explicitly deferred |
| CJS only, skip ESM consideration | Avoids module format complexity | May need to revisit when ESM deps are added | Acceptable for v1 — revisit at major version |
| No startup validation of commands.yml | Faster startup | Silent failures or confusing errors at execution time | Never — validate eagerly for better UX |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| execa + Windows | `spawn('npm', ...)` without cross-platform considerations | Use execa (handles PATHEXT) or cross-spawn; never raw `child_process.spawn` |
| execa + parallel | `Promise.all` without abort on first failure | Use `AbortController` + `cancelSignal` option to abort remaining processes |
| js-yaml v4 | Using `yaml.safeLoad` (removed in v4) | Use `yaml.load` (safe by default in v4) |
| commander.js + dynamic commands | Calling `program.parse()` before `addCommand()` completes | Register all commands synchronously before `program.parse(argv)` |
| commander.js + passthrough | Using `--` without configuring `passThroughOptions()` | Call `.passThroughOptions()` and `.enablePositionalOptions()` on the parent |
| npm bin shim on Windows | Shim references `/bin/sh` which doesn't exist on Windows | Shebang `#!/usr/bin/env node` — npm's `cmd-shim` handles the rest; avoid `/bin/sh` shebang variants |
| Parallel + output streams | `subprocess.stdout.pipe(process.stdout)` | Use execa's `lines` option; prefix each line with `[alias]` via a transform stream |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Loading all 4 config files synchronously with full YAML parse on every invocation | Cold start > 300ms even when just listing help | Use `fs.existsSync` to skip missing files; consider lazy loading | On slow disks or NFS mounts — immediately |
| Walking up directory tree to find `.loci/` on every startup | Noticeable lag when called deep in a directory tree | Cache the resolved project root; walk up once, bail early | Directories nested 10+ levels deep |
| Importing heavy transitive dependencies (e.g., lodash, chalk with complex color detection) | Startup time creep as deps grow | Audit `node --prof` on cold start; prefer lightweight alternatives (`kleur` over `chalk`) | Gradually — hard to notice until it's 500ms |
| Validating YAML with a full JSON Schema validator on every run | 50-200ms extra per invocation | Validate only when config files change (mtime check) or on `--validate` flag | With large, complex config files |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging merged config object verbatim in `--verbose` | All secrets visible in terminal, CI logs, bug reports | Sanitize before display: replace values from secrets.yml with `***REDACTED***` |
| Passing interpolated string to `exec()` or `shell: true` | Command injection via crafted config values (spaces, `;`, `$()`) | Parse command into argv array; interpolate into slots, never into a raw string |
| secrets.yml tracked by git | Permanent exposure of credentials in repository history | Detect at startup with `git ls-files`; emit blocking warning; document `.gitignore` setup |
| Printing the missing variable name AND context in error messages | If the context includes nearby secret values, they're exposed | Only show the missing variable name: `Error: undefined variable: ${DEPLOY_TOKEN}` |
| Accepting interpolation values that are themselves `${VAR}` references (chained interpolation) | Circular reference hang; potential to reference variables from a different security tier | Resolve interpolation in a single pass; do not allow values to reference other values |
| No validation that `LOCI_MACHINE_CONFIG` path is readable before use | Confusing error: ENOENT with no context about which env var caused it | Check existence and readability at startup; emit clear error referencing `LOCI_MACHINE_CONFIG` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `loci sometypo` silently does nothing | User thinks the command ran; confusing | Exit with code 1, print "Unknown alias: sometypo" and list available aliases |
| Missing variable reports "undefined" without naming the variable | User reads `Error: undefined is not a string` with no context | Report `Error: variable ${DEPLOY_TOKEN} is not defined in any config layer` |
| Sequential chain shows no progress between steps | Looks frozen on long steps | Print `[loci] Running step 1/3: build...` before each step |
| `loci --help` only shows `loci [options] <command>` with no aliases | User can't discover what aliases exist | Dynamically include the alias list from `commands.yml` in help output |
| Version mismatch between team members is invisible | A new `commands.yml` feature silently fails on an older loci | Print loci version on startup in `--verbose` mode; document breaking changes prominently |
| No `--dry-run` mode | User can't verify what command will actually run before executing | Implement `--dry-run` early: print the resolved command + args without executing |

---

## "Looks Done But Isn't" Checklist

- [ ] **Cross-platform spawn:** Tested on real Windows (not WSL) — WSL behaves like Linux and will not surface PATHEXT or cmd shim issues
- [ ] **Exit code propagation:** Run `loci` with a command that exits 42 and assert `$?` is 42 in shell
- [ ] **Secrets redaction:** Run `loci --verbose` with a secrets.yml value present and grep stdout for the secret value — it must not appear
- [ ] **Parallel orphan cleanup:** Start a `sleep 60` command in a parallel group, kill loci, verify `sleep` process is also gone
- [ ] **YAML coercion:** Load a YAML file with `enabled: no` and assert it is the string `"no"`, not `false`
- [ ] **Circular alias:** Define `a: [b]`, `b: [a]` in commands.yml and assert loci exits with a clear error, not a hang
- [ ] **Secrets tracking:** Commit secrets.yml to a test repo, then run loci — assert the warning appears
- [ ] **Pass-through flags:** Run `loci alias -- --flag value` and assert `--flag value` appears in the spawned command's argv

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| shell:true baked into executor | HIGH | Refactor all spawn calls; add argument-parsing layer; regression test on Windows |
| Secrets leaked in git history | HIGH | `git filter-repo` or BFG to rewrite history; rotate all exposed credentials; force-push (disrupts all clones) |
| Exit code not propagated (shipped) | MEDIUM | Patch release; users had CI pipelines silently passing on failure |
| No orphan cleanup | MEDIUM | Add `process.on('exit')` handler; patch release; educate users to restart terminals |
| ESM/CJS choice wrong for target Node version | HIGH | Major version bump; breaking change for some users |
| YAML coercion bug in production configs | LOW-MEDIUM | Add validation layer; emit deprecation warning; configs with affected values need manual quoting |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| shell:true / PATHEXT | Executor phase (spawn library selection) | CI on real Windows with `.cmd` tool invocation |
| Orphaned child processes | Executor phase (cleanup handler) | Kill parent mid-parallel, verify children die |
| Secrets in verbose output | Config loader + CLI output phase | `--verbose` test: secret value absent from output |
| Command injection via interpolation | Interpolation phase | Test with value containing `;`, `$(cmd)`, spaces |
| YAML type coercion | Config loader phase (js-yaml v4 + schema validation) | Load YAML with `no`, `yes`, `0123` — assert types |
| Circular alias composition | Command resolver phase (startup validation) | Circular YAML → expect clean error, no hang |
| secrets.yml git-tracked | Config loader startup check | Test with git-tracked secrets.yml → expect warning |
| ESM vs CJS | Project scaffolding (package.json) | Test on minimum supported Node version |
| Commander flag conflicts | CLI scaffolding phase | Test `--` passthrough and global flag positioning |
| Exit code propagation | Executor phase | Assert `process.exitCode` matches child exit code |
| Interleaved parallel output | Parallel execution phase | Run two chatty parallel commands, verify prefixing |
| SIGINT / orphan on Windows | Executor phase | Windows CI: Ctrl+C test, verify child process gone |

---

## Sources

- execa Windows documentation: https://github.com/sindresorhus/execa/blob/main/docs/windows.md
- execa shell documentation: https://github.com/sindresorhus/execa/blob/main/docs/shell.md
- execa termination documentation: https://github.com/sindresorhus/execa/blob/main/docs/termination.md
- Node.js child_process SIGINT Windows issue: https://github.com/nodejs/node/issues/35172
- Node.js PATHEXT issue: https://github.com/nodejs/node/issues/6671
- cross-spawn npm package (PATHEXT handling): https://www.npmjs.com/package/cross-spawn
- js-yaml v4 migration guide: https://github.com/nodeca/js-yaml/blob/master/migrate_v3_to_v4.md
- The YAML document from hell (type coercion): https://ruudvanasseldonk.com/2023/01/11/the-yaml-document-from-hell
- The YAML document from hell — JavaScript edition: https://philna.sh/blog/2023/02/02/yaml-document-from-hell-javascript-edition/
- commander.js passThroughOptions issue: https://github.com/tj/commander.js/issues/1461
- LeakyCLI credential exposure in build logs: https://thehackernews.com/2024/04/aws-google-and-azure-cli-tools-could-leak-credentials-in-build-logs/
- TypeScript ESM/CJS in 2025: https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing
- npm cmd-shim on Windows: https://github.com/npm/feedback/discussions/148
- Lerna orphaned child processes (parallel): https://github.com/lerna/lerna/issues/2284
- Node.js command injection prevention: https://auth0.com/blog/preventing-command-injection-attacks-in-node-js-apps/
- Keeping secrets out of logs (HN discussion): https://news.ycombinator.com/item?id=45160774

---
*Pitfalls research for: cross-platform Node.js CLI command runner (loci)*
*Researched: 2026-04-10*
