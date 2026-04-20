import { Link } from 'react-router-dom';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { useTasks } from '../../hooks/useTasks.js';

export function TasksList() {
  const { data: tasks, isLoading, error } = useTasks();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div className="text-destructive">{(error as Error).message}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
        <RoleGate role="member" tooltip="Viewers cannot create tasks">
          <Link to="/tasks/new">
            <Button size="sm">New Task</Button>
          </Link>
        </RoleGate>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Labels</TableHead>
            <TableHead>Badge</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tasks ?? []).map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link className="hover:underline" to={`/tasks/${t.id}/edit`}>
                  {t.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{t.description}</TableCell>
              <TableCell className="font-mono text-xs">{t.labelRequirements.join(', ')}</TableCell>
              <TableCell>
                {t.expose_badge ? (
                  <span className="text-green-600 text-xs">Public</span>
                ) : (
                  <span className="text-muted-foreground text-xs">Private</span>
                )}
              </TableCell>
              <TableCell>{new Date(t.updatedAt).toLocaleDateString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
