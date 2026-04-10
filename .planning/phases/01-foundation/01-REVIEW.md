---
phase: 01-foundation
reviewed: 2026-04-10T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - .editorconfig
  - .gitattributes
  - .github/workflows/ci.yml
  - .gitignore
  - .nvmrc
  - biome.json
  - package.json
  - src/__tests__/cli.e2e.test.ts
  - src/__tests__/errors.test.ts
  - src/__tests__/types.test.ts
  - src/cli.ts
  - src/commands/index.ts
  - src/config/index.ts
  - src/errors.ts
  - src/executor/index.ts
  - src/resolver/index.ts
  - src/types.ts
  - src/version.ts
  - tsconfig.json
  - tsup.config.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-10
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 01 scaffolding is in good shape overall. The error hierarchy in `src/errors.ts` is
well-structured (D-01/D-02/D-03 are faithfully implemented), the type contracts in
`src/types.ts` cleanly express the pipeline as discriminated unions, and the four feature
stubs throw `NotImplementedError` as planned. Tests are thoughtful — `errors.test.ts`
covers the secrets-safe contract for `ShellInjectionError`, and `cli.e2e.test.ts` smoke-checks
the bundle. The build (tsup → single ESM `.mjs`) and CI matrix (Node 20/22 × ubuntu/windows/macos)
match the constraints in CLAUDE.md.

The main concerns are concentrated in `src/cli.ts`:
1. The CLI runs as a top-level side effect on module import, which contradicts the
   stated intent of re-exporting `main`/`buildProgram` for programmatic tests.
2. All `commander.*` errors are uniformly wrapped as `UnknownFlagError`, which mislabels
   missing-required-arg, conflicting-option, etc. as "unknown flag" — this distorts the
   `code` field that the structured-error contract (D-04) is meant to carry.
3. The wrapped message is double-nested (`Unknown flag: error: unknown option '--bogus'`).

There are no security or correctness defects of Critical severity, and the secrets-safety
posture (`ShellInjectionError`, `.gitignore`, `SecretsTrackedError`) is intact.

## Warnings

### WR-01: cli.ts runs main() as a top-level side effect, breaking programmatic imports

**File:** `src/cli.ts:64-70`
**Issue:** The module unconditionally invokes `main(process.argv).then(...)` at the top
level, then re-exports `main` and `buildProgram` with the comment "Re-export for
programmatic tests (Plan 03 may import `main` directly)". Any test or future caller that
does `import { main } from '../cli.js'` will trigger the CLI to execute against the test
runner's `process.argv` *before* the import returns, will call `process.exit(...)` on
completion (terminating vitest), and will write to the runner's stdout/stderr. This makes
the documented re-export footgunny: it cannot actually be used as advertised.

The `cli.e2e.test.ts` suite avoids the problem only because it spawns the bundle as a
subprocess. The bug surfaces the moment any test (or any consumer) tries to import the
module directly.

**Fix:** Guard the entry-point invocation so it only runs when the file is the actual
entry point. Two viable options:

```ts
// Option A — explicit entry-point check (works for the bundled .mjs and dev .ts)
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const isEntryPoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
```

Option B (cleaner, recommended): split into `src/cli.ts` (library: `buildProgram`,
`main`) and `src/bin.ts` (entry point: imports `main` and runs it). Point the `bin`
field at the bin entry, point the tsup `entry` at the bin entry. Tests then import
from `cli.ts` with zero side effects.

---

### WR-02: All commander parse errors are mislabeled as UnknownFlagError

**File:** `src/cli.ts:50-56`
**Issue:** Inside the catch block, every error whose `code` starts with `commander.`
is wrapped as `UnknownFlagError`:

```ts
if (commanderErr.code?.startsWith('commander.')) {
  const wrapped = new UnknownFlagError(commanderErr.message ?? 'cli error');
  ...
}
```

But commander emits many other parse errors that are not "unknown flag":
`commander.missingArgument`, `commander.missingMandatoryOptionValue`,
`commander.conflictingOption`, `commander.invalidOptionArgument`,
`commander.excessArguments`, etc. All of them will be reported with
`code = 'CLI_UNKNOWN_FLAG'`, which makes the structured-error contract (D-04) lie:
the machine-readable `code` is meant to be a precise diagnosis category, and a script
filtering on `CLI_UNKNOWN_FLAG` will get false positives. It also means the suggestion
text ("Run `loci --help` for available flags") is shown for unrelated failures.

**Fix:** Branch on the commander code, or introduce a generic `CliParseError` (also a
`CliError` subclass) for the catch-all case and reserve `UnknownFlagError` for the
actual `commander.unknownOption` / `commander.unknownCommand` cases:

```ts
if (commanderErr.code?.startsWith('commander.')) {
  const wrapped =
    commanderErr.code === 'commander.unknownOption' ||
    commanderErr.code === 'commander.unknownCommand'
      ? new UnknownFlagError(extractFlag(commanderErr.message))
      : new CliParseError(commanderErr.code, commanderErr.message ?? 'cli error');
  process.stderr.write(`error [${wrapped.code}]: ${wrapped.message}\n`);
  ...
}
```

Adding `CliParseError` to `errors.ts` is consistent with D-03 (declare new
subclasses as new failure modes emerge) and keeps the test in `cli.e2e.test.ts`
("unknown flag exits with code 50") working unchanged because both subclasses
still resolve to `ExitCode.CLI_ERROR`.

---

### WR-03: UnknownFlagError constructor receives the full commander message as the "flag" argument

**File:** `src/cli.ts:51`
**Issue:** `new UnknownFlagError(commanderErr.message ?? 'cli error')` passes the
entire commander error message (e.g. `error: unknown option '--bogus'`) as the
`flag` constructor parameter. `UnknownFlagError`'s constructor then builds:

```
Unknown flag: error: unknown option '--bogus'
```

The result is double-prefixed and confusing. The `cli.e2e.test.ts` test only checks
that stderr contains the literal string `CLI_UNKNOWN_FLAG`, so the bug is invisible
to the suite — but a user running `loci --bogus` sees the duplicated prefix.

**Fix:** Either parse the flag out of the commander message before constructing the
error, or accept that the wrapped error is opaque and use a different constructor
shape:

```ts
// Parse the flag from commander's message: "error: unknown option '--bogus'"
const match = (commanderErr.message ?? '').match(/'([^']+)'/);
const flag = match?.[1] ?? '<unknown>';
const wrapped = new UnknownFlagError(flag);
```

Combined with the WR-02 fix this becomes natural — the parse step only runs in the
`commander.unknownOption` branch where it makes sense.

## Info

### IN-01: ShellInjectionError accepts a `value` parameter only to discard it — confusing API

**File:** `src/errors.ts:142-153`
**Issue:** The constructor takes `value: string`, then deliberately drops it (`void
value`) with a comment explaining the secrets-leakage concern. The comment is
correct, and the test confirms the message contains neither the value nor any
substring of it. However, the API is a footgun: a future maintainer (or a Phase 4
PR review) is one find-replace away from putting `value` back into the message
"to make debugging easier" and silently re-introducing the leak. The parameter is
also not used to *detect* anything — it is purely decorative.

**Fix:** Either drop the parameter entirely (the call sites in Phase 4 know they
have a bad value; they do not need to pass it), or replace it with a redacted
length/category marker:

```ts
export class ShellInjectionError extends ExecutorError {
  constructor() {
    super('Command contains shell metacharacters in an argument slot', {
      code: 'EXE_SHELL_INJECTION',
      suggestion: 'loci uses shell:false by default; review your command definition',
    });
  }
}
```

If you need to preserve the call signature for an API contract Plan 04 has already
been written against, document the discard prominently in the JSDoc, not just an
inline comment.

---

### IN-02: src/version.ts will throw ReferenceError if imported outside the bundled output

**File:** `src/version.ts:1-9`
**Issue:** `LOCI_VERSION` is bound to `__LOCI_VERSION__`, a `declare const` whose
runtime value is supplied only by tsup's `define` step. If anything ever imports
`src/version.ts` directly via vitest (no transform replacing the identifier),
ts-node, or a future test that exercises `cli.ts` programmatically rather than
through the bundle, it throws `ReferenceError: __LOCI_VERSION__ is not defined`.
Today the bug is masked because the only consumer (`cli.ts`) is itself only run
through the bundled `dist/cli.mjs` in tests.

**Fix:** Defensively provide a fallback for the dev/test path. Either use
`globalThis` lookup with fallback to `'0.0.0-dev'`, or read it from a `package.json`
shim under vitest:

```ts
declare const __LOCI_VERSION__: string | undefined;

export const LOCI_VERSION: string =
  typeof __LOCI_VERSION__ !== 'undefined' ? __LOCI_VERSION__ : '0.0.0-dev';
```

This costs one byte in the bundled output and removes a future debugging trap.

---

### IN-03: ci.yml has no top-level `permissions` block (default is broader than needed)

**File:** `.github/workflows/ci.yml:1-12`
**Issue:** Without an explicit `permissions:` block, the `GITHUB_TOKEN` for this
workflow inherits the repository default, which on older repos is read/write
on `contents`. The CI job here only needs `contents: read` (it does not push tags,
update releases, or comment on PRs). Granting more than necessary is a defense-in-depth
gap.

**Fix:** Add at the top of the workflow file:

```yaml
permissions:
  contents: read
```

This is a one-line hardening step recommended by GitHub's own security guidance.

---

### IN-04: cli.ts catch-all branch unsafely casts the unknown to Error

**File:** `src/cli.ts:59`
**Issue:** `process.stderr.write(`unexpected error: ${(err as Error).message}\n`)`
casts `err` to `Error`. If a non-Error value is thrown (e.g. a string, an object
literal, `undefined`), the resulting message is `unexpected error: undefined` and
the original information is lost. JavaScript permits throwing any value, so
unknown branches should defend against the non-Error case.

**Fix:**

```ts
const message = err instanceof Error ? err.message : String(err);
process.stderr.write(`unexpected error: ${message}\n`);
```

The same fix should be applied at line 67 in the top-level `.catch` of `main`.

---

### IN-05: vitest coverage excludes all `src/**/index.ts`, hiding stub coverage gaps from reports

**File:** `vitest.config.ts:13-17`
**Issue:** `exclude: ['src/**/__tests__/**', 'src/**/index.ts']` removes all
feature-stub `index.ts` files (config, commands, executor, resolver) from
coverage reports. This is a reasonable Phase 1 choice (the stubs are one-line
throws), but the exclusion is permanent: when Phase 2 replaces
`src/config/index.ts` with a real loader, that file will silently *stay* excluded
from coverage. Coverage on `src/config/index.ts` is something Phase 2 will want
to see.

**Fix:** Either narrow the exclusion to the specific stub files for now and
revisit per-phase, or add a TODO/comment marking the exclusion as temporary:

```ts
exclude: [
  'src/**/__tests__/**',
  // Phase 1 stubs — remove these once each phase replaces its index.ts with real code:
  'src/config/index.ts',
  'src/commands/index.ts',
  'src/resolver/index.ts',
  'src/executor/index.ts',
],
```

This makes the exclusion intent self-documenting and forces a deliberate decision
when each phase lands.

---

_Reviewed: 2026-04-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
