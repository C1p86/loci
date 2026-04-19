// WS frame types for the agent protocol (D-15).
// Server-side counterpart to packages/xci/src/agent/types.ts.

export interface RunState {
  run_id: string;
  status: 'running' | 'completed' | 'failed';
}

export interface ReconcileEntry {
  run_id: string;
  action: 'continue' | 'abandon';
}

/**
 * TaskSnapshot — baked into the `dispatch` frame (CONTEXT D-34) and stored in
 * task_runs.task_snapshot JSONB column. Defined here to keep protocol types and
 * persistence types decoupled (Phase 11 log_chunk storage can import without Drizzle types).
 */
export interface TaskSnapshot {
  task_id: string;
  name: string;
  description: string;
  yaml_definition: string;
  label_requirements: string[];
}

// Agent → server (parsed on this side)
export type AgentIncomingFrame =
  | { type: 'register'; token: string; labels: Record<string, string> }
  | { type: 'reconnect'; credential: string; running_runs: RunState[] }
  | { type: 'goodbye'; running_runs: RunState[] }
  // Phase 10 additions (D-34):
  // NOTE: 'state' has a different shape from the outgoing ServerOutgoingFrame 'state' variant.
  // Incoming: includes run_id + state='running' (transition ack from agent).
  // Outgoing: includes state='draining'|'online' (admin state push from server), NO run_id.
  // These live in separate unions — no runtime conflict.
  | { type: 'state'; state: 'running'; run_id: string }
  | { type: 'result'; run_id: string; exit_code: number; duration_ms: number; cancelled?: boolean }
  | {
      type: 'log_chunk';
      run_id: string;
      seq: number;
      stream: 'stdout' | 'stderr';
      data: string;
      ts: string;
    };

// Server → agent (emitted from this side)
export type ServerOutgoingFrame =
  | { type: 'register_ack'; agent_id: string; credential: string }
  | { type: 'reconnect_ack'; reconciliation: ReconcileEntry[] }
  | { type: 'state'; state: 'draining' | 'online' }
  | { type: 'error'; code: string; message: string; close: boolean }
  // Phase 10 additions (D-34) — server-to-agent only; never parsed as incoming:
  | {
      type: 'dispatch';
      run_id: string;
      task_snapshot: TaskSnapshot;
      params: Record<string, string>;
      timeout_seconds: number;
    }
  | { type: 'cancel'; run_id: string; reason: 'manual' | 'timeout' | 'reconciled_terminal' };
