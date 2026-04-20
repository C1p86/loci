import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import type { CreateTokenResponse, WebhookTokenRow } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export function useWebhookTokens() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['webhookTokens', orgId],
    queryFn: () =>
      apiGet<{ tokens: WebhookTokenRow[] }>(`/api/orgs/${orgId}/webhook-tokens`).then(
        (r) => r.tokens,
      ),
    enabled: !!orgId,
  });
}

export function useCreateWebhookToken() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { pluginName: 'github' | 'perforce'; pluginSecret?: string }) =>
      apiPost<CreateTokenResponse>(`/api/orgs/${orgId}/webhook-tokens`, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhookTokens', orgId] }),
  });
}

export function useRevokeWebhookToken() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { id: string }) =>
      apiPost(`/api/orgs/${orgId}/webhook-tokens/${args.id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhookTokens', orgId] }),
  });
}
