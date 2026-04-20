import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPost } from '../lib/api.js';
import type { Invite } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export function useInvites() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['invites', orgId],
    queryFn: () => apiGet<Invite[]>(`/api/orgs/${orgId}/invites`),
    enabled: !!orgId,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { email: string; role: 'member' | 'viewer' }) =>
      apiPost<{ inviteId: string; token: string; expiresAt: string }>(
        `/api/orgs/${orgId}/invites`,
        args,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', orgId] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { inviteId: string }) =>
      apiDelete(`/api/orgs/${orgId}/invites/${args.inviteId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', orgId] }),
  });
}
