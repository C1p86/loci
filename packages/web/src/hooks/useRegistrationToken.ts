import { useMutation } from '@tanstack/react-query';
import { apiPost } from '../lib/api.js';
import { useAuthStore } from '../stores/authStore.js';

export interface RegistrationTokenResponse {
  tokenId: string;
  token: string;
  expiresAt: string;
}

/**
 * Creates a one-time agent registration token.
 * Per T-13-03-02: returned token is held in mutation result only;
 * never persisted to localStorage/sessionStorage.
 */
export function useCreateRegistrationToken() {
  const orgId = useAuthStore((s) => s.org?.id);
  return useMutation({
    mutationFn: () =>
      apiPost<RegistrationTokenResponse>(`/api/orgs/${orgId}/agent-tokens`, {}),
  });
}
