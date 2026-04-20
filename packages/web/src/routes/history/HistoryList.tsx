import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { type HistoryFilters, useRunHistory } from '../../hooks/useRunHistory.js';
import { useTasks } from '../../hooks/useTasks.js';
import type { RunState } from '../../lib/types.js';

const ALL_STATES: RunState[] = [
  'queued',
  'dispatched',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
  'orphaned',
];

export function HistoryList() {
  const [filters, setFilters] = useState<HistoryFilters>({ limit: 25 });
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data: tasksData } = useTasks();
  const { data, isLoading, error } = useRunHistory(filters);

  function toggleState(s: RunState) {
    setFilters((f) => {
      const current = new Set(f.states ?? []);
      if (current.has(s)) {
        current.delete(s);
      } else {
        current.add(s);
      }
      return { ...f, states: Array.from(current), cursor: undefined };
    });
    setCursorStack([]);
  }

  function next() {
    if (data?.nextCursor) {
      setCursorStack((s) => [...s, filters.cursor ?? '']);
      setFilters((f) => ({ ...f, cursor: data.nextCursor ?? undefined }));
    }
  }

  function prev() {
    setCursorStack((s) => {
      const last = s[s.length - 1];
      setFilters((f) => ({ ...f, cursor: last || undefined }));
      return s.slice(0, -1);
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">History</h1>

      {/* Filter panel */}
      <div className="mb-4 space-y-3 p-3 border rounded bg-card">
        {/* State multi-select checkboxes */}
        <div className="flex flex-wrap gap-3">
          {ALL_STATES.map((s) => (
            <label key={s} className="flex items-center gap-1 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={(filters.states ?? []).includes(s)}
                onChange={() => toggleState(s)}
              />
              {s}
            </label>
          ))}
        </div>

        {/* Task + date range filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <Label htmlFor="task-filter">Task</Label>
            <select
              id="task-filter"
              className="border rounded px-2 py-1 mt-1 block"
              value={filters.taskId ?? ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  taskId: e.target.value || undefined,
                  cursor: undefined,
                }))
              }
            >
              <option value="">All tasks</option>
              {(tasksData ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="datetime-local"
              className="mt-1"
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  from: e.target.value || undefined,
                  cursor: undefined,
                }))
              }
            />
          </div>

          <div>
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="datetime-local"
              className="mt-1"
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  to: e.target.value || undefined,
                  cursor: undefined,
                }))
              }
            />
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading && <div>Loading…</div>}
      {error && <div className="text-destructive">{(error as Error).message}</div>}
      {data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Finished</TableHead>
                <TableHead>Trigger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link to={`/runs/${r.id}`} className="hover:underline font-mono text-xs">
                      {r.id.slice(-8)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {(tasksData ?? []).find((t) => t.id === r.taskId)?.name ?? r.taskId.slice(-8)}
                  </TableCell>
                  <TableCell>{r.state}</TableCell>
                  <TableCell>{r.exitCode ?? '—'}</TableCell>
                  <TableCell>
                    {r.startedAt ? new Date(r.startedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    {r.finishedAt ? new Date(r.finishedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>{r.triggerSource}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div className="mt-3 flex gap-2">
            <Button variant="outline" disabled={cursorStack.length === 0} onClick={prev}>
              Previous
            </Button>
            <Button variant="outline" disabled={!data.nextCursor} onClick={next}>
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
