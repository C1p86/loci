---
phase: 260420-ezf
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/xci/tsup.config.ts
autonomous: true
requirements:
  - QUICK-260420-ezf
must_haves:
  truths:
    - "Running the bundled CLI with --agent no longer throws ERR_MODULE_NOT_FOUND for './agent/index.js'"
    - "The bundled dist/cli.mjs contains the runtime import specifier './agent.mjs' (matching the sibling file tsup actually emits)"
    - "The bundled dist/cli.mjs contains ZERO occurrences of the broken literal './agent/index.js'"
    - "dist/agent.mjs continues to exist as a separate bundle entry (unchanged by this fix)"
    - "size-limit check on dist/cli.mjs still passes (rewrite is byte-neutral: './agent/index.js' = 18 chars, './agent.mjs' = 11 chars — file shrinks by 7 bytes, never grows)"
  artifacts:
    - path: "packages/xci/tsup.config.ts"
      provides: "Build config with onSuccess hook that rewrites the stale './agent/index.js' specifier in dist/cli.mjs to './agent.mjs'"
      contains: "onSuccess"
  key_links:
    - from: "packages/xci/tsup.config.ts (first defineConfig entry, cli+agent block)"
      to: "packages/xci/dist/cli.mjs"
      via: "onSuccess hook using node:fs/promises readFile + replaceAll + writeFile"
      pattern: "onSuccess.*readFile.*cli\\.mjs.*replaceAll.*agent/index\\.js.*agent\\.mjs.*writeFile"
---

<objective>
Fix the bundled CLI's runtime agent import so `xci --agent ...` works when installed from npm.

Root cause: cli.ts has `await import('./agent/index.js')` — a TypeScript specifier that resolves correctly in dev (tsc's `.js→.ts` mapping). tsup preserves this literal in the bundle via the `esbuildOptions` external rule (intentional — prevents agent code inlining into cli.mjs per Phase 8 Pitfall 6). But tsup emits a FLAT output (`dist/cli.mjs` + `dist/agent.mjs`), so at runtime Node resolves `./agent/index.js` relative to `dist/cli.mjs` and finds nothing → MODULE_NOT_FOUND.

Fix: post-build string rewrite in `tsup.config.ts` onSuccess hook. Replace the exact literal `'./agent/index.js'` (and its double-quoted variant) → `'./agent.mjs'` in `dist/cli.mjs`. Narrow scope: only the cli+agent entry's onSuccess runs this; only the exact quoted string is replaced; no other paths are touched.

Purpose: unblock `xci --agent` in published installs (it currently crashes at the dynamic import call). The TypeScript source stays correct for dev; the bundled output gets the sibling-relative specifier Node actually needs.

Output: Updated `packages/xci/tsup.config.ts` with an `onSuccess` hook on the first `defineConfig` entry (cli+agent block). After rebuild, `dist/cli.mjs` references `./agent.mjs`; `dist/agent.mjs` is reached successfully at runtime.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@packages/xci/tsup.config.ts
@packages/xci/package.json

<interfaces>
<!-- Key contracts the executor needs. The tsup config is an array of two defineConfig entries. -->
<!-- The onSuccess hook MUST be added to the FIRST entry only (cli+agent block). Do NOT touch the DSL entry. -->

From packages/xci/tsup.config.ts — current first entry structure (lines 25-51):
```typescript
{
  ...sharedOptions,
  entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' },
  noExternal: [/^(?!ws$|reconnecting-websocket$).*/],
  external: ['ws', 'reconnecting-websocket'],
  esbuildOptions(options, context) {
    if (context.format === 'esm') {
      options.external = [...(options.external ?? []), './agent/index.js'];
    }
  },
  clean: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node\n..." },
}
```

tsup `onSuccess` signature (from tsup 8.5.1 docs): `onSuccess?: string | (() => Promise<void | undefined | (() => void | Promise<void>)>)`.
When passed a function, tsup awaits it after a successful build. The function runs in the same Node.js process as tsup, so ESM `import { readFile, writeFile } from 'node:fs/promises'` at the top of the config file works fine.

From packages/xci/src/cli.ts:764 — the dynamic import that produces the problematic literal:
```typescript
const { runAgent } = await import('./agent/index.js');
```
This line is CORRECT for TypeScript source resolution and MUST NOT be changed — tsc/vitest in dev need the `.js` suffix with the nested path (per tsconfig `moduleResolution: bundler` + `verbatimModuleSyntax`).

From packages/xci/dist/cli.mjs:22253 — the broken output literal (verified via grep):
```
    const { runAgent } = await import('./agent/index.js');
```
Single-quoted. esbuild preserves the source's quote style; verified empirically.

From packages/xci/package.json:
- `bin.xci`: `./dist/cli.mjs` — this is what runs when a user types `xci` after `npm i -g xci`
- `exports['./agent'].import`: `./dist/agent.mjs` — the sibling bundle that MUST be the import target
- Runtime deps include `ws` and `reconnecting-websocket` (kept external per Phase 8 D-01) — the agent bundle consumes these; the cli bundle does not
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add onSuccess post-build rewrite hook to tsup.config.ts (cli+agent entry only)</name>
  <files>packages/xci/tsup.config.ts</files>
  <action>
Edit `packages/xci/tsup.config.ts`:

1. At the top of the file, add an ESM import for `readFile` and `writeFile` from `node:fs/promises`. Place it adjacent to the existing `import { readFileSync } from 'node:fs';` import. Both sync and async fs imports can coexist; no existing imports need to be removed.

2. On the FIRST `defineConfig` entry (the cli+agent block, lines 25-51 — identified by `entry: { cli: 'src/cli.ts', agent: 'src/agent/index.ts' }`), add an `onSuccess` property. Place it AFTER the existing `esbuildOptions` property and BEFORE `clean: true`, so the rendered order is: `esbuildOptions`, `onSuccess`, `clean`, `dts`, `banner`.

3. The `onSuccess` value MUST be an async arrow function (no parameters) that:
   a. Reads `./dist/cli.mjs` as UTF-8 text via `await readFile('./dist/cli.mjs', 'utf8')`.
   b. Performs EXACTLY TWO narrow replacements on the string (use `String.prototype.replaceAll`, not regex — no escape hazards, no accidental over-match):
      - Replace every occurrence of the literal `'./agent/index.js'` (single-quoted, 18 characters including the quotes) with `'./agent.mjs'` (single-quoted, 13 characters including the quotes).
      - Replace every occurrence of the literal `"./agent/index.js"` (double-quoted) with `"./agent.mjs"` (double-quoted).
   c. Writes the transformed string back to `./dist/cli.mjs` via `await writeFile('./dist/cli.mjs', transformed, 'utf8')`.
   d. Logs a single line to stderr for operator visibility on the rewrite: `process.stderr.write('[tsup] rewrote ./agent/index.js → ./agent.mjs in dist/cli.mjs\n')`. This line is optional but recommended for build-output traceability.

4. Do NOT add `onSuccess` to the SECOND `defineConfig` entry (the DSL block starting at line 56). The DSL bundle does not contain the agent import and the hook would be a no-op at best, a source of confusion at worst.

5. Do NOT change anything else: `entry` shape stays identical, `noExternal`/`external` stay identical, `esbuildOptions` stays identical (the relative-path externalisation is still required — it is what keeps the literal in the output for us to rewrite; without it, tsup would inline agent code into cli.mjs, which is NOT what we want).

6. Use `String.prototype.replaceAll` (not `String.prototype.replace` with a regex flag). `replaceAll` with a plain string argument does not interpret regex metacharacters — dots in `./agent/index.js` are literal dots, zero escape risk.

Rationale for this specific shape (do NOT deviate):
- Using `onSuccess` (tsup-native hook) instead of a separate script keeps the fix inside the build-tool lifecycle — one `pnpm --filter xci build` invocation does everything. No new npm scripts, no new tooling.
- Scoping replacement to two EXACT quoted-string forms (single and double) guarantees we never touch any other `agent/index.js` mentions that might appear in source map comments, type annotations, or test fixtures that got bundled in. The current cli.mjs contains exactly one occurrence (the dynamic import at line 22253), so the assertion "count goes from ≥1 to 0" is tight.
- Not editing `src/cli.ts` preserves dev-mode behaviour (tsc and vitest resolve `./agent/index.js` → `./agent/index.ts` via the standard TypeScript `.js` rewriting convention).
- Not editing the `esbuildOptions` external rule preserves Phase 8 Pitfall 6 (agent code must NOT be inlined into cli.mjs — the bundle stays lean, `ws`/`reconnecting-websocket` stay only in `agent.mjs`, cold-start budget <300ms preserved).
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter xci build 2>&1 | tail -20 && test "$(grep -c "'./agent/index.js'" packages/xci/dist/cli.mjs)" = "0" && test "$(grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs)" -ge "1" && pnpm --filter xci size-limit 2>&1 | tail -5</automated>
  </verify>
  <done>
After `pnpm --filter xci build` completes successfully:
1. `grep -c "'./agent/index.js'" packages/xci/dist/cli.mjs` returns `0` (the broken literal is gone).
2. `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` returns `>= 1` (the correct literal is present).
3. `packages/xci/dist/agent.mjs` still exists and is unchanged by this fix (verify with `ls -la packages/xci/dist/agent.mjs`).
4. `pnpm --filter xci size-limit` passes (cli bundle size does not regress; it should shrink by 7 bytes per rewrite or stay within noise).
5. `packages/xci/tsup.config.ts` contains an `onSuccess` property on the first (cli+agent) `defineConfig` entry and ONLY on that entry.
6. `packages/xci/src/cli.ts` is UNCHANGED.
7. `packages/xci/package.json` is UNCHANGED.
  </done>
</task>

</tasks>

<verification>
End-to-end phase verification (run from repo root):

```bash
cd /home/developer/projects/loci

# 1. Rebuild with the fix in place
pnpm --filter xci build

# 2. Broken literal must be gone
[ "$(grep -c "'./agent/index.js'" packages/xci/dist/cli.mjs)" = "0" ] || { echo "FAIL: './agent/index.js' still present in bundle"; exit 1; }

# 3. Correct literal must be present
[ "$(grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs)" -ge "1" ] || { echo "FAIL: './agent.mjs' missing from bundle"; exit 1; }

# 4. Agent bundle still emitted
[ -f packages/xci/dist/agent.mjs ] || { echo "FAIL: dist/agent.mjs missing"; exit 1; }

# 5. Size gate still green
pnpm --filter xci size-limit

# 6. No stray touches to cli.ts
git diff --stat packages/xci/src/cli.ts | grep -q cli.ts && { echo "FAIL: cli.ts was modified"; exit 1; } || true

echo "OK: agent dynamic import rewrite verified"
```

Optional smoke (non-gating — requires a spare port and PostgreSQL-free agent startup path):
```bash
# Confirm the bundled CLI resolves the dynamic import without crashing.
# --agent without a token will fail auth, but it must fail AFTER the dynamic import resolves,
# not with ERR_MODULE_NOT_FOUND before reaching runAgent.
node packages/xci/dist/cli.mjs --agent --help 2>&1 | head -5
# Expected: agent help output or "CLI_AGENT_*" error, NOT "Cannot find module" / "ERR_MODULE_NOT_FOUND".
```
</verification>

<success_criteria>
- [ ] `packages/xci/tsup.config.ts` first defineConfig entry has an `onSuccess` hook that rewrites `./agent/index.js` → `./agent.mjs` in `dist/cli.mjs`.
- [ ] Hook uses `node:fs/promises` (ESM import at top of file), not `node:fs` sync APIs.
- [ ] Hook uses `String.prototype.replaceAll` with plain string arguments for both single-quoted and double-quoted forms.
- [ ] `pnpm --filter xci build` completes without error.
- [ ] `grep -c "'./agent/index.js'" packages/xci/dist/cli.mjs` returns `0`.
- [ ] `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` returns `>= 1`.
- [ ] `pnpm --filter xci size-limit` passes (cli.mjs under the declared 200 KB limit — current 795KB already exceeds limit per Phase 6 D-15 deferral; "not regressing" is the operative assertion, not "under 200KB").
- [ ] `packages/xci/src/cli.ts` is untouched (`git diff --stat` shows zero changes).
- [ ] `packages/xci/package.json` is untouched.
- [ ] `packages/xci/dist/agent.mjs` continues to be emitted by the build (tsup entry shape unchanged).
- [ ] No new runtime dependencies introduced.
</success_criteria>

<output>
After completion, create `.planning/quick/260420-ezf-fix-cli-agent-dynamic-import-in-bundled-/260420-ezf-SUMMARY.md` documenting:
- The one-line root cause (tsup flat output + preserved TS-style `./agent/index.js` specifier).
- The one-line fix (tsup `onSuccess` hook rewrites the quoted literal to `./agent.mjs` post-build).
- Verification evidence: grep counts before/after, size-limit result, agent.mjs presence.
- Any surprises encountered (e.g., additional occurrences of the literal, size-limit delta, onSuccess invocation ordering).
</output>
