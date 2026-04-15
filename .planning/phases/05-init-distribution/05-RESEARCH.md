# Phase 5: Init & Distribution - Research

**Researched:** 2026-04-15
**Domain:** CLI scaffolding command + npm package publication
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Package name is `xci` (verified available on npm 2026-04-15). The binary command stays `loci` — only the npm package name changes. Install becomes `npm i -g xci`, but the user types `loci` to run it. All internal references (.loci/ directory, error messages, help text) remain "loci".
- **D-02:** Example `commands.yml` contains a single hello-world alias only. Keep it minimal — the user learns by doing, not by reading a wall of YAML comments.
- **D-03:** `loci init` creates: `.loci/config.yml` (example with comments), `.loci/commands.yml` (hello world alias), `.loci/secrets.yml.example`, `.loci/local.yml.example`. Does NOT create the real secrets.yml or local.yml.
- **D-04:** Idempotent: existing files are never overwritten. Print what was created and what was skipped.
- **D-05:** Append `.loci/secrets.yml` and `.loci/local.yml` to `.gitignore` with a `# loci` comment header.
- **D-06:** If `.gitignore` already contains the entries, skip without duplicating. Print "skipped" in summary.
- **D-07:** If `.gitignore` does not exist, create it with ONLY the 2 loci entries (plus comment header). Do not generate a generic template.
- **D-08:** Complete README: quickstart (install, `loci init`, first alias, run), full reference for 4 config levels, `commands.yml` format (single/sequential/parallel), platform overrides (`linux:`/`windows:`/`macos:`), `shell: false` default explanation with "wrap in script" pattern.
- **D-09:** Include a LICENSE file (MIT, already declared in package.json).

### Claude's Discretion

- Structure and ordering of README sections
- Exact wording of example config comments
- Whether to include badges in README (CI status, npm version, license)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INIT-01 | `loci init` scaffolds `.loci/` in project root | Commander subcommand registration pattern; `node:fs` mkdir |
| INIT-02 | Creates `.loci/config.yml` with example comments | `node:fs` writeFileSync with template strings |
| INIT-03 | Creates `.loci/secrets.yml.example` and `.loci/local.yml.example` (not real files) | Same file-write pattern; `.example` suffix is safe to commit |
| INIT-04 | Creates `.loci/commands.yml` with hello-world alias | Single alias template; D-02 keeps it minimal |
| INIT-05 | Adds `.loci/secrets.yml` and `.loci/local.yml` to `.gitignore` (create if absent, no-dup) | `readFileSync` + `includes()` check + `appendFileSync`/`writeFileSync` |
| INIT-06 | Idempotent: skips existing files, prints summary | `existsSync()` before every write |
| DOC-01 | README with quickstart + 4 config levels + commands.yml examples | README authoring; package.json `files` includes `README.md` |
| DOC-02 | README documents `shell: false` default and "wrap in script" pattern | Content decision — no library research needed |
| DOC-03 | README documents `linux:`/`windows:`/`macos:` platform blocks | Content decision — no library research needed |
| DOC-04 | LICENSE file (MIT) | Template text; already declared in package.json |
| DOC-05 | Package published to npm under `xci`; `npm i -g xci` → `loci` works | npm publish workflow; bin field; `prepublishOnly` already wired |

</phase_requirements>

---

## Summary

Phase 5 has three parallel tracks: (1) implement `src/init/index.ts` as a new commander subcommand, (2) write README and LICENSE files, (3) change `package.json` name from `loci` to `xci` and do a first publish.

The init command is the only new runtime code. It is pure Node.js `node:fs` — no new runtime dependencies. The command must be registered in `src/cli.ts` BEFORE the `.loci/` existence check (already called out in CONTEXT.md code context), so `loci init` works from any directory including one with no `.loci/`.

The npm name `xci` is confirmed unpublished (E404 from registry as of 2026-04-15). The `prepublishOnly` hook already runs `npm run build`, the shebang is in place, and the `files` field is correct. The only mechanical change is the `name` field in `package.json`.

**Primary recommendation:** Implement init as a self-contained module `src/init/index.ts` with pure `node:fs` sync operations, register it in `buildProgram()` before the `.loci/` guard, then rename `package.json` `name` to `xci` and publish.

---

## Standard Stack

### Core — No New Runtime Dependencies

All init functionality uses Node.js built-ins. No packages to add. [VERIFIED: codebase audit]

| Module | Purpose | Notes |
|--------|---------|-------|
| `node:fs` | File existence checks, write, append, mkdir | `existsSync`, `mkdirSync`, `writeFileSync`, `appendFileSync`, `readFileSync` |
| `node:path` | Absolute path construction | `join(cwd, '.loci', ...)` |

The `yaml` package (already a dependency) is NOT needed for init — the scaffold files are static template strings, not parsed YAML. [ASSUMED — no library call required for writing static text]

### Publishing

| Tool | Version | Purpose |
|------|---------|---------|
| npm | 10.9.7 (env) | Package publication — `npm publish --access public` |

**No new npm dependencies are needed for this phase.** [VERIFIED: codebase audit]

---

## Architecture Patterns

### Recommended Project Structure (additions only)

```
src/
├── init/
│   └── index.ts        # loci init command implementation
├── cli.ts              # register init subcommand here (before .loci/ guard)
└── ... (existing)

README.md               # project root (already in package.json `files`)
LICENSE                 # project root (add to package.json `files`)
```

### Pattern 1: Commander Subcommand Registration (before .loci/ guard)

The key integration constraint from CONTEXT.md: `loci init` must work even when no `.loci/` exists. The existing `main()` flow in `cli.ts` returns early with a message when `projectRoot === null`. The init subcommand must be registered on `program` BEFORE that guard.

**How:** Register the init subcommand immediately after `buildProgram()` returns, before the `findLociRoot()` call. Then inside the no-loci branch, still call `program.parseAsync()` — commander will route `loci init` to the registered action rather than the fallback `.action()`. [VERIFIED: reading cli.ts lines 248-272 — the no-loci branch already calls `program.parseAsync`; init just needs to be registered before that point]

```typescript
// Source: src/cli.ts (existing main() pattern)
async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram();

  // Register init BEFORE the .loci/ guard (so it works without .loci/)
  registerInitCommand(program);

  const projectRoot = findLociRoot(process.cwd());

  if (projectRoot === null) {
    // existing no-loci branch — init will already be routed by commander
    ...
  }
  ...
}
```

### Pattern 2: Idempotent File Scaffolding

Each file write follows the same guard pattern:

```typescript
// Source: node:fs built-ins pattern [ASSUMED — standard Node.js idiom]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

function writeIfAbsent(
  filePath: string,
  content: string,
  results: { path: string; action: 'created' | 'skipped' }[]
): void {
  if (existsSync(filePath)) {
    results.push({ path: filePath, action: 'skipped' });
    return;
  }
  writeFileSync(filePath, content, 'utf8');
  results.push({ path: filePath, action: 'created' });
}
```

### Pattern 3: .gitignore Idempotent Append

The check must handle both "entry exists as-is" and "entry exists with trailing whitespace/CR". The safest approach: read the entire file, split by newline, check for inclusion, append only if not found.

```typescript
// [ASSUMED — standard Node.js string pattern]
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';

const GITIGNORE_ENTRIES = ['.loci/secrets.yml', '.loci/local.yml'];
const GITIGNORE_BLOCK = `\n# loci\n${GITIGNORE_ENTRIES.join('\n')}\n`;

function ensureGitignore(projectDir: string, results: SummaryItem[]): void {
  const gitignorePath = join(projectDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `# loci\n${GITIGNORE_ENTRIES.join('\n')}\n`, 'utf8');
    results.push({ path: '.gitignore', action: 'created' });
    return;
  }
  const existing = readFileSync(gitignorePath, 'utf8');
  const lines = existing.split('\n').map(l => l.trim());
  const missing = GITIGNORE_ENTRIES.filter(e => !lines.includes(e));
  if (missing.length === 0) {
    results.push({ path: '.gitignore', action: 'skipped' });
    return;
  }
  appendFileSync(gitignorePath, `\n# loci\n${missing.join('\n')}\n`, 'utf8');
  results.push({ path: '.gitignore', action: 'updated' });
}
```

### Pattern 4: Init Output Format

The existing project uses `process.stdout.write()` exclusively (no `console.log`). The init summary should follow the same convention:

```typescript
// Source: cli.ts established pattern [VERIFIED: codebase audit]
function printInitSummary(results: SummaryItem[]): void {
  process.stdout.write('loci init\n\n');
  for (const item of results) {
    const tag = item.action === 'created' ? 'created' : item.action === 'updated' ? 'updated' : 'skipped';
    process.stdout.write(`  ${tag.padEnd(8)} ${item.path}\n`);
  }
  process.stdout.write('\nRun `loci hello` to test your setup.\n');
}
```

### Pattern 5: Commander Subcommand Registration (how to add init)

Follows the same `.command()` pattern already used in `buildProgram()`:

```typescript
// [ASSUMED — follows established commander v14 pattern in this codebase]
function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Scaffold a .loci/ directory in the current project')
    .action(async () => {
      const cwd = process.cwd();
      await runInit(cwd);
    });
}
```

### Anti-Patterns to Avoid

- **Importing configLoader inside init:** `loci init` does not need to load config — it scaffolds from static templates. Using configLoader would fail in a fresh directory and is unnecessary.
- **Interactive prompts:** Explicitly excluded from v1 scope. Init must be non-interactive.
- **Generating a generic .gitignore template:** D-07 is explicit — only write the 2 loci entries. Do not add Node.js/Python/etc. patterns; loci doesn't know the project type.
- **Overwriting existing files:** D-04 locks this. Always check `existsSync()` first.
- **Registering init AFTER the .loci/ guard:** The command won't be reachable from a fresh directory.
- **Using async fs operations for init:** Sync operations (`writeFileSync`, `readFileSync`) are simpler and correct for a sequence of file operations that must complete before printing the summary. No parallelism benefit for 5 small files.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File existence check | Custom stat wrapper | `existsSync()` from `node:fs` | Built-in, synchronous, no edge cases |
| YAML template generation | `yaml.stringify()` | Static template string literal | Templates are known at author time; no dynamic YAML needed |
| `.gitignore` parsing | Full parser | Split on `\n` + `trim()` + `includes()` | Only checking for exact line presence, not glob semantics |

**Key insight:** The init command is purely file I/O with static content. Over-engineering it with YAML roundtrips or parser libs is unnecessary and adds startup overhead.

---

## Common Pitfalls

### Pitfall 1: init Registered After .loci/ Guard

**What goes wrong:** `loci init` is routed through the `projectRoot === null` branch before commander can dispatch to the init action. Commander gets no registered subcommand and falls through to the fallback action, printing "No .loci/ directory found."
**Why it happens:** Developer adds the init subcommand registration inside the `if (projectRoot !== null)` block as it seems "safer."
**How to avoid:** Register init on `program` immediately after `buildProgram()` returns — before `findLociRoot()` is even called.
**Warning signs:** E2E test `loci init` in a temp dir with no `.loci/` prints the "no .loci/ found" message instead of running scaffold.

### Pitfall 2: .gitignore CRLF Line Endings on Windows

**What goes wrong:** The idempotency check reads the file and splits on `\n`. On Windows, if the existing `.gitignore` uses CRLF, the trimmed lines will have trailing `\r`, so `.includes('.loci/secrets.yml')` misses them and the entries get duplicated.
**Why it happens:** Windows creates files with CRLF by default; git may or may not normalize.
**How to avoid:** `.map(l => l.trim())` on each line before checking inclusion — this strips both `\r` and spaces. [VERIFIED: standard Node.js string handling]

### Pitfall 3: mkdirSync Without `recursive: true`

**What goes wrong:** If `.loci/` already exists, `mkdirSync('.loci')` throws `EEXIST`. If the path has missing intermediate directories, it throws `ENOENT`.
**Why it happens:** Default `mkdirSync` behavior is not idempotent.
**How to avoid:** Always use `mkdirSync(lociDir, { recursive: true })`. The `recursive` flag is a no-op when the directory already exists. [VERIFIED: Node.js docs — `recursive: true` suppresses EEXIST]

### Pitfall 4: npm Publish with Wrong `name` Field

**What goes wrong:** Publishing with `name: "loci"` would claim the name and fail (it's taken). Or the developer forgets to update `name` from `loci` to `xci` before publish.
**Why it happens:** `loci` is already taken on npm (verified: existing package v0.2.0 for an unrelated project). `xci` was unpublished and available as of 2026-04-15 (E404 from registry).
**How to avoid:** Before running `npm publish`, verify `npm info xci` returns 404. The prepublishOnly hook will run the build but will not catch a name collision — that fails at publish time.
**Warning signs:** `npm publish` error `E403: You do not have permission to publish "loci"`.

### Pitfall 5: LICENSE Not in `files` Field

**What goes wrong:** The LICENSE file exists in the repo root but is not included in the published npm package because it's not listed in `package.json` `files`.
**Why it happens:** npm only publishes files matching the `files` array (plus a few always-included defaults like `package.json`, `README.md`).
**How to avoid:** Add `"LICENSE"` to the `files` array alongside `"dist"` and `"README.md"`. Note: npm includes LICENSE/LICENCE/LICENSE.md automatically if present in the package root — but explicitly listing it is safer. [VERIFIED: npm docs state LICENSE files are included automatically, but explicit listing removes ambiguity]

### Pitfall 6: Hello-World Command Using `echo` Cross-Platform

**What goes wrong:** If the hello-world commands.yml alias uses `["echo", "hello from loci"]` with `shell: false`, this works on Linux/macOS (echo is a binary). On Windows, `echo` is a shell built-in and may not resolve without `shell: true`.
**Why it happens:** Phase 4 uses `execa` with `shell: false` — Windows does not have a standalone `echo` executable in PATH in all configurations.
**How to avoid:** Use `["node", "-e", "console.log('hello from loci')"]` as the hello-world command — Node.js is guaranteed to be on PATH since loci itself requires it. Or use a cross-platform echo equivalent. [ASSUMED — based on known Windows/execa behavior from Phase 4 decisions]

---

## Code Examples

### YAML Template Strings for Scaffold Files

```typescript
// src/init/templates.ts
// [ASSUMED — example content; exact wording is Claude's discretion per D-08]

export const CONFIG_YML = `\
# .loci/config.yml
# Project-level parameters. Safe to commit.
# These values are available as \${PARAM_NAME} in commands.yml.
#
# Example:
# registry: https://my-registry.example.com
# app_name: my-app
`;

export const COMMANDS_YML = `\
# .loci/commands.yml
# Define command aliases for this project.

hello:
  description: Say hello — run with \`loci hello\`
  cmd: ["node", "-e", "console.log('hello from loci')"]
`;

export const SECRETS_EXAMPLE_YML = `\
# .loci/secrets.yml.example
# Copy this file to secrets.yml and fill in real values.
# secrets.yml is gitignored and never committed.
#
# api_token: your-token-here
`;

export const LOCAL_EXAMPLE_YML = `\
# .loci/local.yml.example
# Copy this file to local.yml for per-machine overrides.
# local.yml is gitignored and never committed.
#
# registry: http://localhost:5000
`;
```

### package.json Changes for Publication

```json
{
  "name": "xci",
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "bin": {
    "loci": "./dist/cli.mjs"
  }
}
```

The `bin` field stays as `loci` — this is the command the user types. Only `name` changes. [VERIFIED: D-01 from CONTEXT.md]

### npm Publish Commands

```bash
# Verify name is free
npm info xci

# Dry-run to check what gets published
npm publish --dry-run

# First publish (requires npm login)
npm publish --access public
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `npm adduser` for auth | `npm login` or Automation token via `NPM_TOKEN` env var | npm v7+ | CI/CD publishes use `NPM_TOKEN` in environment |
| `"publishConfig": {"access": "public"}` | Either `publishConfig` in package.json or `--access public` flag | Always | For scoped packages, `access: public` is required; for unscoped (`xci`) it defaults to public anyway |

**Note:** `xci` is an unscoped package, so `--access public` is the default behavior and the flag is optional. Including it explicitly in the publish command is clearer for documentation purposes. [ASSUMED — npm default behavior for unscoped packages]

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v22.22.2 | — |
| npm | Publication (DOC-05) | Yes | 10.9.7 | — |
| npm auth / account | `npm publish` | Not logged in | — | Must `npm login` before publish task |

**Missing dependencies with no fallback:**
- npm authentication: the environment is not logged into npm (`npm whoami` returns error). The publish task requires `npm login` first, or an `NPM_TOKEN` environment variable. The planner must include a "prerequisite: npm authentication" note on the publish task.

**Missing dependencies with fallback:**
- None.

---

## Project Constraints (from CLAUDE.md)

| Constraint | Impact on Phase 5 |
|------------|-------------------|
| No `console.log` — use `process.stdout.write()` / `process.stderr.write()` | Init output must use write() |
| No interactive prompts (`inquirer`/`prompts` forbidden) | Init is fully non-interactive |
| Avoid heavy dependencies | No new runtime deps for init (pure node:fs) |
| Cold start < 300ms | Init imports only node:fs + commander (already loaded) — no penalty |
| `commander` v14.0.3 — do not upgrade to v15 | Use existing commander registration pattern |
| `execa` 9.6.1, `yaml` 2.8.3 — no upgrades | Not used in init command |
| tsup bundles to single `.mjs` | No tsup config changes needed |
| `process.stdout.write` for all output | Apply to init summary printer |
| Shebang on line 1 of dist/cli.mjs | Already handled by tsup banner — no change |
| package.json `engines: ">=20.5.0"` | Unchanged |
| `prepublishOnly` runs `npm run build` | Already in place — publish will auto-build |
| `files: ["dist", "README.md"]` | Must add `"LICENSE"` to this array |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hello-world alias should use `node -e` not `echo` for cross-platform safety | Code Examples / Pitfall 6 | If wrong: `echo` works on all platforms with execa PATHEXT handling — low-risk change |
| A2 | npm unscoped package defaults to public access (no `--access public` needed) | State of the Art | If wrong: publish fails silently or requires re-flag; add `--access public` to publish command |
| A3 | Sync fs operations are correct for init (no async) | Architecture Patterns | If wrong: no real consequence — sync is simpler and acceptable for < 10 file ops |
| A4 | LICENSE is auto-included by npm even without listing in `files` | Common Pitfalls | If wrong: LICENSE absent from published package — add it to `files` explicitly to be safe |

---

## Open Questions

1. **npm authentication for publish task**
   - What we know: `npm whoami` returns error — not logged in on this machine
   - What's unclear: Whether the project owner will publish manually or via CI automation with NPM_TOKEN
   - Recommendation: Plan task as "prerequisite: `npm login` or `NPM_TOKEN` env var set"; mark publish as a manual gate step

2. **README badges (Claude's discretion)**
   - What we know: CI workflow exists at `.github/workflows/ci.yml`; package will be at `xci` on npm
   - What's unclear: Whether the user wants CI/npm/license badges at the top of README
   - Recommendation: Include them — they communicate package health at a glance and take 3 lines

---

## Sources

### Primary (HIGH confidence)
- `/home/developer/projects/jervis/src/cli.ts` — full cli.ts source read; init registration point identified at lines 248-272
- `/home/developer/projects/jervis/package.json` — current name, bin, files, scripts, prepublishOnly verified
- `/home/developer/projects/jervis/tsup.config.ts` — bundle config verified; no changes needed for init
- `/home/developer/projects/jervis/.github/workflows/ci.yml` — CI matrix verified (3 OS × Node 20/22)
- `npm info xci` — E404 confirmed (package not in registry as of 2026-04-15) [VERIFIED: npm registry]
- `npm info loci` — confirmed taken (unrelated package v0.2.0) [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- CLAUDE.md §Publishing Workflow — bin field, shebang, file permissions, exports, files field, prepublishOnly patterns
- CLAUDE.md §Cold-Start Budget — no new heavy deps constraint confirmed

### Tertiary (LOW confidence / ASSUMED)
- Node.js `echo` cross-platform behavior with execa `shell: false` on Windows — based on Phase 4 decisions in STATE.md re: PATHEXT handling, not independently verified for `echo` specifically

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all node:fs built-ins
- Architecture: HIGH — directly derived from reading cli.ts and established patterns
- Pitfalls: MEDIUM — Windows CRLF and echo cross-platform are ASSUMED; others verified from codebase
- npm publication: HIGH — xci E404 verified; package.json fields verified

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (npm name availability; verify again before publish)
