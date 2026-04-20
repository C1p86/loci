import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

// Shared options that apply to all entries
const sharedOptions = {
  format: ['esm'] as const,
  target: 'node20.5' as const,
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  bundle: true,
  sourcemap: false,
  minify: false,
  splitting: false,
  treeshake: true,
  platform: 'node' as const,
  define: {
    __XCI_VERSION__: JSON.stringify(pkg.version),
  },
};

export default defineConfig([
  // --- CLI + Agent entries (Phase 6 D-16 fence: bundle everything except ws/reconnecting-websocket) ---
  {
    ...sharedOptions,
    entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' },
    // Bundle everything EXCEPT 'ws' and 'reconnecting-websocket' (Phase 6 D-16 fence).
    // tsup evaluates `noExternal` BEFORE `external` — the regex below must NOT match
    // either package, otherwise tsup would bundle them despite the `external` entry.
    // See: .planning/phases/06-monorepo-setup-backward-compat-fence/06-RESEARCH.md §Pitfall 1.
    noExternal: [/^(?!ws$|reconnecting-websocket$).*/],
    external: ['ws', 'reconnecting-websocket'],
    // Phase 8 Pitfall 6: prevent tsup/esbuild from inlining the agent entry into cli.mjs.
    // The dynamic `await import('./agent/index.js')` in cli.ts must remain a true runtime
    // import pointing to dist/agent.mjs (the separate entry). Using esbuildOptions to mark
    // the relative path as external for the cli entry only.
    esbuildOptions(options, context) {
      if (context.format === 'esm') {
        options.external = [...(options.external ?? []), './agent/index.js'];
      }
    },
    // Post-build rewrite: tsup emits a flat layout (`dist/cli.mjs` + `dist/agent.mjs`),
    // but the source preserves the TypeScript-style specifier `./agent/index.js` in
    // `await import('./agent/index.js')` (kept literal by the `esbuildOptions` external
    // above so agent code is NOT inlined into cli.mjs — Phase 8 Pitfall 6). At runtime
    // Node resolves that path relative to `dist/cli.mjs` and finds nothing, throwing
    // ERR_MODULE_NOT_FOUND. We rewrite the exact quoted literal to the sibling bundle
    // specifier so `xci --agent` works in published installs. `replaceAll` with a plain
    // string argument treats dots as literal characters — zero regex escape risk.
    async onSuccess() {
      const source = await readFile('./dist/cli.mjs', 'utf8');
      const transformed = source
        .replaceAll("'./agent/index.js'", "'./agent.mjs'")
        .replaceAll('"./agent/index.js"', '"./agent.mjs"');
      await writeFile('./dist/cli.mjs', transformed, 'utf8');
      process.stderr.write('[tsup] rewrote ./agent/index.js → ./agent.mjs in dist/cli.mjs\n');
    },
    clean: true,
    dts: false,
    banner: {
      // Shebang must be the literal first line for Unix exec() to recognize the interpreter.
      // The createRequire polyfill lets esbuild's `__require` shim resolve Node builtins like
      // `require('events')` when bundling CJS deps (commander) into an ESM output.
      js: "#!/usr/bin/env node\nimport { createRequire as __xci_createRequire } from 'node:module';\nconst require = __xci_createRequire(import.meta.url);",
    },
  },
  // --- DSL entry (Phase 9: subpath export for @xci/server consumption) ---
  // yaml is declared as a runtime dependency of xci; externalising it from the dsl bundle
  // keeps dsl.mjs < 100KB (D-39 bundle hygiene). Consumers load yaml from xci's node_modules
  // via standard pnpm hoisting.
  {
    ...sharedOptions,
    entry: { dsl: 'src/dsl/index.ts' },
    external: ['yaml'],
    clean: false, // cli/agent already cleaned above; don't wipe their output
    // Phase 9: emit declarations for dsl entry only (xci/dsl consumed by @xci/server tsc -b).
    dts: {
      entry: { dsl: 'src/dsl/index.ts' },
      compilerOptions: {
        noEmitOnError: false,
        skipLibCheck: true,
      },
    },
  },
]);
