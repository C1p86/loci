import { CopyableCommand } from '../../components/CopyableCommand.js';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import { useCreateRegistrationToken } from '../../hooks/useRegistrationToken.js';
import { buildAgentWsUrl } from '../../lib/agentUrl.js';

/**
 * UI-09 / SC-2: First-run empty state shown when no agents are registered.
 * Security: T-13-03-02 — token held in mutation result only, never stored.
 */
export function AgentsEmptyState() {
  const mut = useCreateRegistrationToken();
  // Use VITE_API_URL if set (dev proxy override), else window.location.origin,
  // then normalize to the canonical WS URL the xci agent connects to.
  const origin =
    (import.meta.env.VITE_API_URL as string | undefined) ?? window.location.origin;
  const agentWsUrl = buildAgentWsUrl(origin);

  const command = mut.data ? `xci --agent ${agentWsUrl} --token ${mut.data.token}` : null;

  return (
    <div className="max-w-2xl mx-auto mt-16 p-6 border rounded-lg bg-card">
      <h2 className="text-xl font-semibold mb-2">No agents registered yet</h2>
      <p className="text-muted-foreground mb-4">
        Register your first agent to start running tasks. Generate a one-time token, then run the
        xci CLI on the machine you want to enroll.
      </p>

      {!command && (
        // biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA
        <RoleGate role="member" tooltip="Viewers cannot generate registration tokens">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Generating...' : 'Generate registration token'}
          </Button>
        </RoleGate>
      )}

      {command && (
        <>
          <CopyableCommand command={command} label="Run this on the agent machine:" />
          <p className="text-xs text-muted-foreground">
            This token is shown only once. It expires in 24 hours and can be used to register a
            single agent.
          </p>
        </>
      )}

      {mut.error && (
        <p className="text-destructive mt-2">
          Failed to generate token: {(mut.error as Error).message}
        </p>
      )}
    </div>
  );
}
