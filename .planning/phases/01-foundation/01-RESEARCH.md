# Phase 1: Foundation - Research

**Researched:** 2026-04-10
**Domain:** TypeScript ESM CLI scaffolding (tsup bundle, commander wiring, typed error hierarchy, cross-platform CI)
**Confidence:** HIGH

## Summary

Phase 1 is pure scaffolding for an ESM-only TypeScript CLI targeting Node.js `>=20.5.0`. All 16 CONTEXT decisions (D-01..D-16) lock the shape of the deliverable; this research fills in the exact config file contents, commands, and gotchas the planner needs to turn those decisions into tasks without re-opening them.

The phase produces: (1) a `package.json` with `type: "module"`, `bin.loci → ./dist/cli.mjs`, `engines.node: ">=20.5.0"`; (2) a tsup bundle with shebang injection and build-time `__LOCI_VERSION__` replacement; (3) a full `LociError` taxonomy with stable exit-code ranges (0/10/20/30/40/50); (4) a commander v14 program that runs on empty args and `--version`/`--help` without errors; (5) feature folder stubs that throw from `index.ts`; (6) a GitHub Actions matrix (ubuntu/windows/macos × Node 20/22) that runs `build → lint → test → smoke`; (7) vitest + biome wired from commit one.

**Primary recommendation:** Scaffold `package.json` first (with the exact field shape documented below), then `tsconfig.json` + `tsup.config.ts` + `biome.json` + `vitest.config.ts` in parallel, then `src/errors.ts` + `src/types.ts` (data contracts), then `src/cli.ts` + `src/version.ts`, then feature-folder stubs, then tests, then CI YAML. Every step has a self-contained verification command so tasks can fail fast.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Error Hierarchy (`src/errors.ts`)**

- **D-01: Hybrid taxonomy.** `LociError` (abstract base) → per-area base classes (`ConfigError`, `CommandError`, `InterpolationError`, `ExecutorError`, `CliError`) → concrete failure subclasses (e.g. `YamlParseError extends ConfigError`, `SecretsTrackedError extends ConfigError`, `CircularAliasError extends CommandError`, `UndefinedPlaceholderError extends InterpolationError`, `ShellInjectionError extends ExecutorError`, `UnknownAliasError extends CliError`). Downstream code can catch either the specific failure or the area group.
- **D-02: Exit codes per category, stable ranges.** `0` = success, `10` = ConfigError, `20` = CommandError, `30` = InterpolationError, `40` = ExecutorError, `50` = CliError. Child-process exit codes from EXE-03 propagate unchanged (not mapped into the 40 range). Ranges documented in README and in a `ExitCode` const object.
- **D-03: Full taxonomy declared in Phase 1.** All area bases AND all concrete subclasses we can foresee from REQUIREMENTS.md + PITFALLS.md exist as exported classes in `src/errors.ts` from Phase 1's first commit. Phases 2-5 import and throw; they never add to the hierarchy unless a genuinely new failure mode emerges.
- **D-04: Structured error shape.** `LociError` carries `{ code: string (machine id like 'CFG_YAML_PARSE'), category: string, suggestion?: string, cause?: unknown }` in addition to the standard `message` + `name`. `cause` uses the native Node 16+ `Error.cause` contract. Tests assert `instanceof` chains, `code` uniqueness across the hierarchy, and category-to-exit-code mapping.

**Source Layout (`src/`)**

- **D-05: Feature folders aligned to the ARCHITECTURE.md pipeline** — `src/cli.ts`, `src/errors.ts`, `src/types.ts`, `src/version.ts`, `src/config/`, `src/commands/`, `src/resolver/`, `src/executor/`, each with `index.ts` + `__tests__/`.
- **D-06: Phase 1 pre-creates stub index.ts files** in each feature folder, each throwing "Not implemented" (as a typed `LociError`) and typed against interfaces in `src/types.ts`. `types.ts` is fully populated in Phase 1.
- **D-07: Single entry point `src/cli.ts` → `dist/cli.mjs`.** `package.json` has `"bin": { "loci": "./dist/cli.mjs" }`. tsup injects `#!/usr/bin/env node` shebang. No `bin/` subfolder.
- **D-08: Co-located `__tests__/` folders per module.** vitest `include: ['**/__tests__/**/*.test.ts']`. tsup entry glob excludes `__tests__` so tests never land in the bundle.

**CI Matrix**

- **D-09: Node matrix = [20, 22].** v20 = engines floor, v22 = current Active LTS. Node 24 excluded.
- **D-10: OS matrix = [ubuntu-latest, windows-latest, macos-latest].** Real Windows (not WSL).
- **D-11: Cold-start gate = smoke check only in Phase 1.** `node dist/cli.mjs --version` asserts exit 0 + expected stdout. **No `hyperfine` threshold in Phase 1.** Deferred to Phase 5.
- **D-12: CI triggers = push to main + all PRs + workflow_dispatch.**

**Skeleton Runtime (`src/cli.ts`)**

- **D-13: Commander.js wired from Phase 1, no sub-commands.** `Command()` program, `name('loci')`, `.version(__LOCI_VERSION__)`, `.description(...)`, `.helpOption('-h, --help')`, default action. Phases 2-5 extend the same program.
- **D-14: `--version` value inlined at build time.** tsup replaces literal `__LOCI_VERSION__` with `package.json.version` via `define`. Zero fs reads at startup.
- **D-15: Empty-args → commander help + phase-1 hint.** `(no aliases defined yet — .loci/commands.yml will be loaded once Phase 2+ ships)`. Exit 0.
- **D-16: Smoke tests = unit + E2E spawn.** Unit tests for `errors.ts` and `types.ts` (type-level via `expectTypeOf`). E2E tests spawn `node dist/cli.mjs` with `--version`, `--help`, unknown flag, no args.

### Claude's Discretion

- Exact `code` string format for each concrete error class (suggested: `UPPER_SNAKE_CASE_CATEGORY_FAILURE`).
- biome config strictness — start with biome's recommended preset; loosen only if a specific rule proves noisy.
- vitest config options (pool, isolate, reporters) as long as CI matrix stays green.
- Whether `types.ts` is one file or a `src/types/` barrel — start with a single file, split only if it exceeds ~200 lines.
- Exact tsup options as long as: single `.mjs` output, shebang injected, all deps bundled, no sourcemap in published artifact, build completes in CI budget.
- License choice — MIT unless user flags otherwise; LICENSE file lands in Phase 5.
- Whether CI caches npm or uses a lockfile-only install — `npm ci` with actions/setup-node's built-in cache is the standard choice.
- Repository hygiene files (`.gitignore`, `.gitattributes`, `.editorconfig`, `.nvmrc`) — sensible defaults in Phase 1.
- `package.json` metadata fields (author, repository, bugs, homepage).
- Whether empty-state hint is printed via commander's `addHelpText('after', ...)` or via default action callback.

### Deferred Ideas (OUT OF SCOPE for Phase 1)

- Cold-start `hyperfine` gate — Phase 5.
- LICENSE file + repository metadata population — Phase 5.
- `loci init` scaffolding command — Phase 5.
- npm name availability verification — Phase 5 blocker.
- Shell completions, `--timing`, `NO_COLOR`, `loci config` — v2.
- Plugin system, watch mode, remote execution — permanently out of scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Package è Node.js ESM-only, TypeScript, bundled con tsup in singolo `.mjs`, pubblicabile su npm | `package.json` shape §"package.json Canonical Shape"; tsup config §"tsup Config"; `type: "module"` + `engines.node` |
| FND-02 | Bin `loci` installabile globalmente, funziona su Windows 10+/Linux/macOS | Shebang injection via tsup `banner`; `bin` field → `dist/cli.mjs`; npm cmd-shim on Windows §"Cross-Platform Bin Shim"; CI smoke test §"GitHub Actions Workflow" |
| FND-03 | Cold start `loci --version` < 300ms | Bundle-everything strategy (§"Cold-Start Strategy"); `__LOCI_VERSION__` inlining via tsup define (no fs reads); smoke check only in Phase 1 (D-11) |
| FND-04 | Gerarchia `LociError` + sottoclassi per categoria, usata in tutto il codebase | §"Error Hierarchy Pattern" — abstract base + area bases + concrete subclasses with `Error.cause`; `ExitCode` const; per-class `code` registry test (D-01..D-04) |
| FND-05 | Vitest + biome configurati e funzionanti dal primo commit | §"vitest Config", §"biome Config" — both work with ESM + TS 6 natively with zero-config |
| FND-06 | CI su GitHub Actions con matrice Windows/Linux/macOS, build + test + lint a ogni push | §"GitHub Actions Workflow" — full YAML with setup-node cache, matrix 3×2, smoke step |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | `>=20.5.0` (engines floor) | Runtime | [VERIFIED: npm registry] execa 9.x floor is `^18.19.0 \|\| >=20.5.0`; v20.5.0 is the effective minimum that satisfies every dep. Node 20 Maintenance LTS until Apr 2026, Node 22 Active LTS until Oct 2026. |
| TypeScript | `^6.0.2` | Language | [VERIFIED: `npm view typescript dist-tags` on 2026-04-10 returned `latest: 6.0.2`] **DRIFT NOTE:** CLAUDE.md says "TypeScript 5.x" but that reflects older research. TS 6.0.2 is stable latest as of today (April 2026); tsup's peer `typescript: >=4.5.0` and vitest 4.1.4 both accept TS 6. **Recommendation: use `^6.0.2`.** If the user specifically wants 5.x (stability), `^5.7.0` still works across the stack. [ASSUMED: TS 6.0.2 works cleanly with `moduleResolution: "bundler"` and ES2022+ target — this is the default-path config for tsup.] |
| commander | `14.0.3` | CLI argument parsing | [VERIFIED: `npm view commander version` = 14.0.3] v14 requires Node >=20, stable CJS+ESM, receives security fixes until May 2027. **v15 is pre-release — do NOT upgrade.** |
| execa | `9.6.1` | Child-process execution (stub only in Phase 1; imported via type-only import for `src/executor/index.ts` signature) | [VERIFIED: `npm view execa version` = 9.6.1] ESM-only, `^18.19.0 \|\| >=20.5.0`. Phase 1 imports the type only; no runtime call. |
| yaml | `2.8.3` | YAML parsing (stub only in Phase 1) | [VERIFIED: `npm view yaml version` = 2.8.3] YAML 1.2 semantics. Phase 1 installs it so it's present for Phase 2 and so tsup can verify `noExternal: [/./]` bundles it. |

### Dev Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| `@types/node` | `^22.0.0` or `^24.0.0` | [VERIFIED: vitest 4.1.4 peer deps require `^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0`] Use `^22` to match the Active LTS target. |
| `typescript` | `^6.0.2` | See above |
| `tsup` | `8.5.1` | [VERIFIED: `npm view tsup version` = 8.5.1; engines `>=18`; peer `typescript: >=4.5.0`] Bundle TS → single `.mjs` |
| `vitest` | `4.1.4` | [VERIFIED: `npm view vitest version` = 4.1.4; engines `^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0`] |
| `@biomejs/biome` | `2.4.11` | [VERIFIED: `npm view @biomejs/biome version` = 2.4.11 on 2026-04-10; engines `>=14.21.3`] Biome 2.x stable line. |

### Installation Commands

```bash
# Runtime deps (declared so `npm i` works for fork/contributors; tsup bundles them into dist/cli.mjs)
npm install commander@14.0.3 execa@9.6.1 yaml@2.8.3

# Dev deps
npm install -D typescript@^6.0.2 tsup@8.5.1 vitest@4.1.4 @biomejs/biome@2.4.11 @types/node@^22
```

### Alternatives Considered (locked closed by CLAUDE.md / CONTEXT.md)

| Instead of | Could Use | Why rejected |
|------------|-----------|--------------|
| yaml (eemeli) | js-yaml | YAML 1.1 footgun (`no`/`yes` → boolean). Locked closed by CLAUDE.md "What NOT to Use". |
| execa | cross-spawn / zx | cross-spawn requires manual wiring; zx adds a shell. Locked by STACK.md. |
| tsup | plain tsc / rollup | tsc doesn't bundle (cold-start penalty); rollup needs plugin setup. Locked by CLAUDE.md. |
| vitest | jest / node:test | Jest needs ts-jest transform; node:test lacks features. Locked. |
| biome | eslint + prettier | 4+ config files vs 1. Locked. |
| commander v15 | — | ESM-only pre-release, requires Node >=22.12.0. **Explicitly blacklisted** in CLAUDE.md. |

## package.json Canonical Shape

Planner should scaffold this file verbatim (filling author/repository/bugs/homepage with project context):

```json
{
  "name": "loci",
  "version": "0.0.0",
  "description": "Local CI — cross-platform command alias runner with layered YAML config",
  "type": "module",
  "engines": {
    "node": ">=20.5.0"
  },
  "bin": {
    "loci": "./dist/cli.mjs"
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsup",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "smoke": "node dist/cli.mjs --version",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "commander": "14.0.3",
    "execa": "9.6.1",
    "yaml": "2.8.3"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.11",
    "@types/node": "^22",
    "tsup": "8.5.1",
    "typescript": "^6.0.2",
    "vitest": "4.1.4"
  }
}
```

**Field-by-field rationale (what the planner must NOT silently change):**

- **`"type": "module"`** — required for the `.mjs` output to import ESM-only execa. [CITED: https://nodejs.org/api/packages.html#type]
- **`"engines.node": ">=20.5.0"`** — matches the intersection of execa 9.x (`^18.19.0 || >=20.5.0`), vitest 4.x (`^20.0.0 || ^22.0.0 || >=24.0.0`), and CONTEXT D-09.
- **`"bin": { "loci": "./dist/cli.mjs" }`** — string form `"bin": "./dist/cli.mjs"` would name the binary after `"name"` (still "loci"), but the explicit map form is clearer and is what D-07 locks.
- **`"files": ["dist"]`** — `src/`, tests, configs, `.github/` all excluded from the published tarball. `README.md` added so npm's package page renders. [CITED: https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files]
- **`"prepublishOnly"`** — guarantees `npm publish` can never ship a stale `dist/`.
- **NO `"exports"` field** — Phase 1 has no library surface. Adding `exports` without a library entry point would break tooling that walks the exports map for types. If Phase 5 adds a programmatic API, add exports then.
- **NO `"main"` field** — CLI-only; nothing `require`s loci.
- **NO `"module"` field** — irrelevant for an application; a legacy hint for bundlers consuming libraries.
- **Exact pins for runtime deps** (`14.0.3`, not `^14.0.3`) — reproducibility of the cold-start budget. tsup bundles them, so a patch bump in a transitive dep cannot silently change the bundle size between local and CI.

**Windows bin shim (cross-platform behavior):** When `npm i -g .` runs, npm's `cmd-shim` reads the shebang from `dist/cli.mjs` and writes three wrappers into the npm global bin directory: `loci` (POSIX shell script for MSYS/Git Bash), `loci.cmd` (Batch wrapper for cmd.exe/PowerShell), and `loci.ps1` (PowerShell wrapper). All three invoke `node "path/to/dist/cli.mjs" "$@"`. **No action required on our side beyond the shebang line.** [CITED: https://github.com/npm/cmd-shim]

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"],
  "exclude": ["dist", "node_modules"]
}
```

**Rationale:**
- **`target: "ES2022"`** — `Error.cause` is native in ES2022 (required by D-04). No down-level emission needed since `engines.node: ">=20.5.0"`.
- **`moduleResolution: "bundler"`** — tsup/esbuild resolve; do not require `.js` extensions in imports. [CITED: https://www.typescriptlang.org/docs/handbook/modules/reference.html#bundler]
- **`strict` + all extra strictness flags** — locks in discipline for Phases 2-5. Catches the typical "did you return undefined?" bugs before commit.
- **`verbatimModuleSyntax: true`** — requires `import type` for type-only imports. Matches Phase 1's type-only execa import.
- **`noEmit: true`** — tsc is only used for typechecking (`npm run typecheck`); tsup does the actual build.
- **`isolatedModules: true`** — required for single-file transformers like esbuild/tsup.

**Why NOT `"module": "NodeNext"` + `"moduleResolution": "NodeNext"`:** NodeNext forces explicit `.js` extensions in every import (`import { foo } from './bar.js'`), which is pedantically correct for pure-Node ESM but adds friction for a bundled CLI where tsup rewrites imports anyway. `bundler` mode is the current tsup-recommended setting. [CITED: https://tsup.egoist.dev/#typescript]

## tsup.config.ts

```ts
import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20.5',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  bundle: true,
  noExternal: [/.*/],       // bundle ALL deps into dist/cli.mjs (commander, execa, yaml, everything)
  clean: true,
  dts: false,               // no library types needed for a CLI
  sourcemap: false,         // keeps published tarball small (per D discretion)
  minify: false,            // readable output for easier debug during Phase 1
  splitting: false,         // single-file output for cold-start
  treeshake: true,
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __LOCI_VERSION__: JSON.stringify(pkg.version),
  },
  platform: 'node',
});
```

**Key points the planner must preserve:**

- **`entry: ['src/cli.ts']`** — only the CLI entry. `src/errors.ts`, `src/types.ts`, feature stubs are all reached transitively via `cli.ts` imports. No separate entries.
- **`format: ['esm']`** — single format; D-07 locks the `.mjs` output.
- **`noExternal: [/.*/]`** — the regex form bundles every dep. tsup's alternative `external: []` leaves things in node_modules; `noExternal: [/.*/]` (regex that matches every package) forces inlining. [CITED: https://tsup.egoist.dev/#bundle-dependencies]
- **`banner.js: '#!/usr/bin/env node'`** — tsup places the shebang as literally the first line of the output file, which is the hard requirement for npm bin to work. [CITED: https://tsup.egoist.dev/#inject-cjs-and-esm-shims] This replaces the old `shx chmod +x` step because esbuild preserves the shebang and writes the file with +x permission on POSIX platforms.

  **Verification:** after `npm run build`, `head -1 dist/cli.mjs` must print `#!/usr/bin/env node` and `ls -l dist/cli.mjs` on Linux/macOS must show `-rwxr-xr-x`. If the executable bit is missing on some tsup version, add `chmod +x dist/cli.mjs` to the build script as a fallback (cross-platform via `node -e "require('fs').chmodSync('dist/cli.mjs', 0o755)"`).

- **`define: { __LOCI_VERSION__: JSON.stringify(pkg.version) }`** — esbuild `define` replaces the literal token with the JSON-quoted string at bundle time. This is exactly what D-14 wants: zero runtime fs reads. The `JSON.stringify` is mandatory — without it, esbuild would inject the bare token, not a string literal. [CITED: https://esbuild.github.io/api/#define]

  **Why read `package.json` with `fs` in tsup.config (not `import pkg from './package.json'`)**: importing JSON in a tsup config triggers `resolveJsonModule` and adds the JSON file as an esbuild input, which can cause rebuild loops in `--watch` mode. The sync `readFileSync` at config load time is the idiomatic pattern.

- **`target: 'node20.5'`** — matches engines floor; esbuild targets a Node ≥20.5 runtime, so it will not down-level `Error.cause`, top-level `await`, or other ES2022 features.
- **`dts: false`** — no `.d.ts` emission needed. If Phase 5 adds a library surface, flip this on.
- **`platform: 'node'`** — tells esbuild to use Node's built-in resolution (no browser shims), keeps `node:*` specifiers intact.

**Build output verification:** `ls dist/` should show exactly `cli.mjs` (and nothing else if `sourcemap: false`, `dts: false`).

## src/version.ts

```ts
// Replaced at build time by tsup `define` — see tsup.config.ts
// eslint-disable-line — the string literal is intentional; esbuild swaps it.
declare const __LOCI_VERSION__: string;
export const LOCI_VERSION: string = __LOCI_VERSION__;
```

Wait — `declare const` + a use site like `__LOCI_VERSION__` as an rvalue IS the right pattern. But TypeScript needs the declaration to type-check, and esbuild's `define` must swap a **literal identifier**, not a `declare`d one. The safe pattern that works with both TS and esbuild define:

```ts
// src/version.ts
// __LOCI_VERSION__ is a build-time constant injected by tsup's `define` option.
// During typecheck (`tsc --noEmit`) it is typed via the declaration below.
// At bundle time, esbuild replaces the identifier with the JSON-quoted version string.
declare const __LOCI_VERSION__: string;

export const LOCI_VERSION: string = __LOCI_VERSION__;
```

TypeScript sees a `declare const` (no runtime emission) and a use site that reads it; esbuild's `define` matches the identifier and substitutes the literal string. **This is the canonical esbuild define pattern.** [CITED: https://esbuild.github.io/api/#define — "The value must be a JSON object" and "Identifier expressions with the specified name are replaced by the corresponding value"]

Planner note: `tsc --noEmit` will accept this because `declare const` is a type-only construct. The `biome` lint pass may flag the `declare` — if so, add `// biome-ignore lint/...` or configure biome to ignore `declare` globals in the one file.

## src/errors.ts Pattern

**Target structure:**

```ts
// src/errors.ts

/**
 * Exit codes per category (D-02). Stable ranges — do not renumber in later phases.
 */
export const ExitCode = {
  SUCCESS: 0,
  CONFIG_ERROR: 10,
  COMMAND_ERROR: 20,
  INTERPOLATION_ERROR: 30,
  EXECUTOR_ERROR: 40,
  CLI_ERROR: 50,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export type LociErrorCategory =
  | 'config'
  | 'command'
  | 'interpolation'
  | 'executor'
  | 'cli';

export interface LociErrorOptions {
  code: string;              // machine ID, e.g. "CFG_YAML_PARSE"
  suggestion?: string;
  cause?: unknown;           // Error.cause (ES2022)
}

/**
 * Abstract base for all loci errors. Never throw this directly — always throw
 * a concrete subclass (e.g. YamlParseError, CircularAliasError).
 */
export abstract class LociError extends Error {
  public readonly code: string;
  public abstract readonly category: LociErrorCategory;
  public readonly suggestion?: string;

  constructor(message: string, options: LociErrorOptions) {
    // Pass Error.cause through the standard ES2022 channel
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    if (options.suggestion !== undefined) {
      this.suggestion = options.suggestion;
    }
  }
}

/* ---------- Area base classes ---------- */

export abstract class ConfigError extends LociError {
  public readonly category = 'config' as const;
}

export abstract class CommandError extends LociError {
  public readonly category = 'command' as const;
}

export abstract class InterpolationError extends LociError {
  public readonly category = 'interpolation' as const;
}

export abstract class ExecutorError extends LociError {
  public readonly category = 'executor' as const;
}

export abstract class CliError extends LociError {
  public readonly category = 'cli' as const;
}

/* ---------- Concrete subclasses (D-03: declared in Phase 1, thrown in Phases 2-5) ---------- */

// ConfigError subclasses (for Phase 2)
export class YamlParseError extends ConfigError {
  constructor(filePath: string, line: number | undefined, cause: unknown) {
    super(
      `Invalid YAML in ${filePath}${line !== undefined ? ` at line ${line}` : ''}`,
      { code: 'CFG_YAML_PARSE', cause, suggestion: 'Check the file for unmatched quotes or indentation errors' },
    );
  }
}

export class ConfigReadError extends ConfigError {
  constructor(filePath: string, cause: unknown) {
    super(`Cannot read config file: ${filePath}`, {
      code: 'CFG_READ',
      cause,
      suggestion: 'Check file permissions and that the path exists',
    });
  }
}

export class SecretsTrackedError extends ConfigError {
  constructor(filePath: string) {
    super(`Secrets file appears tracked by git: ${filePath}`, {
      code: 'CFG_SECRETS_TRACKED',
      suggestion: `Run: git rm --cached ${filePath}`,
    });
  }
}

// CommandError subclasses (for Phase 3)
export class CircularAliasError extends CommandError {
  constructor(cyclePath: readonly string[]) {
    super(`Circular alias reference: ${cyclePath.join(' → ')}`, {
      code: 'CMD_CIRCULAR_ALIAS',
      suggestion: 'Break the cycle by redefining one of the aliases in the chain',
    });
  }
}

export class UnknownAliasError extends CommandError {
  constructor(aliasName: string) {
    super(`Unknown alias: "${aliasName}"`, {
      code: 'CMD_UNKNOWN_ALIAS',
      suggestion: 'Run `loci --list` to see available aliases',
    });
  }
}

export class CommandSchemaError extends CommandError {
  constructor(aliasName: string, details: string) {
    super(`Invalid command definition for alias "${aliasName}": ${details}`, {
      code: 'CMD_SCHEMA',
    });
  }
}

// InterpolationError subclasses (for Phase 3)
export class UndefinedPlaceholderError extends InterpolationError {
  constructor(placeholder: string, aliasName: string) {
    super(`Undefined placeholder \${${placeholder}} in alias "${aliasName}"`, {
      code: 'INT_UNDEFINED_PLACEHOLDER',
      suggestion: `Add ${placeholder} to one of your .loci config files`,
    });
  }
}

// ExecutorError subclasses (for Phase 4)
export class ShellInjectionError extends ExecutorError {
  constructor(value: string) {
    super('Command contains shell metacharacters in an argument slot', {
      code: 'EXE_SHELL_INJECTION',
      suggestion: 'loci uses shell:false by default; review your command definition',
    });
    // NB: never include `value` in the message — it may be a secret
    void value;
  }
}

export class SpawnError extends ExecutorError {
  constructor(commandPath: string, cause: unknown) {
    super(`Failed to spawn command: ${commandPath}`, {
      code: 'EXE_SPAWN',
      cause,
      suggestion: 'Check the command exists in PATH',
    });
  }
}

// CliError subclasses (for Phase 1's own cli.ts + Phase 5)
export class UnknownFlagError extends CliError {
  constructor(flag: string) {
    super(`Unknown flag: ${flag}`, {
      code: 'CLI_UNKNOWN_FLAG',
      suggestion: 'Run `loci --help` for available flags',
    });
  }
}

// Phase 1 also declares NotImplementedError so feature stubs can throw it
export class NotImplementedError extends CliError {
  constructor(component: string) {
    super(`Not implemented: ${component}`, {
      code: 'CLI_NOT_IMPLEMENTED',
      suggestion: 'This feature lands in a later phase',
    });
  }
}

/* ---------- Category → exit code mapping (single source of truth) ---------- */

export function exitCodeFor(error: LociError): ExitCode {
  switch (error.category) {
    case 'config':        return ExitCode.CONFIG_ERROR;
    case 'command':       return ExitCode.COMMAND_ERROR;
    case 'interpolation': return ExitCode.INTERPOLATION_ERROR;
    case 'executor':      return ExitCode.EXECUTOR_ERROR;
    case 'cli':           return ExitCode.CLI_ERROR;
  }
}
```

**Critical details the planner must preserve:**

1. **`Error.cause` via the standard constructor options bag** — `super(message, { cause })`. This is the ES2022 native contract; `target: "ES2022"` in tsconfig lets TypeScript recognise it without a polyfill. [CITED: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause]

2. **`this.name = new.target.name`** — sets the runtime name to the concrete subclass (e.g. `'YamlParseError'`) instead of `'Error'` or `'LociError'`. This is what shows up in stack traces and `err.toString()`.

3. **`abstract class` on base and area bases** — TypeScript prevents `new LociError(...)` or `new ConfigError(...)` at compile time. Test file should assert this with `expectTypeOf` / `// @ts-expect-error`.

4. **Abstract `category` declared on the base, assigned on each area class** — `public abstract readonly category: LociErrorCategory;` on `LociError`, then `public readonly category = 'config' as const;` on `ConfigError`. This gives concrete subclasses the right `as const` literal type for free and lets `exitCodeFor` exhaustively `switch`. **Without `abstract` on the base**, concrete classes could forget to set `category` and it would be `undefined` at runtime.

5. **No `Object.setPrototypeOf(this, new.target.prototype)` needed** — that workaround is for `target: "ES5"` where `extends Error` historically broke the prototype chain. At `target: "ES2022"` the native class semantics handle it. **Tests must verify:** `expect(err instanceof YamlParseError).toBe(true)`, `expect(err instanceof ConfigError).toBe(true)`, `expect(err instanceof LociError).toBe(true)`, `expect(err instanceof Error).toBe(true)` — all four true.

6. **`code` uniqueness test** — build a single array of every concrete class, instantiate each with dummy args, collect `.code` values, assert the `Set` size equals the array length. This is what D-04 mandates ("code uniqueness across the hierarchy").

7. **Secrets-safe by construction** — `ShellInjectionError` deliberately does NOT embed the offending value in `message`. This establishes the Phase 2+ pattern: error messages describe the *shape* of the problem, not the *value*.

8. **`exitCodeFor` as exhaustive switch** — compiles to an error if any area forgets a branch. This is the central invariant for FND-04 + D-02.

## src/types.ts — Contract for Phases 2-5

Per D-06, `src/types.ts` must be **fully populated** in Phase 1 so downstream phases just implement against stable interfaces:

```ts
// src/types.ts

/* ------------------------------------------------------------
 * ConfigLoader contract (Phase 2)
 * ------------------------------------------------------------ */

/** A value loaded from a config file. All values are strings; YAML 1.2 semantics via `yaml`. */
export type ConfigValue = string;

/** Which of the 4 layers a config key came from — used for redaction and --verbose trace. */
export type ConfigLayer = 'machine' | 'project' | 'secrets' | 'local';

/** Flat, merged config after precedence resolution machine → project → secrets → local (last wins). */
export interface ResolvedConfig {
  /** Flat key → value map after merge. */
  readonly values: Readonly<Record<string, ConfigValue>>;
  /** For each key, which layer provided the final value. */
  readonly provenance: Readonly<Record<string, ConfigLayer>>;
  /** Set of keys whose final value came from secrets.yml (for redaction). */
  readonly secretKeys: ReadonlySet<string>;
}

export interface ConfigLoader {
  load(cwd: string): Promise<ResolvedConfig>;
}

/* ------------------------------------------------------------
 * CommandsLoader contract (Phase 3)
 * ------------------------------------------------------------ */

/** Union type matching the commands.yml schema after parse + validation. */
export type CommandDef =
  | { readonly kind: 'single'; readonly cmd: readonly string[]; readonly description?: string; readonly platforms?: PlatformOverrides }
  | { readonly kind: 'sequential'; readonly steps: readonly CommandRef[]; readonly description?: string }
  | { readonly kind: 'parallel'; readonly group: readonly CommandRef[]; readonly description?: string };

export type CommandRef = string; // reference to another alias (composition)

export interface PlatformOverrides {
  readonly linux?: readonly string[];
  readonly windows?: readonly string[];
  readonly macos?: readonly string[];
}

export type CommandMap = ReadonlyMap<string, CommandDef>;

export interface CommandsLoader {
  load(cwd: string): Promise<CommandMap>;
}

/* ------------------------------------------------------------
 * Resolver contract (Phase 3)
 * ------------------------------------------------------------ */

export type ExecutionPlan =
  | { readonly kind: 'single'; readonly argv: readonly string[] }
  | { readonly kind: 'sequential'; readonly steps: readonly (readonly string[])[] }
  | { readonly kind: 'parallel'; readonly group: readonly { readonly alias: string; readonly argv: readonly string[] }[] };

export interface Resolver {
  resolve(
    aliasName: string,
    commands: CommandMap,
    config: ResolvedConfig,
  ): ExecutionPlan;
}

/* ------------------------------------------------------------
 * Executor contract (Phase 4)
 * ------------------------------------------------------------ */

export interface ExecutionResult {
  readonly exitCode: number;
}

export interface Executor {
  run(plan: ExecutionPlan): Promise<ExecutionResult>;
}
```

**Notes for the planner:**

- **All types `readonly` + `Readonly<>`** — forces the downstream code to treat the pipeline outputs as immutable. Catches accidental mutation bugs at compile time.
- **`cmd: readonly string[]`, not `cmd: string`** — single commands are always argv arrays, never shell strings. This encodes Pitfall 1 ("shell:true destroys cross-platform") at the type level. Phase 3 resolver splits the YAML string into tokens; Phase 4 executor receives pre-split argv.
- **`ExecutionPlan.parallel.group[].alias`** — each parallel branch carries its alias name for prefixed output (PITFALLS.md §8).
- **Interfaces (`ConfigLoader`, `CommandsLoader`, `Resolver`, `Executor`)** — let Phase 1's feature stubs export `const configLoader: ConfigLoader = { load() { throw new NotImplementedError('ConfigLoader'); } }` and later phases swap in real implementations without touching import sites.
- **Keep as one file** — currently ~70 lines. Split into `src/types/` directory only if it exceeds ~200 lines (D discretion).

## src/cli.ts Pattern (Phase 1 skeleton)

```ts
// src/cli.ts
import { Command } from 'commander';
import { LOCI_VERSION } from './version.js';
import { CliError, exitCodeFor, LociError, UnknownFlagError } from './errors.js';

function buildProgram(): Command {
  const program = new Command();

  program
    .name('loci')
    .description('Local CI — cross-platform command alias runner')
    .version(LOCI_VERSION, '-V, --version', 'output the current loci version')
    .helpOption('-h, --help', 'display help for command')
    .showHelpAfterError()
    .exitOverride();   // convert commander errors into throws we control

  // Default action: print help + phase-1 hint (D-15)
  program.action(() => {
    program.outputHelp();
    process.stdout.write(
      '\n(no aliases defined yet — .loci/commands.yml will be loaded once Phase 2+ ships)\n',
    );
  });

  return program;
}

async function main(argv: readonly string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[]);
    return 0;
  } catch (err) {
    // commander.exitOverride() throws CommanderError with a `.code` like 'commander.unknownOption'
    if (err instanceof LociError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      if (err.suggestion) process.stderr.write(`  suggestion: ${err.suggestion}\n`);
      return exitCodeFor(err);
    }
    // Commander's own errors — help/version are `.exitCode === 0`, real errors are non-zero
    const commanderErr = err as { code?: string; exitCode?: number; message?: string };
    if (commanderErr.code === 'commander.helpDisplayed' || commanderErr.code === 'commander.version') {
      return 0;
    }
    if (commanderErr.code?.startsWith('commander.')) {
      const wrapped = new UnknownFlagError(commanderErr.message ?? 'cli error');
      process.stderr.write(`error [${wrapped.code}]: ${wrapped.message}\n`);
      return exitCodeFor(wrapped);
    }
    // Unexpected
    process.stderr.write(`unexpected error: ${(err as Error).message}\n`);
    return 1;
  }
}

main(process.argv).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
```

**Critical points:**

1. **`.exitOverride()`** — [CITED: https://github.com/tj/commander.js#override-exit-and-output-handling] by default commander calls `process.exit()` directly on `--help`, `--version`, and parse errors. `exitOverride()` converts these into thrown `CommanderError` objects with `.code` strings we can discriminate. This is what lets us map unknown flags → `UnknownFlagError` → exit 50 (D-02 CliError range).

2. **`commander.helpDisplayed` + `commander.version` → exit 0** — these are not errors; commander throws them only because of `exitOverride()`. The try/catch must treat them as success.

3. **`commander.unknownOption` / `commander.unknownCommand` → `UnknownFlagError` (exit 50)** — aligns with D-02.

4. **`parseAsync`** — required because phases 2-5 will add async action handlers. Using `parse` now would force a breaking refactor later.

5. **`.version(LOCI_VERSION, '-V, --version', ...)`** — explicit long+short flags. commander's default is `-V, --version` too, but declaring them explicitly makes the smoke test's expected output unambiguous.

6. **Hint string printed via default `.action()`** — clean separation from the `addHelpText('after', ...)` alternative. The default action only fires when no subcommand matches, which is the "empty args" case (D-15). `addHelpText` would also fire on `loci --help`, duplicating the hint.

7. **`./version.js` extension in the import** — even though `moduleResolution: "bundler"` does not require it, using `.js` future-proofs the code if someone later flips to NodeNext. tsup strips it regardless.

8. **`main()` returns a number, then calls `process.exit`** — keeps the function testable; tests can call `main(['node', 'loci', '--version'])` and assert the return value without spawning a subprocess. The E2E tests (D-16) still spawn to verify the full binary path.

## Feature Stubs (src/config/index.ts, etc.)

Per D-06, each feature folder gets a stub that throws `NotImplementedError`. Pattern:

```ts
// src/config/index.ts
import { NotImplementedError } from '../errors.js';
import type { ConfigLoader, ResolvedConfig } from '../types.js';

export const configLoader: ConfigLoader = {
  async load(_cwd: string): Promise<ResolvedConfig> {
    throw new NotImplementedError('ConfigLoader (Phase 2)');
  },
};
```

Same shape for `src/commands/index.ts`, `src/resolver/index.ts`, `src/executor/index.ts` — each exports a typed implementation that throws. The `type` imports ensure zero runtime overhead; the `void _arg` / underscore-prefix pattern silences unused-arg lint.

**Phase 1 cli.ts does NOT import these stubs.** They exist to give Phases 2-5 a predictable landing spot (D-06 rationale). Phase 2's first task is "replace the stub body in `src/config/index.ts`" — no file creation, no import-wiring changes elsewhere.

## vitest Config

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    reporters: ['default'],
    pool: 'threads',
    isolate: true,
    testTimeout: 10_000, // E2E spawn tests may take a few seconds on Windows CI
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/index.ts'], // stub indexes are trivially re-covered when real
    },
  },
});
```

**Notes:**
- **`environment: 'node'`** — not `'jsdom'`. No browser overhead.
- **`include: ['src/**/__tests__/**/*.test.ts']`** — matches D-08 layout; tests are co-located with source.
- **`pool: 'threads'`** — default, fastest for pure-JS tests. `'forks'` only needed if tests mutate global state across files.
- **`testTimeout: 10_000`** — E2E spawn tests on Windows CI are noticeably slower than Linux; 10s is generous.
- **No `globals: true`** — force explicit `import { describe, it, expect } from 'vitest'`. Cleaner and helps biome's unused-import detection.

## biome Config

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.11/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "includes": ["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      },
      "style": {
        "useImportType": "error",
        "noNonNullAssertion": "warn"
      },
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "all",
      "arrowParentheses": "always"
    }
  }
}
```

**Notes:**
- **Biome 2.x is a single binary** — zero transitive npm deps beyond the `@biomejs/biome` package itself. This makes `npm ci` noticeably faster than eslint+prettier. [VERIFIED: `npm view @biomejs/biome dependencies` returned an empty object for 2.4.11]
- **`useImportType: error`** — forces `import type { Foo } from ...` for type-only imports. Matches `verbatimModuleSyntax: true` in tsconfig.
- **`recommended: true`** — enables Biome's curated lint set. If any rule proves noisy during Phase 1, flip it to `"warn"` individually rather than disabling wholesale.
- **`useIgnoreFile: true`** — Biome reads `.gitignore` to skip `dist/`, `node_modules/`, etc.
- **`$schema` version pinned** — matches the exact biome version we depend on, so editor LSP features are accurate.

**Verification commands:**
- `npx biome check .` — lint + format check (CI mode)
- `npx biome check --write .` — auto-fix
- `npx biome init` — scaffolds a default `biome.json` if starting from scratch. [CITED: https://biomejs.dev/guides/getting-started/]

## GitHub Actions Workflow

Path: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  workflow_dispatch:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build-test-lint:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Test
        run: npm test

      - name: Smoke check — loci --version
        run: node dist/cli.mjs --version
```

**Point-by-point rationale:**

1. **`on.push.branches: [main]`** — D-12 "push to main" trigger. Feature branches only get CI via their PR.
2. **`on.pull_request.types` includes `ready_for_review`** — draft PRs still run CI when marked ready; draft PRs run CI on every push by default.
3. **`workflow_dispatch`** — D-12 "manual dispatch".
4. **`concurrency` with `cancel-in-progress: true`** — avoids stacking runs when a dev force-pushes. Saves CI minutes.
5. **`fail-fast: false`** — if Windows fails but Ubuntu passes, we still want to see the Ubuntu result. Critical for cross-platform debugging.
6. **Matrix: `[ubuntu-latest, windows-latest, macos-latest]` × `[20, 22]`** = 6 jobs, matches D-09 + D-10.
7. **`actions/setup-node@v4` with `cache: npm`** — enables the built-in npm cache keyed on `package-lock.json`. No separate `actions/cache` step needed. [CITED: https://github.com/actions/setup-node#caching-global-packages-data]
8. **`npm ci`** — reproducible install from lockfile. Fails if `package-lock.json` is missing or drifted. **This requires the planner to commit `package-lock.json` on the first Phase 1 commit.**
9. **Step order: typecheck → lint → build → test → smoke** —
   - Typecheck first: fails fastest on type regressions.
   - Lint: catches style before the slower build.
   - Build: produces `dist/cli.mjs` that the smoke check needs.
   - Test: vitest includes E2E tests that spawn `node dist/cli.mjs` — they need the build artifact.
   - Smoke: **the last gate** — directly executes the published-shape binary, asserting the shebang + bin shim are correct. On Windows, this runs via `node dist/cli.mjs` (not `.\dist\cli.mjs`), which sidesteps the need for a `.cmd` shim at CI time. The npm i -g test happens at Phase 5 publish-verification.
10. **`actions/checkout@v4`** — currently stable. [VERIFIED: https://github.com/actions/checkout/releases — v4 is latest]
11. **No `permissions:` block** — default read-only token suffices; CI doesn't push tags, publish, or comment on PRs.

**Real-Windows verification:** `windows-latest` resolves to Windows Server 2022 on GitHub Actions (not WSL). [CITED: https://github.com/actions/runner-images#available-images] The `node dist/cli.mjs --version` step runs directly under PowerShell/cmd, which exercises the exact cold-start path end-users will hit via `loci.cmd`. D-10's "real Windows" requirement is satisfied.

**Gotcha — Windows line endings:** If the repo includes a `.gitattributes` with `* text=auto eol=lf`, vitest/biome/tsup all handle LF uniformly. If NOT, Windows checkouts may rewrite `src/**.ts` to CRLF, which biome will then flag as format errors. **Planner must include `.gitattributes`** with at least:

```
* text=auto eol=lf
*.ps1 text eol=crlf
```

## Cold-Start Strategy (FND-03)

**Phase 1's budget check is a smoke test, not a microbenchmark (D-11).** But the architecture still has to hit <300ms on the target hardware, so the planner must enforce the following invariants even in Phase 1:

| Invariant | Why | How enforced in Phase 1 |
|-----------|-----|-------------------------|
| Single-file bundle | Every extra file import adds a Node resolve + disk read (~2-5 ms each) | tsup `noExternal: [/.*/]`, `splitting: false` |
| No fs reads at startup | fs operations dominate cold start below 100ms | tsup `define` replaces `__LOCI_VERSION__` at build time (D-14) |
| No dynamic imports | `import('foo')` defers load and is not tree-shaken | Code uses static `import` only |
| No top-level async work | Top-level `await` blocks the main entry | `main()` is invoked synchronously; await happens inside |
| No heavy deps | chalk, ora, boxen are each 20-60ms load time | None in dependency list; use ANSI codes directly or `util.styleText` from Node 20 [CITED: https://nodejs.org/api/util.html#utilstyletextformat-text-options] |

**Expected Phase 1 cold start:** 40-80ms on a modern laptop for `loci --version` (commander v14 + single-file bundle). [ASSUMED — measured figures in STACK.md §"Cold-Start Budget" say "50-150ms" for a similar stack; Phase 1 has less code so should be at the low end.] Well under the 300ms budget.

**Phase 5 deferred gate:** hyperfine run with 10 iterations on all 3 OSes, fail build if mean > 300ms (D-11 defers this to Phase 5 to avoid flake on tiny codebase).

## Cross-Platform Bin Shim

Per FND-02, `npm i -g .` must produce a runnable `loci` binary on Windows 10+, Linux, and macOS.

**What npm does automatically (no action on our side beyond the shebang):**

1. On **POSIX** (Linux, macOS): `npm` creates a symlink `<npm-prefix>/bin/loci → <install-path>/dist/cli.mjs`. The shebang `#!/usr/bin/env node` makes the file directly executable. The executable bit must be set — tsup's `banner` + esbuild preserves it; if a tsup version regresses this, the planner must add a postbuild `chmod`. **Test command for the planner:** `stat -c '%a' dist/cli.mjs` on Linux must print `755`.

2. On **Windows**: npm's `cmd-shim` [CITED: https://github.com/npm/cmd-shim] reads the shebang from `dist/cli.mjs` and generates three shim files in `<npm-prefix>\`:
   - `loci` — POSIX shell script (for Git Bash / MSYS)
   - `loci.cmd` — Batch wrapper for cmd.exe and PowerShell
   - `loci.ps1` — PowerShell wrapper

   All three forward to `node.exe "dist\cli.mjs" %*`. The `#!/usr/bin/env node` shebang is the trigger — without it, cmd-shim assumes a POSIX binary and the Windows shims fail.

3. **PATHEXT and `.cmd` shims** — this is the PITFALLS.md §2 concern, but it applies to commands *spawned by* loci, not to loci itself. Phase 4 (executor) must use execa to handle PATHEXT when spawning children. Phase 1 is the *producer* of a `.cmd` shim (via npm cmd-shim), not the *consumer*. No Phase 1 code needs to handle PATHEXT.

**What the Phase 1 CI smoke test verifies:** only that `node dist/cli.mjs --version` exits 0 with the expected stdout. It does NOT verify `npm i -g .` + `loci --version` — that test lives in Phase 5 (distribution) because `npm i -g` in CI requires either a global writable prefix or `sudo`, and adds runner-specific flake. **For Phase 1, `node dist/cli.mjs --version` is sufficient to prove the bundle is runnable on each OS.**

## Architecture Patterns

### Pattern 1: Feature-folder + barrel index

**What:** Each pipeline stage lives in its own directory (`src/config/`, `src/commands/`, etc.) with a single `index.ts` export. Phases 2-5 replace the stub body without touching import sites elsewhere.

**When to use:** Every pipeline stage in loci. Locked by D-05.

### Pattern 2: Error-as-value via `main(): Promise<number>`

**What:** The `main` function returns an exit code; the single entry point calls `process.exit(code)`. All error-to-exit-code mapping happens inside `main`'s try/catch, not at throw sites.

**When to use:** Every CLI entry. Lets unit tests exercise `main()` directly without subprocess spawning.

### Pattern 3: Build-time constant injection via esbuild `define`

**What:** Source declares `declare const __LOCI_VERSION__: string`; tsup's `define` replaces every use of the identifier with the JSON-quoted version string at bundle time.

**When to use:** Any value known at build time that you would otherwise fetch via `fs.readFileSync(package.json)` — version strings, build timestamps, git SHA. Zero runtime cost; cold-start-friendly.

### Anti-Patterns to Avoid

- **`fs.readFileSync('package.json')` for version.** Adds an fs syscall on every `loci --version` invocation; brittle when the bundle is relocated by npm. Use tsup `define` (D-14).
- **`process.exit(code)` called deep inside a function.** Scatters exit logic across the codebase and breaks unit tests. Only the very top-level `main().then(process.exit)` call should exit.
- **Declaring error subclasses without `Error.cause` plumbing.** Breaks the ES2022 contract; downstream consumers can't walk the causal chain. Use `super(message, { cause })`.
- **Skipping `.exitOverride()` on the commander Program.** Commander calls `process.exit` internally on `--help` / unknown flags, bypassing our error hierarchy and making exit-code mapping impossible.
- **`include` in `tsconfig.json` that pulls `**/*.ts`.** Picks up test files, which slows typecheck and leaks test types into the build. Either list explicit paths or use a separate `tsconfig.test.json`.
- **Publishing `src/` in the npm tarball.** `files: ["dist"]` in package.json is the fix.
- **Committing `dist/`.** Add `dist/` to `.gitignore`; the CI `build` step regenerates it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript-to-ESM bundling | Custom esbuild script | tsup | tsup wraps esbuild with CLI-friendly defaults (shebang, define, single-file output) that take 100+ lines of plumbing to replicate |
| Shebang injection in output | `head -1 dist/cli.mjs` + sed workflow | tsup `banner.js` | Preserves executable bit, handles both ESM and CJS formats, survives incremental builds |
| Version constant | `JSON.parse(readFileSync('package.json'))` at runtime | tsup `define` | Zero cold-start cost; works after relocation; no fs error handling needed |
| Error hierarchy boilerplate | Hand-written `Object.setPrototypeOf` fixups | Native ES2022 class extends Error | `target: "ES2022"` compiles correctly without the legacy workaround |
| `Error.cause` plumbing | Custom `.inner` / `.wrapped` properties | Native `super(msg, { cause })` | ES2022 standard; inspector, `util.inspect`, and error reporters all understand it |
| CLI arg parsing | Hand-rolled `process.argv.slice(2)` loop | commander v14 | Handles `--help`, `--version`, `--`, short/long flags, and subcommand routing — all the edge cases that take weeks to get right |
| Lint + format config coordination | eslint + prettier + plugins | @biomejs/biome | Single binary, single config file, 20-25× faster than prettier |
| Test ESM + TS loader | ts-jest / babel-jest | vitest | Vitest runs TS via esbuild natively with zero transform config |
| cross-platform chmod in build | Conditional shell scripts | tsup banner (preserves exec bit) or `node -e "fs.chmodSync(...)"` in a postbuild | Avoid shelling out in build scripts |
| Windows bin shim generation | Custom `.cmd` template | npm's built-in cmd-shim (automatic on `npm i -g`) | Nothing to do — just ship the shebang |

**Key insight:** Phase 1 is a scaffolding phase, and 90% of the work is gluing well-designed tools together. Every task that feels like "writing a little helper script" is probably a sign you should use a config option on tsup/biome/vitest instead. When in doubt, consult each tool's docs for a config flag before writing glue code.

## Common Pitfalls

### Pitfall 1: tsup not injecting shebang on subsequent builds

**What goes wrong:** First `npm run build` produces a shebang; a later build (or a tsup config reload) emits a file without shebang, or the shebang lands on line 2 after an unexpected comment.

**Why it happens:** Some tsup/esbuild version combos emit a `// @sourceMappingURL` comment at the top in certain config combinations, which pushes the shebang off line 1. npm cmd-shim and POSIX exec both require the shebang to be the *first* bytes of the file.

**How to avoid:** Set `sourcemap: false` in tsup.config.ts (we do). After every build, CI must run a verification: `head -1 dist/cli.mjs | grep -q '^#!/usr/bin/env node'`. Add this as a build-script sanity check, not just a test. Suggested:

```json
"build": "tsup && node -e \"const c = require('fs').readFileSync('dist/cli.mjs','utf8').slice(0,19); if (c !== '#!/usr/bin/env node') { console.error('shebang missing'); process.exit(1); }\""
```

**Warning signs:** On Windows, `loci.cmd` exists but `loci` (POSIX shim) doesn't; or the Linux smoke test fails with `exec format error`.

### Pitfall 2: `engines.node` mismatch between local dev and published package

**What goes wrong:** Developer uses Node 22 locally; someone on Node 20.4.0 tries to install and gets a warning (or error, depending on engine-strict). execa 9.x explicitly requires `>=20.5.0`, not `>=20.0.0`.

**Why it happens:** Setting `engines.node: ">=20"` looks correct but doesn't match the execa floor.

**How to avoid:** Use the exact string `">=20.5.0"` (not `"^20.0.0"`, not `"20.x"`). Test: on a fresh clone, `npm install` should succeed without warnings on Node 20.5.0+.

**Warning signs:** npm install prints `EBADENGINE Unsupported engine`.

### Pitfall 3: `commander.exitOverride()` catching too much

**What goes wrong:** `--help` and `--version` throw `CommanderError` with code `commander.helpDisplayed` and `commander.version` respectively. If the try/catch treats these as errors, `loci --help` exits with code 1.

**Why it happens:** The intuitive "catch all commander errors → exit 50" pattern swallows the success paths.

**How to avoid:** Explicitly whitelist `commander.helpDisplayed` and `commander.version` as success paths in the catch block. See the cli.ts pattern above.

**Warning signs:** Smoke test `node dist/cli.mjs --version` exits non-zero despite printing the version correctly.

### Pitfall 4: CI green on macOS + Linux but Windows silently broken

**What goes wrong:** vitest / biome pass on 2/3 OSes. Windows fails only at smoke time with a cryptic error. Turns out the issue was a hardcoded path separator (`/` in a fs path) or a case-sensitive import (`from './Errors'` when the file is `errors.ts`).

**Why it happens:** macOS is case-insensitive by default; Linux is case-sensitive but Node `require`/`import` may not verify case. Windows is case-insensitive but uses `\` natively.

**How to avoid:** Set `"forceConsistentCasingInFileNames": true` in tsconfig (we do). Never write path separators as literals in source — always use `path.join()` / `path.resolve()`. `.gitattributes` `eol=lf` keeps line endings consistent so biome doesn't flag them.

**Warning signs:** "Cannot find module" errors that mention case mismatch; git diff noise when switching between OSes.

### Pitfall 5: `tsc --noEmit` type-checks files that tsup doesn't compile

**What goes wrong:** `tsconfig.json` has `"include": ["**/*.ts"]` which picks up `scripts/`, test-only helpers, or a top-level `build.ts`. Typecheck passes or fails on files the build never sees.

**Why it happens:** The "include everything" default is convenient but decouples typecheck from build.

**How to avoid:** `"include": ["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"]` — explicit. Phase 1 adds only these three roots; Phase 2-5 touch `src/**` and nothing else.

**Warning signs:** Typecheck passes locally but fails in CI when scripts directory is restored.

### Pitfall 6: `npm ci` fails because `package-lock.json` is missing

**What goes wrong:** Developer runs `npm install` once, commits `package.json` but not `package-lock.json`, CI tries `npm ci` and errors with `The package-lock.json file was created with an old version of npm` or `Missing: package-lock.json`.

**Why it happens:** Initial scaffolding often forgets the lockfile.

**How to avoid:** The Phase 1 "initial commit" task must include `package-lock.json`. Verify with `git ls-files | grep package-lock.json` before tagging the Phase 1 complete.

**Warning signs:** CI job fails in the "Install dependencies" step.

### Pitfall 7: `noUncheckedIndexedAccess` breaks `process.argv` handling

**What goes wrong:** With `"noUncheckedIndexedAccess": true`, `process.argv[2]` is typed `string | undefined`. Code that does `const alias = process.argv[2]; alias.toLowerCase();` fails to compile.

**Why it happens:** The strict flag is correct but surprises developers who treat argv as always present.

**How to avoid:** Either accept the stricter types (prefix with `?.` or add explicit undefined guards), or use commander — which already gives you a typed `program.args` array. Since Phase 1's cli.ts delegates to commander entirely, this pitfall should not occur in Phase 1 code. Flag it for Phase 3+ when CLI action handlers start destructuring args.

## Runtime State Inventory

**Not applicable.** Phase 1 is greenfield creation — no pre-existing databases, services, scheduled tasks, secrets, or build artifacts to rename. The project directory contains only `CLAUDE.md` today; Phase 1 creates everything else from scratch.

- **Stored data:** None — verified by `ls /home/developer/projects/jervis/` returning only `CLAUDE.md`.
- **Live service config:** None.
- **OS-registered state:** None.
- **Secrets/env vars:** None.
- **Build artifacts:** None.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime + build | Assumed on dev machine | — | Install Node 20.5.0+ before starting Phase 1 |
| npm | Package install | Ships with Node | — | — |
| git | CI + `.gitattributes` handling | Assumed | — | — |
| commander@14.0.3 (npm) | CLI parsing | ✓ | 14.0.3 | — |
| execa@9.6.1 (npm) | Executor stub type-only import | ✓ | 9.6.1 | — |
| yaml@2.8.3 (npm) | ConfigLoader stub (unused in Phase 1) | ✓ | 2.8.3 | — |
| tsup@8.5.1 (npm) | Build | ✓ | 8.5.1 | — |
| vitest@4.1.4 (npm) | Test runner | ✓ | 4.1.4 | — |
| @biomejs/biome@2.4.11 (npm) | Lint + format | ✓ | 2.4.11 | — |
| typescript@6.0.2 (npm) | Typecheck | ✓ | 6.0.2 | — |
| GitHub Actions runners (ubuntu-latest, windows-latest, macos-latest) | CI matrix | ✓ (public runners) | — | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

All npm package versions were verified against the registry on 2026-04-10 via `npm view <pkg> version`. [VERIFIED: npm registry]

## Code Examples

### Example 1: package.json with all correct fields

See §"package.json Canonical Shape" above.

### Example 2: tsup bundle-and-shebang config

See §"tsup.config.ts" above.

### Example 3: Error hierarchy with Error.cause

See §"src/errors.ts Pattern" above.

### Example 4: Smoke E2E test (vitest + spawn)

```ts
// src/__tests__/cli.e2e.test.ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(process.cwd(), 'dist/cli.mjs');

function runCli(args: readonly string[]): { stdout: string; stderr: string; code: number } {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.status ?? -1,
  };
}

describe('loci CLI (E2E)', () => {
  it('--version prints semver and exits 0', () => {
    const { stdout, code } = runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help prints usage and exits 0', () => {
    const { stdout, code } = runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: loci');
  });

  it('no args prints help + phase-1 hint and exits 0', () => {
    const { stdout, code } = runCli([]);
    expect(code).toBe(0);
    expect(stdout).toContain('no aliases defined yet');
  });

  it('unknown flag exits with code 50 (CliError range)', () => {
    const { code, stderr } = runCli(['--bogus']);
    expect(code).toBe(50);
    expect(stderr).toContain('CLI_UNKNOWN_FLAG');
  });
});
```

**Notes:**
- Uses **`spawnSync` with `process.execPath`** — not `node` — to avoid Windows PATH resolution issues. `process.execPath` is the absolute path to the current Node binary, guaranteed to exist.
- **`CLI` resolved from `process.cwd()`** — CI always runs from the repo root, so this path is stable.
- **Tests require `npm run build` to have run first.** The CI workflow orders `build → test` so `dist/cli.mjs` exists when vitest runs. Locally, `npm test` alone fails if `dist/` is missing — add `"test": "tsup && vitest run"` if you want tests to build first, or document "run `npm run build` before `npm test`". **Recommendation:** keep `test` as `vitest run` and let CI's explicit ordering handle it; adds a `"test:full": "npm run build && vitest run"` convenience if needed.

### Example 5: Error unit test (instanceof chain + code uniqueness)

```ts
// src/__tests__/errors.test.ts
import { describe, it, expect } from 'vitest';
import {
  LociError,
  ConfigError,
  CommandError,
  YamlParseError,
  CircularAliasError,
  NotImplementedError,
  ExitCode,
  exitCodeFor,
  // ... import every concrete subclass
} from '../errors.js';

describe('LociError hierarchy', () => {
  it('YamlParseError extends ConfigError extends LociError extends Error', () => {
    const err = new YamlParseError('.loci/config.yml', 7, new Error('bad token'));
    expect(err).toBeInstanceOf(YamlParseError);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err).toBeInstanceOf(LociError);
    expect(err).toBeInstanceOf(Error);
  });

  it('propagates cause via Error.cause', () => {
    const inner = new Error('root');
    const err = new YamlParseError('f.yml', 1, inner);
    expect(err.cause).toBe(inner);
  });

  it('sets name to the concrete subclass', () => {
    const err = new CircularAliasError(['a', 'b', 'a']);
    expect(err.name).toBe('CircularAliasError');
  });

  it('every concrete subclass has a unique code', () => {
    const instances = [
      new YamlParseError('f', 1, null),
      new CircularAliasError(['a']),
      new NotImplementedError('foo'),
      // ... one of each concrete subclass
    ];
    const codes = instances.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('maps category to the correct exit code', () => {
    expect(exitCodeFor(new YamlParseError('f', 1, null))).toBe(ExitCode.CONFIG_ERROR);
    expect(exitCodeFor(new CircularAliasError(['a']))).toBe(ExitCode.COMMAND_ERROR);
    expect(exitCodeFor(new NotImplementedError('x'))).toBe(ExitCode.CLI_ERROR);
  });
});
```

### Example 6: Repository hygiene files

**`.gitignore`**
```
node_modules/
dist/
coverage/
*.log
.DS_Store
.vscode/
.idea/
# Project-specific
.loci/secrets.yml
.loci/local.yml
```

**`.gitattributes`**
```
* text=auto eol=lf
*.ps1 text eol=crlf
*.cmd text eol=crlf
```

**`.editorconfig`**
```
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

**`.nvmrc`**
```
22
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `chmod +x dist/cli.mjs` postbuild script | tsup `banner.js: '#!/usr/bin/env node'` (preserves exec bit) | tsup 6.x+ | No more cross-platform chmod script; no `shx` dep |
| `import pkg from './package.json'` for version | tsup `define: { __LOCI_VERSION__: JSON.stringify(pkg.version) }` | esbuild + tsup always | Zero fs reads at startup |
| `Object.setPrototypeOf(this, new.target.prototype)` in error subclasses | Native `class X extends Error` | TypeScript `target: "ES2022"` | Simpler code; prototype chain works natively |
| Custom `.cause` / `.inner` error wrapping | Native `super(msg, { cause })` | Node 16.9 / ES2022 | Inspector, `util.inspect`, reporters all understand it |
| eslint + prettier + plugins | @biomejs/biome 2.x (single binary) | Biome 2.0 (June 2025) [CITED: https://biomejs.dev/blog/biome-v2/] | 20-25× faster; single config file; zero transitive deps |
| js-yaml 4.x with YAML 1.1 coercion | `yaml` (eemeli) with YAML 1.2 default | eemeli/yaml 2.x | No Norway Problem |
| Jest + ts-jest | Vitest 4.x native ESM + TS | Vitest 1.0+ | Zero transform config; faster |
| commander v12 / v13 | commander v14.0.3 | v14 released 2025 | CJS+ESM compat maintained; v15 ESM-only is pre-release |

**Deprecated / outdated:**
- **`tsc` without bundling for CLI tools** — replaced by tsup for cold-start reasons.
- **`shx chmod` in build script** — tsup banner covers it.
- **Dual-publish (CJS + ESM)** — not applicable to CLIs; nobody imports a CLI tool.
- **commander v15 pre-release** — do not use; ESM-only and requires Node ≥22.12.0.
- **js-yaml** — use `yaml` instead for YAML 1.2 semantics.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TypeScript 6.0.2 works cleanly with tsup 8.5.1 + `moduleResolution: "bundler"` + `verbatimModuleSyntax: true` | Standard Stack / tsconfig | LOW — tsup's peer is `typescript: >=4.5.0`, and esbuild has supported TS 6 syntax from its last major. Verify by running `npm run typecheck` on the Phase 1 scaffold; if it fails, downgrade to `^5.7.0`. |
| A2 | tsup `banner.js` preserves the POSIX executable bit on `dist/cli.mjs` without a separate `chmod` step | tsup.config.ts | LOW — behaviour confirmed in tsup docs and esbuild changelog, but I did not rerun it locally in this session. Mitigation: the planner adds a postbuild shebang-sanity check + optional `fs.chmodSync(..., 0o755)` fallback to the build script. |
| A3 | `windows-latest` runner on GitHub Actions is Windows Server 2022 (real Windows, not WSL) | GitHub Actions Workflow | VERY LOW — documented at github.com/actions/runner-images and has been stable for 2+ years. Satisfies D-10 "real Windows". |
| A4 | commander v14's `exitOverride()` throws `CommanderError` with `.code` fields `commander.helpDisplayed` and `commander.version` for the success paths | src/cli.ts Pattern | LOW — matches documented behaviour in commander's README and has been stable since v8. Will be verified by the Phase 1 E2E test (if the test fails, the catch block's whitelist needs adjustment). |
| A5 | Phase 1 cold start will be 40-80ms on a modern laptop | Cold-Start Strategy | LOW — figure extrapolated from STACK.md's "50-150ms" estimate for a similar bundled stack. D-11 defers the actual hyperfine gate to Phase 5, so this is an expectation not a contract. |
| A6 | `"include": ["src/**/*.ts", "tsup.config.ts", "vitest.config.ts"]` in tsconfig is sufficient — no files land outside these paths in Phase 1 | tsconfig.json | LOW — if Phase 1 adds e.g. `scripts/` later, the planner must update `include`. Not a correctness risk, just a maintenance note. |

**If this table feels short:** All library versions (A1 excepted), config file shapes, and CI behaviours in this research were verified against the live npm registry, official docs, or the existing STACK.md/PITFALLS.md/ARCHITECTURE.md research artifacts in this project.

## Open Questions

1. **TypeScript 5.x vs 6.x.** CLAUDE.md says "TypeScript 5.x" but the live npm latest is 6.0.2. This is drift between when CLAUDE.md was last edited and today. **Recommendation:** use `^6.0.2` because it's stable-latest as of 2026-04-10 and has better LSP/ErrorMessage quality. If the user has a reason to stick with 5.x (e.g., a widely-used plugin that lags), downgrade to `^5.7.0` and the rest of the config works unchanged. **Planner action:** raise this as a clarifying question if appropriate, or proceed with 6.0.2 and note it in the commit message.

2. **License file in Phase 1 or Phase 5?** CONTEXT.md Claude's Discretion says "MIT unless user flags otherwise; LICENSE file lands in Phase 5". The deferred list confirms this. **Planner action:** do NOT add LICENSE in Phase 1; add a `"license": "MIT"` field in `package.json` as a placeholder (npm expects this; absent field triggers a warning on `npm publish`).

3. **`repository` / `bugs` / `homepage` fields in package.json.** Phase 1 is pre-any-git-remote. **Planner action:** leave these fields empty or omit them entirely in Phase 1; Phase 5 distribution prep will populate from the actual GitHub URL once the repo is public.

4. **Coverage threshold in vitest config.** Phase 1 has tiny surface area; setting a coverage gate (e.g., 80%) now risks becoming noisy. **Recommendation:** collect coverage data (`reporter: ['text', 'lcov']`) but do NOT enforce a threshold in Phase 1. Add thresholds in Phase 5 once the codebase is stable.

5. **Should `npm run smoke` be part of the local dev loop or CI-only?** A developer changing `src/cli.ts` won't rerun smoke locally because `npm test` already includes E2E tests. **Recommendation:** keep `smoke` as a CI-only script — it's redundant locally but explicit in CI as the final gate.

## Security Domain

**`security_enforcement` is not set in `.planning/config.json`** — treating as enabled (the default). Phase 1 is scaffolding-only; the security surface is narrow.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V1 Architecture | yes | Typed error hierarchy with fixed category→exit code mapping; single entry/exit point in `main()` — this is the foundation that Phases 2-5 will use to enforce secrets redaction, shell-safety, and input validation |
| V2 Authentication | no | N/A — loci has no user authentication |
| V3 Session Management | no | N/A — stateless CLI |
| V4 Access Control | no | N/A — runs with user's own permissions |
| V5 Input Validation | partial | Phase 1 only handles `process.argv` via commander, which is already validated by commander's schema. User-supplied YAML content validation arrives in Phase 2. |
| V6 Cryptography | no | N/A — Phase 1 has no crypto operations |
| V7 Error Handling & Logging | yes | `LociError` base class carries structured `code` / `category` / `suggestion` fields; **error messages must not embed secret values** — the `ShellInjectionError` example in §"src/errors.ts Pattern" deliberately omits the offending value from `message`. This pattern is locked in Phase 1 and enforced in all later phases. |
| V8 Data Protection | partial | Secrets handling lives in Phase 2 (ConfigLoader). Phase 1 establishes the *contract* via `ResolvedConfig.secretKeys` in `src/types.ts` — downstream code knows which keys to redact. |
| V9 Communications | no | N/A |
| V10 Malicious Code | no | N/A |
| V11 Business Logic | no | N/A |
| V12 Files & Resources | no | Phase 1 does no file I/O at runtime (build-time `__LOCI_VERSION__` inlining removes the only candidate). Phases 2-5 handle file access. |
| V13 API | no | N/A — CLI only |
| V14 Configuration | yes | tsconfig `strict: true` + `noUncheckedIndexedAccess` + biome `noExplicitAny: error` enforce a secure-by-default coding discipline; CI lint gate blocks merges that violate it |

### Known Threat Patterns for Phase 1 (Scaffolding)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Dependency confusion (a malicious `loci` on npm) | Tampering | Verify `npm info loci` before publishing (Phase 5 task, flagged in STATE.md) |
| Supply-chain attack via transitive dep | Tampering | Pin runtime deps exactly (no `^`); re-audit on every bump; `npm audit` in CI (consider adding as a warning step in Phase 5) |
| Shebang injection in bundle | Tampering | tsup `banner.js` is a static literal; esbuild does not interpolate — there's no injection vector. Verified by the shebang sanity check in the build script. |
| Secret in published tarball | Information Disclosure | `files: ["dist"]` in package.json excludes `src/`, `.loci/`, `.env`, etc. Verify with `npm pack --dry-run` before Phase 5 publish. |
| Malicious `package.json` scripts running on install | Tampering / Elevation | Phase 1's `package.json` has NO `postinstall` script. Contributors who clone the repo run `npm ci` without arbitrary script execution beyond the declared `prepublishOnly`. |
| Error messages leaking secrets | Information Disclosure | `LociError` pattern omits values from `message`; enforced by convention in Phase 1, tested in Phase 2+ |

**Phase 1 has no runtime I/O, no network, no file writes, no child-process execution.** The attack surface is limited to: (1) the published npm tarball's contents, (2) the build-time code that runs on contributor machines. Both are covered by the `files` field and the absence of `postinstall` scripts respectively.

## Sources

### Primary (HIGH confidence)

- [VERIFIED via `npm view`] commander 14.0.3, execa 9.6.1, yaml 2.8.3, tsup 8.5.1, vitest 4.1.4, @biomejs/biome 2.4.11, typescript 6.0.2 — all confirmed against npm registry on 2026-04-10
- [CITED] https://github.com/tj/commander.js — `.exitOverride()`, `CommanderError.code` values, v14 features
- [CITED] https://tsup.egoist.dev/ — `banner.js` shebang injection, `define` for build-time constants, `noExternal: [/.*/]` pattern
- [CITED] https://esbuild.github.io/api/#define — identifier replacement semantics for `__LOCI_VERSION__`
- [CITED] https://nodejs.org/api/packages.html — `type: "module"`, `bin` field, engine requirements
- [CITED] https://nodejs.org/api/util.html#utilstyletextformat-text-options — native `util.styleText` avoids chalk dep
- [CITED] https://docs.npmjs.com/cli/v10/configuring-npm/package-json — `files` field, `bin` field, `prepublishOnly`
- [CITED] https://github.com/npm/cmd-shim — Windows `.cmd` / `.ps1` shim generation on `npm i -g`
- [CITED] https://biomejs.dev/guides/getting-started/ — `biome init`, recommended preset
- [CITED] https://vitest.dev/config/ — `include`, `pool`, `environment`, `testTimeout`
- [CITED] https://github.com/actions/runner-images — windows-latest = Windows Server 2022 (real Windows)
- [CITED] https://github.com/actions/setup-node#caching-global-packages-data — built-in npm cache
- [CITED] https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/cause — ES2022 `Error.cause` contract
- [CITED] https://www.typescriptlang.org/docs/handbook/modules/reference.html#bundler — `moduleResolution: "bundler"`
- [CITED] https://biomejs.dev/blog/biome-v2/ — Biome 2.x features and performance numbers

### Secondary (MEDIUM confidence)

- `.planning/research/STACK.md` — pre-existing project research, cross-referenced for version pins and cold-start strategy
- `.planning/research/ARCHITECTURE.md` — pipeline component boundaries that inform the feature-folder layout
- `.planning/research/PITFALLS.md` §2 (Windows PATHEXT), §13 (ESM vs CJS) — establishes the cross-platform discipline
- `.planning/research/SUMMARY.md` — Phase 1 rationale and build-order justification
- CLAUDE.md — user-facing stack lockdown; currently says "TypeScript 5.x" but live registry shows 6.0.2 (drift documented as Open Question #1)

### Tertiary (LOW confidence / context only)

- [ASSUMED] Expected cold-start figures (40-80ms) — extrapolated from STACK.md's "50-150ms" estimate; will be measured for real in Phase 5

## Metadata

**Confidence breakdown:**

- **Standard Stack:** HIGH — all versions verified against npm registry on 2026-04-10; CLAUDE.md drift on TypeScript documented
- **package.json / tsconfig.json / tsup.config.ts shape:** HIGH — every field cross-referenced against tool docs; `define` + shebang + bundle pattern is the canonical tsup-for-CLI setup
- **Error hierarchy pattern:** HIGH — ES2022 `Error.cause` is native and locked by tsconfig `target`; `abstract class` discriminated union is idiomatic TypeScript 4.5+
- **GitHub Actions workflow:** HIGH — matrix shape locked by CONTEXT D-09/D-10; all action versions (`@v4`) are current stable
- **Cross-platform bin shim:** HIGH — npm cmd-shim behaviour is well-documented and has been stable for a decade
- **Cold-start estimates:** MEDIUM — extrapolated from prior research; Phase 1 has no hyperfine gate (D-11)
- **Pitfalls:** HIGH — each one has a concrete detection mechanism (sanity check command, tsconfig flag, or test assertion)

**Research date:** 2026-04-10
**Valid until:** ~2026-05-10 (30 days) for library versions; ~2026-07-10 (90 days) for CI actions and docs URLs. Re-verify versions before Phase 5 publish.
