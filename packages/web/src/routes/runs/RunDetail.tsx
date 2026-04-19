import { Link, useParams } from 'react-router-dom';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import { useCancelRun, useRun } from '../../hooks/useRuns.js';

const STATE_CLASSES: Record<string, string> = {
  queued: 'bg-gray-200 text-gray-800',
  dispatched: 'bg-blue-200 text-blue-900',
  running: 'bg-blue-500 text-white',
  succeeded: 'bg-green-600 text-white',
  failed: 'bg-red-600 text-white',
  cancelled: 'bg-gray-400 text-white',
  timed_out: 'bg-amber-600 text-white',
  orphaned: 'bg-amber-800 text-white',
};

function StateBadge({ state }: { state: string }) {
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${STATE_CLASSES[state] ?? ''}`}>
      {state}
    </span>
  );
}

/**
 * UI-04 partial: Run detail shell.
 * Real LogViewer wired in Plan 13-04 (hooks into id="log-viewer-mount").
 * Auto-polls via useRun refetchInterval until terminal state (D-19).
 */
export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: run, isLoading, error } = useRun(id);
  // biome-ignore lint/style/noNonNullAssertion: id guaranteed by route /runs/:id
  const cancel = useCancelRun(id!);

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div className="text-destructive">{(error as Error).message}</div>;
  if (!run) return null;

  return (
    <div>
      <div className="mb-4">
        <Link
          to={`/tasks/${run.taskId}/edit`}
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Task
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-semibold">Run {run.id.slice(-8)}</h1>
          <StateBadge state={run.state} />
          {run.exitCode != null && (
            <span className="text-sm text-muted-foreground">exit {run.exitCode}</span>
          )}
          {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
          <RoleGate role="member" tooltip="Viewers cannot cancel runs">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                cancel.isPending ||
                ['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned'].includes(run.state)
              }
              onClick={() => cancel.mutate()}
            >
              Cancel run
            </Button>
          </RoleGate>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm mb-6">
        <dt className="text-muted-foreground">Queued</dt>
        <dd>{new Date(run.queuedAt).toLocaleString()}</dd>
        <dt className="text-muted-foreground">Started</dt>
        <dd>{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</dd>
        <dt className="text-muted-foreground">Finished</dt>
        <dd>{run.finishedAt ? new Date(run.finishedAt).toLocaleString() : '—'}</dd>
        <dt className="text-muted-foreground">Trigger</dt>
        <dd>{run.triggerSource}</dd>
      </dl>

      {/* Log viewer placeholder — real implementation wired in Plan 13-04 Task 1
          (hooks into /ws/orgs/:orgId/runs/:runId/logs WebSocket) */}
      <div
        id="log-viewer-mount"
        className="border rounded-md bg-muted/30 p-4 min-h-[300px] text-sm text-muted-foreground"
      >
        Log viewer will be wired in Plan 13-04. Real rendering hooks into
        /ws/orgs/:orgId/runs/:runId/logs in Plan 13-04 Task 1.
      </div>

      {/* Download raw log — passes session cookie via credentials:include */}
      <div className="mt-3">
        <a
          href={`/api/orgs/${run.taskId}/runs/${run.id}/logs.log`}
          download
          className="text-sm underline text-muted-foreground hover:text-foreground"
        >
          Download raw log
        </a>
      </div>
    </div>
  );
}
