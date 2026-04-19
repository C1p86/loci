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

export interface Member {
  id: string;
  userId: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Invite {
  id: string;
  email: string;
  role: 'member' | 'viewer';
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface WebhookTokenRow {
  id: string;
  pluginName: 'github' | 'perforce';
  hasPluginSecret: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreateTokenResponse {
  ok: true;
  tokenId: string;
  plaintextToken: string;
  endpointUrl: string;
}

export type DlqFailureReason =
  | 'signature_invalid'
  | 'parse_failed'
  | 'no_task_matched'
  | 'task_validation_failed'
  | 'internal';

export type DlqRetryResult = 'succeeded' | 'failed_same_reason' | 'failed_new_reason';

export interface DlqEntry {
  id: string;
  pluginName: 'github' | 'perforce';
  deliveryId: string | null;
  failureReason: DlqFailureReason;
  scrubbedBody: unknown;
  scrubbedHeaders: Record<string, string>;
  httpStatus: number | null;
  receivedAt: string;
  retriedAt: string | null;
  retryResult: DlqRetryResult | null;
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
