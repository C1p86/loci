---
phase: 03-commands-resolver
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/commands/index.ts
  - src/commands/normalize.ts
  - src/commands/tokenize.ts
  - src/commands/validate.ts
  - src/commands/__tests__/commands.test.ts
  - src/commands/__tests__/tokenize.test.ts
  - src/resolver/index.ts
  - src/resolver/interpolate.ts
  - src/resolver/platform.ts
  - src/resolver/envvars.ts
  - src/resolver/__tests__/resolver.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-04-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The commands loader and resolver modules are well-structured with clear separation of concerns: YAML loading, normalization to typed unions, graph validation (cycle detection + depth cap), platform selection, placeholder interpolation, and env var mapping. Error handling is thorough with custom error classes. Tests are comprehensive, covering happy paths, error cases, and edge cases.

Two warnings were found: a synchronous file read inside an async function, and a potential silent key collision in env var name mapping. Three informational items were noted around minor code quality improvements.

## Warnings

### WR-01: Synchronous file I/O inside async function

**File:** `src/commands/index.ts:74-81`
**Issue:** `commandsLoader.load()` is declared `async` but calls `readCommandsYaml()` which uses `readFileSync`. This blocks the event loop during file reading. While acceptable for a CLI tool with a single call, the `async` signature implies non-blocking behavior and misleads callers. If this function is ever called in a context where the event loop matters (e.g., parallel config loading), it will silently block.
**Fix:** Either make the function synchronous (remove `async`, return `CommandMap` directly) to match the actual behavior, or switch to `readFile` from `node:fs/promises` for true async I/O:
```typescript
import { readFile } from 'node:fs/promises';

async function readCommandsYaml(cwd: string): Promise<Record<string, unknown> | null> {
  const filePath = join(cwd, '.loci', 'commands.yml');
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null &&
        (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  // ... rest unchanged
}
```

### WR-02: Silent key collision in env var name mapping

**File:** `src/resolver/envvars.ts:11-18`
**Issue:** `buildEnvVars` maps dot-notation keys to UPPER_UNDERSCORE by replacing `.` with `_` and uppercasing. If a config has both `deploy.host` and `deploy_host`, both map to `DEPLOY_HOST` and the later entry silently overwrites the earlier one. The same collision applies to `redactSecrets` (line 29). This could cause hard-to-diagnose bugs where a config value silently disappears.
**Fix:** Add collision detection and throw an error:
```typescript
export function buildEnvVars(values: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [dotKey, value] of Object.entries(values)) {
    const envKey = dotKey.toUpperCase().replace(/\./g, '_');
    if (Object.hasOwn(env, envKey)) {
      throw new Error(
        `env var collision: "${dotKey}" maps to ${envKey} which is already defined`
      );
    }
    env[envKey] = value;
  }
  return env;
}
```

## Info

### IN-01: Unused parameter in normalizeObject

**File:** `src/commands/normalize.ts:75`
**Issue:** The `_filePath` parameter is declared with an underscore prefix indicating it is intentionally unused, but it is passed through from `normalizeAlias`. If it will never be needed in this function, consider removing it from the signature to reduce noise.
**Fix:** Remove `_filePath` from `normalizeObject` and adjust the call site at line 147 accordingly, or add a comment explaining planned future use.

### IN-02: Test cleanup for temporary directories

**File:** `src/commands/__tests__/commands.test.ts:19-22`
**Issue:** `beforeEach` creates a temporary directory but there is no `afterEach` to clean it up. While OS temp directories are eventually cleaned, accumulated test runs can leave many orphaned directories. This is a minor housekeeping concern.
**Fix:** Add an `afterEach` hook to remove the temporary directory:
```typescript
import { rmSync } from 'node:fs';
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});
```

### IN-03: Repeated process.platform mocking pattern in tests

**File:** `src/resolver/__tests__/resolver.test.ts:21-24,44-51,63-64`
**Issue:** The pattern of saving `process.platform`, overriding via `Object.defineProperty`, and restoring in every test is repeated many times. This is verbose and error-prone -- if a test throws before the restore line, subsequent tests run with the wrong platform. Using `vi.stubGlobal` or a shared helper with proper cleanup would be more robust.
**Fix:** Extract a helper or use vitest's built-in facilities:
```typescript
function withPlatform(platform: string, fn: () => void): void {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}
```

---

_Reviewed: 2026-04-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
