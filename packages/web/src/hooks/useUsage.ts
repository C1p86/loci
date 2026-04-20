import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api.js';
import type { Usage } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

interface BackendUsage {
  agents: { used: number; max: number };
  concurrent: { used: number; max: number };
  retention_days: number;
}

export function useUsage() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['usage', orgId],
    queryFn: () =>
      apiGet<BackendUsage>(`/api/orgs/${orgId}/usage`).then(
        (r): Usage => ({
          agents: { current: r.agents.used, max: r.agents.max },
          concurrent: { current: r.concurrent.used, max: r.concurrent.max },
          retentionDays: r.retention_days,
        }),
      ),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });
}
