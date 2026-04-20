import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import type { DlqEntry, DlqRetryResult } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export function useDlq(cursor?: string) {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['dlq', orgId, cursor ?? 'first'],
    queryFn: () =>
      apiGet<{ entries: DlqEntry[]; nextCursor?: string }>(
        `/api/orgs/${orgId}/dlq${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
    enabled: !!orgId,
  });
}

export function useDlqRetry() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { dlqId: string }) =>
      apiPost<{ dispatched: number; runIds?: string[]; retryResult: DlqRetryResult }>(
        `/api/orgs/${orgId}/dlq/${args.dlqId}/retry`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dlq', orgId] }),
  });
}
