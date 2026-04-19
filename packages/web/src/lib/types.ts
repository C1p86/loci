export type Role = 'owner' | 'member' | 'viewer';
export type RunState =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'orphaned';
export type AgentState = 'online' | 'offline' | 'draining';

export interface User {
  id: string;
  email: string;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface Plan {
  planName: string;
  maxAgents: number;
  maxConcurrentTasks: number;
  logRetentionDays: number;
}

export interface AuthMe {
  ok: true;
  user: User;
  org: Org;
  plan: Plan;
}

export interface Agent {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  state: AgentState;
  lastSeenAt: string | null;
  maxConcurrent: number;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  slug: string;
  expose_badge: boolean;
  labelRequirements: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends Task {
  yaml_definition: string;
  trigger_configs: unknown[];
}

export interface RunSummary {
  id: string;
  taskId: string;
  state: RunState;
  exitCode: number | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  triggerSource: 'manual' | 'webhook';
}

export interface Usage {
  agents: { current: number; max: number };
  concurrent: { current: number; max: number };
  retentionDays: number;
}
export interface LogChunk {
  seq: number;
  stream: 'stdout' | 'stderr';
  ts: string; // ISO
  data: string;
}

export interface LogGap {
  fromSeq: number;
  toSeq: number;
}
// Extend as views land in 13-03/04/05
