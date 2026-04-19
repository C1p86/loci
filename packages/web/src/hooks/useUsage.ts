import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api.js';
import type { Usage } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export function useUsage() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['usage', orgId],
    queryFn: () =>
      apiGet<{ ok: true; usage: Usage }>(`/api/orgs/${orgId}/usage`).then((r) => r.usage),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });
}
