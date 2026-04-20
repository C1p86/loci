# Deferred Items — 260420-lxj

## Pre-existing test failure (out of scope)

**File:** `packages/xci/src/__tests__/cold-start.test.ts` (line 38)

**Test:** `dist/cli.mjs dynamic import points to ./agent/index.js at runtime (not inlined)`

**Assertion:** `expect(content).toMatch(/import\(['"]\.\/agent\/index\.js['"]\)/)`

**Why it fails:** `packages/xci/tsup.config.ts` onSuccess hook rewrites the literal
`'./agent/index.js'` → `'./agent.mjs'` in the emitted `dist/cli.mjs` (so that Node can
resolve the sibling agent bundle at runtime). The test's regex expects the pre-rewrite
spelling, which no longer exists in dist after a fresh build.

**Confirmed pre-existing:** stash-verified on clean HEAD `f122d3f` before any 260420-lxj
changes — test fails identically with no log-errors modifications in place.

**Out of scope for 260420-lxj:** the test belongs to the cold-start/bundle-shape suite,
not to the log-errors feature. The 260420-lxj Task B regression guard intentionally checks
for `'./agent.mjs'` in dist (the post-rewrite form), matching the tsup behaviour — the
source-level test is the one that drifted.

**Action:** log only; do NOT fix in this quick task. Surface in SUMMARY deferred section.
