import { useState } from 'react';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table.js';
import { useAgentRename, useAgents } from '../../hooks/useAgents.js';
import type { Agent } from '../../lib/types.js';
import { AgentRowActions } from './AgentRowActions.js';
import { AgentsEmptyState } from './AgentsEmptyState.js';

function StateBadge({ state, lastSeenAt }: { state: string; lastSeenAt: string | null }) {
  const color =
    state === 'online' ? 'bg-green-500' : state === 'draining' ? 'bg-amber-500' : 'bg-gray-400';
  const text = state === 'online' ? 'Online' : state === 'draining' ? 'Draining' : 'Offline';
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {text}
      {lastSeenAt && (
        <span className="text-muted-foreground text-xs">
          ({new Date(lastSeenAt).toLocaleString()})
        </span>
      )}
    </span>
  );
}

function HostnameCell({ agent }: { agent: Agent }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(agent.hostname);
  const rename = useAgentRename();

  if (!editing) {
    return (
      // biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA
      <RoleGate role="member" tooltip="Viewers cannot rename agents">
        <button
          type="button"
          className="text-left hover:underline"
          onClick={() => setEditing(true)}
        >
          {agent.hostname}
        </button>
      </RoleGate>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        rename.mutate(
          { agentId: agent.id, hostname: value },
          { onSuccess: () => setEditing(false) },
        );
      }}
      className="flex gap-2"
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        autoFocus
        className="h-8"
      />
      <Button type="submit" size="sm" disabled={rename.isPending}>
        Save
      </Button>
    </form>
  );
}

export function AgentsList() {
  const { data: agents, isLoading, error } = useAgents();

  if (isLoading) return <div>Loading agents...</div>;
  if (error)
    return (
      <div className="text-destructive">Failed to load agents: {(error as Error).message}</div>
    );
  if (!agents || agents.length === 0) return <AgentsEmptyState />;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Agents</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hostname</TableHead>
            <TableHead>Labels</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Max concurrent</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <HostnameCell agent={a} />
              </TableCell>
              <TableCell className="text-xs font-mono">
                {Object.entries(a.labels)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}
              </TableCell>
              <TableCell>
                <StateBadge state={a.state} lastSeenAt={a.lastSeenAt} />
              </TableCell>
              <TableCell>{a.maxConcurrent}</TableCell>
              <TableCell>
                <AgentRowActions agent={a} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
