import { useMutation, useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import type { RunState, RunSummary } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

interface RunDetail extends RunSummary {
  task: { id: string; name: string; yamlDefinition: string };
}

const TERMINAL_STATES: RunState[] = ['succeeded', 'failed', 'cancelled', 'timed_out', 'orphaned'];

export function useRun(runId: string | undefined) {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['runs', 'detail', orgId, runId],
    queryFn: () => apiGet<RunDetail>(`/api/orgs/${orgId}/runs/${runId}`),
    enabled: !!orgId && !!runId,
    refetchInterval: (query) => {
      const state = (query.state.data as RunDetail | undefined)?.state;
      return state && TERMINAL_STATES.includes(state) ? false : 5000;
    },
  });
}

export function useTriggerRun(taskId: string) {
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (paramOverrides: Record<string, string>) =>
      apiPost<{ runId: string; state: string; missing_params?: string[] }>(
        `/api/orgs/${orgId}/tasks/${taskId}/runs`,
        { param_overrides: paramOverrides },
      ),
  });
}

export function useCancelRun(runId: string) {
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: () => apiPost(`/api/orgs/${orgId}/runs/${runId}/cancel`),
  });
}
