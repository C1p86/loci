import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api.js';
import type { RunState, RunSummary } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export interface HistoryFilters {
  states?: RunState[];
  taskId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

interface HistoryResponse {
  runs: RunSummary[];
  nextCursor?: string | null;
}

export function useRunHistory(filters: HistoryFilters) {
  const orgId = useAuthStore((s) => s.org?.id);

  const qs = new URLSearchParams();
  if (filters.states?.length) qs.set('state', filters.states.join(','));
  if (filters.taskId) qs.set('taskId', filters.taskId);
  if (filters.from) qs.set('since', filters.from);
  if (filters.to) qs.set('to', filters.to);
  if (filters.cursor) qs.set('since', filters.cursor);
  qs.set('limit', String(filters.limit ?? 25));

  return useQuery({
    queryKey: ['runs', 'history', orgId, Object.fromEntries(qs)],
    queryFn: () => apiGet<HistoryResponse>(`/api/orgs/${orgId}/runs?${qs.toString()}`),
    enabled: !!orgId,
  });
}
