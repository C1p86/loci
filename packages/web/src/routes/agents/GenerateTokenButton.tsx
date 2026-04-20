import { CopyableCommand } from '../../components/CopyableCommand.js';
import { RoleGate } from '../../components/RoleGate.js';
import { Button } from '../../components/ui/button.js';
import { useCreateRegistrationToken } from '../../hooks/useRegistrationToken.js';
import { buildAgentWsUrl } from '../../lib/agentUrl.js';

/**
 * Shared "generate agent registration token" control.
 * Used by AgentsEmptyState (first-run) and AgentsList header (persistent).
 * Security: T-13-03-02 — token held in mutation result only, never stored.
 */
export function GenerateTokenButton() {
  const mut = useCreateRegistrationToken();
  const origin =
    (import.meta.env.VITE_API_URL as string | undefined) ?? window.location.origin;
  const agentWsUrl = buildAgentWsUrl(origin);

  const command = mut.data ? `xci --agent ${agentWsUrl} --token ${mut.data.token}` : null;

  if (!command) {
    return (
      <div>
        {/* biome-ignore lint/a11y/useValidAriaRole: RoleGate.role is a business role prop, not ARIA */}
        <RoleGate role="member" tooltip="Viewers cannot generate registration tokens">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? 'Generating...' : 'Generate registration token'}
          </Button>
        </RoleGate>
        {mut.error && (
          <p className="text-destructive text-xs mt-1">
            Failed: {(mut.error as Error).message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <CopyableCommand command={command} label="Run this on the agent machine:" />
      <p className="text-xs text-muted-foreground mt-1">
        This token is shown only once. It expires in 24 hours and can be used to register a
        single agent.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => mut.reset()}
      >
        Generate another
      </Button>
    </div>
  );
}
