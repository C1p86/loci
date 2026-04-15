---
phase: 05-init-distribution
reviewed: 2026-04-15T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - LICENSE
  - README.md
  - package.json
  - src/__tests__/init.test.ts
  - src/cli.ts
  - src/init/index.ts
  - src/init/templates.ts
findings:
  critical: 0
  warning: 4
  info: 5
  total: 9
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-15T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Seven files were reviewed covering the `loci init` subcommand implementation, CLI entry point, templates, tests, and distribution metadata. The implementation is clean overall with good idempotency handling and correct CRLF normalisation in `.gitignore` processing. No critical security or data-loss issues were found.

Four warnings were identified: an unhandled filesystem error path in `runInit`, an unsafe cast on unknown errors in `handleError`, a missing pre-publish quality gate in `package.json`, and a weak idempotency assertion in the E2E test that would miss file-overwrite regressions. Five info items cover a stale CI badge placeholder, a nested-init footgun, a minor double-blank-line formatting edge case in `.gitignore` appending, no `exports` field in `package.json`, and the missing `typecheck` step from the build/test pipeline.

---

## Warnings

### WR-01: `runInit` propagates raw fs exceptions with no user-friendly message

**File:** `src/init/index.ts:114-129`
**Issue:** `mkdirSync`, `writeFileSync`, and `readFileSync` calls inside `runInit` are not wrapped in a try/catch. If the `.loci/` directory cannot be created (e.g., `EACCES` on a read-only filesystem, or `ENOENT` on a non-existent parent), Node.js throws a raw system error that bubbles up through `registerInitCommand`'s `.action()` callback unhandled. Commander swallows the thrown value without formatting it, so the user sees a raw stack trace on stderr instead of a clean `[LOCI_INIT_*]` error message.

**Fix:**
```typescript
export function runInit(cwd: string): void {
  const lociDir = join(cwd, '.loci');
  try {
    mkdirSync(lociDir, { recursive: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    process.stderr.write(`error [LOCI_INIT_MKDIR]: Cannot create .loci/ directory: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }

  const results: SummaryItem[] = [];
  try {
    writeIfAbsent(join(lociDir, 'config.yml'), CONFIG_YML, cwd, results);
    writeIfAbsent(join(lociDir, 'commands.yml'), COMMANDS_YML, cwd, results);
    writeIfAbsent(join(lociDir, 'secrets.yml.example'), SECRETS_EXAMPLE_YML, cwd, results);
    writeIfAbsent(join(lociDir, 'local.yml.example'), LOCAL_EXAMPLE_YML, cwd, results);
    ensureGitignore(cwd, results);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    process.stderr.write(`error [LOCI_INIT_WRITE]: Failed to write scaffold file: ${e.message}\n`);
    process.exitCode = 1;
    return;
  }

  printInitSummary(results);
}
```

---

### WR-02: Unsafe cast of unknown errors in `handleError` produces `"unexpected error: undefined"`

**File:** `src/cli.ts:238`
**Issue:** The catch-all branch casts `err` to `Error` and reads `.message`. If `err` is a string, a number, or a plain object without a `message` property, `.message` is `undefined` and the output becomes `"unexpected error: undefined"` — a confusing UX with no diagnostic information.

```typescript
process.stderr.write(`unexpected error: ${(err as Error).message}\n`);
```

**Fix:**
```typescript
const msg = err instanceof Error ? err.message : String(err);
process.stderr.write(`unexpected error: ${msg}\n`);
```

---

### WR-03: `prepublishOnly` does not run `typecheck` or `lint` — type errors ship silently

**File:** `package.json:27`
**Issue:** The `prepublishOnly` script only runs `build` (which uses esbuild/tsup and skips type-checking by design). A TypeScript type error that does not break transpilation can be introduced and published without any gate stopping it. The `typecheck` and `lint` scripts exist but are not part of the publish gate.

**Fix:**
```json
"prepublishOnly": "npm run lint && npm run typecheck && npm run build"
```

---

### WR-04: E2E idempotency test does not verify files are not overwritten — overwrite regressions would pass undetected

**File:** `src/__tests__/init.test.ts:120-135`
**Issue:** The `'loci init is idempotent — second run exits 0 and shows skipped'` test checks that `second.stdout` contains the string `'skipped'` and that exit code is 0. It does not verify that pre-existing file content is preserved. A regression that overwrites `commands.yml` on the second run would still output `'skipped'` for other files and exit 0, silently passing this test.

**Fix:** Add a content-preservation assertion. Align with the pattern already used in the unit test at line 54:
```typescript
it('loci init is idempotent — second run exits 0 and shows skipped', () => {
  // First run
  const first = spawnSync(process.execPath, [CLI, 'init'], {
    cwd: tmpDir,
    encoding: 'utf8',
  });
  expect(first.status).toBe(0);

  // Read content produced by first run
  const commandsContent = readFileSync(join(tmpDir, '.loci', 'commands.yml'), 'utf8');

  // Second run — everything should be skipped
  const second = spawnSync(process.execPath, [CLI, 'init'], {
    cwd: tmpDir,
    encoding: 'utf8',
  });
  expect(second.status).toBe(0);
  expect(second.stdout).toContain('skipped');

  // Verify files were not overwritten
  expect(readFileSync(join(tmpDir, '.loci', 'commands.yml'), 'utf8')).toBe(commandsContent);
});
```

---

## Info

### IN-01: CI badge in README.md references placeholder repository URL

**File:** `README.md:5`
**Issue:** The CI badge URL contains `your-org/loci` — a placeholder that was never replaced. The badge will show as broken on the published npm page and any GitHub preview.

```markdown
[![CI](https://github.com/your-org/loci/actions/workflows/ci.yml/badge.svg)](...)
```

**Fix:** Replace `your-org/loci` with the actual GitHub repository path before publishing.

---

### IN-02: `loci init` from a subdirectory of an existing loci project creates a nested `.loci/`

**File:** `src/init/index.ts:141`
**Issue:** `registerInitCommand` always calls `runInit(process.cwd())`. If the user runs `loci init` from `my-project/src/` where `my-project/.loci/` already exists, a second `.loci/` will be created at `my-project/src/.loci/`. There is no guard warning the user that a parent `.loci/` was found.

**Fix (optional):** Before scaffolding, check whether a parent `.loci/` exists (reuse or expose `findLociRoot`) and warn:
```typescript
.action(() => {
  const parentRoot = findLociRoot(process.cwd());
  if (parentRoot && parentRoot !== process.cwd()) {
    process.stderr.write(
      `[loci] Warning: .loci/ already exists at ${parentRoot}. Scaffolding here anyway.\n`
    );
  }
  runInit(process.cwd());
});
```

---

### IN-03: Appending to a `.gitignore` without a trailing newline produces a double blank line

**File:** `src/init/index.ts:75-76`
**Issue:** `appendContent` is `'\n# loci\n...\n'`. When appended to existing content that already ends with `\n`, the result is `...\n\n# loci\n...` — one blank separator line (intentional). But when the existing content does not end with `\n` (e.g., user created it without a final newline), the join produces `...<no newline>\n# loci\n...` — the `# loci` block is correctly separated, but the first `\n` in `appendContent` closes the previous line rather than acting as a separator. The block appears immediately after the last entry with one blank line missing.

This is cosmetic only, but a minor polish issue. It can be fixed by normalising the trailing newline before appending:
```typescript
const base = existing.endsWith('\n') ? existing : `${existing}\n`;
writeFileSync(gitignorePath, base + appendContent, 'utf8');
```

---

### IN-04: `package.json` has no `exports` field

**File:** `package.json`
**Issue:** Without an `exports` field, Node.js module resolution falls back to the `main` field (absent here) and then to `index.js`. For a CLI-only package this does not affect runtime behaviour, but it means `require('xci')` or `import 'xci'` from consumer code resolves unpredictably. Adding an explicit `exports: { ".": null }` or `"exports": {}` prevents accidental programmatic imports of internal CLI internals.

**Fix:**
```json
"exports": {}
```

---

### IN-05: `typecheck` is not part of the `test` script — CI can pass with type errors

**File:** `package.json:24`
**Issue:** `"test": "vitest run"` does not include `tsc --noEmit`. A developer running `npm test` locally or in CI gets no type-checking feedback. The `typecheck` script exists but must be invoked separately. Combined with WR-03 (no typecheck in `prepublishOnly`), type errors have two gaps to escape through.

**Fix:** Either chain into the test script or ensure CI explicitly runs `npm run typecheck` as a separate step. For local development convenience:
```json
"test": "npm run typecheck && vitest run"
```
(Or keep them separate in CI matrix steps, which is equally valid.)

---

_Reviewed: 2026-04-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
