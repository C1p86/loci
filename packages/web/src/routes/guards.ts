import { redirect } from 'react-router-dom';
import { ApiError, apiGet } from '../lib/api.js';
import type { AuthMe } from '../lib/types.js';
import { useAuthStore } from '../stores/authStore.js';

/**
 * Loader for public-only routes (e.g. /login, /signup).
 * Redirects to /agents if user is already authenticated.
 */
export async function publicOnlyLoader(): Promise<null> {
  try {
    const me = await apiGet<AuthMe>('/api/auth/me');
    useAuthStore.getState().setFromMe(me);
    throw redirect('/agents');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return null; // stay on public page
    }
    throw err;
  }
}
