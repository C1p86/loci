# Deferred Items (quick-260421-nmx)

## Pre-existing failures not caused by this task

### cold-start.test.ts > "dist/cli.mjs dynamic import points to ./agent/index.js at runtime (not inlined)"

**Status:** FAILING on main before and after this task.

**Location:** `packages/xci/src/__tests__/cold-start.test.ts:38`

**Cause:** `dist/cli.mjs` is a stale build artifact (timestamp Apr 21 16:02, older than recent source changes). The regex `/import\(['"]\.\/agent\/index\.js['"]\)/` does not match — the current dist bundle does not contain the expected dynamic-import string.

**Not caused by this task:** This task only modifies source files (`packages/xci/src/executor/output.ts`, `packages/xci/src/executor/sequential.ts`). The dist artifact is untouched by this task.

**Action:** Rebuild dist (`pnpm --filter xci build`) to refresh the bundle. Out of scope for quick-260421-nmx — should be addressed by the next build/release cycle.
