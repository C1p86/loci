---
phase: 260420-hcc
plan: 01
type: execute
subsystem: web-dashboard
tags: [tailwind-v4, shadcn-tokens, patch-contract, registration-token, ui-refactor]
requires:
  - "packages/server/src/routes/agents/patch.ts (existing PATCH contract)"
  - "packages/web/src/lib/api.ts apiPatch helper"
  - "packages/web/src/hooks/useRegistrationToken.ts (existing mutation hook)"
  - "packages/web/src/lib/agentUrl.ts buildAgentWsUrl (from 260420-ggj)"
provides:
  - "@theme inline block wiring shadcn HSL tokens into Tailwind v4 utility generator"
  - "useAgentRename + useAgentDrain wired to canonical PATCH /api/orgs/:orgId/agents/:agentId"
  - "Shared GenerateTokenButton component with mut.reset() + Generate-another flow"
  - "Persistent Generate-token entry point in AgentsList header"
affects:
  - "All shadcn dialogs/popovers (now render with opaque background)"
  - "Agent drain + rename UI flows (now actually hit the server)"
  - "AgentsList non-empty header layout (flex with right-aligned button)"
tech-stack:
  added: []
  patterns:
    - "Tailwind v4 @theme inline block referencing :root HSL triplets via hsl(var(--token))"
    - "Shared UI component extraction: AgentsEmptyState + AgentsList both consume GenerateTokenButton"
    - "Mutation-owned reset flow: mut.reset() from TanStack Query to re-enter pre-generation state"
key-files:
  created:
    - path: "packages/web/src/routes/agents/GenerateTokenButton.tsx"
      purpose: "Shared generate-registration-token control with RoleGate + CopyableCommand + Generate-another reset"
  modified:
    - path: "packages/web/src/index.css"
      change: "Insert @theme inline block mapping 19 shadcn tokens to --color-* + --radius"
    - path: "packages/web/src/hooks/useAgents.ts"
      change: "useAgentRename + useAgentDrain now apiPatch the canonical URL (revoke untouched)"
    - path: "packages/web/src/routes/agents/AgentsList.tsx"
      change: "Flex header wraps <h1>Agents</h1> + <GenerateTokenButton /> (persistent entry point)"
    - path: "packages/web/src/routes/agents/AgentsEmptyState.tsx"
      change: "Delegate generation UI to shared GenerateTokenButton; drop CopyableCommand/RoleGate/Button/hook/buildAgentWsUrl imports"
    - path: "packages/web/src/__tests__/AgentsEmptyState.test.tsx"
      change: "Add 7th spec asserting 'Generate another' button after token is returned"
decisions:
  - "@theme inline (not @theme): block references existing :root variables via hsl(var(--x)) so raw HSL triplet source of truth stays in :root"
  - "GenerateTokenButton owns mut.reset() — parent never needs to manage token visibility state"
  - "Test fixture untouched for the 6 original specs — mocks hoisted at module level apply transitively to GenerateTokenButton"
  - "e2e/smoke.spec.ts vitest misroute logged to deferred-items.md — pre-existing, requires Docker stack + Playwright runner, not in scope"
metrics:
  duration: "~14m"
  completed: "2026-04-20T12:45:05Z"
  tasks: 4
  files_modified: 5
  commits: 3
---

# Quick Task 260420-hcc: Fix Web Dashboard Tailwind Tokens + Agent PATCH Contract + Persistent Generate Button — Summary

Three user-visible post-v2.0 dogfood bugs (invisible dialogs, inert drain/rename, no multi-agent enroll path) fixed in three atomic commits plus a verification sweep — shadcn tokens now declared via Tailwind v4 `@theme inline`, `useAgentRename` and `useAgentDrain` rewired to the canonical PATCH route, and `GenerateTokenButton` extracted as a shared control rendered both in the empty-state card and persistently in the AgentsList header.

## Commits

| Task | Subject | Hash | Files |
|------|---------|------|-------|
| A | fix(web): wire shadcn design tokens to Tailwind v4 via @theme inline | 920395e | packages/web/src/index.css |
| B | fix(web): use PATCH for agent state + hostname updates | faf427d | packages/web/src/hooks/useAgents.ts |
| C | feat(web): persistent GenerateTokenButton in AgentsList header | 7e04b8b | packages/web/src/routes/agents/GenerateTokenButton.tsx (new); AgentsList.tsx; AgentsEmptyState.tsx; __tests__/AgentsEmptyState.test.tsx |

## Task D: Verification Sweep

| Check | Result |
|-------|--------|
| `pnpm --filter @xci/web typecheck` | PASS — 0 errors |
| `pnpm --filter @xci/web build` | PASS — dist/assets/index-CsWaAt3t.css 32.37 KB / 6.59 KB gz; main chunk 178 KB gz (unchanged from Phase 13 baseline) |
| `pnpm exec vitest run --exclude 'e2e/**'` | PASS — 102/102 tests across 12 files (AgentsEmptyState: 7/7) |
| Token emission in built CSS: `grep -oE "bg-background|text-foreground|border-border"` | 7 hits (constraint ≥ 3) — 2× bg-background, 5× text-foreground |
| Drain/rename stale-URL regression: `grep -rnE "'/drain'|/drain\`|\"/drain\"|'/rename'|/rename\`|\"/rename\"" packages/web/src/` | 0 hits |
| Drain/rename path-form regression: `grep -rnE "agents/[^/ ]+/(drain|rename)" packages/web/src/` | 0 hits |
| xci dist regression: `grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs` | 1 (≥ 1 required; file not touched) |
| Server untouched: `git diff HEAD~3 -- packages/server/` | Empty |
| Xci untouched: `git diff HEAD~3 -- packages/xci/` | Empty |
| package.json untouched: `git diff HEAD~3 -- "**/package.json"` | Empty |

## Deviations from Plan

### Auto-fixed / Out-of-scope discoveries

**1. [Rule 3 - Scope boundary] pnpm not on PATH; used corepack**
- **Found during:** Task A build verification gate
- **Issue:** `pnpm` shim absent from direct PATH in this WSL dev env; `/usr/bin/npm` and `/usr/bin/corepack` available
- **Resolution:** Ran all pnpm commands as `corepack pnpm ...` — equivalent invocation, same pnpm 10.33.0 selected via corepack (matches Phase 06 D-07 pinned version)
- **Files modified:** None — execution-only adjustment
- **Commit:** None

**2. [Rule 3 - Scope boundary] grep -c returns 1 for single-line minified CSS**
- **Found during:** Task A verification gate re-run
- **Issue:** Task A constraint said `grep -cE "bg-background|text-foreground|border-border" packages/web/dist/assets/index-*.css` must return ≥ 3, but Vite minifies CSS onto a single line, so `-c` (line count) returned 1
- **Resolution:** Re-ran as `grep -oE ... | wc -l` (total occurrence count) — returned 7. The constraint's intent (prove tokens were emitted) is satisfied; the specific shell counting mode was a minor constraint-wording issue
- **Files modified:** None
- **Commit:** None

### Out-of-scope items (logged, not fixed)

**1. e2e/smoke.spec.ts misroute under vitest** — see `.planning/quick/260420-hcc-fix-web-dashboard-tailwind-tokens-agent-/deferred-items.md`. This is pre-existing (Phase 13 / Phase 14 test-setup gap) and environment-dependent (needs Docker stack on :3000 + Playwright runner). Proved unrelated by isolating the one file that Task C touches (`vitest run src/__tests__/AgentsEmptyState.test.tsx`): 7/7 green.

## Observed Behaviour vs. Success Criteria

1. **Dialog visible.** Built CSS now contains `bg-background`, `text-foreground` utilities (7 hits in the emitted sheet vs 0 pre-Task-A). shadcn Dialog's background now resolves to the opaque white `hsl(var(--background))` instead of `unset`. ✓
2. **Agent drain + rename actually work.** `useAgentDrain` now sends `PATCH /api/orgs/:orgId/agents/:agentId` with body `{state:'draining'}`; `useAgentRename` sends the same URL with `{hostname:'<new>'}`. Both match `packages/server/src/routes/agents/patch.ts` AJV schema `{hostname?: string(1..255), state?: 'draining'|'online'}`. ✓
3. **Persistent Generate button.** `AgentsList` now wraps `<h1>Agents</h1>` + `<GenerateTokenButton />` in a `flex items-center justify-between mb-4` container; operators can click Generate from the agents dashboard even after the first agent is registered. Empty-state flow (0 agents) still shows the same component inside the `bg-card` framing, delegated to `GenerateTokenButton`. ✓
4. **No collateral damage.** Server/xci/package.json diffs all empty across HEAD~3. v1 xci 302-test suite + hyperfine cold-start gate + ws-fence status: unchanged (no xci/server bytes modified). ✓

## Self-Check: PASSED

Verified artifacts and commits exist:

- packages/web/src/routes/agents/GenerateTokenButton.tsx → FOUND (new file, 54 lines)
- packages/web/src/index.css → FOUND with `@theme inline` block (1 match, line 3)
- packages/web/src/hooks/useAgents.ts → FOUND with 2× apiPatch + 1× apiPost(revoke) + 0 stale /drain|/rename URLs
- packages/web/src/routes/agents/AgentsList.tsx → FOUND with 2× GenerateTokenButton references (import + usage)
- packages/web/src/routes/agents/AgentsEmptyState.tsx → FOUND with 0 residual CopyableCommand/useCreateRegistrationToken/buildAgentWsUrl imports
- packages/web/src/__tests__/AgentsEmptyState.test.tsx → FOUND with 7th `Generate another` spec added
- packages/web/dist/assets/index-CsWaAt3t.css → FOUND, 7 token-backed utility emissions
- Commit 920395e (Task A) → FOUND in git log
- Commit faf427d (Task B) → FOUND in git log
- Commit 7e04b8b (Task C) → FOUND in git log
- HEAD~3 === c3b295c (baseline): confirmed by git log matching the orchestrator-provided base
