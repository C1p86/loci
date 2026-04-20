---
phase: 260420-hcc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/web/src/index.css
  - packages/web/src/hooks/useAgents.ts
  - packages/web/src/routes/agents/GenerateTokenButton.tsx
  - packages/web/src/routes/agents/AgentsList.tsx
  - packages/web/src/routes/agents/AgentsEmptyState.tsx
  - packages/web/src/__tests__/AgentsEmptyState.test.tsx
autonomous: true
requirements:
  - FIX-tailwind-tokens
  - FIX-agent-patch-endpoint
  - FIX-persistent-generate-token
user_setup: []

must_haves:
  truths:
    - "Opening an agent-action dialog (e.g. rename, drain confirm) renders an opaque white panel with readable text against a dimmed overlay — not an invisible/transparent box."
    - "Clicking 'Drain' on an agent row results in a network PATCH to /api/orgs/:orgId/agents/:agentId with body {state:'draining'} and the agent row's state badge updates to 'Draining' after the query invalidation."
    - "Renaming an agent inline results in a network PATCH to /api/orgs/:orgId/agents/:agentId with body {hostname:'<new>'} — no 404 from the nonexistent /rename POST endpoint."
    - "When one or more agents exist, the AgentsList header shows a persistent 'Generate registration token' button to the right of the 'Agents' heading — operators can enroll a second/third agent without a detour."
    - "AgentsEmptyState (no agents yet) still offers the same Generate button via the extracted shared component — no regression for first-run flow."
  artifacts:
    - path: "packages/web/src/index.css"
      provides: "Tailwind v4 @theme inline block mapping shadcn HSL tokens to --color-* variables + --radius"
      contains: "@theme inline"
    - path: "packages/web/src/hooks/useAgents.ts"
      provides: "useAgentRename + useAgentDrain wired to PATCH /api/orgs/:orgId/agents/:agentId"
      contains: "apiPatch"
    - path: "packages/web/src/routes/agents/GenerateTokenButton.tsx"
      provides: "Reusable button + post-generation command + Generate-another reset flow with RoleGate"
      exports: ["GenerateTokenButton"]
      min_lines: 35
    - path: "packages/web/src/routes/agents/AgentsList.tsx"
      provides: "Flex header with persistent GenerateTokenButton beside 'Agents' heading"
      contains: "GenerateTokenButton"
    - path: "packages/web/src/routes/agents/AgentsEmptyState.tsx"
      provides: "Empty state delegating to shared GenerateTokenButton"
      contains: "GenerateTokenButton"
  key_links:
    - from: "packages/web/src/index.css"
      to: "Tailwind v4 JIT utility generator"
      via: "@theme inline block referencing hsl(var(--<token>))"
      pattern: "@theme inline"
    - from: "packages/web/src/hooks/useAgents.ts"
      to: "packages/server/src/routes/agents/patch.ts"
      via: "apiPatch(`/api/orgs/${orgId}/agents/${agentId}`, {state|hostname})"
      pattern: "apiPatch\\(.*agents/"
    - from: "packages/web/src/routes/agents/AgentsList.tsx"
      to: "packages/web/src/routes/agents/GenerateTokenButton.tsx"
      via: "direct import + render in non-empty branch header"
      pattern: "GenerateTokenButton"
    - from: "packages/web/src/routes/agents/AgentsEmptyState.tsx"
      to: "packages/web/src/routes/agents/GenerateTokenButton.tsx"
      via: "replaces inline Button/CopyableCommand/RoleGate with single <GenerateTokenButton /> usage"
      pattern: "GenerateTokenButton"
---

<objective>
Three urgent web dashboard fixes, shipped as three atomic commits (A, B, C) in order, followed by a verification sweep (D, no commit).

A. Dialog is invisible because Tailwind v4 does not emit classes like `bg-background`/`text-foreground`/`border-border` unless their token names are declared inside a `@theme` block — the shadcn `:root { --background: ... }` vars alone are not enough. Insert a `@theme inline` block in `packages/web/src/index.css` that maps every shadcn token used by components to `hsl(var(--<token>))`.

B. Clicking "Drain" (and inline rename) does nothing because the client calls `apiPost` on `/drain` / `/rename` subpaths that do not exist server-side. The canonical server contract is `PATCH /api/orgs/:orgId/agents/:agentId` with body `{hostname?}` and/or `{state?: 'draining'|'online'}`. Rewire `useAgentRename` and `useAgentDrain` to `apiPatch` the canonical URL.

C. After the first agent registers, AgentsList renders (not AgentsEmptyState), so the only "Generate registration token" entry point disappears — operators cannot enroll a second agent. Extract `GenerateTokenButton` as a shared component, render it persistently in AgentsList's header, and refactor AgentsEmptyState to use the same component.

Purpose: Three bug reports from the user's post-v2.0 dogfooding session — dialog invisible / drain does nothing / no Generate button after first agent. Scope is frontend-only; no server or xci changes.

Output: 3 atomic commits + one ephemeral verification sweep; build artifacts regenerated locally by the verify step.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<!-- Key files and contracts the executor needs. Pre-extracted so no codebase scavenger hunt is required. -->

<interfaces>
<!-- packages/server/src/routes/agents/patch.ts (canonical server contract) -->
- Route: PATCH /api/orgs/:orgId/agents/:agentId
- Body (AJV additionalProperties:false):
    { hostname?: string (1..255), state?: 'draining' | 'online' }
- At least one of {hostname, state} required, else 400 AgentPatchEmptyError
- Returns 204 No Content on success; 404 if agent not in org
- Side effect: if state provided, server also emits WS frame {type:'state', state} to connected agent
- CSRF + requireAuth (Owner/Member); client api.ts already attaches X-CSRF-Token from 'xci_csrf' cookie for PATCH

<!-- packages/web/src/lib/api.ts (confirmed) -->
- export const apiPatch = <T>(url: string, body?: unknown) => request<T>('PATCH', url, body);   // line 57
- apiPatch already sends Content-Type: application/json + X-CSRF-Token + credentials:'include'

<!-- packages/web/src/hooks/useAgents.ts (current) -->
- import { apiGet, apiPost } from '../lib/api.js';            // needs apiPatch added
- useAgentRename: apiPost(`/api/orgs/${orgId}/agents/${agentId}/rename`, { hostname })   // BROKEN
- useAgentDrain : apiPost(`/api/orgs/${orgId}/agents/${agentId}/drain`)                   // BROKEN
- useAgentRevoke: apiPost(`/api/orgs/${orgId}/agents/${agentId}/revoke`)                  // CORRECT — do not touch
- Query key on success: ['agents', 'list', orgId]

<!-- packages/web/src/index.css (current) -->
@import "tailwindcss";

:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --primary: 222 47% 11%;
  --primary-foreground: 210 40% 98%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --border: 214 32% 91%;
  --ring: 215 20% 65%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 210 40% 98%;
  --radius: 0.5rem;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --accent: 210 40% 96%;
  --accent-foreground: 222 47% 11%;
  --input: 214 32% 91%;
}

<!-- packages/web/src/routes/agents/AgentsEmptyState.tsx (current imports we must preserve via extraction) -->
- useCreateRegistrationToken (../../hooks/useRegistrationToken.js) — returns { mutate, isPending, data:{token,expiresAt,tokenId}, error, reset }
- buildAgentWsUrl (../../lib/agentUrl.js)
- CopyableCommand (../../components/CopyableCommand.js)
- RoleGate (../../components/RoleGate.js) — role="member" tooltip="Viewers cannot generate registration tokens"
- Button (../../components/ui/button.js) — shadcn; supports variant="outline"
- Origin resolution: (import.meta.env.VITE_API_URL as string | undefined) ?? window.location.origin
- Command template: `xci --agent ${agentWsUrl} --token ${mut.data.token}`

<!-- packages/web/src/hooks/useRegistrationToken.ts -->
export interface RegistrationTokenResponse { tokenId: string; token: string; expiresAt: string; }
export function useCreateRegistrationToken(): UseMutationResult<RegistrationTokenResponse, Error, void>  // (void trigger — note mutate() called with no arg)

<!-- packages/web/src/routes/agents/AgentsList.tsx (current header, line ~90-92) -->
return (
  <div>
    <h1 className="text-2xl font-semibold mb-4">Agents</h1>
    <Table>...

<!-- Test fixture in AgentsEmptyState.test.tsx -->
- Already mocks useAuthStore and useCreateRegistrationToken; asserts on "Generate registration token" button text and on the full xci command line including the WS URL
- RegistrationTokenResponse type in the test fixture includes `ok: true` — tests pass `{ ok: true, token: ..., expiresAt: ... }` — this is an over-typed test fixture, harmless at runtime; preserve shape when updating

</interfaces>

<scope_boundary>
IN SCOPE (this plan):
- CSS tokens, agent mutation URL wiring, persistent Generate button UI.

OUT OF SCOPE (hard prohibitions):
- packages/server/** — server is correct; do NOT touch.
- packages/xci/** — agent/CLI is correct; do NOT touch.
- package.json anywhere — no new deps.
- tailwindcss-animate / tw-animate-css — animation polish deferred.
- "Delete agent" button, "New Task" flow — deferred to a separate task.
- Dark theme — deferred to v2.1+.
</scope_boundary>
</context>

<tasks>

<task type="auto">
  <name>Task A: Wire shadcn design tokens into Tailwind v4 via @theme inline</name>
  <files>packages/web/src/index.css</files>
  <action>
Edit `packages/web/src/index.css`. Keep the existing `:root` block (it defines the raw HSL triplets); add a `@theme inline` block immediately after the `@import "tailwindcss";` line and before `:root`. The `@theme` block tells Tailwind v4 which custom tokens to generate utilities for (bg-*/text-*/border-*/ring-*/...) — without it, classes like `bg-background`, `text-foreground`, `border-border` emit no CSS and the Dialog panel renders with no background (appearing invisible against the dim overlay).

BEFORE (first two lines of file):
```
@import "tailwindcss";

/* shadcn/ui design tokens — light theme only (dark deferred to v2.1+) */
:root {
  --background: 0 0% 100%;
  ...
}
```

AFTER (insert new block between `@import` and the comment):
```
@import "tailwindcss";

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-border: hsl(var(--border));
  --color-ring: hsl(var(--ring));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-input: hsl(var(--input));

  --radius: var(--radius);
}

/* shadcn/ui design tokens — light theme only (dark deferred to v2.1+) */
:root {
  --background: 0 0% 100%;
  ...
}
```

Notes:
- Every shadcn token listed in `:root` (background, foreground, primary, primary-foreground, muted, muted-foreground, border, ring, destructive, destructive-foreground, card, card-foreground, popover, popover-foreground, secondary, secondary-foreground, accent, accent-foreground, input) MUST have a matching `--color-*` entry — any missing token will leave its utility unresolved.
- `--radius` is re-exported via `@theme inline` so that any `rounded-[var(--radius)]` usage resolves consistently; if none exist today this is harmless — leave it in for forward compat with shadcn patterns.
- Do NOT delete the `:root` block. The `@theme` entries reference those variables.
- Do NOT add `tailwindcss-animate` or `tw-animate-css` in this task — the animation keyframes (`data-[state=open]:animate-in`, etc.) will still degrade to static-visible panels, which is the goal. Animation polish is deferred.
- Do NOT modify `body { ... }` at the bottom.

Commit (exactly this subject line):
`fix(web): wire shadcn design tokens to Tailwind v4 via @theme inline`

Stage only `packages/web/src/index.css`; do not stage anything else with this commit.
  </action>
  <verify>
    <automated>grep -c "^@theme inline" packages/web/src/index.css</automated>
    <!-- Must return 1. -->
    <!-- Additionally verify: grep -c "^  --color-background: hsl(var(--background));" packages/web/src/index.css returns 1 -->
    <!-- Deferred full-pipeline proof lands in Task D (build + CSS grep). -->
  </verify>
  <done>
- `packages/web/src/index.css` contains a single `@theme inline { ... }` block with ≥19 `--color-*` entries + `--radius` entry.
- `:root` block is unchanged.
- Exactly one new commit on the branch with subject `fix(web): wire shadcn design tokens to Tailwind v4 via @theme inline`.
  </done>
</task>

<task type="auto">
  <name>Task B: Rewire useAgentDrain + useAgentRename to server PATCH contract</name>
  <files>packages/web/src/hooks/useAgents.ts</files>
  <action>
Edit `packages/web/src/hooks/useAgents.ts`. The client is calling non-existent subpaths; the real server route is `PATCH /api/orgs/:orgId/agents/:agentId` with body shape `{hostname?, state?}`. See `packages/server/src/routes/agents/patch.ts` for canonical contract (already summarized in `<interfaces>`).

1) Update the imports line 1:

BEFORE:
```ts
import { apiGet, apiPost } from '../lib/api.js';
```

AFTER:
```ts
import { apiGet, apiPatch, apiPost } from '../lib/api.js';
```

(Keep `apiPost` — `useAgentRevoke` still uses it against the real `POST /revoke` subroute, which exists server-side and is NOT being changed in this task.)

2) Rewrite `useAgentRename` (lines 15–23):

BEFORE:
```ts
export function useAgentRename() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { agentId: string; hostname: string }) =>
      apiPost(`/api/orgs/${orgId}/agents/${args.agentId}/rename`, { hostname: args.hostname }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'list', orgId] }),
  });
}
```

AFTER:
```ts
export function useAgentRename() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { agentId: string; hostname: string }) =>
      apiPatch(`/api/orgs/${orgId}/agents/${args.agentId}`, { hostname: args.hostname }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'list', orgId] }),
  });
}
```

3) Rewrite `useAgentDrain` (lines 25–33):

BEFORE:
```ts
export function useAgentDrain() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { agentId: string }) =>
      apiPost(`/api/orgs/${orgId}/agents/${args.agentId}/drain`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'list', orgId] }),
  });
}
```

AFTER:
```ts
export function useAgentDrain() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { agentId: string }) =>
      apiPatch(`/api/orgs/${orgId}/agents/${args.agentId}`, { state: 'draining' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'list', orgId] }),
  });
}
```

4) `useAgentRevoke` (lines 35–43) — DO NOT change. POST /revoke is the real server route.

5) `useAgents` query (lines 6–13) — DO NOT change.

6) Test update: `packages/web/src/hooks/__tests__/useAgents.test.ts` does not exist in the repo (confirmed by planner — no file present at that path). SKIP the test-update sub-step. Do NOT invent a new test file in this task; Task D will grep the tree to confirm no stale `/drain` or `/rename` client URLs remain.

Commit (exactly this subject line):
`fix(web): use PATCH for agent state + hostname updates`

Stage only `packages/web/src/hooks/useAgents.ts`.
  </action>
  <verify>
    <automated>grep -E "agents/[^/\"'\\`]+/(drain|rename)" packages/web/src/hooks/useAgents.ts | wc -l</automated>
    <!-- Must return 0 — no stale subpath URLs remain in the hook file. -->
    <!-- Additionally: grep -c "apiPatch(\`/api/orgs/\\\${orgId}/agents/" packages/web/src/hooks/useAgents.ts must return 2. -->
    <!-- Additionally: grep -c "apiPost(\`/api/orgs/\\\${orgId}/agents/\\\${args.agentId}/revoke\`)" packages/web/src/hooks/useAgents.ts must return 1 (revoke untouched). -->
  </verify>
  <done>
- Imports include `apiPatch` (and still `apiPost` because revoke uses it).
- `useAgentRename` calls `apiPatch(\`/api/orgs/${'$'}{orgId}/agents/${'$'}{args.agentId}\`, { hostname: args.hostname })`.
- `useAgentDrain` calls `apiPatch(\`/api/orgs/${'$'}{orgId}/agents/${'$'}{args.agentId}\`, { state: 'draining' })`.
- `useAgentRevoke` is byte-identical to before.
- Exactly one new commit on the branch with subject `fix(web): use PATCH for agent state + hostname updates`.
  </done>
</task>

<task type="auto">
  <name>Task C: Extract GenerateTokenButton + render persistently in AgentsList header</name>
  <files>
packages/web/src/routes/agents/GenerateTokenButton.tsx,
packages/web/src/routes/agents/AgentsList.tsx,
packages/web/src/routes/agents/AgentsEmptyState.tsx,
packages/web/src/__tests__/AgentsEmptyState.test.tsx
  </files>
  <action>
Three-file refactor + test update. Create the shared component first, then replace two call sites, then fix the test.

--- STEP 1: Create `packages/web/src/routes/agents/GenerateTokenButton.tsx` ---

This component owns the full generate-token flow: the mutation hook, the RoleGate, the initial button, the post-generation copyable command, a "Generate another" reset button, and the error branch. Ported from the current AgentsEmptyState logic.

Exact file contents:

```tsx
import { CopyableCommand } from '../../components/CopyableCommand.js';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import { useCreateRegistrationToken } from '../../hooks/useRegistrationToken.js';
import { buildAgentWsUrl } from '../../lib/agentUrl.js';

/**
 * Shared "generate agent registration token" control.
 * Used by AgentsEmptyState (first-run) and AgentsList header (persistent).
 * Security: T-13-03-02 — token held in mutation result only, never stored.
 */
export function GenerateTokenButton() {
  const mut = useCreateRegistrationToken();
  const origin =
    (import.meta.env.VITE_API_URL as string | undefined) ?? window.location.origin;
  const agentWsUrl = buildAgentWsUrl(origin);

  const command = mut.data ? `xci --agent ${agentWsUrl} --token ${mut.data.token}` : null;

  if (!command) {
    return (
      <div>
        {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
        <RoleGate role="member" tooltip="Viewers cannot generate registration tokens">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Generating...' : 'Generate registration token'}
          </Button>
        </RoleGate>
        {mut.error && (
          <p className="text-destructive text-xs mt-1">
            Failed: {(mut.error as Error).message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <CopyableCommand command={command} label="Run this on the agent machine:" />
      <p className="text-xs text-muted-foreground mt-1">
        This token is shown only once. It expires in 24 hours and can be used to register a
        single agent.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => mut.reset()}
      >
        Generate another
      </Button>
    </div>
  );
}
```

Notes:
- Keep the `biome-ignore` comment exactly as written — it mirrors the convention used across AgentsList/AgentsEmptyState and is enforced by the repo's Biome config.
- The `mut.reset()` call clears `data`/`error` from the mutation state, which flips the component back to the pre-generation view. TanStack Query's `UseMutationResult` exposes `reset` on every mutation; no extra plumbing needed.
- Button label stays "Generate registration token" (matches existing test fixture and retains continuity with the empty-state flow).

--- STEP 2: Edit `packages/web/src/routes/agents/AgentsList.tsx` ---

a) Add import after the existing `AgentsEmptyState` import (top of file):

```ts
import { GenerateTokenButton } from './GenerateTokenButton.js';
```

(File imports use `.js` suffix per the project's `verbatimModuleSyntax` + `moduleResolution: bundler` config — matches existing imports in this file.)

b) Replace the current header block in the `AgentsList` component (lines 90–125 in the current file):

BEFORE (inside the `return (...)`):
```tsx
return (
  <div>
    <h1 className="text-2xl font-semibold mb-4">Agents</h1>
    <Table>
      ...
    </Table>
  </div>
);
```

AFTER:
```tsx
return (
  <div>
    <div className="flex items-center justify-between mb-4">
      <h1 className="text-2xl font-semibold">Agents</h1>
      <GenerateTokenButton />
    </div>
    <Table>
      ...
    </Table>
  </div>
);
```

Notes:
- `GenerateTokenButton` already handles its own post-generation state internally (the CopyableCommand renders inside it). There is no need to split the command banner below the header as a separate element; letting the button component grow in place is the simplest layout and keeps both call sites visually consistent. If the layout feels cramped in practice, a later polish pass can move the copyable-command banner below the flex row — not in this task.
- Preserve everything inside `<Table>...</Table>` byte-for-byte including the `mb-4` on the outer `<h1>`'s parent (now on the flex wrapper, not the `<h1>`).
- The loading, error, and empty-state short-circuits (`if (isLoading) ...`, `if (error) ...`, `if (!agents || agents.length === 0) return <AgentsEmptyState />;`) remain untouched above the return.

--- STEP 3: Edit `packages/web/src/routes/agents/AgentsEmptyState.tsx` ---

Replace the entire file contents with the trimmed version below. The shared component owns the button + command + error UI; the empty state now only supplies framing copy.

```tsx
import { GenerateTokenButton } from './GenerateTokenButton.js';

/**
 * UI-09 / SC-2: First-run empty state shown when no agents are registered.
 * Delegates token generation to GenerateTokenButton (shared with AgentsList header).
 */
export function AgentsEmptyState() {
  return (
    <div className="max-w-2xl mx-auto mt-16 p-6 border rounded-lg bg-card">
      <h2 className="text-xl font-semibold mb-2">No agents registered yet</h2>
      <p className="text-muted-foreground mb-4">
        Register your first agent to start running tasks. Generate a one-time token, then run the
        xci CLI on the machine you want to enroll.
      </p>
      <GenerateTokenButton />
    </div>
  );
}
```

Notes:
- Every import previously in this file (`CopyableCommand`, `RoleGate`, `Button`, `useCreateRegistrationToken`, `buildAgentWsUrl`) is now removed — `GenerateTokenButton` carries them.
- Headline "No agents registered yet" and the framing paragraph are preserved verbatim per test coverage and scope.

--- STEP 4: Update `packages/web/src/__tests__/AgentsEmptyState.test.tsx` ---

All six existing tests should keep passing as written — they render `<AgentsEmptyState />`, which transitively renders `<GenerateTokenButton />`, and the mocks (`vi.mock('../hooks/useRegistrationToken.js', ...)` and `vi.mock('../stores/authStore.js', ...)`) are hoisted module-level and apply to any consumer that imports those hooks. No selector changes are needed for the current six specs.

However, one edge case: the test fixture includes `ok: true` on the mocked data (line 78). The new `GenerateTokenButton` `reset` button could theoretically appear in the "command shown" branch and change `getByRole('button', { name: /generate registration token/i })` semantics — but it does not, because the new reset button has text "Generate another" (distinct regex). The existing assertion `expect(screen.queryByRole('button', { name: /generate registration token/i })).toBeNull()` on line 114 therefore still passes.

Add one new test at the end of the `describe` block to lock in the "Generate another" reset affordance (this is new behavior introduced by this refactor — failing specs must be updated, not deleted, and new behavior deserves one test):

```ts
it('shows "Generate another" button after a token is generated', async () => {
  mockMutationState = {
    ...mockMutationState,
    data: { ok: true, token: 'TOK-RESET-1', expiresAt: '2026-04-19T00:00:00Z' },
  };
  const { AgentsEmptyState } = await import('../routes/agents/AgentsEmptyState.js');
  render(<AgentsEmptyState />);
  expect(screen.getByRole('button', { name: /generate another/i })).toBeInTheDocument();
});
```

Place it after the last `it(...)` block and before the closing `});` of `describe('AgentsEmptyState', ...)`.

Do NOT remove or weaken any of the six existing tests. The `mockMutationState` object currently does not have a `reset` field; the new `GenerateTokenButton` calls `mut.reset()` only inside the `onClick` handler of the "Generate another" button, so untriggered render paths never hit `reset` being undefined. If any spec fails because it renders and then simulates a click on the reset button, add `reset: vi.fn()` to the default `mockMutationState` object on lines 23–28 and in the `beforeEach` reset on lines 38–43 — but only if a failure occurs; do not add it speculatively.

--- COMMIT ---

Stage exactly these four files:
- packages/web/src/routes/agents/GenerateTokenButton.tsx (new)
- packages/web/src/routes/agents/AgentsList.tsx
- packages/web/src/routes/agents/AgentsEmptyState.tsx
- packages/web/src/__tests__/AgentsEmptyState.test.tsx

Commit (exactly this subject line):
`feat(web): persistent GenerateTokenButton in AgentsList header`
  </action>
  <verify>
    <automated>test -f packages/web/src/routes/agents/GenerateTokenButton.tsx && grep -c "export function GenerateTokenButton" packages/web/src/routes/agents/GenerateTokenButton.tsx</automated>
    <!-- Must print 1. -->
    <!-- Additionally: grep -c "GenerateTokenButton" packages/web/src/routes/agents/AgentsList.tsx must return >= 2 (import + usage). -->
    <!-- Additionally: grep -c "CopyableCommand\|useCreateRegistrationToken\|buildAgentWsUrl" packages/web/src/routes/agents/AgentsEmptyState.tsx must return 0 (delegated). -->
    <!-- Full test + typecheck pipeline deferred to Task D. -->
  </verify>
  <done>
- New file `packages/web/src/routes/agents/GenerateTokenButton.tsx` exports `GenerateTokenButton`, uses `useCreateRegistrationToken`, `RoleGate role="member"`, and renders either the Button-inside-RoleGate or the CopyableCommand + "Generate another" outline Button.
- `AgentsList.tsx` imports and renders `<GenerateTokenButton />` inside a `flex items-center justify-between mb-4` wrapper alongside the `<h1>`.
- `AgentsEmptyState.tsx` imports only `GenerateTokenButton` and renders it once; no residual imports of `CopyableCommand`, `RoleGate`, `Button`, `useCreateRegistrationToken`, or `buildAgentWsUrl`.
- `AgentsEmptyState.test.tsx` retains all six original tests (unchanged assertions) + one new test for the "Generate another" reset button.
- Exactly one new commit on the branch with subject `feat(web): persistent GenerateTokenButton in AgentsList header`.
  </done>
</task>

<task type="auto">
  <name>Task D: Verification sweep (no commit)</name>
  <files>(verification only — no file changes)</files>
  <action>
Run the full web workspace pipeline + regression greps. Produce no new commits. If any step fails, stop and report; do NOT try to auto-fix by amending the prior three commits — each of A/B/C must stand on its own.

Run these commands in order:

1. Typecheck:
   ```
   pnpm --filter @xci/web typecheck
   ```
   Expected: no errors.

2. Test:
   ```
   pnpm --filter @xci/web test
   ```
   Expected: all tests pass. The AgentsEmptyState test file runs 7 specs (6 original + 1 new "Generate another" assertion). Other web tests are unchanged by this plan.

3. Build:
   ```
   pnpm --filter @xci/web build
   ```
   Expected: success; `packages/web/dist/assets/index-*.css` is produced.

4. Token-generation smoke (proof Task A landed in the shipped CSS):
   ```
   grep -cE "bg-background|text-foreground|border-border" packages/web/dist/assets/index-*.css
   ```
   Expected: ≥ 3. Before Task A this was 0 (tokens unresolved). After Task A, Tailwind emits at least one of each.

5. Client URL regression guard (proof Task B landed):
   ```
   grep -rnE "'/drain'|/drain\`|\"/drain\"|'/rename'|/rename\`|\"/rename\"" packages/web/src/
   ```
   Expected: 0 literal POST-URL matches. Comments and PATCH body fields containing the substring "drain" (e.g. `{ state: 'draining' }`) are fine because the regex requires `/drain` with a slash; review any hits manually before calling the check failed.

6. xci regression guard (agent bundle untouched):
   If `packages/xci/dist/cli.mjs` exists:
   ```
   grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs
   ```
   Expected: ≥ 1. Do NOT rebuild xci; just assert the existing file is byte-preserved. If `packages/xci/dist/` does not exist (fresh checkout), skip this step.

Report:
- typecheck: PASS | FAIL (with error excerpt)
- test: PASS | FAIL (with failing spec name)
- build: PASS | FAIL
- token grep: N matches (must be ≥ 3)
- drain/rename grep: N matches (must be 0 POST-URL matches)
- xci dist grep: N matches (must be ≥ 1 if dist exists; N/A otherwise)

No commit at the end of this task.
  </action>
  <verify>
    <automated>pnpm --filter @xci/web typecheck && pnpm --filter @xci/web test && pnpm --filter @xci/web build && grep -cE "bg-background|text-foreground|border-border" packages/web/dist/assets/index-*.css</automated>
    <!-- Composite: all three pipeline stages pass AND the token emission count is non-zero. -->
  </verify>
  <done>
- `pnpm --filter @xci/web typecheck` → 0 errors.
- `pnpm --filter @xci/web test` → all green (7 specs in AgentsEmptyState.test.tsx; other web suites unaffected).
- `pnpm --filter @xci/web build` → success.
- `grep -cE "bg-background|text-foreground|border-border" packages/web/dist/assets/index-*.css` → ≥ 3.
- `grep -rnE "'/drain'|/drain\`|\"/drain\"|'/rename'|/rename\`|\"/rename\"" packages/web/src/` → 0 POST-URL matches (manual review of any hits confirms they are not client HTTP URLs).
- `packages/xci/dist/cli.mjs` (if present) still contains `'./agent.mjs'` ≥ 1 time.
- Three commits on the branch from Tasks A, B, C — no additional commit from Task D.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → Fastify server | Existing CSRF + session cookie boundary; unchanged by this plan. api.ts already attaches `X-CSRF-Token` for non-GET/HEAD. |
| Tailwind v4 JIT compiler → CSS output | Purely build-time; no user data involved. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260420-hcc-01 | Tampering | PATCH /api/orgs/:orgId/agents/:agentId from new client call site | accept | Server-side mitigation already in place: CSRF protection (`onRequest: [fastify.csrfProtection]`), requireAuth preHandler enforcing Owner/Member role, `requireOwnerOrMemberAndOrgMatch` guard comparing URL orgId to session org, AJV `additionalProperties:false` on body schema. No new attack surface — Task B merely uses an existing, already-hardened route. |
| T-260420-hcc-02 | Information Disclosure | Registration token now surfaces persistently in AgentsList header, not just first-run | accept | `GenerateTokenButton` holds token in mutation result only (TanStack Query in-memory state), never writes to localStorage/sessionStorage — identical behavior to AgentsEmptyState (preserves T-13-03-02). `mut.reset()` clears the token from memory when the user clicks "Generate another". Token display is still gated by `RoleGate role="member"` — Viewers see a disabled button with tooltip, not a token. Token itself remains one-time + 24h-expiring on the server (unchanged). |
| T-260420-hcc-03 | Elevation of Privilege | Viewer role clicking persistent generate button | mitigate | Existing `RoleGate role="member"` wrapper on the pre-mutation Button remains in place inside `GenerateTokenButton`; Viewers see a disabled button with tooltip "Viewers cannot generate registration tokens". The server-side `requireOwnerOrMemberAndOrgMatch` on the token route (unchanged) is the hard gate — the RoleGate is the UX hint. |
| T-260420-hcc-04 | Spoofing | `@theme inline` block references same `--<token>` vars used by unmodified `:root` | accept | CSS custom properties are same-origin and scoped to the stylesheet. No user-controlled input flows into the CSS. |

Security posture: this plan narrowly aligns the client to an existing server contract, extracts UI for a pre-existing authenticated action, and adjusts CSS emission. No new endpoints, no new auth paths, no new storage.
</threat_model>

<verification>
Phase verification driven by Task D. Additionally, after the three commits:

- `git log --oneline -n 3` should show exactly these three subjects in order (most recent first):
  1. `feat(web): persistent GenerateTokenButton in AgentsList header`
  2. `fix(web): use PATCH for agent state + hostname updates`
  3. `fix(web): wire shadcn design tokens to Tailwind v4 via @theme inline`
- `git diff HEAD~3 -- packages/server/` should be empty (server untouched).
- `git diff HEAD~3 -- packages/xci/` should be empty (xci untouched).
- `git diff HEAD~3 -- "**/package.json"` should be empty (no dep changes).
</verification>

<success_criteria>
All three user-reported bugs are resolved with observable evidence:

1. **Dialog is visible.** After Task A, a shadcn Dialog (any consumer: confirmation dialogs, inline dialogs introduced later) renders with `bg-background` producing an opaque white panel and `text-foreground` producing dark readable text against the existing `bg-black/80` overlay. The built CSS contains at least 3 token-backed utilities.

2. **Agent drain + rename actually work.** After Task B, clicking drain on an agent row fires `PATCH /api/orgs/:orgId/agents/:agentId` with `{state:'draining'}`; the server returns 204, the query invalidates, and the agent's state badge flips to "Draining". Renaming an agent sends `PATCH .../agents/:agentId` with `{hostname}` and the cell updates. Network tab shows PATCH (not POST to /drain or /rename).

3. **Persistent Generate button exists.** After Task C, opening the agents dashboard with one or more agents registered shows "Generate registration token" in the header (right-aligned, next to the "Agents" heading). Clicking it generates a new token, shows the copyable xci command, and offers "Generate another" to reset. The empty-state flow (no agents) still shows the same component inside the "No agents registered yet" card.

4. **No collateral damage.** Server code, xci code, and package.json files are untouched. All `@xci/web` tests pass. Build succeeds. v2.0 milestone artifacts (302 xci test suite, hyperfine cold-start gate, ws-fence) are unaffected because no xci or server file is modified.
</success_criteria>

<output>
After completion, the three commits themselves are the deliverable. No SUMMARY.md is written — this is a quick task at `.planning/quick/260420-hcc-fix-web-dashboard-tailwind-tokens-agent-/`. The verification sweep output from Task D should be reported back to the user as a final message summarizing:
- Commit SHAs for A, B, C
- Typecheck / test / build status
- Token grep count (from dist CSS)
- Drain/rename grep count (from src/)
- Confirmation that server/, xci/, and package.json files are unchanged
</output>
