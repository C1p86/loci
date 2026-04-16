# Stack Research

**Domain:** Cross-platform Node.js CLI tool (global npm install, YAML config, command runner)
**Researched:** 2026-04-10
**Confidence:** HIGH (all versions verified via official GitHub repos and release pages)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x (Active LTS) | Runtime | v22 is current Active LTS (maintenance through Apr 2027). v24 just entered Active LTS but ecosystem adoption lags. Target `engines: ">=20.5.0"` to cover v20/v22/v24. |
| TypeScript | 5.x (latest) | Language | Type-safety for config shape, placeholder resolution, and command tree. All YAML parser and CLI libraries have first-class TS support. |
| commander.js | 14.0.3 | CLI argument parsing | User has pre-selected this. v14 requires Node >=20, is stable CJS+ESM, receives security fixes until May 2027. v15 (pre-release) drops CJS — do NOT upgrade to v15 yet. |
| execa | 9.6.1 | Child-process execution | ESM-only since v6. Best cross-platform Windows support: handles shebangs, PATHEXT, graceful termination. Promise-based, streams stdout/stderr in real-time, propagates exit codes cleanly. Requires Node `^18.19.0 \|\| >=20.5.0` — matches our target. |
| yaml | 2.8.3 | YAML parsing | Full YAML 1.1 + 1.2 spec, passes yaml-test-suite, TypeScript support built-in (min TS 5.9). Ships with correct YAML 1.2 boolean semantics (`yes`/`no` are strings, not booleans — avoids a major footgun in js-yaml 4.x). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/node | latest | Node.js type definitions | Always — needed for `process`, `fs`, `path` types |
| tsup | 8.5.1 | Build/bundle TypeScript → ESM output | Single-pass build: TypeScript → bundled ESM `.mjs`, generates `.d.ts`. Zero-config for CLIs. |
| vitest | 4.1.4 | Testing | Native ESM + TypeScript, no transform config needed. Node.js environment mode, no browser overhead. |
| @biomejs/biome | 2.x (latest stable) | Lint + format | Single Rust binary, zero npm transitive deps, 97% Prettier-compatible, type-aware lint in v2. Perfect for greenfield. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsup | Build tool | Config: single `tsup.config.ts`, outputs `dist/cli.mjs` + `dist/cli.d.ts`. Set `noExternal: []` to bundle all deps into a single file for minimal cold-start overhead. |
| biome | Lint + format | `npx @biomejs/biome init` generates `biome.json`. No `.eslintrc`, no `.prettierrc`. One config file. |
| vitest | Test runner | `vitest.config.ts` with `environment: 'node'`. Run with `vitest --run` in CI. |

---

## Installation

```bash
# Runtime deps (bundled into output by tsup, but declared as dependencies for npm install fallback)
npm install commander yaml execa

# Dev dependencies
npm install -D typescript tsup vitest @types/node @biomejs/biome
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not / When Alternative Applies |
|-------------|-------------|-------------------------------------|
| yaml (eemeli) | js-yaml 4.1.1 | js-yaml uses YAML 1.1 semantics by default (e.g. `yes`/`on` parse as boolean `true`), causing unexpected behavior when reading user config files. `yaml` supports YAML 1.2 (fixed semantics) out of the box. js-yaml has 180M+ weekly downloads (wider ecosystem) but for a new project the stricter parsing of `yaml` is safer. Use js-yaml only if you need drop-in replacement for an existing codebase already using it. |
| execa | cross-spawn | cross-spawn is a drop-in for Node's `child_process.spawn` — you wire everything manually (streams, exit codes, promise handling). execa gives all that for free, plus verified Windows PATHEXT/shebang handling. Use cross-spawn only if you need zero-overhead and are writing your own process abstraction layer. |
| execa | zx | zx is a scripting tool — it launches a shell (bash/sh/PowerShell depending on OS) and runs the entire command string through it. This means shell quoting, shell-specific behavior, and different behavior on Windows. `loci` must interpolate `${VAR}` before spawn and guarantee consistent exit codes; using zx adds a shell indirection layer and a much larger dependency surface. Not appropriate for a programmatic command runner. |
| tsup | plain tsc | `tsc` compiles file-by-file with no bundling. For a CLI with several source files, unbundled output means Node.js must resolve and load multiple files on startup — measurable cold-start penalty. tsup bundles to a single `.mjs` file, reducing disk reads on startup. |
| tsup | rollup | Rollup is more configurable but requires significant plugin setup for TypeScript CLIs. tsup wraps esbuild (fastest transform) with sensible defaults. No advantage for a CLI tool. |
| vitest | jest | Jest requires `ts-jest` or `babel-jest` transform to handle TypeScript + ESM — extra config, slower. Vitest understands TypeScript natively. For a new ESM project there is no reason to choose Jest. Use Jest only on projects that already have a large Jest test suite or use React Native. |
| vitest | node:test | node:test (built-in) lacks watch mode, snapshot testing, rich matchers, and structured coverage. Viable for simple utilities but insufficient for a tool with parallel execution logic, YAML parsing edge cases, and cross-platform behavior tests. |
| biome | eslint + prettier | eslint + prettier requires 4+ config files, 127+ npm packages, and plugin coordination. Biome v2 covers TypeScript type-aware rules without needing the TypeScript compiler at lint time, and formats at 20-25x Prettier's speed. For a greenfield project there is no reason to use eslint+prettier. Use eslint only if you need niche community plugins (Vue, Angular, custom AST transforms) not yet in Biome. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| commander v15 (pre-release) | ESM-only, requires Node >=22.12.0, breaks CJS consumers still on older tooling. Not yet stable. | commander 14.0.3 |
| shelljs | Last meaningfully updated 2019, has known Windows incompatibilities, uses synchronous `exec` under the hood (blocks event loop), not maintained for modern ESM. | execa |
| cross-env | Sets env vars for scripts — that is not what loci does. loci reads env vars (`LOCI_MACHINE_CONFIG`) from `process.env` directly; no helper lib needed. | `process.env` directly |
| dotenv | loci does not use `.env` files — it reads `.yml` files. Loading YAML with `yaml` covers the use case. dotenv adds a dependency solving a different problem. | `fs.readFileSync` + `yaml.parse` |
| yamljs | Unmaintained (last release 2016), fails on many valid YAML documents, no YAML 1.2 support. | yaml or js-yaml |
| pkg / nexe | Compiles Node.js binary — the project explicitly targets developers who already have Node installed. Adds significant build complexity for no benefit. | Standard `npm i -g` |
| zx | Launches a shell process (bash/powershell), so shell-specific quoting rules apply. For a cross-platform command runner where `loci` must control the exact argument list before spawn, zx's shell intermediary is a liability. | execa |
| inquirer / prompts | Interactive prompts — not in scope for loci v1. Would add startup overhead for a non-interactive tool. | N/A |

---

## Publishing Workflow (2025 Gotchas)

### ESM vs CJS decision for loci

Because loci is a **standalone CLI tool** (not a library consumed by other packages), publish as **ESM-only**. Anthony Fu's guidance applies: for CLI tools, end-users don't care about the module format, and ESM-only simplifies the build. commander 14 supports ESM consumers; execa requires ESM; yaml supports ESM.

Set `"type": "module"` in `package.json`.

### bin field + shebang

The shebang line must be the **first line** of the compiled output file:

```
#!/usr/bin/env node
```

tsup supports injecting shebangs via the `banner` option in `tsup.config.ts`:

```ts
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
});
```

Point `bin` in `package.json` to the compiled file:

```json
{
  "bin": { "loci": "./dist/cli.mjs" },
  "type": "module"
}
```

After publishing, `npm i -g loci` will symlink `loci` → `dist/cli.mjs` and the shebang makes it directly executable on Unix. On Windows, npm creates a `.cmd` wrapper automatically — no extra steps needed.

### File permissions on Unix

Make `dist/cli.mjs` executable before publish. Add to `package.json` scripts:

```json
"build": "tsup && chmod +x dist/cli.mjs"
```

Or use `shx` (`npm i -D shx`) for a cross-platform `chmod`:

```json
"build": "tsup && shx chmod +x dist/cli.mjs"
```

### package.json exports

For a CLI-only package (no library API surface), `exports` is optional. The `bin` field alone is sufficient. If you later expose a programmatic API, add:

```json
"exports": {
  ".": "./dist/index.mjs"
}
```

### files field

Always declare `files` to avoid shipping `src/`, test files, and config files:

```json
"files": ["dist"]
```

### prepublishOnly

Ensure the build runs before every publish:

```json
"scripts": {
  "prepublishOnly": "npm run build"
}
```

---

## Node.js Version Targeting

**Target:** `"engines": { "node": ">=20.5.0" }`

Rationale:
- v20 is Maintenance LTS until April 2026 — users may still be on it
- v22 is Active LTS (April 2024 – October 2026 active, maintenance until April 2028)
- v24 just entered Active LTS (May 2025) — not yet widely adopted
- v18 reached End-of-Life March 2025 — do not support
- execa 9.x requires `^18.19.0 || >=20.5.0` — this is our effective floor

**ESM-only is safe for >=20.5.0.** ESM interop (`require(esm)`) landed in v22 without flags, but since loci is a CLI (not a library), this is irrelevant — no one `require()`s a CLI tool.

---

## Cold-Start Budget (< 300ms)

The 300ms budget is achievable with this stack. Key factors:

- **Bundle everything with tsup** (`bundle: true`, `noExternal: []`). A single file means Node.js performs one disk read instead of traversing node_modules.
- **execa** is a pure-ESM library with no native bindings — loads fast.
- **yaml** is pure JS — loads fast.
- **commander** is small (< 50KB minified).
- **Avoid heavy deps**: no chalk (use ANSI codes directly or `util.styleText` from Node >=20), no ora spinner, no boxen.
- **Measure**: Add `console.time('startup')` + `console.timeEnd('startup')` during development and run `hyperfine 'loci --help'` on each PR.

Typical cold-start for a bundled Node.js CLI with 3-4 small deps: **50-150ms** on modern hardware. Well within budget.

---

## Config Loading: env var path on Windows

`LOCI_MACHINE_CONFIG` holds a file path set by the user in their shell profile. Reading it correctly across platforms:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const rawPath = process.env.LOCI_MACHINE_CONFIG;
if (rawPath) {
  // path.resolve() normalizes backslashes on Windows automatically
  const absolutePath = resolve(rawPath);
  const content = readFileSync(absolutePath, 'utf8');
  const config = parse(content);
}
```

**No dotenv needed.** `process.env` already contains all shell environment variables. `path.resolve()` handles Windows backslashes. `fs.readFileSync` with `'utf8'` works identically on all platforms for YAML text files.

**Gotcha:** Windows users may set `LOCI_MACHINE_CONFIG=C:\Users\me\loci.yml`. Node's `path.resolve()` correctly handles this. Do not use string concatenation with `/` — always use `path.join()` or `path.resolve()`.

---

## Parallel Command Execution

No dedicated library needed. Compose `Promise.all` with execa:

```ts
import { execa } from 'execa';

// Parallel group: run all, collect results
const results = await Promise.allSettled(
  commands.map(cmd => execa(cmd.program, cmd.args, { stdio: 'inherit' }))
);

// Sequential chain: stop on first failure
for (const cmd of commands) {
  await execa(cmd.program, cmd.args, { stdio: 'inherit' });
  // execa throws on non-zero exit → loop stops automatically
}
```

`Promise.allSettled` (not `Promise.all`) is preferred for parallel groups so all processes are allowed to complete and you can report which ones failed. `Promise.all` would cancel remaining processes on first failure via unhandled rejection, which is not the desired behavior for parallel groups where you want all output visible.

---

## Version Compatibility

| Package | Version | Node.js Minimum | ESM |
|---------|---------|-----------------|-----|
| commander | 14.0.3 | >=20 | CJS + ESM |
| execa | 9.6.1 | ^18.19.0 \|\| >=20.5.0 | ESM only |
| yaml | 2.8.3 | (unspecified, TS >=5.9) | CJS + ESM |
| tsup | 8.5.1 | (build tool, dev only) | — |
| vitest | 4.1.4 | >=20 | ESM |
| @biomejs/biome | 2.x | N/A (Rust binary) | — |

All packages are compatible with the `>=20.5.0` engine target.

---

## Sources

- https://github.com/tj/commander.js/releases — commander v14.0.3 confirmed, v15 ESM-only warning verified
- https://github.com/sindresorhus/execa/blob/main/package.json — execa 9.6.1, Node `^18.19.0 || >=20.5.0`, ESM-only confirmed
- https://github.com/eemeli/yaml — yaml 2.8.3, YAML 1.1+1.2, TS >=5.9 confirmed
- https://github.com/nodeca/js-yaml — js-yaml 4.1.1, requires `@types/js-yaml`, YAML 1.1 semantics (footgun noted)
- https://github.com/egoist/tsup — tsup 8.5.1 confirmed
- https://vitest.dev/guide/ — vitest 4.1.4, Node >=20 confirmed
- https://biomejs.dev/blog/biome-v2/ — Biome v2 released June 2025, type-aware lint, no TS compiler dependency
- https://nodejs.org/en/about/previous-releases — Node.js v20 Maintenance LTS, v22 Active LTS, v24 Active LTS; v18 EOL Mar 2025
- https://lirantal.com/blog/typescript-in-2025-with-esm-and-cjs-npm-publishing — dual publish analysis, tsup recommendation confirmed
- https://antfu.me/posts/move-on-to-esm-only — ESM-only for CLI tools rationale (MEDIUM confidence, opinion piece)
- https://2ality.com/2025/02/typescript-esm-packages.html — bin field + shebang + chmod workflow confirmed

---

*Stack research for: loci — cross-platform Node.js CLI command runner*
*Researched: 2026-04-10*
