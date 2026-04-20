import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPatch } from '../lib/api.js';
import type { Task, TaskDetail } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

export function useTasks() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['tasks', 'list', orgId],
    queryFn: () => apiGet<Task[]>(`/api/orgs/${orgId}/tasks`),
    enabled: !!orgId,
  });
}

export function useTask(taskId: string | undefined) {
  const orgId = useAuthStore((s) => s.org?.id);
  return useQuery({
    queryKey: ['tasks', 'detail', orgId, taskId],
    queryFn: () => apiGet<TaskDetail>(`/api/orgs/${orgId}/tasks/${taskId}`),
    enabled: !!orgId && !!taskId,
  });
}

export function useUpdateTask(taskId: string) {
  const qc = useQueryClient();
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: (body: Partial<TaskDetail>) => apiPatch(`/api/orgs/${orgId}/tasks/${taskId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', 'list', orgId] });
      qc.invalidateQueries({ queryKey: ['tasks', 'detail', orgId, taskId] });
    },
  });
}
