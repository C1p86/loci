// packages/xci/src/agent/types.ts
// Frame envelope discriminated union (D-15).
// Phase 10/11 variants (dispatch/cancel/log_chunk/result) are RESERVED — do not add here.

export interface RunState {
  run_id: string;
  status: 'running' | 'completed' | 'failed';
}

export interface ReconcileEntry {
  run_id: string;
  action: 'continue' | 'abandon';
}

export type AgentFrame =
  | { type: 'register'; token: string; labels: Record<string, string> }
  | { type: 'reconnect'; credential: string; running_runs: RunState[] }
  | { type: 'goodbye'; running_runs: RunState[] }
  | { type: 'state'; state: 'draining' | 'online' }
  | { type: 'register_ack'; agent_id: string; credential: string }
  | { type: 'reconnect_ack'; reconciliation: ReconcileEntry[] }
  | { type: 'error'; code: string; message: string; close: boolean };
