/**
 * Removes non-symlink directories from packages/xci/node_modules.
 *
 * pnpm populates node_modules with symlinks. If something (e.g. a stray
 * `npm install` or a local `pnpm add`) writes real directories here, they
 * shadow the workspace symlinks and break the build. This script deletes
 * those real directories so `pnpm install` from the workspace root can
 * restore the correct symlinks.
 */
import { readdirSync, lstatSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const nmDir = join(pkgDir, 'node_modules');

if (!existsSync(nmDir)) process.exit(0);

const skip = new Set(['.bin', '.pnpm']);
const entries = readdirSync(nmDir).filter((name) => {
  if (name.startsWith('.') && !name.startsWith('@')) return false;
  if (skip.has(name)) return false;
  return !lstatSync(join(nmDir, name)).isSymbolicLink();
});

if (entries.length === 0) process.exit(0);

console.log(`Cleaning ${entries.length} non-symlink entries from node_modules...`);
for (const name of entries) {
  rmSync(join(nmDir, name), { recursive: true, force: true });
}
