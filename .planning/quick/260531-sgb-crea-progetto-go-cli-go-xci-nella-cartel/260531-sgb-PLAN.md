---
phase: quick-260531-sgb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - go-xci/go.mod
  - go-xci/main.go
  - go-xci/internal/config/types.go
  - go-xci/internal/config/loader.go
  - go-xci/internal/config/loader_test.go
  - go-xci/internal/commands/types.go
  - go-xci/internal/commands/loader.go
  - go-xci/internal/commands/loader_test.go
  - go-xci/internal/resolver/interpolate.go
  - go-xci/internal/resolver/interpolate_test.go
  - go-xci/internal/resolver/resolver.go
  - go-xci/internal/resolver/resolver_test.go
  - go-xci/internal/executor/types.go
  - go-xci/internal/executor/executor.go
  - go-xci/internal/executor/single.go
  - go-xci/internal/executor/sequential.go
  - go-xci/internal/executor/parallel.go
  - go-xci/internal/discovery/finder.go
  - go-xci/internal/discovery/finder_test.go
  - go-xci/cmd/root.go
  - go-xci/cmd/run.go
  - go-xci/cmd/init.go
autonomous: true
requirements: [GOXCI-01]

must_haves:
  truths:
    - "go build ./... succeeds in go-xci/ with zero errors"
    - "xci --list prints aliases with description and type, sourced from .xci/commands.yml"
    - "xci <alias> executes a single command and propagates its exit code"
    - "xci <alias> --dry-run prints config values (secrets redacted) and execution plan without spawning"
    - "Config loads across 4 layers (machine < project < secrets < local) with last-wins merge and ${KEY} self-interpolation"
    - "Sequential aliases stop at first failure; parallel aliases honor failMode fast/complete"
    - "xci init scaffolds .xci/ with commands.yml + config.yml and adds secrets/local entries to .gitignore"
    - "Existing packages/xci/ TypeScript code is untouched"
  artifacts:
    - path: "go-xci/go.mod"
      provides: "Go module with cobra + yaml.v3 dependencies"
      contains: "module"
    - path: "go-xci/internal/config/loader.go"
      provides: "4-layer config loading, YAML flattening, merge, self-interpolation"
    - path: "go-xci/internal/resolver/interpolate.go"
      provides: "${VAR} strict/lenient interpolation with $${} escape"
    - path: "go-xci/internal/resolver/resolver.go"
      provides: "alias -> ExecutionPlan resolution"
    - path: "go-xci/internal/executor/executor.go"
      provides: "dispatch single/sequential/parallel execution"
    - path: "go-xci/internal/discovery/finder.go"
      provides: "walk-up .xci/ discovery"
    - path: "go-xci/cmd/root.go"
      provides: "cobra root command + --list handler"
  key_links:
    - from: "go-xci/cmd/run.go"
      to: "go-xci/internal/resolver/resolver.go"
      via: "Resolve(alias, commands, config) -> ExecutionPlan"
    - from: "go-xci/internal/resolver/resolver.go"
      to: "go-xci/internal/executor/executor.go"
      via: "Run(plan, opts) -> exitCode"
    - from: "go-xci/cmd/root.go"
      to: "go-xci/internal/discovery/finder.go"
      via: "FindXciRoot(cwd) before config/commands load"
---

<objective>
Create a new Go CLI project in `go-xci/` (repo root) that reimplements the in-scope feature set of the existing TypeScript `xci` CLI (`packages/xci/`). This is a fresh, parallel implementation: NOTHING in `packages/xci/` is deleted or modified.

Purpose: Provide a single-binary, dependency-light Go port of `xci` covering config loading, command resolution, placeholder interpolation, single/sequential/parallel execution, `--list`, `--dry-run`, `--verbose`, CLI param overrides, and `init`.
Output: A compilable Go module under `go-xci/` with cobra-based CLI and unit tests for the pure-logic packages (config, commands, resolver, discovery).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<reference_implementation>
The Go port must replicate the observable behavior of these TypeScript source files. Read them for exact semantics; do NOT modify them.

- packages/xci/src/config/index.ts — 4-layer loader: machine dir resolution (XCI_MACHINE_CONFIGS env or ~/.xci/ fallback), project-aware subdir (`project:` key loads $machineDir/<project>/), flattenToStrings (nested -> dot keys, arrays -> JSON string, non-string leaf -> error), mergeLayers (last-wins, provenance, secretKeys = keys whose FINAL provenance is "secrets"), interpolateValues (self-referential ${KEY} with cycle detection, $${KEY} -> literal ${KEY}). Layer order: machine config, project, machine secrets, project secrets, local.
- packages/xci/src/commands/normalize.ts — raw YAML -> typed CommandDef. IN SCOPE: bare string (tokenize), array (pre-split argv), object with `cmd` (single, + platform overrides linux/windows/macos blocks each having `cmd`), object with `steps` (sequential), object with `parallel` + optional `failMode`. OUT OF SCOPE: ini, for_each, capture, params/modifiers — DO NOT port these.
- packages/xci/src/commands/tokenize.ts — whitespace split with double-quote preservation; unclosed quote = error.
- packages/xci/src/resolver/interpolate.ts — ${VAR} expansion. IN SCOPE: strict mode (undefined -> error), lenient mode (undefined -> leave ${VAR}), $${VAR} escape -> literal ${VAR}, multiple placeholders per token resolve inline, token stays one argv element. OUT OF SCOPE: JSON-path resolution, |map:/|join: modifiers — DO NOT port.
- packages/xci/src/resolver/index.ts — alias -> ExecutionPlan. IN SCOPE: single (selectPlatformCmd by OS, strict interpolate), sequential (steps: KEY=VALUE set-step OR alias-ref expand inline OR inline tokenized command; depth cap 10), parallel (group entries: alias-ref must resolve to single, OR inline command; failMode default 'fast'). OUT OF SCOPE: for_each, ini, capture handling.
- packages/xci/src/executor/single.ts, sequential.ts, parallel.ts — child spawn (shell:false equivalent), stream stdout/stderr live, propagate exit code; sequential stops on first non-zero; parallel fast=cancel-remaining-on-first-failure, complete=wait-all-return-first-nonzero.
- packages/xci/src/init/index.ts + templates.ts — scaffold .xci/ (commands.yml, config.yml templates), add .xci/secrets.yml + .xci/local.yml to .gitignore (create if absent), idempotent (skip existing).
</reference_implementation>

<go_mappings>
- TypeScript Map<string, CommandDef> -> Go map[string]CommandDef (iteration order: collect keys + sort for deterministic --list output).
- execa(cmd, args, {cwd, env, stdout/stderr stream}) -> os/exec.Cmd with Stdout/Stderr = os.Stdout/os.Stderr (live streaming), Dir = cwd, Env = merged. Exit code via exec.ExitError.ExitCode().
- AbortController for parallel fast-fail -> context.WithCancel; cancel on first failure; cmd started with exec.CommandContext.
- Platform detection: runtime.GOOS — "windows", "linux", "darwin" (map "darwin" -> macos block).
- selectPlatformCmd: if platform block exists for current GOOS and has cmd, use it; else use default cmd.
- YAML parsing: gopkg.in/yaml.v3 into map[string]interface{} then flatten. yaml.v3 parses unquoted yes/no/on as bool in YAML 1.1 — treat bool/number leaves as ERROR (matching D-04), so this footgun surfaces as a clear error not silent coercion.
- KEY=VALUE override regex: ^[A-Za-z_][A-Za-z0-9_.]*=  (uppercase-or-any-letter-start, dots allowed).
</go_mappings>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Module scaffold + config layer (types, loader, discovery)</name>
  <files>go-xci/go.mod, go-xci/internal/config/types.go, go-xci/internal/config/loader.go, go-xci/internal/config/loader_test.go, go-xci/internal/discovery/finder.go, go-xci/internal/discovery/finder_test.go</files>
  <action>
Initialize the Go module and implement config loading + discovery.

1. `cd go-xci && go mod init github.com/andrearuggeri/go-xci` (module path; adjust owner segment if a different one is obvious from git remote — otherwise use this). Add deps: `go get github.com/spf13/cobra@latest` and `go get gopkg.in/yaml.v3@latest`.

2. `internal/config/types.go`:
   - `type ConfigLayer string` with consts `LayerMachine="machine"`, `LayerProject="project"`, `LayerSecrets="secrets"`, `LayerLocal="local"`.
   - `type ResolvedConfig struct { Values map[string]string; Provenance map[string]ConfigLayer; SecretKeys map[string]bool }`.

3. `internal/discovery/finder.go`:
   - `func FindXciRoot(start string) (string, bool)` — walk up from `start`, returning the directory that contains a `.xci/` directory (return that dir, true). Stop at filesystem root; return ("", false) if none found. Use filepath.Dir loop with a break when Dir(p)==p.

4. `internal/config/loader.go` — port packages/xci/src/config/index.ts (IN-SCOPE subset):
   - `flattenToStrings(obj map[string]interface{}, filePath, prefix string) (map[string]string, error)`: nested map -> dot keys; []interface{} -> JSON-marshal to string; string leaf -> keep; any other leaf (bool/int/float/nil) -> error "filePath: <key>: expected string, got <type>". Detect dot-key collisions -> error.
   - `readLayer(filePath string, layer ConfigLayer) (map[string]string, bool, error)`: missing file -> (nil,false,nil); empty/null doc -> (empty map,true,nil); non-mapping root -> error; else flatten. Wrap YAML parse errors with filename.
   - `resolveMachineConfigDir() (dir string, source string, err error)`: XCI_MACHINE_CONFIGS set+non-empty -> must be a dir (else error); else ~/.xci/ if dir; else ("","none",nil).
   - `Load(cwd string) (ResolvedConfig, error)`: read project `.xci/config.yml` first to extract `project` key; resolve machine dir; build layer slice in order [machine config(s), project, machine secrets, project secrets+`.xci/secrets/` recursive *.yml, local]; merge last-wins tracking provenance; SecretKeys = keys whose final provenance == secrets; then self-interpolate values (`interpolateValues`). Inject builtins `xci.project.path` and `XCI_PROJECT_PATH` = cwd before interpolation.
   - `interpolateValues(values map[string]string) (map[string]string, error)`: recursive resolve with cycle detection; regex `\$\$\{[^}]+\}|\$\{([^}]+)\}`; `$${k}` -> literal `${k}` (strip one `$`); unknown ref -> leave match as-is. Port the recursive resolve() with a `resolving` set and `resolved` cache.
   - Note: machine secrets dir recursion + project secrets dir recursion: list *.yml/*.yaml recursively, sorted by full path.

5. `internal/config/loader_test.go` — table tests covering: flatten nested -> dot keys; array -> JSON string; non-string leaf -> error; last-wins merge across layers; SecretKeys final-provenance (key in secrets then overridden by local is NOT secret); self-interpolation `a: "${b}"` resolves; `$${b}` -> literal `${b}`; cycle -> error. Use t.TempDir() to write .xci/*.yml fixtures and call Load.
  </action>
  <verify>
    <automated>cd go-xci && go build ./internal/... && go test ./internal/config/... ./internal/discovery/...</automated>
  </verify>
  <done>go-xci/go.mod exists with cobra + yaml.v3; config + discovery packages build; config/discovery tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: Commands loader + interpolation + resolver</name>
  <files>go-xci/internal/commands/types.go, go-xci/internal/commands/loader.go, go-xci/internal/commands/loader_test.go, go-xci/internal/resolver/interpolate.go, go-xci/internal/resolver/interpolate_test.go, go-xci/internal/resolver/resolver.go, go-xci/internal/resolver/resolver_test.go</files>
  <action>
Port commands normalization, interpolation, and the resolver (IN-SCOPE subset only).

1. `internal/commands/types.go`:
   - `type Kind string` consts `KindSingle`, `KindSequential`, `KindParallel`.
   - `type CommandDef struct { Kind Kind; Cmd []string; Platforms map[string][]string; Steps []string; Group []string; FailMode string; Description string }` (FailMode "" | "fast" | "complete"; Platforms keyed by "linux"/"windows"/"macos").
   - `type CommandMap map[string]CommandDef`.

2. `internal/commands/loader.go` — port tokenize + normalize (IN-SCOPE):
   - `Tokenize(input, aliasName string) ([]string, error)`: whitespace split, double-quote preservation (strip quotes), unclosed quote -> error. Port tokenize.ts exactly.
   - `normalizeAlias(name string, raw interface{}) (CommandDef, error)`: bare string -> {Single, Tokenize}; []interface{} (all strings) -> {Single, argv}; map -> normalizeObject. Anything else -> error.
   - `normalizeObject`: if has `steps` (string array) -> Sequential. Else if has `parallel` (string array) -> Parallel + optional `failMode` (validate fast|complete). Else -> Single: read `cmd` (string -> tokenize, []string -> validate, absent+no platforms -> error "must have cmd, steps, or parallel", absent+platforms -> empty cmd); read platform blocks linux/windows/macos (each object with `cmd` string-or-array). `description` optional string. DO NOT handle ini/for_each/capture/params.
   - `LoadCommands(path string) (CommandMap, error)`: read+parse YAML mapping; normalize each entry. Missing file -> error (commands.yml required when running an alias).

3. `internal/resolver/interpolate.go` — port interpolate.ts (IN-SCOPE: no JSON-path, no modifiers):
   - `InterpolateArgv(argv []string, aliasName string, values map[string]string) ([]string, error)` (strict): each token, replace `${KEY}` with values[KEY] (error if missing), `$${KEY}` -> literal `${KEY}`. Token stays one element. Multiple placeholders per token supported. Use a sentinel for `$${}` then a single-pass replace of `${...}` (no nesting needed since modifiers are out of scope — a single replace pass suffices).
   - `InterpolateArgvLenient(argv []string, values map[string]string) []string`: same but unknown -> leave `${KEY}` untouched, never errors.
   - Implement both atop a shared `interpolateToken(token, values, strict)` helper. Regex for keyed placeholder: `\$\{([^}]+)\}`; handle `$${` escape first by replacing with sentinel `\x00ESC\x00{...}` then restoring to `${...}` at the end.

4. `internal/resolver/resolver.go`:
   - `selectPlatformCmd(def CommandDef) []string`: map runtime.GOOS ("darwin"->"macos") to platform key; if def.Platforms[key] present and non-empty use it, else def.Cmd.
   - `type Plan struct { Kind Kind; Argv []string; Steps []Step; Group []GroupEntry; FailMode string }`; `type Step struct { Argv []string; SetVars map[string]string; Label string }`; `type GroupEntry struct { Alias string; Argv []string }`.
   - `Resolve(alias string, cmds CommandMap, cfg ResolvedConfig) (Plan, error)` via recursive `resolveAlias(alias, cmds, cfg, depth, chain)`:
     - depth>10 -> error.
     - unknown alias -> error.
     - single: selectPlatformCmd then strict InterpolateArgv -> {KindSingle, Argv}.
     - sequential: for each step — KEY=VALUE (regex `^[A-Za-z_][A-Za-z0-9_.]*=`) -> SetVars step; else if cmds has step -> recurse resolveAlias and inline its single Argv as a Step (or flatten its sub-steps if it was sequential); else tokenize+lenient-interpolate -> command Step. Return {KindSequential, Steps}.
     - parallel: for each group entry — if cmds has entry, recurse; entry must resolve to single (else error), append GroupEntry{alias, argv}; else tokenize+strict-interpolate inline. FailMode default "fast". Return {KindParallel, Group, FailMode}.

5. Tests:
   - `commands/loader_test.go`: tokenize quotes/unclosed; bare string/array/single-cmd/steps/parallel+failMode normalization; missing cmd error; platform block parse.
   - `interpolate_test.go`: strict resolve, strict missing -> error, lenient leaves unknown, `$${X}` -> literal `${X}`, multiple per token, token-not-resplit (value with space stays one element).
   - `resolver_test.go`: single with platform override; sequential with alias-ref inline expansion + KEY=VALUE set step; parallel default failMode; depth cap; unknown alias error.
  </action>
  <verify>
    <automated>cd go-xci && go build ./internal/... && go test ./internal/commands/... ./internal/resolver/...</automated>
  </verify>
  <done>commands + resolver + interpolate packages build and tests pass; out-of-scope features (ini/for_each/capture/modifiers/JSON-path) are NOT implemented.</done>
</task>

<task type="auto">
  <name>Task 3: Executor (single/sequential/parallel)</name>
  <files>go-xci/internal/executor/types.go, go-xci/internal/executor/executor.go, go-xci/internal/executor/single.go, go-xci/internal/executor/sequential.go, go-xci/internal/executor/parallel.go</files>
  <action>
Implement execution using os/exec with live output streaming and correct exit-code propagation.

1. `internal/executor/types.go`:
   - `type Options struct { Cwd string; Env []string; ShowOutput bool }` (Env is the full merged environment slice for the child; ShowOutput controls whether child stdout/stderr stream to terminal — true normally).
   - Re-use resolver.Plan/Step/GroupEntry (import resolver package) OR define a local minimal interface. Prefer importing resolver types to avoid duplication.

2. `internal/executor/single.go`:
   - `func runSingle(argv []string, cwd string, env []string, show bool) (int, error)`: empty argv -> error. `exec.Command(argv[0], argv[1:]...)`; set Dir=cwd (if non-empty), Env=env; if show set Stdout=os.Stdout, Stderr=os.Stderr else discard. Run; on *exec.ExitError return ExitCode(); on start failure (binary not found) return non-zero + wrapped error; success -> 0.

3. `internal/executor/sequential.go`:
   - `func runSequential(steps []resolver.Step, opts Options) (int, error)`: maintain a setVars map merged into env for subsequent steps (SetVars step: add KEY=VALUE to a local env overlay, also re-interpolate later steps' argv against setVars using resolver.InterpolateArgvLenient so deferred `${VAR}` from set-steps resolve). For each command step: print a step header line to stderr (label/argv + effective cwd), run via runSingle; stop at first non-zero exit and return that code.

4. `internal/executor/parallel.go`:
   - `func runParallel(group []resolver.GroupEntry, failMode string, opts Options) (int, error)`: context.WithCancel; for each entry launch a goroutine with exec.CommandContext(ctx,...), prefix each output line with `[alias] ` (wrap stdout/stderr through a line-prefixing writer). Collect exit codes via channel/WaitGroup. failMode "fast": on first non-zero exit call cancel() to kill the rest (canceled children count as not-the-final-failure). failMode "complete": wait for all, return first non-zero. Print a summary of per-alias results to stderr.

5. `internal/executor/executor.go`:
   - `func Run(plan resolver.Plan, opts Options) (int, error)`: switch plan.Kind -> runSingle(plan.Argv,...) / runSequential(plan.Steps,...) / runParallel(plan.Group, plan.FailMode,...).

Keep it cross-platform: do NOT shell out; pass argv directly to exec.Command (Windows resolves PATHEXT for .exe/.cmd via exec.LookPath automatically when given a bare name). No taskkill needed — context cancellation + Cmd.Process handles termination.
  </action>
  <verify>
    <automated>cd go-xci && go build ./internal/executor/...</automated>
  </verify>
  <done>executor package builds; Run dispatches single/sequential/parallel; exit codes propagate; parallel fast-fail cancels remaining via context.</done>
</task>

<task type="auto">
  <name>Task 4: CLI wiring (cobra root, --list, run, dry-run, verbose, overrides, init) + main</name>
  <files>go-xci/main.go, go-xci/cmd/root.go, go-xci/cmd/run.go, go-xci/cmd/init.go</files>
  <action>
Wire everything into a cobra CLI matching the TypeScript observable behavior.

1. `cmd/init.go`:
   - `func newInitCmd() *cobra.Command` — `xci init`: scaffold `.xci/` in cwd. mkdir .xci (recursive, idempotent). writeIfAbsent `.xci/commands.yml` (template with a single, a sequential, and a parallel example), `.xci/config.yml` (template with example params). ensureGitignore: create/append `.xci/secrets.yml` and `.xci/local.yml` under a `# xci` header (skip entries already present). Print created/skipped summary. Templates can be inline const strings — keep them small and valid YAML.

2. `cmd/run.go`:
   - `func runAlias(alias string, cliArgs []string, dryRun, verbose bool) (int, error)`:
     - FindXciRoot(cwd). If not found -> error to stderr, exit 1.
     - config.Load(root); commands.LoadCommands(root/.xci/commands.yml).
     - Parse `cliArgs` for KEY=VALUE overrides (regex `^[A-Za-z_][A-Za-z0-9_.]*=`): split into overrides map + passthrough args (args after `--` are passthrough appended to final command argv). Apply overrides on top of config.Values (override wins all layers) BEFORE resolve.
     - resolver.Resolve(alias, commands, mergedConfig).
     - If dryRun: print `[DRY RUN]`, then `Config values:` with each key=value (redact value to `<redacted>` if SecretKeys[key]); then `Execution Plan:` (cmd: joined argv, cwd). Do NOT execute. Return 0.
     - Else: build child env = os.Environ() + overrides as KEY=VALUE (and config values? — match TS: only env vars passed are config-derived env via buildEnvVars; for the port, inject resolved config values as env vars too so `${VAR}` already baked into argv and env both available). Set Options.ShowOutput=true (verbose just additionally prints config values header first). executor.Run -> exit code.

3. `cmd/root.go`:
   - `func NewRootCmd() *cobra.Command` named `xci`. Register the `init` subcommand. Add persistent/local flags `--list`, `--dry-run`, `--verbose`.
   - Default behavior: if no alias arg OR `--list` -> print list: header `xci — Local CI command runner`, blank, `Project aliases:`, then each alias (sorted) formatted `  <name padded to ~14>  <description> (<type>)` where type = single|sequential|parallel; footer line. Load commands from discovered root (if no .xci found, print a friendly message + exit 0 for bare invocation; init must still work without .xci).
   - If an alias arg is present: call runAlias with remaining args, then os.Exit(code). Use cobra's `Args: cobra.ArbitraryArgs` + `DisableFlagParsing` or `FParseErrWhitelist`/`TraverseChildren` so KEY=VALUE and `--` passthrough reach runAlias intact. Simplest robust approach: set `args := os.Args[1:]`, manually detect `init`, `--list`, then treat first non-flag token as alias and the rest as cliArgs.

4. `main.go`: `package main`; `func main() { os.Exit(cmd.Execute()) }` where `cmd.Execute()` builds the root command, runs it, and returns the resolved exit code (so child exit codes propagate as the process exit code).

Ensure the binary is named xci via go build output, but the source can live anywhere — `go build -o xci ./...` from go-xci/.
  </action>
  <verify>
    <automated>cd go-xci && go build ./... && go vet ./...</automated>
  </verify>
  <done>go build ./... succeeds for the whole module; `xci init` scaffolds .xci/; `xci --list` lists aliases with type; `xci <alias> --dry-run` prints redacted config + plan; `xci <alias>` executes and propagates exit code. packages/xci/ untouched.</done>
</task>

</tasks>

<verification>
- `cd go-xci && go build ./...` exits 0.
- `cd go-xci && go vet ./...` exits 0.
- `cd go-xci && go test ./...` passes (config, discovery, commands, resolver unit tests).
- Manual smoke (optional): in a temp dir, `go run . init`, then `go run . --list`, then `go run . <alias> --dry-run`.
- `git status` shows packages/xci/ unchanged (only new files under go-xci/).
</verification>

<success_criteria>
- New Go module compiles cleanly under go-xci/ with only cobra + yaml.v3 external deps.
- 4-layer config loading, flattening, merge, and self-interpolation match TS behavior for the in-scope subset.
- ${VAR} strict/lenient interpolation with $${} escape works; tokens are not re-split.
- single/sequential/parallel execution dispatch with correct exit-code propagation and parallel failMode fast/complete.
- --list, --dry-run (with secret redaction), --verbose, KEY=VALUE overrides, and init all functional.
- Out-of-scope features (--agent, TUI, for_each, ini, capture, modifiers, JSON-path, completion, template, perforce) are NOT implemented.
- Nothing in packages/xci/ is deleted or modified.
</success_criteria>

<output>
After completion, create `.planning/quick/260531-sgb-crea-progetto-go-cli-go-xci-nella-cartel/260531-sgb-SUMMARY.md`
</output>
