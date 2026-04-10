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
  noExternal: [/.*/],
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  splitting: false,
  treeshake: true,
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __LOCI_VERSION__: JSON.stringify(pkg.version),
  },
  platform: 'node',
});
