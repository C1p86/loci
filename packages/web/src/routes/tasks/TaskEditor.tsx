import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  type MonacoMarker,
  MonacoYamlDiffEditor,
  MonacoYamlEditor,
} from '../../components/MonacoYamlEditor.js';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { useTask, useUpdateTask } from '../../hooks/useTasks.js';
import { ApiError } from '../../lib/api.js';

interface ValidationError {
  line: number;
  column?: number;
  message: string;
  suggestion?: string;
}

/**
 * UI-03: Monaco YAML editor with inline validation markers.
 * SC-4: Server 400 TASK_VALIDATION_FAILED renders as Monaco setModelMarkers.
 * T-13-03-03: Error messages rendered via React JSX — no dangerouslySetInnerHTML.
 */
export function TaskEditor() {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading } = useTask(id);
  // biome-ignore lint/style/noNonNullAssertion: id is guaranteed by route definition /tasks/:id/edit
  const update = useUpdateTask(id!);

  const [value, setValue] = useState('');
  const [markers, setMarkers] = useState<MonacoMarker[]>([]);
  const [diffOpen, setDiffOpen] = useState(false);

  useEffect(() => {
    if (task) setValue(task.yamlDefinition);
  }, [task]);

  async function save() {
    setMarkers([]);
    try {
      await update.mutateAsync({ yamlDefinition: value });
    } catch (err) {
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

  if (isLoading || !task) return <div>Loading...</div>;

  const dirty = value !== task.yamlDefinition;

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <Link to="/tasks" className="text-sm text-muted-foreground hover:underline">
            ← Tasks
          </Link>
          <h1 className="text-2xl font-semibold">{task.name}</h1>
        </div>
        <div className="flex gap-2">
          <Link to={`/tasks/${id}/trigger`}>
            {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
            <RoleGate role="member" tooltip="Viewers cannot trigger runs">
              <Button variant="outline">Trigger run</Button>
            </RoleGate>
          </Link>
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
          <RoleGate role="member" tooltip="Viewers cannot save tasks">
            <Button
              onClick={() => (dirty ? setDiffOpen(true) : undefined)}
              disabled={!dirty || update.isPending}
            >
              {update.isPending ? 'Saving...' : 'Save'}
            </Button>
          </RoleGate>
        </div>
      </div>

      <MonacoYamlEditor
        value={value}
        onChange={setValue}
        markers={markers}
        onSave={() => {
          if (dirty) setDiffOpen(true);
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

      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review changes</DialogTitle>
          </DialogHeader>
          <MonacoYamlDiffEditor original={task.yamlDefinition} modified={value} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiffOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await save();
                setDiffOpen(false);
              }}
            >
              Confirm save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
