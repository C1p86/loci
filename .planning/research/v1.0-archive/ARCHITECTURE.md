# Architecture Research

**Domain:** Cross-platform Node.js CLI command runner with layered config
**Researched:** 2026-04-10
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI Frontend Layer                         │
│   (commander.js, dynamic command registration, --dry-run, --list) │
└──────────────────────┬───────────────────────────────────────────┘
                       │  argv: string[]
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Orchestrator (main entry)                    │
│   Calls loaders in order, threads data through pipeline,          │
│   catches typed errors, sets process.exit code                    │
└──────┬───────────────┬──────────────────────┬────────────────────┘
       │               │                      │
       ▼               ▼                      ▼
┌────────────┐  ┌──────────────┐  ┌──────────────────────────────┐
│   Config   │  │   Commands   │  │         Resolver              │
│   Loader   │  │   Loader     │  │  (alias composition + cycle   │
│            │  │              │  │   detection + interpolation)  │
│ Reads 4    │  │ Reads        │  │                               │
│ YAML files │  │ commands.yml │  │ Input:  ResolvedConfig +      │
│ Merges     │  │ Validates    │  │         CommandDef             │
│ Returns    │  │ Returns      │  │ Output: concrete string[]     │
│ flat map   │  │ CommandMap   │  │         ready to execute      │
└────────────┘  └──────────────┘  └──────────────┬───────────────┘
                                                  │  ExecutionPlan
                                                  ▼
                              ┌────────────────────────────────────┐
                              │           Executor                  │
                              │                                     │
                              │  Runs single / sequential / parallel│
                              │  Streams stdout+stderr in real-time │
                              │  Returns exit code                  │
                              └────────────────────────────────────┘
```

### Component Responsibilities

| Component | Owns | Must NOT Know About |
|-----------|------|---------------------|
| **ConfigLoader** | Finding + reading 4 YAML files, merging with precedence, producing `ResolvedConfig` (flat `Record<string,string>`) | Command structure, interpolation, execution |
| **CommandsLoader** | Reading `.loci/commands.yml`, YAML parsing, validating the schema, building a typed `CommandMap` | Config values, interpolation, spawning |
| **Resolver** | Alias composition (recursive flattening), cycle detection, placeholder interpolation `${NAME}` against `ResolvedConfig` | File I/O, process spawning |
| **Executor** | Spawning child processes via execa, streaming stdout/stderr, sequential fail-fast, parallel fan-out + kill-on-failure, exit code propagation | Config loading, YAML, alias composition |
| **CLI Frontend** | Parsing `process.argv` via commander.js, dynamically registering commands from `CommandMap`, `--list`, `--dry-run`, `--help`, routing to Orchestrator | Business logic; all it does is parse args and delegate |
| **Orchestrator** | Wiring all components together in the correct order; catching typed errors and printing user-facing messages; calling `process.exit()` | Implementation details of any individual component |

---

## Data Flow

### Canonical Pipeline: `loci deploy`

```
process.argv  ["node", "loci", "deploy"]
      │
      ▼
CLI Frontend (commander.js)
  - parseAsync(process.argv) identifies command name "deploy"
  - Triggers registered action handler
      │
      ▼
Orchestrator.run("deploy")
      │
      ├─── ConfigLoader.load(cwd)
      │         reads LOCI_MACHINE_CONFIG path (if set)   → machine.yml
      │         reads cwd/.loci/config.yml                 → project.yml
      │         reads cwd/.loci/secrets.yml  (if exists)   → secrets.yml
      │         reads cwd/.loci/local.yml    (if exists)   → local.yml
      │         merges: machine ← project ← secrets ← local (last wins)
      │         returns ResolvedConfig: Record<string, string>
      │
      ├─── CommandsLoader.load(cwd)
      │         reads cwd/.loci/commands.yml
      │         validates schema (alias → CommandDef union type)
      │         returns CommandMap: Map<string, CommandDef>
      │
      ├─── Resolver.resolveAlias("deploy", CommandMap, ResolvedConfig)
      │         looks up "deploy" in CommandMap       → if unknown: UnknownAliasError
      │         walks composition graph depth-first   → if cycle: CircularAliasError
      │         flattens all referenced aliases into concrete string list
      │         for each command string: replaces ${NAME} from ResolvedConfig
      │                                  → if any ${NAME} unresolved: UnresolvedPlaceholderError
      │         returns ExecutionPlan: { type: "sequential"|"parallel", commands: string[] }
      │
      ├─── (--dry-run?) print ExecutionPlan, exit 0
      │
      └─── Executor.run(ExecutionPlan)
                sequential: run commands one by one
                            stop on first non-zero exit code
                parallel:   run all via Promise.all(execa calls)
                            on first failure: SIGTERM all remaining PIDs
                            collect exit codes, return highest non-zero
                streams stdout/stderr via execa {stdout:['pipe','inherit']}
                returns exit code (0 or first failure code)
      │
      ▼
process.exit(exitCode)
```

### Data Structures (TypeScript types)

```typescript
// ConfigLoader output
type ResolvedConfig = Record<string, string>;

// CommandsLoader output — exhaustive union matching YAML schema
type CommandDef =
  | { type: 'single';     cmd: string }
  | { type: 'sequential'; steps: CommandRef[] }
  | { type: 'parallel';   group: CommandRef[] }
  | { type: 'alias';      ref: string };   // composition: "deploy" → ["build","push"]

type CommandRef = string | CommandDef;   // inline or named alias
type CommandMap = Map<string, CommandDef>;

// Resolver output — everything flattened and interpolated
type ExecutionPlan =
  | { type: 'single';     cmd: string }
  | { type: 'sequential'; steps: string[] }     // concrete shell strings, no ${} remaining
  | { type: 'parallel';   group: string[] };
```

---

## Component Boundaries — What Each Component Must NOT Do

**ConfigLoader must NOT:**
- Know that `${NAME}` exists — it just delivers a flat map
- Validate whether config keys are used by any command
- Log secret values even in debug mode

**CommandsLoader must NOT:**
- Read or reference the config values
- Perform interpolation
- Resolve alias compositions (just parse structure)

**Resolver must NOT:**
- Do any file I/O
- Know how commands will be executed
- Have any dependency on commander.js

**Executor must NOT:**
- Do any string interpolation (must receive fully-resolved strings)
- Parse YAML
- Know about alias names or config keys

**CLI Frontend must NOT:**
- Contain business logic
- Decide what exit code to use
- Perform config loading directly

---

## Error Taxonomy

All errors extend a base `LociError` class. This enables `instanceof` checks and structured exit messaging.

```typescript
class LociError extends Error {
  constructor(message: string, public readonly code: LociErrorCode) {
    super(message);
    this.name = 'LociError';
  }
}
```

### Error Categories

| Category | Class | When Thrown | User Message Pattern |
|----------|-------|-------------|----------------------|
| **Config file unreadable** | `ConfigReadError` | File exists but cannot be read (permissions) | `Cannot read config file: {path} — {os error}` |
| **YAML parse error** | `YamlParseError` | Malformed YAML in any config or commands file | `Invalid YAML in {file}: {js-yaml message}` |
| **Missing commands file** | `MissingCommandsFileError` | `.loci/commands.yml` not found | `No commands file found. Expected .loci/commands.yml in {cwd}` |
| **Unknown alias** | `UnknownAliasError` | User typed an alias that isn't in CommandMap | `Unknown command: "{alias}". Run loci --list to see available commands` |
| **Circular alias** | `CircularAliasError` | Composition graph has a cycle | `Circular alias reference detected: {a} → {b} → {a}` |
| **Unresolved placeholder** | `UnresolvedPlaceholderError` | `${NAME}` found in command string but NAME not in ResolvedConfig | `Unresolved placeholder: \${NAME} in command "{cmd}". Add NAME to a config file` |
| **Child process failure** | `ChildProcessError` | Spawned command exits with non-zero code | Not thrown — exit code propagated directly to `process.exit()` |
| **IO error (secrets file)** | `SecretsReadError` (subclass of ConfigReadError) | secrets.yml unreadable | `Cannot read secrets file: {path}` |
| **Schema validation** | `CommandSchemaError` | commands.yml has unrecognised structure | `Invalid command definition for alias "{alias}": {details}` |

### Surfacing Rules

- **LociError subtypes** → Orchestrator catches, prints `error: {message}` to stderr, exits with code 1
- **Child process non-zero** → Executor returns the exit code; Orchestrator propagates it directly (no additional message, the subprocess already printed its error)
- **Unexpected JS errors** → Orchestrator catches `Error`, prints `unexpected error: {message}` + stack in `--debug` mode, exits with code 1
- **Secrets safety rule**: ConfigLoader must strip secret values from any Error messages and never include them in debug output

---

## Parallel Execution Semantics

**Convention adopted (matching npm-run-all with `--parallel` and concurrently with `--kill-others`):**

When a parallel group has 5 commands and one fails:

1. **Kill the others.** Send SIGTERM to all still-running processes. On Windows, use `execa`'s built-in graceful termination (it handles `taskkill /F /T` internally).
2. **Wait for them to terminate** before returning (use `Promise.allSettled`, not `Promise.all`, so rejection of one doesn't skip cleanup of others).
3. **Exit code:** return the exit code of the first command that failed. If multiple fail before kill resolves, return the first non-zero code observed.
4. **stdout/stderr interleaving:** use `execa` with `stdout: ['pipe', 'inherit']` and `stderr: ['pipe', 'inherit']`. Each process streams directly to the terminal in real-time. Lines from different processes may interleave — this is acceptable and matches what `concurrently` does by default. Prefix output with `[alias]` to make it readable.

**Implementation pattern:**

```typescript
async function runParallel(cmds: string[]): Promise<number> {
  const processes = cmds.map(cmd => execa(cmd, {
    shell: false,           // execa resolves cross-platform without shell:true
    stdout: ['pipe', 'inherit'],
    stderr: ['pipe', 'inherit'],
  }));

  let firstFailCode: number | null = null;

  const results = await Promise.allSettled(processes);

  for (const result of results) {
    if (result.status === 'rejected') {
      const code = result.reason?.exitCode ?? 1;
      if (firstFailCode === null) firstFailCode = code;
    }
  }

  if (firstFailCode !== null) {
    // Kill survivors
    for (const proc of processes) {
      proc.kill();
    }
    return firstFailCode;
  }
  return 0;
}
```

Note: `Promise.allSettled` waits for all to complete (whether resolved or rejected). For true "kill on first failure", the pattern needs an abort controller or a race with a shared cancellation token — see Pitfalls.

---

## Composition Resolution

**Decision: resolve recursively at load time (eager flattening), not at execution time.**

Rationale:
- Cycle detection happens once at startup, not mid-execution
- Interpolation can be validated before any process is spawned
- `--dry-run` and `--list` show fully resolved plans
- Simpler execution path (Executor receives only concrete strings)

**Cycle detection algorithm (DFS with visit stack):**

```typescript
function resolveAlias(
  name: string,
  map: CommandMap,
  visitStack: Set<string> = new Set()
): string[] {
  if (visitStack.has(name)) {
    throw new CircularAliasError([...visitStack, name].join(' → '));
  }
  visitStack.add(name);
  const def = map.get(name);
  if (!def) throw new UnknownAliasError(name);
  // recurse into composition refs...
  visitStack.delete(name);   // backtrack for non-cycle paths
  return resolvedCommands;
}
```

**Maximum depth:** No artificial limit. The DFS cycle detection handles any cycle regardless of depth. For practical purposes, a composition chain deeper than ~20 levels indicates a design problem — add a configurable depth warning (not a hard error) at depth > 20.

---

## Dynamic Commander.js Registration

Commander.js supports fully dynamic (runtime) command registration. There is no requirement that commands be defined at compile time. The pattern is:

```typescript
// After loading CommandMap from YAML:
for (const [alias, def] of commandMap.entries()) {
  program
    .command(alias)
    .description(def.description ?? '')
    .action(async () => {
      // Each iteration creates a new closure capturing `alias`
      // In modern JS (const/let in for...of), no IIFE needed
      await orchestrator.run(alias);
    });
}

await program.parseAsync(process.argv);
```

**Gotchas:**
- Use `parseAsync` (not `parse`) because action handlers are async
- Commander registers commands against the program instance; the loop must complete before `parseAsync` is called
- If `CommandMap` is empty (no commands.yml), register a fallback handler that prints a helpful message
- The `--list` flag must be registered before the dynamic loop so it takes priority
- Commander does not support adding commands after `parse()` has been called — the load-then-register order is essential

---

## Testability Seams

The pipeline architecture means each component can be tested in isolation by injecting test doubles at its boundary.

| Component | Inject Fake | What to Test |
|-----------|------------|--------------|
| **ConfigLoader** | Provide a fake `fs` (or `vol` from `memfs`) | Merge precedence, missing files, YAML parse errors, env var resolution |
| **CommandsLoader** | Provide YAML string directly instead of file path | Schema validation, malformed input, empty file |
| **Resolver** | Provide pre-built `CommandMap` and `ResolvedConfig` objects | Composition flattening, cycle detection, placeholder substitution, unknown alias |
| **Executor** | Inject a fake `spawn` function that returns a mock process | Sequential fail-fast, parallel kill-on-failure, exit code propagation — without ever forking a real process |
| **Orchestrator** | Inject all four fake components | End-to-end flow, error surfacing, exit code mapping |
| **CLI Frontend** | Provide a pre-loaded `CommandMap` (skip file I/O) | Commander registration, arg parsing, --dry-run output |

**Executor test pattern — inject spawn:**

```typescript
type SpawnFn = (cmd: string) => Promise<{ exitCode: number }>;

class Executor {
  constructor(private readonly spawn: SpawnFn = defaultExecaSpawn) {}
  // ...
}

// In tests:
const fakeSpawn: SpawnFn = async (cmd) => ({ exitCode: cmd.includes('fail') ? 1 : 0 });
const executor = new Executor(fakeSpawn);
```

This is the most important seam. Executor tests run at millisecond speed and test all branching logic without spawning real processes.

---

## Project Structure

```
src/
├── cli.ts                  # Entry point: creates Program, calls loadAndRegister, parseAsync
├── orchestrator.ts         # Wires components, catches LociError, calls process.exit
├── config/
│   ├── loader.ts           # ConfigLoader class
│   ├── types.ts            # ResolvedConfig, ConfigFile types
│   └── loader.test.ts
├── commands/
│   ├── loader.ts           # CommandsLoader class
│   ├── types.ts            # CommandDef, CommandMap, ExecutionPlan types
│   └── loader.test.ts
├── resolver/
│   ├── resolver.ts         # Resolver class: alias composition + interpolation
│   └── resolver.test.ts
├── executor/
│   ├── executor.ts         # Executor class: spawn, stream, exit codes
│   └── executor.test.ts
├── errors.ts               # LociError base + all subtypes + LociErrorCode enum
└── index.ts                # Re-exports for programmatic use (if ever needed)
```

**Structure Rationale:**
- One directory per component — mirrors the pipeline stages exactly
- `types.ts` per component owns the data contract for that stage's input/output
- `errors.ts` is global (all components throw from it; Orchestrator catches from it)
- Tests colocated with source — no separate `__tests__/` tree for a project this size

---

## Cross-Platform Concerns Per Component

### ConfigLoader

- **Path to machine config**: read from `process.env.LOCI_MACHINE_CONFIG`. On Windows this may contain backslashes. Use `path.resolve()` to normalize before passing to `fs.readFile`. Never do string operations on it.
- **CWD detection**: use `process.cwd()` — Node normalizes this per platform. Do not use `__dirname`.
- **Env var casing**: `process.env` on Windows is case-insensitive at the OS level but Node.js wraps it in a case-preserving proxy. Read `LOCI_MACHINE_CONFIG` (all caps) consistently and document that.

### CommandsLoader

- **YAML itself**: YAML files contain forward-slash paths written by humans — they will typically be `/`-separated in YAML text. This is fine; do not convert them. The YAML is just strings until the user's shell interprets them.
- **No path resolution in YAML parsing** — CommandsLoader treats all command strings as opaque strings.

### Resolver

- **Placeholder names**: `${NAME}` — NAME is case-sensitive. Document this clearly. Config keys are case-sensitive in the merged map.
- **No path manipulation** in Resolver — it only does string substitution.

### Executor

- **Shell invocation**: use `execa` WITHOUT `shell: true`. Execa handles PATHEXT, shebangs, and cross-platform binary resolution automatically. `shell: true` passes the command to `cmd.exe` on Windows, which changes quoting semantics and breaks argument handling.
- **PATH vs Path**: execa inherits `process.env` which already has the correct platform PATH. No manual handling needed.
- **SIGTERM on Windows**: execa's `.kill()` method uses `taskkill /F /T` on Windows. This is correct behavior for our parallel kill-on-failure.
- **Exit code null**: if a process is killed by a signal (not by normal exit), `exitCode` is `null`. Treat `null` as `1`.
- **stdout/stderr interleaving in parallel**: no clean solution exists without buffering. Use `execa`'s `['pipe', 'inherit']` and accept that lines may interleave. Prefix each line with `[alias-name]` using a transform stream to help readability — this is the standard approach used by `concurrently`.

---

## Suggested Build Order

Dependencies between components determine build order. A component can only be built after all components it depends on.

```
Dependency graph (A → B means B must exist before A):

Executor   (no deps on other loci components)
    │
ConfigLoader  (no deps on other loci components)
    │
CommandsLoader  (no deps on other loci components)
    │
    └── Resolver  ← needs CommandsLoader output types + ConfigLoader output types
            │
            └── Orchestrator  ← needs all four
                    │
                    └── CLI Frontend  ← needs Orchestrator + CommandsLoader (for registration)
```

**Recommended phase order:**

| Phase | Component(s) | Why This Order |
|-------|-------------|----------------|
| 1 | `errors.ts` + all types | Zero dependencies; unlocks typed development for all other phases |
| 2 | ConfigLoader | Self-contained; produces the most fundamental data structure |
| 3 | CommandsLoader | Self-contained; defines the CommandDef schema |
| 4 | Resolver | Depends on types from phases 2 + 3; first integration point |
| 5 | Executor | Self-contained; can be built in parallel with phases 2-4 if needed |
| 6 | Orchestrator | Wires phases 2-5; first time the full pipeline runs |
| 7 | CLI Frontend | Thin wrapper over Orchestrator; built last |

**Practical note:** Phase 5 (Executor) can be built alongside Phase 2-3, since it has no dependencies on other loci components. The only constraint is that it must be complete before Phase 6.

---

## Architectural Patterns

### Pattern 1: Pipeline with Typed Stage Outputs

**What:** Each pipeline stage is a class with a single public method that accepts the previous stage's output type and returns a new type. No shared mutable state between stages.

**When to use:** Always. This is the core pattern of the whole system.

**Trade-offs:** Slightly more ceremony (explicit types for each stage), but makes the data flow auditable and makes each stage independently testable.

### Pattern 2: Dependency Injection for Spawn

**What:** Executor accepts its spawn function as a constructor parameter with a sensible default.

**When to use:** For Executor only — this is the hard seam needed for fast tests.

**Trade-offs:** Tiny overhead; massive payoff in test speed and reliability.

### Pattern 3: Eager Resolution at Load Time

**What:** Resolver flattens all alias composition and interpolates all placeholders before execution begins. Executor receives only concrete strings.

**When to use:** Always for loci v1.

**Trade-offs:** Slightly longer startup (resolve all aliases, not just the one invoked) — acceptable given the 300ms budget and the typical small size of commands.yml. Benefit: `--dry-run` and `--list` show exactly what would run.

---

## Anti-Patterns

### Anti-Pattern 1: Lazy Interpolation in Executor

**What people do:** Pass `CommandDef` objects to Executor and interpolate `${NAME}` inside the spawn loop.

**Why it's wrong:** Mixes concerns, makes Executor depend on ResolvedConfig, breaks the clean boundary. Unresolved placeholder errors surface only when the command actually runs, not at startup. Makes `--dry-run` impossible without duplicating interpolation logic.

**Do this instead:** Resolver handles all interpolation. Executor receives only `string[]`.

### Anti-Pattern 2: `shell: true` in Execa for Cross-Platform

**What people do:** Set `shell: true` to "make it work on Windows."

**Why it's wrong:** On Windows, `cmd.exe` uses different quoting rules (`"` only, no single quotes), different wildcard expansion, and different PATH resolution. This creates subtle platform-specific bugs. It also opens a shell injection vector if any part of the command string comes from user-controlled config values.

**Do this instead:** Use `execa` without `shell: true`. Execa handles cross-platform binary resolution via PATHEXT and shebang handling. If the command string is a raw shell one-liner that uses pipes or redirects (`|`, `>`, `&&`), document that these are not supported in `loci` command strings — users must wrap them in a script.

### Anti-Pattern 3: Letting Commander.js Load Config

**What people do:** Put config loading inside commander.js action handlers.

**Why it's wrong:** Config loading can fail (missing files, YAML errors) before the action handler runs, and the error surfaces inside commander's error handling which is hard to control. It also makes `--list` require loading config even when it shouldn't need to.

**Do this instead:** CLI Frontend loads CommandMap (for registration), then hands off to Orchestrator. Orchestrator owns the config loading step.

### Anti-Pattern 4: Resolving All Aliases Eagerly in the Presence of Secrets

**What people do:** Log the fully-resolved `ExecutionPlan` (with all config values substituted) for debugging.

**Why it's wrong:** The resolved plan contains the actual values of secrets (tokens, passwords) that were injected from `secrets.yml`. Logging it leaks secrets to terminal history or log files.

**Do this instead:** `--dry-run` prints the interpolated commands, but Orchestrator must check whether any substituted values came from the secrets file and redact them (replace with `[REDACTED]`). In practice for v1: simply do not print substituted values in dry-run — print the template form (`${API_TOKEN}`) instead.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| ConfigLoader → Resolver | `ResolvedConfig` (plain object) passed as parameter | No shared state |
| CommandsLoader → Resolver | `CommandMap` passed as parameter | No shared state |
| CommandsLoader → CLI Frontend | `CommandMap` passed for dynamic registration | Frontend only reads alias names + descriptions |
| Resolver → Executor | `ExecutionPlan` (flat string arrays) | Executor has no knowledge of aliases or config keys |
| Any component → Orchestrator | Throws `LociError` subtype | Orchestrator is the single catch point |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| File system | Node.js `fs/promises` (wrapped per-component) | Inject fake `fs` for testing via `memfs` |
| Child processes | `execa` v9 (ESM) | Single abstraction point in Executor only |
| YAML parsing | `js-yaml` (parseDocument for errors with line numbers) | Used in ConfigLoader and CommandsLoader only |
| CLI parsing | `commander.js` v14+ | Used in CLI Frontend only |

---

## Scaling Considerations

This is a single-developer local CLI tool. Traditional scaling (users, requests) does not apply. Relevant "scaling" dimensions are:

| Concern | Now (1 project) | Later (50 projects) |
|---------|-----------------|---------------------|
| Startup time | <300ms target | Machine-level config cache on disk, lazy YAML parse |
| commands.yml size | ~20 aliases | No performance concern; YAML parse is instant |
| Composition depth | ~3-4 levels | DFS handles any depth; add depth warning at >20 |
| Parallel processes | 2-5 concurrent | execa + Promise.allSettled handles dozens |

---

## Sources

- Commander.js dynamic registration: https://github.com/tj/commander.js/issues/132
- Execa v9 streaming and parallel patterns: https://github.com/sindresorhus/execa
- concurrently kill-others behavior: https://github.com/open-cli-tools/concurrently
- npm-run-all parallel SIGTERM behavior: https://github.com/mysticatea/npm-run-all/blob/master/docs/npm-run-all.md
- Cross-platform path handling in Node.js: https://shapeshed.com/writing-cross-platform-node/
- DFS cycle detection (Madge implementation reference): https://deepwiki.com/pahen/madge/4.4-circular-dependency-detection
- TypeScript error class hierarchy best practices: https://github.com/goldbergyoni/nodebestpractices

---
*Architecture research for: loci — cross-platform Node.js CLI command runner*
*Researched: 2026-04-10*
