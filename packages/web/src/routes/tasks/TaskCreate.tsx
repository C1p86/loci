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

      {create.error &&
        !(
          create.error instanceof ApiError &&
          (create.error as ApiError).code === 'TASK_VALIDATION_FAILED'
        ) && <p className="text-destructive mt-2">{(create.error as Error).message}</p>}
    </div>
  );
}
