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

// Agent → server (parsed on this side)
export type AgentIncomingFrame =
  | { type: 'register'; token: string; labels: Record<string, string> }
  | { type: 'reconnect'; credential: string; running_runs: RunState[] }
  | { type: 'goodbye'; running_runs: RunState[] };

// Server → agent (emitted from this side)
export type ServerOutgoingFrame =
  | { type: 'register_ack'; agent_id: string; credential: string }
  | { type: 'reconnect_ack'; reconciliation: ReconcileEntry[] }
  | { type: 'state'; state: 'draining' | 'online' }
  | { type: 'error'; code: string; message: string; close: boolean };

// Reserved Phase 10/11 frame types — defined here for the discriminated union
// but parseAgentFrame returns an error for them in Phase 8 (server doesn't handle them yet).
// | { type: 'dispatch'; run_id: string }               // P10 — RESERVED
// | { type: 'cancel'; run_id: string }                 // P10 — RESERVED
// | { type: 'log_chunk'; run_id: string; seq: number; data: string } // P11 — RESERVED
// | { type: 'result'; run_id: string; exit_code: number }             // P10 — RESERVED
