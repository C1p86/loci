/**
 * D-04 auto-discovery: every public repo factory (makeXxxRepo in repos/*.ts except
 * index.ts, for-org.ts, admin.ts) must have a corresponding <name>.isolation.test.ts
 * that exercises the two-org fixture.
 *
 * This is a pure file-system walk — no DB connection needed.
 * Named *.isolation.test.ts so it is included by vitest.integration.config.ts.
 *
 * RESEARCH §Auto-discovery isolation test (D-04) Option A.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPOS_DIR = join(__dirname, '..');
const TESTS_DIR = join(REPOS_DIR, '__tests__');

describe('D-04 repo isolation coverage (meta)', () => {
  const excluded = new Set(['index.ts', 'for-org.ts', 'admin.ts']);
  const repoFiles = readdirSync(REPOS_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .filter((f) => !excluded.has(f));

  it('at least 6 public repo files discovered', () => {
    expect(repoFiles.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of repoFiles) {
    const name = file.replace(/\.ts$/, '');
    it(`${name} has isolation test AND covers every makeXxxRepo export`, () => {
      const testFile = join(TESTS_DIR, `${name}.isolation.test.ts`);
      expect(
        existsSync(testFile),
        `missing ${testFile} — D-04 requires two-org isolation test for every public repo`,
      ).toBe(true);

      const src = readFileSync(join(REPOS_DIR, file), 'utf8');
      const exportedFactories = [...src.matchAll(/export function (make\w+Repo)/g)]
        .map((m) => m[1])
        .filter((name): name is string => name !== undefined);
      expect(
        exportedFactories.length,
        `${file} must export at least one makeXxxRepo function`,
      ).toBeGreaterThan(0);

      const testSrc = readFileSync(testFile, 'utf8');
      for (const factoryName of exportedFactories) {
        expect(
          testSrc,
          `${testFile} must reference ${factoryName} by name (import or call)`,
        ).toMatch(new RegExp(`\\b${factoryName}\\b`));
      }
    });
  }
});
