import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiGet, apiPatch } from '../lib/api.js';
import type { Member } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export function useMembers() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['members', orgId],
    queryFn: () => apiGet<Member[]>(`/api/orgs/${orgId}/members`),
    enabled: !!orgId,
  });
}

export function useChangeMemberRole() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { memberId: string; role: 'member' | 'viewer' }) =>
      apiPatch(`/api/orgs/${orgId}/members/${args.memberId}`, { role: args.role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', orgId] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { memberId: string }) =>
      apiDelete(`/api/orgs/${orgId}/members/${args.memberId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', orgId] }),
  });
}
