# xci

Local CI — cross-platform command alias runner with layered YAML config

[![CI](https://github.com/your-org/xci/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/xci/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/xci)](https://www.npmjs.com/package/xci)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## What is xci?

`xci` is a cross-platform command alias runner for Node.js. You define command aliases once in a versioned YAML file, then invoke them by name from the terminal on any OS — Windows, Linux, or macOS. `xci` resolves parameters from a four-layer configuration hierarchy and spawns each command directly (no shell intermediary), so aliases behave identically on every machine.

The core value: **one alias → always the correct command executed**, on any operating system, with the right parameters for that project and that machine, without ever exposing tokens or passwords in version control.

## Quickstart

Install `xci` globally:

```bash
npm i -g xci
```

Move to your project and scaffold the `.loci/` directory:

```bash
cd your-project
xci init
```

This creates `.loci/commands.yml` with a `hello` alias. Run it:

```bash
xci hello
```

You should see:

```
hello from xci
```

That's it. Edit `.loci/commands.yml` to define your own aliases.

## Configuration

`xci` merges up to four config layers in order. Later layers override earlier ones.

| Layer    | File                           | Purpose                                         | Committed? |
|----------|--------------------------------|-------------------------------------------------|------------|
| machine  | `$LOCI_MACHINE_CONFIG`         | Shared defaults across all projects on this machine | No        |
| project  | `.loci/config.yml`             | Project-level defaults, shared with the team    | Yes        |
| secrets  | `.loci/secrets.yml`            | Tokens, passwords, API keys                     | No         |
| local    | `.loci/local.yml`              | Per-machine overrides (your dev environment)    | No         |

**Precedence:** machine < project < secrets < local (last value wins per key)

All four files are optional. Missing files are silently skipped.

### Example config.yml

```yaml
# .loci/config.yml
registry: https://my-registry.example.com
app_name: my-app
environment: production
```

### Parameter interpolation

Values defined in config files are available as `${VAR}` placeholders in your commands:

```yaml
# .loci/commands.yml
deploy:
  description: Push image to registry
  cmd: ["docker", "push", "${registry}/${app_name}:latest"]
```

When `xci deploy` runs, `${registry}` and `${app_name}` are replaced with values from the merged config before the process is spawned. If a placeholder has no value in any config layer, `xci` exits with an error before running anything.

All config values are also injected as environment variables into child processes, so subcommands can read them via `process.env.REGISTRY` without explicit interpolation.

## Defining Commands

Commands are defined in `.loci/commands.yml`. Each top-level key is an alias name.

### Single command

Use `cmd` with an argv array. This is the most common form.

```yaml
# .loci/commands.yml
build:
  description: Compile TypeScript
  cmd: ["npx", "tsc", "--noEmit"]

lint:
  description: Run linter
  cmd: ["npx", "biome", "check", "."]
```

You can also write `cmd` as a string; `xci` tokenizes it into an argv array:

```yaml
test:
  cmd: "npx vitest run"
```

### Sequential steps

Use `steps` to run commands in series. The chain stops at the first non-zero exit code.

```yaml
ci:
  description: Full CI pipeline
  steps:
    - lint
    - test
    - build
```

Steps can reference other aliases defined in the same file (as `lint`, `test`, and `build` do above), or they can be inline commands:

```yaml
prepare:
  description: Clean and install
  steps:
    - "rm -rf dist"
    - "npm ci"
    - build
```

### Parallel group

Use `group` to run commands concurrently. If any command fails, the remaining ones are killed.

```yaml
check-all:
  description: Run lint and tests in parallel
  group:
    - lint
    - test
```

By default, `failMode` is `fast`: the first failure kills the rest. Set `failMode: all` to let all commands finish before reporting failures:

```yaml
check-all:
  description: Collect all failures before stopping
  group:
    - lint
    - test
  failMode: all
```

## Platform-Specific Commands

Use `linux:`, `windows:`, and `macos:` blocks to override the default `cmd` on specific operating systems. The default `cmd` is the fallback for any platform not listed.

```yaml
open-docs:
  description: Open project docs in browser
  cmd: ["echo", "Unsupported platform"]
  linux:
    - xdg-open
    - docs/index.html
  macos:
    - open
    - docs/index.html
  windows:
    - cmd
    - /c
    - start
    - docs\index.html
```

If no default `cmd` is provided and `xci` runs on a platform with no matching override, the command fails with a clear error.

## Shell Behavior

`xci` runs every command with `shell: false` by default. This means:

- Pipes (`|`), redirects (`>`), and shell expansions (`*`) are **not available** inside `cmd` entries.
- Arguments are passed directly to the process as an argv array — no shell quoting or escaping issues.
- Behavior is identical on Windows, Linux, and macOS.

This is intentional. Direct spawning is safer (no injection surface) and cross-platform reliable.

### Wrap complex logic in a script

When you need pipes, redirects, or shell-specific constructs, put the logic in a script file and call the script from `xci`:

```yaml
complex-build:
  description: Build with shell pipeline (uses script)
  cmd: ["bash", "./scripts/build.sh"]
  windows:
    - powershell
    - -File
    - ./scripts/build.ps1
```

Keep `xci` aliases thin. Let scripts handle shell complexity.

## Secrets

`.loci/secrets.yml` works like any other config layer but is treated specially:

- It is gitignored by `xci init` and must never be committed.
- Values sourced from `secrets.yml` are redacted (`***`) in `--dry-run` and `--verbose` output.
- If `secrets.yml` is accidentally tracked by git, `xci` prints a warning to stderr on every run:

  ```
  [xci] WARNING: .loci/secrets.yml is tracked by git. Run: git rm --cached .loci/secrets.yml
  ```

- xci never logs secret values, even in debug mode.

### Example secrets.yml

```yaml
# .loci/secrets.yml — gitignored, never committed
api_token: ghp_xxxxxxxxxxxxxxxx
deploy_key: super-secret-value
```

## CLI Reference

| Command                            | Description                                           |
|------------------------------------|-------------------------------------------------------|
| `xci`                              | List all available aliases (same as `--list`)         |
| `xci --list` / `xci -l`            | List all available aliases with their descriptions    |
| `xci <alias>`                      | Run an alias                                          |
| `xci <alias> --dry-run`            | Preview the resolved command without executing        |
| `xci <alias> --verbose`            | Show config trace (which files loaded, key provenance) and run |
| `xci <alias> -- --extra-args`      | Pass arguments through to the child process           |
| `xci <alias> --help`               | Show help for a specific alias                        |
| `xci init`                         | Scaffold `.loci/` directory in current project        |
| `xci --version` / `xci -V`         | Show installed version                                |
| `xci --help` / `xci -h`            | Show help                                             |

### Dry run example

```bash
xci deploy --dry-run
```

Output shows the fully resolved command with secrets redacted:

```
[dry-run] docker push https://my-registry.example.com/my-app:latest
  api_token: ***
```

### Verbose example

```bash
xci deploy --verbose
```

Prints which config files were loaded, which layer each key came from, then runs the command.

## License

MIT — see [LICENSE](LICENSE)
