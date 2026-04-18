# xci

Local CI — cross-platform command alias runner with layered YAML config

## What is xci?

`xci` is a cross-platform command alias runner for Node.js. You define command aliases once in versioned YAML files, then invoke them by name from the terminal on any OS — Windows, Linux, or macOS. `xci` resolves parameters from a layered configuration hierarchy and spawns each command directly (no shell intermediary), so aliases behave identically on every machine.

**One alias = always the correct command executed**, on any operating system, with the right parameters for that project and that machine, without ever exposing tokens or passwords in version control.

## Install

```bash
npm i -g xci
```

Requires Node.js >= 20.5.0. Works on Windows, Linux, and macOS.

## Quickstart

```bash
cd your-project
xci init
xci hello
# => hello from xci
```

`xci init` scaffolds a `.xci/` directory with example config files. Edit `.xci/commands.yml` to define your own aliases.

## Project Structure

```
your-project/
  .xci/
    config.yml              # Project-level parameters (committed)
    commands.yml            # Command aliases (committed)
    commands/               # Additional command files (committed, recursive)
      deploy.yml
      ci/
        release.yml
    secrets.yml             # Tokens, API keys (gitignored)
    secrets/                # Additional secret files (gitignored, recursive)
      aws.yml
      cloud/
        gcp.yml
    secrets.yml.example     # Template for secrets (committed)
    local.yml               # Per-machine overrides (gitignored)
    local.yml.example       # Template for local (committed)
    log/                    # Command execution logs (gitignored)
    template/               # Generated templates (see xci template)
```

## Configuration

### Project Name

Set `project` in `.xci/config.yml` to identify this project. Used by `xci template` and for project-specific machine configs.

```yaml
# .xci/config.yml
project: my-app
registry: https://my-registry.com
```

### Config Layers

`xci` merges config from multiple layers. Later layers override earlier ones (last value wins per key).

| Layer | Source | Purpose | Committed? |
|-------|--------|---------|------------|
| project | `.xci/config.yml` | Project-level defaults, shared with the team | Yes |
| machine secrets | `$XCI_MACHINE_CONFIGS/secrets.yml` + `secrets/` | Shared secrets across projects | No |
| machine secrets (project) | `$XCI_MACHINE_CONFIGS/<project>/secrets.yml` + `secrets/` | Project-specific machine secrets | No |
| project secrets | `.xci/secrets.yml` + `.xci/secrets/` | Project secrets | No |
| local | `.xci/local.yml` | Per-machine overrides (your dev environment) | No |
| builtins | (automatic) | `xci.project.path` / `XCI_PROJECT_PATH` | -- |
| CLI | `KEY=VALUE` args | Highest precedence overrides | -- |

**Precedence:** project < machine secrets < project secrets < local < builtins < CLI overrides

### Machine Configs Directory

Set `XCI_MACHINE_CONFIGS` to a directory that mirrors the `.xci/` structure. It holds commands and secrets shared across projects on this machine.

```bash
export XCI_MACHINE_CONFIGS=~/.config/xci
```

```
~/.config/xci/
  config.yml                # Shared config (all projects)
  commands.yml              # Shared commands (all projects)
  commands/                 # Shared command files (recursive)
  secrets.yml               # Shared secrets (all projects)
  secrets/                  # Shared secret files (recursive)
  my-app/                   # Project-specific (matches config.yml → project)
    config.yml
    commands.yml
    commands/
    secrets.yml
    secrets/
  other-project/
    config.yml
    commands.yml
    secrets.yml
```

When `project: my-app` is set in `.xci/config.yml`, xci loads:
- **Root**: shared config, commands, and secrets from `$XCI_MACHINE_CONFIGS/`
- **Project**: project-specific files from `$XCI_MACHINE_CONFIGS/my-app/`
- **Local**: `.xci/` in the project directory (highest priority)

Priority for config: machine root < machine project < project `.xci/config.yml`.
Priority for commands: machine root < machine project < project `.xci/` (duplicates silently overridden).
Priority for secrets: machine root < machine project < project `.xci/secrets` < `local.yml`.

### Variable Interpolation in Config

Config values can reference other config values using `${key}` syntax:

```yaml
# .xci/config.yml
host: myserver.com
port: "443"
url: "${host}:${port}"              # => myserver.com:443
api: "${url}/api/v1"                # => myserver.com:443/api/v1 (transitive)
output_dir: "${XCI_PROJECT_PATH}/dist"
```

- Transitive references work: `a` -> `b` -> `c`
- Cross-layer: `local.yml` can reference keys from `config.yml`
- Escape with `$${}`: `$${not_expanded}` produces the literal `${not_expanded}`
- Circular references are detected and reported as errors

### Built-in Variables

Always available, no need to declare:

| Variable | Dot notation | Value |
|----------|-------------|-------|
| `XCI_PROJECT_PATH` | `xci.project.path` | Absolute path to the directory containing `.xci/` |

Both forms work in `commands.yml`: `${XCI_PROJECT_PATH}` or `${xci.project.path}`.

All config values are also injected as environment variables into child processes using UPPER_UNDERSCORE format (e.g. `deploy.host` -> `DEPLOY_HOST`).

## Defining Commands

Commands are defined in `.xci/commands.yml` and optionally in `.xci/commands/` (any `.yml`/`.yaml` file, loaded recursively from subdirectories).

### Single Command

```yaml
build:
  description: Compile TypeScript
  cmd: ["npx", "tsc", "--noEmit"]
```

String shorthand (auto-tokenized):

```yaml
test: "npx vitest run"
```

Array shorthand:

```yaml
lint:
  - npx
  - biome
  - check
  - .
```

### Sequential Steps

Runs commands in series. Stops at first failure. Shows step counter and duration.

```yaml
ci:
  description: Full CI pipeline
  steps:
    - lint
    - test
    - build
```

Output:
```
▶ npx [1/3]
✓ npx OK 1.2s
▶ npx [2/3]
✓ npx OK 3.4s
▶ npx [3/3]
✗ npx FAILED (exit 1) 520ms
```

Steps can be alias references or inline commands:

```yaml
prepare:
  steps:
    - "rm -rf dist"
    - "npm ci"
    - build
```

### Parallel Group

Runs commands concurrently. Default `failMode: fast` kills remaining on first failure.

```yaml
check-all:
  description: Run lint and tests in parallel
  parallel:
    - lint
    - test
  failMode: fast     # or "complete" to let all finish
```

### For-Each Loop

Iterate over an array of values, running a command for each — sequentially or in parallel.

```yaml
# Inline command, parallel execution
deploy-all:
  description: Deploy to all regions
  for_each:
    var: region
    in: ["us-east-1", "eu-west-1", "ap-southeast-1"]
    mode: parallel
    failMode: fast
    cmd: ["aws", "deploy", "--region", "${region}"]

# Reference another alias, sequential execution
build-all:
  for_each:
    var: platform
    in: ["linux", "windows", "macos"]
    mode: steps         # default
    run: build-single

build-single:
  cmd: ["npm", "run", "build:${platform}"]
```

### Split Commands Across Files

Put YAML files in `.xci/commands/` to organize aliases by area. Subdirectories are scanned recursively.

```
.xci/
  commands.yml           # main aliases
  commands/
    deploy/
      staging.yml        # deploy-staging alias
      production.yml     # deploy-prod alias
    ci/
      release.yml        # release alias
```

Duplicate alias names across files in the same scope cause an error.

### Platform-Specific Commands

```yaml
open-docs:
  description: Open docs in browser
  cmd: ["echo", "Unsupported platform"]
  linux:
    cmd: ["xdg-open", "docs/index.html"]
  macos:
    cmd: ["open", "docs/index.html"]
  windows:
    cmd: ["cmd", "/c", "start", "docs\\index.html"]
```

## CLI Parameters (KEY=VALUE)

Pass parameters from the command line that override all config layers:

```bash
xci deploy registry=http://localhost stage=prod
```

These are available as `${registry}` and `${stage}` in the command, and as `REGISTRY` / `STAGE` env vars in the child process. No need to declare them in config files — though you can set defaults there:

```yaml
# .xci/config.yml
registry: https://production-registry.com    # default

# .xci/commands.yml
deploy:
  cmd: ["docker", "push", "${registry}/myapp"]
```

```bash
xci deploy                                # uses production registry
xci deploy registry=http://localhost      # uses localhost
```

## Capture: Command Output as Variables

Use `capture` on a single command to save its stdout into a variable for subsequent steps.

### Simple Form

```yaml
get-version:
  cmd: ["node", "-e", "process.stdout.write('1.2.3')"]
  capture: version

release:
  steps:
    - get-version
    - do-release

do-release:
  cmd: ["echo", "Releasing version ${version}"]
```

Captured variables are resolved at runtime, so subsequent steps in a pipeline can reference values from earlier steps.

### Extended Form with Validation

```yaml
get-build-id:
  cmd: ["aws", "gamelift", "describe-build", "--query", "Build.BuildId", "--output", "text"]
  capture:
    var: build_id
    type: string          # string (default) | int | float | json
    assert: "not empty"   # validation assertion

get-count:
  cmd: ["wc", "-l", "output.txt"]
  capture:
    var: line_count
    type: int
    assert:               # multiple assertions (all must pass)
      - ">= 0"
      - "<= 10000"
```

### Type Validation

| Type | Accepts | Rejects |
|------|---------|---------|
| `string` | any value (default) | -- |
| `int` | `42`, `-1`, `0` | `3.14`, `abc`, empty |
| `float` | `3.14`, `42`, `-1.5` | `abc`, empty |
| `json` | `{"key": "val"}`, `[1,2]`, `"str"` | invalid JSON, empty |

### Assert Operators

| Assertion | Types | Example |
|-----------|-------|---------|
| `not empty` | all | `assert: "not empty"` |
| `not null` | all | `assert: "not null"` |
| `empty` | all | `assert: "empty"` |
| `== value` | all | `assert: "== ok"` |
| `!= value` | all | `assert: "!= error"` |
| `> N` | int, float | `assert: "> 0"` |
| `< N` | int, float | `assert: "< 100"` |
| `>= N` | int, float | `assert: ">= 1"` |
| `<= N` | int, float | `assert: "<= 50"` |
| `matches /regex/` | all | `assert: "matches /^v\\d+/"` |
| `valid json` | all | `assert: "valid json"` |
| `valid json or empty` | all | `assert: "valid json or empty"` |

Capture result is displayed as a formatted block:

```
▶ aws [1/2]
abc123
  ┌─ capture: build_id ─────────────────
  │ value: abc123
  │ PASS
  └──────────────────────────────────
✓ aws OK 1.2s
```

With `--verbose`, type and assert details are also shown:

```
  ┌─ capture: build_id ─────────────────
  │ value: abc123
  │ type:  int
  │ assert: > 0
  │ PASS
  └──────────────────────────────────
```

If validation fails, the step fails with exit code 1:

```
  ┌─ capture: count ─────────────────
  │ value: not-a-number
  │ FAIL: expected int, got "not-a-number"
  └──────────────────────────────────
```

### JSON Path Access

Captured JSON values can be navigated using bracket and dot notation:

```yaml
get-builds:
  cmd: ["aws", "gamelift", "list-builds", "--output", "json"]
  capture:
    var: builds
    type: json

deploy:
  steps:
    - get-builds
    - do-deploy

do-deploy:
  cmd: ["echo", "Build ID: ${builds[0].BuildId}"]
```

Supported syntax: `${var[0].field}`, `${var.nested.key}`, `${var[0][1].deep}`.

## Secrets

Secrets can be defined in `.xci/secrets.yml` and/or in `.xci/secrets/` (recursive directory, any `.yml`/`.yaml` file).

```yaml
# .xci/secrets.yml
api_token: ghp_xxxxxxxxxxxxxxxx

# .xci/secrets/aws.yml
aws:
  access_key: AKIA...
  secret_key: wJalr...
```

- All secret files are gitignored by `xci init` and must never be committed
- Values from secrets are redacted (`***`) in `--dry-run` and `--verbose` output
- If `secrets.yml` is accidentally git-tracked, `xci` warns on every run
- xci never logs secret values

## Logging

By default, command output is **hidden** — only step headers, command preview, and results are shown. Output is always saved to `.xci/log/`.

```bash
xci build              # output hidden, saved to log file
xci build --log        # full output shown in terminal + saved to log
xci build --short-log 10  # last 10 lines shown in real-time (rolling tail)
xci build --verbose    # config trace + output shown + saved to log
```

### Short Log (Real-time Tail)

`--short-log N` shows the last N lines of output in real-time, updated as the command runs. Lines scroll like `tail -f` with a fixed window. Colors from the command output are preserved.

```
▶ RunUAT.bat
  run: e:/git/UE/Engine/Build/BatchFiles/RunUAT.bat ...
  | [5/127] Compile Module.Engine.cpp
  | [6/127] Compile Module.Renderer.cpp
  | [7/127] Compile Module.Audio.cpp
✓ RunUAT.bat OK 45.3s
```

### Error Prompt

On error, xci prompts to show the full log (in TTY mode):

```
✗ npm FAILED (exit 1) 3.2s

Log saved to: .xci/log/build-2026-04-16T09-30-00.log
Show log? [y/N]
```

## Template

Generate a shareable template of your project's `.xci/` directory with secret values stripped, system config included, and missing variables identified:

```bash
xci template
```

```
xci template → .xci/template/my-app/

  Project files:
    copied    config.yml
    copied    commands.yml
    copied    commands/deploy.yml
    stripped  secrets.yml
    stripped  secrets/aws.yml

  System files (from $XCI_MACHINE_CONFIGS):
    copied    sys/commands.yml
    stripped  sys/secrets.yml
    copied    sys/my-app/commands.yml
    stripped  sys/my-app/secrets.yml

  Missing variables (written to missing.yml):
    ANDROID.PACKAGE_NAME
    StoreVersion
    UE.ENGINE.PATH
```

The template includes:

- **Project files**: copied from `.xci/`, secrets values replaced with `""`
- **System files**: copied from `$XCI_MACHINE_CONFIGS/` and `$XCI_MACHINE_CONFIGS/<project>/` into `sys/`, secrets stripped
- **`missing.yml`**: variables used in commands but not defined anywhere, with file:line comments showing where each is used

```yaml
# missing.yml (generated)
# Variables used in commands but not defined in any config file.
# Fill these in or add them to config.yml / secrets.yml as needed.

# used in commands.yml:15
# used in commands/deploy.yml:8
ANDROID:
  PACKAGE_NAME: ""

# used in commands.yml:22
StoreVersion: ""
```

Previous template output is automatically deleted before regenerating.

## Interactive TUI (--ui)

Use `--ui` to run commands with an interactive dashboard.

### Alias Picker

```bash
xci --ui
```

Shows an interactive list of aliases. Navigate with arrow keys, Enter to select, `q` to quit.

### Execution Dashboard

```bash
xci build --ui
```

Shows a split-panel dashboard:
- **Left panel:** command status (pending, running, success, failed, skipped)
- **Right panel:** scrollable command output log

Keybindings after execution:

| Key | Action |
|-----|--------|
| `r` | Rerun the same command |
| `n` | Pick a new alias to run |
| `Up/Down` | Scroll log |
| `PgUp/PgDn` | Scroll log by page |
| `Ctrl+C` | Exit |

The dashboard stays open after execution so you can review the log and run more commands.

## CLI Reference

| Command | Description |
|---------|-------------|
| `xci` | List available aliases and commands |
| `xci --list` / `-l` | List aliases with descriptions |
| `xci <alias>` | Run an alias (output hidden, logged) |
| `xci <alias> --log` | Run with full output shown in terminal |
| `xci <alias> --short-log N` | Show last N lines of output in real-time |
| `xci <alias> --verbose` | Show config trace + raw/resolved commands + output |
| `xci <alias> KEY=VALUE` | Run with parameter overrides |
| `xci <alias> --dry-run` | Preview resolved command + variables without executing |
| `xci <alias> --ui` | Run with interactive TUI dashboard |
| `xci <alias> -- --extra` | Pass arguments through to child process |
| `xci <alias> --help` | Show help for a specific alias |
| `xci --ui` | Interactive alias picker |
| `xci init` | Scaffold `.xci/` directory |
| `xci template` | Generate shareable template with secrets stripped |
| `xci --version` / `-V` | Show version |
| `xci --help` / `-h` | Show help |

### Command Preview

Before each command or step, xci shows the resolved command:

```
▶ aws
  run: aws gamelift describe-build --name 252
✓ aws OK 1.2s
```

When placeholders were interpolated, both raw and resolved are shown:

```
▶ echo [2/2]
  raw: echo Deploying ${build_id}
  run: echo Deploying abc123
✓ echo OK 15ms
```

### Dry Run

```bash
xci deploy --dry-run
```

Shows the resolved command and all imported variables, with secrets masked:

```
[dry-run] single: aws deploy --region eu-west-1 --token **********

[dry-run] variables:
[dry-run]   api.token = **********
[dry-run]   deploy.region = eu-west-1
[dry-run]   project = my-app
[dry-run]   registry = https://my-registry.com
[dry-run]   xci.project.path = F:\MyProject
```

### Verbose

```bash
xci deploy --verbose buildname=prova
```

Shows config files loaded, env vars (secrets redacted), raw command (with `${placeholders}`), and resolved command (interpolated):

```
[verbose] project root: /path/to/project
[verbose] config: .xci/config.yml [loaded]
[verbose] config: .xci/secrets.yml [not found]
[verbose] env: BUILDNAME=prova
[verbose] raw cmd: aws deploy --name ${buildname}
[verbose] resolved: aws deploy --name prova
```

## Shell Behavior

`xci` runs every command with `shell: false`. This means:

- No pipes (`|`), redirects (`>`), or glob expansion (`*`) inside `cmd`
- Arguments are passed as an argv array — no quoting or escaping issues
- Identical behavior on Windows, Linux, and macOS

For shell constructs, wrap in a script:

```yaml
complex-build:
  cmd: ["bash", "./scripts/build.sh"]
  windows:
    cmd: ["powershell", "-File", "./scripts/build.ps1"]
```

## Error Reporting

YAML parse errors show the file, line number, and the offending line:

```
error [CFG_YAML_PARSE]: Invalid YAML in .xci/config.yml at line 12
  12 | UE5_RUNUAT: C:\Program Files\Epic Games\...
  cause: Implicit keys need to be on a single line
  suggestion: Check the file for unmatched quotes or indentation errors
```

For secrets files, the line content is hidden:

```
error [CFG_YAML_PARSE]: Invalid YAML in .xci/secrets.yml at line 3
  (line content hidden — secrets file)
```

## Process Termination

When you press `Ctrl+C`, xci kills the child process and waits for it to exit before returning:

```
[xci] Stopping child process...
[xci] Child process terminated.
```

On Windows, xci uses `taskkill /f /t` to kill the entire process tree (parent + all children). If the process doesn't exit within 5 seconds, it's force-killed. xci does not exit until the child process is confirmed dead.

## Exit Codes

| Range | Category |
|-------|----------|
| 0 | Success |
| 10 | Config error (YAML parse, read permission) |
| 20 | Command error (unknown alias, schema, circular ref) |
| 30 | Interpolation error (undefined placeholder) |
| 40 | Executor error (spawn failure) |
| 50 | CLI error (unknown flag) |

Child process exit codes are propagated as-is.

## Agent Mode (xci --agent)

Run `xci` as a daemon connected to an xci server, awaiting task dispatches over WebSocket.

### Quick Start

```bash
# First-run registration — requires one-time token from server admin
xci --agent wss://xci.example.com/ws/agent --token xci_reg_xxxxxxxx

# Subsequent runs — credential was persisted during registration
xci --agent wss://xci.example.com/ws/agent
```

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--agent <url>` | yes | Server WS URL (e.g. `wss://xci.example.com/ws/agent`). Token MUST NOT appear in the URL. |
| `--token <reg-token>` | first-run only | Registration token issued by an org Owner/Member. Single-use, 24h TTL. |
| `--label key=value` | no | Custom labels; repeatable. Merged with auto-detected `os`, `arch`, `node_version`, `hostname`. |
| `--hostname <name>` | no | Override auto-detected hostname (local label only; server-side hostname is set via UI/API). |
| `--config-dir <path>` | no | Override credential storage directory. |

### Credential Storage (per-machine, not per-project)

The agent persists its permanent credential at:

| OS | Default Path |
|----|--------------|
| Linux | `~/.config/xci/agent.json` (or `$XDG_CONFIG_HOME/xci/agent.json`) |
| macOS | `~/Library/Preferences/xci/agent.json` |
| Windows | `%APPDATA%\xci\Config\agent.json` |

File mode is `0600` on POSIX. NEVER commit this file — it grants full agent access.

### TOFU Rule

If `agent.json` exists AND `--token` is also passed, `xci` exits with an error to prevent overwriting a registered credential. To re-register, first delete `agent.json` (or revoke the agent server-side).

### Reconnection

On network loss, the agent reconnects with exponential backoff (1s initial jittered, 30s cap, 1.5x growth). No manual intervention required.

### Graceful Shutdown

`SIGINT` (Ctrl+C) or `SIGTERM`: agent sends `goodbye` frame, closes the socket cleanly, exits 0. Any in-flight tasks (Phase 10+) complete to natural end before exit.

### Terminal Exit Conditions

The agent exits non-zero and STOPS reconnecting when the server closes with:
- `4001` — credential revoked
- `4002` — registration token invalid or expired
- `4004` — superseded (another agent connected with the same ID)

Other close codes (`4003` heartbeat timeout, `4005` handshake timeout, `1001` server going away) trigger normal reconnect flow.

### Production Lifecycle Management

Agent mode is a daemon — it runs until terminated. For production deployments, manage the process with:
- **Linux**: systemd service unit
- **macOS**: launchd plist
- **Windows**: Windows Service (via `node-windows` or NSSM)

## License

MIT
