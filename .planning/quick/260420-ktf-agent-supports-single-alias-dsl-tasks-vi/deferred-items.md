# Deferred Items (out of scope for 260420-ktf)

These issues pre-exist on base commit `a0de2bf` and are unrelated to the KTF task's two-file edit scope:

## 1. Pre-existing typecheck errors (all unrelated files)

```
src/agent/index.ts(46,9): error TS2412 — parseFlags (exactOptionalPropertyTypes on `flags.token`)
src/agent/index.ts(54,9): error TS2412 — parseFlags (`flags.hostname`)
src/agent/index.ts(57,9): error TS2412 — parseFlags (`flags.configDir`)
src/tui/dashboard.ts (multiple) — SequentialStep discriminated-union narrowing
src/tui/picker.ts (multiple) — possibly-undefined guards
tsup.config.ts(26,3), (73,3) — tsup Options/Format readonly vs mutable
```

All verified present on base commit `a0de2bf` via `git stash && pnpm --filter xci typecheck` — none introduced by the two files edited in this task (`packages/xci/src/agent/index.ts` parseYamlToArgv body + `packages/xci/src/__tests__/agent/dispatch-handler.test.ts` fixtures).

The three errors in `src/agent/index.ts` are at lines 46, 54, 57 — inside `parseFlags`, NOT in `parseYamlToArgv`. The KTF edit did not touch these lines.

## 2. Pre-existing cold-start test failure

```
src/__tests__/cold-start.test.ts > dist/cli.mjs dynamic import points to ./agent/index.js at runtime (not inlined)
```

The test expects `import('./agent/index.js')` but 260420-ezf changed the build output to `import('./agent.mjs')` (tsup rewrite). The test file was not updated when `ezf` shipped. Verified present on base commit `a0de2bf`.

Regression guard #4 in this task's constraints (`grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` ≥ 1) confirms `./agent.mjs` is the correct current form — the test is simply stale.

**Suggested future fix:** update the regex in cold-start.test.ts:38 from `\.\/agent\/index\.js` to `\.\/agent\.mjs`.
