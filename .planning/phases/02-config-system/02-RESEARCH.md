# Phase 2: Config System - Research

**Researched:** 2026-04-13
**Domain:** YAML config loading, 4-layer merge, secrets safety, error handling
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: Nested YAML with dot-flatten.** Config files use nested YAML structure. The loader recursively flattens all nested objects into dot-separated keys before merge. Users write natural YAML; the system operates on flat `Record<string, string>`.
- **D-02: Leaf-level merge.** Each leaf key is independent in the merge. If `project` defines `deploy.host` and `deploy.user`, and `local` overrides only `deploy.host`, `deploy.user` is preserved from `project`. "Flatten first, merge second" — not object-level replacement.
- **D-03: Strings only.** `ConfigValue = string`. No arrays, no numbers, no booleans as native types.
- **D-04: Non-string leaf = error.** If a nested value resolves to a non-string leaf (e.g., an array `[8080, 443]`), the loader throws `YamlParseError` with the full dot-notation path and the actual type found: `"deploy.ports: expected string, got array"`.
- **D-05: Check at load time, warning only.** When `secrets.yml` exists and is loaded, the loader runs `git ls-files --error-unmatch .loci/secrets.yml` synchronously. If tracked: emit a warning to stderr with remediation hint. Does NOT block execution.
- **D-06: File + line + message.** YAML parse errors show filename, line number, column number, and parser's error message. Map to `YamlParseError` with `suggestion` field.
- **D-07: Empty file = empty config.** A file that exists but is empty is treated as empty config layer (`{}`). No error, no warning.
- **D-08: Missing files are normal.** If any of the 4 config files doesn't exist, that layer is silently skipped. No error.

### Claude's Discretion

- Internal architecture of the loader (single function vs class vs pipeline of transforms) — as long as it implements `ConfigLoader` from `types.ts`.
- Whether the flatten function is a separate exported utility or an internal helper.
- Test file organization within `src/config/__tests__/`.
- Whether to use `child_process.execSync` or `execa` for the `git ls-files` check.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CFG-01 | Machine config via `LOCI_MACHINE_CONFIG` env var (absolute path) | `process.env.LOCI_MACHINE_CONFIG`; ENOENT = silently skip |
| CFG-02 | `.loci/config.yml` in project root (project layer) | `path.join(cwd, '.loci/config.yml')`; ENOENT = silently skip |
| CFG-03 | `.loci/secrets.yml` in project root (secrets layer) | Load + tag provenance as `'secrets'`; run git check after loading |
| CFG-04 | `.loci/local.yml` in project root (local layer) | `path.join(cwd, '.loci/local.yml')`; ENOENT = silently skip |
| CFG-05 | Merge order: `machine → project → secrets → local` (last wins) | Flat merge with `Object.assign` or spread; leaf-level precedence |
| CFG-06 | Provenance tracking per key (which layer provided the final value) | `provenance: Record<string, ConfigLayer>` updated during merge |
| CFG-07 | Explicit error for malformed YAML with filename + line number | `YAMLParseError.linePos[0].line` from `yaml` package; wrap in `YamlParseError` |
| CFG-08 | Missing files do not crash | `try/catch` around `fs.readFileSync` with `ENOENT` check; skip layer |
| CFG-09 | Warn (not error) if `secrets.yml` is git-tracked | `execSync('git ls-files --error-unmatch ...')` exit 0 = tracked; stderr warning |
| CFG-10 | YAML 1.2 semantics: no boolean coercion for yes/no/on/off | `yaml` 2.8.3 default `parse()` — `yes`/`no` parse as strings [VERIFIED: tested in session] |
</phase_requirements>

## Summary

Phase 2 implements the 4-layer YAML config loader (`src/config/index.ts`), replacing the existing `NotImplementedError` stub. The loader reads up to 4 YAML files, flattens nested keys to dot-notation, merges them with deterministic `machine → project → secrets → local` precedence, and tracks per-key provenance and secrets membership. Safety guards include explicit YAML parse errors with line numbers and a non-blocking warning when `secrets.yml` is accidentally git-tracked.

The `yaml` 2.8.3 package (already installed) handles YAML 1.2 semantics correctly for `yes`/`no`/`on`/`off` (parsed as strings). However, **unquoted integers like `0123` and bare numbers like `123` still parse as JavaScript number type**, meaning the D-04 non-string check will catch them as errors — the user will need to quote numeric values. This behavior is correct per the requirements.

The `MissingConfigError` class referenced in CONTEXT.md's canonical refs is NOT present in `src/errors.ts`. Missing files are handled silently per D-08, so `ConfigReadError` (for actual read failures, e.g. permission denied) and `YamlParseError` (for malformed content) are the only error classes Phase 2 throws. `MissingConfigError` is not needed.

**Primary recommendation:** Implement a single async `load()` function with three internal helpers: `readLayer()` (read + parse one YAML file), `flattenToStrings()` (recursive dot-flattening with type-checking), and `checkSecretsTracked()` (sync git check). Merge 4 flat layers in order, tracking provenance per key.

## Standard Stack

### Core (all already installed — no new dependencies needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yaml` | 2.8.3 | YAML 1.2 parsing | Already pinned. `yes`/`no` parse as strings [VERIFIED: session test]. `YAMLParseError.linePos[0].line` gives line number [VERIFIED: session test]. |
| `node:fs` | built-in | Synchronous file reading | `readFileSync` + ENOENT detection. No extra dep needed. |
| `node:path` | built-in | Cross-platform path joining | `path.join(cwd, '.loci/config.yml')` handles Windows backslash correctly. |
| `node:child_process` | built-in | Git tracking check | `execSync('git ls-files --error-unmatch ...')` — simpler than async execa for a sync boolean check. |

### What NOT to add

No new runtime dependencies. All needed capabilities are covered by the existing stack.

**Installation:** No new packages needed. All dependencies are installed.

## Architecture Patterns

### Recommended Project Structure

```
src/config/
├── index.ts             # ConfigLoader implementation (entry point — replaces stub)
└── __tests__/
    └── loader.test.ts   # Unit tests for the loader
```

The flatten utility and git check can be internal helpers within `index.ts` or split into sibling files (`flatten.ts`, `git-check.ts`) — planner's discretion per CONTEXT.md.

### Pattern 1: Layer Loading Pipeline

**What:** Each of the 4 config sources is read and parsed independently, producing a `{ values: Record<string, string>, layer: ConfigLayer }` tuple. Missing files yield an empty tuple. Errors throw immediately.

**When to use:** Always — this is the required architecture.

```typescript
// Source: types.ts contract + decisions from CONTEXT.md
async function readLayer(
  filePath: string | undefined,
  layer: ConfigLayer
): Promise<{ values: Record<string, string>; layer: ConfigLayer } | null> {
  if (!filePath) return null;
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err: unknown) {
    if (isEnoent(err)) return null;          // D-08: missing = skip silently
    throw new ConfigReadError(filePath, err); // Permission denied etc.
  }
  const parsed = parse(raw);                  // yaml.parse — YAML 1.2
  if (parsed === null) return { values: {}, layer }; // D-07: empty = {}
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new YamlParseError(filePath, undefined, new Error('Root must be a mapping'));
  }
  const values = flattenToStrings(parsed as Record<string, unknown>, filePath);
  return { values, layer };
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
```

### Pattern 2: Recursive Dot-Flattening with Type Enforcement

**What:** Recursively walk the parsed YAML object, building dot-prefixed key paths. At each leaf node, assert the value is a `string`. Non-string leaves (numbers, booleans, arrays, nested objects at leaf position) throw `YamlParseError`.

**Key pitfall:** A YAML key that itself contains a dot (e.g., `"some.key": value` as a quoted key) will produce the same flattened key as a nested path `some: { key: value }` — creating a collision. The loader should detect this and throw.

```typescript
// Source: decisions D-01, D-04 from CONTEXT.md
function flattenToStrings(
  obj: Record<string, unknown>,
  filePath: string,
  prefix = ''
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result[fullKey] = value;
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      // Recurse into nested objects
      const nested = flattenToStrings(
        value as Record<string, unknown>,
        filePath,
        fullKey
      );
      for (const [k, v] of Object.entries(nested)) {
        result[k] = v;
      }
    } else {
      // D-04: non-string leaf (number, boolean, array, null)
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      throw new YamlParseError(
        filePath,
        undefined,
        new Error(`${fullKey}: expected string, got ${actualType}`)
      );
    }
  }
  return result;
}
```

### Pattern 3: Deterministic Merge with Provenance

**What:** Iterate the 4 layers in order (machine, project, secrets, local). For each key in each layer, write the value and record the layer name in provenance. Later layers overwrite earlier ones — this is the "last wins" semantics.

```typescript
// Source: types.ts ResolvedConfig + CFG-05, CFG-06
function mergeLayers(
  layers: ReadonlyArray<{ values: Record<string, string>; layer: ConfigLayer } | null>
): ResolvedConfig {
  const values: Record<string, string> = {};
  const provenance: Record<string, ConfigLayer> = {};
  const secretKeys = new Set<string>();

  for (const entry of layers) {
    if (!entry) continue;
    for (const [key, value] of Object.entries(entry.values)) {
      values[key] = value;
      provenance[key] = entry.layer;
      if (entry.layer === 'secrets') secretKeys.add(key);
    }
  }

  // A key initially in secrets but overridden by local: remove from secretKeys
  // Per CFG-06 + INT-05: secretKeys tracks keys whose FINAL value is from secrets
  // If provenance[key] !== 'secrets', it was overridden — remove from set
  for (const key of secretKeys) {
    if (provenance[key] !== 'secrets') secretKeys.delete(key);
  }

  return {
    values: Object.freeze(values),
    provenance: Object.freeze(provenance),
    secretKeys: Object.freeze(secretKeys),
  };
}
```

**Note on secretKeys semantics:** The CONTEXT.md says `secretKeys` is "keys from `secrets.yml`." There are two valid interpretations: (a) any key that was ever defined in `secrets.yml`, or (b) only keys whose *final* value came from `secrets.yml`. Interpretation (b) is safer — if `local.yml` overrides a secret, the local override is no longer secret-tagged, which prevents false redaction of non-secret values. This is a discretion-area decision for the planner to codify.

### Pattern 4: Git Tracking Check

**What:** Use `execSync` (synchronous) to run `git ls-files --error-unmatch <path>`. Exit code 0 = tracked (bad), exit code 1 = not tracked (good), exit code 128 = not a git repo (skip silently per D-05).

```typescript
// Source: decision D-05 from CONTEXT.md + verified git behavior in session
function isSecretTrackedByGit(secretsPath: string, cwd: string): boolean {
  try {
    execSync(`git ls-files --error-unmatch ${secretsPath}`, {
      stdio: 'pipe',
      cwd,
    });
    return true; // exit 0 = file IS tracked
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 128) return false; // not a git repo — skip silently
    return false;                     // exit 1 = not tracked — good
  }
}
```

**Call site:** After `readLayer()` succeeds for `secrets.yml`, call this check. If returns `true`, write to `process.stderr` with `SecretsTrackedError` message content (but do NOT throw — non-blocking per D-05).

### Anti-Patterns to Avoid

- **Throwing on missing files:** D-08 is explicit — missing files are silently skipped. Only throw `ConfigReadError` for non-ENOENT errors (e.g., `EACCES`).
- **Silently stringifying non-string values:** D-04 requires an explicit error, not `String(value)` coercion.
- **Logging secret values in errors:** The `flattenToStrings` error message includes the key path and type, but never the value. Maintains the `ShellInjectionError` precedent from Phase 1.
- **Async git check:** `execSync` is cleaner here. The `git ls-files` check is a fast O(1) index lookup — no need for async overhead.
- **Blocking on secrets warning:** D-05 says "non blocca" — write to stderr and continue. Do not throw `SecretsTrackedError` (it exists for use in error display contexts, not as a thrown exception here).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom parser | `yaml` 2.8.3 | Full YAML 1.2 spec, precise `linePos` in errors, correct boolean semantics |
| YAML 1.2 boolean semantics | Manual `yes`/`no` substitution | `yaml` default parse mode | `yaml` already handles this correctly [VERIFIED: session test] |
| Line number extraction from parse errors | Manual string scanning | `YAMLParseError.linePos[0].line` | The `yaml` package provides this in the caught error object |
| Cross-platform path join | String concatenation | `node:path.join()` | Windows uses backslash; `path.join` handles it |

**Key insight:** The hard parts of this phase (YAML 1.2 semantics, parse error line numbers) are already solved by the `yaml` package. The Phase 2 work is wiring and policy (merge order, provenance, type enforcement), not parsing.

## Common Pitfalls

### Pitfall 1: `0123` and bare numbers parse as JavaScript integers, not strings

**What goes wrong:** A user writes `port: 8080` or `version: 0123` in a config file. The `yaml` package (correctly per YAML 1.2) parses these as `number` type, not `string`. The D-04 check then throws `YamlParseError` with `port: expected string, got number`.

**Why it happens:** YAML 1.2 has integer and float scalar types. Unquoted numeric values like `8080` or `0123` are parsed as integers. Note: in YAML 1.2, `0123` is decimal `123` (NOT octal 83 as in YAML 1.1) — so CFG-10's "no octal interpretation" is satisfied by the `yaml` package [VERIFIED: session test shows `0123` → `123`, not `83`].

**How to avoid:** Users must quote numeric values: `port: "8080"`. Document this requirement clearly. The error message from D-04 should be clear: `"port: expected string, got number — wrap numeric values in quotes"`.

**Warning signs:** `YamlParseError` thrown for keys the user didn't expect to be invalid. The suggestion field on `YamlParseError` can include the quoting hint.

### Pitfall 2: Root-level non-mapping YAML document

**What goes wrong:** A YAML file contains a valid YAML document whose root is not a mapping (e.g., a bare string `just text`, a list `- item`, or a number `42`). The `yaml.parse()` call succeeds but returns a non-object value, which then crashes the `Object.entries()` call in `flattenToStrings`.

**Why it happens:** YAML allows any scalar or sequence as the root document. The loader assumes root is always a mapping.

**How to avoid:** After `yaml.parse()`, check if result is `null` (empty = D-07), then check `typeof result === 'object' && !Array.isArray(result)`. If not, throw `YamlParseError` with a clear message.

### Pitfall 3: Dot-key collision in flatten

**What goes wrong:** A YAML file has a quoted key containing a dot: `"some.key": value`. After flattening, this produces the key `some.key` — identical to what `some: { key: value }` would produce. If both forms exist in the same file, or in different layers, the merge is ambiguous.

**Why it happens:** The dot-flatten algorithm cannot distinguish "key with dot in name" from "nested path resolving to same dot-notation".

**How to avoid:** Detect this at flatten time: if a key being inserted already exists in `result` via a different nesting path, it's a collision. Throw `YamlParseError` with a message explaining the collision. Alternatively, prohibit dots in YAML key names entirely (simpler rule). The planner should codify this edge case.

### Pitfall 4: `secretKeys` semantics when local overrides a secret

**What goes wrong:** `secrets.yml` defines `api.token: s3cr3t`. `local.yml` overrides `api.token: test-value`. After merge, `provenance['api.token'] === 'local'`. If `secretKeys` was built naively by "add all secrets-layer keys without checking provenance after merge," `api.token` is still in `secretKeys` — and the local non-secret override gets redacted.

**Why it happens:** Building `secretKeys` before the final provenance is determined.

**How to avoid:** Build `secretKeys` in a post-merge pass: iterate the final `provenance` map and add keys to `secretKeys` only if `provenance[key] === 'secrets'`. See Pattern 3 above.

### Pitfall 5: `execSync` throws when git is not installed

**What goes wrong:** On a system without git, `execSync('git ls-files ...')` throws an error with `code: 'ENOENT'` or similar (command not found), not status 128. The catch block must handle this.

**Why it happens:** The check assumes `git` is on PATH.

**How to avoid:** In the catch block, check `(err as {code?: string}).code === 'ENOENT'` in addition to `status === 128`. Both mean "can't determine if tracked" → skip silently.

### Pitfall 6: Path argument to git ls-files must be relative to cwd

**What goes wrong:** Passing an absolute path to `git ls-files --error-unmatch` when running in a git repo where the file is tracked via relative path. Git's index stores relative paths — if you pass an absolute path that is outside the worktree, git exits 128 even if the file is tracked.

**Why it happens:** `secretsPath` may be absolute (constructed via `path.join(cwd, '.loci/secrets.yml')`).

**How to avoid:** Pass the relative path `.loci/secrets.yml` to `git ls-files`, not the absolute path. Run with `cwd` set to the project root.

## Code Examples

Verified patterns from project source and session tests:

### Full loader entry point signature

```typescript
// Source: src/types.ts ConfigLoader interface
export const configLoader: ConfigLoader = {
  async load(cwd: string): Promise<ResolvedConfig> {
    const machinePath = process.env['LOCI_MACHINE_CONFIG'];
    const projectPath = path.join(cwd, '.loci', 'config.yml');
    const secretsPath = path.join(cwd, '.loci', 'secrets.yml');
    const localPath   = path.join(cwd, '.loci', 'local.yml');

    const layers = await Promise.all([
      readLayer(machinePath, 'machine'),
      readLayer(projectPath, 'project'),
      readLayer(secretsPath, 'secrets'),
      readLayer(localPath, 'local'),
    ]);

    // Secrets tracking check — after loading, before merge
    const secretsLayer = layers[2];
    if (secretsLayer !== null) {
      if (isSecretTrackedByGit('.loci/secrets.yml', cwd)) {
        process.stderr.write(
          `[loci] WARNING: .loci/secrets.yml is tracked by git. ` +
          `Run: git rm --cached .loci/secrets.yml\n`
        );
      }
    }

    return mergeLayers(layers);
  },
};
```

### Extracting line number from yaml YAMLParseError

```typescript
// Source: session test — yaml package YAMLParseError has linePos[0].line
import { parse, YAMLParseError as YamlLibError } from 'yaml';
import { YamlParseError } from '../errors.js';

try {
  parse(raw);
} catch (err) {
  if (err instanceof YamlLibError) {
    const line = err.linePos?.[0]?.line;
    throw new YamlParseError(filePath, line, err);
  }
  throw err; // unexpected non-YAML error
}
```

### Test helper: create temp .loci directory

```typescript
// Source: vitest + node:fs/promises pattern
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setupFixture(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'loci-test-'));
  await mkdir(join(cwd, '.loci'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(cwd, '.loci', name), content, 'utf8');
  }
  return cwd;
}

// Teardown: await rm(cwd, { recursive: true })
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| js-yaml (YAML 1.1: `yes` → `true`) | `yaml` 2.8.3 (YAML 1.2: `yes` → `"yes"`) | CFG-10 satisfied automatically |
| Manual line number parsing from error message strings | `YAMLParseError.linePos[0].line` from `yaml` package | Structured, not fragile string parsing |

**Deprecated/outdated:**
- `js-yaml`: Uses YAML 1.1 semantics. `yes`, `on`, `no`, `off` parse as booleans. Not suitable for this project. (Covered by CLAUDE.md §What NOT to Use.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `secretKeys` should track keys where the *final* provenance is `'secrets'` (not "any key ever seen in secrets.yml") | Architecture Patterns (Pattern 3) | Phase 3 redaction may incorrectly redact local-overridden values, or fail to redact true secrets |
| A2 | Dots in YAML key names cause a collision with dot-notation path and should be an error | Common Pitfalls (Pitfall 3) | Ambiguous behavior if user happens to use quoted-dot keys alongside nested structure |
| A3 | `readFileSync` (sync) is acceptable for file reading since `load()` is already async and file I/O on config files is fast (< 1ms) | Architecture Patterns (Pattern 1) | Negligible; could use `fs.promises.readFile` for fully async pipeline if preferred |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (3 assumptions require planner decision.)

## Open Questions

1. **`secretKeys` semantics: "ever in secrets" vs "final value from secrets"**
   - What we know: CONTEXT.md says "keys from `secrets.yml`" without specifying whether this means final-provenance or ever-present
   - What's unclear: If `local.yml` overrides a secret, is the local value secret-tagged?
   - Recommendation: Use final-provenance (safer: avoids redacting non-secret values). Planner should codify this as a decision.

2. **Dot-key collision handling**
   - What we know: YAML allows quoted keys containing dots; dot-flattening creates ambiguous keys
   - What's unclear: Whether to (a) error on detection, (b) silently allow last-writer-wins, or (c) prohibit dots in YAML key names
   - Recommendation: Error on collision with clear message. This edge case is uncommon but could cause confusing behavior if silently allowed.

3. **`MissingConfigError` discrepancy**
   - What we know: CONTEXT.md canonical refs mention `MissingConfigError` as "already declared in errors.ts" but it is NOT present [VERIFIED: grep confirms absence]
   - What's unclear: Whether this was a documentation error or a planned future addition
   - Recommendation: Do not add `MissingConfigError`. Per D-08, missing files are silently skipped — no error class needed. `ConfigReadError` covers non-ENOENT failures.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `yaml` npm package | CFG-07, CFG-10 | Yes | 2.8.3 (pinned) | None — required |
| `node:fs` | CFG-01 through CFG-08 | Yes | Node 20+ built-in | N/A |
| `node:path` | CFG-01 through CFG-04 | Yes | Node 20+ built-in | N/A |
| `node:child_process` (`execSync`) | CFG-09 | Yes | Node 20+ built-in | Skip check if git absent |
| `git` CLI | CFG-09 | Yes | (project uses git) | Exit 128 or ENOENT = skip check silently |

**Missing dependencies with no fallback:** None — all required tools are available.

**Missing dependencies with fallback:**
- If `git` is not installed: `execSync` throws with `ENOENT` → catch block returns `false` → secrets check is silently skipped. Documented in Pitfall 5.

## Sources

### Primary (HIGH confidence)
- `src/types.ts` — `ConfigLoader`, `ResolvedConfig`, `ConfigValue`, `ConfigLayer` contracts [VERIFIED: Read tool]
- `src/errors.ts` — `YamlParseError`, `ConfigReadError`, `SecretsTrackedError` error classes [VERIFIED: Read tool]
- `src/config/index.ts` — Phase 2 stub to replace [VERIFIED: Read tool]
- `yaml` 2.8.3 package installed — `parse()`, `YAMLParseError`, `YAMLError` exports [VERIFIED: node -e session tests]
- YAML 1.2 semantics for `yes`/`no`/`on`/`off` [VERIFIED: `parse('foo: yes')` → `{foo: 'yes'}` in session]
- YAML 1.2 integer parsing for `0123` → `123` (not octal 83) [VERIFIED: session test]
- `YAMLParseError.linePos[0].line` structure [VERIFIED: session test with malformed YAML]
- `git ls-files --error-unmatch` exit codes (0=tracked, 1=not-tracked, 128=not-git-repo) [VERIFIED: session bash tests]
- `.planning/phases/02-config-system/02-CONTEXT.md` — all locked decisions D-01 through D-08

### Secondary (MEDIUM confidence)
- `vitest.config.ts` — test pattern: `src/**/__tests__/**/*.test.ts` [VERIFIED: Read tool]
- `tsconfig.json` — `verbatimModuleSyntax: true` requiring `.js` suffix on imports [VERIFIED: Read tool]
- `package.json` — `test: vitest run`, ESM-only (`type: module`) [VERIFIED: Read tool]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified as installed, APIs tested in session
- Architecture: HIGH — contracts from Phase 1 fully specified, decisions locked in CONTEXT.md
- Pitfalls: HIGH for items verified in session; MEDIUM for dot-collision (logic reasoning)

**Research date:** 2026-04-13
**Valid until:** 2026-07-13 (stable libraries; yaml 2.x API is stable)
