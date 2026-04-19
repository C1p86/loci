// packages/xci/src/agent/types.ts
// Frame envelope discriminated union (D-15).
// Phase 10 additions: dispatch/cancel/state(running)/log_chunk/result variants.

export interface RunState {
  run_id: string;
  status: 'running' | 'completed' | 'failed';
}

export interface ReconcileEntry {
  run_id: string;
  action: 'continue' | 'abandon';
}

/**
 * TaskSnapshot — baked into the `dispatch` frame (CONTEXT D-34).
 * Mirror of packages/server/src/ws/types.ts TaskSnapshot.
 */
export interface TaskSnapshot {
  task_id: string;
  name: string;
  description: string;
  yaml_definition: string;
  label_requirements: string[];
}

export type AgentFrame =
  // ---- outgoing: agent → server ----
  | { type: 'register'; token: string; labels: Record<string, string> }
  | { type: 'reconnect'; credential: string; running_runs: RunState[] }
  | { type: 'goodbye'; running_runs: RunState[] }
  // Phase 10: transition ack (run_id + state:'running')
  | { type: 'state'; state: 'running'; run_id: string }
  // Phase 10: log chunk streaming
  | {
      type: 'log_chunk';
      run_id: string;
      seq: number;
      stream: 'stdout' | 'stderr';
      data: string;
      ts: string;
    }
  // Phase 10: run result
  | { type: 'result'; run_id: string; exit_code: number; duration_ms: number; cancelled?: boolean }
  // ---- incoming: server → agent ----
  | { type: 'state'; state: 'draining' | 'online' }
  | { type: 'register_ack'; agent_id: string; credential: string }
  | { type: 'reconnect_ack'; reconciliation: ReconcileEntry[] }
  | { type: 'error'; code: string; message: string; close: boolean }
  // Phase 10 incoming: dispatch + cancel
  | {
      type: 'dispatch';
      run_id: string;
      task_snapshot: TaskSnapshot;
      params: Record<string, string>;
      timeout_seconds: number;
    }
  | { type: 'cancel'; run_id: string; reason: 'manual' | 'timeout' | 'reconciled_terminal' };
