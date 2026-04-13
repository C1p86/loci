---
phase: 02-config-system
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/config/index.ts
  - src/config/__tests__/loader.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-13
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Two source files reviewed: the 4-layer YAML config loader (`src/config/index.ts`) and its
corresponding test suite (`src/config/__tests__/loader.test.ts`).

The implementation is well-structured with clear separation of concerns, correct merge
semantics, and good YAML 1.2 handling via the `yaml` library. The test suite is thorough
and covers the critical paths, including the git-tracking warning and secretKeys semantics.

Two warnings require attention before ship: a synchronous `execSync` call that blocks the
event loop (violating the < 300ms startup budget constraint from CLAUDE.md) and an
uninitialized `cwd` variable in a test group that can mask failures. Three info items cover
minor quality improvements.

---

## Warnings

### WR-01: `execSync` blocks the event loop inside async `load()`

**File:** `src/config/index.ts:166`

**Issue:** `isSecretTrackedByGit` calls `execSync('git ls-files ...')`, which is a
synchronous OS-level subprocess spawn that blocks the Node.js event loop until git
exits. This is invoked unconditionally inside the `async load()` method whenever
`secrets.yml` exists. This contradicts the project's < 300ms startup budget (CLAUDE.md)
and the stated rationale for choosing `execa` over synchronous alternatives. On a slow
filesystem or a large git repo, `git ls-files` can take 50-200ms.

**Fix:** Replace with an async implementation using `execa`, which is already in the
approved stack:

```typescript
import { execa } from 'execa';

async function isSecretTrackedByGit(cwd: string): Promise<boolean> {
  try {
    await execa('git', ['ls-files', '--error-unmatch', '.loci/secrets.yml'], {
      cwd,
      stdio: 'pipe',
      reject: true,
    });
    return true;
  } catch (err: unknown) {
    // ENOENT = git not installed; exit 1 = not tracked; exit 128 = not a repo
    return false;
  }
}
```

Then `await` the result in `load()`:

```typescript
if (layers[2] !== null) {
  if (await isSecretTrackedByGit(cwd)) {
    process.stderr.write(
      '[loci] WARNING: .loci/secrets.yml is tracked by git. Run: git rm --cached .loci/secrets.yml\n',
    );
  }
}
```

---

### WR-02: `cwd` not initialized before `afterEach` in "single layer loading" describe block

**File:** `src/config/__tests__/loader.test.ts:57-70`

**Issue:** The `describe('single layer loading')` block declares `let cwd: string` at
line 57 without initialization. The `beforeEach` (lines 59-62) only saves
`LOCI_MACHINE_CONFIG` — it does not set `cwd`. Each individual test manually assigns
`cwd` (e.g., line 84: `cwd = await mkdtemp(...)`). If any test throws before that
assignment (or if the `cwd` variable is referenced before any test has run), the
`afterEach` at line 64 calls `cleanup(cwd)` with `cwd` as `undefined`, causing
`fs.rm(undefined, { recursive: true })` to throw an error that masks the original
failure.

```typescript
// Current (line 57) — uninitialized, risky:
let cwd: string;

// Fix — initialize to empty string and guard in cleanup:
let cwd = '';

afterEach(async () => {
  if (cwd) await cleanup(cwd);
  // ... env restore
});
```

Alternatively, move `cwd` initialization into `beforeEach` (consistent with the
pattern used by other describe blocks in this file).

---

## Info

### IN-01: `execSync` imported from `node:child_process` conflicts with project stack convention

**File:** `src/config/index.ts:5`

**Issue:** CLAUDE.md explicitly mandates `execa` for child-process execution across the
codebase ("execa: best cross-platform Windows support"). The production import of
`execSync` from `node:child_process` is an undocumented deviation. Even if the
synchronous call were acceptable, this inconsistency makes it easier for future
contributors to introduce more sync child-process calls. Addressing WR-01 above removes
this import entirely.

**Fix:** Remove the `execSync` import once WR-01 is addressed. No separate action
needed beyond WR-01.

---

### IN-02: Dynamic `import('node:child_process')` inside test body is unnecessary

**File:** `src/config/__tests__/loader.test.ts:442`

**Issue:** The secrets git-tracking tests at lines 442 and 476 use
`const { execSync } = await import('node:child_process')` inside the test body to set
up a real git repo. Since this is a top-level Node.js built-in (not a module that needs
to be mocked), it can be imported statically at the top of the test file. The dynamic
import adds latency and makes the test body harder to scan.

**Fix:** Add a static import at the top of the test file alongside the existing imports:

```typescript
import { execSync } from 'node:child_process';
```

Then remove the two inline `const { execSync } = await import(...)` lines from the
test bodies.

---

### IN-03: Dot-key collision check order is asymmetric with iteration order

**File:** `src/config/index.ts:37-58`

**Issue:** In `flattenToStrings`, when a quoted flat key (e.g., `"a.b"`) appears
before the nested path (`a: { b: val }`) in the YAML document, the collision is
detected correctly because the flat key writes to `result["a.b"]` first (line 45),
then the nested recursion checks `Object.hasOwn(result, k)` at line 51. However,
when the nested path appears first, the flat key check at line 38
(`Object.hasOwn(result, fullKey)`) correctly catches it.

The current logic is correct but depends on JavaScript object iteration order (insertion
order per ES2015+). This is guaranteed by the language specification, but the asymmetric
code paths (one check before write at line 38, another check after recursion at line 51)
are not immediately obvious to a reader. A comment clarifying why both checks are
necessary would prevent accidental refactoring that breaks one of the paths.

**Fix:** Add a comment before the nested recursion branch explaining the two-phase
collision detection:

```typescript
} else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
  // Two-phase collision detection:
  // Phase 1 (line 38 above): flat key collides with a previously-seen flat key
  //   (handles quoted "a.b" appearing AFTER nested a: {b: val})
  // Phase 2 (line 51 below): nested result collides with a previously-seen flat key
  //   (handles quoted "a.b" appearing BEFORE nested a: {b: val})
  const nested = flattenToStrings(value as Record<string, unknown>, filePath, fullKey);
```

---

_Reviewed: 2026-04-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
