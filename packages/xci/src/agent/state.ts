import type { RunState } from './types.js';

/**
 * In-process agent state holder.
 * running_runs is empty in Phase 8; Phase 10 populates it when task dispatch is implemented.
 * draining is set to true when server sends {type:'state', state:'draining'}.
 */
export interface AgentState {
  runningRuns: RunState[]; // empty in Phase 8; Phase 10 populates
  draining: boolean;
}

export function createAgentState(): AgentState {
  return { runningRuns: [], draining: false };
}
