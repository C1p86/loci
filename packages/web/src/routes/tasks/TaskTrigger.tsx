import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { useTriggerRun } from '../../hooks/useRuns.js';
import { useTask } from '../../hooks/useTasks.js';
import { extractPlaceholders } from '../../lib/yaml-placeholders.js';

/**
 * UI-04 partial: Trigger form with auto-detected placeholder fields.
 * D-24: placeholders extracted from task.yaml_definition via extractPlaceholders.
 * D-25: server missingParams warning shown as non-blocking banner.
 * RoleGate: Viewer sees Trigger button disabled (UI-10).
 */
export function TaskTrigger() {
  const { id } = useParams<{ id: string }>();
  const { data: task } = useTask(id);
  // biome-ignore lint/style/noNonNullAssertion: id guaranteed by route /tasks/:id/trigger
  const trigger = useTriggerRun(id!);
  const nav = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});

  if (!task) return <div>Loading...</div>;

  const placeholders = extractPlaceholders(task.yaml_definition);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const overrides = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
    const res = await trigger.mutateAsync(overrides);
    nav(`/runs/${res.runId}`);
  }

  return (
    <div className="max-w-2xl">
      <Link to={`/tasks/${id}/edit`} className="text-sm text-muted-foreground hover:underline">
        ← Editor
      </Link>
      <h1 className="text-2xl font-semibold mb-4">Trigger run: {task.name}</h1>

      <form onSubmit={onSubmit} className="space-y-4">
        {placeholders.length === 0 && (
          <p className="text-muted-foreground">
            {/* biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal display of placeholder syntax */}
            This task has no {'${VAR}'} placeholders. Click Trigger to run with current defaults.
          </p>
        )}
        {placeholders.map((name) => (
          <div key={name}>
            <Label htmlFor={name}>{name}</Label>
            <Input
              id={name}
              value={values[name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
              placeholder="Leave blank to use org secret or agent-local value"
            />
          </div>
        ))}

        {trigger.data?.missing_params && trigger.data.missing_params.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 p-3 rounded text-sm">
            Server reports missing params: <code>{trigger.data.missing_params.join(', ')}</code>. If
            the agent has local secrets for these, the run will still succeed.
          </div>
        )}

        {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
        <RoleGate role="member" tooltip="Viewers cannot trigger runs">
          <Button type="submit" disabled={trigger.isPending}>
            {trigger.isPending ? 'Triggering...' : 'Trigger'}
          </Button>
        </RoleGate>

        {trigger.error && <p className="text-destructive">{(trigger.error as Error).message}</p>}
      </form>
    </div>
  );
}
