import { useState } from 'react';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog.js';
import { useAgentDrain, useAgentRevoke } from '../../hooks/useAgents.js';
import type { Agent } from '../../lib/types.js';

interface AgentRowActionsProps {
  agent: Agent;
}

export function AgentRowActions({ agent }: AgentRowActionsProps) {
  const drain = useAgentDrain();
  const revoke = useAgentRevoke();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex gap-2">
      {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
      <RoleGate role="member" tooltip="Viewers cannot drain agents">
        <Button
          size="sm"
          variant="outline"
          disabled={agent.state === 'draining' || drain.isPending}
          onClick={() => drain.mutate({ agentId: agent.id })}
        >
          {agent.state === 'draining' ? 'Draining' : 'Drain'}
        </Button>
      </RoleGate>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
        <RoleGate role="member" tooltip="Viewers cannot revoke agents">
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive">
              Revoke
            </Button>
          </DialogTrigger>
        </RoleGate>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke agent?</DialogTitle>
          </DialogHeader>
          <p>
            This disconnects the agent immediately. It can re-register with a new registration
            token.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                revoke.mutate({ agentId: agent.id });
                setConfirmOpen(false);
              }}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
