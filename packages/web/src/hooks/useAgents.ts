import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../lib/api.js';
import type { Agent } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export function useAgents() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['agents', 'list', orgId],
    queryFn: () =>
      apiGet<{ ok: true; agents: Agent[] }>(`/api/orgs/${orgId}/agents`).then((r) => r.agents),
    enabled: !!orgId,
  });
}

export function useAgentRename() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { agentId: string; hostname: string }) =>
      apiPost(`/api/orgs/${orgId}/agents/${args.agentId}/rename`, { hostname: args.hostname }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'list', orgId] }),
  });
}

export function useAgentDrain() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { agentId: string }) =>
      apiPost(`/api/orgs/${orgId}/agents/${args.agentId}/drain`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'list', orgId] }),
  });
}

export function useAgentRevoke() {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (args: { agentId: string }) =>
      apiPost(`/api/orgs/${orgId}/agents/${args.agentId}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents', 'list', orgId] }),
  });
}
