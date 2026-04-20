import { GenerateTokenButton } from './GenerateTokenButton.js';

/**
 * UI-09 / SC-2: First-run empty state shown when no agents are registered.
 * Delegates token generation to GenerateTokenButton (shared with AgentsList header).
 */
export function AgentsEmptyState() {
  return (
    <div className="max-w-2xl mx-auto mt-16 p-6 border rounded-lg bg-card">
      <h2 className="text-xl font-semibold mb-2">No agents registered yet</h2>
      <p className="text-muted-foreground mb-4">
        Register your first agent to start running tasks. Generate a one-time token, then run the
        xci CLI on the machine you want to enroll.
      </p>
      <GenerateTokenButton />
    </div>
  );
}
