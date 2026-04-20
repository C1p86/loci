---
phase: 260420-hzy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/web/src/lib/types.ts
  - packages/web/src/routes/tasks/TaskEditor.tsx
  - packages/web/src/routes/tasks/TaskTrigger.tsx
  - packages/web/src/hooks/useRuns.ts
  - packages/web/src/hooks/useTasks.ts
  - packages/web/src/routes/tasks/TaskCreate.tsx
  - packages/web/src/routes/index.tsx
  - packages/web/src/routes/tasks/TasksList.tsx
autonomous: true
requirements:
  - QUICK-260420-hzy
must_haves:
  truths:
    - "User clicks 'New Task' on /tasks and navigates to /tasks/new"
    - "Submitting a valid name + YAML POSTs to /api/orgs/:orgId/tasks and redirects to /tasks/:id/edit"
    - "Editing an existing task's YAML and clicking 'Confirm save' now actually persists (PATCH body uses yamlDefinition matching server AJV schema)"
    - "Invalid YAML on create renders inline Monaco markers (same path as TaskEditor) instead of a silent failure"
    - "No occurrence of `yaml_definition` remains anywhere under packages/web/src/"
  artifacts:
    - path: "packages/web/src/lib/types.ts"
      provides: "TaskDetail.yamlDefinition (was yaml_definition)"
      contains: "yamlDefinition: string"
    - path: "packages/web/src/hooks/useTasks.ts"
      provides: "useCreateTask() mutation hook — POST /api/orgs/:orgId/tasks"
      exports: ["useTasks", "useTask", "useUpdateTask", "useCreateTask"]
    - path: "packages/web/src/routes/tasks/TaskCreate.tsx"
      provides: "New Task form route component"
      min_lines: 60
    - path: "packages/web/src/routes/index.tsx"
      provides: "Route /tasks/new registered BEFORE /tasks/:id/edit"
      contains: "tasks/new"
  key_links:
    - from: "packages/web/src/routes/tasks/TasksList.tsx"
      to: "/tasks/new"
      via: "<Link to='/tasks/new'> wrapping the New Task Button"
      pattern: "to=\"/tasks/new\""
    - from: "packages/web/src/routes/tasks/TaskCreate.tsx"
      to: "packages/web/src/hooks/useTasks.ts useCreateTask"
      via: "useCreateTask().mutateAsync({ name, description, yamlDefinition: value })"
      pattern: "useCreateTask"
    - from: "packages/web/src/routes/tasks/TaskEditor.tsx"
      to: "packages/server/src/routes/tasks/update.ts (PATCH body AJV schema)"
      via: "update.mutateAsync({ yamlDefinition: value }) — camelCase matches server additionalProperties:false"
      pattern: "yamlDefinition: value"
---

<objective>
Wire the "New Task" button in the web dashboard to a working Create Task flow AND fix a silent data bug where task YAML edits are never persisted because the web client sends `yaml_definition` (snake_case) while the server's AJV schema accepts only `yamlDefinition` (camelCase) with `additionalProperties: false`.

Purpose:
- The Create Task flow is the one missing CRUD operation on tasks in the web UI (we have List, Read, Update, Trigger — but no Create). Without it, the only way to create a task is via direct API call, which is unusable.
- The `yaml_definition` → `yamlDefinition` rename closes a production bug: today, clicking "Confirm save" in TaskEditor reports success (server returns 200, the PATCH body is just empty after AJV strips the unknown property) but the task row never changes. Users think they saved, they didn't.

Output:
- Renamed field `TaskDetail.yamlDefinition` with all 7 call sites updated.
- New `useCreateTask()` hook (POST-based sibling of `useUpdateTask`).
- New `TaskCreate.tsx` route component with Monaco editor + validation marker rendering identical to TaskEditor.
- Route `/tasks/new` registered before `/tasks/:id/edit` so the static path wins.
- `TasksList` "New Task" button becomes an actual `<Link>` to `/tasks/new`.
- Two atomic commits (A: fix, B: feat). Third verification step produces no commit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

<interfaces>
<!-- Server wire contract (source of truth). Do NOT change these; web must match. -->

From packages/server/src/routes/tasks/create.ts (POST /api/orgs/:orgId/tasks):
```ts
// AJV body schema — additionalProperties: false. Sending unknown keys is silently stripped.
interface CreateTaskBody {
  name: string;                  // required, 1..255
  description?: string;          // optional, <=2000, default ''
  yamlDefinition: string;        // required (CAMELCASE), 1..1048576
  labelRequirements?: string[];  // optional, default []
  trigger_configs?: unknown[];   // optional, snake_case (legacy — do not touch)
}
// Success: 201 { id: string }
// Validation failure: 400 with code 'XCI_SRV_TASK_VALIDATION' and details.errors: {message, line?, column?, suggestion?}[]
```

From packages/server/src/routes/tasks/get.ts (GET response shape):
```ts
{
  id, name, description,
  yamlDefinition: string,        // CAMELCASE on the wire
  labelRequirements: string[],
  slug,
  expose_badge: boolean,         // snake_case — server chose this, do not rename
  createdByUserId, createdAt, updatedAt
}
```

From packages/web/src/lib/api.ts:
```ts
export class ApiError extends Error {
  constructor(public code: string, public status: number, message: string, public details?: unknown);
}
export const apiPost: <T>(url: string, body?: unknown) => Promise<T>;
export const apiPatch: <T>(url: string, body?: unknown) => Promise<T>;
```

From packages/web/src/components/MonacoYamlEditor.tsx:
```ts
export interface MonacoMarker {
  line: number;
  column?: number;
  message: string;
  severity?: 'error' | 'warning';
}
export function MonacoYamlEditor(props: {
  value: string;
  onChange: (v: string) => void;
  markers?: MonacoMarker[];
  readOnly?: boolean;
  onSave?: () => void;
}): JSX.Element;
```

From packages/web/src/components/RoleGate.tsx:
```ts
export function RoleGate(props: {
  role: 'owner' | 'member' | 'viewer';
  tooltip?: string;
  children: ReactNode;
}): JSX.Element;
```

From packages/web/src/stores/authStore.ts (import path: '../stores/authStore.js'):
```ts
export const useAuthStore: <T>(sel: (s: { org?: { id: string; role: Role } }) => T) => T;
```
</interfaces>

<error_code_note>
TaskEditor.tsx line 51 checks `err.code === 'TASK_VALIDATION_FAILED'` — but the ACTUAL server code is `XCI_SRV_TASK_VALIDATION` (confirmed in packages/server/src/errors.ts line 316: `super('Task YAML validation failed', { code: 'XCI_SRV_TASK_VALIDATION' })`). This is a pre-existing web-side bug, NOT in scope for this ticket. TaskCreate MUST match TaskEditor's current behavior exactly — use the same string `'TASK_VALIDATION_FAILED'` so both components are consistent; a future cleanup can fix both at once.
</error_code_note>
</context>

<tasks>

<task type="auto">
  <name>Task A: Rename yaml_definition → yamlDefinition throughout packages/web/src/ (commit A)</name>
  <files>
    packages/web/src/lib/types.ts
    packages/web/src/routes/tasks/TaskEditor.tsx
    packages/web/src/routes/tasks/TaskTrigger.tsx
    packages/web/src/hooks/useRuns.ts
  </files>
  <action>
Rename the wire field `yaml_definition` to `yamlDefinition` everywhere it appears under `packages/web/src/`. The server already returns/accepts `yamlDefinition` (see create.ts AJV schema line 88 and get.ts response line 35). Leave `expose_badge` and `trigger_configs` UNCHANGED — those are snake_case on the server wire and the mismatch in those fields does not exist.

Exact edits (verified via grep — total 7 code occurrences + 1 comment):

1. `packages/web/src/lib/types.ts` line 60:
   - `yaml_definition: string;` → `yamlDefinition: string;`

2. `packages/web/src/routes/tasks/TaskEditor.tsx`:
   - Line 43: `if (task) setValue(task.yaml_definition);` → `if (task) setValue(task.yamlDefinition);`
   - Line 49: `await update.mutateAsync({ yaml_definition: value });` → `await update.mutateAsync({ yamlDefinition: value });`
   - Line 69: `const dirty = value !== task.yaml_definition;` → `const dirty = value !== task.yamlDefinition;`
   - Line 129: `<MonacoYamlDiffEditor original={task.yaml_definition} modified={value} />` → `<MonacoYamlDiffEditor original={task.yamlDefinition} modified={value} />`

3. `packages/web/src/routes/tasks/TaskTrigger.tsx`:
   - Line 13 (docstring comment): `* D-24: placeholders extracted from task.yaml_definition via extractPlaceholders.` → `* D-24: placeholders extracted from task.yamlDefinition via extractPlaceholders.`
   - Line 27: `const placeholders = extractPlaceholders(task.yaml_definition);` → `const placeholders = extractPlaceholders(task.yamlDefinition);`

4. `packages/web/src/hooks/useRuns.ts` line 7:
   - `task: { id: string; name: string; yaml_definition: string };` → `task: { id: string; name: string; yamlDefinition: string };`

After editing, if `pnpm --filter @xci/web test` turns up test files that assert against the old key, update those assertions to the new key. DO NOT delete assertions. If no test file references the key, no test changes are needed.

DO NOT touch any file outside `packages/web/src/`. DO NOT touch `packages/server/src/`, `packages/xci/`, or any `package.json`. DO NOT rename `expose_badge` or `trigger_configs`.

Commit this change as a standalone commit BEFORE starting Task B:
```
fix(web): align task yamlDefinition key with server camelCase

Server AJV schema on POST /tasks and PATCH /tasks uses additionalProperties:false
with the property name `yamlDefinition` (camelCase). The web client was sending
`yaml_definition` (snake_case), which AJV silently stripped. Result: the UI
reported save success but the YAML never actually updated. Renaming the
`TaskDetail` field and all 7 call sites restores edit persistence.
```
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && grep -rn "yaml_definition" packages/web/src/ ; test $(grep -rn "yaml_definition" packages/web/src/ | wc -l) -eq 0 && pnpm --filter @xci/web typecheck</automated>
  </verify>
  <done>
    - `grep -rn "yaml_definition" packages/web/src/` returns 0 matches (code AND comments).
    - `pnpm --filter @xci/web typecheck` reports no errors.
    - `pnpm --filter @xci/web test` is green (updated assertions OK; zero deleted assertions).
    - Commit A is on HEAD with the exact message above; `git show --stat HEAD` shows the 4 files touched.
  </done>
</task>

<task type="auto">
  <name>Task B: Add Create Task flow — useCreateTask hook, TaskCreate route, router entry, wire New Task button (commit B)</name>
  <files>
    packages/web/src/hooks/useTasks.ts
    packages/web/src/routes/tasks/TaskCreate.tsx
    packages/web/src/routes/index.tsx
    packages/web/src/routes/tasks/TasksList.tsx
  </files>
  <action>

**Step 1 — Extend useTasks.ts with useCreateTask mutation.**

Edit `packages/web/src/hooks/useTasks.ts`:

a) On line 2, extend the api import to include `apiPost`:
```ts
// before
import { apiGet, apiPatch } from '../lib/api.js';
// after
import { apiGet, apiPatch, apiPost } from '../lib/api.js';
```

b) Append AFTER the existing `useUpdateTask` export (end of file):
```ts
export function useCreateTask() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (body: {
      name: string;
      description?: string;
      yamlDefinition: string;
      labelRequirements?: string[];
    }) => apiPost<{ id: string }>(`/api/orgs/${orgId}/tasks`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', 'list', orgId] }),
  });
}
```

Rationale for body shape: it is the minimal AJV-accepted subset of CreateTaskBody from create.ts lines 66-72. `trigger_configs` is intentionally omitted — the Create flow does not set plugin triggers (those are managed elsewhere).

**Step 2 — Create TaskCreate.tsx route component.**

Create new file `packages/web/src/routes/tasks/TaskCreate.tsx` modelled on `TaskEditor.tsx` but simplified (no diff dialog, no initial fetch, no id). Full contents:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { type MonacoMarker, MonacoYamlEditor } from '../../components/MonacoYamlEditor.js';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { useCreateTask } from '../../hooks/useTasks.js';
import { ApiError } from '../../lib/api.js';

interface ValidationError {
  line: number;
  column?: number;
  message: string;
  suggestion?: string;
}

const DEFAULT_YAML = `# Define your command aliases here.
# Example:
hello:
  cmd: echo "hello from xci"
`;

/**
 * Create Task flow. POST /api/orgs/:orgId/tasks, then redirect to /tasks/:id/edit.
 * Validation errors render as inline Monaco markers (same path as TaskEditor).
 * No diff dialog (diff only makes sense when editing existing YAML).
 */
export function TaskCreate() {
  const nav = useNavigate();
  const create = useCreateTask();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [value, setValue] = useState(DEFAULT_YAML);
  const [markers, setMarkers] = useState<MonacoMarker[]>([]);

  async function save() {
    setMarkers([]);
    try {
      const res = await create.mutateAsync({
        name,
        description,
        yamlDefinition: value,
      });
      nav(`/tasks/${res.id}/edit`);
    } catch (err) {
      // Match TaskEditor's existing error-code check for consistency.
      // NOTE: the actual server code is 'XCI_SRV_TASK_VALIDATION'; TaskEditor uses
      // 'TASK_VALIDATION_FAILED'. Mirror TaskEditor here — a future cleanup will fix both.
      if (err instanceof ApiError && err.status === 400 && err.code === 'TASK_VALIDATION_FAILED') {
        const errs = (err.details as { errors?: ValidationError[] })?.errors ?? [];
        setMarkers(
          errs.map((e) => ({
            line: e.line,
            column: e.column,
            message: e.suggestion ? `${e.message}\nSuggestion: ${e.suggestion}` : e.message,
            severity: 'error' as const,
          })),
        );
      } else {
        throw err;
      }
    }
  }

  const canSubmit = name.length > 0 && value.length > 0 && !create.isPending;

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <Link to="/tasks" className="text-sm text-muted-foreground hover:underline">
            ← Tasks
          </Link>
          <h1 className="text-2xl font-semibold">New Task</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/tasks">
            <Button variant="outline">Cancel</Button>
          </Link>
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
          <RoleGate role="member" tooltip="Viewers cannot create tasks">
            <Button onClick={save} disabled={!canSubmit}>
              {create.isPending ? 'Creating…' : 'Create'}
            </Button>
          </RoleGate>
        </div>
      </div>

      <div className="grid gap-3 mb-3">
        <div>
          <Label htmlFor="task-name">Name</Label>
          <Input
            id="task-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-task"
            maxLength={255}
          />
        </div>
        <div>
          <Label htmlFor="task-description">Description</Label>
          <textarea
            id="task-description"
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            maxLength={2000}
          />
        </div>
      </div>

      <MonacoYamlEditor
        value={value}
        onChange={setValue}
        markers={markers}
        onSave={() => {
          if (canSubmit) void save();
        }}
      />

      {markers.length > 0 && (
        <aside className="border-t p-3 bg-destructive/10">
          <h3 className="text-sm font-semibold text-destructive mb-1">
            {markers.length} validation error(s):
          </h3>
          <ul className="text-sm space-y-1">
            {markers.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static list of errors
              <li key={i}>
                Line {m.line}: {m.message}
              </li>
            ))}
          </ul>
        </aside>
      )}

      {create.error && !(create.error instanceof ApiError && (create.error as ApiError).code === 'TASK_VALIDATION_FAILED') && (
        <p className="text-destructive mt-2">{(create.error as Error).message}</p>
      )}
    </div>
  );
}
```

Notes:
- `Label` is imported from `../../components/ui/label.js` — same path pattern TaskTrigger.tsx uses.
- The textarea is inlined (no shadcn `<Textarea>` component in this repo at time of writing; using the same utility classes as `<Input>` keeps it visually consistent with Input styling). If a `ui/textarea.tsx` already exists in repo, use it instead — quickly verify with `ls packages/web/src/components/ui/textarea.tsx` before inlining; otherwise keep the inline textarea.
- NO diff dialog (create has no "original" to diff against — the diff only makes sense for edit).
- NO custom Monaco YAML schema injection — reuse MonacoYamlEditor as-is.

**Step 3 — Register the route BEFORE /tasks/:id/edit so the static path wins.**

Edit `packages/web/src/routes/index.tsx`:

a) Add the import near the other `./tasks/...` imports (current lines 17-19):
```ts
import { TaskCreate } from './tasks/TaskCreate.js';
```
Sorted ordering: put it between `TaskEditor` and `TasksList` (alphabetical by filename: TaskCreate < TaskEditor < TasksList < TaskTrigger). Or append after TaskTrigger if easier — the order of imports doesn't affect behaviour, but follow the existing alphabetical-ish grouping.

b) Insert a new child route in the router. CRITICAL ORDERING: `'tasks/new'` must come BEFORE `'tasks/:id/edit'` so React Router's static-segment matcher wins. Current child block (lines 33-43) becomes:

```tsx
children: [
  { index: true, element: <Navigate to="/agents" replace /> },
  { path: 'agents', element: <AgentsList /> },
  { path: 'tasks', element: <TasksList /> },
  { path: 'tasks/new', element: <TaskCreate /> },       // NEW — must be before :id/edit
  { path: 'tasks/:id/edit', element: <TaskEditor /> },
  { path: 'tasks/:id/trigger', element: <TaskTrigger /> },
  { path: 'runs/:id', element: <RunDetail /> },
  { path: 'history', element: <HistoryList /> },
  { path: 'settings/org', element: <OrgSettings /> },
  { path: 'settings/plugins', element: <PluginSettings /> },
  { path: 'dlq', element: <DlqList /> },
  { path: '*', element: <NotFound /> },
],
```

**Step 4 — Wire the New Task button in TasksList.tsx.**

Edit `packages/web/src/routes/tasks/TasksList.tsx` lines 24-27. The RoleGate stays as the parent (so Viewer sees the button disabled with tooltip). Wrap the Button in a Link:

```tsx
{/* before */}
<RoleGate role="member" tooltip="Viewers cannot create tasks">
  <Button size="sm">New Task</Button>
</RoleGate>

{/* after */}
<RoleGate role="member" tooltip="Viewers cannot create tasks">
  <Link to="/tasks/new">
    <Button size="sm">New Task</Button>
  </Link>
</RoleGate>
```

`Link` is already imported on line 1 — no import change needed. The RoleGate remains the outer wrapper so Viewers get the disabled+tooltip treatment (D-11 invariant already established in Phase 13).

Commit this step as commit B with message:
```
feat(web): add Create Task flow (POST /tasks) wired to New Task button

- New useCreateTask() hook POSTs to /api/orgs/:orgId/tasks and invalidates
  the tasks list cache on success.
- New TaskCreate.tsx route component with Monaco YAML editor and inline
  validation marker rendering (same path as TaskEditor). No diff dialog —
  diff only applies to edits.
- Route /tasks/new registered BEFORE /tasks/:id/edit in createBrowserRouter
  so the static segment wins over the :id parameter matcher.
- TasksList "New Task" button becomes a real Link to /tasks/new while
  keeping the RoleGate so Viewers still see it disabled with tooltip.
```

Hard prohibitions (restated):
- DO NOT touch `packages/server/src/`, `packages/xci/`, or any `package.json`.
- DO NOT implement task deletion.
- DO NOT add a confirm/diff dialog on Create.
- DO NOT add custom YAML schemas to Monaco.
- DO NOT rename `expose_badge` or `trigger_configs`.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter @xci/web typecheck && pnpm --filter @xci/web test && pnpm --filter @xci/web build</automated>
  </verify>
  <done>
    - `packages/web/src/routes/tasks/TaskCreate.tsx` exists and exports `TaskCreate`.
    - `packages/web/src/hooks/useTasks.ts` exports `useCreateTask`; `apiPost` is imported.
    - `packages/web/src/routes/index.tsx` has a `path: 'tasks/new'` entry, strictly before `path: 'tasks/:id/edit'` (verify ordering via grep).
    - `packages/web/src/routes/tasks/TasksList.tsx` renders `<Link to="/tasks/new">` inside the RoleGate.
    - Typecheck, test, and build all pass for `@xci/web`.
    - Manual sanity (not a gate, but cheap): `grep -n "tasks/new" packages/web/src/routes/index.tsx packages/web/src/routes/tasks/TasksList.tsx` shows both hits.
    - Commit B on HEAD with exact message above; `git show --stat HEAD` lists the 4 files.
  </done>
</task>

<task type="auto">
  <name>Task C: Final verification sweep — no commit, gate-only</name>
  <files>(no files modified)</files>
  <action>
Run the full verification matrix. Any failure halts and must be fixed before summary. These are all read-only / regression guards — they produce NO commit.

Run each command from repo root (`/home/developer/projects/loci`). Report the exact output for any non-trivial check.

1. Typecheck the web package:
   ```
   pnpm --filter @xci/web typecheck
   ```
   Expected: exit 0, no errors.

2. Unit + integration tests for the web package:
   ```
   pnpm --filter @xci/web test
   ```
   Expected: all green. Updated assertions are acceptable; deleted assertions are NOT.

3. Production build:
   ```
   pnpm --filter @xci/web build
   ```
   Expected: exit 0.

4. Grep fence for the renamed key:
   ```
   grep -rn "yaml_definition" packages/web/src/
   ```
   Expected: zero matches.

5. Regression guard — Phase 260420-hcc Tailwind tokens still intact in the freshly-built CSS:
   ```
   ls packages/web/dist/assets/index-*.css 2>/dev/null | head -1
   ```
   If a file is found, run:
   ```
   grep -oE "bg-background|text-foreground|border-border" packages/web/dist/assets/index-*.css | wc -l
   ```
   Expected: ≥ 3. If the dist file does not exist (skipped build path), document the skip in the summary and rely on step 3 having succeeded.

6. Regression guard — Phase 260420-ezf agent bundle unchanged:
   ```
   test -f packages/xci/dist/cli.mjs && grep -c "'./agent.mjs'" packages/xci/dist/cli.mjs
   ```
   If `packages/xci/dist/cli.mjs` exists, the count must be ≥ 1. If the file does not exist (xci has not been rebuilt in this session), skip this check — we did not touch xci at all.

7. Route-order regression guard:
   ```
   grep -n "tasks/new\|tasks/:id/edit" packages/web/src/routes/index.tsx
   ```
   Expected: `tasks/new` line number is numerically lower than `tasks/:id/edit` line number.

8. Two-commits-clean guard:
   ```
   git log --oneline -n 3
   ```
   Expected: HEAD is Task B feat commit, HEAD~1 is Task A fix commit, and the working tree is clean (`git status --porcelain` returns empty).

If all 8 steps pass, the quick task is complete. Produce the summary file per the `<output>` section.
  </action>
  <verify>
    <automated>cd /home/developer/projects/loci && pnpm --filter @xci/web typecheck && pnpm --filter @xci/web test && pnpm --filter @xci/web build && test $(grep -rn "yaml_definition" packages/web/src/ | wc -l) -eq 0 && git diff --quiet && git diff --cached --quiet</automated>
  </verify>
  <done>
    - Steps 1-4 all green.
    - Step 5 passes OR documented skip because dist asset not produced.
    - Step 6 passes OR documented skip because `packages/xci/dist/cli.mjs` absent (we did not rebuild xci).
    - Step 7: `tasks/new` line number < `tasks/:id/edit` line number in `packages/web/src/routes/index.tsx`.
    - Step 8: Exactly two new commits (A fix, B feat), working tree clean.
    - No new commit created by Task C.
  </done>
</task>

</tasks>

<verification>
Phase-level verification (all must hold before summary):
- `grep -rn "yaml_definition" packages/web/src/` → zero matches.
- `pnpm --filter @xci/web typecheck && pnpm --filter @xci/web test && pnpm --filter @xci/web build` → all green.
- `packages/web/src/routes/index.tsx` contains both `tasks/new` and `tasks/:id/edit` routes, with `tasks/new` appearing FIRST (static segment wins over param).
- `packages/web/src/routes/tasks/TasksList.tsx` wraps the "New Task" Button in `<Link to="/tasks/new">`.
- `packages/web/src/hooks/useTasks.ts` exports `useCreateTask`.
- `git log --oneline -n 2` shows exactly two new commits:
  1. `fix(web): align task yamlDefinition key with server camelCase`
  2. `feat(web): add Create Task flow (POST /tasks) wired to New Task button`
- Working tree is clean (`git status --porcelain` empty).

Manual spot-check (optional, not a gate): In dev mode, clicking "New Task" on /tasks navigates to /tasks/new; submitting `name="manual-smoke"` with the default YAML returns 201 and redirects to /tasks/:id/edit; clicking "Confirm save" in the editor after changing the YAML now actually persists (reloading the page shows the new YAML, not the pre-edit value).
</verification>

<success_criteria>
1. "New Task" button navigates to `/tasks/new` (key link #1).
2. Valid submission POSTs to `/api/orgs/:orgId/tasks` with body shape `{name, description, yamlDefinition, labelRequirements?}` and on 201 navigates to `/tasks/${id}/edit` (key link #2).
3. Invalid YAML surfaces inline Monaco markers (no silent failure).
4. Editing an existing task now actually persists — the rename closes the `additionalProperties:false` silent-drop bug (key link #3).
5. Zero references to `yaml_definition` remain under `packages/web/src/`.
6. Two atomic commits on HEAD (A then B); Task C produces none.
7. No files outside `packages/web/src/` modified.
</success_criteria>

<output>
After completion, write `.planning/quick/260420-hzy-wire-new-task-flow-fix-yamldefinition-ca/260420-hzy-SUMMARY.md` using the summary template.

The summary must include:
- The two commit hashes (A then B) with subject lines.
- Confirmation that all 8 Task-C verification steps passed (or documented skip with reason for steps 5 and 6 only).
- A one-line "behavior change" statement: "Web dashboard now supports task creation; task YAML edits now persist (closes silent-drop bug from AJV additionalProperties:false)."
- Any deviations from this plan (expected: none).
</output>
