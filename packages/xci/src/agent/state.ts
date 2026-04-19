import type { RunHandle } from './runner.js';
import type { TaskSnapshot } from './types.js';

/**
 * In-process agent state holder.
 * runningRuns is a Map in Phase 10 (was RunState[] stub in Phase 8).
 * draining is set to true when server sends {type:'state', state:'draining'}.
 * maxConcurrent comes from --max-concurrent flag (default 1).
 */
export interface AgentState {
  runningRuns: Map<string, { handle: RunHandle; startedAt: string; taskSnapshot: TaskSnapshot }>;
  draining: boolean;
  maxConcurrent: number;
}

export function createAgentState(maxConcurrent = 1): AgentState {
  return {
    runningRuns: new Map(),
    draining: false,
    maxConcurrent,
  };
}
