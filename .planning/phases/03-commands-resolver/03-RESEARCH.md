# Phase 3: Commands & Resolver - Research

**Researched:** 2026-04-13
**Domain:** YAML schema parsing, alias composition graph algorithms, placeholder interpolation, secrets redaction
**Confidence:** HIGH

## Summary

Phase 3 implements the middle layer of the loci pipeline: commands.yml parsing, alias composition with cycle detection, and `${VAR}` placeholder resolution into an `ExecutionPlan`. The type contracts (`CommandDef`, `CommandMap`, `ExecutionPlan`, `Resolver`, `CommandsLoader`) are fully defined in `src/types.ts` and locked from Phase 1. The error classes (`CircularAliasError`, `UnknownAliasError`, `CommandSchemaError`, `UndefinedPlaceholderError`) are declared in `src/errors.ts` and ready to throw. The `yaml` 2.8.3 package is already installed and used by Phase 2; the same parser handles `commands.yml`. No new runtime dependencies are needed.

The three major algorithmic concerns are: (1) whitespace tokenization with double-quote preservation for string commands, (2) DFS cycle detection with path tracking across the alias composition graph, and (3) `${VAR}` inline expansion with `$${}` escape handling. All three are standard algorithms with no need for third-party helpers. Secrets from `ResolvedConfig.secretKeys` must never appear in any log/display output — this is enforced by a redaction helper that substitutes `***` in `ExecutionPlan` display representations.

**Primary recommendation:** Implement as a pipeline of pure functions (parse → validate/flatten → cycle-check → CommandMap) for the loader, and a single `resolve()` function for the resolver, keeping each concern isolated and independently testable. The existing Phase 2 `readLayer()` + `flattenToStrings()` pattern in `src/config/index.ts` is the reference model for the YAML loading stage.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Bare string value is single-command shorthand; object form `{ cmd, description, ... }` is the explicit alternative.
- **D-02:** Sequential chains use `steps:` key; concurrent groups use `parallel:` key.
- **D-03:** String commands split on whitespace with double-quote preservation; array form available for edge cases.
- **D-04:** Optional `description:` on all alias types.
- **D-05:** Multiple `${VAR}` placeholders expand inline within a single token; dot-notation references (`${deploy.host}`).
- **D-06:** `$${VAR}` escapes to literal `${VAR}` in output.
- **D-07:** Every merged config key is injected as env var to child process (12-factor; not Phase 3's job to spawn — only to include in `ExecutionPlan`).
- **D-08:** Config key `deploy.host` maps to env var `DEPLOY_HOST` (dot → underscore, uppercase).
- **D-09:** Step-string-to-alias detection via lookup: if step string matches a key in `CommandMap`, it is an alias reference; otherwise it is an inline command.
- **D-10:** Nesting depth cap at 10 levels; exceeding produces error with full expansion chain.
- **D-11:** Eager (load-time) validation of ALL aliases: cycle detection, unknown alias refs, schema.
- **D-12:** Platform overrides (`linux:`, `windows:`, `macos:`) replace the entire command for that platform.
- **D-13:** Platform overrides apply only to `single`-type commands.
- **D-14:** No default `cmd:` required; missing platform match is a run-time error (not load-time).

### Claude's Discretion

- Internal architecture of commands loader (pipeline vs monolithic), as long as it implements `CommandsLoader`.
- Exact whitespace-split implementation (custom tokenizer vs lightweight library).
- Cycle detection algorithm (DFS with coloring, topological sort, or other) — must report full cycle path.
- Whether the resolver is a single function or pipeline of transforms — must implement `Resolver`.
- Test organization within `src/commands/__tests__/` and `src/resolver/__tests__/`.
- How `ExecutionPlan` represents env vars (separate field, or assumed from `ResolvedConfig` passed to executor).

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CMD-01 | `.loci/commands.yml` defines alias → command mapping | YAML 2.8.3 parse pattern from Phase 2; schema normalization in Standard Stack |
| CMD-02 | Single command (string or argv array) | Whitespace tokenizer; D-03 locked |
| CMD-03 | Sequential steps (ordered, fail-fast) | Step normalization; each step is inline or alias ref per D-09 |
| CMD-04 | Parallel group (concurrent, kill-on-failure) | Group normalization; execution deferred to Phase 4 |
| CMD-05 | Alias composition (alias refs in steps/group) | DFS composition flattening; depth cap D-10 |
| CMD-06 | Cycle detection at load time with full chain | DFS with coloring; CircularAliasError already declared |
| CMD-07 | Platform overrides `linux:`/`windows:`/`macos:` | PlatformOverrides type exists; selection logic in resolver |
| CMD-08 | Optional `description:` field | Present in CommandDef union; surfaced to CLI-02/04 by Phase 4 |
| CMD-09 | Error on unknown alias reference | UnknownAliasError already declared; checked during eager validation |
| INT-01 | `${VAR}` placeholder resolution before spawn | Regex-based inline expansion over argv tokens |
| INT-02 | Error on undefined placeholder (no run) | UndefinedPlaceholderError already declared; must abort before ExecutionPlan returned |
| INT-03 | Interpolated values as separate argv tokens (no shell concat) | Placeholders expand within a token, not injected as new tokens; shell:false enforced in Phase 4 |
| INT-04 | All merged config keys as child process env vars | Dot→underscore, uppercase transform; injected in ExecutionPlan or passed to executor |
| INT-05 | Secrets values redacted to `***` in verbose/dry-run output | Redaction helper using `ResolvedConfig.secretKeys`; must not redact in actual env injection |
</phase_requirements>

---

## Standard Stack

### Core (already installed — zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| yaml | 2.8.3 | Parse `commands.yml` | Already installed; YAML 1.2 semantics; same usage pattern as Phase 2 |
| Node.js built-ins | >=20.5.0 | `node:fs`, `node:path`, `node:os` | File I/O; no third-party needed |

[VERIFIED: package.json] — `yaml` 2.8.3 is an exact-pinned runtime dependency. No new packages required for Phase 3.

### No New Dependencies

Phase 3 is pure algorithmic work: YAML parsing (yaml already installed), graph algorithms (DFS — standard CS, no library needed), string tokenization (custom per D-03, no library needed), and placeholder regex expansion (standard JS RegExp). Adding any new runtime dependency would violate the cold-start budget principle and the "minimal dependencies" constraint from CLAUDE.md.

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── commands/
│   ├── index.ts           # commandsLoader export — replaces stub
│   ├── parse.ts           # raw YAML → RawAliasMap (no validation)
│   ├── normalize.ts       # RawAliasMap → CommandMap (schema + cycle check)
│   ├── tokenize.ts        # string → string[] whitespace tokenizer
│   └── __tests__/
│       ├── commands.test.ts
│       ├── tokenize.test.ts
│       └── cycle.test.ts
├── resolver/
│   ├── index.ts           # resolver export — replaces stub
│   ├── interpolate.ts     # ${VAR} expansion + $${} escape
│   ├── platform.ts        # platform selection (linux/windows/macos)
│   ├── envvars.ts         # dot→underscore env var name transform
│   └── __tests__/
│       └── resolver.test.ts
└── ...
```

[ASSUMED] — file decomposition is at Claude's discretion per CONTEXT.md. The split above follows the Phase 2 pattern (one concern per module) and is recommended but not locked.

### Pattern 1: Commands Loader Pipeline

**What:** Three-stage pipeline: parse raw YAML → normalize to typed `CommandDef` union → validate all aliases eagerly.

**When to use:** Always — matches D-11 (eager validation at load time).

```typescript
// Source: established Phase 2 pattern in src/config/index.ts

export const commandsLoader: CommandsLoader = {
  async load(cwd: string): Promise<CommandMap> {
    const filePath = join(cwd, '.loci', 'commands.yml');
    const raw = readRawYaml(filePath);          // throws YamlParseError / null if missing
    if (raw === null) return new Map();         // no commands.yml = empty CommandMap
    const normalized = normalize(raw, filePath); // throws CommandSchemaError
    validateGraph(normalized);                   // throws CircularAliasError, UnknownAliasError
    return normalized;
  },
};
```

[VERIFIED: src/config/index.ts] — Phase 2 uses the same readLayer → validate → merge pipeline. This pattern is established and should be followed.

### Pattern 2: YAML Schema Normalization

**What:** Accept the flexible user-facing YAML shapes (string shorthand, object form, steps/parallel) and normalize to the strict `CommandDef` union type.

**When to use:** During the normalize stage, after raw YAML is parsed.

```typescript
// Source: src/types.ts — CommandDef union (locked from Phase 1)

// Input: raw YAML value (could be string, array, or object)
function normalizeAlias(aliasName: string, raw: unknown, filePath: string): CommandDef {
  if (typeof raw === 'string') {
    // D-01 string shorthand → single with tokenized cmd
    return { kind: 'single', cmd: tokenize(raw) };
  }
  if (Array.isArray(raw)) {
    // Array of strings → treat as argv (CMD-02 array form)
    return { kind: 'single', cmd: validateStringArray(raw, aliasName) };
  }
  if (typeof raw === 'object' && raw !== null) {
    return normalizeObject(aliasName, raw as Record<string, unknown>, filePath);
  }
  throw new CommandSchemaError(aliasName, 'must be a string, array, or object');
}
```

[ASSUMED] — exact function signatures are implementation detail at Claude's discretion.

### Pattern 3: DFS Cycle Detection with Path Tracking

**What:** Iterative or recursive DFS over the alias composition graph using three-color marking (WHITE=unvisited, GRAY=in-stack, BLACK=done). When a GRAY node is reached, the cycle path is reconstructed from the call stack.

**When to use:** Called on every alias in the CommandMap after normalization (D-11 eager validation).

```typescript
// Source: standard computer science algorithm — no library needed

type Color = 'white' | 'gray' | 'black';

function detectCycles(commands: CommandMap): void {
  const color = new Map<string, Color>();
  const path: string[] = [];

  function dfs(alias: string): void {
    color.set(alias, 'gray');
    path.push(alias);

    const def = commands.get(alias);
    if (!def) throw new UnknownAliasError(alias);

    const refs = getAliasRefs(def); // collect CommandRef[] from steps or group
    for (const ref of refs) {
      if (!commands.has(ref)) throw new UnknownAliasError(ref);
      const c = color.get(ref) ?? 'white';
      if (c === 'gray') {
        // Found cycle: path from ref to current + ref to close the loop
        const cycleStart = path.indexOf(ref);
        throw new CircularAliasError([...path.slice(cycleStart), ref]);
      }
      if (c === 'white') dfs(ref);
    }

    path.pop();
    color.set(alias, 'black');
  }

  for (const alias of commands.keys()) {
    if ((color.get(alias) ?? 'white') === 'white') dfs(alias);
  }
}
```

[ASSUMED] — specific implementation at Claude's discretion. The algorithm is standard and well-understood.

### Pattern 4: Whitespace Tokenizer with Quote Preservation (D-03)

**What:** Split a command string on whitespace, but treat double-quoted segments as single tokens. No shell metacharacter processing.

**When to use:** Every time a string command is converted to an argv array.

```typescript
// Source: [ASSUMED] — custom implementation required per D-03

function tokenize(input: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && !inQuotes) {
      inQuotes = true;
    } else if (ch === '"' && inQuotes) {
      inQuotes = false;
    } else if (ch === ' ' && !inQuotes) {
      if (current.length > 0) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}
```

Edge cases to test: empty string, leading/trailing spaces, multiple consecutive spaces, unclosed quote (should throw CommandSchemaError or return as-is — document choice), nested quotes not supported (not required by spec).

[ASSUMED] — implementation detail at Claude's discretion.

### Pattern 5: Placeholder Interpolation with Escape (D-05, D-06)

**What:** Expand `${key}` in-place within each argv token using `ResolvedConfig.values`. Treat `$${key}` as the literal string `${key}`. Throw `UndefinedPlaceholderError` if a key is missing.

**When to use:** During `resolver.resolve()`, over each token in the resolved argv array.

```typescript
// Source: [ASSUMED] — standard regex-based implementation

const PLACEHOLDER_RE = /\$\$\{[^}]+\}|\$\{([^}]+)\}/g;

function interpolateToken(
  token: string,
  aliasName: string,
  values: Readonly<Record<string, string>>,
): string {
  return token.replace(PLACEHOLDER_RE, (match, key?: string) => {
    if (key === undefined) {
      // $${ escape: strip one $ to produce ${...} literal
      return match.slice(1);
    }
    if (!Object.hasOwn(values, key)) {
      throw new UndefinedPlaceholderError(key, aliasName);
    }
    return values[key]!;
  });
}
```

[ASSUMED] — specific regex and branching is implementation detail.

### Pattern 6: Env Var Name Transform (D-08)

**What:** Convert dot-notation config keys to `UPPER_UNDERSCORE` env var names for child process injection (INT-04).

**When to use:** When building the env var map in the execution plan or passing to the executor.

```typescript
// Source: D-08 from CONTEXT.md

function toEnvVarName(dotKey: string): string {
  return dotKey.toUpperCase().replace(/\./g, '_');
}
// 'deploy.host' → 'DEPLOY_HOST'
// 'api.key.secret' → 'API_KEY_SECRET'
```

[VERIFIED: CONTEXT.md D-08] — convention is locked.

### Pattern 7: Secrets Redaction (INT-05)

**What:** When producing a display-safe representation of an `ExecutionPlan` (for `--dry-run` or `--verbose`), replace any argv token that came from a secret config key with `***`.

**When to use:** Only in display/log paths — NEVER in actual env injection (secrets are allowed as env vars per D-07).

```typescript
// Source: D-07, INT-05 from CONTEXT.md and REQUIREMENTS.md

function redactSecrets(
  envVars: Record<string, string>,
  secretKeys: ReadonlySet<string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(envVars)) {
    result[k] = secretKeys.has(k) ? '***' : v;
  }
  return result;
}
```

CRITICAL: The actual `ExecutionPlan` passed to Phase 4's executor contains real values. Redaction is only for display output. The resolver's job is to produce both the real plan and a display-safe representation, OR Phase 4's dry-run/verbose flags handle redaction at display time using the `secretKeys` set they already have.

[ASSUMED] — whether redaction lives in Phase 3 resolver or Phase 4 display layer is at Claude's discretion, since Phase 3 is not responsible for `--dry-run`/`--verbose` flags (per phase boundary in CONTEXT.md). INT-05 is still a Phase 3 requirement because the resolver must not expose secret values in any internal representation it produces. The safest approach: `ExecutionPlan` carries real argv (for spawning) and the secretKeys set flows through to Phase 4 for display redaction.

### Anti-Patterns to Avoid

- **Shell-splitting a command string with a shell parser:** loci uses `shell: false` (EXE-01). The tokenizer must NOT invoke a shell to split — it must be a pure string operation. Importing `shellwords` or similar adds a dependency and implies shell semantics.
- **Lazy validation (validate only the invoked alias):** D-11 mandates eager load-time validation of ALL aliases. Validating on demand would mean cycle errors surface only when the specific alias is first called.
- **Using `Map.has()` check on CommandRef before DFS:** The `UnknownAliasError` must be thrown for references in `steps:` or `parallel:` even if those references are never invoked. Both CMD-09 and D-11 require this.
- **Mutating `ResolvedConfig.values` or `CommandMap` after construction:** Both are `Readonly` — the type system enforces this, but be careful not to cast away the constraint.
- **Logging secret values in any error message:** `UndefinedPlaceholderError` receives the placeholder key name (safe), not the config value. `CommandSchemaError` similarly. Follow the Phase 1 precedent from `ShellInjectionError` (discards value with `void value`).
- **Treating D-09 alias detection as prefix match:** Only exact match of a step string against a CommandMap key constitutes an alias reference. A step `"npm run build"` does NOT shadow an alias named `"npm"`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom YAML parser | `yaml` 2.8.3 (already installed) | Full YAML 1.2 spec, handles anchors, multiline strings, all edge cases |
| Cycle detection library | npm `graph-cycle` or similar | Standard DFS with coloring | Zero dependency, 30 lines of code, well-understood, gives full path |
| Platform detection | OS fingerprinting | `process.platform` | Node.js built-in; returns `'linux'`, `'win32'`, `'darwin'` |
| Dot-to-underscored env names | regex from stackoverflow | The 6-line `toEnvVarName()` function above | Trivial; no edge cases beyond dots |

**Key insight:** Phase 3's entire algorithmic surface is standard CS (graph traversal, regex substitution, string tokenization). Every problem has a well-known solution that fits in < 50 lines. No third-party library is justified.

---

## Common Pitfalls

### Pitfall 1: `process.platform` value on Windows
**What goes wrong:** Code checks `platform === 'windows'` but `process.platform` returns `'win32'` on Windows.
**Why it happens:** Node.js uses the OS kernel name, not a friendly label.
**How to avoid:** Map platform overrides: `linux → 'linux'`, `windows → 'win32'`, `macos → 'darwin'`. Write a helper `currentPlatform(): 'linux' | 'windows' | 'macos'` that maps `process.platform` to the user-facing key used in `commands.yml`.
**Warning signs:** Platform tests pass on Linux/macOS but no Windows branch ever executes.

[VERIFIED: Node.js docs] — `process.platform` returns `'win32'` for all Windows variants.

### Pitfall 2: Alias Detection Shadowing (D-09 Edge Case)
**What goes wrong:** A step string like `"npm"` accidentally matches an alias named `"npm"` defined in CommandMap.
**Why it happens:** Lookup-based detection is exact-match but the user may have an alias with the same name as a system binary.
**How to avoid:** This is by design (D-09) and documented — the user uses array form `["npm", "run", "build"]` or quotes to force inline. The CommandSchemaError message should explain this.
**Warning signs:** A step that should run the system `npm` binary instead expands an alias.

[VERIFIED: CONTEXT.md §Specific Ideas] — user acknowledged this edge case.

### Pitfall 3: DFS Stack Overflow on Deep Alias Graphs
**What goes wrong:** Recursive DFS on an alias graph with depth > Node.js call stack limit causes a stack overflow, not a clean error.
**Why it happens:** JavaScript call stacks are typically limited to ~10,000 frames. The depth cap D-10 is 10, which is well within limits, but the DFS visits ALL aliases eagerly.
**How to avoid:** The depth cap (D-10) prevents runaway recursion. Implement depth counting alongside the DFS; throw with the full expansion chain when depth > 10. For load-time cycle detection (which visits the graph without expanding), the 10-level alias graph is trivially safe. The risk only exists if the depth cap is not enforced during composition expansion.
**Warning signs:** Stack overflow instead of a clean LociError.

### Pitfall 4: Placeholder Regex Consuming `$${` Escape
**What goes wrong:** A simple `\${([^}]+)}` regex matches the `{VAR}` part inside `$${VAR}`, causing the escape to be treated as a placeholder with key starting with `$`.
**Why it happens:** The regex does not account for the `$$` prefix.
**How to avoid:** Match `$${}` before `${}` in the regex (as in Pattern 5 above): `\$\$\{[^}]+\}|\$\{([^}]+)\}`. The first alternative matches and consumes the escape without a capture group, the second captures the placeholder key.
**Warning signs:** `$${MY_VAR}` produces `${MY_VAR}` sometimes but not others, or triggers UndefinedPlaceholderError.

### Pitfall 5: Secrets Exposed in Error Messages
**What goes wrong:** An `UndefinedPlaceholderError` or `CommandSchemaError` includes a config value (which may be a secret) in the message string.
**Why it happens:** Convenience — error messages often echo back what was given.
**How to avoid:** Error messages should include only the placeholder key name (safe), the alias name (safe), and the file path (safe) — never any config value. Established precedent: `ShellInjectionError` in `src/errors.ts` discards its `value` parameter with `void value`.
**Warning signs:** Debug output shows a database password or API key in an error backtrace.

[VERIFIED: src/errors.ts — ShellInjectionError pattern established in Phase 1].

### Pitfall 6: Frozen `ReadonlyMap` mutation in tests
**What goes wrong:** Tests construct a `CommandMap` as `new Map()` but the production type is `ReadonlyMap<string, CommandDef>`. Tests that mutate the map after passing it to the resolver produce false results.
**Why it happens:** TypeScript `ReadonlyMap` only prevents mutation through the typed variable — a `Map` cast to `ReadonlyMap` is still mutable by the original reference.
**How to avoid:** Construct test fixtures as `new Map() as CommandMap` and do not mutate after passing to functions under test. Or use a `buildCommandMap()` test helper that returns a frozen map.

---

## Code Examples

### Reading commands.yml (follows Phase 2 pattern)

```typescript
// Source: src/config/index.ts readLayer() — established Phase 2 pattern

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { CommandSchemaError, YamlParseError } from '../errors.js';

function readCommandsYaml(cwd: string): Record<string, unknown> | null {
  const filePath = join(cwd, '.loci', 'commands.yml');
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err: unknown) {
    if (err instanceof YamlLibError) {
      throw new YamlParseError(filePath, err.linePos?.[0]?.line, err);
    }
    throw err;
  }
  if (parsed === null || parsed === undefined) return null;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new YamlParseError(filePath, undefined, new Error('Root must be a YAML mapping'));
  }
  return parsed as Record<string, unknown>;
}
```

[VERIFIED: src/config/index.ts] — same YAML parse + ENOENT pattern; reuse exactly.

### Platform selection in resolver

```typescript
// Source: [ASSUMED] — based on Node.js process.platform docs

function currentOsKey(): 'linux' | 'windows' | 'macos' {
  switch (process.platform) {
    case 'linux':  return 'linux';
    case 'win32':  return 'windows';
    case 'darwin': return 'macos';
    default:       return 'linux'; // fallback for exotic platforms
  }
}

function selectCommand(
  def: CommandDef & { kind: 'single' },
  aliasName: string,
): readonly string[] {
  const os = currentOsKey();
  const override = def.platforms?.[os];
  if (override !== undefined) return override;
  if (def.cmd.length > 0) return def.cmd;
  throw new CommandSchemaError(
    aliasName,
    `has no command for ${os} (only ${Object.keys(def.platforms ?? {}).join(', ')} defined)`,
  );
}
```

[VERIFIED: CONTEXT.md D-12, D-14] — logic matches locked decisions.

### Env var injection map construction (INT-04)

```typescript
// Source: D-07, D-08 from CONTEXT.md

function buildEnvVars(
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [dotKey, value] of Object.entries(values)) {
    env[dotKey.toUpperCase().replace(/\./g, '_')] = value;
  }
  return env;
}
// Note: secrets are intentionally included — 12-factor model.
// Redaction for display is a separate concern (INT-05, Phase 4 display layer).
```

[VERIFIED: CONTEXT.md D-07, D-08] — both decisions are locked.

### commands.yml example (for test fixture reference)

```yaml
# Single command — string shorthand (D-01)
build: "npm run build"

# Single command — object form with description and platform overrides (D-01, D-04, D-07)
package:
  cmd: "docker build -t myapp ."
  description: "Build Docker image"
  windows:
    cmd: ["docker", "build", "-t", "myapp", "."]

# Sequential alias (D-02, D-03)
ci:
  description: "Run full CI pipeline"
  steps:
    - lint
    - test
    - build

# Parallel group (D-02)
check:
  parallel:
    - lint
    - typecheck

# Alias with placeholder (INT-01, D-05)
deploy:
  cmd: "scp ${USER}@${deploy.host}:/app"
  description: "Deploy to server"

# Windows-only alias (D-14)
cleanup:
  windows:
    cmd: ["del", "/f", "dist"]
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `js-yaml` for YAML parsing | `yaml` 2.8.3 (YAML 1.2) | Established in Phase 1 | `yes`/`no` remain strings; no boolean coercion footgun |
| Shell-based command splitting | Pure whitespace tokenizer, `shell: false` | Architecture decision | Cross-platform guarantee; no shell injection vector |
| Runtime alias discovery | Eager load-time validation (D-11) | Phase 3 design | All errors surface before any command runs |

**Deprecated/outdated:**

- `js-yaml`: YAML 1.1 semantics (boolean coercion). Project uses `yaml` exclusively.
- Shell-based tokenization (shellwords, etc.): loci is `shell: false` first; no shell tokenizer is appropriate.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | File decomposition into parse.ts / normalize.ts / tokenize.ts / interpolate.ts etc. | Architecture Patterns | Low — Claude's discretion; can be monolithic if preferred |
| A2 | Redaction (INT-05) is implemented in Phase 4 display layer, not in Phase 3 ExecutionPlan | Code Examples | Medium — if Phase 4 expects a redacted plan from Phase 3, Phase 3 must add display field |
| A3 | Unclosed double quote in tokenizer throws CommandSchemaError | Pattern 4 | Low — behavior not specified; either throw or treat as closed at end-of-string |
| A4 | `currentOsKey()` defaults to `'linux'` for unknown platforms | Code Examples | Low — unlikely in practice; could also throw |
| A5 | `ExecutionPlan` does not carry env vars (env vars passed separately to executor) | Architecture | Medium — types.ts ExecutionPlan union has no `env` field; executor receives ResolvedConfig separately |

Assumption A5 is notable: looking at `src/types.ts`, `ExecutionPlan` contains only `argv`/`steps`/`group` — there is no `env` field. Phase 4's `Executor.run(plan)` receives only the plan. This means env var injection (INT-04) must be handled by the executor using its own reference to `ResolvedConfig`, OR the `ExecutionPlan` type must be extended. Since types are locked from Phase 1 and the executor receives `ExecutionPlan` only, the env var map must flow to Phase 4 via a separate mechanism. This is a MEDIUM-risk gap to flag for the planner.

---

## Open Questions

1. **Env var injection path (INT-04) — where does it land?**
   - What we know: `ExecutionPlan` (locked type) has no `env` field. `Executor.run(plan)` receives only the plan. Phase 3 computes the env var map.
   - What's unclear: How does the env map reach Phase 4's `execa` call? Options: (a) Phase 4 loads config itself and builds env vars, (b) `Resolver.resolve()` also returns env vars alongside ExecutionPlan (requires a wrapper type), (c) `ExecutionPlan` is extended (breaks the locked type).
   - Recommendation: Phase 4 owns config loading and env injection — Phase 3 resolver focuses on argv resolution. Document this in the plan and coordinate with Phase 4 research. The simplest approach: resolver returns `ExecutionPlan` (argv), Phase 4 executor calls `buildEnvVars(config.values)` independently.

2. **Redaction scope for INT-05**
   - What we know: INT-05 is assigned to Phase 3. Phase 3 does NOT implement `--dry-run`/`--verbose` (those are Phase 4 CLI flags). Phase 3's phase boundary explicitly excludes those flags.
   - What's unclear: Does Phase 3 need to produce a redacted display form of the ExecutionPlan, or merely guarantee that secrets never appear in logs Phase 3 itself emits?
   - Recommendation: Phase 3 implements a `redactForDisplay(plan, config)` utility that Phase 4 calls. Phase 3 never logs any config values itself. INT-05 compliance = (a) no secret values in Phase 3 error messages, and (b) `redactForDisplay()` utility is available for Phase 4.

3. **Depth cap enforcement location (D-10)**
   - What we know: The depth cap is 10 levels. DFS cycle detection runs at load time across the graph.
   - What's unclear: Does the depth cap apply during load-time graph traversal (for composition flattening) or only at resolver time (when expanding aliases to concrete argv)?
   - Recommendation: Depth cap is enforced during resolver composition expansion. The DFS cycle detector at load time runs without depth limit (it uses coloring to terminate). At resolution time, when expanding nested alias references into concrete argv arrays, count depth and throw at 10.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — Phase 3 is pure algorithmic code using already-installed packages and Node.js built-ins).

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | Schema validation via CommandSchemaError; placeholder validation via UndefinedPlaceholderError |
| V6 Cryptography | no | N/A — secrets are read-only, not generated |

### Known Threat Patterns for Phase 3 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret value in error message | Information Disclosure | Never include config values in LociError messages (established precedent: ShellInjectionError) |
| Placeholder injection via config value | Tampering | Placeholders expand to string tokens; shell:false means no shell metacharacter risk in argv |
| Circular alias as DoS vector | Denial of Service | Cycle detection at load time with CircularAliasError; never runs DFS without termination |
| Alias name shadowing system binary | Tampering | Documented (D-09 edge case); user must use array form to force inline command |
| Secrets leaked via verbose log | Information Disclosure | INT-05 redaction; Phase 3 must emit zero config values in its own output |

**Key security constraint from CLAUDE.md:** "Loci NON deve mai loggare i valori dei secrets in output di debug." — the resolver must never write any config value to stdout/stderr, even in non-secret positions, without explicit phase ownership of that output.

---

## Sources

### Primary (HIGH confidence)

- `src/types.ts` — All type contracts (CommandDef, CommandMap, ExecutionPlan, Resolver, CommandsLoader) verified by direct file read
- `src/errors.ts` — All error classes (CircularAliasError, UnknownAliasError, CommandSchemaError, UndefinedPlaceholderError) verified by direct file read
- `src/config/index.ts` — Phase 2 YAML loading pattern (readLayer, flattenToStrings, mergeLayers) verified by direct file read
- `.planning/phases/03-commands-resolver/03-CONTEXT.md` — All locked decisions (D-01 through D-14) verified by direct file read
- `.planning/REQUIREMENTS.md` — CMD-01 through CMD-09, INT-01 through INT-05 verified by direct file read
- `package.json` — yaml 2.8.3 exact pin verified; no new dependencies needed confirmed
- Node.js documentation (`process.platform` returns `'win32'` for Windows) — [VERIFIED: Node.js built-in knowledge, HIGH confidence]

### Secondary (MEDIUM confidence)

- CLAUDE.md §Constraints — security rules, cold-start budget, dependency minimization constraints
- CLAUDE.md §Technology Stack — stack choices and reasoning

### Tertiary (LOW confidence)

None — all claims verified against codebase or locked decisions.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified via package.json; no new dependencies
- Architecture: HIGH for interfaces (locked types), MEDIUM for file decomposition (Claude's discretion)
- Algorithms: HIGH — standard CS (DFS, regex, tokenizer); no novel techniques
- Pitfalls: HIGH — verified against locked decisions and established Phase 1/2 precedents
- Open questions: MEDIUM — gaps identified by type analysis; resolution deferred to planner

**Research date:** 2026-04-13
**Valid until:** 2026-06-01 (stable locked types; no external dependencies to rot)
