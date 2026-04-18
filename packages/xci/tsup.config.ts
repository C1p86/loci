import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20.5',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  bundle: true,
  noExternal: [/.*/],
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  splitting: false,
  treeshake: true,
  banner: {
    // Shebang must be the literal first line for Unix exec() to recognize the interpreter.
    // The createRequire polyfill lets esbuild's `__require` shim resolve Node builtins like
    // `require('events')` when bundling CJS deps (commander) into an ESM output.
    js: "#!/usr/bin/env node\nimport { createRequire as __xci_createRequire } from 'node:module';\nconst require = __xci_createRequire(import.meta.url);",
  },
  define: {
    __XCI_VERSION__: JSON.stringify(pkg.version),
  },
  platform: 'node',
});
