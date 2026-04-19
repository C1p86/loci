import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import type { Invite } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export function useInvites() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['invites', orgId],
    queryFn: () =>
      apiGet<{ ok: true; invites: Invite[] }>(`/api/orgs/${orgId}/invites`).then((r) => r.invites),
    enabled: !!orgId,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { email: string; role: 'member' | 'viewer' }) =>
      apiPost<{ ok: true; inviteId: string }>(`/api/orgs/${orgId}/invites`, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', orgId] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { inviteId: string }) =>
      apiPost(`/api/orgs/${orgId}/invites/${args.inviteId}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', orgId] }),
  });
}
